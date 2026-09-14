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
import { getKsUserId, clearKsSession, normalizeKsPartition } from "./ksSessionUtil.js";
import { CLI_LOGIN_QR_FIRST_DELAY_MS, CLI_LOGIN_QR_REFRESH_MS } from "./cliLoginQrRefresh.js";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

const QR_SELECTORS = [
  "img[class*='qrcode']",
  "img[class*='qr']",
  "[class*='qrcode'] img",
  "[class*='qr'] img",
  "canvas[class*='qrcode']",
  "canvas[class*='qr']",
  "[class*='qrcode'] canvas",
  "[class*='qr'] canvas",
  "[class*='login'] img",
  "[role='dialog'] img",
  "canvas",
  "img",
];

async function captureKsQr(page, saveQrPngPath) {
  const refreshed = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("button,a,div,span,p"));
    const target = nodes.find((element) =>
      String(element.textContent || "").trim() === "点击刷新" &&
      element.getBoundingClientRect().width > 0 &&
      element.getBoundingClientRect().height > 0
    );
    if (!target) return false;
    target.click();
    return true;
  }).catch(() => false);
  if (refreshed) await new Promise((resolve) => setTimeout(resolve, 800));
  for (const frame of page.frames()) {
    for (const selector of QR_SELECTORS) {
      const nodes = await frame.$$(selector).catch(() => []);
      for (const node of nodes) {
        const size = await node.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            width: rect.width,
            height: rect.height,
            visible: rect.width >= 100 && rect.height >= 100 && style.visibility !== "hidden",
          };
        }).catch(() => null);
        if (!size || !size.visible || Math.abs(size.width - size.height) > 80) continue;
        const buffer = await node.screenshot({ type: "png" }).catch(() => null);
        if (buffer && buffer.length > 80) {
          fs.mkdirSync(path.dirname(saveQrPngPath), { recursive: true });
          fs.writeFileSync(saveQrPngPath, buffer);
          return true;
        }
      }
    }
  }
  if (process.env.MATRIX_CLI_QR_DEBUG && saveQrPngPath) {
    await page.screenshot({ type: "png", path: `${saveQrPngPath}.page.png`, fullPage: true }).catch(() => null);
  }
  return false;
}

export async function runKsCliLogin({
  partition,
  show,
  timeoutMs,
  saveQrPngPath = null,
  phone = null,
  force = false,
}) {
  const cfg = ptConfig.快手;
  if (!cfg) {
    console.error("内部错误: 未找到快手 ptConfig");
    return 1;
  }
  const part = normalizeKsPartition(partition);
  if (force) {
    await clearKsSession(part);
    console.log("快手：已清理当前账号分区的旧会话，将重新生成登录二维码。");
  } else if (await getKsUserId(part)) {
    console.log("快手：当前账号已经登录，无需再次扫码。");
    return 0;
  }
  try {
    await applyAccountProxyForTask({ partition: part, phone, pt: "快手" });
  } catch (error) {
    console.warn("快手：应用账号代理失败:", error && error.message);
  }
  if (!show && !saveQrPngPath) {
    console.error("快手登录必须指定 --show 或 --save-qr-png。");
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
        if (!settled) finish(3, "快手登录窗口已关闭，尚未完成登录。");
      });
      if (cfg.useragent) win.webContents.setUserAgent(cfg.useragent);
      await win.loadURL(cfg.index);
      page = await pie.getPage(browser, win);
      if (show && !saveQrPngPath) win.show();

      await page.waitForFunction(
        () => Array.from(document.querySelectorAll("button,a,div,span"))
          .some((element) => String(element.textContent || "").trim() === "立即登录"),
        { timeout: 15000 }
      );
      const clicked = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll("button,a,div,span,p"));
        const target = candidates.find(
          (element) => String(element.textContent || "").trim() === "立即登录" &&
            element.getBoundingClientRect().width > 0 &&
            element.getBoundingClientRect().height > 0
        );
        if (!target) return false;
        target.click();
        return true;
      });
      if (!clicked) throw new Error("未找到快手立即登录按钮");
      await page.waitForSelector(".platform-switch", { timeout: 15000 });
      await page.click(".platform-switch");
      await new Promise((resolve) => setTimeout(resolve, 1500));

      if (saveQrPngPath) {
        const refreshQr = () => captureKsQr(page, saveQrPngPath).catch(() => false);
        setTimeout(refreshQr, CLI_LOGIN_QR_FIRST_DELAY_MS);
        qrTimer = setInterval(refreshQr, CLI_LOGIN_QR_REFRESH_MS);
      }
      pollTimer = setInterval(() => {
        getKsUserId(part).then((userId) => {
          if (userId) finish(0, "快手登录成功，会话已写入账号分区，可执行 cli publish。");
        }).catch((error) => console.error("快手登录状态检测失败:", error.message));
      }, 2000);
      deadlineTimer = setTimeout(() => {
        finish(3, `快手登录等待超时（${Math.round(timeoutMs / 1000)}s）。`);
      }, timeoutMs);
    })().catch((error) => {
      console.error("快手 CLI 登录初始化失败:", error.message);
      finish(1);
    });
  });
}
