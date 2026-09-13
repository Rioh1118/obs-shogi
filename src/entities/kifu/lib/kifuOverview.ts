import { HANDICAP_PRESETS } from "../model/handicap";
import type { JKFData } from "../model/jkf";
import { playerNames } from "./playerNames";

export type KifuFact = {
  label: string;
  value: string;
};

/**
 * 棋譜に**必ず出す**欄と、その並び
 *
 * 無くても行を残すのは、**欠けていること自体が手掛かり**だから ——
 * 対局者の入っていない棋譜を貼ったことは、行が消えるより「—」のほうが読める。
 */
const ALWAYS: readonly { label: string; key: string }[] = [
  { label: "先手", key: "先手" },
  { label: "後手", key: "後手" },
  { label: "棋戦", key: "棋戦" },
  { label: "開始日時", key: "開始日時" },
];

/**
 * 画面に出さないヘッダの欄
 *
 * **この2つはアプリが書いた持ち物**（`createInitialJKFData`）で、
 * 棋譜の素性ではない。混ぜると、自分で作った棋譜だけ欄が2つ増えて見える。
 */
const INTERNAL = new Set(["note", "tags"]);

/** 欄が無いことを画面で表す。**空文字で埋めない** —— 打ち忘れと区別が付かなくなる */
const ABSENT = "—";

/**
 * 棋譜の素性を、画面に出せる並びで取り出す
 *
 * **ヘッダの欄名を知るのはここと `playerNames` だけ。** `"棋戦"` や `"開始日時"` は
 * JKF の語彙なので、読む側（`features/`）に散らすと同じ棋譜について画面ごとに
 * 違う答えが出る（対局者名で実際に起きた —— 空白だけの欄を、片方は「無い」、
 * 片方は「空文字」として扱っていた）。
 *
 * **決め打ちの欄で終わらない。** 棋譜が持っている欄はそのまま後ろに続ける ——
 * 「持ち時間」も「戦型」も棋譜によって在ったり無かったりするので、
 * 一覧を決め打つと、貼った棋譜に書いてあることが画面から消える。
 */
export function kifuOverview(jkf: JKFData): KifuFact[] {
  const header = jkf.header ?? {};
  const names = playerNames(jkf);

  const pick = (key: string): string | null => {
    const value = (header[key] ?? "").trim();
    return value.length > 0 ? value : null;
  };

  const facts: KifuFact[] = [
    { label: "先手", value: names.sente ?? ABSENT },
    { label: "後手", value: names.gote ?? ABSENT },
    { label: "棋戦", value: pick("棋戦") ?? ABSENT },
    { label: "開始日時", value: pick("開始日時") ?? ABSENT },
    { label: "手合割", value: handicapLabel(jkf) },
  ];

  const shown = new Set([...ALWAYS.map((f) => f.key), "手合割"]);
  for (const [key, raw] of Object.entries(header)) {
    if (shown.has(key) || INTERNAL.has(key)) continue;
    const value = raw.trim();
    if (value.length > 0) facts.push({ label: key, value });
  }

  return facts;
}

/**
 * 初期局面の名前
 *
 * **ヘッダの文字列より `initial` を信じる。** ヘッダは書き手が打った文字で、
 * 局面そのものとは独立に書き換わりうる（「手合割：平手」と書かれた駒落ちの棋譜が作れる）。
 * `initial` が無い棋譜は平手（JKF の既定）。
 */
function handicapLabel(jkf: JKFData): string {
  const preset = jkf.initial?.preset;
  if (preset === undefined) return "平手";

  const known = HANDICAP_PRESETS.find((p) => p.value === preset);
  if (known) return known.label;

  // 手合割として選ばせていない綴り（`OTHER` と `HIKY`）。盤面そのものが入っている
  return "この棋譜の局面";
}
