import { useEffect, useMemo, useState } from "react";
import type { KifuFormat } from "@/types";
import { useFileTree } from "@/contexts/FileTreeContext";
import { parseKifuStringToJKF } from "@/utils/kifuParseUtils";
import Form from "../Form/Form";
import FormField from "../Form/FormField";
import TextInput from "../Form/TextInput";
import Select from "../Form/Select";
import Textarea from "../Form/Textarea";
import ButtonGroup from "../Form/ButtonGroup";
import Button from "../Form/Button";

function stripKnownExt(name: string) {
  return name.replace(/\.(kif|ki2|csa|jkf)$/i, "");
}

function KifuImportForm({
  toggleModal,
  dirPath,
}: {
  toggleModal: () => void;
  dirPath: string;
}) {
  const { importKifuFile } = useFileTree();

  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<KifuFormat>("kif");

  const [rawContent, setRawContent] = useState("");

  const [parseOk, setParseOk] = useState<boolean | null>(null);
  const [parseError, setParseError] = useState<string>("");

  const fullFileName = useMemo(() => {
    const base = stripKnownExt(fileName.trim());
    if (!base) return "";
    return `${base}.${format}`;
  }, [fileName, format]);

  // 初回表示でテキストエリアにフォーカス（貼り付け即開始できる）
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById(
        "rawKifu",
      ) as HTMLTextAreaElement | null;
      el?.focus();
    });
  }, []);

  // 入力が変わったら軽くパース検証（ローカルエラーとして表示）
  useEffect(() => {
    const text = rawContent.trim();
    if (!text) {
      setParseOk(null);
      setParseError("");
      return;
    }

    try {
      parseKifuStringToJKF(text);
      setParseOk(true);
      setParseError("");
    } catch (e) {
      setParseOk(false);
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }, [rawContent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const name = fullFileName;
    const text = rawContent.trim();

    if (!name || !text) return;
    if (parseOk === false) return;

    const result = await importKifuFile(dirPath, name, text);

    if (result.success) {
      toggleModal();
      return;
    }

    // import側の失敗もここで局所表示
    setParseOk(false);
    setParseError(result.error || "インポートに失敗しました。");
  };

  const formatOptions = [
    { value: "kif", label: "kif" },
    { value: "ki2", label: "ki2" },
    { value: "csa", label: "csa" },
    { value: "jkf", label: "jkf" },
  ];

  return (
    <Form handleSubmit={handleSubmit}>
      <FormField>
        <h2 className="form__heading-secondary">棋譜をインポートして作成</h2>
      </FormField>

      <FormField>
        <Textarea
          label="棋譜テキスト"
          id="rawKifu"
          placeholder=".kif / .ki2 / .csa / .jkf を貼り付け（Ctrl/⌘+V）"
          value={rawContent}
          onChange={(e) => setRawContent(e.target.value)}
        />
      </FormField>

      <FormField>
        {parseOk === null ? (
          <div style={{ fontSize: "1.3rem", color: "#666" }}>
            解析: 未実行（棋譜を入力してください）
          </div>
        ) : parseOk ? (
          <div style={{ fontSize: "1.3rem" }}>解析: OK</div>
        ) : (
          <div style={{ fontSize: "1.3rem" }}>
            解析: 失敗しました
            <details style={{ marginTop: "0.6rem" }}>
              <summary style={{ cursor: "pointer" }}>詳細</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: "1.2rem" }}>
                {parseError}
              </pre>
            </details>
          </div>
        )}
      </FormField>

      <FormField horizontal>
        <TextInput
          label="ファイル名(必須)"
          id="fileName"
          placeholder="45角戦法"
          value={fileName}
          onChange={(e) => setFileName(stripKnownExt(e.target.value))}
          required
        />
        <Select
          label="保存形式（拡張子）"
          id="format"
          options={formatOptions}
          value={format}
          onChange={(v) => setFormat(v as KifuFormat)}
        />
      </FormField>

      <FormField>
        <div style={{ fontSize: "1.2rem", color: "#666" }}>
          保存名: {fullFileName || "（未入力）"}
        </div>
      </FormField>

      <ButtonGroup>
        <Button
          type="submit"
          variant="primary"
          disabled={!fullFileName || !rawContent.trim() || parseOk !== true}
        >
          インポートして作成
        </Button>
        <Button type="button" variant="ghost" onClick={toggleModal}>
          キャンセル
        </Button>
      </ButtonGroup>
    </Form>
  );
}

export default KifuImportForm;
