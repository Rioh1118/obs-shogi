import { useCallback, useMemo, useState } from "react";
import { Color } from "shogi.js";
import { DEFAULT_HANDICAP, type HandicapPreset } from "@/entities/kifu/model/handicap";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { inspectPosition } from "@/entities/position/lib/inspectPosition";
import {
  pieceAt,
  stateFromPreset,
  stateFromSfen,
  type Square,
} from "@/entities/position/lib/positionDraft";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { usePositionDraft } from "../model/usePositionDraft";
import EditorBoard from "./EditorBoard";
import EditorGhost from "./EditorGhost";
import EditorCreateForm from "./EditorCreateForm";
import EditorNotice from "./EditorNotice";
import EditorSeed from "./EditorSeed";
import EditorStand from "./EditorStand";
import EditorStudyPicker from "./EditorStudyPicker";
import EditorTurn from "./EditorTurn";
import "./PositionEditor.scss";

/** 組む面のどちらが出ているか。インポートの面は器（`create-file`）が持つ */
export type EditorFace = "board" | "study";

interface PositionEditorProps {
  /** いま出ている面。**器が1つの変数で持つ**ので、ここでは受け取るだけ */
  face: EditorFace;
  onFaceChange: (face: EditorFace) => void;
  /** ツリーから開いたときの保存先。ようこそ画面から開くと来ない */
  initialDir?: string;
  /** 作成が通ったとき。器を閉じるのは器の仕事 */
  onCreated?: () => void;
  onCancel?: () => void;
  /** 種にできる課題局面。provider はこの面から読まない */
  studyPositions?: StudyPosition[];
  /**
   * いま開いている棋譜の局面。開いていなければ `null`
   *
   * **provider をこの面から読まない。** 読むと、盤だけを描きたいときにも
   * 棋譜の文脈が要ることになり、確かめるのに器ごと組む羽目になる。
   */
  currentPosition?: JKFState | null;
}

/**
 * 初期局面を組む面
 *
 * **置き場は盤と駒台2つの3つだけ。** 駒箱を持たないので、駒の顔ぶれは種が決める
 * （→ #548）。3つに閉じると、玉3枚・駒余り・歩19枚が構造的に作れない。
 *
 * 駒台は**盤の左右**に置き、後手を盤の上端、先手を下端に揃える（対局中の盤と同じ位置）。
 * 中央に揃えると、どちらの駒台かが位置から読めなくなる。
 *
 * 開いた瞬間は平手。**空盤から始めない** —— 駒箱が無いので、空盤に置くと
 * そこから駒を1枚も足せない。
 */
