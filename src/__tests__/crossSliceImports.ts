import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SRC, tsFiles } from "./walk";

/**
 * **同じ層の別スライスを読む import** を数える検査の本体。
 *
 * `vite.config.ts` の `no-restricted-imports` は**上位の層**しか禁じない。
 * `entities/A` → `entities/B` は下向きでも上向きでもないので1本も掛からず、
 * `import/no-cycle` も輪になるまで黙っている。つまり**増えたことに誰も気づかない**。
 *
 * 横断そのものは禁じない。`entities/game` が `entities/kifu` の型を読むような、
 * 語彙の持ち主がはっきりしている組はある。見たいのは**増えたこと**なので、
 * いまある組を控えに置いて `toEqual` で突き合わせる。
 * 増えても減っても赤くなる（減ったら控えを減らす）。
 *
 * 判定はこのモジュールだけが持つ。テスト側に同じ判定を書き写さないこと。
 */

/** 層の名前。`src/` の直下がそのまま層になる */
const LAYERS = ["pages", "widgets", "features", "entities"] as const;

/**
 * いまある同層横断の組。**許可ではなく控え。**
 *
 * ここへ足すときは、コミットのメッセージに**なぜその向きなのか**を書くこと。
 * 「型を読みたいから」は理由にならない —— 共有したい型は共有できる位置まで下げる。
 */
export const CROSS_SLICE_INVENTORY: readonly string[] = [
  "entities/analysis -> entities/engine",
  "entities/app-config -> entities/engine-presets",
  "entities/engine -> entities/file-tree",
  "entities/engine-presets -> entities/app-config",
  "entities/engine-presets -> entities/engine",
  "entities/file-tree -> entities/app-config",
  "entities/file-tree -> entities/kifu",
  "entities/game -> entities/game-session",
  "entities/game -> entities/kifu",
  "entities/game-session -> entities/engine",
  "entities/position -> entities/kifu",
  "entities/search -> entities/kifu",

  // 器（ファイル作成の対話）が中身（組む面）を描く。**この向きだけ。**
  // 逆を作ると `import/no-cycle` が落ちる。組む面は器を知らないので、
  // 面の切り替えも保存先も器から prop で降りてくる
  "features/create-file -> features/position-editor",
];

/**
 * 互いを読み合っている組。**増やさないための控え。**
 *
 * 往復は `import/no-cycle` が拾わない（**輪になるまで黙っている**）。輪でなくても、
 * 2スライスが互いを読む形は「どちらが器か」を消してしまう。
 *
 * ここに1組だけ残っているのは範囲外のため（→ `docs/IDEAS.md`）。
 * **足さないこと。** 片方の向きを消すのが直し方で、控えを伸ばすのは直し方ではない。
 */
const KNOWN_MUTUAL: readonly string[] = [
  "entities/app-config -> entities/engine-presets",
  "entities/engine-presets -> entities/app-config",
];

/** 互いを読み合っている組のうち、まだ控えに無いもの */
export function newMutualEdges(edges: ReadonlySet<string>): string[] {
  return [...edges]
    .filter((edge) => {
      const [from, to] = edge.split(" -> ");
      return edges.has(`${to} -> ${from}`);
    })
    .filter((edge) => !KNOWN_MUTUAL.includes(edge))
    .sort();
}

/**
 * ソースが名指す `@/` 始まりの指定子。
 *
 * `import ... from` だけを見ない。4つとも同じ辺を作る。
 *
 * - `export ... from` —— 再エクスポート
 * - `import(...)` —— 遅延読み込み
 * - `import "@/..."` —— 束縛を持たない読み込み（SCSS がこの形）。
 *   `from` を持たないので、`from` だけを見る走査は**黙って見逃す**
 *
 * 1つでも落とすと、綴りを変えるだけで控えを迂回できる。
 */
export function aliasSpecifiersIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/from\s*"(@\/[^"]+)"/g)) out.push(m[1]!);
  for (const m of source.matchAll(/import\(\s*"(@\/[^"]+)"/g)) out.push(m[1]!);
  for (const m of source.matchAll(/import\s+"(@\/[^"]+)"/g)) out.push(m[1]!);
  return out;
}

/** 指定子を `層/スライス` に畳む。層でもスライスでもない綴り（`@/index.scss`）は null */
export function sliceOf(specifier: string): string | null {
  const m = /^@\/([a-z-]+)\/([A-Za-z0-9_.-]+)/.exec(specifier);
  if (!m) return null;
  const [, layer, slice] = m;
  if (!(LAYERS as readonly string[]).includes(layer!)) return null;
  return `${layer}/${slice}`;
}

/**
 * 1ファイルが作る同層横断の辺。
 *
 * `self` は読んでいる側の `層/スライス`。自分自身と、別の層への import は返さない。
 */
export function crossSliceEdgesIn(source: string, self: string): string[] {
  const selfLayer = self.split("/")[0];
  return aliasSpecifiersIn(source)
    .map(sliceOf)
    .filter((target): target is string => target !== null)
    .filter((target) => target.split("/")[0] === selfLayer && target !== self)
    .map((target) => `${self} -> ${target}`);
}

type CrossSliceScan = {
  /** 組ごとの import 文の数 */
  edges: Map<string, number>;
  /** 歩いたファイルの数。0 なら走査が壊れている */
  files: number;
};

/**
 * `src/` を歩いて同層横断の辺を集める。
 *
 * **`__tests__` は外す。** テストは別スライスの作りかけを組み立てて食わせるのが仕事で、
 * そこを数えると「実装が増やした辺」と「テストが読んだ辺」が混ざる。
 * `walk.ts` の既定（含める）から外すのはこの理由。
 */
export function scanCrossSliceImports(): CrossSliceScan {
  const edges = new Map<string, number>();
  let files = 0;

  for (const layer of LAYERS) {
    const layerDir = join(SRC, layer);
    if (!existsSync(layerDir)) continue;

    for (const entry of readdirSync(layerDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const self = `${layer}/${entry.name}`;

      for (const file of tsFiles(join(layerDir, entry.name), { includeTests: false })) {
        files++;
        for (const edge of crossSliceEdgesIn(readFileSync(file, "utf8"), self)) {
          edges.set(edge, (edges.get(edge) ?? 0) + 1);
        }
      }
    }
  }

  return { edges, files };
}
