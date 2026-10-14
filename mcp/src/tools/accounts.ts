import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { runMatrixPublish } from "../runner.js";

export const listAccountsTool: Tool = {
  name: "list_accounts",
  description:
    "列出 data 目录里的账号组及其平台账号。浏览器平台来自 data/<账号组>/Partitions，" +
    "YouTube、TikTok、Instagram、Facebook 来自该账号组的官方凭据。结果与统一发布使用同一份 publishing。",
  inputSchema: {
    type: "object",
    properties: {
      account_group: {
        type: "string",
        enum: ["finance", "korean", "chinese"],
        description: "可选。只看某一个账号组；不传则列出 data 里现有的全部账号组",
      },
      platform: {
        type: "string",
        description:
          "可选平台过滤。国内：douyin / kuaishou / toutiao / wechat_channels / baijiahao / bilibili / xiaohongshu；海外：youtube / tiktok / instagram / facebook",
      },
    },
    required: [],
  },
};

export async function handleListAccounts(args: Record<string, unknown>): Promise<string> {
  const cliArgs = ["accounts"];
  const accountGroup = args.account_group == null ? "" : String(args.account_group).trim();
  const platform = args.platform == null ? "" : String(args.platform).trim();
  if (accountGroup) cliArgs.push("--group", accountGroup);
  if (platform) cliArgs.push("--platform", platform);
  const result = await runMatrixPublish(cliArgs, { timeoutMs: 120_000 });
  if (result.exitCode !== 0) {
    const payload = result.lastJson;
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error || "")
      : result.stderr;
    throw new Error(message || "读取账号组失败");
  }
  return JSON.stringify(result.lastJson);
}
