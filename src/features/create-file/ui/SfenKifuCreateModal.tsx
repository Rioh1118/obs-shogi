import { useCallback, useMemo, useState } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";

import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";
import type { FileTreeNode } from "@/entities/file-tree/model/types";
import type { KifuFormat } from "@/entities/kifu";
import { sfenToJkfInitial } from "@/entities/study-positions/lib/sfenToJkfInitial";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PreviewPane from "@/entities/position/ui/PositionPreviewPane";

import Form from "@/shared/ui/Form/Form";
import FormField from "@/shared/ui/Form/FormField";
import TextInput from "@/shared/ui/Form/TextInput";
import Select from "@/shared/ui/Form/Select";
import ButtonGroup from "@/shared/ui/Form/ButtonGroup";
import Button from "@/shared/ui/Form/Button";
import Spinner from "@/shared/ui/Spinner";

import "./SfenKifuCreateModal.scss";

/** ツリーからディレクトリ一覧をフラットに収集する */
function collectDirs(
  node: FileTreeNode,
  rootPath: string,
): { value: string; label: string }[] {
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const sfenInitial = useMemo(
    () => (sfen ? sfenToJkfInitial(sfen) : null),
    [sfen],
  );

  const previewData = useMemo(
    () => (sfen ? buildPreviewDataFromSfen(sfen) : null),
    [sfen],
  );

  const toKan = useMemo(
    () => (k: string) => JKFPlayer.kindToKan(k as Kind) ?? k,
    [],
  );

  const turnLabel = previewData
    ? previewData.turn === 0
      ? "先手番"
      : "後手番"
    : null;

  const dirOptions = useMemo(() => {
    if (!fileTree) return [];
    return collectDirs(fileTree, fileTree.path);
  }, [fileTree]);

  // fileTree が変わったら selectedDir を同期
  const rootPath = fileTree?.path ?? "";
  const [prevRoot, setPrevRoot] = useState(rootPath);
  if (rootPath !== prevRoot) {
    setPrevRoot(rootPath);
    setSelectedDir(rootPath);
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!fileName.trim() || !sfenInitial) return;

      if (!selectedDir) {
        setErrorMsg("保存先フォルダが選択されていません");
        return;
      }

      setErrorMsg(null);
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
      } else {
        setErrorMsg(result.error.message ?? "ファイルの作成に失敗しました");
      }
    },
    [
      fileName,
      format,
      blackPlayer,
      whitePlayer,
      selectedDir,
      sfenInitial,
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
      theme="dark"
      variant="dialog"
      size="md"
      scroll="card"
    >
      <div className="sfen-kifu-create">
        {isLoading ? (
          <Spinner />
        ) : (
          <>
            <div className="sfen-kifu-create__preview">
              <PreviewPane previewData={previewData} toKan={toKan} />
              {turnLabel && (
                <div className="sfen-kifu-create__turnBadge">
                  {turnLabel}
                </div>
              )}
            </div>

            <Form handleSubmit={handleSubmit}>
              <FormField>
                <h2 className="form__heading-secondary">
                  {"課題局面から棋譜を作成"}
                </h2>
              </FormField>

              {errorMsg && (
                <FormField>
                  <div className="sfen-kifu-create__error">{errorMsg}</div>
                </FormField>
              )}

              <FormField>
                <Select
                  label="保存先フォルダ"
                  id="saveDir"
                  options={dirOptions}
                  value={selectedDir}
                  onChange={(v) => {
                    setSelectedDir(v);
                    setErrorMsg(null);
                  }}
                />
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

              <ButtonGroup>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!fileName.trim() || !selectedDir}
                >
                  作成
                </Button>
                <Button type="button" variant="ghost" onClick={closeModal}>
                  キャンセル
                </Button>
              </ButtonGroup>
            </Form>
          </>
        )}
      </div>
    </Modal>
  );
}
