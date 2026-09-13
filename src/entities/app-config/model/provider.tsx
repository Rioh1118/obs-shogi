import { useEffect, useReducer } from "react";
import type { ReactNode } from "react";
import type { AppConfig, AppConfigContextType, DisplayConfigPatch } from "./types";

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
            payload: `設定の読み込みに失敗しました: ${String(err)}`,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function updateConfig(config: AppConfig) {
    dispatch({ type: "loading" });
    try {
      await saveConfig(config);
      dispatch({ type: "updated", payload: config });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `設定の保存に失敗しました: ${String(err)}`,
      });
    }
  }

  async function chooseRootDir(opts = {}) {
    // **ピッカーを開く前に `loading` を立てない。** `loading` は `error` も消すので、
    // 立てると「選ぶのをやめた」だけで直前の失敗の理由が画面から消える。
    // ネイティブのピッカーは自分で画面を止めるので、待たせる表示も要らない
    try {
      const rootDir = await chooseRootDirApi(opts);

      // 取り消し。設定は1バイトも動いていないので、`config` も `error` も触らない
      if (rootDir === null) return null;

      dispatch({ type: "loading" });
      const updated = await loadConfig();
      dispatch({ type: "updated", payload: updated });
      return rootDir;
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ルートディレクトリの初期化に失敗しました: ${String(err)}`,
      });
      return null;
    }
  }

  async function chooseAiRoot(opts = {}) {
    // 理由は `chooseRootDir` と同じ
    try {
      const aiRoot = await chooseAiRootApi(opts);
      if (aiRoot === null) return Ok(null);

      dispatch({ type: "loading" });
      const updated = await loadConfig();
      dispatch({ type: "updated", payload: updated });
      return Ok(aiRoot);
    } catch (err) {
      // **`error` に積まない。** `RequireRootDir` がそれを見て `/` へ飛ばすので、
      // AI フォルダを選び損ねただけでランタイムごと畳まれる（`setRootDir` と同じ）
      dispatch({ type: "settled" });
      return Err(`AI_ROOTの選択に失敗しました: ${String(err)}`);
    }
  }

  async function setRootDir(rootDir: string) {
    dispatch({ type: "loading" });
    try {
      await setRootDirApi(rootDir);
      const updated = await loadConfig();
      dispatch({ type: "updated", payload: updated });
      return Ok(undefined);
    } catch (err) {
      // **`dispatch({type:"error"})` はしない。** `RequireRootDir` がそれを見て
      // `/` へ飛ばすので、ランタイムごと unmount され、呼び出し元が出そうとした
      // 失敗が画面に出る前に消える。設定の**更新**が落ちただけで、
      // すでに読めている `config` は生きている。
      // ただし `loading` は降ろす。降ろさないと `isLoading` が `true` で固定され、
      // 呼び出し元が案内する先（設定 → ワークスペース）のボタンが押せなくなる
      dispatch({ type: "settled" });
      return Err(`ルートディレクトリの更新に失敗しました: ${String(err)}`);
    }
  }

  async function setLastPresetId(presetId: PresetId | null) {
    dispatch({ type: "loading" });
    try {
      const base = state.config ?? (await loadConfig());

      const next: AppConfig = {
        ...base,
        last_preset_id: presetId,
      };

      await saveConfig(next);
      dispatch({ type: "updated", payload: next });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `last_preset_id の保存に失敗しました: ${String(err)}`,
      });
    }
  }

  // 戻り値の型をここに書くのは、読み捨ての呼びを見る走査が宣言から名前を拾うため。
  // 書かないと、この関数を投げっぱなしで呼んだ箇所が機械の目から外れる
  async function setDisplayConfig(patch: DisplayConfigPatch): AsyncResult<void, string> {
    // **`loading` を立てない。** ドックのタブを押すたびにここを通るので、
    // 立てると `error` が毎回消え、`WorkspaceTab` が出している設定の失敗が
    // タブを1つ押すだけで画面から消える
    try {
      const base = state.config ?? (await loadConfig());
      const next: AppConfig = { ...base, ...patch };

      await saveConfig(next);
      dispatch({ type: "updated", payload: next });
      return Ok(undefined);
    } catch (err) {
      // **`error` に積まない。** `RequireRootDir` がそれを見て `/` へ飛ばすので、
      // 表示の設定を1つ保存し損ねただけでランタイムごと畳まれる（`setRootDir` と同じ）。
      // `loading` も立てていないので降ろす先が無い
      return Err(`表示の設定を保存できませんでした: ${String(err)}`);
    }
  }

  const value: AppConfigContextType = {
    ...state,
    updateConfig,
    chooseRootDir,
    chooseAiRoot,
    setRootDir,
    setLastPresetId,
    setDisplayConfig,
  };

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}
