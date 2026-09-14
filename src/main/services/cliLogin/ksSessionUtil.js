"use strict";

import { session } from "electron";

export const KUAISHOU_CREATOR_ORIGIN = "https://cp.kuaishou.com";

export function normalizeKsPartition(partition) {
  return String(partition || "").trim();
}

export async function getKsUserId(partition) {
  const part = normalizeKsPartition(partition);
  const ses = session.fromPartition(part);
  const cookies = await ses.cookies.get({ url: KUAISHOU_CREATOR_ORIGIN });
  const cookie = cookies.find((item) => item.name === "userId" && item.value);
  return cookie ? cookie.value : null;
}

export async function clearKsSession(partition) {
  const part = normalizeKsPartition(partition);
  const ses = session.fromPartition(part);
  await ses.clearStorageData({
    storages: ["cookies", "localstorage", "indexdb", "serviceworkers"],
  });
  await ses.cookies.flushStore();
  ses.flushStorageData();
}

