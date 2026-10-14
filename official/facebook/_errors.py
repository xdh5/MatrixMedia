"""Zernio Facebook 发布错误。"""


class FacebookToolError(Exception):
    code = "FACEBOOK_TOOL_ERROR"

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


class InvalidParameterError(FacebookToolError):
    code = "INVALID_PARAMETER"


class CredentialError(FacebookToolError):
    code = "ZERNIO_CREDENTIAL_ERROR"


class PublishError(FacebookToolError):
    code = "ZERNIO_FACEBOOK_PUBLISH_FAILED"
