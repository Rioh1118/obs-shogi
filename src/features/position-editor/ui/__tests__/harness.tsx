import { useCallback, useRef, useState } from "react";
import type { JKFState } from "@/entities/kifu/model/jkf";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import Modal from "@/shared/ui/Modal";
import PositionEditor, { type EditorFace } from "../PositionEditor";

/**
 * 組む面を、本物と同じ形の器に載せる入れ物。
 *
 * **`Modal` ごと描く。** 閉じる口は3つあり（Esc・覆いの押下・面の中の「やめる」）、
 * そのうち2つは器の `onClose` を通る。器を省いて面だけを描くと、
 * **面を通らない閉じ方がテストから消える** —— 覆いも `Modal` の Escape も
 * 面の受け口には現れないので、組みかけが確認なしに消えても緑で通る。
 *
 * `face` も器が1つの変数で持つので、ここでも器の側に置く。
 */
export function EditorHarness({
  currentPosition = null,
  studyPositions = [],
  onClose = () => undefined,
}: {
  currentPosition?: JKFState | null;
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
        currentPosition={currentPosition}
        studyPositions={studyPositions}
        closeGuard={closeGuard}
        onClose={onClose}
      />
    </Modal>
  );
}
