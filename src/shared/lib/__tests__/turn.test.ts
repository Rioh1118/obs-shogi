import { describe, expect, test } from "vitest";
import { Color } from "shogi.js";
import { GOTE_GLYPH, GOTE_LABEL, SENTE_GLYPH, SENTE_LABEL, turnGlyph, turnLabel } from "../turn";

describe("turnGlyph / turnLabel", () => {
  test("先手は ☗、後手は ☖", () => {
    expect(turnGlyph(Color.Black)).toBe("☗");
    expect(turnGlyph(Color.White)).toBe("☖");
  });

  test("記号と語がずれない", () => {
    expect(turnLabel(Color.Black)).toBe("☗先手");
    expect(turnLabel(Color.White)).toBe("☖後手");
    expect(SENTE_LABEL.startsWith(SENTE_GLYPH)).toBe(true);
    expect(GOTE_LABEL.startsWith(GOTE_GLYPH)).toBe(true);
  });
});
