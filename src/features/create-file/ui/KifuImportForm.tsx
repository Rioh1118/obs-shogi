import { useEffect, useMemo, useRef, useState } from "react";
import {
  collectDirs,
  FsErrorView,
  isResolvedByConflictDialog,
  useFileTree,
  type FsError,
} from "@/entities/file-tree";
import { parseKifuStringToJKF } from "@/entities/kifu/api/parse";
import { KIFU_FORMAT_OPTIONS, type KifuFormat } from "@/entities/kifu/model/kifu";
import Form from "@/shared/ui/Form/Form";
import FormField from "@/shared/ui/Form/FormField";
import Textarea from "@/shared/ui/Form/Textarea";
import TextInput from "@/shared/ui/Form/TextInput";
import Select from "@/shared/ui/Form/Select";
import ButtonGroup from "@/shared/ui/Form/ButtonGroup";
import Button from "@/shared/ui/Button/Button";
import "./KifuImportForm.scss";

function stripKnownExt(name: string) {
  return name.replace(/\.(kif|ki2|csa|jkf)$/i, "");
}

function KifuImportForm({
  onCreated,
  onCancel,
  hidden = false,
  dirPath,
  onSubmittingChange,
}: {
  /** 取り込めたので器を閉じる。**確認は通さない**（捨てるものが無い） */
  onCreated: () => void;
  /**
   * 利用者が「キャンセル」を押した
   *
   * **器の閉じる門を通す。** 直に閉じると、隣のタブで組みかけの局面を持っていても
   * 確認を1つも通らずに消える（閉じる口は Esc・覆い・両方の面の取り消しで4つある）。
   */
  onCancel: () => void;
  /** 器が別のタブを出しているあいだ。**外さずに隠す**ので、貼りかけの棋譜は残る */
  hidden?: boolean;
  /** ツリーから開いたときの保存先。ようこそ画面から開くと来ない */
  dirPath: string;
  /**
   * 取り込み中かどうかを器へ知らせる
   *
   * 器はこのあいだタブを沈め、閉じる口も止める。知らせないと、送信の途中で
   * この面が外れて**失敗を出す場所ごと消える**。
   */
  onSubmittingChange?: (submitting: boolean) => void;
}) {
  const { importKifuFile, fileTree } = useFileTree();

  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<KifuFormat>("kif");
  const [rawContent, setRawContent] = useState("");

  const [parseOk, setParseOk] = useState<boolean | null>(null);
  const [parseError, setParseError] = useState("");
  const [submitError, setSubmitError] = useState<FsError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * 保存先
   *
   * **欄を持つ。** 入口は2つあり、ようこそ画面から開くと `dir=` が来ない。
   * 空のまま送ると Rust 側が `invalid_path` を返すので、
   * **保存先を一度も選んでいないのに「その場所は扱えません」と言われる**。
   */
  const rootPath = fileTree?.path ?? "";
  const dirOptions = useMemo(
    () => (fileTree ? collectDirs(fileTree, rootPath) : []),
    [fileTree, rootPath],
  );
  const [selectedDir, setSelectedDir] = useState(dirPath || rootPath);

  // ツリーの根が入れ替わったら保存先を根へ戻す
  const [prevRoot, setPrevRoot] = useState(rootPath);
  if (rootPath !== prevRoot) {
    setPrevRoot(rootPath);
    setSelectedDir(rootPath);
  }

  const fullFileName = useMemo(() => {
    const base = stripKnownExt(fileName.trim());
    if (!base) return "";
    return `${base}.${format}`;
  }, [fileName, format]);

  // **見えてから焦点を移す。** 面は隠れていても木に在るので、マウントの時点は
  // 「この面が見えている時点」ではない。`display: none` の中で `focus()` を
  // 呼んでも何も起きず、そのあとタブで出てきても焦点を動かす口が他に無い
  const rawRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (hidden) return;
    // 次のフレームまで待つ。器の `Modal` は開いた直後に焦点を引き戻すので、
    // 同じターンで移すと奪われる
    requestAnimationFrame(() => rawRef.current?.focus());
  }, [hidden]);

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

    if (!name || !text || !selectedDir) return;
    if (parseOk !== true) return;
    // 取り込みは書き込みとツリーの読み直しを通る。押しても画面が変わらない間に
    // もう一度押すと、1回目は成功して2回目が already_exists になる
    if (isSaving) return;

    setSubmitError(null);
    setIsSaving(true);
    onSubmittingChange?.(true);
    try {
      const result = await importKifuFile(selectedDir, name, text);
      if (result.success) {
        onCreated();
        return;
      }

      // 衝突は別名を選ぶ対話が引き取る。ここで描くと対話の背後に二重に出る
      if (!isResolvedByConflictDialog(result.error.code)) {
        setSubmitError(result.error);
      }
    } finally {
      setIsSaving(false);
      onSubmittingChange?.(false);
    }
  };

  return (
    <Form handleSubmit={handleSubmit}>
      <FormField>
        <h2 className="form__heading-secondary">棋譜をインポートして作成</h2>
      </FormField>

      <FormField>
        <Textarea
          label="棋譜テキスト"
          id="rawKifu"
          ref={rawRef}
          placeholder=".kif / .ki2 / .csa / .jkf を貼り付け（Ctrl/⌘+V）"
          value={rawContent}
          onChange={(e) => setRawContent(e.target.value)}
        />
      </FormField>

      <FormField>
        {parseOk === null ? (
          <div className="kifu-import__parse kifu-import__parse--idle">
            解析: 未実行（棋譜を入力してください）
          </div>
        ) : parseOk ? (
          <div className="kifu-import__parse">解析: OK</div>
        ) : (
          <div className="kifu-import__parse">
            解析: 失敗しました
            <details className="kifu-import__parseDetail">
              <summary>詳細</summary>
              <pre className="kifu-import__parseRaw">{parseError}</pre>
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
          options={KIFU_FORMAT_OPTIONS}
          value={format}
          onChange={setFormat}
        />
      </FormField>

      <FormField>
        <Select
          label="保存先"
          id="import-dir"
          options={dirOptions}
          value={selectedDir}
          onChange={setSelectedDir}
        />
        {dirOptions.length === 0 && (
          <p className="kifu-import__parse kifu-import__parse--idle">
            保存先がありません。先にワークスペースを開いてください
          </p>
        )}
      </FormField>

      <FormField>
        <div className="kifu-import__saveName">保存名: {fullFileName || "（未入力）"}</div>
      </FormField>

      {/* 押した場所の隣に出す。入力欄は残すので、名前を直してそのまま押し直せる */}
      {submitError && (
        <FormField>
          <FsErrorView error={submitError} />
        </FormField>
      )}

      <ButtonGroup>
        <Button
          type="submit"
          tone="primary"
          isLoading={isSaving}
          disabled={!fullFileName || !rawContent.trim() || parseOk !== true || !selectedDir}
        >
          {isSaving ? "作成中..." : "インポートして作成"}
        </Button>
        <Button type="button" onClick={onCancel} disabled={isSaving}>
          キャンセル
        </Button>
      </ButtonGroup>
    </Form>
  );
}

export default KifuImportForm;
