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
import { branchGenerationOf } from "@/entities/kifu/lib/branchGeneration";
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

  // 列で待っている間に棋譜は動く。**書き込みの実体は走る時点で引き直す。**
  //
  // 撃った時点の `setCommentsByCursor` を捕まえると、その先の `edit` が
  // **撃った時点の `state.jkf`** を閉じ込めているので、待っている間に盤で指した手を
  // 含まない棋譜を書き戻す。指した手がメモリからもディスクからも消える。
  const commitRef = useRef({ setCommentsByCursor, loadedAbsPath: state.loadedAbsPath });
  useEffect(() => {
    commitRef.current = { setCommentsByCursor, loadedAbsPath: state.loadedAbsPath };
  });

  /** 走っている保存の本数。閉じるときに列を待つかの判断に使う */
  const inFlightRef = useRef(0);

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
      // **分岐の番号の世代を撃った時点で掴む。**
      //
      // `target.cursor` は `forkIndex`（`forks` 配列の位置）を含む。列で待っている間に
      // 分岐が削除・入れ替えされると、同じ番号は**別の変化**を指す。そのまま書くと
      // 打っていない変化に本文が入り、**その変化に元からあったコメントが消える**。
      // 書き込みは成功するので画面には何も出ない。
      const bornAt = branchGenerationOf(target.absPath);
      const stillValid = () => bornAt === branchGenerationOf(target.absPath);
      const stash = (value: { draft: string; error: string; told: boolean }) =>
        putUnsavedDraft(target.key, value, {
          at: bornAt,
          now: () => branchGenerationOf(target.absPath),
        });

      const saveOnce = async (): Promise<"saved" | "failed" | "skipped"> => {
        const showing = () => faceRef.current?.key === target.key;

        // **開いた棋譜と、いま読み込まれている棋譜が同じときだけ書く。**
        // `setCommentsByCursor` は現在の `state.jkf` を複製して当てるので、
        // 棋譜が差し替わったあとに走ると、前のファイルの本文が**次のファイルの
        // 同じ手数へ**書き込まれる。鍵だけでは塞がらない。
        if (target.absPath !== commitRef.current.loadedAbsPath) {
          const msg = "棋譜が切り替わったので保存できませんでした";
          const seen = showing();
          stash({ draft: text, error: msg, told: seen });
          if (seen) setEditing((e) => (e && e.face.key === target.key ? { ...e, error: msg } : e));
          return "skipped";
        }

        // 番号が動いていたら書かない。預けもしない（`stash` が世代で弾く）。
        // 本文は失われるが、残すと利用者が打った覚えのない変化へ入る。
        if (!stillValid()) {
          const msg = "分岐の並びが変わったので保存できませんでした";
          const seen = showing();
          if (seen) setEditing((e) => (e && e.face.key === target.key ? { ...e, error: msg } : e));
          return "skipped";
        }

        // 掃除は**預かりの実体**で判定する（`dropUnsavedDraftIfUnchanged` の doc を参照）。
        const before = getUnsavedDraft(target.key);

        setStatus({ key: target.key, kind: "saving" });
        inFlightRef.current += 1;
        try {
          const res = await commitRef.current.setCommentsByCursor(
            target.cursor,
            editorTextToLines(text),
          );

          if (!res.success) {
            const seen = showing();
            // **いま書こうとした本文を預ける。** 列で直列化しているので、
            // 置き場にあるのは必ずこれより古い。古いほうを残すと、
            // 「続けて書けば保存し直します」と出しながら書き足したぶんを捨てることになる。
            stash({ draft: text, error: res.error, told: seen });
            if (seen)
              setEditing((e) =>
                // 同じ理由なら参照を変えない。変えると自動保存の効果が張り直され、
                // 書けない棋譜で**毎秒1本の書き込みを永久に撃ち続ける**
                e && e.face.key === target.key && e.error !== res.error
                  ? { ...e, error: res.error }
                  : e,
              );
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
          inFlightRef.current -= 1;
          setStatus((s) => (s?.key === target.key && s.kind === "saving" ? null : s));
        }
      };

      const next = chainRef.current.then(saveOnce, saveOnce);
      chainRef.current = next;
      return next;
    },
    [],
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
      if (cur && cur.draft !== cur.baseText) {
        // **本文はいま画面に出ているものを採る。** 既に預かりがあってもそちらは
        // 必ず古い（失敗したときの本文）。古いほうを残すと、
        // 「続けて書けば保存し直します」と出しながら書き足したぶんだけを捨てる。
        // 理由と `told` は引き継ぐ（失敗を見せたかどうかは変わっていない）。
        const kept = getUnsavedDraft(cur.face.key);
        putUnsavedDraft(cur.face.key, {
          draft: cur.draft,
          error: kept?.error ?? "棋譜を閉じたので保存できませんでした",
          told: kept?.told ?? false,
        });
      }
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
    // **`editing` そのものを見ない。** 失敗の書き戻しも `editing` を作り直すので、
    // 書けない棋譜では「失敗 → 張り直し → 900ms → 失敗」で**毎秒1本の書き込みを
    // 永久に撃ち続ける**。画面には「続けて書けば保存し直します」と出しており、
    // 自動で再試行しないと宣言している。張り直す理由は本文か面が変わったときだけ。
  }, [editing?.face.key, editing?.draft, dirty]); // oxlint-disable-line react-hooks/exhaustive-deps

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
      const target = editing;
      const told = getUnsavedDraft(target.face.key)?.told === true;

      /**
       * 閉じ切る。`result` が `"failed"` なら諦めて閉じる側。
       *
       * **下書きも一緒に落とす。** 落とさないと、この直後に面が消える効果が
       * もう1本書きに行き、いま捨てた預かりを積み直す。
       * 画面には「閉じると、この本文は失われます」と出しているので、失わせる。
       *
       * `leavingRef` は**同期で**書く。`setEditing` は `onClose()` と同じバッチに
       * まとまるので、効果が読む前のコミットに載らない。ref なら巻き込まれない。
       *
       * **2つの経路（待つ／待たない）から呼ぶ。** 片方にだけ後始末を付けると、
       * 「閉じると失われます」がその経路でだけ嘘になり、`told` も false へ巻き戻って
       * 次は2回押さないと閉じなくなる。
       */
      const finish = (result: "saved" | "failed" | "skipped") => {
        // 待っている間に別の面へ移っていたら、その面を閉じない。
        // `onClose` はどの面を閉じるかを引数に取らないので、そのまま呼ぶと
        // **入力中の別の手のノートが勝手に畳まれる**。
        if (faceRef.current?.key !== target.face.key) return;

        if (result === "failed") {
          dropUnsavedDraft(target.face.key);
          const settled = { ...target, draft: target.baseText, error: null };
          leavingRef.current = settled;
          setEditing(settled);
        }
        // `"skipped"`（宛先が消えた）は捨てない。元の棋譜へ戻れば出し直せる
        onClose();
      };

      // **列が動いているなら待たない。** 待つと、他の書き込みが返ってこない間
      // 閉じるが効かなくなる（押しても何も起きず、押せない見た目にもならない）。
      //
      // ただし**閉じる判断は結果に委ねる**。ここで即座に閉じると、
      // 失敗する環境ほど確実にこの分岐を通るのに、失敗が一度も画面に出ない。
      // 押した瞬間から「保存中」が出ているので、押せない見た目にはならない。
      if (inFlightRef.current > 0) {
        void save(target.face, target.draft).then((r) => {
          if (r === "failed" && !told) return;
          finish(r);
        });
        return;
      }

      const result = await save(target.face, target.draft);
      if (result === "failed" && !told) return;
      finish(result);
      return;
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
