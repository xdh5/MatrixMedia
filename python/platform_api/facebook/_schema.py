"""Zernio Facebook 发布 Schema。"""

PUBLISH_TO_FACEBOOK_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "page_id": {
            "type": "string",
            "minLength": 1,
            "description": "Zernio 已连接的 Facebook Page 账号 ID",
        },
        "video_url": {"type": "string", "pattern": r"^https?://"},
        "description": {"type": "string", "maxLength": 63206},
        "title": {"type": "string", "maxLength": 255},
        "publish_at": {
            "type": ["string", "null"],
            "description": "可选的带时区 ISO 8601 定时时间",
        },
    },
    "required": ["page_id", "video_url", "description"],
    "additionalProperties": False,
}

PUBLISH_TO_FACEBOOK_OUTPUT_SCHEMA = {
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

FACEBOOK_ACCOUNT_SCHEMA = {
    "type": "object",
    "properties": {
        "page_id": {"type": "string"},
        "platform_account_id": {"type": "string"},
        "page_name": {"type": "string"},
    },
    "required": ["page_id", "platform_account_id", "page_name"],
    "additionalProperties": False,
}

CHECK_FACEBOOK_CONNECTION_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "connected": {"type": "boolean", "const": True},
        "page_id": {"type": "string"},
        "page_name": {"type": "string"},
    },
    "required": ["connected", "page_id", "page_name"],
    "additionalProperties": False,
}

PUBLISH_FACEBOOK_POST_NOW_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "post_id": {"type": "string", "minLength": 1},
        "account_id": {"type": "string", "minLength": 1},
    },
    "required": ["post_id", "account_id"],
    "additionalProperties": False,
}
