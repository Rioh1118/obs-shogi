import { useCallback, useEffect, useRef, useState } from "react";

import { useAppConfig } from "@/entities/app-config";
import { createAiProfileDirs, ensureEnginesDir, scanAiRoot } from "@/entities/engine/api/aiLibrary";
import { describeFsError, isNameInputError, type FsError } from "@/entities/file-tree";
import { revealInFileManager } from "@/shared/api/shell/revealInFileManager";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import { readContents, type AiLibraryContents } from "../lib/aiLibraryContents";
import { revealFailureNotice, staleCreateNotice } from "../lib/aiLibraryNotices";
import { failKeepingIndex, indexOfRoot, startLoading, type ScanState } from "../lib/aiRootScan";

/**
 * AI フォルダの作成の結果
 *
 * - `"created"`: 作れた
 * - `FsError`: 名前を直せば通る。欄のそばに出し、打った文字列は残す
 * - `"diagnosed"`: 名前では直せない失敗で、診断へ回した。打った文字列は残す
 * - `"stale"`: 作り終える前に AI ルートが変わった。成功に畳むと打った名前が消え、`FsError` に畳むと
 *   名前が悪くないのに欄が赤くなる。旧ルートの結果は `staleCreateNotice` の通知が伝える
 */
export type CreateAiFolderResult = "created" | FsError | "diagnosed" | "stale";

