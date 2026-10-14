"""发布到 YouTube 常量。"""

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]
YOUTUBE_PRIVACY_STATUSES = ["private", "unlisted", "public"]
DEFAULT_CATEGORY_ID = "24"
DEFAULT_LANGUAGE = "zh"
UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024
MAX_TRANSIENT_RETRIES = 8
YOUTUBE_TOKEN_URI = "https://oauth2.googleapis.com/token"

ACCOUNT_ID_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"
YOUTUBE_CHANNEL_ID_SUFFIX = "_YOUTUBE_CHANNEL_ID"
YOUTUBE_CHANNEL_TITLE_SUFFIX = "_YOUTUBE_CHANNEL_TITLE"
YOUTUBE_REFRESH_TOKEN_SUFFIX = "_YOUTUBE_REFRESH_TOKEN"
YOUTUBE_TOKEN_SUFFIX = "_YOUTUBE_TOKEN"
YOUTUBE_OAUTH_CLIENT_ID_ENV = "YOUTUBE_OAUTH_CLIENT_ID"
YOUTUBE_OAUTH_CLIENT_SECRET_ENV = "YOUTUBE_OAUTH_CLIENT_SECRET"
YOUTUBE_REQUIRED_SUFFIXES = (
    YOUTUBE_CHANNEL_ID_SUFFIX,
    YOUTUBE_REFRESH_TOKEN_SUFFIX,
)


def load_project_env() -> None:
    from ..group_env import load_matrix_group_envs

    load_matrix_group_envs()
