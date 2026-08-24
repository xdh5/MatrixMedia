"use strict";

import { WAIT_SELECTOR_APPEAR_MS } from "./uploadTimeouts.js";

const OFFICIAL_SCHEDULE_PLATFORMS = new Set([
  "抖音",
  "快手",
  "视频号",
  "百家号",
  "头条",
]);
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
    day: String(Number(matched[3])),
    time: `${matched[4]}:${matched[5]}`,
    monthDay: `${matched[2]}月${matched[3]}日`,
    hour: String(Number(matched[4])),
    minuteValue: String(Number(matched[5])),
  };
}

async function replaceDateTimeInput(page, selector, value) {
  await page.waitForSelector(selector, {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });
  // 抖音和快手的日期输入框是 React 受控组件，部分页面还会设置 readonly。
  // 直接键盘输入会被日期面板的默认时间覆盖，因此使用原生 setter 并派发事件。
  await page.$eval(
    selector,
    (input, nextValue) => {
      input.removeAttribute("readonly");
      input.readOnly = false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, nextValue);
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: nextValue,
        })
      );
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.focus();
    },
    value
  );
  await page.keyboard.press("Tab");
  await page.waitForTimeout(800);

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
    const id = `__mm_ks_schedule_${Date.now()}`;
    input.id = id;
    return id;
  });
  if (!triggerId) throw new Error("未找到快手官方「定时发布」选项");

  const scheduleSelected = await page.evaluate((id) => {
    const input = document.getElementById(id);
    if (!input) return false;
    input.click();
    return input.checked === true;
  }, triggerId);
  if (!scheduleSelected) {
    throw new Error("已找到快手「定时发布」选项，但点击后未选中");
  }
  await page.waitForTimeout(500);

  const scheduleState = await page.evaluate(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const inputs = [
      ...document.querySelectorAll(
        ".ant-picker-input input, .ant-picker input, input[placeholder*='日期'], input[placeholder*='时间']"
      ),
    ].filter((input) => input.type !== "file" && visible(input));
    const input = inputs[0];
    let id = "";
    if (input) {
      id = `__mm_ks_schedule_input_${Date.now()}`;
      input.id = id;
    }
    return {
      id,
      radios: [...document.querySelectorAll(".ant-radio-input")].map(
        (radio) => ({
          checked: radio.checked,
          text: String((radio.closest("label") || radio.parentElement)?.textContent || "")
            .replace(/\s+/g, "")
            .trim(),
        })
      ),
      inputs: [...document.querySelectorAll("input")]
        .filter((item) => item.type !== "file" && visible(item))
        .map((item) => ({
          type: item.type,
          placeholder: item.placeholder || "",
          value: item.value || "",
          className: String(item.className || ""),
        })),
    };
  });
  console.log("[ks] 定时控件状态:", JSON.stringify(scheduleState));
  const dateInputId = scheduleState.id;
  if (!dateInputId) {
    throw new Error("快手已选择定时发布，但未找到可见的发布时间输入框");
  }
  await replaceDateTimeInput(
    page,
    `#${dateInputId}`,
    publishAt.full
  );
  console.log(`[ks] 已设置快手官方定时发布: ${publishAt.full}`);
}

