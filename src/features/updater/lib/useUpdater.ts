import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; update: Update }
  | { phase: "downloading"; progress: number } // 0–100
  | { phase: "ready" }
  | { phase: "error"; message: string };

export function useUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>({ phase: "idle" });
  const checkedRef = useRef(false);

  // Check once on mount
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    (async () => {
      try {
        setStatus({ phase: "checking" });
        const update = await check();
        if (update?.available) {
          setStatus({ phase: "available", update });
        } else {
          setStatus({ phase: "idle" });
        }
      } catch {
        // Network/endpoint errors are silent — just show idle
        setStatus({ phase: "idle" });
      }
    })();
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (status.phase !== "available") return;
    const { update } = status;

    let downloaded = 0;
    let total = 0;

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            setStatus({ phase: "downloading", progress: 0 });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setStatus({
              phase: "downloading",
              progress: total > 0 ? Math.round((downloaded / total) * 100) : 0,
            });
            break;
          case "Finished":
            setStatus({ phase: "ready" });
            break;
        }
      });
    } catch (e) {
      setStatus({
        phase: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [status]);

  const restart = useCallback(async () => {
    await relaunch();
  }, []);

  const dismiss = useCallback(() => {
    setStatus({ phase: "idle" });
  }, []);

  return { status, downloadAndInstall, restart, dismiss };
}
