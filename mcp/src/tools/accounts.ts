import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { runCli } from '../runner.js';

export const listAccountsTool: Tool = {
  name: 'list_accounts',
  description:
    'List MatrixMedia locally logged-in accounts. Returns JSON array with phone/platform/partition fields.',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        enum: ['dy', 'ks', 'blbl', 'bjh', 'tt', 'sph', 'xhs', 'juejin', 'fqsp'],
        description:
          'Optional platform filter. dy=Douyin ks=Kuaishou blbl=Bilibili bjh=Baijiahao tt=Toutiao sph=Shipinhao xhs=Xiaohongshu juejin=Juejin fqsp=Fanqie video (番茄视频, config only)',
      },
    },
    required: [],
  },
};

export async function handleListAccounts(
  args: Record<string, unknown>
): Promise<string> {
  const platform = args.platform;
  const cliArgs: string[] = [
    'accounts',
    '--json',
    ...(platform !== undefined && platform !== null
      ? ['-p', String(platform)]
      : []),
  ];

  const result = await runCli(cliArgs);
  if (result.exitCode === 0) {
    if (result.lastJson == null) {
      throw new Error(
        'list_accounts 没有从 stdout 读到账号 JSON。矩媒可能把结果写进了主进程日志。请重新编译 Electron 主进程后再试。' +
          (result.stderr ? ` stderr: ${result.stderr.slice(0, 400)}` : '')
      );
    }
    return JSON.stringify(result.lastJson);
  }
  throw new Error(
    'list_accounts failed (exit ' + String(result.exitCode) + '): ' + result.stderr
  );
}
