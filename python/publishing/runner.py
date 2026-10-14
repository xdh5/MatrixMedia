"""启动矩媒浏览器发布，并解析命令输出。"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

TIMEOUT_SECONDS = 2400


def matrix_root() -> Path:
    return Path(__file__).resolve().parents[2]


def electron_command() -> tuple[list[str], Path]:
    root = matrix_root()
    configured = os.getenv("MATRIXMEDIA_EXECUTABLE", "").strip()
    if configured:
        executable = Path(configured).expanduser()
        if not executable.is_file():
            raise RuntimeError(f"MATRIXMEDIA_EXECUTABLE 指向的文件不存在：{executable}")
        return [str(executable), "cli"], root
    electron = root / "node_modules" / "electron" / "dist" / "electron.exe"
    built_main = root / "dist" / "electron" / "main.js"
    if electron.is_file() and built_main.is_file():
        return [str(electron), "--no-sandbox", "--disable-gpu", ".", "--", "cli"], root
    installed = shutil.which("matrixmedia")
    if installed:
        return [installed, "cli"], root
    local_app_data = Path(os.getenv("LOCALAPPDATA", ""))
    installed_executable = local_app_data / "Programs" / "matrixmedia" / "matrixmedia.exe"
    if installed_executable.is_file():
        return [str(installed_executable), "cli"], root
    raise RuntimeError("找不到 MatrixMedia CLI。请设置 MATRIXMEDIA_EXECUTABLE，或安装 matrixmedia 命令")


def _last_json(text: str):
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    for line in reversed(lines):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    raw = str(text or "")
    starts = [index for index in (raw.find("["), raw.find("{")) if index >= 0]
    if not starts:
        return None
    try:
        return json.loads(raw[min(starts):])
    except json.JSONDecodeError:
        return None


def _latest_log() -> Path | None:
    log_dir = Path(os.getenv("APPDATA", "")) / "matrix-video" / "logs"
    if not log_dir.is_dir():
        return None
    files = [item for item in log_dir.glob("*.log") if item.is_file()]
    return max(files, key=lambda item: item.stat().st_mtime) if files else None


def _last_log_json(text: str):
    chunks = []
    current = []
    prefix = re.compile(r"^\[[^\]]+\] \[(?:LOG|INFO|WARN|ERROR|DEBUG)\] ?")
    for line in str(text or "").splitlines():
        if prefix.match(line):
            if current:
                chunks.append("\n".join(current).strip())
            current = [prefix.sub("", line)]
        elif current:
            current.append(line)
    if current:
        chunks.append("\n".join(current).strip())
    for chunk in reversed(chunks):
        try:
            return json.loads(chunk)
        except json.JSONDecodeError:
            continue
    return None


def run_browser_publish(arguments: list[str]) -> dict:
    prefix, cwd = electron_command()
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    log_path = _latest_log()
    log_offset = log_path.stat().st_size if log_path else 0
    try:
        result = subprocess.run(
            [*prefix, *arguments],
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"运行 MatrixMedia CLI 失败：{exc}") from exc
    payload = _last_json(result.stdout) or _last_json(result.stderr)
    latest = _latest_log()
    if payload is None and latest:
        try:
            with latest.open("r", encoding="utf-8", errors="replace") as stream:
                if latest == log_path:
                    stream.seek(log_offset)
                payload = _last_log_json(stream.read())
        except OSError:
            payload = None
    if result.returncode != 0:
        message = ""
        if isinstance(payload, dict):
            message = str(payload.get("message") or payload.get("error") or "")
        detail = message or str(result.stderr or "")[-500:]
        raise RuntimeError(f"MatrixMedia CLI 返回失败（退出码 {result.returncode}）：{detail}")
    if not isinstance(payload, dict):
        raise RuntimeError("MatrixMedia 发布结果不是 JSON 对象")
    return payload


def python_command() -> list[str]:
    command = os.getenv("MATRIXMEDIA_PYTHON", "").strip() or sys.executable
    if Path(command).name.lower() == "py":
        return [command, "-3"]
    return [command]
