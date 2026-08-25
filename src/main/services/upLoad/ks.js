import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import {
  isCreativeStatementNone,
  resolveKsCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import { WAIT_SELECTOR_APPEAR_MS, WAIT_UPLOAD_PROCESSING_MS, pollPageUntil } from "./uploadTimeouts.js";
import {
  clickKuaishouScheduleConfirmation,
  setOfficialSchedule,
  waitForOfficialScheduleAccepted,
} from "./officialSchedule.js";

async function findVisibleEditable(page, selectors) {
  for (const selector of selectors) {
    const nodes = await page.$$(selector);
    for (const node of nodes) {
      const visible = await node.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      });
      if (visible) return node;
    }
  }
  return null;
}

async function fillAndVerify(page, input, text, fieldName) {
  const normalizedExpected = text.replace(/\s+/g, " ").trim();
  await input.click({ clickCount: 3 });
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(200);

  const readEditables = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => String(
        element.value != null
          ? element.value
          : element.innerText || element.textContent || ""
      ).trim())
      .filter(Boolean)
  );
  let values = await readEditables();
  if (!values.some((value) => value.replace(/\s+/g, " ").trim().includes(normalizedExpected))) {
    await input.evaluate((element, value) => {
      if (!element.isConnected) return;
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const prototype = element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        setter?.call(element, value);
      } else {
        element.textContent = value;
      }
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value,
      }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, text);
    await page.waitForTimeout(200);
    values = await readEditables();
  }
  if (!values.some((value) => value.replace(/\s+/g, " ").trim().includes(normalizedExpected))) {
    throw new Error(`${fieldName}写入后校验失败，页面可编辑内容为：${values.join(" | ") || "空"}`);
  }
}

