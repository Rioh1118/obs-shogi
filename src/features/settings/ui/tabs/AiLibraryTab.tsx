import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./AiLibraryTab.scss";

import { Copy, FolderOpen, Sparkles } from "lucide-react";

import Button from "@/shared/ui/Button/Button";
import { SField, SInput, SSection } from "../kit";
import { useAppConfig } from "@/entities/app-config";

import {
  canCreateEnginesDir,
  classifyEnginesDir,
  canRevealEnginesDir,
  canListEnginesDir,
  type EnginesDir,
} from "@/entities/engine/lib/enginesDir";
import {
  scanAiRoot,
  createAiProfileDirs,
  ensureEnginesDir,
  type AiRootIndex,
  type ProfileCandidate,
} from "@/entities/engine/api/aiLibrary";
import { isEngineForThisMachine } from "@/entities/engine/lib/engineCandidate";

import { describeFsError, isNameInputError } from "@/entities/file-tree";
import { revealInFileManager } from "@/shared/api/shell/revealInFileManager";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import type { NotifyRequest } from "@/shared/lib/notification/types";
import { copyText } from "@/shared/api/clipboard/copyText";
import SetupGuide from "../ai-library-tab/SetupGuide";
import type { CreateAiFolderResult, SetupGuideProfile } from "../ai-library-tab/types";

function profileHealth(p: ProfileCandidate) {
  const okEval = p.has_eval_dir && p.eval_files.length > 0;
  const okBook = p.has_book_dir && p.book_db_files.length > 0;
  return { okEval, okBook };
}

/**
 * 読めた索引と、読んだルート
 *
 * ルートを持たせないと、別のルートを選んだ直後に前の索引が残り、「engines/ を開く」が前のフォルダを開く。
 */
type LoadedIndex = { root: string; index: AiRootIndex };

/**
 * AI ルートの読み取りの状態
 *
 * `loading` と `error` も最後に読めた索引を持つ。捨てると `classifyEnginesDir` が `unknown` を返し、
 * 「開く」と手順書の段と押したボタンが消えて、作成済みのフォルダに何もできなくなる。
 * ルートを読めなかったときだけ捨てる（`scanNow` の catch）。
 */
type ScanState =
  | { status: "idle" }
  | { status: "loading"; last: LoadedIndex | null }
  | { status: "ready"; loaded: LoadedIndex }
  | { status: "error"; error: string; last: LoadedIndex | null };

function lastIndex(scan: ScanState): LoadedIndex | null {
  switch (scan.status) {
    case "ready":
      return scan.loaded;
    case "loading":
    case "error":
      return scan.last;
    case "idle":
      return null;
  }
}

/**
 * フォルダを開けなかったことの通知を作る。文面の決まりは `docs/spec/screens/settings.md`。
 *
 * 段と見せ方は ADR-0004 の F-13。次の操作が要るのに `info` に留めるのは、復帰の操作が通知の外にあるため。
 * 「選択…」は常設で、「engines/ を作成」は読み直しで消えていたときに現れる。
 * 鍵にパスを混ぜるのは、別のフォルダの失敗を1枚に畳まないため。
 */
function revealFailureNotice(label: string, path: string): NotifyRequest {
  return {
    tier: "info",
    presentation: "toast",
    autoDismiss: true,
    title: `${label}を開けませんでした`,
    body: "場所が変わったか、ファイル管理ソフトを呼べていません",
    dedupeKey: `reveal:${path}`,
  };
}

/**
 * AI フォルダを作っている間に AI ルートが変わったときの結果
 *
 * 見せ方は F-13 と同じ toast だが、段と本文を結果で割る。文面の決まりは `docs/spec/screens/settings.md`。
 * 段を揃えると、6秒で消える通知の差が題の末尾の1語だけになる。
 */
type StaleCreateOutcome = "created" | "name-error" | "failed";

const STALE_CREATE_BODY: Record<StaleCreateOutcome, string> = {
  created: "切り替える前の AI ライブラリでの結果です",
  // 名前で落ちた回に「同じ名前で作り直せます」と言うと、欄に残っている赤字と正面から食い違う
  "name-error": "名前を直してから作成し直してください",
  failed: "同じ名前で作成し直せます",
};

/**
 * ルートが変わった後に返った作成の結果の通知を作る。
 *
 * 画面は別のルートを指していて一覧に出ないので、黙ると失敗に見え、押した人は新しいルートにもう1つ作る。
 */
