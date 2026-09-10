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
  const { state, held, pressSquare, pressStand, flipSquare, toggleTurn, loadSeed, isDirty } =
    usePositionDraft(() => stateFromPreset(DEFAULT_HANDICAP));

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
      loadSeed(stateFromPreset(preset));
      setHandicap(preset);
    },
    [loadSeed],
  );

  const useStudyPosition = useCallback(
    (position: StudyPosition) => {
      const state = stateFromSfen(position.sfen);
      // 読めない SFEN は種にしない。黙って盤へ戻すと、種が変わっていないのに
      // 別の局面が載ったように見える。面に留めれば、その行が選べないことが画面から読める
      if (!state) return;
      loadSeed(state);
      setHandicap(null);
      onFaceChange("board");
    },
    [loadSeed, onFaceChange],
  );

  const useCurrentKifu = useCallback(() => {
    if (!currentPosition) return;
    loadSeed(currentPosition);
    setHandicap(null);
  }, [currentPosition, loadSeed]);

  const heldPiece =
    held === null
      ? null
      : held.from === "hand"
        ? { kind: held.kind, color: held.color }
        : pieceAt(state, held.sq);

  if (face === "study") {
    return (
      <div className="pos-editor">
        <div className="pos-editor__main">
          <EditorStudyPicker
            positions={studyPositions}
            onPick={useStudyPosition}
            onBack={() => onFaceChange("board")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pos-editor">
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
        />
      </div>

      {heldPiece && <EditorGhost kind={heldPiece.kind} color={heldPiece.color} />}
    </div>
  );
}

export default PositionEditor;
