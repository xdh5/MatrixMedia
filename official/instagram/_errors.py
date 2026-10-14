"""Instagram 发布错误。"""


class InstagramToolError(Exception):
    code = "INSTAGRAM_TOOL_ERROR"

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


class InvalidParameterError(InstagramToolError):
    code = "INVALID_PARAMETER"


class CredentialError(InstagramToolError):
    code = "ZERNIO_CREDENTIAL_ERROR"


class PublishError(InstagramToolError):
    code = "ZERNIO_INSTAGRAM_PUBLISH_FAILED"
