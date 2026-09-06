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

/** 表の行の記号。`—` と `×` は遷移ではないので、この検査の対象外 */
const NO_TRANSITION = /^(—|×)/;

export type UncoveredCell = { file: string; state: string; event: string };

function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
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

/** `| **B0** | … |` の形の行だけを表の本体と見なす */
function tableRows(section: string): string[][] {
  return section
    .split("\n")
    .filter((l) => /^\|\s*\*\*[A-Z]\d+\*\*\s*\|/.test(l))
    .map(rowCells);
}

/** 見出し行の `E1 盤に載る` から `E1` を取る */
function eventLabels(section: string): string[] {
  const header = section.split("\n").find((l) => /^\|\s*\|/.test(l));
  if (!header) return [];

  return rowCells(header)
    .slice(1)
    .map((c) => c.split(/\s+/)[0]);
}

/** 「埋まっていないセル」の表に挙がっている `(B2, E7)` を集める */
function pendingCells(markdown: string): Set<string> {
  const section = sectionOf(markdown, "## 埋まっていないセル");
  const found = new Set<string>();

  for (const [, state, event] of section.matchAll(/`\((B\d+),\s*(E\d+)\)`/g)) {
    found.add(`${state},${event}`);
  }

  return found;
}

/**
 * 遷移を書いたのに ✓ も無く、「埋まっていないセル」にも載っていないセルを返す。
 *
 * **`✓` を使っている表だけを見る。** `✓` は「このセルを踏むテストがある」という
 * 約束で、使っていない表はその約束をまだしていない。使い始めた時点で、
 * その表は全セルについて「踏んでいる／踏んでいないが挙げてある」を言うことになる。
 * 「埋まっていないセル」の節も要る（挙げる先が無いと約束を果たせない）。
 */
export function uncoveredCellsIn(file: string, markdown: string): UncoveredCell[] {
  const table = sectionOf(markdown, "## 表");
  if (!table.includes("✓") || !markdown.includes("## 埋まっていないセル")) return [];

  const events = eventLabels(table);
  const pending = pendingCells(markdown);
  const uncovered: UncoveredCell[] = [];

  for (const row of tableRows(table)) {
    const state = row[0].replace(/\*/g, "").trim();

    row.slice(1).forEach((cell, i) => {
      const event = events[i];
      if (!event || !cell || NO_TRANSITION.test(cell)) return;
      if (cell.includes("✓")) return;
      if (pending.has(`${state},${event}`)) return;

      uncovered.push({ file, state, event });
    });
  }

  return uncovered;
}
