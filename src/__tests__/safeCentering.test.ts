import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, scssFiles } from "./walk";
import { codeOf } from "./sourceText";

/**
 * スクロールを受け持つ箱が、中身を `safe` なしで中央に寄せていないか。
 *
 * **素の `center` は、入りきらないぶんを上下（左右）に等分にあふれさせる。**
 * あふれた先が始端側だと、その部分は**スクロール領域に入らない**ので二度と読めない。
 * `safe` を付けると、収まらないときだけ始端寄せに落ちるので、あふれはスクロールで届く。
 *
 * 対象を「`overflow` が `auto` / `scroll` の箱」に絞るのは、**そこだけが
 * 「あふれても届く」を前提にしている**から。`hidden` の箱は元から届かないので、
 * `safe` を足しても何も変わらない。
 *
 * この規則はリポジトリに2回、理由つきで書かれている
 * （`pages/AppLayout.scss` と `shared/ui/error-fallback/ErrorFallbackBody.scss`）。
 * **散文で2回書いてある規則は、3回目に破られる。**
 *
 * **`-D` では入れない。** 入れた時点で {@link BASELINE} 件あり、
 * **そのすべてが実害とは限らない** —— 危ないのは「あふれる軸」に効いている中央寄せだけで、
 * 横に並べた行を縦に中央寄せしている `align-items: center` は、`overflow-x` の箱では
 * あふれる軸に掛かっていない。軸まで見るには flex の向きと `overflow` の軸を
 * 突き合わせる必要があり、**誤検知の抑えが本体より大きくなる**。
 * ここは増える方向にだけ落とす件数ラチェットにして、**新しく足す側に考えさせる**。
 * 1件ずつ軸を確かめて直したら基準を下げること。
 */

/** 中央寄せを指定しうるプロパティ。**`*-items` も見る**——grid の子が同じ目に遭う */
const CENTERING = [
  "align-content",
  "justify-content",
  "place-content",
  "align-items",
  "justify-items",
  "place-items",
] as const;

/** 走査が壊れて0件になったことを「違反が無い」と読ませないための下限 */
const MIN_SCANNED = 8;

/**
 * `safe` の付かない中央寄せの件数。**動かしてよい向きは下げる方だけ。**
 *
 * 増えて落ちたときは、基準ではなく足した側を直す —— あふれる軸に効いているなら
 * `safe center` に、効いていないならその宣言はそもそも要らないことが多い。
 */
const BASELINE = 3;

interface Offence {
  file: string;
  rule: string;
}

/**
 * 規則ブロックを、**外側の宣言を連れて**切り出す。
 *
 * SCSS の `&--modifier { … }` は同じ要素の別の姿なので、`overflow` を親の側に、
 * 中央寄せを修飾子の側に書く形が普通にある（この検査を入れる引き金になった
 * `PlayView.scss` がその形だった）。**同じブロックの中だけを見ると、
 * その形を1件も拾えない。**
 *
 * **連れるのは「同じ要素」の分だけ。** 修飾子（`&--x` / `&:hover` / `&.is-x`）と
 * メディアクエリは同じ箱を指すので親の `overflow` が効くが、子孫（`&__child` や
 * 素のセレクタ）は別の箱なので連れない。連れると、スクロールする箱の中に
 * 並んでいる行の `align-items: center`（あふれる軸に掛かっていない）まで数えることになる。
 */
function blocksIn(body: string): string[] {
  const blocks: string[] = [];

  /** 同じ箱を指す入れ子か。`&--x` `&:hover` `&.is-x` `@media` は同じ箱 */
  const isSameBox = (selector: string): boolean => {
    const head = selector.trim();
    return /^@(media|supports|container)\b/.test(head) || /^&(?![\w_])/.test(head);
  };

  const walk = (text: string, inherited: string) => {
    let own = "";
    let selector = "";
    let depth = 0;
    let childStart = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") {
        if (depth === 0) {
          childStart = i;
          // 直前の `;` から `{` までがセレクタ
          selector = own.slice(own.lastIndexOf(";") + 1);
          own = own.slice(0, own.lastIndexOf(";") + 1);
        }
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && childStart >= 0) {
          walk(text.slice(childStart + 1, i), isSameBox(selector) ? `${inherited}\n${own}` : "");
          childStart = -1;
        }
      } else if (depth === 0) {
        own += ch;
      }
    }

    blocks.push(`${inherited}\n${own}`);
  };

  // **コメントを先に落とす。** 残すと、入れ子の直前に書かれた説明がセレクタの
  // 一部として読まれ、`&--x` が「同じ箱」と判定されなくなる（そして親の
  // `overflow` を連れてこないので、探している形が1件も出なくなる）。
  // 落とし方は `sourceText.ts` の持ち物（検査ごとに書くと、片方だけ危ない形が残る）
  walk(codeOf(body), "");
  return blocks;
}

/**
 * `center` を指定していて `safe` を伴っていない宣言。
 *
 * **同じプロパティの出現を全部見る。** 最初の1つで打ち切ると、
 * 外側に `align-content: start` があるだけで、修飾子の側の `center` を読み飛ばす。
 */
function unsafeCentering(block: string): string | null {
  for (const property of CENTERING) {
    const found = block.matchAll(new RegExp(`(?:^|[\\s;])${property}\\s*:\\s*([^;{}]+)`, "gm"));

    for (const match of found) {
      const value = match[1];
      if (!/\bcenter\b/.test(value)) continue;
      // `safe center` / `place-content: safe center safe center` のどれも通す
      if (/\bsafe\b/.test(value)) continue;

      return `${property}: ${value.trim()}`;
    }
  }
  return null;
}

function scan(): { scrollers: number; offences: Offence[] } {
  let scrollers = 0;
  const offences: Offence[] = [];

  for (const file of scssFiles(SRC)) {
    const name = relative(REPO_ROOT, file);
    for (const block of blocksIn(readFileSync(file, "utf8"))) {
      if (!/(^|[\s;])overflow(-x|-y)?\s*:\s*(auto|scroll)/m.test(block)) continue;
      scrollers++;

      const rule = unsafeCentering(block);
      if (rule !== null) offences.push({ file: name, rule });
    }
  }

  return { scrollers, offences };
}

describe("スクロールする箱の中央寄せ", () => {
  it("走査がスクロールする箱を見つけている", () => {
    // **「違反0件」と「見たセル0件」を区別する**
    expect(scan().scrollers).toBeGreaterThan(MIN_SCANNED);
  });

  it("`safe` の付かない中央寄せが増えていない", () => {
    const { offences } = scan();
    const listed = offences.map((offence) => `${offence.file}  ${offence.rule}`);

    expect(
      offences.length,
      "スクロールを受け持つ箱が中身を `safe` なしで中央に寄せている。" +
        "あふれる軸に効いているなら、入りきらないぶんは始端側へ出て" +
        "**スクロールでは届かない**。`safe center` にすること" +
        `（理由は \`ErrorFallbackBody.scss\`）。\n${listed.join("\n")}`,
    ).toBe(BASELINE);
  });
});