async function fillKsCopy(page, data) {
  const title = String(data.data?.bt1 || "").trim();
  const description = String(data.data?.bdText || "").trim();
  const tags = String(data.data?.bq || "").trim();
  if (!title) throw new Error("快手标题不能为空");

  const titleInput = await findVisibleEditable(page, [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    '[contenteditable="true"][data-placeholder*="标题"]',
  ]);
  const descriptionInput = await findVisibleEditable(page, [
    '#work-description-edit [contenteditable="true"]',
    "#work-description-edit textarea",
    "#work-description-edit input",
    '#work-description-edit[contenteditable="true"]',
    'textarea[placeholder*="描述"]',
    '[contenteditable="true"][data-placeholder*="描述"]',
    '[contenteditable="true"][aria-label*="描述"]',
  ]);
  if (!descriptionInput) throw new Error("未找到快手作品描述输入框");

  if (titleInput) {
    await fillAndVerify(page, titleInput, title, "快手标题");
  }
  const descriptionParts = [];
  if (!titleInput) descriptionParts.push(title);
  if (description && description !== title) descriptionParts.push(description);
  if (tags) {
    const existingTags = new Set(
      descriptionParts.join("\n").match(/#[^\s#】]+/g) || []
    );
    const missingTags = [...new Set(tags.split(/\s+/).filter(item => item.startsWith("#")))]
      .filter(item => !existingTags.has(item));
    if (missingTags.length) descriptionParts.push(missingTags.join(" "));
  }
  const copy = descriptionParts.join("\n").trim() || title;
  await fillAndVerify(page, descriptionInput, copy, "快手作品描述");
  console.log(`[ks] 标题和作品描述已写入，独立标题框=${Boolean(titleInput)}`);
}

async function selectKsCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  console.log("[ks] creativeStatement 值 =", value);
  // 快手目前只支持 AI 生成 / 演绎情节 两个选项；其它值（含「无标注」）无对应选项，跳过即可。
  if (isCreativeStatementNone(value)) {
    console.log("[ks] 无标注，快手保持默认不选");
    return;
  }
  const label = resolveKsCreativeStatementLabel(value);
  // 当前快手「作者声明」下拉支持的四个文案；未匹配则跳过。
  const SUPPORTED = new Set([
    "内容为AI生成",
    "演绎情节，仅供娱乐",
    "个人观点，仅供参考",
    "素材来源于网络",
  ]);
  if (!SUPPORTED.has(label)) {
    console.warn(`[ks] 当前声明值 "${value}" 在快手没有对应选项，跳过`);
    return;
  }
  console.log("[ks] 准备选择声明:", label);

  // 1. 通过 label 文本"作者声明 / 作品声明 / 声明"定位下拉触发器；返回它的 id 给后续用 page.click。
  //    ant-design Select 监听的是 mousedown，必须用真实鼠标事件（page.click 自带）才能打开下拉。
  const triggerInfo = await page.evaluate(() => {
    var norm = function (t) {
      return String(t || "").replace(/\s+/g, "").trim();
    };
    var LABEL_KEYWORDS = ["作者声明", "作品声明", "创作声明", "声明"];
    var formItems = document.querySelectorAll(
      '[class*="edit-form-item"], [class*="form-item"]'
    );
    for (var i = 0; i < formItems.length; i++) {
      var item = formItems[i];
      var label = item.querySelector("label");
      var labelText = norm(label && label.textContent);
      var matched = false;
      for (var k = 0; k < LABEL_KEYWORDS.length; k++) {
        if (labelText.indexOf(LABEL_KEYWORDS[k]) !== -1) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;
      var sel = item.querySelector(".ant-select");
      var selector = sel && sel.querySelector(".ant-select-selector");
      if (!selector) continue;
      var id = "__ks_statement_trigger_" + Date.now() + "__";
      selector.setAttribute("id", id);
      return { ok: true, matchedLabel: labelText, id: id };
    }
    var labels = [];
    for (var j = 0; j < formItems.length; j++) {
      var l = formItems[j].querySelector("label");
      labels.push(norm(l && l.textContent));
    }
    return { ok: false, labels: labels };
  });

  if (!triggerInfo || !triggerInfo.ok) {
    console.warn(
      "未找到快手声明下拉触发器，跳过。当前页 form-item labels:",
      JSON.stringify(triggerInfo && triggerInfo.labels)
    );
    return;
  }
  console.log("[ks] 找到下拉触发器, label =", triggerInfo.matchedLabel);

  // 用 puppeteer 真鼠标事件打开 dropdown（ant-design 走 mousedown）
  try {
    await page.click(`#${triggerInfo.id}`, { delay: 80 });
    console.log("[ks] 已 page.click 打开下拉");
  } catch (e) {
    console.warn("[ks] page.click 失败，尝试 DOM 派发事件:", e?.message || e);
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    }, triggerInfo.id);
    console.log("[ks] 已 DOM 派发 mousedown/mouseup/click");
  }

  // 2. 等下拉项可见（ant-design 用 rc-virtual-list，可见项是 .ant-select-item.ant-select-item-option，
  //    其 title 属性 = 文案；隐藏的 [role="option"] 不可点击，要忽略）
  try {
    await page.waitForFunction(
      (text) => {
        var opts = document.querySelectorAll(
          '.ant-select-dropdown .ant-select-item.ant-select-item-option'
        );
        for (var i = 0; i < opts.length; i++) {
          var o = opts[i];
          var t =
            o.getAttribute('title') ||
            ((o.querySelector('.ant-select-item-option-content') || {}).textContent || '');
          if (String(t).trim() === text) return true;
        }
        return false;
      },
      { timeout: 15000 },
      label
    );
  } catch (e) {
    console.warn("快手声明下拉项未出现:", e?.message || e);
    // 声明下拉虽然没有匹配项，但遮罩可能仍覆盖页面；关闭后再继续设置发布时间。
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return;
  }

  // 3. 点选目标选项：点 .ant-select-item-option 本身（ant-design 在它上面绑定 mousedown）
  const pickResult = await page.evaluate((text) => {
    var opts = document.querySelectorAll(
      '.ant-select-dropdown .ant-select-item.ant-select-item-option'
    );
    var titles = [];
    for (var ti = 0; ti < opts.length; ti++) {
      titles.push(opts[ti].getAttribute('title') || '');
    }
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      var t =
        o.getAttribute('title') ||
        ((o.querySelector('.ant-select-item-option-content') || {}).textContent || '');
      if (String(t).trim() !== text) continue;
      var rect = o.getBoundingClientRect();
      var opts2 = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };
      // ant-design Option 走 mousedown 选中：派发完整事件序列保证生效
      o.dispatchEvent(new MouseEvent('mousedown', opts2));
      o.dispatchEvent(new MouseEvent('mouseup', opts2));
      o.dispatchEvent(new MouseEvent('click', opts2));
      var inner = o.querySelector('.ant-select-item-option-content');
      if (inner) {
        inner.dispatchEvent(new MouseEvent('click', opts2));
      }
      return { ok: true, titles: titles };
    }
    return { ok: false, titles: titles };
  }, label);

  if (!pickResult || !pickResult.ok) {
    console.warn(
      `未找到快手声明选项: ${label}；下拉里实际 title 列表 = ${JSON.stringify(
        pickResult && pickResult.titles
      )}`
    );
    return;
  }
  await page.waitForTimeout(300);
  console.log("[ks] 已选择声明:", label);
}

