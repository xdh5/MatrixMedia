"use strict";

import { session } from "electron";

export function normalizeTtPartition(partition) {
  return String(partition || "").trim();
}

export async function hasToutiaoSession(partition) {
  const part = normalizeTtPartition(partition);
  const ses = session.fromPartition(part);
  const cookies = await ses.cookies.get({});
  return cookies.some(
    (item) => item.name === "odin_tt" && item.value && item.value.length > 65
  );
}

export async function clearTtSession(partition) {
  const part = normalizeTtPartition(partition);
  const ses = session.fromPartition(part);
  await ses.clearStorageData({
    storages: ["cookies", "localstorage", "indexdb", "serviceworkers"],
  });
  await ses.cookies.flushStore();
  ses.flushStorageData();
}
