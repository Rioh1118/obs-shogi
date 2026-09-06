import type { IndexWarnPayload } from "../api/events";

/**
 * 出す警告を選ぶ。**画面ごとに並べ直さない**——順はここ1つが持つ。
 *
 * **新しい順に出す。** reducer は末尾に積むので、先頭から読むと
 * **いちばん古い数件が永久に居座る**。起動時の解析警告が枠を埋めるだけで、
 * 後から届いた走査の失敗が一度も描かれない。
 *
 * **場所の警告を先に取る。** 新しい順に切るだけだと、1回の再走査で出る
 * ファイル単位の警告が場所の警告を枠から押し出す——押し出されるのは
 * 「ワークスペースを読めません」のような、**利用者が次にすることを含んだ
 * 唯一の文言**のほう（バッジは「更新できていません」としか言えない）。
 *
 * **消えた警告は自分では消えない。** 走査が成功しても前の失敗は積まれたまま
 * なので、利用者が「警告をクリア」を押すまで残る。いまの具合を言うのは
 * バッジ（`indexHealth`）の役目で、こちらは履歴。
 *
 * **枠数は決めない。** いくつ描けるかは画面の寸法の話なので、呼び手が渡す。
 *
 * **場所を名指しできるものを先に出す。** Rust 側は1回の走査で最大3本出し、
 * そのうち1本は「どの場所か分からない」——`path` が空で、利用者が動ける
 * 手掛かりが何も無い。素の新しい順だと**それが先頭に来て、いちばん行動に
 * 繋がる1本が枠の外に落ちる**。
 *
 * **同じ回の3本の重い順までは復元できない。** 届いた順しか手元に無く、
 * 回の切れ目を示すものが payload に無い。名指しできるかどうかで割るのが
 * いまできる最大で、`lost` と `carried` のあいだの順は保証していない。
 */
export function pickWarns(warns: IndexWarnPayload[], slots: number) {
  const newestFirst = warns.slice().reverse();
  const places = newestFirst.filter((w) => w.kind === "place");
  const files = newestFirst.filter((w) => w.kind !== "place");
  // 安定ソートなので、名指しできるもの同士の新しい順は崩れない
  const named = places.filter((w) => w.path !== "");
  const unnamed = places.filter((w) => w.path === "");
  return [...named, ...unnamed, ...files].slice(0, slots);
}
