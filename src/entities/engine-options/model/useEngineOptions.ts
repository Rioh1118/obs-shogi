import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineOption } from "@/entities/engine/api/rust-types";
import { getEngineOptions, rescanEngineOptions } from "../api/tauri";

export interface UseEngineOptionsResult {
  options: EngineOption[] | null;
  isLoading: boolean;
  error: string | null;
  rescan: () => Promise<void>;
}

// セッション中の重複 invoke を抑止するためのプロセス内キャッシュ。
// Rust 側 disk cache とは別レイヤー — disk hit でも invoke は走るので、
// preset ダイアログ開閉のたびに probe する無駄を防ぐ。
const memoryCache = new Map<string, EngineOption[]>();

export function useEngineOptions(enginePath: string | null): UseEngineOptionsResult {
  const [options, setOptions] = useState<EngineOption[] | null>(
    enginePath ? (memoryCache.get(enginePath) ?? null) : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 最新の enginePath を保持して stale 応答を破棄する
  const latestPathRef = useRef<string | null>(enginePath);

  useEffect(() => {
    latestPathRef.current = enginePath;

    if (!enginePath) {
      setOptions(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const cached = memoryCache.get(enginePath);
    if (cached) {
      setOptions(cached);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getEngineOptions(enginePath)
      .then((opts) => {
        if (cancelled || latestPathRef.current !== enginePath) return;
        memoryCache.set(enginePath, opts);
        setOptions(opts);
      })
      .catch((e: unknown) => {
        if (cancelled || latestPathRef.current !== enginePath) return;
        setError(e instanceof Error ? e.message : String(e));
        setOptions(null);
      })
      .finally(() => {
        if (cancelled || latestPathRef.current !== enginePath) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enginePath]);

  const rescan = useCallback(async () => {
    if (!enginePath) return;
    setIsLoading(true);
    setError(null);
    try {
      const opts = await rescanEngineOptions(enginePath);
      if (latestPathRef.current !== enginePath) return;
      memoryCache.set(enginePath, opts);
      setOptions(opts);
    } catch (e: unknown) {
      if (latestPathRef.current !== enginePath) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (latestPathRef.current === enginePath) {
        setIsLoading(false);
      }
    }
  }, [enginePath]);

  return { options, isLoading, error, rescan };
}
