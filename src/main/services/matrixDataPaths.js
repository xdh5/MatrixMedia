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

/** 定位 MatrixMedia 项目根目录，Cookie 写到该目录下的 data。 */
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

function directoryHasEntries(dir) {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function migratePartitions(fromSessionData, toSessionData) {
  const source = path.join(fromSessionData, "Partitions");
  const target = path.join(toSessionData, "Partitions");
  if (path.resolve(source) === path.resolve(target)) return;
  if (!directoryHasEntries(source) || directoryHasEntries(target)) return;
  fs.cpSync(source, target, { recursive: true });
  console.info(`MatrixMedia: 已将登录 Cookie 迁移到 ${target}`);
}

/**
 * 把 Electron 会话（persist partition 的 Cookie）固定到 MatrixMedia/data。
 * 必须在 app ready 之前调用。
 */
export function configureMatrixSessionData(app) {
  const legacySessionData = app.getPath("sessionData");
  const dataDir = path.join(resolveMatrixRoot(app), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    migratePartitions(legacySessionData, dataDir);
  } catch (error) {
    console.error("MatrixMedia: 迁移旧 Cookie 失败", error && error.message ? error.message : error);
  }
  app.setPath("sessionData", dataDir);
  return dataDir;
}
