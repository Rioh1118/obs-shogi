import { useCallback, useMemo, useState } from "react";
import type { HandicapPreset } from "@/entities/kifu/model/handicap";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { KIFU_FORMAT_OPTIONS, type KifuFormat } from "@/entities/kifu/model/kifu";
import {
  collectDirs,
  FsErrorView,
  isResolvedByConflictDialog,
  useFileTree,
  type FsError,
} from "@/entities/file-tree";
import Form from "@/shared/ui/Form/Form";
import FormField from "@/shared/ui/Form/FormField";
import TextInput from "@/shared/ui/Form/TextInput";
import Select from "@/shared/ui/Form/Select";
import { TagsInput } from "@/shared/ui/Form/TagsInput";
import Textarea from "@/shared/ui/Form/Textarea";
import ButtonGroup from "@/shared/ui/Form/ButtonGroup";
import Button from "@/shared/ui/Button/Button";

interface EditorCreateFormProps {
  /** 組んだ局面 */
  state: JKFState;
  /**
   * いま載っている手合割。組みかけなら `null`
   *
   * **出口に書くものがこれで変わる。** 手合割のままなら `{preset}`、
   * それ以外は `{preset: "OTHER", data}`。
   */
  handicap: HandicapPreset | null;
  /** ツリーから開いたときの保存先。ようこそ画面から開くと来ない */
  initialDir?: string;
  onCreated: () => void;
  onCancel: () => void;
  /**
   * 送信中かどうかを外へ知らせる
   *
   * Esc の段は**作成中を最初に見る**（止められないので無視する）ので、
   * 段を判定する側がこの旗を要る。
   */
  onSubmittingChange: (submitting: boolean) => void;
}

/**
 * 組んだ局面から棋譜ファイルを作るフォーム
 *
 * **保存先の欄を持つ。** 入口がツリーの `＋ファイル` だけなら `dir=` が必ず来るが、
 * ようこそ画面からも開くので、そちらでは来ない。欄が無いと、来なかったときに
 * 黙って root へ作ることになる。
 *
 * 失敗の見せ方は `sfen-kifu-create` と揃える —— 衝突は別名を選ぶ対話が引き取り、
 * それ以外はこのフォームの中に出して**入力欄を残す**。差し替えると入力欄が消え、
 * 失敗して戻ったときキーボードの利用者は自分がどこにいるか分からなくなる。
 */
function EditorCreateForm({
  state,
  handicap,
  initialDir,
  onCreated,
  onCancel,
  onSubmittingChange,
}: EditorCreateFormProps) {
  const { createNewFile, fileTree } = useFileTree();

  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<KifuFormat>("kif");
  const [blackPlayer, setBlackPlayer] = useState("");
  const [whitePlayer, setWhitePlayer] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<FsError | null>(null);

  const rootPath = fileTree?.path ?? "";
  const dirOptions = useMemo(
    () => (fileTree ? collectDirs(fileTree, rootPath) : []),
    [fileTree, rootPath],
  );

  const [selectedDir, setSelectedDir] = useState(initialDir || rootPath);

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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!fileName.trim() || !selectedDir || isSubmitting) return;

      setSubmitError(null);
      setIsSubmitting(true);
      onSubmittingChange(true);
      const result = await createNewFile(selectedDir, {
        fileName: `${fileName.trim()}.${format}`,
        format,
        gameInfo: {
          black: blackPlayer.trim() || undefined,
          white: whitePlayer.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
          note: note.trim() ? note : undefined,
        },
        // **手合割のままなら手合割として書く。** 常に `OTHER` にすると、
        // 平手をそのまま作っただけの棋譜から「手合割：平手」が消える。
        // 逆に常に手合割として書くと、並べ替えが黙って落ちる
        initialPosition:
          handicap !== null ? { preset: handicap } : { preset: "OTHER", data: state },
      });
      setIsSubmitting(false);
      onSubmittingChange(false);

      if (result.success) {
        onCreated();
        return;
      }

      // 衝突は別名を選ぶ対話が引き取る。ここで描くと対話の背後に二重に出る
      if (!isResolvedByConflictDialog(result.error.code)) {
        setSubmitError(result.error);
      }
    },
    [
      state,
      handicap,
      fileName,
      format,
      blackPlayer,
      whitePlayer,
      tags,
      note,
      selectedDir,
      isSubmitting,
      createNewFile,
      onCreated,
      onSubmittingChange,
    ],
  );

  return (
    <Form handleSubmit={handleSubmit}>
      <FormField horizontal>
        <TextInput
          label="ファイル名"
          id="pos-editor-file-name"
          placeholder="45角戦法"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          required
        />
        <Select
          label="形式"
          id="pos-editor-format"
          options={KIFU_FORMAT_OPTIONS}
          value={format}
          onChange={setFormat}
        />
      </FormField>

      <FormField>
        <Select
          label="保存先"
          id="pos-editor-dir"
          options={dirOptions}
          value={selectedDir}
          onChange={setSelectedDir}
        />
        {dirOptions.length === 0 && (
          <p className="pos-editor__form-hint">
            保存先がありません。先にワークスペースを開いてください
          </p>
        )}
      </FormField>

      <FormField horizontal>
        <TextInput
          label="先手名"
          id="pos-editor-black"
          placeholder="Player1"
          value={blackPlayer}
          onChange={(e) => setBlackPlayer(e.target.value)}
        />
        <TextInput
          label="後手名"
          id="pos-editor-white"
          placeholder="Player2"
          value={whitePlayer}
          onChange={(e) => setWhitePlayer(e.target.value)}
        />
      </FormField>

      <FormField>
        <TagsInput label="タグ" id="pos-editor-tags" tags={tags} onChange={setTags} />
      </FormField>

      <FormField>
        <Textarea
          label="メモ"
          id="pos-editor-note"
          placeholder="この局面から何を調べるか..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>

      {/* 押した場所の隣に出す。入力欄は残すので、名前を直してそのまま押し直せる */}
      {submitError && (
        <FormField>
          <FsErrorView error={submitError} />
        </FormField>
      )}

      <ButtonGroup>
        {/* **断りが出ていても押せる。** 押せなくすると詰将棋が作れない */}
        <Button
          type="submit"
          tone="primary"
          isLoading={isSubmitting}
          disabled={!fileName.trim() || !selectedDir}
        >
          {isSubmitting ? "作成中..." : "作成"}
        </Button>
        <Button type="button" onClick={onCancel} disabled={isSubmitting}>
          やめる
        </Button>
      </ButtonGroup>
    </Form>
  );
}

export default EditorCreateForm;
