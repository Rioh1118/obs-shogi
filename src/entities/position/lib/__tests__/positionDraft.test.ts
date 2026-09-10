import { describe, expect, test } from "vitest";
import { Color } from "shogi.js";
import {
  HAND_KINDS,
  canDropOn,
  canSendToHand,
  cycleFrom,
  dropFromHand,
  emptyHand,
  flipColor,
  handCount,
  isCheckOn,
  isHandKind,
  moveBetweenHands,
  movePieceOnBoard,
  sendToHand,
  pieceAt,
  promotedKind,
  serializeDraft,
  setTurn,
  stateFromPreset,
  stateFromSfen,
  stateToSfen,
  unpromotedKind,
  type CycleStep,
  type HandKind,
  type Square,
} from "../positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";

const HIRATE_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const sq = (x: number, y: number): Square => ({ x, y });

function emptyBoardState(): JKFState {
  return {
    color: Color.Black,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({}))),
    hands: [emptyHand(), emptyHand()],
  };
}

function countPieces(state: JKFState): number {
  let n = 0;
  for (let x = 1; x <= 9; x++) {
    for (let y = 1; y <= 9; y++) {
      if (pieceAt(state, sq(x, y))) n++;
    }
  }
  return n;
}

function totalInHands(state: JKFState): number {
  return [0, 1].reduce(
    (n, color) => n + HAND_KINDS.reduce((m, kind) => m + handCount(state, color as Color, kind), 0),
    0,
  );
}

describe("stateFromPreset", () => {
  test("平手は40枚が盤に並び、駒台は空", () => {
    const state = stateFromPreset("HIRATE");
    expect(countPieces(state)).toBe(40);
    expect(totalInHands(state)).toBe(0);
    expect(state.color).toBe(Color.Black);
  });

  test("駒落ちは落とした分だけ盤から減り、駒台には積まれない", () => {
    // 二枚落ちは上手（後手）の飛と角が消える。駒台に移るのではなく盤から消える
    const state = stateFromPreset("2");
    expect(countPieces(state)).toBe(38);
    expect(totalInHands(state)).toBe(0);
    expect(pieceAt(state, sq(2, 2))).toBeNull();
    expect(pieceAt(state, sq(8, 2))).toBeNull();
  });

  test("駒落ちの手番は上手（後手）から", () => {
    expect(stateFromPreset("2").color).toBe(Color.White);
  });
});

describe("stateFromSfen", () => {
  /** 読めた前提で使う。読めなければテストをその場で落とす */
  const read = (sfen: string): JKFState => {
    const state = stateFromSfen(sfen);
    if (!state) throw new Error(`読めるはずの SFEN が null になった: ${sfen}`);
    return state;
  };

  test("平手の SFEN から平手が戻る", () => {
    expect(serializeDraft(read(HIRATE_SFEN))).toBe(serializeDraft(stateFromPreset("HIRATE")));
  });

  test("持ち駒つきの SFEN を読める", () => {
    const state = read("4k4/9/9/9/9/9/9/9/4K4 w 2G3p 1");
    expect(handCount(state, Color.Black, "KI")).toBe(2);
    expect(handCount(state, Color.White, "FU")).toBe(3);
    expect(state.color).toBe(Color.White);
  });

  test("成駒を含む SFEN を読める", () => {
    const state = read("9/9/9/9/4+P4/9/9/9/9 b - 1");
    expect(pieceAt(state, sq(5, 5))).toEqual({ kind: "TO", color: Color.Black });
  });

  test("空盤の SFEN は読める（規則に反する配置は断りが受け持つ）", () => {
    expect(read("9/9/9/9/9/9/9/9/9 b - 1")).not.toBeNull();
  });

  // **1件の代表例では守れない。** `shogi.js` が明示的に投げるのは手番の欄が
  // `b` / `w` でないときの1本だけで、段数も筋数も駒の綴りも見ない。
  // 表にして、throw ではなく `null` で返ることを固定する
  test.each([
    ["日本語の文", "これは SFEN ではない"],
    ["段が9つない", "lnsgkgsnl/9/9 b - 1"],
    ["段が多い", "9/9/9/9/9/9/9/9/9/9 b - 1"],
    ["1段の升が9つない", "lnsgkgsnlpp/9/9/9/9/9/9/9/9 b - 1"],
    ["1段の升が足りない", "8/9/9/9/9/9/9/9/9 b - 1"],
    ["知らない駒の綴り", "x8/9/9/9/9/9/9/9/9 b - 1"],
    ["成れない駒に成りの印", "+g8/9/9/9/9/9/9/9/9 b - 1"],
    ["手番の欄が無い", "9/9/9/9/9/9/9/9/9"],
    ["持ち駒の欄が無い", "9/9/9/9/9/9/9/9/9 b"],
    ["手番の綴りが違う", "9/9/9/9/9/9/9/9/9 x - 1"],
    ["持ち駒に玉", "9/9/9/9/9/9/9/9/9 b K 1"],
    ["持ち駒の綴りが壊れている", "9/9/9/9/9/9/9/9/9 b Px 1"],
    ["持ち駒が0枚", "9/9/9/9/9/9/9/9/9 b 0P 1"],
    ["持ち駒が将棋一式より多い", "9/9/9/9/9/9/9/9/9 b 19P 1"],
    ["盤と駒台を合わせて多すぎる", "PPPPPPPPP/PPPPPPPPP/9/9/9/9/9/9/9 b 2P 1"],
  ])("%s は null を返す", (_name, sfen) => {
    expect(stateFromSfen(sfen)).toBeNull();
  });

  test("持ち駒を数えきれない大きさでも返ってくる", () => {
    // shogi.js は枚数を素直に読んでその回数だけ駒を作る。渡す前に止めないと返らない
    expect(stateFromSfen("9/9/9/9/9/9/9/9/9 b 250000P 1")).toBeNull();
    expect(stateFromSfen("9/9/9/9/9/9/9/9/9 b 999999999P 1")).toBeNull();
  });
});

