"""Zernio TikTok 发布常量。"""

ZERNIO_API_BASE_URL = "https://zernio.com/api/v1"
ZERNIO_API_KEY_ENV = "ZERNIO_API_KEY"
ZERNIO_LEGACY_API_KEY_ENV = "zernio_api_key"
TIKTOK_ACCOUNT_ID_SUFFIX = "_TIKTOK_ACCOUNT_ID"
TIKTOK_ACCOUNT_TITLE_SUFFIX = "_TIKTOK_ACCOUNT_TITLE"
TIKTOK_USERNAME_SUFFIX = "_TIKTOK_USERNAME"
TIKTOK_PRIVACY_LEVEL = "PUBLIC_TO_EVERYONE"
TIKTOK_REQUEST_TIMEOUT_SECONDS = 120
TIKTOK_STATUS_POLL_INTERVAL_SECONDS = 2
TIKTOK_STATUS_TIMEOUT_SECONDS = 120
TIKTOK_SUCCESS_STATUSES = frozenset({"published", "success"})
TIKTOK_FAILURE_STATUSES = frozenset({"failed", "cancelled", "canceled"})
ACCOUNT_ID_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"


def load_project_env() -> None:
    from ..group_env import load_matrix_group_envs

    load_matrix_group_envs()
