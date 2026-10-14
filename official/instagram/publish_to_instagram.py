"""通过 Zernio HTTP API 把 R2 公网视频发布为 Instagram Reel。"""

from __future__ import annotations

import sys

import os
import time
import uuid
from datetime import datetime, timezone

import requests

from ._constants import (
    INSTAGRAM_FAILURE_STATUSES,
    INSTAGRAM_REQUEST_TIMEOUT_SECONDS,
    INSTAGRAM_STATUS_POLL_INTERVAL_SECONDS,
    INSTAGRAM_STATUS_TIMEOUT_SECONDS,
    INSTAGRAM_SUCCESS_STATUSES,
    ZERNIO_API_BASE_URL,
    ZERNIO_META_API_KEY_ENV,
    load_project_env,
)
from ._errors import CredentialError, InvalidParameterError, PublishError
from ..group_env import accounts_with_suffix

__all__ = [
    "check_instagram_connection",
    "delete_zernio_post",
    "list_instagram_accounts",
    "publish_to_instagram",
]

load_project_env()


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _api_key() -> str:
    value = _env(ZERNIO_META_API_KEY_ENV)
    if not value:
        raise CredentialError(
            f"缺少 {ZERNIO_META_API_KEY_ENV}，请把 Meta 专用 Zernio API key 写入 MCP 宿主环境的 .env",
            {"environment": ZERNIO_META_API_KEY_ENV},
        )
    return value


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


def _request(
    method: str,
    path: str,
    *,
    params: dict | None = None,
    json: dict | None = None,
    request_id: str = "",
) -> dict:
    headers = {"Authorization": f"Bearer {_api_key()}"}
    if json is not None:
        headers["Content-Type"] = "application/json"
    if request_id:
        headers["x-request-id"] = request_id
    try:
        last_error = None
        for attempt in range(5):
            try:
                response = requests.request(
                    method,
                    f"{ZERNIO_API_BASE_URL}{path}",
                    headers=headers,
                    params=params,
                    json=json,
                    timeout=INSTAGRAM_REQUEST_TIMEOUT_SECONDS,
                )
                break
            except requests.RequestException as exc:
                last_error = exc
                if attempt < 4:
                    time.sleep(2 * (attempt + 1))
        else:
            raise last_error
    except requests.RequestException as exc:
        raise PublishError(f"请求 Zernio Instagram API 失败：{exc}") from exc
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    print(
        f"[Instagram] Zernio {method} {path} HTTP {response.status_code} body={(response.text or '')[:800]}",
        file=sys.stderr, flush=True,
    )
    if not response.ok:
        message = str(payload.get("error") or payload.get("message") or response.text[:500])
        raise PublishError(
            f"Zernio Instagram API 返回 HTTP {response.status_code}：{message}",
            {"status_code": response.status_code, "response": payload},
        )
    return payload if isinstance(payload, dict) else {}


def delete_zernio_post(post_id: str) -> dict:
    """删除 Meta 专用 Zernio 工作区中的草稿或预约帖子。"""
    normalized_post_id = str(post_id or "").strip()
    if not normalized_post_id:
        raise InvalidParameterError("post_id 不能为空", {"parameter": "post_id"})
    _request("DELETE", f"/posts/{normalized_post_id}")
    return {"post_id": normalized_post_id, "deleted": True}


def _account_rows() -> list[dict]:
    payload = _request(
        "GET",
        "/accounts",
        params={"platform": "instagram", "status": "connected"},
    )
    rows = []
    for item in payload.get("accounts") or []:
        if not isinstance(item, dict):
            continue
        account_id = str(item.get("_id") or item.get("id") or "").strip()
        platform_account_id = str(item.get("platformUserId") or "").strip()
        if not account_id or not platform_account_id:
            continue
        username = str(item.get("username") or "").strip()
        rows.append({
            "user_id": account_id,
            "platform_account_id": platform_account_id,
            "account_title": str(item.get("displayName") or username or account_id),
            "username": username,
        })
    return rows


def list_instagram_accounts(account: str | None = None) -> list[dict]:
    """列出账号组 .env 里已选定、且 Zernio 仍连接着的 Instagram 账号。"""
    load_project_env()
    rows = {item["user_id"]: item for item in _account_rows()}
    selected = []
    for slug, account_id in accounts_with_suffix("_INSTAGRAM_ACCOUNT_ID", account):
        item = rows.get(account_id)
        if not item:
            raise CredentialError(
                f"Zernio 中找不到账号组 {slug} 的 Instagram 账号",
                {"account": slug},
            )
        selected.append({**item, "account": slug})
    return selected


