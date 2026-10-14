"""Zernio TikTok 发布输入输出 Schema。"""

PUBLISH_TO_TIKTOK_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "account_id": {"type": "string", "minLength": 1},
        "video_url": {"type": "string", "format": "uri"},
        "content": {"type": "string", "maxLength": 2200},
        "account": {
            "type": "string",
            "minLength": 1,
            "description": "账号标识，对应环境变量前缀，例如 language_learning",
        },
        "publish_at": {
            "type": ["string", "null"],
            "description": "可选的带时区 ISO 8601 定时时间",
        },
    },
    "required": ["account_id", "video_url", "content"],
    "additionalProperties": False,
}

TIKTOK_ACCOUNT_SCHEMA = {
    "type": "object",
    "properties": {
        "account": {"type": "string"},
        "account_id": {"type": "string"},
        "platform_account_id": {"type": "string"},
        "account_title": {"type": "string"},
        "username": {"type": "string"},
    },
    "required": ["account", "account_id", "platform_account_id", "account_title", "username"],
    "additionalProperties": False,
}

PUBLISH_TO_TIKTOK_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "post_id": {"type": "string"},
        "platform_url": {"type": "string"},
        "account_id": {"type": "string"},
        "duplicate": {"type": "boolean"},
        "status": {"type": "string", "enum": ["published", "scheduled", "draft_delivered"]},
        "delivery_mode": {"type": "string", "enum": ["direct", "draft"]},
    },
    "required": ["post_id", "platform_url", "account_id", "duplicate", "status", "delivery_mode"],
    "additionalProperties": False,
}