describe("stateToSfen", () => {
  test("平手は既知の SFEN と一致する", () => {
    expect(stateToSfen(stateFromPreset("HIRATE"))).toBe(HIRATE_SFEN);
  });

  test("手番と持ち駒が SFEN に乗る", () => {
    let state = stateFromPreset("HIRATE");
    state = sendToHand(state, sq(7, 7), Color.White);
    state = setTurn(state, Color.White);
    expect(stateToSfen(state)).toBe(
      "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PP1PPPPPP/1B5R1/LNSGKGSNL w p 1",
    );
  });

  test("盤にも駒台にも駒が無くても SFEN が出る", () => {
    expect(stateToSfen(emptyBoardState())).toBe("9/9/9/9/9/9/9/9/9 b - 1");
  });
});

describe("movePieceOnBoard", () => {
  test("空きへ動かしても盤の枚数が変わらない", () => {
    const before = stateFromPreset("HIRATE");
    const after = movePieceOnBoard(before, sq(7, 7), sq(7, 6));
    expect(countPieces(after)).toBe(countPieces(before));
    expect(pieceAt(after, sq(7, 7))).toBeNull();
    expect(pieceAt(after, sq(7, 6))).toEqual({ kind: "FU", color: Color.Black });
  });

  test("重ねた駒は動かした側の駒台に入る", () => {
    // shogi.js の `capture` は取られた駒を「反対側」の駒台へ入れる。逆を採る
    let state = stateFromPreset("HIRATE");
    state = movePieceOnBoard(state, sq(8, 8), sq(2, 2)); // 先手の角が後手の角を取る
    expect(handCount(state, Color.Black, "KA")).toBe(1);
    expect(handCount(state, Color.White, "KA")).toBe(0);
  });

  test("自分の駒に自分の駒を重ねても、動かした側の駒台に入る", () => {
    let state = stateFromPreset("HIRATE");
    state = movePieceOnBoard(state, sq(2, 8), sq(2, 7)); // 先手の飛を先手の歩に重ねる
    expect(handCount(state, Color.Black, "FU")).toBe(1);
    expect(handCount(state, Color.White, "FU")).toBe(0);
    expect(pieceAt(state, sq(2, 7))).toEqual({ kind: "HI", color: Color.Black });
  });

  test("成駒を重ねると不成に戻って駒台に入る", () => {
    let state = emptyBoardState();
    state.board[4][4] = { kind: "TO", color: Color.White }; // 5五 と金
    state.board[4][5] = { kind: "GI", color: Color.Black }; // 5六 銀
    state = movePieceOnBoard(state, sq(5, 6), sq(5, 5));
    expect(handCount(state, Color.Black, "FU")).toBe(1);
    expect(handCount(state, Color.Black, "GI")).toBe(0);
  });

  test("玉に重ねると入れ替わる。駒台には入らない", () => {
    let state = emptyBoardState();
    state.board[4][0] = { kind: "OU", color: Color.White }; // 5一 玉
    state.board[4][8] = { kind: "HI", color: Color.Black }; // 5九 飛
    state = movePieceOnBoard(state, sq(5, 9), sq(5, 1));
    expect(pieceAt(state, sq(5, 1))).toEqual({ kind: "HI", color: Color.Black });
    expect(pieceAt(state, sq(5, 9))).toEqual({ kind: "OU", color: Color.White });
    expect(totalInHands(state)).toBe(0);
  });

  test("玉どうしも入れ替わる", () => {
    let state = emptyBoardState();
    state.board[4][0] = { kind: "OU", color: Color.White };
    state.board[4][8] = { kind: "OU", color: Color.Black };
    state = movePieceOnBoard(state, sq(5, 9), sq(5, 1));
    expect(pieceAt(state, sq(5, 1))).toEqual({ kind: "OU", color: Color.Black });
    expect(pieceAt(state, sq(5, 9))).toEqual({ kind: "OU", color: Color.White });
  });

  test("駒のない升からは動かせない", () => {
    expect(() => movePieceOnBoard(stateFromPreset("HIRATE"), sq(5, 5), sq(5, 4))).toThrow();
  });

  test("同じ升へは動かせない", () => {
    expect(() => movePieceOnBoard(stateFromPreset("HIRATE"), sq(7, 7), sq(7, 7))).toThrow();
  });

  test("盤の外は受け付けない", () => {
    expect(() => movePieceOnBoard(stateFromPreset("HIRATE"), sq(7, 7), sq(10, 7))).toThrow();
    expect(() => movePieceOnBoard(stateFromPreset("HIRATE"), sq(0, 7), sq(7, 6))).toThrow();
  });

  test("渡した state を書き換えない", () => {
    const before = stateFromPreset("HIRATE");
    const snapshot = serializeDraft(before);
    movePieceOnBoard(before, sq(8, 8), sq(2, 2));
    expect(serializeDraft(before)).toBe(snapshot);
  });
});

