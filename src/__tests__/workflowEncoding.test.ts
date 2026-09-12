import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, workflowFiles } from "./walk";

/**
 * ワークフローの中の Python が、ファイルの符号化をランナー任せにしないこと。
 *
 * `encoding=` を省くと `locale.getpreferredencoding()` が使われる。ubuntu と macOS の
 * ランナーではそれが UTF-8 なので通るが、**windows-latest では cp1252** になる。
 * このリポジトリのソースは日本語のコメントを持ち、その UTF-8 バイト列には
 * cp1252 に対応文字の無いバイト（`0x81` など）が含まれるので、
 * **Windows のジョブだけ**が `UnicodeDecodeError` で落ちる。
 *
 * 落ちるのはタグを push した後なので、気づくのは**リリースが資産ゼロで公開された後**になる。
 * `fail-fast: false` なので他の3 OS の資産は上がり、リリースは公開されたまま残る
 * （`docs/RELEASE.md` の「資産が欠けたリリースの直し方」）。
 *
 * **`.github/workflows/**` には他に検査が1つも掛かっていない**（→ #286）。
 * `verify-gate.sh` の `gate_kinds_for_path` がこの下を種類に割り当てないので、
 * ワークフローだけを触ったコミットは素通しになる。
 *
 * 見るのは**呼び出しに `encoding=` の綴りがあるか**だけ。値が正しいかまでは見ない。
 */

/** `python3 -c` / `python -c` で始まる行以降を Python として読むための目印 */
const PYTHON_STEP = /\bpython3?\s+-c\b/;

/**
 * 符号化を伴わないと既定ロケールで読み書きする呼び出し。
 *
 * `open(` は素の組み込みも `pathlib.Path.open` も同じ綴りなので、まとめて拾う。
 */
const FILE_CALL = /\b(read_text|write_text|open)\s*\(/g;

type Call = { where: string; line: number; text: string };

/**
 * ワークフローの中の Python の、ファイルを読み書きする呼び出し。
 *
 * 呼び出しは引数が長く改行を跨ぐので、**行ではなく括弧の対応で範囲を採る**。
 * 行で切ると、`encoding=` が次の行にある書き方を違反として拾う。
 */
function fileCalls(): Call[] {
  return workflowFiles().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    if (!PYTHON_STEP.test(source)) return [];

    const where = relative(REPO_ROOT, file);
    return [...source.matchAll(FILE_CALL)].map((match) => {
      const start = match.index + match[0].length;
      let depth = 1;
      let end = start;
      while (end < source.length && depth > 0) {
        if (source[end] === "(") depth += 1;
        if (source[end] === ")") depth -= 1;
        end += 1;
      }
      return {
        where,
        line: source.slice(0, match.index).split("\n").length,
        text: `${match[1]}(${source.slice(start, end - 1)}`,
      };
    });
  });
}

describe("ワークフローの Python が符号化をランナー任せにしない", () => {
  /**
   * **走査が0件を返しても緑になる形を作らない。**
   *
   * 違反0本を目指す検査なので、「見つからなかった」だけでは
   * 抽出が壊れたのか本当に無いのかが区別できない。`release.yml` の
   * 「Stamp version into tauri.conf.json and Cargo.toml」が
   * `read_text` と `write_text` を1つずつ持つので、そこに下限を張る。
   */
  it("読み書きの呼び出しを実際に拾えている", () => {
    expect(
      fileCalls().length,
      "ワークフローから Python の読み書きを1つも拾えていない",
    ).toBeGreaterThan(1);
  });

  it("ワークフローを1つ以上読めている", () => {
    expect(workflowFiles().length).toBeGreaterThan(0);
  });

  it("ファイルを読み書きする呼び出しが encoding を明示している", () => {
    const bare = fileCalls().filter((call) => !/\bencoding\s*=/.test(call.text));

    expect(
      bare.map((call) => `${call.where}:${call.line} ${call.text.replace(/\s+/g, " ")}`),
      [
        "windows-latest の既定は cp1252 で、日本語コメントを持つソースを読むと",
        "UnicodeDecodeError になる（Windows のジョブだけが落ちる）。",
        "read_text / write_text / open に encoding='utf-8' を渡すこと。",
      ].join("\n"),
    ).toEqual([]);
  });
});
