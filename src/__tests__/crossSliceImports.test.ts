import { describe, expect, test } from "vitest";
import {
  CROSS_SLICE_INVENTORY,
  aliasSpecifiersIn,
  crossSliceEdgesIn,
  newMutualEdges,
  scanCrossSliceImports,
  sliceOf,
} from "./crossSliceImports";

/**
 * 別名の頭を組み立てて使う。
 *
 * 例の import 文を素の文字列で書くと、`testsLayerBoundary` と `sliceBarrels` が
 * **このファイル自身をレイヤ違反として拾う**（どちらも引用符の直後の `@/レイヤ` を
 * 文字列として探す）。ここが例として書いているだけであることは、あちらの走査からは
 * 見分けられない。引用符と `@` を隣り合わせないことで、例を例のまま置ける。
 */
const AT = "@" + "/";

describe("同層横断の import", () => {
  test("控えと現物が一致している", () => {
    const { edges } = scanCrossSliceImports();
    const found = [...edges.keys()].sort();

    expect(
      found,
      [
        "同じ層の別スライスを読む組が控えと違う:",
        `  控え: ${CROSS_SLICE_INVENTORY.length} 組`,
        `  現物: ${found.length} 組`,
        `  増えた: ${found.filter((e) => !CROSS_SLICE_INVENTORY.includes(e)).join(" / ") || "無し"}`,
        `  減った: ${CROSS_SLICE_INVENTORY.filter((e) => !found.includes(e)).join(" / ") || "無し"}`,
        "",
        "増やすなら、なぜその向きなのかをコミットに書くこと。",
        "共有したい型やロジックは、共有できる位置まで下げるのが先。",
      ].join("\n"),
    ).toEqual([...CROSS_SLICE_INVENTORY].sort());
  });

  // 走査が壊れて0件を返しても控えが空なら緑になる。「見つけた件数が0」と
  // 「見たファイルが0」を区別する
  test("走査が実際にファイルを歩いている", () => {
    const { edges, files } = scanCrossSliceImports();
    expect(files).toBeGreaterThan(200);
    expect([...edges.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(30);
  });

  test("互いを読み合う組が新しく増えていない", () => {
    // 往復は `import/no-cycle` が拾わない（**輪になるまで黙っている**）。
    // 輪でなくても「どちらが器か」が消える
    const { edges } = scanCrossSliceImports();
    expect(
      newMutualEdges(new Set(edges.keys())),
      "互いを読み合う組が増えた。片方の向きを消すこと（控えを伸ばすのは直し方ではない）",
    ).toEqual([]);
  });

  test("widgets には1組も無い", () => {
    // 層をまたがない共有は、部品が大きい widgets でいちばん起きやすい
    const { edges } = scanCrossSliceImports();
    expect([...edges.keys()].filter((e) => e.startsWith("widgets/"))).toEqual([]);
  });
});

describe("newMutualEdges", () => {
  test("片方向だけなら何も返さない", () => {
    expect(newMutualEdges(new Set(["features/a -> features/b"]))).toEqual([]);
  });

  test("互いを読み合っていれば両方返す", () => {
    expect(
      newMutualEdges(new Set(["features/a -> features/b", "features/b -> features/a"])),
    ).toEqual(["features/a -> features/b", "features/b -> features/a"]);
  });

  test("控えにある組は返さない", () => {
    const known = new Set([
      "entities/app-config -> entities/engine-presets",
      "entities/engine-presets -> entities/app-config",
    ]);
    expect(newMutualEdges(known)).toEqual([]);
  });
});

describe("aliasSpecifiersIn", () => {
  test("import / export / 動的 import / 束縛の無い import の4つとも拾う", () => {
    const source = [
      `import { a } from "${AT}entities/kifu/model/jkf";`,
      `import type { B } from "${AT}entities/game/model/types";`,
      `export { c } from "${AT}shared/lib/x";`,
      `const d = await import("${AT}features/settings/ui/X");`,
      `import "${AT}entities/position/ui/Piece.scss";`,
    ].join("\n");

    expect(aliasSpecifiersIn(source)).toEqual([
      `${AT}entities/kifu/model/jkf`,
      `${AT}entities/game/model/types`,
      `${AT}shared/lib/x`,
      `${AT}features/settings/ui/X`,
      `${AT}entities/position/ui/Piece.scss`,
    ]);
  });

  test("束縛の無い import は `from` を持たないので、別に拾う必要がある", () => {
    // これを落とすと、束縛を持たない読み込みで控えを迂回できる
    expect(aliasSpecifiersIn(`import "${AT}features/settings/ui/kit/SSelect";`)).toEqual([
      `${AT}features/settings/ui/kit/SSelect`,
    ]);
  });

  test("相対 import は拾わない", () => {
    expect(aliasSpecifiersIn('import { a } from "./sibling";')).toEqual([]);
  });
});

describe("sliceOf", () => {
  test("層とスライスに畳む", () => {
    expect(sliceOf(`${AT}entities/kifu/model/jkf`)).toBe("entities/kifu");
    expect(sliceOf(`${AT}features/settings/ui/X`)).toBe("features/settings");
  });

  test("層でない綴りは null", () => {
    // 別名の直下がスタイルシートの場合と、層の一覧に無い `shared` の場合
    expect(sliceOf(`${AT}index.scss`)).toBeNull();
    expect(sliceOf(`${AT}shared/lib/x`)).toBeNull();
  });
});

describe("crossSliceEdgesIn", () => {
  const source = [
    `import a from "${AT}entities/kifu/model/jkf";`,
    `import b from "${AT}entities/position/lib/x";`,
    `import c from "${AT}shared/ui/Modal";`,
    `import d from "${AT}features/settings/ui/X";`,
  ].join("\n");

  test("同じ層の別スライスだけを返す", () => {
    expect(crossSliceEdgesIn(source, "entities/position")).toEqual([
      "entities/position -> entities/kifu",
    ]);
  });

  test("自分自身への import は返さない", () => {
    expect(crossSliceEdgesIn(`import a from "${AT}entities/kifu/lib/x";`, "entities/kifu")).toEqual(
      [],
    );
  });

  test("下の層への import は返さない", () => {
    expect(
      crossSliceEdgesIn(`import a from "${AT}entities/kifu/lib/x";`, "features/create-file"),
    ).toEqual([]);
  });
});
