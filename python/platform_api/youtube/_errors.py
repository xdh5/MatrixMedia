"""发布到 YouTube 错误定义。"""


class YouTubeToolError(Exception):
    code = "YOUTUBE_TOOL_ERROR"

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


class InvalidParameterError(YouTubeToolError):
    code = "INVALID_PARAMETER"


class AccountNotFoundError(YouTubeToolError):
    code = "YOUTUBE_ACCOUNT_NOT_FOUND"


class CredentialError(YouTubeToolError):
    code = "YOUTUBE_CREDENTIAL_ERROR"


class UploadError(YouTubeToolError):
    code = "YOUTUBE_UPLOAD_FAILED"
