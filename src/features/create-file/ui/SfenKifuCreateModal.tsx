import { useCallback, useMemo, useState, type FormEvent } from "react";

import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import {
  FsErrorView,
  isResolvedByConflictDialog,
  useFileTree,
  useSaveDir,
  type FsError,
} from "@/entities/file-tree";
import { KIFU_FORMAT_OPTIONS, kifuFileName, type KifuFormat } from "@/entities/kifu/model/kifu";
import { stateFromSfen } from "@/entities/position/lib/positionDraft";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PositionPreviewPane from "@/entities/position/ui/PositionPreviewPane";

import Form from "@/shared/ui/Form/Form";
import FormField from "@/shared/ui/Form/FormField";
import TextInput from "@/shared/ui/Form/TextInput";
import Select from "@/shared/ui/Form/Select";
import ButtonGroup from "@/shared/ui/Form/ButtonGroup";
import Button from "@/shared/ui/Button/Button";

import "./SfenKifuCreateModal.scss";

/**
 * 開いているあいだだけ立つ対話
 *
 * `AppModalLayer` は対話を常にマウントしている。閉じたら入力ごと消えるので、
 * 開き直したときに前回の名前や保存先が残らない。
 */
function SfenKifuCreateDialog({ sfen, closeModal }: { sfen: string; closeModal: () => void }) {
  const { createNewFile } = useFileTree();

  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<KifuFormat>("kif");
  const [blackPlayer, setBlackPlayer] = useState("");
  const [whitePlayer, setWhitePlayer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<FsError | null>(null);
  const { dirOptions, selectedDir, setSelectedDir } = useSaveDir();

  // URL から来た任意の局面は手合割として書けないので、`OTHER` に固定する。
  // 読めない綴りなら `null` —— 下の送信がそこで止まる
  const sfenInitial = useMemo(() => {
    const data = stateFromSfen(sfen);
    return data ? ({ preset: "OTHER", data } as const) : null;
  }, [sfen]);

  const previewData = useMemo(() => buildPreviewDataFromSfen(sfen), [sfen]);

  // 拡張子は形式の欄が決める。**打った拡張子は落とす**ので `研究.kif.kif` にならない
  // （規則は `kifuFileName` が1箇所で持つ）
  const fullFileName = useMemo(() => kifuFileName(fileName, format), [fileName, format]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!fullFileName || !sfenInitial || isSubmitting) return;

      // `selectedDir` が空になるのはツリーが1本も無いときだけで、
      // そのとき送信ボタンは押せない。理由は Select の下に出している
      if (dirOptions.length === 0) return;

      setSubmitError(null);
      setIsSubmitting(true);
      const result = await createNewFile(selectedDir, {
        fileName: fullFileName,
        format,
        gameInfo: {
          black: blackPlayer.trim() || undefined,
          white: whitePlayer.trim() || undefined,
        },
        initialPosition: sfenInitial,
      });
      setIsSubmitting(false);

      if (result.success) {
        closeModal();
        return;
      }

      // 衝突は別名を選ぶ対話が引き取る。ここで描くと対話の背後に二重に出る
      if (!isResolvedByConflictDialog(result.error.code)) {
        setSubmitError(result.error);
      }
    },
    [
      format,
      blackPlayer,
      whitePlayer,
      selectedDir,
      dirOptions.length,
      fullFileName,
      sfenInitial,
      isSubmitting,
      createNewFile,
      closeModal,
    ],
  );

  const handleDirChange = (dir: string) => {
    setSelectedDir(dir);
    setSubmitError(null);
  };

  return (
    <Modal
      onClose={closeModal}
      label="課題局面から棋譜を作成"
      variant="dialog"
      size="md"
      scroll="none"
    >
      <div className="sfen-kifu-create">
        <div className="sfen-kifu-create__preview">
          <PositionPreviewPane previewData={previewData} />
        </div>

        <Form onSubmit={handleSubmit}>
          <FormField>
            <h2 className="form__heading-secondary">{"課題局面から棋譜を作成"}</h2>
          </FormField>

          <FormField>
            <Select
              label="保存先フォルダ"
              id="sfen-kifu-create-dir"
              options={dirOptions}
              value={selectedDir}
              onChange={handleDirChange}
            />
            {dirOptions.length === 0 && (
              <p className="sfen-kifu-create__hint">
                保存先がありません。先にワークスペースを開いてください
              </p>
            )}
          </FormField>

          <FormField horizontal>
            <TextInput
              label="ファイル名"
              id="sfen-kifu-create-file-name"
              placeholder="45角戦法"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              required
            />
            <Select
              label="フォーマット"
              id="sfen-kifu-create-format"
              options={KIFU_FORMAT_OPTIONS}
              value={format}
              onChange={setFormat}
            />
          </FormField>

          <FormField horizontal>
            <TextInput
              label="先手名"
              id="sfen-kifu-create-black"
              placeholder="Player1"
              value={blackPlayer}
              onChange={(e) => setBlackPlayer(e.target.value)}
            />
            <TextInput
              label="後手名"
              id="sfen-kifu-create-white"
              placeholder="Player2"
              value={whitePlayer}
              onChange={(e) => setWhitePlayer(e.target.value)}
            />
          </FormField>

          {/* 押した場所の隣に出す。フォームは差し替えない —— 入力欄が消えると、失敗して
              戻ったときキーボードの利用者はどこにいるか分からなくなる。残っていれば、
              名前を直してそのまま押し直せる */}
          {submitError && (
            <FormField>
              <FsErrorView error={submitError} />
            </FormField>
          )}

          <ButtonGroup>
            <Button
              type="submit"
              tone="primary"
              isLoading={isSubmitting}
              disabled={!fullFileName || !selectedDir}
            >
              {isSubmitting ? "作成中…" : "作成"}
            </Button>
            <Button type="button" onClick={() => closeModal()} disabled={isSubmitting}>
              キャンセル
            </Button>
          </ButtonGroup>
        </Form>
      </div>
    </Modal>
  );
}

export default function SfenKifuCreateModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "sfen-kifu-create";
  return isOpen && params.sfen ? (
    <SfenKifuCreateDialog sfen={params.sfen} closeModal={closeModal} />
  ) : null;
}
