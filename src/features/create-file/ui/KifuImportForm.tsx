import { useEffect, useMemo, useRef, useState } from "react";
import { KifuParseError } from "@/entities/kifu/api/parse";
import {
  collectDirs,
  FsErrorView,
  isResolvedByConflictDialog,
  useFileTree,
  type FsError,
} from "@/entities/file-tree";
import { parseKifuStringToJKF } from "@/entities/kifu/api/parse";
import { KIFU_FORMAT_OPTIONS, kifuFileName, type KifuFormat } from "@/entities/kifu/model/kifu";
import Form from "@/shared/ui/Form/Form";
import FormField from "@/shared/ui/Form/FormField";
import Textarea from "@/shared/ui/Form/Textarea";
import TextInput from "@/shared/ui/Form/TextInput";
import Select from "@/shared/ui/Form/Select";
import ButtonGroup from "@/shared/ui/Form/ButtonGroup";
import Button from "@/shared/ui/Button/Button";
import InlineNotice from "@/shared/ui/notification/InlineNotice";
import "./KifuImportForm.scss";

/**
 * 貼られた棋譜を読んだ結果
 *
 * **3つの状態を1つの値で持つ。** 「読めたか」と「読めなかった理由」を別々に持つと、
 * 読めているのに理由が残っている組み合わせが作れて、どちらを信じるかが決まらない。
 */
type ParseResult =
  | { kind: "none" }
  | { kind: "read"; format: KifuFormat; moves: number }
  | { kind: "unreadable"; message: string; cause?: string };

/**
 * 貼り直せば直るかもしれないことを、この面の言葉で添える
 *
 * **`KifuParseError` の文言に混ぜない。** 同じ失敗はファイルを開く経路でも起きるので、
 * 「貼り付けてください」を出典側に書くと、開いた棋譜が読めなかったときに
 * 貼ってもいない利用者へ貼り直しを求めることになる。
 */
const HOW_TO_FIX = "KIF / KI2 / CSA / JKF のいずれかを、先頭から末尾まで貼り付けてください。";

/**
 * 貼られたテキストを読む
 *
 * **投げなかったことを「読めた」と読まない。** KIF / KI2 / CSA のインポータは
 * 指し手を1つも読み取れなくても `Error` ではなく空の record を返す
 * （`parseKifuStringToJKF` の doc）ので、棋譜でない文章がそのまま通る。
 * 通すと「読めました」と言い切ったうえで**中身の無いファイルを作り、
 * 貼ったテキストごと器を閉じる** —— 利用者は何が消えたのかも分からない。
 */
