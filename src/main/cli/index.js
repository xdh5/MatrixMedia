"use strict";

import path from "path";
import fs from "fs";
import xlsx from "xlsx";
import { normalizeCreativeStatement } from "../../shared/creativeStatement.js";
import { getCliSubArgv, isCliMode } from "./detectArgv";
import { parsePublishArgs, publishHelpText } from "./parsePublishArgs";
import { parseLoginArgs, loginHelpText } from "./parseLoginArgs";
import { parseAccountsArgs, accountsHelpText } from "./parseAccountsArgs";
import { runAccountsCli } from "./runAccountsCli";
import ptConfig from "../config/ptConfig";
import { runPuppeteerTask } from "../services/puppeteerFile";
import { runDouyinCliLogin } from "../services/cliLogin/douyinCliLogin";
import { runSphCliLogin } from "../services/cliLogin/sphCliLogin";
import { runSingleFilePublish } from "../services/publishVideo";
import { CLI_PUBLISH_TIMEOUT_MS } from "../services/upLoad/uploadTimeouts.js";
import { resolveAccountPublishMode } from "../services/accountPublishSettingsResolver.js";

export {
  isCliMode,
  getCliSubArgv,
  parsePublishArgs,
  publishHelpText,
  parseLoginArgs,
  loginHelpText,
  parseAccountsArgs,
  accountsHelpText,
};

