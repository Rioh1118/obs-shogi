import { Shogi, type Color, type Kind } from "shogi.js";
import type { HandicapPreset } from "@/entities/kifu/model/handicap";
import type { JKFHand, JKFPiece, JKFState } from "@/entities/kifu/model/jkf";
import { BOARD_SIZE } from "../model/shogi";

/**
 * 組みかけの局面を並べ替える純関数
 *
 * **`Shogi` を状態として持たない。** `Shogi` の編集用の口は、この面が要る規則と
 * 食い違っている —— `move` は毎回 `nextTurn()` を呼び、取った駒を**相手側**の
 * 駒台へ入れ（`capture` が `inverse()` してから積む）、`drop` は二歩と
 * 行き所のない駒を `throw` で弾き、`initialize` は末尾で `flagEditMode` を落とす。
 * どれも「規則に反する配置も通す」というこの面の前提と逆を向いている。
 *
 * 状態は `JKFState`（ただの配列とカウンタ）で持ち、`Shogi` は SFEN が要るときと
 * 王手の判定に1つ作って捨てる。
 *
 * **どの関数も引数を書き換えない。** 呼び手は返り値を使うこと。
 */

/** 駒台に載る駒。玉と成駒はここに無い（JKF の持ち駒はこの7つしか欄を持たない） */
export const HAND_KINDS = ["FU", "KY", "KE", "GI", "KI", "KA", "HI"] as const;

export type HandKind = (typeof HAND_KINDS)[number];

/** 盤の升。`x` は筋（1〜9）、`y` は段（1〜9）で、どちらも1始まり */
export interface Square {
  x: number;
  y: number;
}

/** 成れる駒と、その成った姿 */
const PROMOTED: Partial<Record<Kind, Kind>> = {
  FU: "TO",
  KY: "NY",
  KE: "NK",
  GI: "NG",
  KA: "UM",
  HI: "RY",
};

const UNPROMOTED: Partial<Record<Kind, Kind>> = Object.fromEntries(
  Object.entries(PROMOTED).map(([raw, promoted]) => [promoted, raw]),
);

const BOARD_FILES = BOARD_SIZE.WIDTH;
const BOARD_RANKS = BOARD_SIZE.HEIGHT;

export function promotedKind(kind: Kind): Kind | null {
  return PROMOTED[kind] ?? null;
}

/** 成っていればもとの姿に戻す。もともと成っていない駒はそのまま */
export function unpromotedKind(kind: Kind): Kind {
  return UNPROMOTED[kind] ?? kind;
}

export function isHandKind(kind: Kind): kind is HandKind {
  return (HAND_KINDS as readonly Kind[]).includes(kind);
}

