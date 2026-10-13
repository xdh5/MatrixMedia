"use strict";

import fs from "fs";
import path from "path";
import { BrowserWindow, app, session as electronSession } from "electron";
import pie from "puppeteer-in-electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import ptConfig from "../../config/ptConfig";
import { applyAccountProxyForTask } from "../proxyConfig.js";
import { clearTtSession, hasToutiaoSession, normalizeTtPartition } from "./ttSessionUtil.js";
import { CLI_LOGIN_QR_FIRST_DELAY_MS, CLI_LOGIN_QR_REFRESH_MS } from "./cliLoginQrRefresh.js";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

async function openTtQrPanel(page) {
  await page.waitForFunction(
    () => document.body && document.body.innerText && document.body.innerText.length > 0,
    { timeout: 20000 }
  ).catch(() => null);
  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll("button,a,div,span,li"))
      .find((element) => {
        const text = String(element.textContent || "").trim();
        const rect = element.getBoundingClientRect();
        return text === "扫码登录" && rect.width > 0 && rect.height > 0;
      });
    if (target) target.click();
  }).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function clickTtQrRefresh(page) {
  for (const frame of page.frames()) {
    const clicked = await frame.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const nodes = Array.from(document.querySelectorAll("button,a,div,span,i,svg"));
        const target = nodes.find((element) => {
        if (!visible(element)) return false;
        const text = String(element.textContent || "").replace(/\s+/g, "");
        const cls = String(element.className || "");
        if (text.includes("点击刷新") || text === "刷新" || text.includes("二维码已失效")) return true;
        if (/mask|refresh|expired|reload/i.test(cls) && element.getBoundingClientRect().width <= 220) return true;
        const parentCls = String(element.parentElement?.className || "");
        return element.tagName === "svg" && /qrcode|login/i.test(parentCls);
      });
      if (!target) return false;
      const clickable = target.closest("button,a,[role='button']") || target;
      clickable.click();
      return true;
    }).catch(() => false);
    if (clicked) return true;
  }
  return false;
}

async function captureTtQr(page, saveQrPngPath) {
  const refreshed = await clickTtQrRefresh(page);
  if (refreshed) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  const stillExpired = await page.evaluate(() => {
    const text = String(document.body?.innerText || "");
    return text.includes("二维码已失效") || text.includes("点击刷新");
  }).catch(() => false);
  if (stillExpired) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    await openTtQrPanel(page);
  }
  let best = null;
  for (const frame of page.frames()) {
    const found = await frame.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("img, canvas"));
      let chosen = null;
      for (const element of nodes) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = String(element.parentElement?.innerText || "");
        if (rect.width < 120 || rect.height < 120) continue;
        if (Math.abs(rect.width - rect.height) > 48) continue;
        if (style.visibility === "hidden" || style.display === "none") continue;
        if (text.includes("二维码已失效") || text.includes("点击刷新")) continue;
        const area = rect.width * rect.height;
        if (!chosen || area > chosen.area) chosen = { element, area };
      }
      if (!chosen) return null;
      const element = chosen.element;
      const src = element.tagName === "IMG" ? String(element.currentSrc || element.src || "") : "";
      if (src.startsWith("data:image") || src.startsWith("http://") || src.startsWith("https://")) {
        return { src };
      }
      if (element.tagName !== "CANVAS") return null;
      return { src: element.toDataURL("image/png") };
    }).catch(() => null);
    if (!found || !found.src) continue;
    if (!best || found.src.length > best.src.length) best = found;
  }
  if (!best) return false;
  fs.mkdirSync(path.dirname(saveQrPngPath), { recursive: true });
  fs.writeFileSync(`${saveQrPngPath}.url`, best.src, "utf8");
  console.log(`TOUTIAO_QR_URL ${best.src.startsWith("data:") ? "(data-url)" : best.src}`);
  if (best.src.startsWith("data:image")) {
    const encoded = best.src.slice(best.src.indexOf(",") + 1);
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length <= 80) return false;
    fs.writeFileSync(saveQrPngPath, buffer);
    return true;
  }
  const response = await page.evaluate(async (url) => {
    const result = await fetch(url);
    const bytes = new Uint8Array(await result.arrayBuffer());
    return { ok: result.ok, type: result.headers.get("content-type") || "", bytes: Array.from(bytes) };
  }, best.src).catch(() => null);
  if (!response || !response.ok || response.bytes.length <= 80) return false;
  fs.writeFileSync(saveQrPngPath, Buffer.from(response.bytes));
  return true;
}