/** 画面から呼ぶ操作。どれも失敗を投げず、画面の状態か通知に出す */
export type AiLibraryActions = {
  selectRoot: () => Promise<void>;
  rescan: () => void;
  createEnginesDir: () => Promise<void>;
  openAiRoot: () => void;
  openEnginesDir: () => void;
  createAiFolder: (name: string) => Promise<CreateAiFolderResult>;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** AI ライブラリの読み取りと、フォルダの作成と開く操作を持つ。 */
export function useAiLibrary() {
  const { config, chooseAiRoot } = useAppConfig();
  const { notify } = useNotify();

  const savedRoot = config?.ai_root ?? "";
  const [aiRootPath, setAiRootPath] = useState(savedRoot);

  const [scan, setScan] = useState<ScanState>({ status: "idle" });

  /**
   * 最後に出した走査の番号。古い要求の結果を捨てるために持つ。
   * 読み直しは開けなかったときにも自動で走るので、古い要求が新しい要求の後に返ることがある。
   */
  const scanSeqRef = useRef(0);

  /**
   * 画面が指しているルート。`await` の後に読み、結果を書いてよいかを判定する。
   *
   * - `createEnginesDir` と `createAiFolder` は呼ぶ前のルートと比べ、変わっていたら画面へ書かない
   * - `revealOrNotify` は押した時点のルートでなく、この値で読み直す
   * - `selectRoot` だけは `await` の前に読む（理由はその関数の中）
   *
   * ルートが変わる場所で書き、レンダでは書かない。選び直しの直後に返る継続は再レンダより先に走るので、
   * レンダで書くとその間の判定が前のルートを見る。
   */
  const currentRootRef = useRef(aiRootPath.trim());

  const scanRoot = useCallback(async (root: string) => {
    const trimmed = root.trim();
    if (!trimmed) return;
    const seq = ++scanSeqRef.current;
    setScan(startLoading);
    try {
      const index = await scanAiRoot(trimmed);
      if (seq !== scanSeqRef.current) return;
      setScan({ status: "ready", loaded: { root: trimmed, index } });
    } catch (e) {
      if (seq !== scanSeqRef.current) return;

      // 読めなかったルートの索引は根拠が無い。残すと engines/ を作り直せず、開いても同じ失敗を繰り返す
      setScan({ status: "error", error: messageOf(e), last: null });
    }
  }, []);

  /**
   * 設定のルートが変わるたびに読み直す。
   *
   * `config` は起動時に非同期で届くので、この画面が `null` で mount することがある。初回だけ読む形では、
   * 後から届いたルートを誰も読まず、正常なフォルダに「読めていません」と出し続ける。
   * 重なった走査は `scanSeqRef` が畳む。
   */
  useEffect(() => {
    currentRootRef.current = savedRoot.trim();
    setAiRootPath(savedRoot);
    void scanRoot(savedRoot);
  }, [savedRoot, scanRoot]);

  const selectRoot = async () => {
    // `await` の前に読む。`currentRootRef` は effect も書くので、返った後に読むと新しいルート同士を
    // 比べることになり、別のルートでも同じルートと判定して2回走査する
    const before = currentRootRef.current;

    const picked = await chooseAiRoot({ force: true });
    if (!picked.success) {
      setScan(failKeepingIndex(picked.error));
      return;
    }
    if (picked.data === null) return; // 取り消し

    // 再レンダを待たずに書く。理由は `currentRootRef` の doc
    const sameRoot = picked.data.trim() === before;
    currentRootRef.current = picked.data.trim();
    setAiRootPath(picked.data);

    // 別のルートなら `savedRoot` が変わって effect が読む。同じルートの選び直し（繋ぎ直した外付けなど）は
    // `savedRoot` が変わらないので、ここで読む
    if (sameRoot) await scanRoot(picked.data);
  };

  const createEnginesDir = async () => {
    const root = aiRootPath.trim();
    setScan(startLoading);
    try {
      await ensureEnginesDir(root);
      if (root !== currentRootRef.current) return;
      await scanRoot(root);
    } catch (e) {
      if (root !== currentRootRef.current) return;
      setScan(failKeepingIndex(messageOf(e)));
    }
  };

  /**
   * 開きに行き、開けなければ通知に出して読み直す。
   *
   * `scan` には積まない。見出しが「フォルダを確認できませんでした」になり、読み取りの失敗でないので嘘になる。
   * 例外の本文は画面に出さない。プラグインの英語の文言は利用者の次の一手を決めない。
   */
  const revealOrNotify = async (label: string, path: string) => {
    const revealed = await revealInFileManager(path);
    if (revealed.success) return;

    // 理由は環境ごとに違う（見つからない、D-Bus が居ない、API が無い）ので原因はログに残す。
    // TODO(#448): webview の console は配布ビルドに残らず、届くのは開発中だけ
    console.error("[AiLibraryTab] フォルダを開けなかった", path, revealed.error);

    // 「そこに無い」なら読み直しで「engines/ を作成」が現れる。ファイル管理ソフトを呼べないだけの
    // 環境では空振りするが、消えたフォルダを「あり」と出し続けるより軽い
    void scanRoot(currentRootRef.current);

    notify(revealFailureNotice(label, path));
  };

  /**
   * AI フォルダを作り、名前で直せる失敗だけを呼び出し元へ返す。
   *
   * 全部を `scan` へ回すと、読み取りは成功しているのに見出しが「フォルダを確認できませんでした」になる。
   * 全部を名前の欄へ返すと、AI ルートが消えたときに名前が悪いように見える。振り分けは code で決める。
   */
  const createAiFolder = async (name: string): Promise<CreateAiFolderResult> => {
    const root = aiRootPath.trim();
    const created = await createAiProfileDirs(root, name);

    if (root !== currentRootRef.current) {
      const outcome = created.success
        ? "created"
        : isNameInputError(created.error.code)
          ? "name-error"
          : "failed";
      notify(staleCreateNotice(root, name, outcome));
      return "stale";
    }
    if (!created.success) {
      if (isNameInputError(created.error.code)) return created.error;

      setScan(failKeepingIndex(describeFsError(created.error.code)));
      return "diagnosed";
    }

    await scanRoot(root);
    return "created";
  };

  const index = indexOfRoot(scan, aiRootPath.trim());

  const contents: AiLibraryContents = readContents(index);

  const actions: AiLibraryActions = {
    selectRoot,
    rescan: () => void scanRoot(aiRootPath),
    createEnginesDir,
    openAiRoot: () => void revealOrNotify("AI ライブラリ", aiRootPath),
    openEnginesDir: () => void revealOrNotify("engines/", contents.enginesDirPath),
    createAiFolder,
  };

  return { aiRootPath, scan, contents, actions };
}
