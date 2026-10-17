"use strict";

import ptConfig from "../../config/ptConfig";
import { probeRealPublishSession } from "../publishSessionProbe.js";

/** 扫码凭证出现后，以真实发布页确认会话已具备上传权限。 */
export async function verifyPublishLogin(page, platform) {
  await page.goto(ptConfig[platform].upload, { waitUntil: "domcontentloaded", timeout: 30000 });
  const result = await probeRealPublishSession(page, platform);
  if (!result.ok) throw new Error(result.reason);
}
