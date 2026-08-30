import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { useGame } from "@/entities/game";
import type { KifuCursor } from "@/entities/kifu/model/cursor";
import { editorTextToLines, linesToEditorText } from "../lib/commentText";
import {
  dropUnsavedDraft,
  dropUnsavedDraftIfUnchanged,
  getUnsavedDraft,
  putUnsavedDraft,
} from "../lib/unsavedDrafts";
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
 * ノートが出している面。書く先も、下書きの持ち主も、これで決まる。
 *
 * **棋譜の識別子を混ぜる。** 手数と変化だけで鍵を作ると、別のファイルの同じ手数が
 * 同じ鍵になり、預かった下書きが別のファイルへ出る。
 */
type Face = { key: string; cursor: KifuCursor; absPath: string | null };

function faceKeyFor(cursor: KifuCursor, absPath: string | null) {
  const path = (cursor.forkPointers ?? []).map((p) => `${p.te}:${p.forkIndex}`).join("|");
  return `${absPath ?? ""}__${cursor.tesuu}__${path}`;
}

/** ノートが出している面の、確定した中身。鍵と本文が必ず同じコミットで揃う */
type Editing = { face: Face; draft: string; baseText: string; error: string | null };

export default function KifuCommentNote({ open, cursor, absPath, anchorEl, onClose }: Props) {
  const { state, getCommentsByCursor, setCommentsByCursor } = useGame();

  const [status, setStatus] = useState<{ key: string; kind: "saving" | "saved" } | null>(null);

  const sourceText = useMemo(() => {
    if (!cursor) return "";
    return linesToEditorText(getCommentsByCursor(cursor));
  }, [cursor, getCommentsByCursor]);

  const face = useMemo<Face | null>(
    () => (open && cursor ? { key: faceKeyFor(cursor, absPath), cursor, absPath } : null),
    [open, cursor, absPath],
  );

  // **面はレンダ中に確定させる。**
  //
  // 効果で差し替えると、エディタを作り直す鍵（props 由来）だけが1レンダ先に進み、
  // **移った先のエディタが前の手の本文で mount される**。`LexicalComposer` は
  // `initialConfig` を mount 時にしか読まないので、そのまま最後まで残る。
  const [editing, setEditing] = useState<Editing | null>(null);
  if (face) {
    if (editing?.face.key !== face.key) {
      const kept = getUnsavedDraft(face.key);
      setEditing({
        face,
        draft: kept?.draft ?? sourceText,
        baseText: sourceText,
        error: kept?.error ?? null,
      });
    }
  } else if (editing) {
    setEditing(null);
  }

  const dirty = editing != null && editing.draft !== editing.baseText;

  const destRef = useRef({ loadedAbsPath: state.loadedAbsPath });
  useEffect(() => {
    destRef.current = { loadedAbsPath: state.loadedAbsPath };
  });

  /**
   * 走っている保存の列。**同じノートから2本同時に撃たない。**
   *
   * 撃てないぶんを捨てると、利用者から見えるのは「保存済み」だけで、最後に打った本文は
   * どこにも入っていない。並べて待たせれば捨てる判断そのものが要らない。
   */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  /** いま描いている面。書き込みが返ってきたときに、書き戻してよいかをこれで見る */
  const faceRef = useRef<Face | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 指定した面へ書く。**書く先も、書き戻す先も、面で決める。**
   *
   * 面は書き込みを待っている間に変わる（別の手のコメントを開く、別のファイルを開く、
   * 分岐メニューを開いてノートが閉じる）。「いまの面」を読むと、待っている間に
   * 入れ替わった別の面へ書き、打っていない手のノートに結果が出る。
   *
   * 書けなかったぶんは必ず預ける。**書かずに戻る出口も含めて**。
   * 預けないと、そこが「書いた本文がどこにも残らない」穴になる。
   */
  const save = useCallback(
    (target: Face, text: string): Promise<"saved" | "failed" | "skipped"> => {
      const saveOnce = async (): Promise<"saved" | "failed" | "skipped"> => {
        const showing = () => faceRef.current?.key === target.key;

        // **開いた棋譜と、いま読み込まれている棋譜が同じときだけ書く。**
        // `setCommentsByCursor` は現在の `state.jkf` を複製して当てるので、
        // 棋譜が差し替わったあとに走ると、前のファイルの本文が**次のファイルの
        // 同じ手数へ**書き込まれる。鍵だけでは塞がらない。
        if (target.absPath !== destRef.current.loadedAbsPath) {
          const msg = "棋譜が切り替わったので保存できませんでした";
          const seen = showing();
          putUnsavedDraft(target.key, { draft: text, error: msg, told: seen });
          if (seen) setEditing((e) => (e && e.face.key === target.key ? { ...e, error: msg } : e));
          return "skipped";
        }

        // 掃除は**預かりの実体**で判定する（`dropUnsavedDraftIfUnchanged` の doc を参照）。
        const before = getUnsavedDraft(target.key);

        setStatus({ key: target.key, kind: "saving" });
        try {
          const res = await setCommentsByCursor(target.cursor, editorTextToLines(text));

          if (!res.success) {
            const seen = showing();
            // 待っている間に打ち足したぶんがあれば、そちらを残す（古い本文で潰さない）
            const kept = getUnsavedDraft(target.key);
            putUnsavedDraft(target.key, {
              draft: kept?.draft ?? text,
              error: res.error,
              told: seen,
            });
            if (seen)
              setEditing((e) => (e && e.face.key === target.key ? { ...e, error: res.error } : e));
            return "failed";
          }

          dropUnsavedDraftIfUnchanged(target.key, before);

          if (showing()) {
            setEditing((e) =>
              e && e.face.key === target.key ? { ...e, baseText: text, error: null } : e,
            );
            setStatus({ key: target.key, kind: "saved" });
            flashTimerRef.current = setTimeout(
              () => setStatus((s) => (s?.key === target.key && s.kind === "saved" ? null : s)),
              1200,
            );
            return "saved";
          }
          return "saved";
        } finally {
          setStatus((s) => (s?.key === target.key && s.kind === "saving" ? null : s));
        }
      };

      const next = chainRef.current.then(saveOnce, saveOnce);
      chainRef.current = next;
      return next;
    },
    [setCommentsByCursor],
  );

  const saveRef = useRef(save);
  saveRef.current = save;

  // **面が入れ替わる前に、出ていく面を書き切る。**
  //
  // ノートは `KifuStreamList` が `setOpenComment(null)` / 別の面の `setOpenComment(...)` を
  // 直に呼ぶ経路でも閉じたり移ったりする（分岐メニュー・手のメニュー・棋譜の差し替え）。
  // そこは閉じる手続きを通らないので、ここで書かないと**書きかけの本文が黙って消える**。
  const leavingRef = useRef<Editing | null>(null);
  useEffect(() => {
    const prev = leavingRef.current;
    leavingRef.current = editing;
    faceRef.current = editing?.face ?? null;

    if (!prev || prev.face.key === editing?.face.key) return;

    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setStatus(null);

    if (prev.draft !== prev.baseText) void saveRef.current(prev.face, prev.draft);
  }, [editing]);

  // unmount では書きに行けない（`await` できない）ので、預けるだけ預ける。
  // 置き場がコンポーネントの外にあるので、開き直せば出せる。
  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      const cur = leavingRef.current;
      if (cur && cur.draft !== cur.baseText && !getUnsavedDraft(cur.face.key))
        putUnsavedDraft(cur.face.key, {
          draft: cur.draft,
          error: "棋譜を閉じたので保存できませんでした",
          told: false,
        });
    },
    [],
  );

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || !editing) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }

    // 撃つ先を張った時点で固定する。900ms の間に面が入れ替わっても、
    // 書くのはこの本文を打った面。入れ替わり自体は上の効果が書き切る
    const target = editing.face;
    const text = editing.draft;
    autoSaveTimerRef.current = setTimeout(() => void saveRef.current(target, text), 900);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [editing, dirty]);

  const handleRequestClose = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    // **閉じる前に必ずもう一度書きにいく。** 失敗が出ているからと飛ばすと、
    // 一時的な失敗（別のプロセスが掴んでいた等）でも本文が捨てられる。
    //
    // 閉じないのは**この面で失敗を見せたのが初めてのときだけ**。止め続けると、
    // 書き込めない場所に置いた棋譜ではノートを閉じる手段が1つも無くなる
    // （失敗を伝えるより悪い行き止まり）。2回目は諦めて閉じる。
    if (editing && dirty) {
      const told = getUnsavedDraft(editing.face.key)?.told === true;
      const result = await save(editing.face, editing.draft);
      if (result === "failed") {
        if (!told) return;
        // 諦めて閉じる。**下書きも一緒に落とす。** 落とさないと、この直後に
        // 面が消える効果がもう1本書きに行き、いま捨てた預かりを積み直す。
        // 画面には「閉じると、この本文は失われます」と出しているので、失わせる。
        dropUnsavedDraft(editing.face.key);
        setEditing((e) => (e ? { ...e, draft: e.baseText, error: null } : e));
      }
      // `"skipped"`（宛先が消えた）は捨てない。元の棋譜へ戻れば出し直せる
    }
    onClose();
  }, [editing, dirty, save, onClose]);

  const onMarkdownChange = useCallback((text: string) => {
    setEditing((e) => (e ? { ...e, draft: text } : e));
  }, []);

  const moveLabel = cursor ? (cursor.tesuu === 0 ? "開始" : `${cursor.tesuu}手`) : "コメント";
  const saveError = editing?.error ?? null;
  const showStatus = editing && status?.key === editing.face.key ? status.kind : null;

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
        {editing && (
          <LiveMarkdownNote
            // 鍵も中身も**確定した面**から組む。片方を props から取ると1レンダずれ、
            // 移った先のエディタが前の手の本文で mount される
            key={editing.face.key}
            initialMarkdown={editing.draft}
            placeholder="コメントを書く…  # 見出し / - リスト / > 引用"
            onMarkdownChange={onMarkdownChange}
            onSubmitShortcut={() => void handleRequestClose()}
          />
        )}
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
        {!saveError && showStatus && (
          <div className="kifu-comment-note__status">
            {showStatus === "saving" ? "保存中" : "保存済み"}
          </div>
        )}
      </div>
    </FloatingNote>
  );
}
