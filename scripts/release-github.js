/**
 * GitHub 发版：升版本 → push main + tag → 触发 Upload Electron Package workflow。
 *
 * 日常 push 不会改版本；只有显式执行本脚本才会 bump 并打 GitHub Release。
 *
 * 用法:
 *   yarn release:patch
 *   yarn release:minor
 *   yarn release:major
 *   node scripts/release-github.js [patch|minor|major]
 *
 * 要求: 工作区干净、在 main 分支、已安装 gh CLI 且已登录。
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PKG = path.join(ROOT, "package.json");
const WORKFLOW_NAME = "Upload Electron Package";
const BUMP = ["patch", "minor", "major"].includes(process.argv[2])
  ? process.argv[2]
  : "patch";

function run(cmd, opts = {}) {
  console.log("$", cmd);
  execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}

function runSilent(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

function runOk(cmd) {
  try {
    runSilent(cmd);
    return true;
  } catch {
    return false;
  }
}

function assertCleanWorkingTree() {
  const out = runSilent("git status --porcelain");
  if (out) {
    console.error("工作区有未提交改动：");
    console.error(out);
    console.error("请先提交/暂存后再发版");
    process.exit(1);
  }
}

function assertMainBranch() {
  const branch = runSilent("git rev-parse --abbrev-ref HEAD");
  if (branch !== "main") {
    console.error(`当前分支为 ${branch}，请在 main 上执行发版`);
    process.exit(1);
  }
}

function bumpSemver(current, type) {
  const parts = String(current)
    .split(".")
    .map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`无效的 version 字段: ${current}`);
  }
  let [major, minor, patch] = parts;
  if (type === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
    if (patch >= 10) {
      minor += 1;
      patch = 0;
    }
  }
  return `${major}.${minor}.${patch}`;
}

function writePackageVersion(next) {
  const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
  pkg.version = next;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

function localTagExists(tag) {
  return runOk(`git rev-parse --verify -q refs/tags/${tag}`);
}

function getGitHubRepo() {
  try {
    return runSilent(
      "gh repo view --json nameWithOwner -q .nameWithOwner"
    );
  } catch {
    const url = runSilent("git remote get-url origin");
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (m) return m[1].replace(/\.git$/, "");
    throw new Error(
      "无法解析 GitHub 仓库，请确保 gh 已登录或 origin 指向 GitHub"
    );
  }
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function triggerWorkflow(repo) {
  run(`gh workflow run "${WORKFLOW_NAME}" --repo ${repo} --ref main`);
  sleepMs(2000);
  try {
    const url = runSilent(
      `gh run list --workflow "${WORKFLOW_NAME}" --repo ${repo} --limit 1 --json url -q ".[0].url"`
    );
    if (url) console.log("\n构建任务:", url);
  } catch {
    console.log(
      `\n可在 GitHub Actions 查看 workflow「${WORKFLOW_NAME}」进度`
    );
  }
}

function main() {
  assertCleanWorkingTree();
  assertMainBranch();

  run("git fetch origin main");
  run("git fetch --tags --prune --force origin");
  run("git merge --ff-only origin/main");

  const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
  const prev = pkg.version;
  const nextVersion = bumpSemver(prev, BUMP);
  if (nextVersion === prev) {
    console.error("版本号未变化");
    process.exit(1);
  }

  writePackageVersion(nextVersion);
  console.log(`版本: ${prev} -> ${nextVersion} (${BUMP})`);

  run("git add package.json");
  run(`git commit -m "chore(release): v${nextVersion}"`);

  const tagName = `v${nextVersion}`;
  if (localTagExists(tagName)) {
    console.warn(`本地已存在 tag ${tagName}，跳过创建`);
  } else {
    run(`git tag -a ${tagName} -m "${tagName}"`);
  }

  run("git push origin main");
  run(`git push origin ${tagName}`);

  const repo = getGitHubRepo();
  console.log(`\n触发 GitHub Actions（${repo}）...`);
  triggerWorkflow(repo);

  console.log(`\n✅ 发版已提交: v${nextVersion}，CI 完成后可在 Releases 下载安装包`);
}

try {
  main();
} catch (e) {
  console.error("❌ 发版失败:", e.message || e);
  process.exit(1);
}
