import { parseKifuStringToJKF } from "@/entities/kifu/api/parse";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { describeFsError, readText } from "@/entities/file-tree";

/**
 * 抱えておく棋譜の量の上限（byte）。
 *
 * **件数で決めない。** 件数で切ると、大きい棋譜ばかりを見ているときに抱える量が
 * 青天井になる。量で切れば「大きい棋譜は少ししか抱えられない」という形になる。
 * （当たり率は件数で切っても量で切っても変わらない。ここで決めているのは
 * メモリの上限だけ）
 *
 * 24MB は、120手の棋譜なら約 500 本ぶん。一覧を1本ずつ降りる使い方で、
 * 1回モーダルを開いている間に触る本数を超える見積り。
 */
export const MAX_CACHED_BYTES = 24_000_000;

/**
 * 原文1文字あたりの保持量（byte）。
 *
 * **実寸を測らない。** 測る側が持ち物に比例した仕事をすることになる。読んだ原文の
 * 長さに係数を掛けて見積もる。
 *
 * 実測で 11.9（120手・コメント無しの KIF を 516 本保持したときの heapUsed 差分。
 * `.claude/reviews/2026-09-07-447-position-search-perf-r1.md` H-3）。分岐が多い
 * 研究用やエンジン解析コメント付きはこれより大きいので、**下限寄りの値**。
 * 測り直したら `MAX_CACHED_BYTES` の「約 500 本」も一緒に見直すこと。
 */
const BYTES_PER_SOURCE_CHAR = 12;

export type LoadedKifu = { jkf: JKFData; sourceChars: number };

type Entry = {
  value: Promise<LoadedKifu>;
  /** 見積もった保持量。解決するまでは 0 */
  bytes: number;
  /** 読み終わったか。**未解決は追い出しの対象にしない**（`evict` の doc） */
  settled: boolean;
};

async function loadKifu(absPath: string): Promise<LoadedKifu> {
  const res = await readText(absPath);
  // 投げる API を `catch {}` で握り潰すと、権限も見つからないも解析失敗も
  // 同じ「続きが無い」に見える。理由を持ったまま上へ返す
  if (!res.success) throw new Error(describeFsError(res.error.code));

  // **型の口を広げない。** `readText` は `string` を返すと言い切っているので、
  // ここで `unknown` を受けて変換すると、その約束が変わったときに tsc が
  // 落ちなくなる（代わりに `"[object Object]"` が解析へ流れ、原因と無関係な
  // 文言の断りになる）
  const text = res.data;
  return { jkf: parseKifuStringToJKF(text).jkf, sourceChars: text.length };
}

/**
 * 読んだ棋譜を抱えておく置き場。
 *
 * **抱えるのは `Promise`。** 読み終わってから入れると、同じファイルへ戻る操作が
 * 先の読みの解決前に来たときに `read_file` が重なる。読み始めた時点で入れておけば
 * 1本に畳まれる。
 *
 * **寿命は持ち主が決める。** いまの持ち主は `PositionSearchContinuation` で、
 * モーダルを閉じると器ごと消える（`PositionSearchModal` は閉じているとき
 * `null` を返す）。開き直すと読み直しになるが、抱えたまま常駐させると
 * 局面検索を使わない間もメモリを占める。**据え置きの判断**であって、
 * `new` を書いた場所の副産物ではない。
 */
export class KifuCache {
  /** 挿入順が「古い順」。取り出したものは末尾へ入れ直す */
  private entries = new Map<string, Entry>();
  private bytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number = MAX_CACHED_BYTES) {
    this.maxBytes = maxBytes;
  }

  /** 待たずに済むか。読んでいる最中も真（`read_file` はもう飛んでいる） */
  has(absPath: string): boolean {
    return this.entries.has(absPath);
  }

  /**
   * その棋譜を読む。抱えていればそれを返す。
   *
   * 呼ぶ前に知っておくことが4つある。
   *
   * 1. **同じパスの飛行中の読みには、同じ `Promise` が返る。** `read_file` は
   *    重ならない
   * 2. **失敗は reject する。** 理由は `describeFsError` を通した文言を持つ
   *    `Error`。捨てるなら `catch` を付けること
   * 3. **失敗した読みは抱えない。** 次に呼べばもう一度 IPC が飛ぶ（権限が戻れば
   *    今度は読める）
   * 4. **呼ぶと他の棋譜が追い出されうる。** 上限は量（`MAX_CACHED_BYTES`）で、
   *    `has` が真だったものが次の `load` の後で偽になることがある
   */
  load(absPath: string): Promise<LoadedKifu> {
    const hit = this.entries.get(absPath);
    if (hit) {
      this.entries.delete(absPath);
      this.entries.set(absPath, hit);
      return hit.value;
    }

    const entry: Entry = { value: loadKifu(absPath), bytes: 0, settled: false };
    this.entries.set(absPath, entry);

    entry.value.then(
      (loaded) => {
        // 解決を待つあいだに追い出されていたら、量に数え直さない
        if (this.entries.get(absPath) !== entry) return;
        entry.bytes = loaded.sourceChars * BYTES_PER_SOURCE_CHAR;
        entry.settled = true;
        this.bytes += entry.bytes;
        this.evict();
      },
      () => {
        // **失敗は抱えない。** 抱えると、権限が戻ってもファイルが直っても
        // 同じ断りを返し続ける
        if (this.entries.get(absPath) === entry) this.entries.delete(absPath);
      },
    );

    return entry.value;
  }

  /**
   * 上限を超えたぶんを古い順に落とす。
   *
   * **読んでいる最中のものは飛ばす。** 量が 0 と数えられているので、落としても
   * 総量が減らない——上限を1度超えるたびに、置き場が1件になるまで削れてしまう。
   * 削られた読みは解決時に自分が居ないことに気づいて中身を捨てるので、その棋譜へ
   * 戻ると**待ち時間ごと2本目の `read_file` が飛ぶ**。in-flight を1本に畳む狙いが、
   * それが最も効く場面で消える。
   *
   * **最後の1つは残す**（1本で上限を超える棋譜がある）。
   */
  private evict() {
    if (this.bytes <= this.maxBytes) return;

    // 挿入順＝古い順。末尾は直近に使ったものなので残す
    const settled = [...this.entries].filter(([, entry]) => entry.settled);

    for (const [absPath, entry] of settled.slice(0, -1)) {
      if (this.bytes <= this.maxBytes) return;
      this.entries.delete(absPath);
      this.bytes -= entry.bytes;
    }
  }
}
