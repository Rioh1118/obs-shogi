import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { useGame } from "@/entities/game";
import type { KifuCursor } from "@/entities/kifu/model/cursor";
import { editorTextToLines, linesToEditorText } from "../lib/commentText";
import FloatingNote from "@/shared/ui/floating-note/FloatingNote";
import LiveMarkdownNote from "@/shared/ui/live-markdown-note/LiveMarkdownNote";
import "./KifuCommentNote.scss";

type Props = {
  open: boolean;
  cursor: KifuCursor | null;
  /** このノートを開いた時点の棋譜。いま読み込まれている棋譜と違うなら保存しない */
  absPath: string | null;
  anchorEl: HTMLButtonElement | null;
  onClose: () => void;
};

/**
 * Lexical を作り直させる鍵。
 *
 * **棋譜の識別子を混ぜる。** `LexicalComposer` は `initialConfig` を mount 時にしか
 * 読まないので、鍵が同じままだと `initialMarkdown` が変わってもエディタの中身は
 * 前の棋譜の本文のまま残る。手数と変化だけで鍵を作ると、別のファイルの同じ手数が
 * 同じ鍵になる。
 */
function editorKeyFor(cursor: KifuCursor | null, absPath: string | null) {
  if (!cursor) return `no-cursor__${absPath ?? ""}`;
  const path = (cursor.forkPointers ?? []).map((p) => `${p.te}:${p.forkIndex}`).join("|");
  return `${absPath ?? ""}__${cursor.tesuu}__${path}`;
}

/** ノートが出している面。書く先はこの3つで決まる */
type Face = { key: string; cursor: KifuCursor; absPath: string | null };

