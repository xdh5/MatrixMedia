"""Zernio Instagram 发布 Schema。"""

PUBLISH_TO_INSTAGRAM_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "user_id": {
            "type": "string",
            "minLength": 1,
            "description": "Zernio 已连接的 Instagram 账号 ID",
        },
        "video_url": {"type": "string", "pattern": r"^https?://"},
        "caption": {"type": "string", "maxLength": 2200},
        "share_to_feed": {"type": "boolean", "default": True},
        "publish_at": {
            "type": ["string", "null"],
            "description": "可选的带时区 ISO 8601 定时时间",
        },
    },
    "required": ["user_id", "video_url", "caption"],
    "additionalProperties": False,
}

PUBLISH_TO_INSTAGRAM_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "post_id": {"type": "string"},
        "platform_url": {"type": "string"},
        "account_id": {"type": "string"},
        "duplicate": {"type": "boolean"},
        "status": {"type": "string", "enum": ["published", "scheduled"]},
    },
    "required": ["post_id", "platform_url", "account_id", "duplicate", "status"],
    "additionalProperties": False,
}

INSTAGRAM_ACCOUNT_SCHEMA = {
    "type": "object",
    "properties": {
        "user_id": {"type": "string"},
        "platform_account_id": {"type": "string"},
        "account_title": {"type": "string"},
        "username": {"type": "string"},
    },
    "required": ["user_id", "platform_account_id", "account_title", "username"],
    "additionalProperties": False,
}

CHECK_INSTAGRAM_CONNECTION_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "connected": {"type": "boolean", "const": True},
        "user_id": {"type": "string"},
        "username": {"type": "string"},
    },
    "required": ["connected", "user_id", "username"],
    "additionalProperties": False,
}

PUBLISH_INSTAGRAM_POST_NOW_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "post_id": {"type": "string", "minLength": 1},
        "account_id": {"type": "string", "minLength": 1},
    },
    "required": ["post_id", "account_id"],
    "additionalProperties": False,
}
