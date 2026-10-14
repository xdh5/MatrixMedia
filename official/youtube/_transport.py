"""YouTube 请求超时后切换到本机 Clash 代理。"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import httplib2
from google_auth_httplib2 import AuthorizedHttp


class YouTubeHttp(httplib2.Http):
    """每次发布独立维护代理状态，避免修改其他平台的网络配置。"""

    def __init__(self):
        super().__init__(timeout=60)
        self._fallback_active = False

    def request(self, uri, method="GET", body=None, headers=None, **kwargs):
        try:
            return super().request(uri, method=method, body=body, headers=headers, **kwargs)
        except TimeoutError:
            if self._fallback_active:
                raise
            host = "host.docker.internal" if Path("/.dockerenv").exists() else "127.0.0.1"
            proxy_url = os.getenv("YOUTUBE_FALLBACK_PROXY", f"http://{host}:7897").strip()
            if not proxy_url:
                raise
            proxy = urlsplit(proxy_url)
            if proxy.scheme != "http" or not proxy.hostname or not proxy.port:
                raise ValueError("YOUTUBE_FALLBACK_PROXY 必须是带端口的 HTTP 代理地址")
            self.close()
            self.proxy_info = httplib2.ProxyInfo(
                httplib2.socks.PROXY_TYPE_HTTP,
                proxy.hostname,
                proxy.port,
                proxy_user=proxy.username,
                proxy_pass=proxy.password,
            )
            self._fallback_active = True
            print("[YouTube] 请求超时，后续请求切换到 Clash 代理", file=sys.stderr, flush=True)
            # 续传分块超时交回 SDK，先查询服务端偏移，再从同一会话继续上传。
            if method.upper() == "PUT":
                raise
            return super().request(uri, method=method, body=body, headers=headers, **kwargs)


def authorized_http(credentials) -> AuthorizedHttp:
    """令上传、查询、封面、字幕和自动刷新令牌共用超时兜底。"""
    return AuthorizedHttp(credentials, http=YouTubeHttp())
