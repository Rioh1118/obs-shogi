import { useState } from "react";
import type { JKFState } from "@/entities/kifu/model/jkf";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import PositionEditor, { type EditorFace } from "../PositionEditor";

/**
 * 組む面を、器の代わりに持つだけの入れ物。
 *
 * **`face` は器（`create-file`）が1つの変数で持つ**ので、組む面はそれを受け取るだけ。
 * テストのたびに同じ `useState` を書き直すと、面の持ち方が実物とずれても
 * テスト側だけが通り続ける。
 */
export function EditorHarness({
  currentPosition = null,
  studyPositions = [],
}: {
  currentPosition?: JKFState | null;
  studyPositions?: StudyPosition[];
}) {
  const [face, setFace] = useState<EditorFace>("board");

  return (
    <PositionEditor
      face={face}
      onFaceChange={setFace}
      currentPosition={currentPosition}
      studyPositions={studyPositions}
    />
  );
}
