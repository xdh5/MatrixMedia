import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CliResult {
  exitCode: number;
  jsonLines: unknown[];
  stderr: string;
  lastJson: unknown | null;
}

const VERSION_NOISE = /^\d+\.\d+\.\d+/;
const DEVTOOLS_NOISE = /^DevTools listening/;
const LOG_PREFIX = /^\[[^\]]+\] \[(?:LOG|INFO|WARN|ERROR|DEBUG)\] /;
const TIMEOUT_MS = 2400000;

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  return VERSION_NOISE.test(trimmed) || DEVTOOLS_NOISE.test(trimmed);
}

function stripLogPrefix(line: string): string {
  return line.replace(LOG_PREFIX, '');
}

function stripNoiseLines(raw: string): string {
  return raw
    .split('\n')
    .map((line) => stripLogPrefix(line))
    .filter((line) => !isNoiseLine(line.trim()))
    .join('\n')
    .trim();
}

function tryParseJson(raw: string): unknown | null {
  const cleaned = stripNoiseLines(raw);
  if (cleaned.length === 0) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    /* continue */
  }
  const starts = [cleaned.indexOf('['), cleaned.indexOf('{')].filter((index) => index >= 0);
  if (starts.length === 0) return null;
  const slice = cleaned.slice(Math.min(...starts));
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function todayLogName(): string {
  const date = new Date();
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}.log`;
}

function readElectronLogFile(): string {
  const appData = process.env.APPDATA || '';
  if (!appData) return '';
  const logPath = path.join(appData, 'matrix-video', 'logs', todayLogName());
  try {
    return fs.readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
}

export function extractCliJson(stdout: string, stderr: string): unknown | null {
  const fromStdio = tryParseJson(stdout) ?? tryParseJson(stderr);
  if (fromStdio != null) return fromStdio;
  const logText = readElectronLogFile();
  const fromLog = tryParseJson(logText);
  if (fromLog != null) return fromLog;
  const chunks = logText.split(/(?=^\[[^\]]+\] \[(?:LOG|INFO|WARN|ERROR|DEBUG)\] )/m);
  let found: unknown | null = null;
  for (const chunk of chunks) {
    const parsed = tryParseJson(chunk);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (item) => item && typeof item === 'object' && 'phone' in item && 'pt' in item
      )
    ) {
      if (parsed.length > 0 || found == null) found = parsed;
    }
  }
  return found;
}

export interface RunCliOptions {
  onProgress?: (elapsed: number) => void;
  progressIntervalMs?: number; // default 30000
}

export function resolveCliSpawn(args: string[]): {
  command: string;
  spawnArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
} {
  const defaultDir = path.resolve(
    fileURLToPath(import.meta.url),
    '..', '..', '..'
  );
  const dir = process.env.MATRIXMEDIA_DIR ?? defaultDir;
  const env: NodeJS.ProcessEnv = { ...process.env };

  const localElectronBin = process.platform === 'win32'
    ? path.join(dir, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(dir, 'node_modules', '.bin', 'electron');
  const localRuntimeAvailable = fs.existsSync(localElectronBin);
  let installed = false;
  if (!localRuntimeAvailable) {
    try {
      execSync('which matrixmedia', { stdio: 'pipe' });
      installed = true;
    } catch {
      installed = false;
    }
  }

  if (installed) {
    return { command: 'matrixmedia', spawnArgs: ['cli', ...args], cwd: dir, env };
  }
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') {
      delete env[key];
    }
  }
  return {
    command: localElectronBin,
    // `--` 防止 Chromium 把 --partition / --tags 等 CLI 参数当成浏览器开关并直接崩溃
    spawnArgs: ['.', '--', 'cli', ...args],
    cwd: dir,
    env,
  };
}

export function spawnCli(args: string[]): ChildProcess {
  const { command, spawnArgs, cwd, env } = resolveCliSpawn(args);
  return spawn(command, spawnArgs, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function runCli(args: string[], opts?: RunCliOptions): Promise<CliResult> {
  const { command, spawnArgs, cwd, env } = resolveCliSpawn(args);

  return new Promise<CliResult>((resolve) => {
    const child = spawn(command, spawnArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const startTime = Date.now();
    const interval = opts?.onProgress
      ? setInterval(() => {
          opts.onProgress!(Date.now() - startTime);
        }, opts.progressIntervalMs ?? 30000)
      : null;

    const jsonLines: unknown[] = [];
    let lastJson: unknown | null = null;
    let stdoutRaw = '';   // full stdout accumulated for multi-line JSON
    let stdoutBuf = '';   // line buffer for single-line JSON (publish progress)
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      if (interval) clearInterval(interval);
      resolve({ exitCode: 1, jsonLines, stderr, lastJson });
    }, TIMEOUT_MS);

    const processLine = (line: string): void => {
      const trimmed = stripLogPrefix(line).trim();
      if (trimmed.length === 0) return;
      if (isNoiseLine(trimmed)) return;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        jsonLines.push(parsed);
        lastJson = parsed;
      } catch {
        /* ignore non-JSON lines */
      }
    };

    // Try to parse the entire stdout as a single JSON value (handles multi-line arrays/objects).
    // Falls back to per-line parsing if whole-buffer parse fails.
    const processFullOutput = (raw: string): void => {
      // Strip noise lines before attempting whole-buffer parse
      const cleaned = stripNoiseLines(raw);
      if (cleaned.length === 0) return;
      try {
        const parsed: unknown = JSON.parse(cleaned);
        jsonLines.push(parsed);
        lastJson = parsed;
      } catch {
        // Not valid as a whole -- fall back to per-line
        cleaned.split('\n').forEach(processLine);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdoutRaw += text;
      // Also do live per-line parsing for publish progress events
      stdoutBuf += text;
      let idx = stdoutBuf.indexOf('\n');
      while (idx !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        processLine(line);
        idx = stdoutBuf.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      stderr += String(err.message);
      resolve({ exitCode: 1, jsonLines, stderr: stripNoiseLines(stderr), lastJson });
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      // Re-parse full stdout to catch multi-line JSON arrays (accounts / history)
      // This may add duplicate single-line entries -- reset and reparse cleanly
      jsonLines.length = 0;
      lastJson = null;
      if (stdoutBuf.length > 0) {
        stdoutRaw += stdoutBuf;
        stdoutBuf = '';
      }
      processFullOutput(stdoutRaw);
      if (lastJson == null) {
        lastJson = extractCliJson(stdoutRaw, stderr);
        if (lastJson != null) jsonLines.push(lastJson);
      }
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        jsonLines,
        stderr: stripNoiseLines(stderr),
        lastJson,
      });
    });
  });
}
