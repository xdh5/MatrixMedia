"use strict";

import { WAIT_SELECTOR_APPEAR_MS } from "./uploadTimeouts.js";

const OFFICIAL_SCHEDULE_PLATFORMS = new Set(["抖音", "快手"]);
const WAIT_SCHEDULE_CONFIRM_MS = 60 * 1000;

export function supportsOfficialSchedule(platform) {
  return OFFICIAL_SCHEDULE_PLATFORMS.has(String(platform || "").trim());
}

function normalizePublishAt(value) {
  const text = String(value || "").trim();
  const matched = text.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (!matched) {
    throw new Error("官方定时发布时间格式应为 YYYY-MM-DD HH:mm:ss");
  }
  return {
    full: text,
    minute: `${matched[1]}-${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}`,
  };
}

async function replaceDateTimeInput(page, selector, value) {
  await page.waitForSelector(selector, {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });
  await page.click(selector, { delay: 80 });
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(value, { delay: 50 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  const actual = await page.$eval(selector, (input) => input.value || "");
  if (!String(actual).startsWith(value.slice(0, 16))) {
    throw new Error(`平台定时发布时间填写失败，页面当前值为: ${actual || "空"}`);
  }
}

async function setDouyinSchedule(page, publishAt) {
  await page.waitForFunction(
    () => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      return [...document.querySelectorAll("label, [class]")].some((el) => {
        const className = typeof el.className === "string" ? el.className : "";
        const isRadio = className.split(/\s+/).some((name) => name.startsWith("radio"));
        return isRadio && norm(el.textContent).includes("定时发布");
      });
    },
    { timeout: WAIT_SELECTOR_APPEAR_MS }
  );

  const triggerId = await page.evaluate(() => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const candidates = [...document.querySelectorAll("label, [class]")]
      .filter((el) => {
        const className = typeof el.className === "string" ? el.className : "";
        const isRadio = className.split(/\s+/).some((name) => name.startsWith("radio"));
        return isRadio && norm(el.textContent).includes("定时发布");
      })
      .sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
    const candidate = candidates[0];
    if (!candidate) return "";
    const clickable = candidate.closest("label") || candidate;
    const id = `__mm_dy_schedule_${Date.now()}`;
    clickable.id = id;
    return id;
  });
  if (!triggerId) throw new Error("未找到抖音官方「定时发布」选项");

  await page.click(`#${triggerId}`, { delay: 100 });
  await page.waitForTimeout(500);
  await replaceDateTimeInput(
    page,
    '.semi-input[placeholder="日期和时间"]',
    publishAt.minute
  );
  console.log(`[dy] 已设置抖音官方定时发布: ${publishAt.minute}`);
}

async function setKuaishouSchedule(page, publishAt) {
  const triggerId = await page.evaluate(() => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const labels = [...document.querySelectorAll("label")];
    const title = labels.find((label) => norm(label.textContent) === "发布时间");
    if (!title) return "";
    let container = title.parentElement;
    for (let i = 0; i < 8 && container; i += 1) {
      if (container.querySelectorAll(".ant-radio-input").length >= 2) break;
      container = container.parentElement;
    }
    if (!container) return "";
    const radios = container.querySelectorAll(".ant-radio-input");
    const input = radios[1];
    if (!input) return "";
    const clickable = input.closest("label") || input;
    const id = `__mm_ks_schedule_${Date.now()}`;
    clickable.id = id;
    return id;
  });
  if (!triggerId) throw new Error("未找到快手官方「定时发布」选项");

  await page.click(`#${triggerId}`, { delay: 100 });
  await page.waitForTimeout(500);
  await replaceDateTimeInput(
    page,
    'div.ant-picker-input input[placeholder="选择日期时间"]',
    publishAt.full
  );
  console.log(`[ks] 已设置快手官方定时发布: ${publishAt.full}`);
}

export async function setOfficialSchedule(page, platform, publishAtText) {
  if (!supportsOfficialSchedule(platform)) {
    throw new Error(`${platform}不支持矩媒官方定时发布自动化`);
  }
  const publishAt = normalizePublishAt(publishAtText);
  if (platform === "抖音") {
    await setDouyinSchedule(page, publishAt);
    return;
  }
  await setKuaishouSchedule(page, publishAt);
}

export async function clickKuaishouScheduleConfirmation(page) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      for (const button of document.querySelectorAll("button, [role='button']")) {
        if (visible(button) && norm(button.textContent) === "确认发布") {
          button.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (clicked) {
      console.log("[ks] 已确认快手官方定时发布");
      return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

export async function waitForOfficialScheduleAccepted(page, platform, previousUrl) {
  const deadline = Date.now() + WAIT_SCHEDULE_CONFIRM_MS;
  while (Date.now() < deadline) {
    const accepted = await page.evaluate((expectedUrl) => {
      const currentUrl = location.href;
      if (
        currentUrl !== expectedUrl &&
        (currentUrl.includes("/content/manage") ||
          currentUrl.includes("/article/manage/video"))
      ) {
        return true;
      }

      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const roots = document.querySelectorAll(
        ".semi-toast, .semi-notification, .ant-message, .ant-notification, .ant-modal, [role='alert']"
      );
      const successWords = ["定时发布成功", "预约成功", "发布成功", "提交成功", "已成功预约"];
      return [...roots].some((root) => {
        const text = norm(root.textContent);
        return visible(root) && successWords.some((word) => text.includes(word));
      });
    }, previousUrl).catch(() => false);
    if (accepted) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`${platform}未确认官方定时发布成功，请检查平台页面提示`);
}