describe("sendToHand", () => {
  test("成駒は不成に戻って駒台に入る", () => {
    let state = emptyBoardState();
    state.board[4][4] = { kind: "RY", color: Color.Black };
    state = sendToHand(state, sq(5, 5), Color.Black);
    expect(handCount(state, Color.Black, "HI")).toBe(1);
    expect(pieceAt(state, sq(5, 5))).toBeNull();
  });

  test("相手の駒台へも送れる", () => {
    let state = stateFromPreset("HIRATE");
    state = sendToHand(state, sq(7, 7), Color.White);
    expect(handCount(state, Color.White, "FU")).toBe(1);
    expect(handCount(state, Color.Black, "FU")).toBe(0);
  });

  test("玉は受け付けない", () => {
    const state = stateFromPreset("HIRATE");
    expect(() => sendToHand(state, sq(5, 9), Color.Black)).toThrow();
  });

  test("駒のない升は受け付けない", () => {
    expect(() => sendToHand(stateFromPreset("HIRATE"), sq(5, 5), Color.Black)).toThrow();
  });

  test("渡した state を書き換えない", () => {
    const before = stateFromPreset("HIRATE");
    const snapshot = serializeDraft(before);
    sendToHand(before, sq(7, 7), Color.Black);
    expect(serializeDraft(before)).toBe(snapshot);
  });
});

