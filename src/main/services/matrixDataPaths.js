"use strict";

import fs from "fs";
import path from "path";

function readPackageName(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    return pkg && pkg.name ? String(pkg.name) : "";
  } catch {
    return "";
  }
}

function walkUpForMatrixRoot(start) {
  let current = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (readPackageName(current) === "matrix-video") return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

export const ACCOUNT_GROUPS = new Set(["finance", "korean", "chinese"]);

/** 从命令行取出本次要使用的账号组。登录数据按 data/<账号组>/ 分开存放。 */
export function accountGroupFromArgv(argv = process.argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag !== "--phone" && flag !== "--partition") continue;
    const value = String(args[i + 1] || "").trim();
    if (!value || value.startsWith("-")) continue;
    if (flag === "--phone") {
      const group = value.split("-")[0];
      return ACCOUNT_GROUPS.has(group) ? group : "";
    }
    const stripped = value.replace(/^persist:/, "");
    if (stripped.startsWith("finance")) return "finance";
    if (stripped.startsWith("korean")) return "korean";
  }
  return "";
}

/** 定位 MatrixMedia 项目根目录。 */
export function resolveMatrixRoot(app) {
  const candidates = [];
  if (app && app.isPackaged) {
    candidates.push(path.dirname(process.execPath));
  }
  candidates.push(process.cwd());
  for (const arg of process.argv) {
    if (!arg || arg.startsWith("-")) continue;
    if (arg.endsWith("main.js") || arg.endsWith(".exe") || arg === ".") {
      candidates.push(path.resolve(arg));
    }
  }
  for (const candidate of candidates) {
    const found = walkUpForMatrixRoot(candidate);
    if (found) return found;
  }
  return path.resolve(process.cwd());
}

/**
 * 把本次命令的 Electron 会话固定到 data/<账号组>。
 * 必须在 app ready 之前调用。没有账号组时落在 data 根目录。
 */
export function configureMatrixSessionData(app) {
  const group = accountGroupFromArgv();
  const dataDir = path.join(resolveMatrixRoot(app), "data", group);
  fs.mkdirSync(dataDir, { recursive: true });
  app.setPath("sessionData", dataDir);
  return dataDir;
}
