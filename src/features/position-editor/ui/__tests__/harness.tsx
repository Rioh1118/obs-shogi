import { useCallback, useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { stateToSfen } from "@/entities/position/lib/positionDraft";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import Modal from "@/shared/ui/Modal";
import PositionEditor, { type EditorFace } from "../PositionEditor";

/**
 * 組む面を、本物と同じ形の器に載せる入れ物。
 *
 * **`Modal` ごと描く。** 閉じる口は4つあり（Esc・覆いの押下・面の中の「やめる」・
 * インポートの面の「キャンセル」）、そのうち2つは器の `onClose` を通る。
 * 器を省いて面だけを描くと、**面を通らない閉じ方がテストから消える** ——
 * 覆いも `Modal` の Escape も面の受け口には現れないので、
 * 組みかけが確認なしに消えても緑で通る。
 *
 * `face` も器が1つの変数で持つので、ここでも器の側に置く。
 */
export function EditorHarness({
  studyPositions = [],
  onClose = () => undefined,
}: {
  studyPositions?: StudyPosition[];
  /** 確認を通ったうえで実際に閉じるとき */
  onClose?: () => void;
}) {
  const [face, setFace] = useState<EditorFace>("board");

  const closeGuard = useRef<(() => boolean) | null>(null);
  const requestClose = useCallback(() => {
    if (closeGuard.current?.()) return;
    onClose();
  }, [onClose]);

  return (
    <Modal onClose={requestClose} label="棋譜を作る" variant="workspace" size="xl">
      <PositionEditor
        face={face}
        onFaceChange={setFace}
        studyPositions={studyPositions}
        closeGuard={closeGuard}
        onClose={onClose}
      />
    </Modal>
  );
}

function studyPosition(sfen: string): StudyPosition {
  return {
    id: "harness-seed",
    sfen,
    label: "題材",
    description: "",
    state: "inbox",
    tags: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

/**
 * 任意の局面を種として載せてから確かめる。
 *
 * **種を載せる経路そのものを通す**（prop で差し込まない）。手合割13に無い局面を
 * 載せられる口は課題局面だけなので、そこを通る。一覧は**2回押して確定する**
 * （1回目で選び、2回目で載る）ので、ここでも2回押す。
 */
export function renderSeeded(state: JKFState) {
  render(<EditorHarness studyPositions={[studyPosition(stateToSfen(state))]} />);
  fireEvent.click(screen.getByRole("button", { name: "課題局面から…" }));

  const row = document.querySelector<HTMLElement>(".pos-editor__picker-row");
  if (!row) throw new Error("題材の行が無い（SFEN が読めていない可能性がある）");
  fireEvent.click(row);
  fireEvent.click(row, { detail: 2 });
}
