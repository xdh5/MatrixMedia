"""Zernio TikTok 发布错误。"""


class TikTokToolError(Exception):
    code = "TIKTOK_TOOL_ERROR"

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


class InvalidParameterError(TikTokToolError):
    code = "INVALID_PARAMETER"


class AccountNotFoundError(TikTokToolError):
    code = "TIKTOK_ACCOUNT_NOT_FOUND"


class CredentialError(TikTokToolError):
    code = "ZERNIO_CREDENTIAL_ERROR"


class PublishError(TikTokToolError):
    code = "ZERNIO_TIKTOK_PUBLISH_FAILED"
