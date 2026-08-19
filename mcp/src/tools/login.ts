import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { spawnCli } from "../runner.js";

const LOGIN_PLATFORMS = ["dy", "sph"] as const;
type LoginPlatform = (typeof LOGIN_PLATFORMS)[number];

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type LoginSession = {
  loginId: string;
  platform: LoginPlatform;
  phone: string;
  qrPath: string;
  child: ChildProcess;
  exitCode: number | null;
  stderr: string;
};

const sessions = new Map<string, LoginSession>();

function asNonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} 不能为空`);
  }
  return value.trim();
}

function asPlatform(value: unknown): LoginPlatform {
  const platform = asNonEmpty(value, "platform");
  if (platform !== "dy" && platform !== "sph") {
    throw new Error(
      "login 目前只支持抖音 dy 和视频号 sph。其它平台请在矩媒 GUI 里扫码登录后再 publish_video。"
    );
  }
  return platform;
}

function makeLoginId(platform: string, phone: string): string {
  return `${platform}:${phone}`;
}

function qrPathFor(loginId: string): string {
  const safe = loginId.replace(/[^A-Za-z0-9._-]+/g, "_");
  return path.join(os.tmpdir(), `matrixmedia-login-${safe}.png`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readQrImage(filePath: string): McpContent | null {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 80) {
      return null;
    }
    const data = fs.readFileSync(filePath).toString("base64");
    return { type: "image", data, mimeType: "image/png" };
  } catch {
    return null;
  }
}

function stopSession(loginId: string): void {
  const session = sessions.get(loginId);
  if (!session) {
    return;
  }
  try {
    if (session.exitCode === null) {
      session.child.kill("SIGTERM");
    }
  } catch {
    /* ignore */
  }
  sessions.delete(loginId);
}

function attachSession(session: LoginSession): void {
  session.child.stderr?.on("data", (chunk: Buffer) => {
    session.stderr += chunk.toString("utf8");
  });
  session.child.on("close", (code) => {
    session.exitCode = typeof code === "number" ? code : 1;
  });
}

function payload(session: LoginSession, status: string, extra: Record<string, unknown> = {}) {
  return {
    status,
    login_id: session.loginId,
    platform: session.platform,
    phone: session.phone,
    qr_path: session.qrPath,
    message:
      status === "waiting_scan"
        ? "请把返回的二维码图片发给用户，用对应 App 扫码。扫完后调用 login_status。"
        : extra.message,
    ...extra,
  };
}

function withQr(session: LoginSession, text: string): McpContent[] {
  const image = readQrImage(session.qrPath);
  return image ? [image, { type: "text", text }] : [{ type: "text", text }];
}

export const loginTool: Tool = {
  name: "login",
  description:
    "打开抖音或视频号扫码登录页，截取二维码图片返回给 Agent。Agent 必须把图片发给用户扫码，然后用 login_status 查询，直到 success 再 publish_video。" +
    "仅支持 platform=dy / sph。其它平台请让用户在矩媒 GUI 登录。",
  inputSchema: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["dy", "sph"],
        description: "dy=抖音，sph=视频号",
      },
      phone: {
        type: "string",
        description: "账号手机号或账号组名，须与 list_accounts / publish_video 的 phone 一致",
      },
      timeoutSec: {
        type: "number",
        description: "等待扫码的最长秒数，默认 900",
      },
    },
    required: ["platform", "phone"],
  },
};

export const loginStatusTool: Tool = {
  name: "login_status",
  description:
    "查询 login 扫码结果。waiting_scan 时把最新二维码再发给用户；success 后才能 publish_video。",
  inputSchema: {
    type: "object",
    properties: {
      login_id: {
        type: "string",
        description: "login 返回的 login_id",
      },
    },
    required: ["login_id"],
  },
};

export async function handleLogin(args: Record<string, unknown>): Promise<McpContent[]> {
  const platform = asPlatform(args.platform);
  const phone = asNonEmpty(args.phone, "phone");
  const timeoutSec =
    typeof args.timeoutSec === "number" && Number.isFinite(args.timeoutSec)
      ? Math.max(30, Math.floor(args.timeoutSec))
      : 900;
  const loginId = makeLoginId(platform, phone);
  stopSession(loginId);

  const qrFile = qrPathFor(loginId);
  try {
    fs.unlinkSync(qrFile);
  } catch {
    /* ignore */
  }

  const child = spawnCli([
    "login",
    "-p",
    platform,
    "--phone",
    phone,
    "--save-qr-png",
    qrFile,
    "--timeout-sec",
    String(timeoutSec),
  ]);
  const session: LoginSession = {
    loginId,
    platform,
    phone,
    qrPath: qrFile,
    child,
    exitCode: null,
    stderr: "",
  };
  attachSession(session);
  sessions.set(loginId, session);

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (session.exitCode === 0) {
      sessions.delete(loginId);
      return [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            login_id: loginId,
            platform,
            phone,
            message: "该账号已登录，无需扫码，可直接 publish_video",
          }),
        },
      ];
    }
    if (session.exitCode !== null) {
      sessions.delete(loginId);
      throw new Error(
        `打开登录页失败（exit ${session.exitCode}）：${session.stderr.slice(0, 400) || "请检查矩媒是否已安装并可运行 cli login"}`
      );
    }
    const image = readQrImage(qrFile);
    if (image) {
      return withQr(
        session,
        JSON.stringify(payload(session, "waiting_scan"))
      );
    }
    await sleep(400);
  }

  stopSession(loginId);
  throw new Error(
    "90 秒内没有截到登录二维码。请确认本机可运行矩媒 cli login，或让用户在 GUI 里登录。"
  );
}

export async function handleLoginStatus(args: Record<string, unknown>): Promise<McpContent[]> {
  const loginId = asNonEmpty(args.login_id, "login_id");
  const session = sessions.get(loginId);
  if (!session) {
    throw new Error(`没有进行中的登录：${loginId}。请先调用 login。`);
  }
  if (session.exitCode === 0) {
    sessions.delete(loginId);
    return [
      {
        type: "text",
        text: JSON.stringify({
          status: "success",
          login_id: loginId,
          platform: session.platform,
          phone: session.phone,
          message: "扫码登录成功，可以 publish_video",
        }),
      },
    ];
  }
  if (session.exitCode !== null) {
    sessions.delete(loginId);
    const detail = session.stderr.slice(0, 400);
    throw new Error(
      session.exitCode === 3
        ? `扫码超时或仍未登录：${detail || "请让用户重新扫码"}`
        : `登录失败（exit ${session.exitCode}）：${detail}`
    );
  }
  return withQr(
    session,
    JSON.stringify(payload(session, "waiting_scan"))
  );
}