export default function KifuCommentNote({ open, cursor, absPath, anchorEl, onClose }: Props) {
  const { state, getCommentsByCursor, setCommentsByCursor } = useGame();

  const [draft, setDraft] = useState("");
  const [baseText, setBaseText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sourceText = useMemo(() => {
    if (!cursor) return "";
    return linesToEditorText(getCommentsByCursor(cursor));
  }, [cursor, getCommentsByCursor]);

  const editorKey = editorKeyFor(cursor, absPath);
  const dirty = draft !== baseText;

  // いま出している面。`open` が false のときは面が無い。
  const face = useMemo<Face | null>(
    () => (open && cursor ? { key: editorKey, cursor, absPath } : null),
    [open, cursor, absPath, editorKey],
  );

  /**
   * 書けなかった本文を、その面の鍵ごと預かる。
   *
   * ノートが閉じている間は失敗を出す場所が無い（`FloatingNote` は閉じていると
   * DOM ごと消える）。捨てると、利用者は**書いたことも失敗したことも知らないまま**
   * 本文を失う。同じ面へ戻ってきたときに出せるよう、鍵と対で持っておく。
   */
  const retainedRef = useRef<{ key: string; draft: string; error: string } | null>(null);

  const stateRef = useRef({ draft, isSaving, loadedAbsPath: state.loadedAbsPath });
  useEffect(() => {
    stateRef.current = { draft, isSaving, loadedAbsPath: state.loadedAbsPath };
  });

  /**
   * 指定した面へ書く。**書く先を引数で受け取る。**
   *
   * 面は書き込みを待っている間に変わる（別の手のコメントを開く、別のファイルを開く、
   * 分岐メニューを開いてノートが閉じる）。`stateRef` の「いまの面」を読むと、
   * 待っている間に入れ替わった別の面へ書くことになる。
   *
   * 書けたときだけ `baseText` を進める。失敗しても進めると `dirty` が落ちて、
   * autosave も閉じるときの保存も二度と走らない。
   * **画面には「保存済み」だけが出て、書いた本文はどこにも残らない。**
   *
   * `"skipped"` と `"failed"` を分けるのは、閉じてよいかが逆だから。
   * 宛先が変わったなら書く先がもう無いので閉じてよい。書き込みに失敗したなら、
   * 閉じると本文が消えるので閉じない。
   */
  const doSave = useCallback(
    async (target: Face, text: string): Promise<"saved" | "failed" | "skipped"> => {
      if (stateRef.current.isSaving) return "skipped";

      // **開いた棋譜と、いま読み込まれている棋譜が同じときだけ書く。**
      // `setCommentsByCursor` は現在の `state.jkf` を複製して当てるので、
      // 棋譜が差し替わったあとに走ると、前のファイルの本文が**次のファイルの
      // 同じ手数へ**書き込まれる。エディタを作り直す前に autosave が撃つ競合が
      // 残るので、鍵（`editorKeyFor`）だけでは塞がらない。
      if (target.absPath !== stateRef.current.loadedAbsPath) return "skipped";

      setIsSaving(true);
      try {
        const res = await setCommentsByCursor(target.cursor, editorTextToLines(text));
        if (!res.success) {
          retainedRef.current = { key: target.key, draft: text, error: res.error };
          setSaveError(res.error);
          return "failed";
        }

        if (retainedRef.current?.key === target.key) retainedRef.current = null;
        setSaveError(null);
        setBaseText(text);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1200);
        return "saved";
      } finally {
        setIsSaving(false);
      }
    },
    [setCommentsByCursor],
  );

  // **面が入れ替わる前に、出ていく面を書き切る。**
  //
  // ノートは `KifuStreamList` が `setOpenComment(null)` / 別の面の `setOpenComment(...)` を
  // 直に呼ぶ経路でも閉じたり移ったりする（分岐メニュー・手のメニュー・棋譜の差し替え）。
  // そこは閉じる手続き（`handleRequestClose`）を通らないので、ここで書かないと
  // **書きかけの本文が黙って消える**。900ms のタイマーもまだ来ていない。
  //
  // 書けなかったぶんは `retainedRef` に預け、同じ面へ戻ってきたら本文ごと出し直す。
  const loadedFaceRef = useRef<Face | null>(null);
  const doSaveRef = useRef(doSave);
  useEffect(() => {
    const prev = loadedFaceRef.current;
    if (prev?.key === face?.key) return;
    loadedFaceRef.current = face;

    if (prev && stateRef.current.draft !== baseText) {
      void doSaveRef.current(prev, stateRef.current.draft);
    }

    if (!face) return;

    const retained = retainedRef.current;
    if (retained?.key === face.key) {
      // 書けなかった本文を出し直す。`baseText` は取り込んだ値のままにして
      // `dirty` を立てておく（**この本文はまだディスクに無い**）。
      setDraft(retained.draft);
      setBaseText(sourceText);
      setSaveError(retained.error);
      return;
    }

    setDraft(sourceText);
    setBaseText(sourceText);
    setSaveError(null);
    // `baseText` / `sourceText` は「出ていく面が書きかけか」の判定にだけ使う。
    // 依存に入れると、棋譜が動くたびに面の入れ替えとして走ってしまう
  }, [face]); // oxlint-disable-line react-hooks/exhaustive-deps

  // **タイマーは最新の `doSave` を呼ぶ。** 下の効果は `draft` だけを見るので、
  // `doSave` を直に渡すと**最後の打鍵時点の closure**が 900ms 後に走る。
  // `doSave` → `setCommentsByCursor` → `edit` は `state.jkf` を閉じ込めているため、
  // その間に盤で指した手を含まない棋譜を書き戻すことになる（指した手が消える）。
  doSaveRef.current = doSave;

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || !face) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }

    // 撃つ先を張った時点で固定する。900ms の間に面が入れ替わっても、
    // 書くのはこの本文を打った面。入れ替わり自体は上の効果が書き切る
    const target = face;
    autoSaveTimerRef.current = setTimeout(() => void doSaveRef.current(target, draft), 900);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
    // `doSave` は入れない。入れると毎レンダでタイマーが張り直され、
    // 打鍵が止まっても 900ms が来ない。最新は `doSaveRef` から読む
  }, [draft, face, dirty]); // oxlint-disable-line react-hooks/exhaustive-deps

  const handleRequestClose = useCallback(async () => {
    if (isSaving) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    // **閉じる前に必ずもう一度書きにいく。** 失敗が出ているからと飛ばすと、
    // 一時的な失敗（別のプロセスが掴んでいた等）でも本文が捨てられる。
    //
    // 閉じないのは**失敗を初めて出したときだけ**。止め続けると、書き込めない場所に
    // 置いた棋譜ではノートを閉じる手段が1つも無くなる（失敗を伝えるより悪い
    // 行き止まり）。2回目は諦めて閉じる。本文が失われることは `saveError` の箱が
    // 「閉じると、この本文は失われます」と先に伝えている。
    if (dirty && face) {
      const result = await doSave(face, draft);
      if (result === "failed" && !saveError) return;
      // 諦めて閉じるなら、預かっているぶんも捨てる。残すと次に同じ手を開いたときに
      // 「閉じると失われます」と伝えたはずの本文が戻ってくる
      if (result === "failed" && retainedRef.current?.key === face.key) retainedRef.current = null;
    }
    onClose();
  }, [draft, face, dirty, doSave, isSaving, onClose, saveError]);

  const moveLabel = cursor ? (cursor.tesuu === 0 ? "開始" : `${cursor.tesuu}手`) : "コメント";

  const title = (
    <div className="kifu-comment-note__titlebar">
      <span className="kifu-comment-note__pill kifu-comment-note__pill--label">
        <MessageSquareText size={12} strokeWidth={2.1} />
        <span>comment</span>
      </span>
      <span className="kifu-comment-note__pill kifu-comment-note__pill--meta">{moveLabel}</span>
    </div>
  );

  return (
    <FloatingNote
      open={open}
      anchorEl={anchorEl}
      onClose={() => void handleRequestClose()}
      title={title}
      width={400}
      className="kifu-comment-note"
    >
      <div className="kifu-comment-note__root">
        <LiveMarkdownNote
          key={editorKey}
          // **書きかけなら下書きから組む。** `FloatingNote` は閉じている間 DOM ごと
          // 消えるので、開き直すたびにエディタは作り直される。`sourceText`（メモリの
          // 棋譜）から組むと、預かっている本文が `draft` にあるのに画面には出ない。
          // その状態で Escape を押すと、**画面に出ていなかった文字列がファイルに入る**。
          initialMarkdown={dirty ? draft : sourceText}
          placeholder="コメントを書く…  # 見出し / - リスト / > 引用"
          onMarkdownChange={setDraft}
          onSubmitShortcut={() => void handleRequestClose()}
        />
        {/* 領域は常設する（空でも DOM に置く）。中身と同時に入れると VoiceOver が
            live region の変化として読まない。面も宣言する。宣言しないと
            `contrastRatchet` が「面が決まらない」として測れない枠へ落とす */}
        <div className="kifu-comment-note__error" role="alert">
          {saveError && (
            <>
              <span className="kifu-comment-note__errorHead">
                保存できませんでした。書いた本文はこのまま残っています。
              </span>
              <span className="kifu-comment-note__errorCause">{saveError}</span>
              <span className="kifu-comment-note__errorHint">
                続けて書けば保存し直します。閉じると、この本文は失われます。
              </span>
            </>
          )}
        </div>
        {!saveError && (isSaving || savedFlash) && (
          <div className="kifu-comment-note__status">{isSaving ? "保存中" : "保存済み"}</div>
        )}
      </div>
    </FloatingNote>
  );
}
