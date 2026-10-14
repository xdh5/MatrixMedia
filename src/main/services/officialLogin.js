"use strict";

import crypto from "crypto";
import fs from "fs";
import http from "http";
import { spawn } from "child_process";
import axios from "axios";
import { groupEnvPrefix, readGroupEnv, upsertGroupEnv } from "./groupEnv";

const YOUTUBE_PORT = 18765;
const ZERNIO_PORT = 18766;
const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];
const ZERNIO_API = "https://zernio.com/api/v1";

const ZERNIO_PLATFORM = {
  tiktok: {
    api: "tiktok",
    keyName: "ZERNIO_API_KEY",
    fallbackKeys: ["zernio_api_key"],
    idSuffix: "_TIKTOK_ACCOUNT_ID",
    titleSuffix: "_TIKTOK_ACCOUNT_TITLE",
    usernameSuffix: "_TIKTOK_USERNAME",
  },
  instagram: {
    api: "instagram",
    keyName: "zernio_api_key_meta",
    fallbackKeys: [],
    idSuffix: "_INSTAGRAM_ACCOUNT_ID",
    titleSuffix: "_INSTAGRAM_ACCOUNT_TITLE",
    usernameSuffix: "_INSTAGRAM_USERNAME",
  },
  facebook: {
    api: "facebook",
    keyName: "zernio_api_key_meta",
    fallbackKeys: [],
    idSuffix: "_FACEBOOK_ACCOUNT_ID",
    titleSuffix: "_FACEBOOK_PAGE_NAME",
    usernameSuffix: "_FACEBOOK_USERNAME",
  },
};

function openSystemBrowser(url) {
  const candidates = [
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ].filter(Boolean);
  for (const exe of candidates) {
    if (fs.existsSync(exe)) {
      spawn(exe, [url], { detached: true, stdio: "ignore" }).unref();
      return exe;
    }
  }
  spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  return "default";
}

function startCallbackServer(port, timeoutMs, isDone) {
  let markReady;
  let markReadyFailed;
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    markReadyFailed = reject;
  });
  const done = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const full = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      const body = Buffer.from("<!doctype html><meta charset=utf-8><p>授权已返回，可以关闭此页面。</p>", "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": body.length,
      });
      res.end(body);
      if (!isDone(full)) return;
      clearTimeout(timer);
      server.close();
      resolve(full);
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`等待授权超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);
    server.on("error", (error) => {
      clearTimeout(timer);
      markReadyFailed(error);
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => markReady());
  });
  done.catch(() => {});
  return { ready, done };
}

function readClientSecretFile(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const client = payload.installed || payload.web || {};
  const clientId = String(client.client_id || "").trim();
  const clientSecret = String(client.client_secret || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("client secret 文件里没有 client_id 或 client_secret");
  }
  return { clientId, clientSecret };
}

async function loginYouTube(options) {
  const group = String(options.phone || "").trim();
  const prefix = groupEnvPrefix(group);
  const current = readGroupEnv(group);
  let clientId = current.YOUTUBE_OAUTH_CLIENT_ID || "";
  let clientSecret = current.YOUTUBE_OAUTH_CLIENT_SECRET || "";
  if (options.clientSecretPath) {
    const loaded = readClientSecretFile(options.clientSecretPath);
    clientId = loaded.clientId;
    clientSecret = loaded.clientSecret;
  }
  if (!clientId || !clientSecret) {
    throw new Error("缺少 YouTube OAuth 客户端。请先放入账号组 .env，或用 --client-secret 指定 Google 客户端 JSON。");
  }

  const redirectUri = `http://127.0.0.1:${YOUTUBE_PORT}/`;
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const session = startCallbackServer(
    YOUTUBE_PORT,
    options.timeoutMs || 600000,
    (url) => url.searchParams.has("code") || url.searchParams.has("error")
  );
  await session.ready;
  const browser = openSystemBrowser(authUrl.toString());
  console.log(`已打开系统浏览器：${browser}`);
  console.log("请用要绑定到该账号组的 Google 账号登录并允许。");
  const callback = await session.done;
  const oauthError = callback.searchParams.get("error");
  if (oauthError) {
    throw new Error(`Google 授权失败：${oauthError}`);
  }
  const tokenResponse = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      code: callback.searchParams.get("code"),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 30000 }
  );
  const accessToken = String(tokenResponse.data.access_token || "");
  const refreshToken = String(tokenResponse.data.refresh_token || current[`${prefix}_YOUTUBE_REFRESH_TOKEN`] || "");
  if (!refreshToken) {
    throw new Error("这次授权没有返回 refresh_token。请在 Google 账号里撤掉该应用权限后重试。");
  }
  const channelResponse = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
    params: { part: "id,snippet", mine: true },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 30000,
  });
  const channels = (channelResponse.data.items || []).map((item) => ({
    id: item.id,
    title: item.snippet && item.snippet.title ? item.snippet.title : "",
  }));
  if (!channels.length) {
    throw new Error("这个 Google 账号下没有 YouTube 频道。");
  }
  const preferred = current[`${prefix}_YOUTUBE_CHANNEL_ID`];
  const channel = channels.find((item) => item.id === preferred) || channels[0];
  const file = upsertGroupEnv(group, {
    YOUTUBE_OAUTH_CLIENT_ID: clientId,
    YOUTUBE_OAUTH_CLIENT_SECRET: clientSecret,
    [`${prefix}_YOUTUBE_CHANNEL_ID`]: channel.id,
    [`${prefix}_YOUTUBE_CHANNEL_TITLE`]: channel.title,
    [`${prefix}_YOUTUBE_REFRESH_TOKEN`]: refreshToken,
    [`${prefix}_YOUTUBE_TOKEN`]: accessToken,
  });
  console.log(`YouTube 已写入账号组 ${group}：${channel.title}（${channel.id}）`);
  if (channels.length > 1) {
    console.log("该 Google 账号还有其他频道：" + channels.map((item) => item.title).join("、"));
  }
  console.log(`凭据文件：${file}`);
  return 0;
}

