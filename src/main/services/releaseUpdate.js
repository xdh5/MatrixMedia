"use strict";

import https from "https";
import { pickReleaseInstaller } from "./pickReleaseInstaller.js";

const version = require("../../../package.json").version;

let _releaseCache = null;
let _releaseCacheAt = 0;
const RELEASE_CACHE_TTL_MS = 60 * 60 * 1000;

function requestGiteeJson(path, fallback) {
  return new Promise((resolve) => {
    const options = {
      hostname: "gitee.com",
      path,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "matrix-video",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          console.warn(`Gitee API ${path} 返回 ${res.statusCode}，跳过解析`);
          resolve(fallback);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          console.warn("Gitee 响应非 JSON，跳过:", data.slice(0, 80));
          resolve(fallback);
        }
      });
    });

    req.on("error", (error) => {
      console.error("Error fetching releases:", error);
      resolve(fallback);
    });

    req.end();
  });
}

async function getLatestRelease() {
  if (_releaseCache !== null && Date.now() - _releaseCacheAt < RELEASE_CACHE_TTL_MS) {
    return _releaseCache;
  }
  const latest = await requestGiteeJson(
    "/api/v5/repos/gzlingyi_0/pubtw/releases/latest",
    null
  );
  if (latest && latest.id) {
    _releaseCache = latest;
    _releaseCacheAt = Date.now();
    return latest;
  }

  const list = await requestGiteeJson(
    "/api/v5/repos/gzlingyi_0/pubtw/releases?page=1&per_page=20&direction=desc",
    []
  );
  const result = Array.isArray(list) && list.length > 0 ? list[0] : null;
  if (result) {
    _releaseCache = result;
    _releaseCacheAt = Date.now();
  }
  return result;
}

function compareSemver(remoteRaw, localRaw) {
  const norm = (s) =>
    String(s || "")
      .replace(/^v/i, "")
      .trim()
      .split(".")
      .map((x) => parseInt(x, 10) || 0);
  const a = norm(remoteRaw);
  const b = norm(localRaw);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i++) {
    const da = a[i] || 0;
    const db = b[i] || 0;
    if (da !== db) {
      return da > db ? 1 : -1;
    }
  }
  return 0;
}

export async function inspectLatestUpdate({ electronApp } = {}) {
  const lastData = await getLatestRelease();
  if (!lastData) {
    return { hasUpdate: false, localVersion: version };
  }
  const remoteVer =
    (lastData.tag_name && String(lastData.tag_name).replace(/^v/i, "")) ||
    (lastData.name && String(lastData.name).replace(/^v/i, ""));
  const cmp = compareSemver(remoteVer, version);
  const assets = lastData.assets || [];
  const installer = pickReleaseInstaller(assets, {
    translated: Boolean(electronApp && electronApp.runningUnderARM64Translation),
  });
  const downloadURL = installer && installer.browser_download_url;
  return {
    hasUpdate: Boolean(downloadURL && cmp > 0),
    localVersion: version,
    remoteVersion: remoteVer || "",
    downloadURL: downloadURL || null,
    releaseTitle: lastData.name || lastData.tag_name || "",
    releaseNotes: lastData.body || "",
  };
}
