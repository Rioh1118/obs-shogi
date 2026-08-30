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

  // **開いた面が変わったときだけ取り込む。**
  //
  // `sourceText` はメモリの棋譜から作る。`edit` は楽観的更新（ADR-0004 決定7）で
  // 書き込みの**前**に `jkf_replaced` を撃つので、書けたかどうかが決まる前に
  // `sourceText` が新しい本文になる。それを `baseText` へ入れると `dirty` が落ち、
  // **書き込みに失敗した本文が「保存済みと同じ見た目」でアプリの中に残る。**
  // 閉じて開き直しても本文は出るが、ディスクには無い。
  //
  // `open` だけでは足りない。開いたまま別の手のコメントへ移る経路があり、
  // そこでは `open` が true のままで面だけが入れ替わる。
  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      loadedKeyRef.current = null;
      return;
    }
    if (loadedKeyRef.current === editorKey) return;
    loadedKeyRef.current = editorKey;

    setDraft(sourceText);
    setBaseText(sourceText);
    setSaveError(null);
  }, [open, editorKey, sourceText]);

  const dirty = draft !== baseText;

  // 自動保存は 900ms 後に走るので、撃った時点の closure を読むと古い値で保存する。
  // 棋譜の識別子も一緒に持つ（保存の直前に突き合わせる）。
  const stateRef = useRef({ cursor, draft, isSaving, absPath, loadedAbsPath: state.loadedAbsPath });
  useEffect(() => {
    stateRef.current = { cursor, draft, isSaving, absPath, loadedAbsPath: state.loadedAbsPath };
  });

  /**
   * 書けたときだけ `baseText` を進める。
   *
   * 失敗しても進めると `dirty` が落ちて、autosave も閉じるときの保存も
   * 二度と走らない。**画面には「保存済み」だけが出て、書いた本文はどこにも残らない。**
   *
   * `"skipped"` と `"failed"` を分けるのは、閉じてよいかが逆だから。
   * 宛先が変わったなら書く先がもう無いので閉じてよい。書き込みに失敗したなら、
   * 閉じると本文が消えるので閉じない。
   */
  const doSave = useCallback(async (): Promise<"saved" | "failed" | "skipped"> => {
    const { cursor, draft, isSaving, absPath, loadedAbsPath } = stateRef.current;
    if (!cursor || isSaving) return "skipped";

    // **開いた棋譜と、いま読み込まれている棋譜が同じときだけ書く。**
    // `setCommentsByCursor` は現在の `state.jkf` を複製して当てるので、
    // 棋譜が差し替わったあとに走ると、前のファイルの本文が**次のファイルの
    // 同じ手数へ**書き込まれる。エディタを作り直す前に autosave が撃つ競合が
    // 残るので、鍵（`editorKeyFor`）だけでは塞がらない。
    if (absPath !== loadedAbsPath) return "skipped";

    setIsSaving(true);
    try {
      const res = await setCommentsByCursor(cursor, editorTextToLines(draft));
      if (!res.success) {
        setSaveError(res.error);
        return "failed";
      }

      setSaveError(null);
      setBaseText(draft);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      return "saved";
    } finally {
      setIsSaving(false);
    }
  }, [setCommentsByCursor]);

  // **タイマーは最新の `doSave` を呼ぶ。** 下の効果は `draft` だけを見るので、
  // `doSave` を直に渡すと**最後の打鍵時点の closure**が 900ms 後に走る。
  // `doSave` → `setCommentsByCursor` → `edit` は `state.jkf` を閉じ込めているため、
  // その間に盤で指した手を含まない棋譜を書き戻すことになる（指した手が消える）。
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }

    autoSaveTimerRef.current = setTimeout(() => void doSaveRef.current(), 900);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
    // `doSave` は入れない。入れると毎レンダでタイマーが張り直され、
    // 打鍵が止まっても 900ms が来ない。最新は `doSaveRef` から読む
  }, [draft]); // oxlint-disable-line react-hooks/exhaustive-deps

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
    if (dirty && cursor) {
      const result = await doSave();
      if (result === "failed" && !saveError) return;
    }
    onClose();
  }, [cursor, dirty, doSave, isSaving, onClose, saveError]);

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
          initialMarkdown={sourceText}
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
