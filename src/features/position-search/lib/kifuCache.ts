import { parseKifuStringToJKF } from "@/entities/kifu/api/parse";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { describeFsError, readText } from "@/entities/file-tree";

/**
 * 抱えておく棋譜の量の上限（原文の文字数）。
 *
 * **件数で決めない。** 局面検索のヒットは1ファイル1件になりやすい——同じ棋譜に
 * 同じ局面が2度出るのは千日手か合流のときだけ——ので、件数で切ると
 * 一覧を矢印で降りたときに**ほぼ全打鍵が外れる**。
 *
 * 数えるのは読んだ原文の長さで、抱えている JKF の実寸ではない。実寸を測ると
 * 測る側が持ち物に比例した仕事をすることになる。**多めに見積もる向きの
 * 誤差ではない**（JKF は原文より大きい）ので、上限は控えめに置く。
 */
export const MAX_CACHED_CHARS = 2_000_000;

export type LoadedKifu = { jkf: JKFData; sourceChars: number };

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  return String(content ?? "");
}

async function loadKifu(absPath: string): Promise<LoadedKifu> {
  const res = await readText(absPath);
  // 投げる API を `catch {}` で握り潰すと、権限も見つからないも解析失敗も
  // 同じ「続きが無い」に見える。理由を持ったまま上へ返す
  if (!res.success) throw new Error(describeFsError(res.error.code));

  const text = toText(res.data);
  return { jkf: parseKifuStringToJKF(text).jkf as JKFData, sourceChars: text.length };
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
  private entries = new Map<string, { value: Promise<LoadedKifu>; chars: number }>();
  private chars = 0;
  private readonly maxChars: number;

  constructor(maxChars: number = MAX_CACHED_CHARS) {
    this.maxChars = maxChars;
  }

  /** 待たずに済むか。読んでいる最中も真（`read_file` はもう飛んでいる） */
  has(absPath: string): boolean {
    return this.entries.has(absPath);
  }

  load(absPath: string): Promise<LoadedKifu> {
    const hit = this.entries.get(absPath);
    if (hit) {
      this.entries.delete(absPath);
      this.entries.set(absPath, hit);
      return hit.value;
    }

    const entry = { value: loadKifu(absPath), chars: 0 };
    this.entries.set(absPath, entry);

    entry.value.then(
      (loaded) => {
        // 解決を待つあいだに追い出されていたら、量に数え直さない
        if (this.entries.get(absPath) !== entry) return;
        entry.chars = loaded.sourceChars;
        this.chars += loaded.sourceChars;
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

  /** 上限を超えたぶんを古い順に落とす。**最後の1つは残す**（1本で超える棋譜がある） */
  private evict() {
    while (this.chars > this.maxChars && this.entries.size > 1) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;

      const entry = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (entry) this.chars -= entry.chars;
    }
  }
}
