import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./AiLibraryTab.scss";

import { Copy, FolderOpen, Sparkles } from "lucide-react";

import Button from "@/shared/ui/Button/Button";
import { SField, SInput, SSection } from "../kit";
import { useAppConfig } from "@/entities/app-config";

import {
  canCreateEnginesDir,
  classifyEnginesDir,
  enginesDirRevealable,
  enginesDirUsable,
  type EnginesDir,
} from "@/entities/engine/lib/enginesDir";
import {
  scanAiRoot,
  createAiProfileDirs,
  ensureEnginesDir,
  type AiRootIndex,
  type ProfileCandidate,
} from "@/entities/engine/api/aiLibrary";

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
 * 読めた索引と、**それがどのルートのものか**。
 *
 * ルートを持たせないと、別のルートを選んだ直後に前のルートの索引が画面に残り、
 * 「engines/ を開く」が**前のフォルダを開いて成功する**。押した人に手掛かりは残らない。
 */
type LoadedIndex = { root: string; index: AiRootIndex };

/**
 * **進行中と失敗のときも、最後に読めた索引を持ち歩く。**
 *
 * 捨てた回は `classifyEnginesDir` の `unknown` に落ちる。`unknown` で
 * 「engines/ を作成」を出さないのは規則どおり（`EnginesDir` の doc）だが、
 * **同時に「開く」も閉じ、手順書の段も塞がり、押したボタン自身が消える**——
 * 作成済みのフォルダに対してできることが1つも無い画面が、押した本人の操作で現れる。
 * スキャンと無関係な失敗（名前の重複など）でも同じことが起きる。
 *
 * **ルートを読めなかった回だけは捨てる**（`scanNow` の catch）。その索引はもう根拠が無い。
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
 * 「開けなかった」の通知。**文面の決まりは `docs/spec/screens/settings.md`**（ここはその実装）。
 *
 * 段と見せ方は ADR-0004 の F-13（自分で消える toast、ボタン無し）。
 * **場所を確かめる必要があるのに `info` に留めるのは、復帰の操作が通知の外にあるから**——
 * 「選択…」は常設で、「engines/ を作成」は読み直しで消えていたときに現れる。
 * 自動で消える通知に動作を持たせられないのは型の側（`NotifyRequest`）が決めている。
 *
 * doc に残すのは**コードを読んでも分からないもの**だけ——鍵にパスを混ぜるのは、
 * 別のフォルダの失敗まで1枚に畳むと、どちらが開けなかったのか分からなくなるため。
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
 * AI フォルダを作っている最中に AI ルートが変わった回の通知。
 *
 * **黙らない。** 関門を通る時点で「旧ルートに作れたか」は分かっているのに、
 * 画面はもう別のルートを指しているので一覧にも出ない。黙ると、押した人には
 * 「失敗した」ようにしか見えず、もう一度押して**新しいルートにもう1つ**作ることになる。
 *
 * **段は成否で割る。** 見せ方は F-13 と同じ（自分で消える toast、ボタン無し）だが、
 * 段まで同じにすると、6秒で消える通知で成功と失敗の差が**題の末尾の1語**だけになる
 * （記号も面も `role` も段が決めるので、`info` の2枚は完全に同じ見た目になる）。
 * 作れた回は `info`（利用者は何もしなくてよい）、作れなかった回は `warning`
 * （直せば通る見込みがある）。**本文は3つに割る**——名前で落ちた回に
 * 「同じ名前で作り直せます」と言うと、欄に残っている赤字と正面から食い違う。
 * 文面の決まりは `docs/spec/screens/settings.md`。
 */
type StaleCreateOutcome = "created" | "name-error" | "failed";

const STALE_CREATE_BODY: Record<StaleCreateOutcome, string> = {
  created: "切り替える前の AI ルートでの結果です",
  // 名前で落ちた回に「同じ名前で作り直せます」と言うと、欄に残っている赤字と正面から食い違う
  "name-error": "名前を直してから作り直してください",
  failed: "同じ名前で作り直せます",
};

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