describe("dropFromHand", () => {
  test("行き所のない升にも置ける", () => {
    // shogi.js の `drop` は二歩と行き所のない駒を throw で弾く。ここは通す
    let state = emptyBoardState();
    state.hands[Color.Black].FU = 1;
    state = dropFromHand(state, "FU", Color.Black, sq(5, 1));
    expect(pieceAt(state, sq(5, 1))).toEqual({ kind: "FU", color: Color.Black });
    expect(handCount(state, Color.Black, "FU")).toBe(0);
  });

  test("二歩になる升にも置ける", () => {
    let state = emptyBoardState();
    state.board[4][5] = { kind: "FU", color: Color.Black };
    state.hands[Color.Black].FU = 1;
    state = dropFromHand(state, "FU", Color.Black, sq(5, 4));
    expect(pieceAt(state, sq(5, 4))).toEqual({ kind: "FU", color: Color.Black });
  });

  test("駒台に無い駒は置けない", () => {
    expect(() => dropFromHand(emptyBoardState(), "FU", Color.Black, sq(5, 5))).toThrow();
  });

  test("駒のある升へは置けない", () => {
    const state = stateFromPreset("HIRATE");
    const withHand: JKFState = { ...state, hands: [{ ...state.hands[0], FU: 1 }, state.hands[1]] };
    expect(() => dropFromHand(withHand, "FU", Color.Black, sq(7, 7))).toThrow();
  });

  test("渡した state を書き換えない", () => {
    const before = emptyBoardState();
    before.hands[Color.Black].FU = 1;
    const snapshot = serializeDraft(before);
    dropFromHand(before, "FU", Color.Black, sq(5, 5));
    expect(serializeDraft(before)).toBe(snapshot);
  });
});

describe("moveBetweenHands", () => {
  test("反対側の駒台へ移る", () => {
    let state = emptyBoardState();
    state.hands[Color.Black].KI = 2;
    state = moveBetweenHands(state, "KI", Color.Black, Color.White);
    expect(handCount(state, Color.Black, "KI")).toBe(1);
    expect(handCount(state, Color.White, "KI")).toBe(1);
  });

  test("同じ駒台へは移せない", () => {
    const state = emptyBoardState();
    state.hands[Color.Black].KI = 1;
    expect(() => moveBetweenHands(state, "KI", Color.Black, Color.Black)).toThrow();
  });

  test("駒台に無い駒は移せない", () => {
    expect(() => moveBetweenHands(emptyBoardState(), "KI", Color.Black, Color.White)).toThrow();
  });

  test("渡した state を書き換えない", () => {
    const before = emptyBoardState();
    before.hands[Color.Black].KI = 1;
    const snapshot = serializeDraft(before);
    moveBetweenHands(before, "KI", Color.Black, Color.White);
    expect(serializeDraft(before)).toBe(snapshot);
  });
});

