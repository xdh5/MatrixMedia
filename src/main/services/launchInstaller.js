import { backupPersistentDataBeforeInstall } from "./persistentDataRestore";

export function createLaunchInstallerHandler({ platform, spawn, shell, electronApp }) {
  return async function launchInstaller(event, installerPath) {
    if (!installerPath || typeof installerPath !== "string") {
      return { ok: false };
    }

    try {
      backupPersistentDataBeforeInstall(electronApp);
    } catch (error) {
      console.warn(
        "MatrixMedia: 安装前备份本地数据失败",
        error && error.message ? error.message : error
      );
    }

    if (platform === "win32") {
      spawn(installerPath, [], { detached: true, stdio: "ignore" }).unref();
    } else {
      await shell.openPath(installerPath);
    }

    electronApp.quit();
    return { ok: true };
  };
}