function fileStem(filePath) {
  const base = path.basename(filePath || "");
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

function derivePhoneForRecord(v) {
  if (v.phone) return String(v.phone);
  if (!v.partition) return "";
  const stripped = String(v.partition).replace(/^persist:/, "");
  const idx = stripped.indexOf(v.platform);
  return idx > 0 ? stripped.slice(0, idx) : stripped;
}

/**
 * Parse xlsx rows for batch publish. Mirrors ipcMain.js dialog:openBatchXlsx logic.
 * Returns [{fileName, title, tags, creativeStatement}] filtered to rows with non-empty fileName.
 */
function parseXlsxRows(xlsxPath) {
  const workbook = xlsx.readFile(xlsxPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const cleanCell = (val) =>
    String(val || "")
      .replace(/[﻿​‌‍ ]/g, "")
      .replace(/[\n\t]/g, "")
      .trim();
  return rows
    .map((row) => {
      const map = {};
      Object.keys(row).forEach((k) => {
        map[cleanCell(k).toLowerCase()] = row[k];
      });
      return {
        fileName: cleanCell(
          map["文件名"] != null
            ? map["文件名"]
            : map["filename"] != null
            ? map["filename"]
            : map["file"] || ""
        ),
        title: cleanCell(
          map["标题"] != null ? map["标题"] : map["title"] || ""
        ),
        tags: cleanCell(map["标签"] != null ? map["标签"] : map["tags"] || ""),
        creativeStatement: cleanCell(
          map["创作声明"] != null
            ? map["创作声明"]
            : map["creativestatement"] != null
            ? map["creativestatement"]
            : map["cs"] || ""
        ),
      };
    })
    .filter((r) => r.fileName);
}

/**
 * Case-insensitive filename resolver: try exact match, then stem-only match.
 * Returns absolute resolved path or null if not found.
 */
function resolveFileInDir(dirPath, fileName) {
  const norm = (s) =>
    String(s || "")
      .replace(/[﻿​‌‍ ]/g, "")
      .replace(/[\n\t]/g, "")
      .trim()
      .toLowerCase();
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return null;
  }
  const indexByName = new Map();
  const indexByStem = new Map();
  entries.forEach((entry) => {
    indexByName.set(norm(entry), entry);
    const stem = entry.replace(/\.[^/.]+$/, "");
    if (!indexByStem.has(norm(stem))) indexByStem.set(norm(stem), entry);
  });
  const normName = norm(fileName);
  if (indexByName.has(normName))
    return path.join(dirPath, indexByName.get(normName));
  if (indexByStem.has(normName))
    return path.join(dirPath, indexByStem.get(normName));
  const stem = norm(String(fileName).replace(/\.[^/.]+$/, ""));
  if (indexByStem.has(stem)) return path.join(dirPath, indexByStem.get(stem));
  return null;
}

/**
 * Batch directory publish handler.
 * @param {object} v - parsed publish args (must have .dir, .config, .platform, .partition, .phone)
 * @param {object} cfg - platform config from ptConfig
 * @returns {Promise<number>} exit code: 0=all success, 1=partial failure, 2=all failed
 */
async function runBatchDirPublish(v, cfg) {
  const resolvedDir = path.resolve(v.dir);
  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.error("目录不存在或不是有效目录: " + resolvedDir);
    return 2;
  }
  const resolvedXlsx = path.resolve(v.config);
  if (!fs.existsSync(resolvedXlsx)) {
    console.error("xlsx 文件不存在: " + resolvedXlsx);
    return 2;
  }

  let rows;
  try {
    rows = parseXlsxRows(resolvedXlsx);
  } catch (e) {
    console.error(
      "解析 xlsx 失败: " + (e && e.message ? e.message : String(e))
    );
    return 2;
  }
  if (rows.length === 0) {
    console.error("xlsx 中没有有效行（文件名列全部为空）");
    return 2;
  }

  const results = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const resolvedFile = resolveFileInDir(resolvedDir, row.fileName);

    if (!resolvedFile) {
      const r = {
        index: i + 1,
        total: rows.length,
        fileName: row.fileName,
        title: row.title,
        platform: v.platform,
        phone: v.phone || "",
        status: "skipped",
        message: "文件不存在: " + row.fileName,
      };
      results.push(r);
      console.log(JSON.stringify({ progress: true, ...r }));
      continue;
    }

    const stem = fileStem(resolvedFile);
    const bt1 = row.title && row.title.trim() ? row.title.trim() : stem;
    const bt2 = bt1;
    const bookName = stem;

    // Format tags: split by comma (xlsx format), then # prefix for hashtag platforms
    const rawTags = String(row.tags || "").trim();
    let bq = "";
    if (rawTags) {
      const tagList = rawTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const hashtagPlatforms = new Set(["视频号", "抖音", "快手"]);
      if (hashtagPlatforms.has(v.platform)) {
        bq = tagList.map((t) => (t.startsWith("#") ? t : "#" + t)).join(" ");
      } else {
        bq = tagList.map((t) => t.replace(/^#/, "")).join(" ");
      }
    }

    const cs = normalizeCreativeStatement(row.creativeStatement || "");

    // 批量目录发布同样尊重账号「默认发布到草稿」设置 + 显式 --draft
    const effectivePublishMode = resolveAccountPublishMode({
      phone: derivePhoneForRecord(v),
      pt: v.platform,
      requestDraftMode: Boolean(v.draft),
    });

    const taskId = Date.now() + Math.random();
    const taskPayload = {
      taskId,
      bookName,
      textType: "local",
      data: {
        textOtherName: stem,
        bt1,
        bt2,
        bq,
        bdText: "",
        creativeStatement: cs,
      },
      url: cfg.upload,
      show: false,
      mmCliSuppressWindow: false,
      publishMode: effectivePublishMode.publishMode,
      publishToDraft: effectivePublishMode.publishToDraft,
      publishOptions: v.publishOptions || {},
      closeWindowAfterPublish: true,
      useragent: cfg.useragent,
      partition: v.partition,
      phone: derivePhoneForRecord(v),
      filePath: resolvedFile,
      pt: v.platform,
    };

    const updateRecord = () => {};

    console.log(
      JSON.stringify({
        progress: true,
        index: i + 1,
        total: rows.length,
        fileName: row.fileName,
        title: bt1,
        platform: v.platform,
        phone: v.phone || "",
        status: "publishing",
      })
    );

    const taskResult = await new Promise((resolve) => {
      let settled = false;
      const finish = (ok, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok, message });
      };

      const timer = setTimeout(() => {
        const min = Math.round(CLI_PUBLISH_TIMEOUT_MS / 60000);
        const msg = "CLI publish 超时（" + min + " 分钟）";
        console.error("[" + row.fileName + "] " + msg);
        updateRecord("failed", msg);
        finish(false, msg);
      }, CLI_PUBLISH_TIMEOUT_MS);

      const transport = {
        reply(channel, payload) {
          if (channel === "puppeteerFile-done") {
            if (payload && payload.taskId != null && payload.taskId !== taskId)
              return;
            if (payload && payload.skipped) {
              const msg = payload.message || "用户关闭窗口，已跳过发布";
              updateRecord("skipped", msg);
              finish(true, msg);
              return;
            }
            const ok = payload && payload.status === true;
            const msg =
              (payload && payload.message) || (ok ? "上传成功" : "上传失败");
            updateRecord(ok ? "success" : "failed", msg);
            finish(ok, msg);
          } else if (channel === "puppeteer-noLogin") {
            if (payload && payload.taskId != null && payload.taskId !== taskId)
              return;
            const msg = "登录态异常或未登录";
            console.error(
              "[" + row.fileName + "] " + msg + ":",
              JSON.stringify(payload)
            );
            updateRecord("failed", msg);
            finish(false, msg);
          }
        },
      };

      runPuppeteerTask(taskPayload, transport, () => {});
    });

    const r = {
      index: i + 1,
      total: rows.length,
      fileName: row.fileName,
      title: bt1,
      platform: v.platform,
      phone: v.phone || "",
      status: taskResult.ok ? "success" : "failed",
      message: taskResult.message,
    };
    results.push(r);
    console.log(JSON.stringify({ progress: true, done: true, ...r }));
  }

  // Summary
  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter(
    (r) => r.status === "failed" || r.status === "skipped"
  ).length;
  console.log(
    JSON.stringify({
      summary: true,
      total: rows.length,
      succeeded,
      failed,
      message: "成功 " + succeeded + " / 失败 " + failed,
      results,
    })
  );

  if (failed === 0) return 0;
  if (succeeded === 0) return 2;
  return 1;
}