async function setShipinhaoSchedule(page, publishAt) {
  const selected = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { ok: false, reason: "shadow-root-missing" };
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const candidates = [...root.querySelectorAll("label")].filter(
      (label) => norm(label.textContent) === "定时"
    );
    const label = candidates[0];
    if (!label) {
      return {
        ok: false,
        reason: "schedule-radio-missing",
        labels: [...root.querySelectorAll("label")]
          .map((item) => norm(item.textContent))
          .filter(Boolean)
          .slice(-40),
      };
    }
    const input = label.querySelector('input[type="radio"]');
    if (input) input.click();
    else label.click();
    return {
      ok: input ? input.checked === true : true,
      reason: input && !input.checked ? "schedule-radio-not-checked" : "",
    };
  });
  if (!selected.ok) {
    throw new Error(`视频号选择「定时」失败：${JSON.stringify(selected)}`);
  }
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { ok: false, reason: "shadow-root-missing" };
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const inputs = [...root.querySelectorAll("input")].filter(
      (input) => input.type !== "file" && visible(input)
    );
    const input = inputs.find((item) => {
      const marker = `${item.placeholder || ""} ${item.className || ""}`;
      return /日期|时间|发表|date|time|picker/i.test(marker);
    });
    if (!input) {
      return {
        ok: false,
        reason: "schedule-input-missing",
        inputs: inputs.map((item) => ({
          type: item.type,
          placeholder: item.placeholder || "",
          value: item.value || "",
          className: String(item.className || ""),
        })),
      };
    }
    input.removeAttribute("readonly");
    input.readOnly = false;
    input.setAttribute("data-mm-sph-schedule", "true");
    input.focus();
    input.click();
    return {
      ok: true,
      actual: input.value || "",
      type: input.type,
      placeholder: input.placeholder || "",
      className: String(input.className || ""),
      parent: String((input.parentElement && input.parentElement.outerHTML) || "").slice(0, 1200),
    };
  });
  console.log("[sph] 定时控件状态:", JSON.stringify(state));
  if (!state.ok) {
    throw new Error(`视频号填写定时发表时间失败：${JSON.stringify(state)}`);
  }

  await page.waitForTimeout(500);
  const dateSelected = await page.evaluate((expectedDay) => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return false;
    const candidates = [...root.querySelectorAll(".weui-desktop-picker__table a")]
      .filter((item) => String(item.textContent || "").trim() === expectedDay)
      .filter(
        (item) =>
          !String(item.className || "").includes("weui-desktop-picker__disabled") &&
          !String(item.className || "").includes("weui-desktop-picker__faded")
      );
    const target = candidates[0];
    if (!target) return false;
    target.click();
    return true;
  }, publishAt.day);
  if (!dateSelected) {
    throw new Error(`视频号日期面板未找到可选的 ${publishAt.day} 日`);
  }
  await page.waitForTimeout(300);

  const timeFocused = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    const input = root && root.querySelector('input[placeholder="请选择时间"]');
    if (!input) return false;
    input.removeAttribute("readonly");
    input.readOnly = false;
    input.focus();
    return true;
  });
  if (!timeFocused) throw new Error("视频号未找到独立时间输入框");

  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(publishAt.time, { delay: 80 });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(800);
  const actual = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    const input =
      root && root.querySelector('input[data-mm-sph-schedule="true"]');
    return String((input && input.value) || "");
  });
  if (!actual.startsWith(publishAt.minute)) {
    throw new Error(
      `视频号定时发表时间填写失败，页面当前值为: ${actual || "空"}`
    );
  }
  console.log(`[sph] 已设置视频号官方定时发表: ${publishAt.minute}`);
}

async function inspectAndOpenScheduleDialog(page, platform) {
  const result = await page.evaluate((platformName) => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const selectors =
      platformName === "头条"
        ? [
            ".video-batch-footer .timer",
            ".video-batch-footer .action-footer-btn",
            "button",
            "[role='button']",
          ]
        : ["button", "[role='button']", "div", "span"];
    const candidates = [...document.querySelectorAll(selectors.join(","))]
      .filter(visible)
      .filter((node) => norm(node.textContent) === "定时发布")
      .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
    const found = candidates[0];
    if (!found) {
      return {
        ok: false,
        reason: "schedule-trigger-missing",
        texts: [...document.querySelectorAll("button,[role='button']")]
          .filter(visible)
          .map((node) => norm(node.textContent))
          .filter(Boolean)
          .slice(-40),
      };
    }
    const target = found.closest("button,[role='button']") || found;
    const id = `__mm_official_schedule_trigger_${Date.now()}`;
    target.id = id;
    return {
      ok: true,
      id,
      tag: target.tagName,
      className: String(target.className || ""),
      disabled: Boolean(target.disabled),
      outerHtml: String(target.outerHTML || "").slice(0, 3000),
    };
  }, platform);
  if (!result.ok) {
    throw new Error(`${platform}未找到官方「定时发布」入口：${JSON.stringify(result)}`);
  }
  const clicked = await page.evaluate((id) => {
    const target = document.getElementById(id);
    if (!target || target.disabled) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.click();
    return true;
  }, result.id);
  if (!clicked) throw new Error(`${platform}官方定时发布按钮点击失败`);
  await page.waitForTimeout(800);
  return result;
}

