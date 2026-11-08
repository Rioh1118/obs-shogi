import Modal from "@/shared/ui/Modal";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useCallback, useState } from "react";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import PositionEditor, { type EditorFace } from "@/features/position-editor";
import KifuImportForm from "./KifuImportForm";
import "./CreateFileModal.scss";

/**
 * タブは1つの変数で持つ
 *
 * タブ（新規作成 / インポート）と、新規作成の中のパネル（盤 / 課題局面）を別々に持つと、
 * 「インポートに居るが盤のパネルでもある」という表に無い組み合わせが作れて、
 * 戻ったときの着地がどこにも書けなくなる。
 */
type Face = EditorFace | "import";

/**
 * 開いているあいだだけ立つモーダル
 *
 * **タブも組みかけも、閉じたら消える。** モーダルそのものを常に木に残したまま
 * `face` を持つと、閉じたときのタブが次に開いたときのタブになり、
 * 「作成」で閉じた直後に開くと課題局面の一覧が出る。
 */
function CreateFileFace({ closeModal }: { closeModal: () => void }) {
  const { params } = useURLParams();
  const { state: studyState } = useStudyPositions();
  const [face, setFace] = useState<Face>(params.tab === "import" ? "import" : "board");
  /**
   * 作成中の旗はタブごとに立つ
   *
   * 状態遷移表の W は1つだが、旗はタブごとに持つ。組むタブは `PositionEditor` が、
   * インポートのタブは `KifuImportForm` が `isSubmitting` で持つ。モーダルは両方を見る ——
   * **片方しか見ないと、見ていないタブで送信中にタブを押せて、失敗を出す場所ごと消える**。
   */
  const [editorBusy, setEditorBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const isSubmitting = editorBusy || importBusy;

  /**
   * 捨てるものがあるか
   *
   * タブごとに数えてモーダルが足す（状態遷移表の直交軸「捨てるもの」）。組みかけの局面は
   * 組むタブが、貼りかけの棋譜はインポートのタブが持つ。片方しか見ないと、
   * **見ていないほうが閉じるときに黙って消える**。
   */
  const [editorDirty, setEditorDirty] = useState(false);
  const [importDirty, setImportDirty] = useState(false);

  /** 閉じる前の確認が出ているか */
  const [confirmingClose, setConfirmingClose] = useState(false);

  /**
   * 閉じる経路を1つにする判定
   *
   * 閉じる経路は4つある（Esc・覆いの押下・両方のタブの「キャンセル」）。
   * `Modal` は Esc と覆いの両方で `onClose` を呼ぶので、そこへ寄せれば経路が1つになる。
   * 確認をタブの中だけで持つと、焦点がタブの外にある Esc と覆いの押下が素通りして、
   * **捨てるものが確認なしに消える**。
   */
  const requestClose = useCallback(() => {
    // 作成中は止められない（表の W×X10）。**どちらのタブから送っていても同じ**
    if (isSubmitting) return;
    if (editorDirty || importDirty) {
      setConfirmingClose(true);
      return;
    }
    closeModal();
  }, [closeModal, isSubmitting, editorDirty, importDirty]);

  const handleConfirmClose = () => {
    setConfirmingClose(false);
    closeModal();
  };

  return (
    <Modal
      onClose={requestClose}
      // タブが変わってもモーダルの名前は動かさない。支援技術には「何が開いているか」を
      // 一貫して読ませる
      label="棋譜を作成"
      variant="workspace"
      size="xl"
      // **カードごと巻く。** どちらのタブもモーダルの高さを配って組むので、モーダルが縦に縮められた
      // ときだけ（`tauri.conf.json` に `minHeight` が無い）ここが逃げ場になる
      scroll="card"
    >
      <div className="create-file-modal">
        <div className="create-file-modal__tabs" role="tablist" aria-label="棋譜を作成">
          {/* **作成中はタブを沈める。** 送信の途中でタブが外れると、失敗を出す場所ごと消える */}
          <button
            type="button"
            role="tab"
            aria-selected={face !== "import"}
            className={`create-file-modal__tab ${face !== "import" ? "is-active" : ""}`}
            disabled={isSubmitting}
            title={isSubmitting ? "作成中は切り替えられません" : undefined}
            onClick={() => setFace("board")}
          >
            作成
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
          **どちらのタブも木に残す。** 片方を外すと、組みかけの局面も貼りかけの棋譜も
          確認を1つも通さずに消える（状態遷移表の I×X9「組んだものは残る」）。
          `hidden` は焦点も支援技術の読み上げも外すので、隠れたタブの中の欄が
          Tab の順に紛れ込むこともない
        */}
        <div className="create-file-modal__body">
          {/*
            **どちらのタブもモーダルの内寸をそのまま使う。** 中身を絞って中央に置くと、
            タブは動かないのに中身の左端だけがタブを跨いだ瞬間に飛ぶ
          */}
          <KifuImportForm
            hidden={face !== "import"}
            onCreated={() => closeModal()}
            onCancel={requestClose}
            dirPath={params.dir || ""}
            onSubmittingChange={setImportBusy}
            onDirtyChange={setImportDirty}
          />
          <PositionEditor
            // `EditorFace` に "import" は無い。隠れているあいだの値は画面に出ないが、
            // **戻る先は必ず盤**（同表の I×X9）なので盤を渡す
            face={face === "import" ? "board" : face}
            hidden={face === "import"}
            onFaceChange={setFace}
            studyPositions={studyState.positions}
            initialDir={params.dir || undefined}
            onCreated={() => closeModal()}
            onDirtyChange={setEditorDirty}
            // タブの中の「キャンセル」も同じ `requestClose` を通す
            onClose={requestClose}
            onSubmittingChange={setEditorBusy}
          />
        </div>

        {/*
          **捨てるものを名指す。** 「組んだ局面」と「貼った棋譜」は別々のタブに在り、
          閉じれば両方消える。1つだけを名指すと、もう片方が消えることが
          確認を読んでも分からない
        */}
        {confirmingClose && (
          <ConfirmDialog
            title={`${discardedName(editorDirty, importDirty)}は保存されません。`}
            subtitle="閉じると削除されます。"
            confirmLabel="捨てる"
            // 「キャンセル」（モーダルごと閉じる）と同じ語にしない。**戻り先が違う** ——
            // こちらは組みかけ・貼りかけを持ったままのタブへ帰るだけ。
            // 「組み続ける」にもしない —— 貼りかけだけを捨てるときに組んでいない
            cancelLabel="閉じない"
            onConfirm={handleConfirmClose}
            onCancel={() => setConfirmingClose(false)}
          />
        )}
      </div>
    </Modal>
  );
}

/** 閉じたときに消えるものの名前。**両方あるなら両方言う** */
function discardedName(editorDirty: boolean, importDirty: boolean): string {
  if (editorDirty && importDirty) return "組んだ局面と貼った棋譜";
  if (importDirty) return "貼った棋譜";
  return "組んだ局面";
}

function CreateFileModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "create-file";
  return isOpen ? <CreateFileFace closeModal={closeModal} /> : null;
}

export default CreateFileModal;
