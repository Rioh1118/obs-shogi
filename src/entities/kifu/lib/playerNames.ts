import type { JKFData } from "../model/jkf";

export type PlayerNames = {
  sente: string | null;
  gote: string | null;
};

/**
 * 棋譜のヘッダから対局者名を取り出す。**欄名を知っているのはここだけ。**
 *
 * `"先手"` / `"後手"` は JKF の語彙なので、読む側（`widgets/`）に散らすと
 * 同じ棋譜について画面ごとに違う答えが出る。実際に、空白だけの欄を
 * 片方は「無い」、片方は「空文字」として扱っていた。
 *
 * **欠けているかは `null` で1つに決める。** 前後の空白を落として空になったら無い。
 * 無いときに何を出すか（`—` か「先手」か）は表示の判断なので、呼び出し側に残す。
 */
export function playerNames(jkf: JKFData | null): PlayerNames {
  const header = jkf?.header ?? {};
  const pick = (key: string): string | null => {
    const value = (header[key] ?? "").trim();
    return value.length > 0 ? value : null;
  };

  return { sente: pick("先手"), gote: pick("後手") };
}