/**
 * 「検出された問題」に出す一言。**`Record` で持つ**——網羅の理由は `EnginesDir` の doc。
 * `null` は「この状態では何も言わない」
 */
const ENGINES_DIR_WARNING: Record<EnginesDir, string | null> = {
  unknown: null,
  dir: null,
  missing: "engines/ が見つかりません。『engines/ を作成』で生成できます。",
  // 在るものを「見つかりません」と言うと、作成を押させて英文の失敗に突き当たる
  other: "engines がフォルダではありません。同じ名前のものを外してください。",
};

export default function AiLibraryTab() {
  const { config, chooseAiRoot } = useAppConfig();
  const { notify } = useNotify();

  const aiRoot = config?.ai_root ?? "";
  const [localAiRoot, setLocalAiRoot] = useState(aiRoot);

  const [scan, setScan] = useState<ScanState>({ status: "idle" });

  /**
   * 出したスキャンの世代。**遅れて届いた結果を捨てるために要る。**
   *
   * 読み直しは利用者の指示なしにも走る（開けなかったとき）ので、
   * 古い要求の結果が新しい要求の後に届く並びが現実にある。上書きさせると、
   * 画面のルートと索引のルートがずれる
   */
  const scanSeqRef = useRef(0);

  /**
   * いま画面が指しているルート。**`await` を跨いだ後の書き込みを関門するために要る。**
   *
   * `scanNow` 以外で `await` を跨ぐ口のうち、**ここで関門するのは3つ**。扱いは2通り。
   *
   * - 作成の2つ（`ensureEnginesDir` / `createAiProfileDirs`）は**呼ぶ前のルートを閉包に持つ**ので、
   *   書く前にここと突き合わせて、変わっていたら書かない。前のルートの結果を新しいルートの
   *   画面へ書き込むと、バッジは「OK」なのに中身は空、という形になる
   * - 開けなかったときの読み直しは逆で、**押した時点のルートを使わず、ここの現在値で走らせる**。
   *   押した後に選び直されていたら、新しいルートを読み直すのが正しい
   *
   * ルート自体を決める `onPick` も `await` を跨ぐが、関門はしない（新しいルートは
   * その関数が持っている）。**`onPick` が読むのは `await` の前だけ**——
   * そちらは分岐の材料に使うので、後で読むと effect の書き込みと競って判定が反転する。
   * 上の3つは逆で、**`await` の後に読むのが関門の定義**そのもの。
   * **書くのはルートが変わる場所**——レンダで書くと、選び直した直後に返る継続が
   * 再レンダより先に走る窓で、関門が前のルートを見て素通りする。
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

      // **ルートを読めなかったのだから、その索引はもう根拠が無い。**
      // 残すと「engines フォルダ: あり」のまま作り直す口が出ず、
      // 開くボタンも押せたままで、同じ失敗を繰り返すだけになる
      setScan({ status: "error", error: e instanceof Error ? e.message : String(e), last: null });
    }
  }, []);

  const refresh = useCallback(async () => scanNow(localAiRoot), [localAiRoot, scanNow]);

  /**
   * 設定のルートが決まったら読み直す。**初回だけの effect にしない。**
   *
   * `config` は起動時に非同期で届くので、この画面が `null` で mount する回がある
   * （設定を開いたまま再読み込みした等）。初回だけの形だと、そのときは空文字を見て
   * 何もしないまま済ませ、後から届いたルートは誰もスキャンしない——
   * 正常なフォルダを持っている利用者に「読めていません」と言い続けることになる。
   * 二重に走る分は世代（`scanSeqRef`）が畳む。
   */
  useEffect(() => {
    currentRootRef.current = aiRoot.trim();
    setLocalAiRoot(aiRoot);
    if (aiRoot.trim()) void scanNow(aiRoot);
  }, [aiRoot, scanNow]);

  // `SetupGuide` の `nextAction` はこれを依存に持つ。その場で作ると毎レンダ変わり、
  // 組み立てが一度もキャッシュに当たらない。**同じ配列の `onSelectRoot` は別の理由で
  // 不安定**——`chooseAiRoot` が context の値ごと毎レンダ入れ替わる（#451）
  const onRescan = useCallback(() => void refresh(), [refresh]);

  // **別のルートの索引は使わない。** 切り替え直後は「まだ何も読めていない」が正しい
  const loaded = lastIndex(scan);
  const data = loaded && loaded.root === localAiRoot.trim() ? loaded.index : null;

  const enginesDir = classifyEnginesDir(data?.engines_dir);

  const warnings = useMemo(() => {
    if (!data) return [] as string[];
    const ws: string[] = [];
    const dir = classifyEnginesDir(data.engines_dir);
    const enginesWarning = ENGINES_DIR_WARNING[dir];
    if (enginesWarning) ws.push(enginesWarning);

    // **`engines/` が使えるときだけ言う。** 無い回・フォルダでない回に続けて言うと、
    // 1行目が「フォルダではない」と言った当のものの中へ置け、と指示することになる
    if (enginesDirUsable(dir) && (data.engines?.length ?? 0) === 0) {
      ws.push("エンジン実行ファイルが未検出です。engines/ 配下に置いてください。");
    }
    for (const p of data.profiles ?? []) {
      const { okEval, okBook } = profileHealth(p);
      if (!okEval) ws.push(`「${p.name}」: eval が未検出です（<AI名>/eval に nn.bin 等）。`);
      if (!okBook) ws.push(`「${p.name}」: book が未検出です（<AI名>/book に .db）。`);
    }
    return ws;
  }, [data]);

  const enginesCount = data?.engines?.length ?? 0;
  const engineNames = useMemo(() => data?.engines?.map((e) => e.entry) ?? [], [data]);

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
    // **判定の材料は `await` の前に取る。** `currentRootRef` は effect も書くので、
    // 返った後に読むと「押した時点のルート」ではなく「その瞬間の値」になる。
    // 設定の更新が独自にレンダを予約する形（provider に `await` が1つ入るだけ）なら、
    // 継続より先に effect が走って ref はもう新しいルートを指し、下の判定が反転する
    // ——同じルートでもないのに `scanNow` が走り、新しいルートを2回走査する
    const before = currentRootRef.current;

    const picked = await chooseAiRoot({ force: true });
    if (!picked.success) {
      setScan((s) => ({ status: "error", error: picked.error, last: lastIndex(s) }));
      return;
    }
    if (picked.data === null) return; // 取り消し

    // **レンダを待たずに書く。** 選び直した直後に返る `await` の継続は、
    // 再レンダより先に走る——レンダで更新する形だと、その窓で関門が素通りする
    const sameRoot = picked.data.trim() === before;
    currentRootRef.current = picked.data.trim();
    setLocalAiRoot(picked.data);

    // `chooseAiRoot` は設定を書き換えてから返るので、**別のルートなら effect が読む**。
    // ここでも呼ぶと同じルートを2回走査することになる。同じルートを選び直した回
    // （効かなくなった外付けを繋ぎ直した等）は `aiRoot` が変わらないので、ここで呼ぶ
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
   * 開きに行き、開けなければ通知に出す。**スキャンの診断へは回さない。**
   *
   * `scan` に積むと見出しが「フォルダを確認できませんでした」になる。読み取りの失敗を
   * 指す見出しなので嘘になるし、**索引が古い可能性はこの関数が読み直して片付ける**ので、
   * 利用者に再スキャンを押させる必要も無い。
   * 文面は `revealFailureNotice` が持つ。
   *
   * 例外の本文は出さない。プラグインの英語の文言は、利用者の次の一手を決めない
   */
  const revealOrNotify = useCallback(
    async (label: string, path: string) => {
      const revealed = await revealInFileManager(path);
      if (revealed.success) return;

      // 画面には利用者の言葉、原因はログ（`Notice` の方針）。理由は環境ごとに違う
      // （見つからない / D-Bus が居ない / API が無い）ので、画面の文言だけでは決められない。
      // **届くのは開発中だけ**——webview の console は配布ビルドに残らない（TODO(#448)）
      console.error("[AiLibraryTab] フォルダを開けなかった", path, revealed.error);

      // **2つの原因のうち「そこに無い」側だけが索引で直せる。** 読み直さないと、
      // 画面は「あり」のまま、消えたフォルダを作り直す口（「engines/ を作成」）が
      // どこにも出ない。呼べないだけの環境では空振りするが、無い方を放置するより軽い。
      //
      // 読み直すのは**いま指しているルート**。押した後に選び直されていると、
      // 押した時点のルートで走らせた結果が新しいルートの画面を上書きする
      void scanNow(currentRootRef.current);

      notify(revealFailureNotice(label, path));
    },
    [notify, scanNow],
  );

  const onOpenAiRoot = useCallback(() => {
    if (localAiRoot.trim()) void revealOrNotify("AI ルート", localAiRoot);
  }, [localAiRoot, revealOrNotify]);

  // **索引に載っているパスだけを開きに行く。** 押せる条件は `enginesDirRevealable` が持つので、
  // 読めていない回に当て推量（`<root>/engines`）で空を埋める必要は無い
  const enginesDirPath = data?.engines_dir?.path ?? "";

  const onOpenEnginesDir = useCallback(() => {
    if (enginesDirPath.trim()) void revealOrNotify("engines/", enginesDirPath);
  }, [enginesDirPath, revealOrNotify]);

  const revealable = enginesDirRevealable(enginesDir);

  /**
   * AI フォルダを作る。**名前の失敗だけを呼び出し元へ返す。**
   *
   * 全部を `scan` の状態へ移すと、見出しが「フォルダを確認できませんでした」、
   * 主動作が「再スキャン」になる。読み取りは成功しているので嘘だし、名前を
   * 直さない限り再スキャンは何も変えない。
   *
   * 逆に全部を名前の欄へ出すと、AI ルートが消えている（外付けを外した等）
   * ときに「名前が悪い」という位置に出る。利用者は名前を打ち直し続ける。
   * 振り分けは code で決める（`file-tree` の `failToNameInput` と同じ形）。
   *
   * 宛先を失った回（`"stale"`）を成功と分けるのは呼び出し元のため。
   * 理由は `CreateAiFolderResult` の doc
   */
  const onCreateAiFolder = useCallback(
    async (aiName: string): Promise<CreateAiFolderResult> => {
      const root = localAiRoot.trim();
      const name = aiName.trim();
      if (!root || !name) return "stale";

      const created = await createAiProfileDirs(root, name);
      if (root !== currentRootRef.current) {
        // 画面はもう別のルートを指しているので、この結果は一覧に出ない。通知で伝える。
        // **名前で落ちた回を分ける**——同じ名前では何度やっても通らないので、
        // 「同じ名前で作り直せます」は嘘になる（その赤字は欄に残っている）
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

        // 名前では直せない。AI ルートの診断側へ回す
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
            title="AIライブラリ"
            description="エンジン本体・評価関数・定跡DBをまとめて管理する場所です（推奨：専用フォルダを1つ作って固定）。"
            actions={
              <div className="aiLibraryTab__badge" data-tone={badge.tone}>
                {badge.text}
              </div>
            }
          >
            <SField
              label="AIルート（ai_root）"
              description="決めたルールのフォルダ構成でファイルを置くと自動検出します。"
              right={
                <div className="aiLibraryTab__fieldActions">
                  <Button tone="primary" size="sm" onClick={onPick}>
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
                placeholder="未設定（選択… からフォルダを選んでください）"
                readOnly
              />
            </SField>

            <div className="aiLibraryTab__rowActions">
              {/* 出すのは「無い」と読めている回だけ。分類の理由は `EnginesDir` の doc */}
              {canCreateEnginesDir(enginesDir) && (
                <Button
                  size="sm"
                  onClick={onEnsureEngines}
                  disabled={!canOperate || scan.status === "loading"}
                >
                  <Sparkles size={16} style={{ marginRight: 6 }} />
                  engines/ を作成
                </Button>
              )}
              {/* 在らないフォルダは開けない。押させると、無い場所を探させることになる */}
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