function PositionEditor({
  face,
  onFaceChange,
  currentPosition = null,
  studyPositions = [],
  initialDir,
  onCreated = () => undefined,
  onCancel = () => undefined,
}: PositionEditorProps) {
  const {
    state,
    held,
    pressSquare,
    pressStand,
    flipSquare,
    toggleTurn,
    release,
    loadSeed,
    isDirty,
  } = usePositionDraft(() => stateFromPreset(DEFAULT_HANDICAP));

  // 作成中は Esc の段の**外**にある（止められないので無視する）。
  // 旗をここへ上げるのは、段を判定するのがこの面だから
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * 組みかけを捨てる確認
   *
   * **組みかけのときだけ出す。** 種を選び直すときも閉じるときも同じ。
   * 聞きすぎると、聞かれること自体が意味を失う。
   */
  const [pending, setPending] = useState<{ subtitle: string; run: () => void } | null>(null);

  /** 組みかけなら確認してから実行する */
  const confirmIfDirty = useCallback(
    (subtitle: string, run: () => void) => {
      if (!isDirty) {
        run();
        return;
      }
      setPending({ subtitle, run });
    },
    [isDirty],
  );

  // ホバーは局面ではなく見ている場所。`usePositionDraft` に混ぜると、
  // ポインタを動かすたびに組みかけの判定が走る
  const [hovered, setHovered] = useState<Square | null>(null);

  // 最後に載せた手合割。**組みかけになったら忘れる**（プレースホルダへ戻す）ので、
  // 局面そのものからは引けない
  const [handicap, setHandicap] = useState<HandicapPreset | null>(DEFAULT_HANDICAP);

  // 局面が変わったときだけ数え直す。ホバーのたびに 81 升を4回なめる必要は無い
  const inspection = useMemo(() => inspectPosition(state), [state]);

  const pickHandicap = useCallback(
    (preset: HandicapPreset) => {
      confirmIfDirty("別の手合割を載せると、いま組んでいる局面は消えます。", () => {
        loadSeed(stateFromPreset(preset));
        setHandicap(preset);
      });
    },
    [confirmIfDirty, loadSeed],
  );

  const useStudyPosition = useCallback(
    (position: StudyPosition) => {
      const seed = stateFromSfen(position.sfen);
      // 読めない SFEN は種にしない。黙って盤へ戻すと、種が変わっていないのに
      // 別の局面が載ったように見える。面に留めれば、その行が選べないことが画面から読める
      if (!seed) return;

      confirmIfDirty("この課題局面を載せると、いま組んでいる局面は消えます。", () => {
        loadSeed(seed);
        setHandicap(null);
        onFaceChange("board");
      });
    },
    [confirmIfDirty, loadSeed, onFaceChange],
  );

  const useCurrentKifu = useCallback(() => {
    if (!currentPosition) return;
    confirmIfDirty("いまの棋譜の局面を載せると、組んでいる局面は消えます。", () => {
      loadSeed(currentPosition);
      setHandicap(null);
    });
  }, [confirmIfDirty, currentPosition, loadSeed]);

  /**
   * Esc の段
   *
   * **内側から順に畳む。** 段が1つずれると、組んだものが黙って消えるか、
   * 逆に何も組んでいないのに毎回確認が出て、確認そのものが読まれなくなる。
   *
   * 器を閉じる段（一番外）だけは**何もしない。** `Modal` が `document` で
   * Escape を拾って閉じる。ここで畳んだ段は `preventDefault()` で降ろす ——
   * **`stopPropagation()` は使わない**（`document` まで届かないと
   * `defaultPrevented` の判定に到達せず、畳むものが無いときも無反応になる）。
   *
   * 受け口を DOM の要素側に置くのは、`document` に足すと `Modal` より後に
   * 登録されて、こちらが畳む前に器が閉じてしまうため。
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // 変換中の Escape は「変換を取り消す」であって、面を畳む合図ではない
      if (event.key !== "Escape" || event.nativeEvent.isComposing) return;

      // 段0: 作成中。止められないので無視する
      if (isSubmitting) {
        event.preventDefault();
        return;
      }
      // 段1: 確認が出ている。確認自身の器が閉じるので、ここへは来ない
      if (pending !== null) {
        event.preventDefault();
        return;
      }
      // 段2: 掴んでいる駒を離す
      if (held !== null) {
        event.preventDefault();
        release();
        return;
      }
      // 段3: 課題局面の面から盤の面へ戻る
      if (face === "study") {
        event.preventDefault();
        onFaceChange("board");
        return;
      }
      // 段4: 組みかけを捨てる確認
      if (isDirty) {
        event.preventDefault();
        setPending({ subtitle: "閉じると、いま組んでいる局面は消えます。", run: onCancel });
        return;
      }
      // 段5: 何もしない。器が閉じる
    },
    [isSubmitting, pending, held, face, isDirty, release, onFaceChange, onCancel],
  );

  const confirmView = pending && (
    <ConfirmDialog
      title="組んだ局面は保存されません。"
      subtitle={pending.subtitle}
      confirmLabel="捨てる"
      // フォームの「やめる」（器ごと閉じる）と同じ語にしない。**戻り先が違う** ——
      // こちらは組みかけの盤へ帰るだけ。同じ語だと、どちらを押しても
      // 同じところへ戻ると読める
      cancelLabel="組み続ける"
      onConfirm={() => {
        const run = pending.run;
        setPending(null);
        run();
      }}
      onCancel={() => setPending(null)}
    />
  );

  const heldPiece =
    held === null
      ? null
      : held.from === "hand"
        ? { kind: held.kind, color: held.color }
        : pieceAt(state, held.sq);

  if (face === "study") {
    return (
      <div className="pos-editor" onKeyDown={handleKeyDown}>
        <div className="pos-editor__main">
          <EditorStudyPicker
            positions={studyPositions}
            onPick={useStudyPosition}
            onBack={() => onFaceChange("board")}
          />
        </div>
        {confirmView}
      </div>
    );
  }

  return (
    <div className="pos-editor" onKeyDown={handleKeyDown}>
      <div className="pos-editor__main">
        <EditorSeed
          // 盤を触ったらプレースホルダに戻す。**同じ手合割を選び直せるようになる**
          handicap={isDirty ? null : handicap}
          canUseCurrentKifu={currentPosition !== null}
          onPickHandicap={pickHandicap}
          onOpenStudyPositions={() => onFaceChange("study")}
          onUseCurrentKifu={useCurrentKifu}
        />

        <div className="pos-editor__position">
          <EditorTurn color={state.color} onToggle={toggleTurn} />

          <div className="pos-editor__stand-slot pos-editor__stand-slot--gote">
            <EditorStand
              state={state}
              color={Color.White}
              held={held}
              hovered={hovered}
              onPressStand={pressStand}
            />
          </div>
          <EditorBoard
            state={state}
            held={held}
            hovered={hovered}
            illegalSquares={inspection.illegalSquares}
            onPressSquare={pressSquare}
            onFlipSquare={flipSquare}
            onHoverSquare={setHovered}
          />
          <div className="pos-editor__stand-slot pos-editor__stand-slot--sente">
            <EditorStand
              state={state}
              color={Color.Black}
              held={held}
              hovered={hovered}
              onPressStand={pressStand}
            />
          </div>
        </div>
      </div>

      <div className="pos-editor__side">
        <EditorNotice issues={inspection.issues} />
        <EditorCreateForm
          state={state}
          handicap={isDirty ? null : handicap}
          initialDir={initialDir}
          onCreated={onCreated}
          onCancel={onCancel}
          onSubmittingChange={setIsSubmitting}
        />
      </div>

      {heldPiece && <EditorGhost kind={heldPiece.kind} color={heldPiece.color} />}
      {confirmView}
    </div>
  );
}

export default PositionEditor;