export async function runTtCliLogin({
  partition,
  show,
  timeoutMs,
  saveQrPngPath = null,
  phone = null,
  force = false,
}) {
  const cfg = ptConfig.头条;
  if (!cfg) {
    console.error("内部错误: 未找到头条 ptConfig");
    return 1;
  }
  const part = normalizeTtPartition(partition);
  if (force) {
    await clearTtSession(part);
    console.log("头条：已清理当前账号分区的旧会话，将重新生成登录二维码。");
  } else if (await hasToutiaoSession(part)) {
    console.log("头条：当前账号已经登录，无需再次扫码。");
    return 0;
  }
  try {
    await applyAccountProxyForTask({ partition: part, phone, pt: "头条" });
  } catch (error) {
    console.warn("头条：应用账号代理失败:", error && error.message);
  }
  if (!show && !saveQrPngPath) {
    console.error("头条登录必须指定 --show 或 --save-qr-png。");
    return 2;
  }

  return await new Promise((resolve) => {
    let settled = false;
    let win = null;
    let browser = null;
    let page = null;
    let pollTimer = null;
    let qrTimer = null;
    let deadlineTimer = null;

    const finish = async (code, message) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (qrTimer) clearInterval(qrTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (code === 0) {
        try {
          const ses = electronSession.fromPartition(part);
          await ses.cookies.flushStore();
          ses.flushStorageData();
        } catch (_) {}
      }
      try { if (browser) browser.disconnect(); } catch (_) {}
      try { if (win && !win.isDestroyed()) win.close(); } catch (_) {}
      if (message) console.log(message);
      resolve(code);
    };

    (async () => {
      browser = await pie.connect(app, puppeteer);
      win = new BrowserWindow({
        width: 1100,
        height: 820,
        show: Boolean(show) && !saveQrPngPath,
        paintWhenInitiallyHidden: true,
        autoHideMenuBar: true,
        skipTaskbar: true,
        webPreferences: {
          partition: part,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      });
      win.on("closed", () => {
        if (!settled) finish(3, "头条登录窗口已关闭，尚未完成登录。");
      });
      if (cfg.useragent) win.webContents.setUserAgent(cfg.useragent);
      await win.loadURL("https://mp.toutiao.com/auth/page/login");
      page = await pie.getPage(browser, win);
      if (show && !saveQrPngPath) win.show();
      await openTtQrPanel(page);

      if (saveQrPngPath) {
        const refreshQr = () => captureTtQr(page, saveQrPngPath).catch(() => false);
        setTimeout(refreshQr, CLI_LOGIN_QR_FIRST_DELAY_MS);
        qrTimer = setInterval(refreshQr, CLI_LOGIN_QR_REFRESH_MS);
      }
      pollTimer = setInterval(() => {
        hasToutiaoSession(part).then((loggedIn) => {
          if (loggedIn) finish(0, "头条登录成功，会话已写入账号分区，可执行 cli publish。");
        }).catch((error) => console.error("头条登录状态检测失败:", error.message));
      }, 2000);
      deadlineTimer = setTimeout(() => {
        finish(3, `头条登录等待超时（${Math.round(timeoutMs / 1000)}s）。`);
      }, timeoutMs);
    })().catch((error) => {
      console.error("头条 CLI 登录初始化失败:", error.message);
      finish(1);
    });
  });
}