def check_instagram_connection() -> dict:
    """只读检查 Zernio Instagram 账号是否已连接且可发布。"""
    accounts = list_instagram_accounts()
    if not accounts:
        raise CredentialError("Zernio 尚未连接 Instagram 专业账号")
    account = accounts[0]
    health = _request("GET", f"/accounts/{account['user_id']}/health")
    can_post = health.get("canPost") is not False
    token_valid = health.get("tokenValid") is not False
    if not can_post or not token_valid:
        raise CredentialError(
            "Zernio Instagram 账号当前不可发布",
            {
                "user_id": account["user_id"],
                "status": health.get("status"),
                "issues": health.get("issues") or [],
            },
        )
    return {
        "connected": True,
        "user_id": account["user_id"],
        "username": account["username"],
    }


def _post_data(payload: dict) -> dict:
    post = payload.get("post") or payload.get("existingPost") or payload.get("data") or payload
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
    platform_url = str(platform.get("platformPostUrl") or post.get("platformPostUrl") or "").strip()
    return status, message, platform_url


def _wait_for_terminal(post_id: str, account_id: str) -> dict:
    deadline = time.monotonic() + INSTAGRAM_STATUS_TIMEOUT_SECONDS
    while True:
        post = _post_data(_request("GET", f"/posts/{post_id}"))
        status, message, platform_url = _post_status(post, account_id)
        if status in INSTAGRAM_SUCCESS_STATUSES:
            return {
                "post_id": post_id,
                "platform_url": platform_url,
                "account_id": account_id,
                "status": "published",
            }
        if status in INSTAGRAM_FAILURE_STATUSES:
            raise PublishError(
                f"Instagram 未发布成功：{message or f'平台终态为 {status}'}",
                {"post_id": post_id, "account_id": account_id, "status": status},
            )
        if time.monotonic() >= deadline:
            raise PublishError(
                f"等待 Instagram 发布终态超时，当前状态：{status or 'unknown'}",
                {"post_id": post_id, "account_id": account_id, "status": status},
            )
        time.sleep(INSTAGRAM_STATUS_POLL_INTERVAL_SECONDS)


def _create_post(payload: dict, request_id: str) -> tuple[str, bool]:
    try:
        result = _request("POST", "/posts", json=payload, request_id=request_id)
    except PublishError as exc:
        response = exc.details.get("response")
        details = response.get("details") if isinstance(response, dict) else None
        post_id = str((details or {}).get("existingPostId") or "")
        if exc.details.get("status_code") == 409 and post_id:
            return post_id, True
        raise
    duplicate = isinstance(result.get("existingPost"), dict)
    post = _post_data(result)
    post_id = str(post.get("_id") or post.get("id") or result.get("postId") or "")
    if not post_id:
        raise PublishError("Zernio 未返回 post ID，无法确认 Instagram 发布任务")
    return post_id, duplicate


def publish_to_instagram(
    user_id: str,
    video_url: str,
    caption: str,
    *,
    share_to_feed: bool = True,
    publish_at: str | None = None,
) -> dict:
    """立即或定时发布单个 Instagram Reel。"""
    account_id = str(user_id or "").strip()
    if not account_id:
        raise InvalidParameterError("user_id 不能为空", {"parameter": "user_id"})
    accounts = list_instagram_accounts()
    if account_id not in {item["user_id"] for item in accounts}:
        raise CredentialError("请求的 Instagram 账号不在 Zernio 已选账号中", {"user_id": account_id})
    normalized_url = str(video_url or "").strip()
    if not normalized_url.startswith(("https://", "http://")):
        raise InvalidParameterError("video_url 必须是 R2 的 HTTP(S) 公网地址", {"parameter": "video_url"})
    normalized_caption = str(caption or "").strip()
    if len(normalized_caption) > 2200:
        raise InvalidParameterError("Instagram caption 不能超过 2200 个字符", {"parameter": "caption"})
    scheduled_for = _normalize_publish_at(publish_at)
    payload = {
        "content": normalized_caption,
        "mediaItems": [{"type": "video", "url": normalized_url}],
        "platforms": [{
            "platform": "instagram",
            "accountId": account_id,
            "platformSpecificData": {
                "contentType": "reel",
                "shareToFeed": bool(share_to_feed),
            },
        }],
    }
    if scheduled_for:
        payload["scheduledFor"] = scheduled_for
    else:
        payload["publishNow"] = True
    request_id = str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"{account_id}|{normalized_url}|{normalized_caption}|{bool(share_to_feed)}|{scheduled_for or 'now'}",
    ))
    post_id, duplicate = _create_post(payload, request_id)
    if scheduled_for:
        return {
            "post_id": post_id,
            "platform_url": "",
            "account_id": account_id,
            "status": "scheduled",
            "duplicate": duplicate,
        }
    terminal = _wait_for_terminal(post_id, account_id)
    return {**terminal, "duplicate": duplicate}
