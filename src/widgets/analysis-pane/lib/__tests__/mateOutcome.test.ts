import { expect, test } from "vitest";
import type { MateOutcome } from "@/entities/mate-search";
import { mateOutcomeText } from "../mateOutcome";

const SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

test("詰みは手数と手順を、検討の読み筋と同じ表記で出す", () => {
  const text = mateOutcomeText({ kind: "mate", moves: ["7g7f", "3c3d", "2g2f"] }, SFEN);
  expect(text).toMatch(/^3手詰 ☗.*☖.*☗/);
});

test("結論は種類ごとに別の文", () => {
  const kinds: MateOutcome["kind"][] = [
    "noMate",
    "timeout",
    "cancelled",
    "notSupported",
    "unreadable",
    "startFailed",
    "engineExited",
    "stopUnanswered",
    "refused",
  ];
  const texts = kinds.map((kind) => mateOutcomeText({ kind } as MateOutcome, SFEN));
  expect(new Set(texts).size).toBe(kinds.length);
  expect(texts.every((t) => t.length > 0)).toBe(true);
});
