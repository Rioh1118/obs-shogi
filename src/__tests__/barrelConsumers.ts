import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

/**
 * barrel が**名前で**公開している綴りに、スライスの外から呼び出し元が在るかを見る本体。
 *
 * `sliceBarrels` は逆向き——「公開したものを外から**直に**読まない」を見る。
 * こちらは「公開したのに**誰も読んでいない**」。両方が緑でも、
 * **公開面だけが広がった状態**は残る。
 *
 * 広がると `sliceBarrels` の制約がその分だけ内側へ掛かるので、
 * 公開する必要が無い物を載せると**内側で動かせる範囲だけが狭まる**。
 * `entities/file-tree` の barrel は自分で「ここに並ぶのはスライスの外に
 * 呼び出し元があるものだけ」と書いている。
 */

const LAYERS = ["entities", "features", "widgets"] as const;

/** `export { a, b as c }` / `export type { X }` の名前。`export *` は名前を持たないので見ない */
const NAMED_EXPORT = /export\s+(?:type\s+)?\{([^}]*)\}/g;

/** 公開名。`default as X` と `a as b` は公開される側（右）を採る */
function namesIn(clause: string): string[] {
  return clause
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const alias = / as (\w+)$/.exec(part);
      return alias ? alias[1] : part.replace(/^type\s+/, "");
    })
    .filter((name) => /^[A-Za-z_]\w*$/.test(name));
}

type BarrelExport = { slice: string; name: string };

/** barrel が名前で公開しているもの */
export function namedExports(): BarrelExport[] {
  const found: BarrelExport[] = [];

  for (const layer of LAYERS) {
    const layerDir = join(SRC, layer);
    for (const entry of readdirSync(layerDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      let barrel: string;
      try {
        barrel = readFileSync(join(layerDir, entry.name, "index.ts"), "utf8");
      } catch {
        continue;
      }

      for (const [, clause] of barrel.matchAll(NAMED_EXPORT)) {
        for (const name of namesIn(clause)) {
          found.push({ slice: `src/${layer}/${entry.name}`, name });
        }
      }
    }
  }

  return found;
}

/**
 * スライスの外に呼び出し元が1つも無い公開名を返す。
 *
 * **語境界で数える。** 部分一致だと `FsError` が `FsErrorView` を根拠に生き残る。
 * **スライスの中は数えない**——中から使うだけなら公開する理由が無い。
 */
type Source = { name: string; body: string };

/** リポジトリの実ファイルを読む。判定は `unconsumed` が持つ */
function repoSources(): Source[] {
  return tsFiles(SRC).map((path) => ({
    name: relative(REPO_ROOT, path),
    body: readFileSync(path, "utf8"),
  }));
}

export function unconsumed(exports: BarrelExport[], sources: Source[] = repoSources()) {
  return exports.filter(({ slice, name }) => {
    const word = new RegExp(`\\b${name}\\b`);
    return !sources.some(({ name: path, body }) => {
      if (path.startsWith(slice)) return false;
      return word.test(body);
    });
  });
}
