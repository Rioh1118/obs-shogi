import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useCallback, useRef, useState } from "react";
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

/**
 * 開いているあいだだけ立つ器
 *
 * **面も組みかけも、閉じたら消える。** 器そのものを常に木に残したまま
 * `face` を持つと、閉じたときの面が次に開いたときの面になり、
 * 「作成」で閉じた直後に開くと課題局面の一覧が出る。
 */
function CreateFileFace({ closeModal }: { closeModal: () => void }) {
  const { params } = useURLParams();
  const [face, setFace] = useState<Face>(params.tab === "import" ? "import" : "board");
  /**
   * 作成中の旗は面ごとに立つ
   *
   * **同じ状態が2つの綴りを持つ**（状態遷移表の W）。組む面は
   * `EditorCreateForm` の `isSubmitting`、インポートの面は `KifuImportForm` の
   * `isSaving`。器は両方を見る —— 片方しか見ないと、見ていない面で送信中に
   * タブを押せて、失敗を出す場所ごと消える。
   */
  const [editorBusy, setEditorBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const isSubmitting = editorBusy || importBusy;

  /**
   * 閉じてよいかを中身に問う門
   *
   * **閉じる口は4つある**（Esc・覆いの押下・組む面の「やめる」・インポートの面の
   * 「キャンセル」）。`Modal` は Esc と覆いの両方で `onClose` を呼ぶので、
   * そこへ寄せれば口が1つになる。
   * 段を面の中だけで持つと、焦点が面の外にある Esc と覆いの押下が素通りして、
   * **組みかけが確認なしに消える**。
   */
  const closeGuard = useRef<(() => boolean) | null>(null);
  const requestClose = useCallback(() => {
    // 作成中は止められない（表の W×X10）。**どちらの面から送っていても同じ**
    if (isSubmitting) return;
    if (closeGuard.current?.()) return;
    closeModal();
  }, [closeModal, isSubmitting]);

  const { state: studyState } = useStudyPositions();

  return (
    <Modal
      onClose={requestClose}
      // 面が変わっても器の名前は動かさない。支援技術には「何が開いているか」を
      // 一貫して読ませる
      label="棋譜を作る"
      variant="workspace"
      size="xl"
      // **カードごと巻く。** 組む面は自分の中で高さを配り切るが、
      // インポートの面は縦に長いフォームで、器が低いと下端の「作成」に届かなくなる
      scroll="card"
    >
      <div className="create-file-modal">
        <div className="create-file-modal__tabs" role="tablist" aria-label="棋譜を作る">
          {/* **作成中はタブを沈める。** 送信の途中で面が外れると、失敗を出す場所ごと消える */}
          <button
            type="button"
            role="tab"
            aria-selected={face !== "import"}
            className={`create-file-modal__tab ${face !== "import" ? "is-active" : ""}`}
            disabled={isSubmitting}
            title={isSubmitting ? "作成中は切り替えられません" : undefined}
            onClick={() => setFace("board")}
          >
            新規作成
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={face === "import"}
            className={`create-file-modal__tab ${face === "import" ? "is-active" : ""}`}
            disabled={isSubmitting}
            title={isSubmitting ? "作成中は切り替えられません" : undefined}
            onClick={() => setFace("import")}
          >
            インポート
          </button>
        </div>

        {/*
          **どちらの面も木に残す。** 片方を外すと、組みかけの局面も貼りかけの棋譜も
          確認を1つも通さずに消える（状態遷移表の I×X9「組んだものは残る」）。
          `hidden` は焦点も支援技術の読み上げも外すので、隠れた面の中の欄が
          Tab の順に紛れ込むこともない
        */}
        <div className="create-file-modal__body">
          {/*
            **器は xl（1100px）。中身の幅はそこから絞って中央に置く。**
            棋譜テキストを貼る欄が幅いっぱいに広がると、1行が長すぎて
            どこまで貼れたのかが読めない
          */}
          <div className="create-file-modal__narrow" hidden={face !== "import"}>
            <KifuImportForm
              hidden={face !== "import"}
              onCreated={() => closeModal()}
              onCancel={requestClose}
              dirPath={params.dir || ""}
              onSubmittingChange={setImportBusy}
            />
          </div>
          <PositionEditor
            // `EditorFace` に "import" は無い。隠れているあいだの値は画面に出ないが、
            // **戻る先は必ず盤**（同表の I×X9）なので盤を渡す
            face={face === "import" ? "board" : face}
            hidden={face === "import"}
            onFaceChange={setFace}
            studyPositions={studyState.positions}
            initialDir={params.dir || undefined}
            onCreated={() => closeModal()}
            closeGuard={closeGuard}
            onClose={() => closeModal()}
            onSubmittingChange={setEditorBusy}
          />
        </div>
      </div>
    </Modal>
  );
}

function CreateFileModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "create-file";
  return isOpen ? <CreateFileFace closeModal={closeModal} /> : null;
}

export default CreateFileModal;
