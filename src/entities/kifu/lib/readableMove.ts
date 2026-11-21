import { JKFPlayer } from "json-kifu-format";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";

/**
 * 指し手を日本語の棋譜表記にする
 *
 * 例: `"☗７六歩"` / `"☖同　角不成"` / `"☗５三銀打"` / `"☗７七銀左上"`
 *
 * 組み立てを JKFPlayer に任せるのは、相対表記・不成・曖昧な駒打ちの「打」が
 * すべて揃っているため。棋譜ストリームと検索の続き手は {@link readableCurrentMove} を
 * 通って同じ関数に行き着くので、どの一覧でも同じ手が同じ文字列になる。
 *
 * 投了・中断（`special`）も同じ関数が扱う。手も special も無い入力（手数0の要素など）は
 * 空文字を返すので、呼び出し側で代替の文言を出すこと。
 *
 * **正規化を通した手を渡すこと。** 手番（`color`）も「同」も相対表記も、手そのものではなく
 * 正規化が埋める。手で組んだ JKF を `new JKFPlayer()` に渡しただけでは何も付かず、
 * `☗５八金右` が `☖５八金` になる。`color` が無い手は例外も空文字も出さず、
 * 黙って後手の記号が付く。
 */
export function readableMove(mf: IMoveFormat): string {
  if (!mf.move && !mf.special) return "";
  const extension = !mf.move && mf.special ? EXTENSION_SPECIAL_NAMES[mf.special] : undefined;
  return extension ?? JKFPlayer.moveToReadableKifu(mf);
}

/**
 * 棋譜変換クレートが JKF に足した終局の語（不戦勝・不戦敗・封じ手・最大手数）の表記。
 *
 * JKF の標準の14語に無いので、`JKFPlayer` は記号のまま（`FUUJITE`）出す。
 * 語の出どころはクレートの `research/95-decisions.md`（D1・D28・D29）。
 */
const EXTENSION_SPECIAL_NAMES: Readonly<Record<string, string>> = {
  FUSENSHO: "不戦勝",
  FUSENPAI: "不戦敗",
  FUUJITE: "封じ手",
  MAX_MOVES: "最大手数",
};

/**
 * 再生器が今いる手を日本語にする。
 *
 * `JKFPlayer` 自身の、手の表記を返すメソッドを使わないのは、そちらが {@link readableMove} を通らず、
 * 拡張の終局の語が記号のまま出るから。手数0は `JKFPlayer` と同じく「開始局面」。
 */
export function readableCurrentMove(player: JKFPlayer): string {
  if (player.tesuu === 0) return "開始局面";
  const mf = player.currentStream[player.tesuu];
  return mf ? readableMove(mf) : "";
}

/**
 * 次の手の変化の1手目を日本語にする。
 *
 * {@link readableCurrentMove} と同じ理由で、`JKFPlayer` 自身の、手の表記を返すメソッドを使わない。
 */
export function readableNextForks(player: JKFPlayer): string[] {
  const next = player.currentStream[player.tesuu + 1];
  return (next?.forks ?? []).map((fork) => (fork[0] ? readableMove(fork[0]) : ""));
}