export default async function (page, data, window,event) {
  const isDraftMode = data.publishMode === "draft" || data.publishToDraft === true;
  const submitText = isDraftMode ? "取消" : "发布";

  console.log(data);
  try {
    let sel = '#joyride-wrapper input[type="file"]';
    await page.waitForSelector(sel, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const uploadInputs = await page.$(sel);
    await uploadInputs.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
  }

  try {
    await page.waitForFunction(
      () => Boolean(
        document.querySelector('#work-description-edit [contenteditable="true"]') ||
        document.querySelector("#work-description-edit textarea") ||
        document.querySelector("#work-description-edit input") ||
        document.querySelector('#work-description-edit[contenteditable="true"]') ||
        document.querySelector('textarea[placeholder*="描述"]') ||
        document.querySelector('[contenteditable="true"][data-placeholder*="描述"]') ||
        document.querySelector('[contenteditable="true"][aria-label*="描述"]')
      ),
      { timeout: WAIT_SELECTOR_APPEAR_MS }
    );
    await fillKsCopy(page, data);
  } catch (e) {
    throw new Error(`快手标题或作品描述填写失败：${e?.message || e}`);
  }
  try {
    await page.click(".ant-checkbox-group>label:nth-of-type(2)", { delay: 200 });
  } catch (e) {
    console.error("❌ 输入标签失败", e);
  }

  // 选择创作声明（快手只支持 AI 生成 / 演绎情节，其它值跳过）
  try {
    await selectKsCreativeStatement(page, data);
  } catch (e) {
    console.warn("快手创作声明选择未完成:", e?.message || e);
  }

  try {
    // 用 pollPageUntil 替代 waitForSelector，避免 puppeteer 默认 protocolTimeout
    // (约 180s) 在大文件/弱网下把单次 Runtime.callFunctionOn 砍掉。
    await pollPageUntil(
      page,
      () => !!document.querySelector("#preview-tours video"),
      WAIT_UPLOAD_PROCESSING_MS,
      2000,
      "等待快手视频上传完成超时"
    );
    await page.waitForFunction(
      text => {
        const bar = document.querySelector("#setting-tours + div");
        if (!bar || bar.offsetParent === null) return false;
        for (const row of bar.querySelectorAll(":scope > div")) {
          const t = row.textContent.replace(/\s+/g, "").trim();
          if (t === text) return true;
        }
        return false;
      },
      { timeout: 10000 },
      submitText
    );

    const isOfficialSchedule = Boolean(data.officialScheduledPublish);
    if (isOfficialSchedule) {
      await setOfficialSchedule(page, "快手", data.publishAt);
    }

    // 快手发布按钮点击：原先用 page.evaluateHandle 返回行级 div 再 puppeteer click，
    // 在 hidden window 下几何中心常落不到真正的 <button> 上，结果是"看起来点过了但没发"。
    // 改为在 evaluate 内部遍历真实 button / 行 div，直接调 DOM .click()，避开鼠标几何问题。
    // 快手草稿功能和发布一个逻辑一个是 发布 一个是取消两个字
    const previousUrl = page.url();
    const clicked = await page.evaluate(text => {
      const norm = t => String(t || "").replace(/\s+/g, "").trim();
      const bar = document.querySelector("#setting-tours + div");
      if (!bar) return { ok: false, reason: "no-bar" };
      for (const btn of bar.querySelectorAll("button")) {
        if (norm(btn.textContent) === text && !btn.disabled) {
          btn.click();
          return { ok: true, via: "button" };
        }
      }
      for (const row of bar.querySelectorAll(":scope > div")) {
        if (norm(row.textContent) === text) {
          const inner = row.querySelector("button,[role='button']");
          if (inner) {
            inner.click();
            return { ok: true, via: "row>inner" };
          }
          row.click();
          return { ok: true, via: "row" };
        }
      }
      return { ok: false, reason: "no-match" };
    }, submitText);
    if (!clicked || !clicked.ok) {
      throw new Error(`未找到${submitText}按钮(${clicked && clicked.reason})`);
    }
    if (isOfficialSchedule) {
      await clickKuaishouScheduleConfirmation(page);
      await waitForOfficialScheduleAccepted(page, "快手", previousUrl);
    }
    console.log(isDraftMode ? `✅ 快手视频已保存草稿，click via=${clicked.via}` : `✅ 快手视频已触发发布，click via=${clicked.via}`);
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        scheduled: isOfficialSchedule,
        officialScheduled: isOfficialSchedule,
        message: isDraftMode
          ? "保存草稿成功"
          : isOfficialSchedule
            ? `快手官方定时发布已预约: ${data.publishAt}`
            : "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (e) {
    const detail = (e && e.message) || String(e);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: detail.length > 200 ? `${detail.slice(0, 200)}…` : detail,
    });
    console.error("❌ 发布失败", e);
  }
}
