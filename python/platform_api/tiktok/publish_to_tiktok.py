"""通过 Zernio HTTP API 把 R2 公网视频发布到 TikTok。"""

from __future__ import annotations

import sys

import os
import re
import time
import uuid
from copy import deepcopy
from datetime import datetime, timezone

import requests

from ._constants import (
    ACCOUNT_ID_PATTERN,
    TIKTOK_ACCOUNT_ID_SUFFIX,
    TIKTOK_ACCOUNT_TITLE_SUFFIX,
    TIKTOK_PRIVACY_LEVEL,
    TIKTOK_REQUEST_TIMEOUT_SECONDS,
    TIKTOK_STATUS_POLL_INTERVAL_SECONDS,
    TIKTOK_STATUS_TIMEOUT_SECONDS,
    TIKTOK_SUCCESS_STATUSES,
    TIKTOK_FAILURE_STATUSES,
    TIKTOK_USERNAME_SUFFIX,
    ZERNIO_API_BASE_URL,
    ZERNIO_API_KEY_ENV,
    ZERNIO_LEGACY_API_KEY_ENV,
    load_project_env,
)
from ._errors import AccountNotFoundError, CredentialError, InvalidParameterError, PublishError

__all__ = ["delete_zernio_post", "list_tiktok_accounts", "publish_to_tiktok"]

load_project_env()


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _api_key() -> str:
    value = _env(ZERNIO_API_KEY_ENV) or _env(ZERNIO_LEGACY_API_KEY_ENV)
    if not value:
        raise CredentialError(
            f"缺少 {ZERNIO_API_KEY_ENV}，请把 Zernio API key 写入 MCP 宿主环境的 .env",
            {"environment": ZERNIO_API_KEY_ENV},
        )
    return value


def _request_with_retry(method: str, url: str, **kwargs):
    """连接被重置时重试，避免把临时网络抖动记成发布失败。"""
    last_error = None
    for attempt in range(5):
        try:
            return requests.request(method, url, **kwargs)
        except requests.RequestException as exc:
            last_error = exc
            if attempt < 4:
                time.sleep(2 * (attempt + 1))
    raise last_error


