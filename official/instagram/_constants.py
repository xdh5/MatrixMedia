"""Zernio Instagram 发布常量。"""

ZERNIO_API_BASE_URL = "https://zernio.com/api/v1"
ZERNIO_META_API_KEY_ENV = "zernio_api_key_meta"
INSTAGRAM_REQUEST_TIMEOUT_SECONDS = 120
INSTAGRAM_STATUS_POLL_INTERVAL_SECONDS = 2
INSTAGRAM_STATUS_TIMEOUT_SECONDS = 180
INSTAGRAM_SUCCESS_STATUSES = frozenset({"published", "success"})
INSTAGRAM_FAILURE_STATUSES = frozenset({"failed", "cancelled", "canceled"})


def load_project_env() -> None:
    from ..group_env import load_matrix_group_envs

    load_matrix_group_envs()