/**
 * @returns {Promise<number>} 进程退出码
 */
export async function runCliMain(argv = process.argv) {
  const sub = getCliSubArgv(argv);
  if (!sub || sub.length === 0) {
    console.error(
      "用法: <应用> cli <publish|login|accounts> ..."
    );
    console.error("  cli publish --help");
    console.error("  cli login --help");
    console.error("  cli accounts --help");
    return 2;
  }

  const cmd = sub[0];
  if (cmd === "login") {
    const parsed = parseLoginArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(loginHelpText());
      return 0;
    }
    const v = parsed.value;
    try {
      const loginOpts = {
        partition: v.partition,
        show: v.show,
        terminalQr: v.terminalQr,
        timeoutMs: v.timeoutSec * 1000,
        saveQrPngPath: v.saveQrPng || null,
        puppeteerHeadless: v.puppeteerHeadless,
        phone: v.phone || null,
        force: v.force || false,
      };
      if (v.platform === "视频号") {
        return await runSphCliLogin(loginOpts);
      }
      if (v.platform === "快手") {
        const { runKsCliLogin } = await import("../services/cliLogin/ksCliLogin.js");
        return await runKsCliLogin(loginOpts);
      }
      if (v.platform === "头条") {
        const { runTtCliLogin } = await import("../services/cliLogin/ttCliLogin.js");
        return await runTtCliLogin(loginOpts);
      }
      return await runDouyinCliLogin(loginOpts);
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "publish") {
    const parsed = parsePublishArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(publishHelpText());
      return 0;
    }

    const v = parsed.value;
    const cfg = ptConfig[v.platform];
    if (!cfg) {
      console.error("内部错误: 未找到平台配置", v.platform);
      return 2;
    }

    // Batch directory publish mode
    if (v.dir) {
      return await runBatchDirPublish(v, cfg);
    }

    const result = await runSingleFilePublish(v);
    if (result.scheduled) {
      console.log(
        JSON.stringify({
          status: true,
          scheduled: true,
          officialScheduled: result.officialScheduled === true,
          id: result.id,
          publishAt: result.publishAt,
          message: result.message,
        })
      );
    } else if (result.exitCode === 0) {
      console.log(
        JSON.stringify({
          channel: "puppeteerFile-done",
          status: true,
          resultStatus: result.status,
          publishMode: result.publishMode,
          message: result.message,
        })
      );
    } else if (result.exitCode === 4) {
      console.log(
        JSON.stringify({
          channel: "puppeteerFile-done",
          status: false,
          resultStatus: result.status,
          publishMode: result.publishMode,
          outcome: result.outcome,
          needsAttention: true,
          message: result.message,
        })
      );
    } else if (result.exitCode === 3) {
      console.log(
        JSON.stringify({
          channel: "puppeteerFile-done",
          status: false,
          resultStatus: "failed",
          loginRequired: result.loginRequired === true,
          realSessionProbe: result.realSessionProbe === true,
          supportsQrLogin: result.supportsQrLogin === true,
          message: result.message || "登录态异常或未登录",
        })
      );
      console.error(result.message || "登录态异常或未登录");
      if (v.platform === "抖音" || v.platform === "快手" || v.platform === "视频号" || v.platform === "头条") {
        const loginPlatform = { 抖音: "dy", 快手: "ks", 视频号: "sph", 头条: "tt" }[v.platform];
        console.error(
          `提示: 可先执行 cli login -p ${loginPlatform} --phone <账号> 在本机完成扫码登录。`
        );
      }
    } else if (result.message) {
      console.error(result.message);
    }
    return result.exitCode;
  }

  if (cmd === "accounts") {
    const parsed = parseAccountsArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(accountsHelpText());
      return 0;
    }
    try {
      return await runAccountsCli(parsed.value);
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "--help" || cmd === "-h") {
    console.log(
      "可用子命令: publish | login | accounts"
    );
    console.log("各自 --help 查看详细参数。");
    return 0;
  }

  console.error("未知子命令:", cmd);
  console.error("支持: publish | login | accounts");
  return 2;
}
