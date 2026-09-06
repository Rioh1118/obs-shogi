/**
 * 状態遷移表の「遷移を書いたのに誰も見ていないセル」を数える。
 *
 * 表は人の目でしか守られていない（Rust 側の `state_transition_cells.rs` は
 * `game-session.md` 決め打ちで、他の表は対象外）。目で守ると3つの形で崩れる——
 * 実在しない経路をセルに書く、✓ が実力以上に付く、✓ の無いセルが
 * 「埋まっていないセル」から漏れる。**3つ目だけは機械で落とせる。**
 *
 * ここが見るのは**1つだけ**——「遷移を書いたセルは、✓ を持つか、
 * 『埋まっていないセル』に名前が挙がっているか、どちらか」。
 * 記号の意味や遷移先の正しさは見ない（そちらは読む人の仕事）。
 */

/**
 * 遷移ではない記号。行頭の強調（`**—**`）を剥がしてから見る。
 *
 * `—`（起きるが変わらない）と `×`（起きない）はどちらもテストの要求から外す。
 * **この線引きは表の凡例と揃っていること**——凡例が `—` にも一覧への記載を
 * 求めると、機械が見ていない約束ができる。
 */
const NO_TRANSITION = /^\**(—|×)/;

export type UncoveredCell = { file: string; state: string; event: string };

/**
 * 走査の結果。`inspected` は**見たセルの数**。
 *
 * **0件の `uncovered` と、0セルしか見ていないことを区別する。** 表の書き方が変わって
 * 行を1つも拾えなくなると、この走査は緑のまま何も見なくなる。それは
 * 「守られている」ではなく「見ていない」。
 */
export type ScanResult = { inspected: number; uncovered: UncoveredCell[] };

/** 見出しは前方一致で拾う。`## 埋まっていないセル（テスト項目）` のような但し書きが付く */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(heading));
  if (start < 0) return "";

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

function rowCells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * 1列目が太字のラベルだけの行を、表の本体と見なす。
 *
 * ラベルの綴りは表ごとに違う（`B0` / `E1` / `L-idle`）ので形を決め打たない。
 * 行が状態か事象かも表ごとに違うが、この走査が見るのは
 * 「そのセルに ✓ があるか」だけなので、どちらでも同じに扱える。
 */
function tableRows(section: string): string[][] {
  return section
    .split("\n")
    .filter((l) => /^\|\s*\*\*[^*|]+\*\*\s*\|/.test(l))
    .map(rowCells);
}

/**
 * 見出し行の `E1 盤に載る` から `E1` を取る。
 *
 * **区切り行（`| --- |`）の1つ上を見出しと見なす。** 1列目が空とは限らない
 * （行ラベルの見出しを持つ表もある）ので、位置で決める。
 */
function columnLabels(section: string): string[] {
  const lines = section.split("\n");
  const separator = lines.findIndex((l) => /^\|[\s:-]*\|/.test(l) && l.includes("-"));
  if (separator < 1) return [];

  return rowCells(lines[separator - 1])
    .slice(1)
    .map((c) => c.replace(/\*/g, "").split(/\s+/)[0]);
}

/** 「埋まっていないセル」の表に挙がっている `(B2, E7)` を集める。ラベルの綴りは決め打たない */
function pendingCells(markdown: string): Set<string> {
  const section = sectionOf(markdown, "## 埋まっていないセル");
  const found = new Set<string>();

  for (const [, row, col] of section.matchAll(/`\(([^,()`]+),\s*([^,()`]+)\)`/g)) {
    found.add(`${row.trim()},${col.trim()}`);
  }

  return found;
}

/**
 * この検査を掛ける表。**全部の表は見ていない。**
 *
 * 走査そのものは表の形を選ばない（行ラベルの綴りも、行が状態か事象かも問わない）が、
 * **掛ける先は名指しで決める。** 掛けた瞬間に「全セルについて、踏んでいるか
 * 挙げてあるかのどちらか」を要求するので、まだその棚卸しをしていない表を巻き込むと、
 * 中身を確かめないまま一覧を埋める圧力になる。
 *
 * `position-search-view.md` を掛けると20セルが落ちる（測定済み）。→ #435
 */
const SCANNED = new Set(["board-orientation.md"]);

/**
 * 遷移を書いたのに ✓ も無く、「埋まっていないセル」にも載っていないセルを返す。
 *
 * `## 表` と `## 埋まっていないセル` の両方が要る（挙げる先が無いと約束を果たせない）。
 */
export function scanCells(file: string, markdown: string): ScanResult {
  if (!SCANNED.has(file)) return { inspected: 0, uncovered: [] };

  const table = sectionOf(markdown, "## 表");
  if (!table.includes("✓") || !sectionOf(markdown, "## 埋まっていないセル")) {
    return { inspected: 0, uncovered: [] };
  }

  const columns = columnLabels(table);
  const pending = pendingCells(markdown);
  const uncovered: UncoveredCell[] = [];
  let inspected = 0;

  for (const row of tableRows(table)) {
    const state = row[0].replace(/\*/g, "").trim();

    row.slice(1).forEach((cell, i) => {
      const event = columns[i];
      if (!event) return;

      inspected += 1;

      // 空欄は「まだ何も決めていない」。`—` や `×` と同じ扱いにすると、
      // 埋め忘れが黙って通る
      if (!cell) {
        uncovered.push({ file, state, event });
        return;
      }

      if (NO_TRANSITION.test(cell) || cell.includes("✓")) return;
      if (pending.has(`${state},${event}`)) return;

      uncovered.push({ file, state, event });
    });
  }

  return { inspected, uncovered };
}
