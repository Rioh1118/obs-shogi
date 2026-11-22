import { expect, test } from "vitest";
import type { MateOutcome } from "@/entities/mate-search";
import { mateOutcomeText } from "../mateOutcome";

const SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

test("詰みは手数と手順を、検討の読み筋と同じ表記で出す", () => {
  const text = mateOutcomeText({ kind: "mate", moves: ["7g7f", "3c3d", "2g2f"] }, SFEN);
  expect(text).toMatch(/^3手詰 ☗.*☖.*☗/);
});

/** 後手玉 1一、先手の金 2三・歩 1三、持駒に金 */
const ONE_MOVE = "8k/9/7GP/9/9/9/9/9/K8 b G 1";

test("通常のエンジンの勝ちは、手順がそろい王手の連続なら N手詰", () => {
  const text = mateOutcomeText({ kind: "winFound", plies: 1, moves: ["G*1b"] }, ONE_MOVE);
  expect(text).toMatch(/^1手詰 ☗１二金/);
});

test.each<[string, number, string[]]>([
  ["王手の連続でない", 1, ["9i8i"]],
  ["手順が手数に足りない", 3, ["G*1b"]],
  ["手順が無い", 5, []],
])("%s なら、詰みと言い切らない", (_, plies, moves) => {
  const text = mateOutcomeText({ kind: "winFound", plies, moves }, ONE_MOVE);
  expect(text).toContain(`${plies}手で勝ちを読み切りました`);
  expect(text).not.toContain("手詰");
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
