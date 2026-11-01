import { useEffect, useRef, useState } from "react";

import { useAppConfig } from "@/entities/app-config";
import { ensureEnginesDir, scanAiRoot } from "@/entities/engine/api/aiLibrary";
import {
  failKeepingIndex,
  indexOfRoot,
  startLoading,
  type ScanState,
} from "@/features/settings/lib/aiRootScan";

/** プリセット編集の候補を読む。開いている間に AI ルートが変わったら読み直す。 */
export function useAiRootIndex() {
  const { config } = useAppConfig();
  const aiRoot = config?.ai_root ?? null;

  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [scanNonce, setScanNonce] = useState(0);

  /**
   * いま指しているルート。`await` の後に読み、結果を書いてよいかを判定する。
   * `aiRoot` は設定からしか変わらないので、下の effect で書く。
   */
  const currentRootRef = useRef(aiRoot);

  const rescan = () => setScanNonce((n) => n + 1);

  const createEnginesDir = async () => {
    const root = aiRoot;
    if (!root) return;
    try {
      setScan(startLoading);
      await ensureEnginesDir(root);

      // 切り替え後の走査は effect が走らせている。`rescan` を重ねると同じルートをもう一度読む
      if (root !== currentRootRef.current) return;
      rescan();
    } catch (e) {
      // 前のルートの失敗を新しいルートの画面へ書かない。書くと候補が塞がる
      if (root !== currentRootRef.current) return;
      setScan(failKeepingIndex(`engines/ の作成に失敗しました: ${String(e)}`));
    }
  };

  useEffect(() => {
    let cancelled = false;
    currentRootRef.current = aiRoot;

    (async () => {
      if (!aiRoot) {
        setScan({ status: "idle" });
        return;
      }

      setScan(startLoading);
      try {
        const index = await scanAiRoot(aiRoot);
        if (cancelled) return;
        setScan({ status: "ready", loaded: { root: aiRoot, index } });
      } catch (e) {
        if (cancelled) return;
        setScan({
          status: "error",
          error: `AI ライブラリを読めませんでした。フォルダがあるか（外付けなら繋がっているか）を確認して「もう一度読み込む」を押してください（${String(e)}）`,
          last: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [aiRoot, scanNonce]);

  return {
    hasRoot: Boolean(aiRoot),
    index: indexOfRoot(scan, aiRoot),
    scan,
    rescan,
    createEnginesDir,
  };
}

export type AiRootIndexState = ReturnType<typeof useAiRootIndex>;
