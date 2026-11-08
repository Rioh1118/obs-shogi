import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

/**
 * JSX に字で書いた `id` が、`src/` の中で1つずつしか無いこと。
 *
 * 棋譜を作るモーダルは、組むタブとインポートのタブを同時にマウントして片方を `hidden` にする。
 * 2つのタブが同じ `id` を名乗ると、ラベルを押したときに隠れているタブの欄に焦点が入る。
 * モーダルが同時に描く部品はファイルを跨ぐので、ファイルの中だけを見ても衝突は分からない。
 *
 * 付け方は「部品ごとの接頭辞 + kebab」（`pos-editor-file-name`、`kifu-import-dir`）。
 * 接頭辞が揃っていれば、新しい欄を足す人が隣の部品の綴りと被らせにくい。
 *
 * 見るのは `id="..."` の字だけ。`id={...}` で組んだ値は見えない。
 */

const ID_LITERAL = /\bid="([^"]*)"/g;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function literalIds(): { file: string; id: string }[] {
  return tsFiles(SRC, { includeTests: false })
    .filter((file) => file.endsWith(".tsx"))
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(ID_LITERAL)].map((m) => ({
        file: relative(REPO_ROOT, file),
        id: m[1],
      }));
    });
}

describe("JSX の id", () => {
  const ids = literalIds();

  it("走査が空振りしていない", () => {
    expect(ids.length).toBeGreaterThan(10);
  });

  it("kebab で書く", () => {
    const bad = ids.filter(({ id }) => !KEBAB.test(id));
    expect(bad.map(({ file, id }) => `${file}: ${id}`)).toEqual([]);
  });

  it("同じ id を2か所で名乗らない", () => {
    const seen = new Map<string, string>();
    const duplicated: string[] = [];
    for (const { file, id } of ids) {
      const first = seen.get(id);
      if (first !== undefined) duplicated.push(`${id}: ${first} と ${file}`);
      else seen.set(id, file);
    }
    expect(duplicated).toEqual([]);
  });

  it("1つのファイルの中は同じ接頭辞で始める", () => {
    const prefixes = new Map<string, Set<string>>();
    for (const { file, id } of ids) {
      const prefix = id.split("-")[0];
      prefixes.set(file, (prefixes.get(file) ?? new Set()).add(prefix));
    }
    const mixed = [...prefixes]
      .filter(([, set]) => set.size > 1)
      .map(([file, set]) => `${file}: ${[...set].join(", ")}`);
    expect(mixed).toEqual([]);
  });
});
