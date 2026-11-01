import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ReactNode } from "react";
import type { AppConfig, AppConfigContextType, ChooseOpts, DisplayConfigPatch } from "./types";

import { AppConfigContext } from "./context";
import { configReducer, initialState } from "./reducer";
import { loadConfig, saveConfig } from "../api/config";
import {
  chooseAiRoot as chooseAiRootApi,
  chooseRootDir as chooseRootDirApi,
  setRootDir as setRootDirApi,
} from "../api/directories";
import type { PresetId } from "@/entities/engine-presets/model/types";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(configReducer, initialState);

  /**
   * 欄の書き込みを1本に並べる鎖。順序だけを決める。
   *
   * 並べないと2件目は1件目の保存より前のファイルを読み、`save_config` はファイルごと
   * 置き換えるので1件目の欄が消える。
   *
   * 鎖に土台を持たせない。`setRootDir`、`chooseRootDir`、`chooseAiRoot` は鎖を通らずに
   * `app.json` を書くので、自分が書いた値を握り続けると、間に挟まったそれらの欄を
   * 次の書き込みが古い値へ戻す。ワークスペースを選び直した直後にチェックを1つ押すと
   * `root_dir` が消えたパスへ戻る、という形で出る。
   */
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());

  /** 渡した欄だけを差し替えて書く。土台は毎回ファイルから読み直す */
  const writeFields = useCallback((patch: Partial<AppConfig>): Promise<void> => {
    const chained = writeChainRef.current.then(async () => {
      // 鎖の中なので、前の `saveConfig` は終わっている
      const base = await loadConfig();
      const next: AppConfig = { ...base, ...patch };

      await saveConfig(next);
      dispatch({ type: "loaded", payload: next });
    });

    // 鎖は切らさない。reject のまま残すと、以後の書き込みが全部その失敗を引き継ぐ
    writeChainRef.current = chained.catch(() => undefined);

    return chained;
  }, []);

  async function chooseRootDir(opts?: ChooseOpts) {
    // ピッカーを開く前に `loading` を立てない。`loading` は `error` も消すので、
    // 「選ぶのをやめた」だけで直前の失敗の理由が画面から消える。
    // ネイティブのピッカーは自分で画面を止めるので、待たせる表示も要らない
    try {
      const rootDir = await chooseRootDirApi(opts);

      if (rootDir === null) return null;

      dispatch({ type: "loading" });
      const updated = await loadConfig();
      dispatch({ type: "loaded", payload: updated });
      return rootDir;
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ワークスペースを開けませんでした。ワークスペースを選択し直してください（${String(err)}）`,
      });
      return null;
    }
  }

  async function chooseAiRoot(opts?: ChooseOpts) {
    // `chooseRootDir` と同じで、ピッカーを開く前に `loading` を立てない
    try {
      const aiRoot = await chooseAiRootApi(opts);
      if (aiRoot === null) return Ok(null);

      dispatch({ type: "loading" });
      const updated = await loadConfig();
      dispatch({ type: "loaded", payload: updated });
      return Ok(aiRoot);
    } catch (err) {
      // `error` に積まない。積むと `RequireRootDir` が `/` へ飛ばし、呼び手が出す失敗ごと消える
      dispatch({ type: "settled" });
      return Err(`AI ライブラリを選択できませんでした（${String(err)}）`);
    }
  }

  async function setRootDir(rootDir: string) {
    dispatch({ type: "loading" });
    try {
      await setRootDirApi(rootDir);
      const updated = await loadConfig();
      dispatch({ type: "loaded", payload: updated });
      return Ok(undefined);
    } catch (err) {
      // `error` に積まない。積むと `RequireRootDir` が `/` へ飛ばし、呼び手が出す失敗ごと消える。
      // 更新が落ちただけで、読めている `config` は生きている
      dispatch({ type: "settled" });
      return Err(`ワークスペースを更新できませんでした（${String(err)}）`);
    }
  }

  async function setLastPresetId(presetId: PresetId | null) {
    dispatch({ type: "loading" });
    try {
      await writeFields({ last_preset_id: presetId });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `使うプリセットを保存できませんでした。ワークスペースを選択し直してください（${String(err)}）`,
      });
    }
  }

  // 戻り値の型をここに書くのは、`src/__tests__/asyncResultUse.test.ts` が宣言から
  // 名前を拾うため。外すと、この関数を投げっぱなしで呼んだ箇所が機械の目から消える
  const setDisplayConfig = useCallback(
    (patch: DisplayConfigPatch): AsyncResult<void, string> =>
      // `loading` を立てない。タブを押すたびに `isLoading` が上下し、それを見て無効化している
      // 操作（`WorkspaceTab` のボタン、`AppLoading` の分岐）がちらつく
      writeFields(patch).then(
        () => Ok(undefined),
        // `error` に積まない。積むと表示の設定を1つ保存し損ねただけで `RequireRootDir` が畳む
        (err: unknown) => Err(`表示の設定を保存できませんでした: ${String(err)}`),
      ),
    [writeFields],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      dispatch({ type: "loading" });
      try {
        const config = await loadConfig();
        if (!cancelled) dispatch({ type: "loaded", payload: config });
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "error",
            payload: `設定を読み込めませんでした。ワークスペースを選択し直してください（${String(err)}）`,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value: AppConfigContextType = {
    ...state,
    chooseRootDir,
    chooseAiRoot,
    setRootDir,
    setLastPresetId,
    setDisplayConfig,
  };

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}