describe("cycleFrom", () => {
  test("成れる駒は4回で元に戻る", () => {
    let step = cycleFrom("FU", Color.Black);
    expect(step).toEqual({ kind: "TO", color: Color.Black, cyc: 1 });
    step = cycleFrom(step.kind, step.color, step);
    expect(step).toEqual({ kind: "TO", color: Color.White, cyc: 2 });
    step = cycleFrom(step.kind, step.color, step);
    expect(step).toEqual({ kind: "FU", color: Color.White, cyc: 3 });
    step = cycleFrom(step.kind, step.color, step);
    expect(step).toEqual({ kind: "FU", color: Color.Black, cyc: 0 });
  });

  test("後手の駒から始めても対称", () => {
    let step = cycleFrom("HI", Color.White);
    expect(step).toEqual({ kind: "RY", color: Color.White, cyc: 1 });
    step = cycleFrom(step.kind, step.color, step);
    expect(step).toEqual({ kind: "RY", color: Color.Black, cyc: 2 });
    step = cycleFrom(step.kind, step.color, step);
    expect(step).toEqual({ kind: "HI", color: Color.Black, cyc: 3 });
    step = cycleFrom(step.kind, step.color, step);
    expect(step).toEqual({ kind: "HI", color: Color.White, cyc: 0 });
  });

  test("玉と金は2回で元に戻る", () => {
    for (const kind of ["OU", "KI"] as const) {
      const first = cycleFrom(kind, Color.Black);
      expect(first).toEqual({ kind, color: Color.White, cyc: 1 });
      const second = cycleFrom(first.kind, first.color, first);
      expect(second).toEqual({ kind, color: Color.Black, cyc: 0 });
    }
  });

  test("巡目が分からない成駒は、もとの持ち主の成として始める", () => {
    // 種に最初から載っている成駒。次に来るのは「相手の成」
    expect(cycleFrom("TO", Color.Black)).toEqual({
      kind: "TO",
      color: Color.White,
      cyc: 2,
    });
  });

  test("巡目が分からない不成は、1巡目の頭から始める", () => {
    expect(cycleFrom("GI", Color.Black)).toEqual({
      kind: "NG",
      color: Color.Black,
      cyc: 1,
    });
  });

  test("覚えている駒が升の駒と違えば、巡目を引き継がない", () => {
    // 歩を2回裏返して（後手と金・巡目2）、その升に別の先手歩を重ねた場合。
    // 引き継ぐと `{FU, 先手}` が返り、押しても同じ駒がそのまま返る
    const stale: CycleStep = { kind: "TO", color: Color.White, cyc: 2 };
    expect(cycleFrom("FU", Color.Black, stale)).toEqual({
      kind: "TO",
      color: Color.Black,
      cyc: 1,
    });
  });

  test("色だけ違っても引き継がない", () => {
    const stale: CycleStep = { kind: "FU", color: Color.White, cyc: 3 };
    expect(cycleFrom("FU", Color.Black, stale)).toEqual({
      kind: "TO",
      color: Color.Black,
      cyc: 1,
    });
  });

  test("覚えている駒が一致していれば引き継ぐ", () => {
    const step: CycleStep = { kind: "TO", color: Color.Black, cyc: 1 };
    expect(cycleFrom("TO", Color.Black, step)).toEqual({
      kind: "TO",
      color: Color.White,
      cyc: 2,
    });
  });

  test("整数でない巡目は受け付けない", () => {
    // 畳む式は負値しか畳めない。残ると kind も color も持たない値が返る
    for (const cyc of [1.5, NaN, Infinity]) {
      expect(() => cycleFrom("FU", Color.Black, { kind: "FU", color: Color.Black, cyc })).toThrow();
    }
  });

  test("負の巡目は畳んで受け付ける", () => {
    expect(cycleFrom("FU", Color.Black, { kind: "FU", color: Color.Black, cyc: -1 })).toEqual({
      kind: "FU",
      color: Color.White,
      cyc: 0,
    });
  });

  test("4巡すると必ず出発点に戻る", () => {
    for (const kind of ["FU", "KY", "KE", "GI", "KI", "KA", "HI", "OU"] as const) {
      for (const color of [Color.Black, Color.White]) {
        let step: CycleStep = { kind, color, cyc: 0 };
        for (let i = 0; i < 4; i++) step = cycleFrom(step.kind, step.color, step);
        expect({ kind: step.kind, color: step.color, cyc: step.cyc }).toEqual({
          kind,
          color,
          cyc: 0,
        });
      }
    }
  });
});

describe("isCheckOn", () => {
  test("利きが通っていれば true", () => {
    const state = emptyBoardState();
    state.board[0][8] = { kind: "OU", color: Color.White }; // 9九 玉
    state.board[0][0] = { kind: "HI", color: Color.Black }; // 9一 飛
    expect(isCheckOn(state, Color.White)).toBe(true);
  });

  test("遮る駒があれば false", () => {
    const state = emptyBoardState();
    state.board[0][8] = { kind: "OU", color: Color.White };
    state.board[0][0] = { kind: "HI", color: Color.Black };
    state.board[0][4] = { kind: "FU", color: Color.Black };
    expect(isCheckOn(state, Color.White)).toBe(false);
  });

  test("玉が無ければ false。詰将棋の形を例外にしない", () => {
    const state = emptyBoardState();
    state.board[0][0] = { kind: "HI", color: Color.Black };
    expect(isCheckOn(state, Color.White)).toBe(false);
  });

  test("手番を見ない", () => {
    // 組みかけの局面は手番が定まらないうちに検査したい
    const state = emptyBoardState();
    state.board[0][8] = { kind: "OU", color: Color.White };
    state.board[0][0] = { kind: "HI", color: Color.Black };
    expect(isCheckOn(state, Color.White)).toBe(true);
    expect(isCheckOn(setTurn(state, Color.White), Color.White)).toBe(true);
  });
});

describe("setTurn", () => {
  test("手番だけが変わる", () => {
    const before = stateFromPreset("HIRATE");
    const after = setTurn(before, Color.White);
    expect(after.color).toBe(Color.White);
    expect(before.color).toBe(Color.Black);
    expect(countPieces(after)).toBe(countPieces(before));
  });
});

