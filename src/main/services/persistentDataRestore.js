"use strict";

const fs = require("fs");
const path = require("path");

const PERSISTENT_DATA_ROOT = "MatrixMedia";

function dirHasJsonRecords(dir) {
  try {
    if (!fs.existsSync(dir)) return false;
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .some((name) => {
        const raw = fs.readFileSync(path.join(dir, name), "utf-8");
        const payload = JSON.parse(raw);
        return Array.isArray(payload)
          ? payload.length > 0
          : Boolean(payload && Object.keys(payload).length);
      });
  } catch {
    return false;
  }
}

function copyTree(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  for (const name of fs.readdirSync(fromDir)) {
    const from = path.join(fromDir, name);
    const to = path.join(toDir, name);
    if (fs.statSync(from).isDirectory()) {
      copyTree(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function documentsDataDir(app) {
  return path.join(app.getPath("documents"), PERSISTENT_DATA_ROOT, "data");
}

function backupDataDir(app) {
  return path.join(app.getPath("documents"), PERSISTENT_DATA_ROOT, "backup", "data");
}

function legacyUserDataDir(app) {
  return path.join(app.getPath("userData"), "data");
}

/** 安装前把业务数据备份到「文档/MatrixMedia/backup/data」，重装后可恢复账号组。 */
function backupPersistentDataBeforeInstall(app) {
  if (!app || typeof app.getPath !== "function") return { backedUp: false };
  const source = documentsDataDir(app);
  if (!fs.existsSync(source)) return { backedUp: false, reason: "source_missing" };
  const target = backupDataDir(app);
  if (path.resolve(source) === path.resolve(target)) {
    return { backedUp: false, reason: "same_path" };
  }
  fs.rmSync(target, { recursive: true, force: true });
  copyTree(source, target);
  return { backedUp: true, target };
}

/** 重装后若当前 data/account 为空，尝试从备份或旧 userData 恢复账号组配置。 */
function restoreAccountGroupsIfNeeded(app, dataDir) {
  if (!app || typeof app.getPath !== "function" || !dataDir) {
    return { restored: false, reason: "invalid_args" };
  }
  const accountDir = path.join(dataDir, "account");
  if (dirHasJsonRecords(accountDir)) {
    return { restored: false, reason: "already_present" };
  }

  const candidates = [
    path.join(backupDataDir(app), "account"),
    path.join(legacyUserDataDir(app), "account"),
    path.join(documentsDataDir(app), "account"),
  ];

  for (const source of candidates) {
    if (path.resolve(source) === path.resolve(accountDir)) continue;
    if (!dirHasJsonRecords(source)) continue;
    fs.mkdirSync(accountDir, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      if (!name.endsWith(".json")) continue;
      fs.copyFileSync(path.join(source, name), path.join(accountDir, name));
    }
    console.log(`MatrixMedia: 已从 ${source} 恢复账号组配置`);
    return { restored: true, source };
  }

  return { restored: false, reason: "not_found" };
}

module.exports = {
  backupPersistentDataBeforeInstall,
  restoreAccountGroupsIfNeeded,
};
