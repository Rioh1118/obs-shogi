import { useEffect, useMemo, useRef, useState } from "react";
import {
  collectDirs,
  FsErrorView,
  isResolvedByConflictDialog,
  useFileTree,
  type FsError,
} from "@/entities/file-tree";
import { KIFU_FORMAT_OPTIONS } from "@/entities/kifu/model/kifu";
import Form from "@/shared/ui/Form/Form";
import FormField from "@/shared/ui/Form/FormField";
import Textarea from "@/shared/ui/Form/Textarea";
import TextInput from "@/shared/ui/Form/TextInput";
import Select from "@/shared/ui/Form/Select";
import ButtonGroup from "@/shared/ui/Form/ButtonGroup";
import Button from "@/shared/ui/Button/Button";
import InlineNotice from "@/shared/ui/notification/InlineNotice";
import { useKifuImportDraft } from "../model/useKifuImportDraft";
import "./KifuImportForm.scss";

/**
 * 貼り直せば直るかもしれないことを、この面の言葉で添える
 *
 * **読めたかを判定する側（`readKifuText`）に混ぜない。** 同じ失敗はファイルを開く
 * 経路でも起きるので、出典に「貼り付けてください」と書くと、貼ってもいない利用者へ
 * 貼り直しを求めることになる。
 */
const HOW_TO_FIX = "KIF / KI2 / CSA / JKF のいずれかを、先頭から末尾まで貼り付けてください。";

function KifuImportForm({
  onCreated,
  onCancel,
  hidden = false,
  dirPath,
  onSubmittingChange,
  onDirtyChange,
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
  /**
   * 貼りかけを器へ知らせる
   *
   * **閉じるときの確認は器が出す**（状態遷移表の直交軸「捨てるもの」）。
   * 捨てるものは隣のタブの組みかけにもあり、**両方を数えられるのは器だけ**。
   */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { importKifuFile, fileTree } = useFileTree();

  /**
   * 貼りかけと、作るファイルの指定
   *
   * **この面は判定を持たない。** 棋譜として読めたか・書き込む名前・捨てるものがあるかは
   * 下書きの側が答える（組む面の `usePositionDraft` と同じ役）。
   * ここが決めるのは、その答えをどう言葉にして、どこに置くかだけ。
   */
  const {
    rawContent,
    setRawContent,
    fileName,
    setFileName,
    format,
    setFormat,
    read,
    fullFileName,
    isDirty,
  } = useKifuImportDraft();

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
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // 開発者向けの手掛かりはコンソールへ。**配布ビルドには残らない** ——
  // 棋譜のパースは webview の中だけで走り、`tauri-plugin-log` は Rust のログしか受けない。
  // 開発中に追うためのもので、利用者から原因を受け取る口ではない（→ #157）
  useEffect(() => {
    if (read && !read.readable && read.cause) {
      console.error("[create-file] 貼られた棋譜を読めなかった", read.cause);
    }
  }, [read]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const name = fullFileName;
    const text = rawContent.trim();

    if (!name || !text || !selectedDir) return;
    if (!read?.readable) return;
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
      **貼る欄を高くしない。** この面で要るのは「貼れたか」と「棋譜として読めたか」で、
      棋譜の中身をここで読む用途は無い（読むのは作ったあとの盤）。器の高さを貼る欄に
      配ると、確かめたい1行（読めたか）が器の下端まで遠ざかる。

      欄は貼る欄の下に横一列。**見出しを置かない** —— 器が「棋譜を作る」を名乗り、
      タブが「インポート」を名乗っているので、3つ目を足すとこの面が何なのかを
      3箇所で言うことになる。
    */
    <div className="kifu-import" hidden={hidden}>
      <Form handleSubmit={handleSubmit}>
        <FormField>
          <Textarea
            label="棋譜テキスト"
            id="rawKifu"
            ref={rawRef}
            placeholder=".kif / .ki2 / .csa / .jkf を貼り付け"
            value={rawContent}
            onChange={(e) => setRawContent(e.target.value)}
          />
        </FormField>

        {/*
          **貼る欄の下に出す。** 直すのは貼ったテキストなので、そこから目を離させない
          （ADR-0004 決定4）。**未入力では何も出さない** —— 貼る前に「貼ってください」と
          言う場所は、貼る欄そのものの placeholder が既に持っている
        */}
        {read?.readable && (
          <p className="kifu-import__read" role="status">
            棋譜として読めました
            <span className="kifu-import__readDetail">
              {read.format} ／ {read.moves}手
            </span>
          </p>
        )}
        {read && !read.readable && (
          /*
            段は `danger`（ADR-0004 決定1）—— 同じテキストをもう一度貼っても直らず、
            直し方は棋譜ごとに違う。**ボタンは付けない**（押して直るものが無い）。
            この面で何をすればよいかは、判定の側でなくここが足す
          */
          <InlineNotice
            tier="danger"
            title="棋譜として読めませんでした"
            body={`${read.message}${HOW_TO_FIX}`}
          />
        )}

        {/* 3つとも短いので横に並べる。`--horizontal` は入る数だけ列を作るので、
            器が細ければ勝手に縦へ落ちる */}
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
          <Select
            label="保存先"
            id="import-dir"
            options={dirOptions}
            value={selectedDir}
            onChange={setSelectedDir}
          />
        </FormField>

        {dirOptions.length === 0 && (
          <p className="kifu-import__hint">
            保存先がありません。先にワークスペースを開いてください
          </p>
        )}

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
            size="lg"
            isLoading={isSaving}
            disabled={!fullFileName || !read?.readable || !selectedDir}
          >
            {isSaving ? "作成中..." : "作成"}
          </Button>
          {/* 盤の面と同じ語。**同じ門を通る同じ操作**なので、
              面ごとに別の語を当てると、戻り先が違うように読める */}
          <Button type="button" size="lg" onClick={onCancel} disabled={isSaving}>
            やめる
          </Button>
        </ButtonGroup>
      </Form>
    </div>
  );
}

export default KifuImportForm;