export function emptyHand(): JKFHand {
  return { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
}

function isOnBoard(sq: Square): boolean {
  return (
    Number.isInteger(sq.x) &&
    Number.isInteger(sq.y) &&
    sq.x >= 1 &&
    sq.x <= BOARD_FILES &&
    sq.y >= 1 &&
    sq.y <= BOARD_RANKS
  );
}

function requireOnBoard(sq: Square): void {
  if (!isOnBoard(sq)) throw new RangeError(`盤の外の升: (${sq.x}, ${sq.y})`);
}

function cloneState(state: JKFState): JKFState {
  return {
    color: state.color,
    board: state.board.map((file) => file.map((piece) => ({ ...piece }))),
    hands: [
      { ...emptyHand(), ...state.hands[0] },
      { ...emptyHand(), ...state.hands[1] },
    ],
  };
}

/**
 * 升の駒
 *
 * JKF の空升は `{}` で、`null` ではない。`kind` が無いものは全て空として扱う。
 */
export function pieceAt(state: JKFState, sq: Square): Required<JKFPiece> | null {
  requireOnBoard(sq);
  const piece = state.board[sq.x - 1]?.[sq.y - 1];
  if (!piece?.kind) return null;
  return { kind: piece.kind, color: piece.color ?? 0 };
}

export function handCount(state: JKFState, color: Color, kind: HandKind): number {
  return state.hands[color]?.[kind] ?? 0;
}

/** 升に置ける ＝ 空いている。行き所のない升かどうかは見ない（断りで伝える） */
export function canDropOn(state: JKFState, to: Square): boolean {
  return pieceAt(state, to) === null;
}

/** 駒台へ送れる ＝ 玉でない。JKF の持ち駒に玉の欄が無い */
export function canSendToHand(piece: Required<JKFPiece>): boolean {
  return piece.kind !== "OU";
}

function setSquare(state: JKFState, sq: Square, piece: JKFPiece): void {
  state.board[sq.x - 1][sq.y - 1] = piece;
}

function pushToHand(state: JKFState, color: Color, kind: Kind): void {
  const raw = unpromotedKind(kind);
  if (!isHandKind(raw)) throw new Error(`駒台に載らない駒: ${kind}`);
  state.hands[color][raw] += 1;
}

/**
 * 盤の駒を別の升へ動かす
 *
 * 移動先に駒があれば、**動かす側と同じ側**の駒台へ成りを落として入れる。
 * `shogi.js` の `capture` は反対側の駒台へ入れるが、それは対局の規則であって、
 * 並べ替えている人が期待する向きではない。
 *
 * 移動先が玉なら2つの位置を入れ替える。玉は駒台に載らないので、
 * 取り除く先が無い。
 */
export function movePieceOnBoard(state: JKFState, from: Square, to: Square): JKFState {
  const moving = pieceAt(state, from);
  if (!moving) throw new Error(`駒のない升から動かそうとした: (${from.x}, ${from.y})`);
  if (from.x === to.x && from.y === to.y) {
    throw new Error(`同じ升へ動かそうとした: (${to.x}, ${to.y})`);
  }

  const next = cloneState(state);
  const there = pieceAt(state, to);

  if (there && !canSendToHand(there)) {
    setSquare(next, to, moving);
    setSquare(next, from, there);
    return next;
  }

  if (there) pushToHand(next, moving.color, there.kind);
  setSquare(next, to, moving);
  setSquare(next, from, {});
  return next;
}

/** 盤の駒を駒台へ送る。成りは落とす。玉は受け付けない */
export function moveToHand(state: JKFState, from: Square, color: Color): JKFState {
  const piece = pieceAt(state, from);
  if (!piece) throw new Error(`駒のない升から送ろうとした: (${from.x}, ${from.y})`);
  if (!canSendToHand(piece)) throw new Error("玉は駒台に載らない");

  const next = cloneState(state);
  pushToHand(next, color, piece.kind);
  setSquare(next, from, {});
  return next;
}

/**
 * 駒台の駒を盤へ置く
 *
 * **行き所のない升にも置ける。** 置かせないと、そこから成駒を作る手順が無くなる。
 * 規則に反する配置は断りで伝える（`inspectPosition`）。
 */
export function dropFromHand(state: JKFState, kind: HandKind, color: Color, to: Square): JKFState {
  if (handCount(state, color, kind) <= 0) {
    throw new Error(`駒台に無い駒を置こうとした: ${kind}`);
  }
  if (!canDropOn(state, to)) throw new Error(`駒のある升へ置こうとした: (${to.x}, ${to.y})`);

  const next = cloneState(state);
  next.hands[color][kind] -= 1;
  setSquare(next, to, { kind, color });
  return next;
}

/** 駒台から反対側の駒台へ移す */
export function moveBetweenHands(
  state: JKFState,
  kind: HandKind,
  from: Color,
  to: Color,
): JKFState {
  if (from === to) throw new Error("同じ駒台へ移そうとした");
  if (handCount(state, from, kind) <= 0) {
    throw new Error(`駒台に無い駒を移そうとした: ${kind}`);
  }

  const next = cloneState(state);
  next.hands[from][kind] -= 1;
  next.hands[to][kind] += 1;
  return next;
}

interface CycleStep {
  kind: Kind;
  color: Color;
  cyc: number;
}

/**
 * 盤の駒を裏返した次の姿
 *
 * 不成 → 成 → 相手の成 → 相手の不成 で1周する。成れない駒（玉・金）は2巡。
 * `shogi.js` の `flip`（先手 → 先手成 → 後手 → 後手成）は採らない。
 * 成りと持ち主が交互に変わるので、目当ての状態まで何回押すか読めない。
 *
 * **(kind, color) だけでは次が決まらない。** 「後手の不成」の次が「先手の不成」なのか
 * 「後手の成」なのかは、何巡目かを知らないと決まらない。だから `cyc` を引数に取る。
 * `cyc` を渡さないときは、成っている駒なら1巡目（＝もとの持ち主の成）として始める。
 *
 * `cyc` は画面が升ごとに覚える値で、`JKFState` には入れない。
 * 出口（`initial.data`）に余計な欄を持ち込まないため。
 */
export function cycleFrom(kind: Kind, color: Color, cyc?: number): CycleStep {
  const raw = unpromotedKind(kind);
  const promoted = promotedKind(raw);
  const period = promoted ? 4 : 2;
  const current = (((cyc ?? (UNPROMOTED[kind] ? 1 : 0)) % period) + period) % period;

  // いま何巡目かが分かれば、1巡目の持ち主が逆算できる
  const owner: Color = (promoted ? current >= 2 : current === 1) ? flipColor(color) : color;
  const nextCyc = (current + 1) % period;

  if (!promoted) {
    return { kind: raw, color: nextCyc === 0 ? owner : flipColor(owner), cyc: nextCyc };
  }
  const steps: Array<{ kind: Kind; color: Color }> = [
    { kind: raw, color: owner },
    { kind: promoted, color: owner },
    { kind: promoted, color: flipColor(owner) },
    { kind: raw, color: flipColor(owner) },
  ];
  return { ...steps[nextCyc], cyc: nextCyc };
}

export function flipColor(color: Color): Color {
  return (1 - color) as Color;
}

export function setTurn(state: JKFState, color: Color): JKFState {
  const next = cloneState(state);
  next.color = color;
  return next;
}

function stateFromShogi(shogi: Shogi): JKFState {
  const board: JKFPiece[][] = [];
  for (let x = 1; x <= BOARD_FILES; x++) {
    const file: JKFPiece[] = [];
    for (let y = 1; y <= BOARD_RANKS; y++) {
      const piece = shogi.get(x, y);
      file.push(piece ? { kind: piece.kind, color: piece.color } : {});
    }
    board.push(file);
  }

  const hands: [JKFHand, JKFHand] = [emptyHand(), emptyHand()];
  for (const color of [0, 1] as const) {
    for (const piece of shogi.hands[color] ?? []) {
      const raw = unpromotedKind(piece.kind);
      if (!isHandKind(raw)) throw new Error(`駒台に載らない駒が持ち駒にある: ${piece.kind}`);
      hands[color][raw] += 1;
    }
  }

  return { color: shogi.turn, board, hands };
}

/** 手合割を種にする */
export function stateFromPreset(preset: HandicapPreset): JKFState {
  return stateFromShogi(new Shogi({ preset }));
}

/** SFEN を種にする。読めない SFEN は `shogi.js` が throw する */
export function stateFromSfen(sfen: string): JKFState {
  const shogi = new Shogi();
  shogi.initializeFromSFENString(sfen);
  return stateFromShogi(shogi);
}

/**
 * いまの局面の SFEN
 *
 * `Shogi` はここで1つ作って捨てる。組みかけの状態として持つと、
 * この関数の冒頭に書いた食い違いを全部背負うことになる。
 */
export function stateToSfen(state: JKFState): string {
  return new Shogi({ preset: "OTHER", data: normalizeForShogi(state) }).toSFENString();
}

/**
 * `shogi.js` に渡せる形に整える
 *
 * `fromPreset` は `data.board[i][j].kind` を素で読む。欠けた升があると
 * そこで throw するので、空升を `{}` で埋め直す。
 */
function normalizeForShogi(state: JKFState): JKFState {
  const board: JKFPiece[][] = [];
  for (let x = 1; x <= BOARD_FILES; x++) {
    const file: JKFPiece[] = [];
    for (let y = 1; y <= BOARD_RANKS; y++) {
      const piece = pieceAt(state, { x, y });
      file.push(piece ? { ...piece } : {});
    }
    board.push(file);
  }
  return {
    color: state.color,
    board,
    hands: [
      { ...emptyHand(), ...state.hands[0] },
      { ...emptyHand(), ...state.hands[1] },
    ],
  };
}

/**
 * 組みかけかどうかを比べるための直列化
 *
 * **盤・両駒台・手番だけを見る。** ファイル名や先手名を変えただけで
 * 「組みかけ」になると、閉じるたびに確認が出て、確認そのものが読まれなくなる。
 */
export function serializeDraft(state: JKFState): string {
  const squares: string[] = [];
  for (let x = 1; x <= BOARD_FILES; x++) {
    for (let y = 1; y <= BOARD_RANKS; y++) {
      const piece = pieceAt(state, { x, y });
      squares.push(piece ? `${piece.kind}${piece.color}` : ".");
    }
  }
  const hands = [0, 1]
    .map((color) => HAND_KINDS.map((kind) => handCount(state, color as Color, kind)).join(","))
    .join("|");
  return `${squares.join("")}|${hands}|${state.color}`;
}
