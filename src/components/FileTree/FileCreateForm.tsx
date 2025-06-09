import { useState } from "react";
import type { KifuFormat, InitialPresetString } from "@/types";
import { useFileTree } from "@/contexts/FileTreeContext";
import Form from "../Form/Form";
import Spinner from "../Spinner";
import FormField from "../Form/FormField";
import TextInput from "../Form/TextInput";
import Select from "../Form/Select";
import Textarea from "../Form/Textarea";
import ButtonGroup from "../Form/ButtonGroup";
import Button from "../Form/Button";
import { TagsInput } from "../Form/TagsInput";

function FileCreateForm({
  toggleModal,
  dirPath,
}: {
  toggleModal: () => void;
  dirPath: string;
}) {
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<KifuFormat>("kif");
  const [blackPlayer, setBlackPlayer] = useState("");
  const [whitePlayer, setWhitePlayer] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [preset, setPreset] = useState<InitialPresetString>("HIRATE");
  const [isLoading, setIsLoading] = useState(false);
  const { createNewFile } = useFileTree();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fileName.trim()) return;

    setIsLoading(true);
    try {
      await createNewFile(dirPath, {
        fileName: `${fileName.trim()}.${format}`,
        format,
        gameInfo: {
          black: blackPlayer.trim() || undefined,
          white: whitePlayer.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
          note: note.trim() ? note : undefined,
        },
        initialPosition: {
          preset: preset,
        },
      });

      toggleModal();
    } catch (err) {
      console.error("ファイル作成エラー:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatOptions = [
    { value: "kif", label: "kif" },
    { value: "ki2", label: "ki2" },
    { value: "csa", label: "csa" },
    { value: "jkf", label: "jkf" },
  ];

  const presetOptions = [
    { value: "HIRATE", label: "平手" },
    { value: "KY", label: "香落ち" },
    { value: "KY_R", label: "右香落ち" },
    { value: "KA", label: "角落ち" },
    { value: "HI", label: "飛車落ち" },
    { value: "2", label: "二枚落ち" },
    { value: "3", label: "三枚落ち" },
    { value: "4", label: "四枚落ち" },
    { value: "5", label: "五枚落ち" },
    { value: "5_L", label: "左五枚落ち" },
    { value: "6", label: "六枚落ち" },
    { value: "8", label: "八枚落ち" },
    { value: "10", label: "十枚落ち" },
    // { value: "OTHER", label: "カスタム" },
  ];

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <Form handleSubmit={handleSubmit}>
      <FormField>
        <h2 className="form__heading-secondary">新しい棋譜ファイルを作成</h2>
      </FormField>
      <FormField horizontal>
        <TextInput
          label="ファイル名"
          id="fileName"
          placeholder="45角戦法"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          required
        />

        <Select
          label="フォーマット"
          id="format"
          options={formatOptions}
          value={format}
          onChange={(value) => setFormat(value as KifuFormat)}
        />
      </FormField>

      <FormField horizontal>
        <TextInput
          label="先手名"
          id="blackPlayer"
          placeholder="Player1"
          value={blackPlayer}
          onChange={(e) => setBlackPlayer(e.target.value)}
        />
        <TextInput
          label="後手名"
          id="whitePlayer"
          placeholder="Player2"
          value={whitePlayer}
          onChange={(e) => setWhitePlayer(e.target.value)}
        />
      </FormField>
      <FormField>
        <Select
          label="手合割"
          id="preset"
          options={presetOptions}
          value={preset}
          onChange={(value) => setPreset(value as InitialPresetString)}
        />
      </FormField>
      <FormField>
        <TagsInput label="タグ" id="tags" tags={tags} onChange={setTags} />
      </FormField>
      <FormField>
        <Textarea
          label="備考・メモ"
          id="note"
          placeholder="対局の詳細や感想など..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
      <ButtonGroup>
        <Button type="submit" variant="primary" disabled={!fileName.trim()}>
          作成
        </Button>
        <Button type="button" variant="ghost" onClick={toggleModal}>
          キャンセル
        </Button>
      </ButtonGroup>
    </Form>
  );
}

export default FileCreateForm;
