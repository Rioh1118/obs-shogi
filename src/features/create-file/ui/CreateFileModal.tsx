import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useCallback, useMemo, useRef, useState } from "react";
import { useGame } from "@/entities/game";
import { stateFromSfen } from "@/entities/position/lib/positionDraft";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import PositionEditor, { type EditorFace } from "@/features/position-editor";
import KifuImportForm from "./KifuImportForm";
import "./CreateFileModal.scss";

/**
 * 面は1つの変数で持つ
 *
 * タブ（新規作成 / インポート）と、新規作成の中の面（盤 / 課題局面）を別々に持つと、
 * 「インポートに居るが盤の面でもある」という表に無い組み合わせが作れて、
 * 戻ったときの着地がどこにも書けなくなる。
 */
type Face = EditorFace | "import";

function CreateFileModal() {
  const { params, closeModal } = useURLParams();
  const initialFace = useMemo<Face>(
    () => (params.tab === "import" ? "import" : "board"),
    [params.tab],
  );
  const isOpen = params.modal === "create-file";

  const [face, setFace] = useState<Face>(initialFace);

  /**
   * 閉じてよいかを中身に問う門
   *
   * **閉じる口は3つある**（Esc・覆いの押下・面の中の「やめる」）。`Modal` は
   * Esc と覆いの両方で `onClose` を呼ぶので、そこへ寄せれば口が1つになる。
   * 段を面の中だけで持つと、焦点が面の外にある Esc と覆いの押下が素通りして、
   * **組みかけが確認なしに消える**。
   */
  const closeGuard = useRef<(() => boolean) | null>(null);
  const requestClose = useCallback(() => {
    if (closeGuard.current?.()) return;
    closeModal();
  }, [closeModal]);

  const { view } = useGame();
  const { state: studyState } = useStudyPositions();

  /**
   * いま開いている棋譜の、いま見えている局面
   *
   * **SFEN を経由する。** `shogi.js` の盤をそのまま渡すと、再生器が持っている
   * 可変の配列を組みかけの state として抱えることになり、盤を動かした瞬間に
   * 種のほうも変わる。
   */
  const currentPosition = useMemo(() => {
    const sfen = view.player?.shogi.toSFENString();
    return sfen ? stateFromSfen(sfen) : null;
  }, [view.player?.shogi]);

  if (!isOpen) return null;

  return (
    <Modal
      onClose={requestClose}
      // 面が変わっても器の名前は動かさない。支援技術には「何が開いているか」を
      // 一貫して読ませる
      label="棋譜を作る"
      variant="workspace"
      size="xl"
      scroll="card"
    >
      <div className="create-file-modal">
        <div className="create-file-modal__tabs" role="tablist" aria-label="棋譜を作る">
          <button
            type="button"
            role="tab"
            aria-selected={face !== "import"}
            className={`create-file-modal__tab ${face !== "import" ? "is-active" : ""}`}
            onClick={() => setFace("board")}
          >
            新規作成
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={face === "import"}
            className={`create-file-modal__tab ${face === "import" ? "is-active" : ""}`}
            onClick={() => setFace("import")}
          >
            インポート
          </button>
        </div>

        <div className="create-file-modal__body">
          {face === "import" ? (
            // **器が xl になったので、中身の幅を絞って中央に置く。**
            // 棋譜テキストを貼る欄が 1100px いっぱいに広がると、1行が長すぎて
            // どこまで貼れたのかが読めない
            <div className="create-file-modal__narrow">
              <KifuImportForm toggleModal={() => closeModal()} dirPath={params.dir || ""} />
            </div>
          ) : (
            <PositionEditor
              face={face}
              onFaceChange={setFace}
              currentPosition={currentPosition}
              studyPositions={studyState.positions}
              initialDir={params.dir || undefined}
              onCreated={() => closeModal()}
              closeGuard={closeGuard}
              onClose={() => closeModal()}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

export default CreateFileModal;
