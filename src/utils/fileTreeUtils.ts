import type { KifuCreationOptions, JKFData } from "@/types";

export function createInitialJKFData(options: KifuCreationOptions): JKFData {
  // gameInfoをJKFのheader形式に変換
  const header: { [key: string]: string } = {};

  if (options.gameInfo.black) header["先手"] = options.gameInfo.black;
  if (options.gameInfo.white) header["後手"] = options.gameInfo.white;
  if (options.gameInfo.date) header["開始日時"] = options.gameInfo.date;
  if (options.gameInfo.note) header["note"] = options.gameInfo.note;
  if (options.gameInfo.tags && options.gameInfo.tags.length > 0) {
    header["tags"] = options.gameInfo.tags.join(",");
  }

  // 基本的なJKFData構造
  const jkfData: JKFData = {
    header,
    initial: {
      preset: options.initialPosition.preset,
    },
    moves: [{}],
  };

  // "OTHER"の場合のみdataを設定
  if (
    options.initialPosition.preset === "OTHER" &&
    options.initialPosition.data
  ) {
    jkfData.initial!.data = options.initialPosition.data;
  }

  return jkfData;
}
