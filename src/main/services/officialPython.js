"use strict";

import { spawnSync } from "child_process";
import path from "path";
import { resolveMatrixRoot } from "./matrixDataPaths";

const OFFICIAL_PLATFORMS = new Set(["youtube", "yt", "ytb", "tiktok", "tk", "instagram", "ig", "ins", "facebook", "fb"]);

export function isOfficialPlatform(value) {
  return OFFICIAL_PLATFORMS.has(String(value || "").trim().toLowerCase());
}

export function officialPlatformFromArgv(argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "-p" && args[i] !== "--platform") continue;
    return args[i + 1] || "";
  }
  return "";
}

function pythonArgs(args) {
  const command = process.env.MATRIXMEDIA_PYTHON || "python";
  if (command === "py") return { command, args: ["-3", "-m", "platform_api.cli", ...args] };
  return { command, args: ["-m", "platform_api.cli", ...args] };
}

/** 调用 python/platform_api，返回解析后的 JSON。 */
export function runOfficialPython(args) {
  const root = resolveMatrixRoot();
  const spec = pythonArgs(args);
  const pythonDir = path.join(root, "python");
  const currentPath = process.env.PYTHONPATH;
  const result = spawnSync(spec.command, spec.args, {
    cwd: root,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONPATH: currentPath ? `${pythonDir}${path.delimiter}${currentPath}` : pythonDir,
    },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`无法启动 Python：${result.error.message}`);
  }
  const stdout = String(result.stdout || "").trim();
  const line = stdout.split(/\r?\n/).filter(Boolean).pop() || "";
  let payload = null;
  try {
    payload = line ? JSON.parse(line) : null;
  } catch {
    payload = null;
  }
  if (result.status !== 0) {
    const message = payload && payload.error ? payload.error : String(result.stderr || "").trim();
    throw new Error(message || "官方平台命令失败");
  }
  if (payload == null) {
    throw new Error(String(result.stderr || "").trim() || "官方平台命令没有返回 JSON");
  }
  if (payload.error) throw new Error(payload.error);
  return payload;
}
