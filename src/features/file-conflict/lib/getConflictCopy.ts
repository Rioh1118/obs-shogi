import type { ConflictCopy, FileConflictState } from "../model/types";
import { getConflictKind } from "./getConflictKind";

export function getConflictCopy(conflict: FileConflictState): ConflictCopy {
  const kind = getConflictKind(conflict.request);
  const noun = kind === "file" ? "ファイル" : "フォルダ";

  switch (conflict.request.kind) {
    case "create_file":
      return {
        title: `同名の${noun}が既に存在します`,
        description: "新しいファイルを作成しようとしましたが、保存先に同名の項目があります。",
        cancelLabel: "キャンセル",
        renameLabel: "名前を変える",
        canRename: true,
      };

    case "import_file":
      return {
        title: `同名の${noun}が既に存在します`,
        description:
          "インポート先に同名のファイルがあります。名前を見直してもう一度保存してください。",
        cancelLabel: "キャンセル",
        renameLabel: "名前を変える",
        canRename: true,
      };

    case "create_directory":
      return {
        title: `同名の${noun}が既に存在します`,
        description: "新しいフォルダを作成しようとしましたが、保存先に同名の項目があります。",
        cancelLabel: "キャンセル",
        renameLabel: "名前を変える",
        canRename: true,
      };

    case "rename_file":
    case "rename_directory":
      return {
        title: `変更先の${noun}名が既に使われています`,
        description:
          "名前を変更しようとしましたが、変更先に同名の項目があります。別の名前を入力してください。",
        cancelLabel: "キャンセル",
        renameLabel: "名前を変える",
        canRename: true,
      };

    case "move_file":
    case "move_directory":
      return {
        title: `移動先に同名の${noun}が既に存在します`,
        description: "移動先で名前が重複しています。別の名前を指定してそのまま移動できます。",
        cancelLabel: "キャンセル",
        renameLabel: "別名で移動",
        canRename: true,
      };

    default:
      return {
        title: "同名の項目が既に存在します",
        description: "続ける前に名前を見直してください。",
        cancelLabel: "閉じる",
        canRename: false,
      };
  }
}