def _normalize_publish_at(publish_at: str | None) -> str | None:
    value = str(publish_at or "").strip()
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidParameterError(
            "publish_at 必须是带时区的 ISO 8601 时间，例如 2026-08-24T16:00:00+08:00",
            {"parameter": "publish_at", "value": value},
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise InvalidParameterError(
            "publish_at 必须明确包含时区，例如北京时间使用 +08:00",
            {"parameter": "publish_at", "value": value},
        )
    normalized = parsed.astimezone(timezone.utc).replace(microsecond=0)
    if normalized <= datetime.now(timezone.utc):
        raise InvalidParameterError(
            "publish_at 必须是未来时间",
            {"parameter": "publish_at", "value": value},
        )
    return normalized.isoformat().replace("+00:00", "Z")


def _normalize_account(account: str) -> str:
    value = str(account or "").strip().lower()
    if not re.fullmatch(ACCOUNT_ID_PATTERN, value):
        raise InvalidParameterError(
            f"account 必须是小写字母开头的标识，例如 language_learning，当前为 {account!r}",
            {"parameter": "account"},
        )
    return value


def list_tiktok_accounts(account: str | None = None) -> list[dict]:
    """列出本地已配置的 TikTok 账号，并返回 TikTok 签发的真实账号 ID。"""
    load_project_env()
    wanted = _normalize_account(account) if account else None
    try:
        response = _request_with_retry("GET",
            f"{ZERNIO_API_BASE_URL}/accounts",
            headers={"Authorization": f"Bearer {_api_key()}"},
            params={"platform": "tiktok", "status": "connected"},
            timeout=TIKTOK_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise PublishError(f"查询 Zernio TikTok 账号失败：{exc}") from exc
    platform_ids = {
        str(item.get("_id") or item.get("id") or "").strip():
            str(item.get("platformUserId") or "").strip()
        for item in (payload.get("accounts") or [])
        if isinstance(item, dict)
    }
    accounts = []
    for key, value in os.environ.items():
        if not key.endswith(TIKTOK_ACCOUNT_ID_SUFFIX) or not str(value).strip():
            continue
        prefix = key[: -len(TIKTOK_ACCOUNT_ID_SUFFIX)]
        slug = prefix.lower()
        if wanted and slug != wanted:
            continue
        connector_account_id = str(value).strip()
        platform_account_id = platform_ids.get(connector_account_id, "")
        if not platform_account_id:
            raise AccountNotFoundError(
                f"TikTok 账号 {connector_account_id} 缺少平台返回的 platformUserId，不能作为真实账号入组",
                {"account": slug, "connector_account_id": connector_account_id},
            )
        accounts.append({
            "account": slug,
            "account_id": connector_account_id,
            "platform_account_id": platform_account_id,
            "account_title": _env(prefix + TIKTOK_ACCOUNT_TITLE_SUFFIX) or slug,
            "username": _env(prefix + TIKTOK_USERNAME_SUFFIX),
        })
    return sorted(accounts, key=lambda item: item["account"])


def _configured_account(account_id: str, account: str | None) -> dict:
    normalized_id = str(account_id or "").strip()
    if not normalized_id:
        raise InvalidParameterError("account_id 不能为空", {"parameter": "account_id"})
    matches = [
        item for item in list_tiktok_accounts(account)
        if item["account_id"] == normalized_id
    ]
    if not matches:
        raise AccountNotFoundError(
            f"找不到 TikTok 账号 {normalized_id}。请配置 {{ACCOUNT}}{TIKTOK_ACCOUNT_ID_SUFFIX}",
            {"account_id": normalized_id, "account": account},
        )
    return matches[0]


def _post_data(result: dict) -> dict:
    post = result.get("post") or result.get("existingPost") or result.get("data") or result
    return post if isinstance(post, dict) else {}


def _platform_data(post: dict, account_id: str) -> dict:
    for item in post.get("platforms") or []:
        if not isinstance(item, dict):
            continue
        raw_account = item.get("accountId")
        current_id = raw_account.get("_id") if isinstance(raw_account, dict) else raw_account
        if str(current_id or "") == account_id:
            return item
    return {}


def _post_status(post: dict, account_id: str) -> tuple[str, str, str]:
    platform = _platform_data(post, account_id)
    status = str(platform.get("status") or post.get("status") or "").strip().casefold()
    message = str(platform.get("errorMessage") or post.get("errorMessage") or "").strip()
    platform_url = str(
        platform.get("platformPostUrl")
        or post.get("platformPostUrl")
        or ""
    ).strip()
    return status, message, platform_url


def _get_post(post_id: str) -> dict:
    try:
        response = _request_with_retry("GET",
            f"{ZERNIO_API_BASE_URL}/posts/{post_id}",
            headers={"Authorization": f"Bearer {_api_key()}"},
            timeout=TIKTOK_REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise PublishError(f"查询 Zernio TikTok 发布状态失败：{exc}", {"post_id": post_id}) from exc
    try:
        result = response.json()
    except ValueError:
        result = {}
    if not response.ok:
        message = str(result.get("error") or result.get("message") or response.text[:500])
        raise PublishError(
            f"Zernio TikTok 状态查询失败：HTTP {response.status_code}，{message}",
            {"post_id": post_id, "status_code": response.status_code},
        )
    return _post_data(result)


def delete_zernio_post(post_id: str) -> dict:
    """删除当前 TikTok Zernio 工作区中的草稿或预约帖子。"""
    normalized_post_id = str(post_id or "").strip()
    if not normalized_post_id:
        raise InvalidParameterError("post_id 不能为空", {"parameter": "post_id"})
    try:
        response = _request_with_retry("DELETE",
            f"{ZERNIO_API_BASE_URL}/posts/{normalized_post_id}",
            headers={"Authorization": f"Bearer {_api_key()}"},
            timeout=TIKTOK_REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise PublishError(f"删除 Zernio 帖子失败：{exc}", {"post_id": normalized_post_id}) from exc
    if response.status_code not in (200, 204):
        raise PublishError(
            f"删除 Zernio 帖子失败：HTTP {response.status_code}，{response.text[:500]}",
            {"post_id": normalized_post_id, "status_code": response.status_code},
        )
    return {"post_id": normalized_post_id, "deleted": True}


def _wait_for_terminal(post_id: str, account_id: str) -> dict:
    deadline = time.monotonic() + TIKTOK_STATUS_TIMEOUT_SECONDS
    while True:
        post = _get_post(post_id)
        status, message, platform_url = _post_status(post, account_id)
        if status in TIKTOK_SUCCESS_STATUSES:
            return {
                "post_id": post_id,
                "platform_url": platform_url,
                "account_id": account_id,
                "status": "published",
            }
        if status in TIKTOK_FAILURE_STATUSES:
            reason = message or f"平台终态为 {status}"
            raise PublishError(
                f"TikTok 未发布成功：{reason}",
                {"post_id": post_id, "account_id": account_id, "status": status},
            )
        if time.monotonic() >= deadline:
            raise PublishError(
                f"等待 TikTok 发布终态超时，当前状态：{status or 'unknown'}",
                {"post_id": post_id, "account_id": account_id, "status": status},
            )
        time.sleep(TIKTOK_STATUS_POLL_INTERVAL_SECONDS)


def _create_post(payload: dict, request_id: str) -> tuple[str, bool]:
    try:
        response = _request_with_retry("POST",
            f"{ZERNIO_API_BASE_URL}/posts",
            headers={
                "Authorization": f"Bearer {_api_key()}",
                "Content-Type": "application/json",
                "x-request-id": request_id,
            },
            json=payload,
            timeout=TIKTOK_REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise PublishError(f"请求 Zernio 发布 TikTok 失败：{exc}") from exc
    try:
        result = response.json()
    except ValueError:
        result = {}
    print(
        f"[TikTok] Zernio HTTP {response.status_code} body={(response.text or '')[:800]}",
        file=sys.stderr, flush=True,
    )
    if response.status_code == 409:
        details = result.get("details") if isinstance(result, dict) else {}
        post_id = str((details or {}).get("existingPostId") or "")
        if post_id:
            return post_id, True
    if not response.ok:
        message = str(result.get("error") or result.get("message") or response.text[:500])
        raise PublishError(f"Zernio 拒绝发布 TikTok：HTTP {response.status_code}，{message}")
    duplicate = isinstance(result.get("existingPost"), dict)
    post = _post_data(result)
    post_id = str(post.get("_id") or post.get("id") or result.get("postId") or "")
    if not post_id:
        raise PublishError("Zernio 未返回 post ID，无法确认 TikTok 发布任务")
    return post_id, duplicate


def _is_direct_capacity_error(exc: PublishError) -> bool:
    return "direct posting is at capacity" in str(exc).casefold()


def _deliver_to_creator_inbox(payload: dict, account_id: str, failed_post_id: str) -> dict:
    draft_payload = deepcopy(payload)
    settings = dict(draft_payload.get("tiktokSettings") or {})
    settings["draft"] = True
    draft_payload["tiktokSettings"] = settings
    # Zernio 的重复内容哈希会忽略 draft 设置；加入不可见分隔符，避免草稿被错误映射到直发失败记录。
    draft_payload["content"] = str(draft_payload.get("content") or "") + "\u2060"
    request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{failed_post_id}|draft-2"))
    post_id, duplicate = _create_post(draft_payload, request_id)
    terminal = _wait_for_terminal(post_id, account_id)
    return {
        **terminal,
        "status": "draft_delivered",
        "delivery_mode": "draft",
        "duplicate": duplicate,
    }


def publish_to_tiktok(
    account_id: str,
    video_url: str,
    content: str,
    *,
    account: str | None = None,
    publish_at: str | None = None,
) -> dict:
    """立即或定时发布单个 TikTok 视频。"""
    configured = _configured_account(account_id, account)
    normalized_url = str(video_url or "").strip()
    if not normalized_url.startswith(("https://", "http://")):
        raise InvalidParameterError("video_url 必须是 R2 的 HTTP(S) 公网地址", {"parameter": "video_url"})
    normalized_content = str(content or "").strip()
    if len(normalized_content) > 2200:
        raise InvalidParameterError("TikTok content 不能超过 2200 个字符", {"parameter": "content"})
    scheduled_for = _normalize_publish_at(publish_at)
    request_id = str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"{configured['account_id']}|{normalized_url}|{normalized_content}|{scheduled_for or 'now'}",
    ))
    payload = {
        "content": normalized_content,
        "mediaItems": [{"type": "video", "url": normalized_url}],
        "platforms": [{"platform": "tiktok", "accountId": configured["account_id"]}],
        "tiktokSettings": {
            "privacy_level": TIKTOK_PRIVACY_LEVEL,
            "allow_comment": True,
            "allow_duet": True,
            "allow_stitch": True,
            "content_preview_confirmed": True,
            "express_consent_given": True,
            "video_made_with_ai": True,
            "commercialContentType": "none",
        },
    }
    if scheduled_for:
        payload["scheduledFor"] = scheduled_for
    else:
        payload["publishNow"] = True
    post_id, duplicate = _create_post(payload, request_id)
    if scheduled_for:
        return {
            "post_id": post_id,
            "platform_url": "",
            "account_id": account_id,
            "status": "scheduled",
            "delivery_mode": "direct",
            "duplicate": duplicate,
        }
    try:
        if duplicate:
            try:
                terminal = _wait_for_terminal(post_id, account_id)
            except PublishError as exc:
                if str(exc.details.get("status") or "") not in TIKTOK_FAILURE_STATUSES:
                    raise
                retry_request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{post_id}|retry-1"))
                post_id, duplicate = _create_post(payload, retry_request_id)
                terminal = _wait_for_terminal(post_id, account_id)
        else:
            terminal = _wait_for_terminal(post_id, account_id)
        return {**terminal, "duplicate": duplicate, "delivery_mode": "direct"}
    except PublishError as exc:
        if not _is_direct_capacity_error(exc):
            raise
        failed_post_id = str(exc.details.get("post_id") or post_id)
        return _deliver_to_creator_inbox(payload, account_id, failed_post_id)
