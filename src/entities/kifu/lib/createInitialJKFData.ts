import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuCreationOptions } from "@/entities/kifu/model/kifu";

export function createInitialJKFData(options: KifuCreationOptions): JKFData {
  const header: Record<string, string> = {};

  if (options.gameInfo.black) header["先手"] = options.gameInfo.black;
  if (options.gameInfo.white) header["後手"] = options.gameInfo.white;
  if (options.gameInfo.date) header["開始日時"] = options.gameInfo.date;
  if (options.gameInfo.note) header["note"] = options.gameInfo.note;

  if (options.gameInfo.tags && options.gameInfo.tags.length > 0) {
    header["tags"] = options.gameInfo.tags.join(",");
  }

  const jkfData: JKFData = {
    header,
    initial: { preset: options.initialPosition.preset },
    moves: [{}],
  };

  if (
    options.initialPosition.preset === "OTHER" &&
    options.initialPosition.data
  ) {
    jkfData.initial!.data = options.initialPosition.data;
  }

  return jkfData;
}