function zernioKey(env, spec, override) {
  if (override) return String(override).trim();
  if (env[spec.keyName]) return env[spec.keyName];
  for (const name of spec.fallbackKeys) {
    if (env[name]) return env[name];
  }
  return "";
}

async function zernioProfileId(apiKey, current, override) {
  if (override) return String(override).trim();
  if (current.ZERNIO_PROFILE_ID) return current.ZERNIO_PROFILE_ID;
  const response = await axios.get(`${ZERNIO_API}/profiles`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 30000,
  });
  const payload = response.data || {};
  const list = payload.profiles || payload.data || (Array.isArray(payload) ? payload : []);
  const ids = list
    .map((item) => String((item && (item._id || item.id || item.profileId)) || "").trim())
    .filter(Boolean);
  if (ids.length === 1) return ids[0];
  if (!ids.length) throw new Error("Zernio 没有可用的 profile。");
  throw new Error("Zernio 有多个 profile，请用 --profile 指定。");
}

async function loginZernio(platform, options) {
  const spec = ZERNIO_PLATFORM[platform];
  const group = String(options.phone || "").trim();
  const prefix = groupEnvPrefix(group);
  const current = readGroupEnv(group);
  const apiKey = zernioKey(current, spec, options.apiKey);
  if (!apiKey) {
    throw new Error(`缺少 ${spec.keyName}。请先写入账号组 .env，或用 --api-key 传入。`);
  }
  const profileId = await zernioProfileId(apiKey, current, options.profile);
  const redirectUrl = `http://127.0.0.1:${ZERNIO_PORT}/`;
  const connect = await axios.get(`${ZERNIO_API}/connect/${spec.api}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    params: { profileId, redirect_url: redirectUrl },
    timeout: 30000,
  });
  const authUrl = String((connect.data && (connect.data.authUrl || connect.data.url)) || "");
  if (!authUrl) throw new Error("Zernio 没有返回授权地址。");

  const session = startCallbackServer(
    ZERNIO_PORT,
    options.timeoutMs || 600000,
    (url) => url.searchParams.has("accountId") || url.searchParams.has("error")
  );
  await session.ready;
  const browser = openSystemBrowser(authUrl);
  console.log(`已打开系统浏览器：${browser}`);
  console.log(`请在官方页面完成 ${platform} 授权。`);
  const callback = await session.done;
  const oauthError = callback.searchParams.get("error");
  if (oauthError) {
    const message = callback.searchParams.get("error_message") || oauthError;
    throw new Error(`Zernio 授权失败：${message}`);
  }
  const accountId = callback.searchParams.get("accountId");
  const listed = await axios.get(`${ZERNIO_API}/accounts`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    params: { platform: spec.api, status: "connected" },
    timeout: 30000,
  });
  const accounts = (listed.data && listed.data.accounts) || [];
  const matched = accounts.find((item) => String(item._id || item.id || "") === accountId) || {};
  const title = String(matched.displayName || matched.username || callback.searchParams.get("username") || "");
  const username = String(matched.username || callback.searchParams.get("username") || "");
  const updates = {
    [spec.keyName]: apiKey,
    ZERNIO_PROFILE_ID: profileId,
    [`${prefix}${spec.idSuffix}`]: accountId,
  };
  if (title) updates[`${prefix}${spec.titleSuffix}`] = title;
  if (username) updates[`${prefix}${spec.usernameSuffix}`] = username;
  const file = upsertGroupEnv(group, updates);
  console.log(`${platform} 已写入账号组 ${group}：${title || username || "已连接"}`);
  console.log(`凭据文件：${file}`);
  return 0;
}

export async function runOfficialLogin(options) {
  if (options.platform === "youtube") return loginYouTube(options);
  if (ZERNIO_PLATFORM[options.platform]) return loginZernio(options.platform, options);
  throw new Error(`不支持的官方登录平台：${options.platform}`);
}