function staleCreateNotice(root: string, name: string, outcome: StaleCreateOutcome): NotifyRequest {
  const created = outcome === "created";
  return {
    tier: created ? "info" : "warning",
    presentation: "toast",
    autoDismiss: true,
    title: created
      ? `前のフォルダに「${name}」を作成しました`
      : `前のフォルダに「${name}」を作成できませんでした`,
    body: STALE_CREATE_BODY[outcome],
    dedupeKey: `create-profile:${root}/${name}`,
  };
}

/** 「検出された問題」に出す一言。`null` は何も言わない状態。`Record` の理由は `EnginesDir` の doc */
const ENGINES_DIR_WARNING: Record<EnginesDir, string | null> = {
  unknown: null,
  dir: null,
  missing: "engines/ が見つかりません。『engines/ を作成』で生成できます。",
  other: "engines がフォルダではありません。同じ名前のものを削除してください。",
};

export default function AiLibraryTab() {
  const { config, chooseAiRoot } = useAppConfig();
  const { notify } = useNotify();

  const aiRoot = config?.ai_root ?? "";
  const [localAiRoot, setLocalAiRoot] = useState(aiRoot);

  const [scan, setScan] = useState<ScanState>({ status: "idle" });

  /**
   * 最後に出した走査の番号。古い要求の結果を捨てるために持つ。
   * 読み直しは開けなかったときにも自動で走るので、古い要求が新しい要求の後に返ることがある。
   */
  const scanSeqRef = useRef(0);

  /**
   * 画面が指しているルート。`await` の後に読み、結果を書いてよいかを判定する。
   *
   * - `onEnsureEngines` と `onCreateAiFolder` は呼ぶ前のルートと比べ、変わっていたら画面へ書かない
   * - `revealOrNotify` は押した時点のルートでなく、この値で読み直す
   * - `onPick` だけは `await` の前に読む（理由はその関数の中）
   *
   * ルートが変わる場所で書き、レンダでは書かない。選び直しの直後に返る継続は再レンダより先に走るので、
   * レンダで書くとその間の判定が前のルートを見る。
   */
  const currentRootRef = useRef(localAiRoot.trim());

  const canOperate = localAiRoot.trim().length > 0;

  const scanNow = useCallback(async (root: string) => {
    const r = root.trim();
    if (!r) return;
    const seq = ++scanSeqRef.current;
    setScan((s) => ({ status: "loading", last: lastIndex(s) }));
    try {
      const index = await scanAiRoot(r);
      if (seq !== scanSeqRef.current) return;
      setScan({ status: "ready", loaded: { root: r, index } });
    } catch (e) {
      if (seq !== scanSeqRef.current) return;

      // 読めなかったルートの索引は根拠が無い。残すと engines/ を作り直せず、開いても同じ失敗を繰り返す
      setScan({ status: "error", error: e instanceof Error ? e.message : String(e), last: null });
    }
  }, []);

  const refresh = useCallback(async () => scanNow(localAiRoot), [localAiRoot, scanNow]);

  /**
   * 設定のルートが変わるたびに読み直す。
   *
   * `config` は起動時に非同期で届くので、この画面が `null` で mount することがある。初回だけ読む形では、
   * 後から届いたルートを誰も読まず、正常なフォルダに「読めていません」と出し続ける。
   * 重なった走査は `scanSeqRef` が畳む。
   */
  useEffect(() => {
    currentRootRef.current = aiRoot.trim();
    setLocalAiRoot(aiRoot);
    if (aiRoot.trim()) void scanNow(aiRoot);
  }, [aiRoot, scanNow]);

  // `SetupGuide` の `nextAction` の依存なので、毎レンダ作り直さない
  const onRescan = useCallback(() => void refresh(), [refresh]);

  // 別のルートの索引は使わない。切り替え直後はまだ何も読めていない
  const loaded = lastIndex(scan);
  const data = loaded && loaded.root === localAiRoot.trim() ? loaded.index : null;

  const enginesDir = classifyEnginesDir(data?.engines_dir);

  const warnings = useMemo(() => {
    if (!data) return [] as string[];
    const ws: string[] = [];
    const dir = classifyEnginesDir(data.engines_dir);
    const enginesWarning = ENGINES_DIR_WARNING[dir];
    if (enginesWarning) ws.push(enginesWarning);

    // `engines/` が使えるときだけ言う。無いときに言うと、1行目が「フォルダではない」と言ったものの
    // 中へ置けと指示することになる
    if (canListEnginesDir(dir) && !(data.engines ?? []).some(isEngineForThisMachine)) {
      ws.push("エンジン実行ファイルが未検出です。engines/ 配下に置いてください。");
    }
    for (const p of data.profiles ?? []) {
      const { okEval, okBook } = profileHealth(p);
      if (!okEval) ws.push(`「${p.name}」: 評価関数が未検出です（<AI 名>/eval に nn.bin 等）。`);
      if (!okBook) ws.push(`「${p.name}」: 定跡が未検出です（<AI 名>/book に .db）。`);
    }
    return ws;
  }, [data]);

  const usableEngines = useMemo(() => (data?.engines ?? []).filter(isEngineForThisMachine), [data]);
  const enginesCount = usableEngines.length;
  const engineNames = useMemo(() => usableEngines.map((e) => e.entry), [usableEngines]);

  const guideProfiles = useMemo<SetupGuideProfile[]>(
    () =>
      data?.profiles.map((p) => ({
        name: p.name,
        path: p.path,
        hasEvalDir: p.has_eval_dir,
        hasBookDir: p.has_book_dir,
        evalCount: p.eval_files.length,
        bookCount: p.book_db_files.length,
      })) ?? [],
    [data],
  );

  const badge = useMemo(() => {
    if (!canOperate) return { tone: "warn" as const, text: "未設定" };
    if (scan.status === "loading") return { tone: "muted" as const, text: "診断中…" };
    if (scan.status === "error") return { tone: "danger" as const, text: "エラー" };
    if (scan.status === "ready")
      return warnings.length > 0
        ? { tone: "warn" as const, text: "注意あり" }
        : { tone: "ok" as const, text: "OK" };
    return { tone: "muted" as const, text: "—" };
  }, [canOperate, scan.status, warnings.length]);

  const onPick = useCallback(async () => {
    // `await` の前に読む。`currentRootRef` は effect も書くので、返った後に読むと新しいルート同士を
    // 比べることになり、別のルートでも同じルートと判定して2回走査する
    const before = currentRootRef.current;

    const picked = await chooseAiRoot({ force: true });
    if (!picked.success) {
      setScan((s) => ({ status: "error", error: picked.error, last: lastIndex(s) }));
      return;
    }
    if (picked.data === null) return; // 取り消し

    // 再レンダを待たずに書く。理由は `currentRootRef` の doc
    const sameRoot = picked.data.trim() === before;
    currentRootRef.current = picked.data.trim();
    setLocalAiRoot(picked.data);

    // 別のルートなら `aiRoot` が変わって effect が読む。同じルートの選び直し（繋ぎ直した外付けなど）は
    // `aiRoot` が変わらないので、ここで読む
    if (sameRoot) await scanNow(picked.data);
  }, [chooseAiRoot, scanNow]);

  const onEnsureEngines = useCallback(async () => {
    const root = localAiRoot.trim();
    if (!root) return;
    setScan((s) => ({ status: "loading", last: lastIndex(s) }));
    try {
      await ensureEnginesDir(root);
      if (root !== currentRootRef.current) return;
      await scanNow(root);
    } catch (e) {
      if (root !== currentRootRef.current) return;
      setScan((s) => ({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        last: lastIndex(s),
      }));
    }
  }, [localAiRoot, scanNow]);

  /**
   * 開きに行き、開けなければ通知に出して読み直す。
   *
   * `scan` には積まない。見出しが「フォルダを確認できませんでした」になり、読み取りの失敗でないので嘘になる。
   * 例外の本文は画面に出さない。プラグインの英語の文言は利用者の次の一手を決めない。
   */
  const revealOrNotify = useCallback(
    async (label: string, path: string) => {
      const revealed = await revealInFileManager(path);
      if (revealed.success) return;

      // 理由は環境ごとに違う（見つからない、D-Bus が居ない、API が無い）ので原因はログに残す。
      // TODO(#448): webview の console は配布ビルドに残らず、届くのは開発中だけ
      console.error("[AiLibraryTab] フォルダを開けなかった", path, revealed.error);

      // 「そこに無い」なら読み直しで「engines/ を作成」が現れる。ファイル管理ソフトを呼べないだけの
      // 環境では空振りするが、消えたフォルダを「あり」と出し続けるより軽い
      void scanNow(currentRootRef.current);

      notify(revealFailureNotice(label, path));
    },
    [notify, scanNow],
  );

  const onOpenAiRoot = useCallback(() => {
    if (localAiRoot.trim()) void revealOrNotify("AI ライブラリ", localAiRoot);
  }, [localAiRoot, revealOrNotify]);

  // 索引に載っているパスだけを開く。押せる条件は `canRevealEnginesDir` が持つので、`<root>/engines` と
  // 推測しない
  const enginesDirPath = data?.engines_dir?.path ?? "";

  const onOpenEnginesDir = useCallback(() => {
    if (enginesDirPath.trim()) void revealOrNotify("engines/", enginesDirPath);
  }, [enginesDirPath, revealOrNotify]);

  const revealable = canRevealEnginesDir(enginesDir);

  /**
   * AI フォルダを作り、名前で直せる失敗だけを呼び出し元へ返す。
   *
   * 全部を `scan` へ回すと、読み取りは成功しているのに見出しが「フォルダを確認できませんでした」になる。
   * 全部を名前の欄へ返すと、AI ルートが消えたときに名前が悪いように見える。振り分けは code で決める。
   */
  const onCreateAiFolder = useCallback(
    async (aiName: string): Promise<CreateAiFolderResult> => {
      const root = localAiRoot.trim();
      const name = aiName.trim();
      if (!root || !name) return "stale";

      const created = await createAiProfileDirs(root, name);
      if (root !== currentRootRef.current) {
        notify(
          staleCreateNotice(
            root,
            name,
            created.success
              ? "created"
              : isNameInputError(created.error.code)
                ? "name-error"
                : "failed",
          ),
        );
        return "stale";
      }
      if (!created.success) {
        if (isNameInputError(created.error.code)) return created.error;

        setScan((s) => ({
          status: "error",
          error: describeFsError(created.error.code),
          last: lastIndex(s),
        }));
        return null;
      }

      await scanNow(root);
      return null;
    },
    [localAiRoot, notify, scanNow],
  );

  const scanStatus = useMemo((): "idle" | "loading" | "ok" | "error" => {
    switch (scan.status) {
      case "idle":
        return "idle";
      case "loading":
        return "loading";
      case "ready":
        return "ok";
      case "error":
        return "error";
    }
  }, [scan.status]);

  const scanError = scan.status === "error" ? scan.error : null;

  return (
    <div className="aiLibraryTab">
      <div className="aiLibraryTab__grid">
        <div className="aiLibraryTab__mainCol">
          <SSection
            title="AI ライブラリ"
            description="エンジン本体・評価関数・定跡DBをまとめて管理する場所です（推奨：専用フォルダを1つ作成して固定）。"
            actions={
              <div className="aiLibraryTab__badge" data-tone={badge.tone}>
                {badge.text}
              </div>
            }
          >
            <SField
              label="フォルダ"
              description="決めたルールのフォルダ構成でファイルを置くと自動検出します。"
              right={
                <div className="aiLibraryTab__fieldActions">
                  <Button tone="accent" size="sm" onClick={onPick}>
                    <FolderOpen size={16} style={{ marginRight: 6 }} />
                    選択…
                  </Button>
                  <Button
                    size="sm"
                    onClick={onOpenAiRoot}
                    disabled={!canOperate}
                    title="Finder/Explorer で開く"
                  >
                    開く
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => copyText(localAiRoot)}
                    disabled={!canOperate}
                    title="パスをコピー"
                  >
                    <Copy size={16} />
                  </Button>
                </div>
              }
            >
              <SInput
                value={localAiRoot}
                placeholder="未設定（選択… からフォルダを選択してください）"
                readOnly
              />
            </SField>

            <div className="aiLibraryTab__rowActions">
              {canCreateEnginesDir(enginesDir) && (
                <Button
                  tone="accent"
                  size="sm"
                  onClick={onEnsureEngines}
                  disabled={!canOperate || scan.status === "loading"}
                >
                  <Sparkles size={16} style={{ marginRight: 6 }} />
                  engines/ を作成
                </Button>
              )}
              <Button
                size="sm"
                onClick={onOpenEnginesDir}
                disabled={!canOperate || !revealable}
                title="engines/ を開く"
              >
                engines/ を開く
              </Button>
            </div>

            {scan.status === "error" && (
              <div className="aiLibraryTab__error" role="alert">
                {scan.error}
              </div>
            )}
          </SSection>
        </div>

        <SetupGuide
          aiRootPath={localAiRoot || null}
          scanStatus={scanStatus}
          scanError={scanError}
          enginesDir={enginesDir}
          indexed={data !== null}
          enginesDirPath={enginesDirPath}
          enginesCount={enginesCount}
          engineNames={engineNames}
          profiles={guideProfiles}
          warnings={warnings}
          isScanning={scan.status === "loading"}
          onSelectRoot={onPick}
          onRescan={onRescan}
          onCreateEnginesDir={onEnsureEngines}
          onOpenAiRoot={onOpenAiRoot}
          onOpenEnginesDir={onOpenEnginesDir}
          onCreateAiFolder={onCreateAiFolder}
        />
      </div>
    </div>
  );
}
