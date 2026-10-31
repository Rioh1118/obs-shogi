import type { StartWarning } from "@/entities/engine";

type WarningTexts = {
  [K in StartWarning["kind"]]: ((warning: Extract<StartWarning, { kind: K }>) => string) | null;
};

/**
 * 起動で送らなかった・変えて送った設定を、1件1文で言う。**全種類を書かせる**
 * （種類が Rust から届いていることは `startFailureKindWire.test.ts` が見る）。
 *
 * **`null` はトーストに出さない種類**（ログには残る）。`notDeclared` は、利用者が触っていない値で
 * **起動のたびに**出る——保存済みのプリセットには、利用者が触っていない値（`NetworkDelay` など）を
 * 持つものがあり、それを申告しないエンジンでは毎回出る。毎回知らせると、同じトーストに載る本物の警告まで読まれなくなる。
 *
 * どの文も「どうなったか」と「どうすればよいか」を言う。オプションの名前はエンジンが決めた綴りの
 * まま出す（利用者がプリセットで見る綴り）
 */
const TEXTS: WarningTexts = {
  notDeclared: null,
  overriddenByBinding: ({ name }) =>
    `${name} は評価関数・定跡の選択か検討の決まりの値で送りました（プリセットの値は使っていません）。`,
  clamped: ({ name, value }) =>
    `${name} はエンジンの範囲に収まらないので ${value} で送りました。プリセットの値を範囲に収めてください。`,
  notInVars: ({ name, value }) =>
    `${name} の「${value}」はエンジンの選択肢に無いので送っていません。プリセットの値を直してください。`,
  invalidType: ({ name, value }) =>
    `${name} の「${value}」はエンジンが受けない形なので送っていません。プリセットの値を直してください。`,
  evalNotSupported: () =>
    "このエンジンは評価関数を指定できないので、選んだ評価関数を送っていません。",
  evalNotChosen: ({ name }) =>
    `このエンジンは評価関数を受けます（${name}）が、プリセットで選んでいないのでエンジンの初期値で動いています。設定の「エンジン管理」で評価関数を選択してください。`,
  evalNeedsFile: ({ name }) =>
    `このエンジンは評価関数をファイルで受けます（${name}）。フォルダを選んでいるので送っていません。ファイルを選択してください。`,
  bookNotSupported: () => "このエンジンは定跡を指定できないので、定跡なしで検討しています。",
  bookNameNotInVars: ({ file }) =>
    `このエンジンは決まった名前の定跡しか読めないので、${file} は使わず定跡なしで検討しています。エンジンが受ける名前（user_book1.db など）に変えて選択し直してください。`,
  bookCannotBeDisabled: () =>
    "このエンジンは定跡を切れないので、エンジンの初期値の定跡を使うことがあります。",
  bookPathCheckTimedOut: ({ file }) =>
    `${file} をエンジンが受けられるかを確認しましたが、上限の時間内に答えがなかったので定跡なしで検討しています。もう一度起動するか、エンジンが受ける名前（user_book1.db など）に変えて選択し直してください。`,
  bookNotLoaded: ({ file }) =>
    `エンジンが定跡 ${file} を読めなかったので、定跡なしで検討しています。ファイルが在るか・形式が合っているかを確認して選択し直してください。`,
  bookLoadUnconfirmed: ({ file }) =>
    `定跡 ${file} を読んだことをエンジンが知らせてこなかったので、使われていないかもしれません。エンジンが受ける名前（user_book1.db など）に変えて選択し直すと確実です。`,
};

/** 知らない種類（Rust にだけ足された種類）は汎用の1文にする */
function textOf(warning: StartWarning): string | null {
  if (!Object.prototype.hasOwnProperty.call(TEXTS, warning.kind)) {
    return "保存した設定の一部を送っていません。";
  }
  const text = TEXTS[warning.kind] as ((w: StartWarning) => string) | null;
  return text ? text(warning) : null;
}

/**
 * 1枚のトーストに載せる本文。**出す種類が無ければ `null`**（トーストを出さない）。
 * 先頭の数件だけ（多いと読めない。全件はログにある）
 */
export function startWarningBody(warnings: StartWarning[], shown = 3): string | null {
  const texts = warnings.map(textOf).filter((t): t is string => t !== null);
  if (texts.length === 0) return null;
  const lines = texts.slice(0, shown);
  const rest = texts.length - lines.length;
  return rest > 0 ? `${lines.join("\n")}\nほか ${rest} 件。` : lines.join("\n");
}