function readKifu(raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { kind: "none" };

  try {
    const { detectedFormat, jkf } = parseKifuStringToJKF(text);
    // `moves` の先頭は初期局面の枠なので手数から外す
    const moves = jkf.moves.length - 1;
    if (moves <= 0) {
      return {
        kind: "unreadable",
        message: `指し手を1つも読み取れませんでした。${HOW_TO_FIX}`,
      };
    }
    return { kind: "read", format: detectedFormat, moves };
  } catch (e) {
    // **画面に出すのは利用者向けの一文だけ。** `KifuParseError` の `message` は
    // そのために書かれた日本語だが、それ以外は tsshogi の内部から抜けてきた英文
    // （深く入れ子になった JKF での `RangeError` など）なので、そのまま出さない
    if (e instanceof KifuParseError) {
      return { kind: "unreadable", message: `${e.message}${HOW_TO_FIX}`, cause: String(e.cause) };
    }
    return {
      kind: "unreadable",
      message: `棋譜として読み取れませんでした。${HOW_TO_FIX}`,
      cause: String(e),
    };
  }
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
   * 利用者が「やめる」を押した
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

  // **選んでいたフォルダだけが消えたときも根へ戻す。** `Select` は選択肢に無い値を
  // プレースホルダで描くので、欄は「選択してください」に戻る。値だけ残すと、
  // **画面が「選んでいない」と言っているのに消えたパスへ書きに行く**
  if (selectedDir && dirOptions.length > 0 && !dirOptions.some((o) => o.value === selectedDir)) {
    setSelectedDir(rootPath);
  }

  const fullFileName = useMemo(() => kifuFileName(fileName, format), [fileName, format]);

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

  /**
   * **貼られたテキストから毎回引く。** state に置くと、`rawContent` が新しくて
   * この値が古い組み合わせで描かれるコミットが打鍵ごとに1回挟まり、
   * 送信条件（`parsed.kind`）がどちらを信じるか決まらなくなる
   */
  const parsed = useMemo(() => readKifu(rawContent), [rawContent]);

  // 開発者向けの手掛かりはコンソールへ。**配布ビルドには残らない** ——
  // 棋譜のパースは webview の中だけで走り、`tauri-plugin-log` は Rust のログしか受けない。
  // 開発中に追うためのもので、利用者から原因を受け取る口ではない（→ #157）
  useEffect(() => {
    if (parsed.kind === "unreadable" && parsed.cause) {
      console.error("[create-file] 貼られた棋譜を読めなかった", parsed.cause);
    }
  }, [parsed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const name = fullFileName;
    const text = rawContent.trim();

    if (!name || !text || !selectedDir) return;
    if (parsed.kind !== "read") return;
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
    /*
      **左が素材、右がファイルの欄。** 盤の面（`pos-editor`）と同じ骨格にしてある ——
      タブを跨いでも欄の位置が動かず、「作成」がどちらの面でも同じ場所にある。
      右の列の幅も盤の面と同じ（`$side-w`）。

      **見出しを置かない。** 器が「棋譜を作る」を名乗り、タブが「インポート」を
      名乗っている。3つ目を足すと、この面が何なのかを3箇所で言うことになる。
    */
    <div className="kifu-import" hidden={hidden}>
      <div className="kifu-import__main">
        <Textarea
          label="棋譜テキスト"
          id="rawKifu"
          ref={rawRef}
          placeholder=".kif / .ki2 / .csa / .jkf を貼り付け"
          value={rawContent}
          onChange={(e) => setRawContent(e.target.value)}
        />

        {/*
          **貼る欄の下に出す。** 直すのは貼ったテキストなので、そこから目を離させない
          （ADR-0004 決定4）。**未入力では何も出さない** —— 貼る前に「貼ってください」と
          言う場所は、貼る欄そのものの placeholder が既に持っている
        */}
        {parsed.kind === "read" && (
          <p className="kifu-import__read" role="status">
            棋譜として読めました
            <span className="kifu-import__readDetail">
              {parsed.format} ／ {parsed.moves}手
            </span>
          </p>
        )}
        {parsed.kind === "unreadable" && (
          /*
            段は `danger`（ADR-0004 決定1）—— 同じテキストをもう一度貼っても直らず、
            直し方は棋譜ごとに違う。**ボタンは付けない**（押して直るものが無い）
          */
          <InlineNotice tier="danger" title="棋譜として読めませんでした" body={parsed.message} />
        )}
      </div>

      <div className="kifu-import__side">
        <Form handleSubmit={handleSubmit}>
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
              label="形式"
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
              <p className="kifu-import__hint">
                保存先がありません。先にワークスペースを開いてください
              </p>
            )}
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
              disabled={!fullFileName || parsed.kind !== "read" || !selectedDir}
            >
              {isSaving ? "作成中..." : "作成"}
            </Button>
            {/* 盤の面と同じ語。**同じ門（`closeGuard`）を通る同じ操作**なので、
                面ごとに別の語を当てると、戻り先が違うように読める */}
            <Button type="button" onClick={onCancel} disabled={isSaving}>
              やめる
            </Button>
          </ButtonGroup>
        </Form>
      </div>
    </div>
  );
}

export default KifuImportForm;
