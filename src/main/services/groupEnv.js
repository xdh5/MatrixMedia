"use strict";

import fs from "fs";
import path from "path";
import { resolveMatrixRoot } from "./matrixDataPaths";

/** 账号组名称转成环境变量前缀，例如 chinese → CHINESE。 */
export function groupEnvPrefix(group) {
  return String(group || "").trim().toUpperCase();
}

export function groupEnvPath(group, app) {
  return path.join(resolveMatrixRoot(app), "data", String(group || "").trim(), ".env");
}

export function readGroupEnv(group, app) {
  const file = groupEnvPath(group, app);
  const values = {};
  if (!fs.existsSync(file)) return values;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

/** 按键更新账号组 .env，不改动其余行。 */
export function upsertGroupEnv(group, updates, app) {
  const file = groupEnvPath(group, app);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const pending = { ...updates };
  const output = [];
  for (const line of existing) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf("=");
    const key = eq > 0 && !trimmed.startsWith("#") ? trimmed.slice(0, eq).trim() : "";
    if (key && Object.prototype.hasOwnProperty.call(pending, key)) {
      output.push(`${key}=${pending[key]}`);
      delete pending[key];
    } else {
      output.push(line);
    }
  }
  const extra = Object.keys(pending);
  if (extra.length) {
    if (output.length && output[output.length - 1] !== "") output.push("");
    for (const key of extra) output.push(`${key}=${pending[key]}`);
  }
  while (output.length && output[output.length - 1] === "") output.pop();
  fs.writeFileSync(file, output.join("\n") + "\n", "utf8");
  return file;
}
