import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC, tsFiles } from "./walk";

/**
 * document と window では mousedown を聞かない。外の押下は pointerdown で聞く。
 *
 * ウィンドウを掴む帯（`data-tauri-drag-region`）を押すと、Tauri の drag.js
 * （tauri の `src/window/scripts/drag.js`）が document の mousedown を `stopImmediatePropagation` で止める。
 * drag.js は製品の script より先に購読するので、後から足した document の mousedown は呼ばれず、
 * 「外を押したら閉じる」が上の帯の上だけ効かなくなる。pointerdown は止めない
 */
const LISTENS_MOUSEDOWN = /\b(document|window)\s*\.\s*addEventListener\(\s*["'`]mousedown["'`]/;

describe("document の mousedown", () => {
  it("document と window で mousedown を聞く所が無い", () => {
    const offenders = tsFiles(SRC, { includeTests: false })
      .filter((file) => LISTENS_MOUSEDOWN.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));

    expect(offenders, "外の押下は pointerdown で聞くこと").toEqual([]);
  });
});