async function setDialogSchedule(page, platform, publishAt) {
  const trigger = await inspectAndOpenScheduleDialog(page, platform);
  console.log(`[${platform === "头条" ? "tt" : "bjh"}] 官方定时入口:`, JSON.stringify(trigger));
  const firstModalOpened = await page.evaluate((platformName) => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const selector = platformName === "头条"
      ? ".common-timing-picker"
      : ".cheetah-modal-confirm";
    return [...document.querySelectorAll(selector)].some(visible);
  }, platform);
  const dismissedGuide = await page.evaluate(() => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const button = [...document.querySelectorAll("button,[role='button']")]
      .find((node) => visible(node) && norm(node.textContent) === "我知道了");
    if (!button) return false;
    button.click();
    return true;
  });
  if (dismissedGuide) {
    await page.waitForTimeout(500);
    if (!firstModalOpened) {
      await inspectAndOpenScheduleDialog(page, platform);
    }
  }
  const state = await page.evaluate(() => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const inputs = [...document.querySelectorAll("input")]
      .filter((input) => input.type !== "file" && visible(input))
      .map((input) => ({
        type: input.type,
        placeholder: input.placeholder || "",
        value: input.value || "",
        className: String(input.className || ""),
      }));
    const buttons = [...document.querySelectorAll("button,[role='button']")]
      .filter(visible)
      .map((button) => ({
        text: String(button.textContent || "").replace(/\s+/g, "").trim(),
        className: String(button.className || ""),
      }))
      .filter((item) => item.text)
      .slice(-50);
    const parts = [...document.querySelectorAll("div,span,li,td,a")]
      .filter(visible)
      .map((node) => ({
        tag: node.tagName,
        text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
        className: String(node.className || ""),
      }))
      .filter(
        (item) =>
          item.text.length <= 140 &&
          /日期|时间|年|月|日|时|分|今天|明天|calendar|picker|date|time/i.test(
            `${item.text} ${item.className}`
          )
      )
      .slice(-180);
    const modal =
      document.querySelector(".common-timing-picker") ||
      document.querySelector("[class*='timing-picker']") ||
      document.querySelector(".cheetah-modal-confirm") ||
      document.querySelector("[class*='schedule']");
    const modalHtml = modal ? String(modal.outerHTML || "").slice(0, 24000) : "";
    return { inputs, buttons, parts, modalHtml };
  });
  console.log(`[${platform === "头条" ? "tt" : "bjh"}] 官方定时弹窗状态:`, JSON.stringify(state));
  if (platform === "头条") {
    const selectValue = async (selector, value, label) => {
      const opened = await page.evaluate((targetSelector) => {
        const target = document.querySelector(targetSelector);
        if (!target) return false;
        target.click();
        return true;
      }, selector);
      if (!opened) throw new Error(`头条未找到${label}下拉框`);
      await page.waitForTimeout(250);
      const picked = await page.evaluate((expected) => {
        const visible = (node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
        const candidates = [
          ...document.querySelectorAll(
            ".byte-select-option, [class*='select-option'], [role='option'], li"
          ),
        ].filter(visible);
        const target = candidates.find((node) => norm(node.textContent) === expected);
        if (!target) {
          return {
            ok: false,
            options: candidates
              .map((node) => norm(node.textContent))
              .filter(Boolean)
              .slice(-80),
          };
        }
        target.click();
        return { ok: true };
      }, value);
      if (!picked.ok) {
        throw new Error(`头条${label}未找到选项 ${value}：${JSON.stringify(picked.options)}`);
      }
      await page.waitForTimeout(250);
    };

    await selectValue(".common-timing-picker .day-select", publishAt.monthDay, "日期");
    await selectValue(".common-timing-picker .hour-select", publishAt.hour, "小时");
    await selectValue(
      ".common-timing-picker .minute-select",
      publishAt.minuteValue,
      "分钟"
    );
    const actual = await page.$eval(
      ".common-timing-picker .timer-time",
      (node) => String(node.textContent || "").trim()
    );
    if (actual !== publishAt.minute) {
      throw new Error(`头条定时发布时间校验失败，弹窗当前值为: ${actual || "空"}`);
    }
    const confirmed = await page.evaluate(() => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const modal = document.querySelector(".common-timing-picker");
      const button = modal && [...modal.querySelectorAll("button")].find(
        (node) => norm(node.textContent) === "定时发布"
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    });
    if (!confirmed) throw new Error("头条官方定时发布确认按钮不可用");
    await waitForOfficialScheduleAccepted(page, "头条", page.url());
    console.log(`[tt] 已确认头条官方定时发布: ${publishAt.minute}`);
    return;
  }

  const selectBjhValue = async (index, expected, label) => {
    const targetInfo = await page.evaluate((targetIndex) => {
      const visible = (node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const modals = [...document.querySelectorAll(".cheetah-modal-confirm")].filter(visible);
      const modal = modals[modals.length - 1];
      const selectors = modal && [...modal.querySelectorAll(".timepublish-wrap-select .cheetah-select-selector")];
      const target = selectors && selectors[targetIndex];
      if (!target) return { id: "", current: "" };
      const id = `__mm_bjh_schedule_select_${targetIndex}_${Date.now()}`;
      target.id = id;
      return {
        id,
        current: String(target.querySelector(".cheetah-select-selection-item")?.textContent || "").trim(),
      };
    }, index);
    if (!targetInfo.id) throw new Error(`百家号未找到${label}下拉框`);
    await page.click(`#${targetInfo.id}`, { delay: 100 });
    await page.waitForTimeout(500);
    const picked = await page.evaluate((value) => {
      const visible = (node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const candidates = [...document.querySelectorAll(
        ".cheetah-select-item-option, [role='option'], .cheetah-select-dropdown div"
      )].filter(visible);
      const target = candidates
        .filter((node) => norm(node.textContent) === value)
        .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];
      if (!target) {
        return {
          ok: false,
          options: candidates.map((node) => norm(node.textContent)).filter(Boolean).slice(-100),
        };
      }
      target.click();
      return { ok: true };
    }, expected);
    if (!picked.ok) {
      const currentNumber = Number((targetInfo.current.match(/\d+/) || [])[0]);
      const expectedNumber = Number((expected.match(/\d+/) || [])[0]);
      if (index === 0 || !Number.isFinite(currentNumber) || !Number.isFinite(expectedNumber)) {
        throw new Error(`百家号${label}未找到选项 ${expected}：${JSON.stringify(picked.options)}`);
      }
      const key = expectedNumber < currentNumber ? "ArrowUp" : "ArrowDown";
      for (let step = 0; step < Math.abs(expectedNumber - currentNumber); step += 1) {
        await page.keyboard.press(key);
      }
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(250);
  };

  await selectBjhValue(0, `${Number(publishAt.full.slice(5, 7))}月${Number(publishAt.day)}日`, "日期");
  await selectBjhValue(1, `${publishAt.hour}点`, "小时");
  await selectBjhValue(2, `${publishAt.minuteValue}分`, "分钟");
  const actual = await page.evaluate(() => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const modals = [...document.querySelectorAll(".cheetah-modal-confirm")].filter(visible);
    const modal = modals[modals.length - 1];
    return modal
      ? [...modal.querySelectorAll(".timepublish-wrap-select .cheetah-select-selection-item")]
          .map((node) => String(node.textContent || "").replace(/\s+/g, "").trim())
          .join("")
      : "";
  });
  const expected = `${Number(publishAt.full.slice(5, 7))}月${Number(publishAt.day)}日${publishAt.hour}点${publishAt.minuteValue}分`;
  if (actual !== expected) {
    throw new Error(`百家号定时发布时间校验失败，弹窗当前值为: ${actual || "空"}`);
  }
  const confirmed = await page.evaluate(() => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const modals = [...document.querySelectorAll(".cheetah-modal-confirm")].filter(visible);
    const modal = modals[modals.length - 1];
    const button = modal && [...modal.querySelectorAll("button")].find(
      (node) => norm(node.textContent) === "定时发布"
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  if (!confirmed) throw new Error("百家号官方定时发布确认按钮不可用");
  await waitForOfficialScheduleAccepted(page, "百家号", page.url());
  console.log(`[bjh] 已确认百家号官方定时发布: ${publishAt.minute}`);
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
  if (platform === "快手") {
    await setKuaishouSchedule(page, publishAt);
    return;
  }
  if (platform === "视频号") {
    await setShipinhaoSchedule(page, publishAt);
    return;
  }
  await setDialogSchedule(page, platform, publishAt);
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
    const accepted = await page.evaluate((expectedUrl, platformName) => {
      const currentUrl = location.href;
      if (
        currentUrl !== expectedUrl &&
        (currentUrl.includes("/content/manage") ||
          currentUrl.includes("/article/manage/video") ||
          currentUrl.includes("/manage/content"))
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
        ".semi-toast, .semi-notification, .ant-message, .ant-notification, .ant-modal, .byte-message, .byte-notification, .cheetah-message, [role='alert']"
      );
      const successWords = ["定时发布成功", "预约成功", "发布成功", "提交成功", "已成功预约"];
      const hasSuccess = [...roots].some((root) => {
        const text = norm(root.textContent);
        return visible(root) && successWords.some((word) => text.includes(word));
      });
      if (hasSuccess) return true;

      if (platformName === "头条" || platformName === "百家号") {
        const errorWords = ["失败", "错误", "重试", "异常", "不可用"];
        const hasError = [...roots].some((root) => {
          const text = norm(root.textContent);
          return visible(root) && errorWords.some((word) => text.includes(word));
        });
        const modal = platformName === "头条"
          ? document.querySelector(".common-timing-picker")
          : document.querySelector(".cheetah-modal-confirm");
        if (!hasError && (!modal || !visible(modal))) return true;
      }
      return false;
    }, previousUrl, platform).catch(() => false);
    if (accepted) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`${platform}未确认官方定时发布成功，请检查平台页面提示`);
}
