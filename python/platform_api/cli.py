"""矩媒官方平台命令行：账号查询与发布。"""

from __future__ import annotations

import argparse
import json
import os
import sys

from platform_api.facebook.publish_to_facebook import list_facebook_accounts, publish_to_facebook
from platform_api.instagram.publish_to_instagram import list_instagram_accounts, publish_to_instagram
from platform_api.tiktok.publish_to_tiktok import list_tiktok_accounts, publish_to_tiktok
from platform_api.youtube.publish_to_youtube import list_youtube_accounts, publish_to_youtube


def _dump(payload: dict | list) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


# GitHub Action 仍注入旧前缀。chinese 账号组没有本地 .env 时沿用这些密钥。
_LEGACY_PREFIX = {"chinese": "LANGUAGE_LEARNING_"}


def _apply_legacy_env(group: str) -> None:
    legacy = _LEGACY_PREFIX.get(str(group or "").strip().lower())
    if not legacy:
        return
    target = str(group).strip().upper() + "_"
    for key, value in list(os.environ.items()):
        text = str(value or "").strip()
        if not key.startswith(legacy) or not text:
            continue
        dest = target + key[len(legacy):]
        if not os.environ.get(dest):
            os.environ[dest] = text


def _accounts(group: str) -> list[dict]:
    _apply_legacy_env(group)
    rows = []
    for item in list_youtube_accounts(group):
        rows.append({
            "platform": "youtube",
            "account_ref": item["account"],
            "account_id": item["channel_id"],
            "platform_account_id": item["channel_id"],
            "display_name": item["channel_title"],
        })
    for item in list_tiktok_accounts(group):
        rows.append({
            "platform": "tiktok",
            "account_ref": item["account"],
            "account_id": item["account_id"],
            "platform_account_id": item["platform_account_id"],
            "display_name": item["account_title"],
        })
    for item in list_instagram_accounts(group):
        rows.append({
            "platform": "instagram",
            "account_ref": item["account"],
            "account_id": item["user_id"],
            "platform_account_id": item["platform_account_id"],
            "display_name": item["account_title"],
        })
    for item in list_facebook_accounts(group):
        rows.append({
            "platform": "facebook",
            "account_ref": item["account"],
            "account_id": item["page_id"],
            "platform_account_id": item["platform_account_id"],
            "display_name": item["page_name"],
        })
    return rows


def _publish(args: argparse.Namespace) -> dict:
    _apply_legacy_env(args.phone)
    platform = str(args.platform).strip().lower()
    group = str(args.phone).strip()
    account_id = str(args.account_id).strip()
    publish_at = str(args.publish_at or "").strip() or None
    if platform == "youtube":
        return publish_to_youtube(
            account_id,
            args.file,
            args.title,
            description=args.description or "",
            account=group,
            privacy_status=args.privacy or "public",
            publish_at=publish_at,
            publication_id=args.publication_id or "",
        )
    if platform == "tiktok":
        return publish_to_tiktok(
            account_id,
            args.video_url,
            args.description or args.title or "",
            account=group,
            publish_at=publish_at,
        )
    if platform == "instagram":
        return publish_to_instagram(account_id, args.video_url, args.description or args.title or "", publish_at=publish_at)
    if platform == "facebook":
        return publish_to_facebook(
            account_id,
            args.video_url,
            args.description or "",
            title=args.title or "",
            publish_at=publish_at,
        )
    raise ValueError(f"不支持的官方平台：{platform}")


def main() -> None:
    parser = argparse.ArgumentParser(description="矩媒官方平台发布")
    sub = parser.add_subparsers(dest="command", required=True)

    accounts = sub.add_parser("accounts")
    accounts.add_argument("--group", required=True)

    publish = sub.add_parser("publish")
    publish.add_argument("-p", "--platform", required=True)
    publish.add_argument("--phone", required=True)
    publish.add_argument("--account-id", required=True)
    publish.add_argument("-f", "--file", default="")
    publish.add_argument("--video-url", default="")
    publish.add_argument("--title", default="")
    publish.add_argument("--description", default="")
    publish.add_argument("--publish-at", default="")
    publish.add_argument("--publication-id", default="")
    publish.add_argument("--privacy", default="public")

    args = parser.parse_args()
    try:
        if args.command == "accounts":
            _dump(_accounts(args.group))
            return
        _dump(_publish(args))
    except Exception as exc:
        _dump({"error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
