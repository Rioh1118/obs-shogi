import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { turnText } from "@/shared/lib/turn";

import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import {
  FsErrorView,
  isResolvedByConflictDialog,
  useFileTree,
  type FileTreeNode,
  type FsError,
} from "@/entities/file-tree";
import type { KifuFormat } from "@/entities/kifu/model/kifu";
import { sfenToJkfInitial } from "@/entities/study-positions/lib/sfenToJkfInitial";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PreviewPane from "@/entities/position/ui/PositionPreviewPane";

import Form from "@/shared/ui/Form/Form";
import FormField from "@/shared/ui/Form/FormField";
import TextInput from "@/shared/ui/Form/TextInput";
import Select from "@/shared/ui/Form/Select";
import ButtonGroup from "@/shared/ui/Form/ButtonGroup";
import Button from "@/shared/ui/Button/Button";

import "./SfenKifuCreateModal.scss";

/** ツリーからディレクトリ一覧をフラットに収集する */
function collectDirs(node: FileTreeNode, rootPath: string): { value: string; label: string }[] {
  const dirs: { value: string; label: string }[] = [];

  function walk(n: FileTreeNode) {
    if (!n.isDirectory) return;
    const label = n.path === rootPath ? "/" : n.path.slice(rootPath.length);
    dirs.push({ value: n.path, label });
    for (const child of n.children ?? []) {
      walk(child);
    }
  }

  walk(node);
  return dirs;
}

export default function SfenKifuCreateModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "sfen-kifu-create";
  const sfen = params.sfen;

  const { createNewFile, fileTree } = useFileTree();

  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<KifuFormat>("kif");
  const [blackPlayer, setBlackPlayer] = useState("");
  const [whitePlayer, setWhitePlayer] = useState("");
  const [selectedDir, setSelectedDir] = useState(fileTree?.path ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<FsError | null>(null);

  const sfenInitial = useMemo(() => (sfen ? sfenToJkfInitial(sfen) : null), [sfen]);

  const previewData = useMemo(() => (sfen ? buildPreviewDataFromSfen(sfen) : null), [sfen]);

  const turnBadge = previewData ? turnText(previewData.turn) : null;

  const dirOptions = useMemo(() => {
    if (!fileTree) return [];
    return collectDirs(fileTree, fileTree.path);
  }, [fileTree]);

  // fileTree が変わったら selectedDir を同期
  const rootPath = fileTree?.path ?? "";
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;
  const [prevRoot, setPrevRoot] = useState(rootPath);
  if (rootPath !== prevRoot) {
    setPrevRoot(rootPath);
    setSelectedDir(rootPath);
  }

  // 開くたびにフォームをリセットする（常駐レンダリングで状態が残るため）
  // selectedDir は rootPathRef 経由で最新の rootPath を参照する
  useEffect(() => {
    if (!isOpen) return;
    setFileName("");
    setFormat("kif");
    setBlackPlayer("");
    setWhitePlayer("");
    setSelectedDir(rootPathRef.current);
    setSubmitError(null);
  }, [isOpen]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!fileName.trim() || !sfenInitial || isLoading) return;

      // `selectedDir` が空になるのはツリーが1本も無いときだけで、
      // そのとき送信ボタンは押せない。理由は Select の下に出している
      if (dirOptions.length === 0) return;

      setSubmitError(null);
      setIsLoading(true);
      const result = await createNewFile(selectedDir, {
        fileName: `${fileName.trim()}.${format}`,
        format,
        gameInfo: {
          black: blackPlayer.trim() || undefined,
          white: whitePlayer.trim() || undefined,
        },
        initialPosition: sfenInitial,
      });
      setIsLoading(false);

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
      fileName,
      format,
      blackPlayer,
      whitePlayer,
      selectedDir,
      dirOptions.length,
      sfenInitial,
      isLoading,
      createNewFile,
      closeModal,
    ],
  );

  const formatOptions = [
    { value: "kif", label: "kif" },
    { value: "ki2", label: "ki2" },
    { value: "csa", label: "csa" },
    { value: "jkf", label: "jkf" },
  ];

  if (!isOpen || !sfen) return null;

  return (
    <Modal
      onClose={closeModal}
      label="課題局面から棋譜を作成"
      theme="dark"
      variant="dialog"
      size="md"
      scroll="none"
    >
      <div className="sfen-kifu-create">
        <div className="sfen-kifu-create__preview">
          <PreviewPane previewData={previewData} />
          {turnBadge && <div className="sfen-kifu-create__turnBadge">{turnBadge}</div>}
        </div>

        <Form handleSubmit={handleSubmit}>
          <FormField>
            <h2 className="form__heading-secondary">{"課題局面から棋譜を作成"}</h2>
          </FormField>

          <FormField>
            <Select
              label="保存先フォルダ"
              id="saveDir"
              options={dirOptions}
              value={selectedDir}
              onChange={(v) => {
                setSelectedDir(v);
                setSubmitError(null);
              }}
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
              id="sfenFileName"
              placeholder="45角戦法"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              required
            />
            <Select
              label="フォーマット"
              id="sfenFormat"
              options={formatOptions}
              value={format}
              onChange={(v) => setFormat(v as KifuFormat)}
            />
          </FormField>

          <FormField horizontal>
            <TextInput
              label="先手名"
              id="sfenBlack"
              placeholder="Player1"
              value={blackPlayer}
              onChange={(e) => setBlackPlayer(e.target.value)}
            />
            <TextInput
              label="後手名"
              id="sfenWhite"
              placeholder="Player2"
              value={whitePlayer}
              onChange={(e) => setWhitePlayer(e.target.value)}
            />
          </FormField>

          {/* 押した場所の隣に出す。入力欄は残すので、名前を直してそのまま押し直せる */}
          {submitError && (
            <FormField>
              <FsErrorView error={submitError} />
            </FormField>
          )}

          {/* フォームは出したままにする。差し替えると入力欄が消え、
                  失敗して戻ったときキーボードの利用者はどこにいるか分からなくなる */}
          <ButtonGroup>
            <Button
              type="submit"
              tone="primary"
              isLoading={isLoading}
              disabled={!fileName.trim() || !selectedDir}
            >
              {isLoading ? "作成中..." : "作成"}
            </Button>
            <Button type="button" onClick={() => closeModal()} disabled={isLoading}>
              キャンセル
            </Button>
          </ButtonGroup>
        </Form>
      </div>
    </Modal>
  );
}
