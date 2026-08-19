import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { runCli } from '../runner.js';

export const listHistoryTool: Tool = {
  name: 'list_history',
  description: 'Query MatrixMedia local publish history. Returns JSON array.',
  inputSchema: {
    type: 'object',
    properties: {
      days: {
        type: 'number',
        description: 'Last N days, default 7',
      },
      platform: {
        type: 'string',
        enum: ['dy', 'ks', 'blbl', 'bjh', 'tt', 'sph', 'xhs'],
      },
      status: {
        type: 'string',
        enum: ['success', 'failed', 'publishing', 'scheduled'],
      },
      all: {
        type: 'boolean',
        description: 'Return all history regardless of date range (omits --days)',
      },
    },
    required: [],
  },
};

export async function handleListHistory(
  args: Record<string, unknown>
): Promise<string> {
  const cliArgs: string[] = ['history', '--json'];

  const all = args.all;
  const days = args.days;
  const platform = args.platform;
  const status = args.status;

  if (all === true) {
    // no --days flag: CLI defaults to returning all records
  } else if (days !== undefined && days !== null) {
    cliArgs.push('--days', String(days));
  }

  if (platform !== undefined && platform !== null) {
    cliArgs.push('-p', String(platform));
  }

  if (status !== undefined && status !== null) {
    cliArgs.push('--status', String(status));
  }

  const result = await runCli(cliArgs);
  if (result.exitCode === 0) {
    if (result.lastJson == null) {
      throw new Error(
        'list_history 没有从 stdout 读到记录 JSON。矩媒可能把结果写进了主进程日志。请重新编译 Electron 主进程后再试。' +
          (result.stderr ? ` stderr: ${result.stderr.slice(0, 400)}` : '')
      );
    }
    return JSON.stringify(result.lastJson);
  }
  throw new Error(
    'list_history failed (exit ' + String(result.exitCode) + '): ' + result.stderr
  );
}
