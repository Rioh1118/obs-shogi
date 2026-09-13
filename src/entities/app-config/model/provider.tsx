import { useCallback, useEffect, useReducer, useRef } from "react";
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

  /**
   * 表示の設定の書き込みを1本に並べる鎖。
   *
   * **土台をレンダのクロージャから取ってはいけない。** `setDisplayConfig` は
   * `loading` を立てないので、ディスクへの1往復が終わるまで再レンダが起きない ——
   * その間に来た2件目は**必ず同じ古い土台**を読み、`save_config` はファイルごと
   * 置き換えるので1件目の欄が消える（チェックを2つ続けて押す、ラジオでキーリピート、
   * ドックのタブと設定が同時、のどれでも踏む）。
   *
   * 鎖に積めば、2件目の土台は1件目を反映したものになる。
   */
  const writeChainRef = useRef<Promise<AppConfig | null>>(Promise.resolve(null));

  // 戻り値の型をここに書くのは、読み捨ての呼びを見る走査が宣言から名前を拾うため。
  // 書かないと、この関数を投げっぱなしで呼んだ箇所が機械の目から外れる
  const setDisplayConfig = useCallback((patch: DisplayConfigPatch): AsyncResult<void, string> => {
    // **`loading` を立てない。** 立てると `isLoading` がタブを押すたびに上下し、
    // それを見て無効化している操作（`WorkspaceTab` のボタン、`AppLoading` の分岐）が
    // ちらつく。失敗しても `error` には積まない（下）ので、降ろす先も要らない
    const chained = writeChainRef.current.then(async (previous) => {
      const base = previous ?? (await loadConfig());
      const next: AppConfig = { ...base, ...patch };

      await saveConfig(next);
      dispatch({ type: "updated", payload: next });
      return next;
    });

    // **鎖は切らさない。** 落ちた回に鎖ごと reject のままにすると、
    // 以後の書き込みが全部その失敗を引き継ぐ。土台は読み直しへ戻す
    writeChainRef.current = chained.catch(() => null);

    return chained.then(
      () => Ok(undefined),
      // **`error` に積まない。** `RequireRootDir` がそれを見て `/` へ飛ばすので、
      // 表示の設定を1つ保存し損ねただけでランタイムごと畳まれる（`setRootDir` と同じ）
      (err: unknown) => Err(`表示の設定を保存できませんでした: ${String(err)}`),
    );
  }, []);

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