describe("serializeDraft", () => {
  test("手番が違えば別の値になる", () => {
    const state = stateFromPreset("HIRATE");
    expect(serializeDraft(state)).not.toBe(serializeDraft(setTurn(state, Color.White)));
  });

  test("盤が違えば別の値になる", () => {
    const state = stateFromPreset("HIRATE");
    expect(serializeDraft(state)).not.toBe(
      serializeDraft(movePieceOnBoard(state, sq(7, 7), sq(7, 6))),
    );
  });

  test("駒台が違えば別の値になる", () => {
    const state = emptyBoardState();
    const withHand = {
      ...state,
      hands: [{ ...state.hands[0], FU: 1 }, state.hands[1]],
    } as JKFState;
    expect(serializeDraft(state)).not.toBe(serializeDraft(withHand));
  });

  test("同じ持ち駒がどちらの駒台にあるかを区別する", () => {
    const base = emptyBoardState();
    const black = { ...base, hands: [{ ...base.hands[0], FU: 1 }, base.hands[1]] } as JKFState;
    const white = { ...base, hands: [base.hands[0], { ...base.hands[1], FU: 1 }] } as JKFState;
    expect(serializeDraft(black)).not.toBe(serializeDraft(white));
  });

  test("同じ局面なら同じ値になる", () => {
    expect(serializeDraft(stateFromPreset("HIRATE"))).toBe(
      serializeDraft(stateFromPreset("HIRATE")),
    );
  });
});

describe("pieceAt", () => {
  test("空升は null", () => {
    expect(pieceAt(stateFromPreset("HIRATE"), sq(5, 5))).toBeNull();
  });

  test("盤の外は throw する", () => {
    // 黙って null を返すと、盤の外を押しても何も起きない経路が生まれる
    expect(() => pieceAt(stateFromPreset("HIRATE"), sq(0, 1))).toThrow();
    expect(() => pieceAt(stateFromPreset("HIRATE"), sq(1, 10))).toThrow();
  });
});

describe("handCount", () => {
  test("欄の無い持ち駒は0として数える", () => {
    const state = { ...emptyBoardState(), hands: [{}, {}] } as unknown as JKFState;
    expect(handCount(state, Color.Black, "FU")).toBe(0);
  });
});

describe("canDropOn", () => {
  test("空升には置ける", () => {
    expect(canDropOn(stateFromPreset("HIRATE"), sq(5, 5))).toBe(true);
  });

  test("駒のある升には置けない", () => {
    expect(canDropOn(stateFromPreset("HIRATE"), sq(7, 7))).toBe(false);
  });
});

describe("canSendToHand", () => {
  test("玉だけが送れない", () => {
    expect(canSendToHand({ kind: "OU", color: Color.Black })).toBe(false);
    expect(canSendToHand({ kind: "RY", color: Color.Black })).toBe(true);
  });
});

describe("unpromotedKind", () => {
  test("成駒はもとの姿に戻る", () => {
    expect(unpromotedKind("TO")).toBe("FU");
    expect(unpromotedKind("RY")).toBe("HI");
  });

  test("成っていない駒はそのまま", () => {
    expect(unpromotedKind("KI")).toBe("KI");
    expect(unpromotedKind("OU")).toBe("OU");
  });
});

describe("promotedKind", () => {
  test("成れない駒は null", () => {
    expect(promotedKind("KI")).toBeNull();
    expect(promotedKind("OU")).toBeNull();
    expect(promotedKind("TO")).toBeNull();
  });

  test("成れる駒は成った姿を返す", () => {
    expect(promotedKind("GI")).toBe("NG");
  });
});

describe("isHandKind", () => {
  test("駒台に載る7種だけを通す", () => {
    expect(HAND_KINDS.filter((k: HandKind) => isHandKind(k))).toHaveLength(7);
    expect(isHandKind("OU")).toBe(false);
    expect(isHandKind("TO")).toBe(false);
  });
});

describe("emptyHand", () => {
  test("7種の欄が0で揃う", () => {
    const hand = emptyHand();
    expect(Object.keys(hand).sort()).toEqual([...HAND_KINDS].sort());
    expect(Object.values(hand).every((n) => n === 0)).toBe(true);
  });

  test("呼ぶたびに別の器を返す", () => {
    const a = emptyHand();
    a.FU = 3;
    expect(emptyHand().FU).toBe(0);
  });
});

describe("flipColor", () => {
  test("先後が入れ替わる", () => {
    expect(flipColor(Color.Black)).toBe(Color.White);
    expect(flipColor(Color.White)).toBe(Color.Black);
  });
});
