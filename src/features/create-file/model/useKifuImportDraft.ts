import { useMemo, useState } from "react";
import { readKifuText, type KifuReadResult } from "@/entities/kifu/api/parse";
import { kifuFileName, type KifuFormat } from "@/entities/kifu/model/kifu";

/**
 * 貼りかけの棋譜と、作るファイルの指定
 *
 * **組む面の `usePositionDraft` と同じ役。** 面の中に散らすと、`isDirty`（捨てるものが
 * あるか）や「送れるか」の判定が描画のたびに別々の綴りで書かれ、器が数えたいものと
 * 画面が出しているものが離れていく。
 *
 * **判定そのものは持たない。** 棋譜として読めたかは `readKifuText`、
 * 書き込む名前は `kifuFileName` が決める（どちらも `entities/kifu`）。
 * ここが持つのは「いま何が打たれているか」と、そこから引ける組み合わせだけ。
 */
interface KifuImportDraft {
  rawContent: string;
  setRawContent: (value: string) => void;
  fileName: string;
  setFileName: (value: string) => void;
  format: KifuFormat;
  setFormat: (value: KifuFormat) => void;

  /** 貼られたテキストを読んだ結果。未入力なら `null` */
  read: KifuReadResult | null;
  /** 書き込むファイル名。名前が空なら空文字 */
  fullFileName: string;
  /**
   * 捨てるものがあるか
   *
   * **貼られたテキストだけを見る。** ファイル名や形式を触っただけでは立てない ——
   * 組む面が盤・駒台・手番しか見ないのと同じ理由で、聞きすぎると
   * 聞かれること自体が意味を失う。
   */
  isDirty: boolean;
}

export function useKifuImportDraft(): KifuImportDraft {
  const [rawContent, setRawContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<KifuFormat>("kif");

  /**
   * **貼られたテキストから毎回引く。** state に置くと、`rawContent` が新しくて
   * この値が古い組み合わせが作れてしまい、送ってよいかの判定がどちらを信じるか決まらない。
   */
  const read = useMemo(() => (rawContent.trim() ? readKifuText(rawContent) : null), [rawContent]);

  const fullFileName = useMemo(() => kifuFileName(fileName, format), [fileName, format]);

  return {
    rawContent,
    setRawContent,
    fileName,
    setFileName,
    format,
    setFormat,
    read,
    fullFileName,
    isDirty: rawContent.trim() !== "",
  };
}
