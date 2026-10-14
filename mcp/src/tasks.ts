/** 后台发布任务。一次发布可能跨多个平台，不能放在单次 MCP 调用里同步等待。 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface TaskRecord {
  task_id: string;
  task_path: string;
  status: "running" | "succeeded" | "failed";
  step: string;
  progress: string;
  result: unknown;
  error: string;
  started_at: string;
  finished_at: string;
  done: boolean;
}

const livePaths = new Set<string>();
const liveKeys = new Map<string, string>();

function tasksDir(): string {
  const dir = path.join(os.tmpdir(), "matrixmedia-mcp", "tasks");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function writeRecord(record: TaskRecord): void {
  fs.writeFileSync(record.task_path, JSON.stringify(record, null, 2), "utf8");
}

function readRecord(taskPath: string): TaskRecord | null {
  try {
    const raw = fs.readFileSync(taskPath, "utf8");
    const parsed = JSON.parse(raw) as TaskRecord;
    if (!parsed || typeof parsed !== "object" || !parsed.task_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function submitTask(
  key: string,
  step: string,
  work: (progress: (text: string) => void) => Promise<unknown>,
): { task_path: string; task_id: string; poll_tool: "poll_task" } {
  const existingPath = liveKeys.get(key);
  if (existingPath && livePaths.has(existingPath)) {
    throw new Error(`已有进行中的任务：${existingPath}。请用 poll_task 轮询，不要重复启动`);
  }
  const taskId = `task-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const taskPath = path.join(tasksDir(), `${taskId}.json`);
  const record: TaskRecord = {
    task_id: taskId,
    task_path: taskPath,
    status: "running",
    step,
    progress: "已启动",
    result: null,
    error: "",
    started_at: nowIso(),
    finished_at: "",
    done: false,
  };
  writeRecord(record);
  livePaths.add(taskPath);
  liveKeys.set(key, taskPath);
  void work((text) => {
    const current = readRecord(taskPath);
    if (!current || current.status !== "running") return;
    current.progress = text;
    writeRecord(current);
  }).then((result) => {
    const current = readRecord(taskPath) ?? record;
    const outcome = result && typeof result === "object" && "status" in result
      ? String((result as { status?: unknown }).status)
      : "";
    current.status = outcome === "failed" ? "failed" : "succeeded";
    current.result = result;
    current.error = outcome === "failed" ? "全部平台发布失败" : "";
    current.progress = outcome === "failed" ? "失败" : "完成";
    current.finished_at = nowIso();
    current.done = true;
    writeRecord(current);
  }).catch((error: unknown) => {
    const current = readRecord(taskPath) ?? record;
    current.status = "failed";
    current.error = error instanceof Error ? error.message : String(error);
    current.progress = "失败";
    current.finished_at = nowIso();
    current.done = true;
    writeRecord(current);
  }).finally(() => {
    livePaths.delete(taskPath);
    if (liveKeys.get(key) === taskPath) liveKeys.delete(key);
  });
  return { task_path: taskPath, task_id: taskId, poll_tool: "poll_task" };
}

export function pollTask(taskPath: string): TaskRecord {
  const normalized = String(taskPath || "").trim();
  if (!normalized) throw new Error("task_path 不能为空");
  const record = readRecord(normalized);
  if (!record) throw new Error(`找不到任务：${normalized}`);
  if (record.status === "running" && !livePaths.has(record.task_path)) {
    record.status = "failed";
    record.error = record.error || "发布进程已退出，任务没有完成";
    record.done = true;
    record.finished_at = record.finished_at || nowIso();
    writeRecord(record);
  }
  return { ...record, done: record.status !== "running" };
}
