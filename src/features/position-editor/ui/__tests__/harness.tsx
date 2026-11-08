import { useCallback, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { stateToSfen } from "@/entities/position/lib/positionDraft";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import Modal from "@/shared/ui/Modal";
import PositionEditor, { type EditorFace } from "../PositionEditor";

/**
 * 組むタブを、本物と同じ形のモーダルに載せる入れ物。
 *
 * `Modal` ごと描く。閉じる経路は4つあり（Esc・覆いの押下・両方のタブの「キャンセル」）、
 * そのうち2つはモーダルの `onClose` を通る。モーダルを省いてタブだけを描くと、
 * **タブを通らない閉じ方がテストから消える** —— 覆いも `Modal` の Escape も
 * タブのハンドラには現れないので、組みかけが確認なしに消えても緑で通る。
 *
 * 閉じるときの確認もモーダルが持つ（`CreateFileFace` と同じ形）。捨てるものは
 * 組みかけだけでなく貼りかけもあり、数えられるのは両方を見ているモーダルだけだから。
 * ここにインポートのタブは無いので、数えるのは組みかけだけになる。
 *
 * `face` もモーダルが1つの変数で持つので、ここでもモーダルの側に置く。
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
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const requestClose = useCallback(() => {
    if (isSubmitting) return;
    if (isDirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }, [isDirty, isSubmitting, onClose]);

  return (
    <Modal onClose={requestClose} label="棋譜を作成" variant="workspace" size="xl">
      <PositionEditor
        face={face}
        onFaceChange={setFace}
        studyPositions={studyPositions}
        onDirtyChange={setIsDirty}
        onSubmittingChange={setIsSubmitting}
        onClose={requestClose}
      />
      {confirmingClose && (
        <ConfirmDialog
          title="組んだ局面は保存されません。"
          subtitle="閉じると削除されます。"
          confirmLabel="捨てる"
          cancelLabel="閉じない"
          onConfirm={() => {
            setConfirmingClose(false);
            onClose();
          }}
          onCancel={() => setConfirmingClose(false)}
        />
      )}
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
 * 種を載せる経路そのものを通す（prop で差し込まない）。手合割13に無い局面を
 * 載せられる経路は課題局面だけなので、そこを通る。一覧は**2回押して確定する**
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
