import { Shogi, type Color, type Kind } from "shogi.js";
import type { RawKind } from "shogi.js/cjs/Kind";
import type { HandicapPreset } from "@/entities/kifu/model/handicap";
import type { JKFHand, JKFPiece, JKFState } from "@/entities/kifu/model/jkf";
import { BOARD_SIZE } from "../model/board";
import { isValidCoords } from "./boardCoords";

/**
 * 組みかけの局面を `JKFState` のまま読み書きする純関数
 *
 * `Shogi` を状態として持たない。`editMode(true)` で止まるのは手番の側の駒かの確認
 * （`checkTurn`）、動きの合法性の照合（`getMovesFrom`）、`nextTurn`、`prevTurn` の4つだけで、
 * 残りはこの面の前提と逆を向いている。
 *
 * - `move` は行き所のない升へ動かすと強制的に成らせる（`deadEnd` の判定は編集モードの外にある）。
 *   この面は行き所のない駒を置けたうえで断りに出す
 * - `move` が駒を取ると `capture` が走り、取られた駒の反対側の駒台へ積む
 *   （`movePieceOnBoard` の doc を見ること）
 * - `drop` は `getDropsBy` で置ける升を絞る。あちらは `flagEditMode` を見ないので、
 *   二歩と行き所のない駒は編集モードでも `throw` になる
 * - `initialize` は末尾で `flagEditMode` を `false` に落とす。`initializeFromSFENString` は落とさない
 *
 * `Shogi` は SFEN が要るときと王手の判定に1つ作って捨てる。
 * どの関数も引数を書き換えないので、呼び手は返り値を使うこと。
 * 不正な引数は throw する。例外は `null` を返す `stateFromSfen` で、理由はその doc に書く。
 */

/**
 * 駒台に載る駒。玉と成駒はここに無い
 *
 * 集合そのものは `shogi.js` の `RawKind` と同じ（下の `HandKind`）。
 * **並びはここでしか決まらない** —— `serializeDraft` が駒台をこの順に並べるので、
 * 順序を変えると「組みかけか」の比較が同じ局面どうしで食い違う。
 *
 * 欄の抜けは `emptyHand` が返す `JKFHand` の鍵と突き合わせて固定してある
 * （`JKFHand` は `Record<RawKind, number>` なので、tsc が全ての鍵を要求する）。
 */
export const HAND_KINDS = [
  "FU",
  "KY",
  "KE",
  "GI",
  "KI",
  "KA",
  "HI",
] as const satisfies readonly RawKind[];

/**
 * 駒台に載る駒の種類
 *
 * `shogi.js` の `RawKind` そのもの。根の `shogi.js` はこれを再エクスポートしないので
 * 深い経路で読む。写すと、`JKFHand`（`Record<RawKind, number>`）とずれても tsc が黙る。
 */
export type HandKind = RawKind;

/** 盤の升。`x` は筋（1〜9）、`y` は段（1〜9）で、どちらも1始まり */
export type Square = {
  x: number;
  y: number;
};

/**
 * 升を `Set` / `Map` の鍵にする綴り
 *
 * 座標から鍵を組む式が2箇所にあると、片方だけ書式が変わっても
 * 「枠が付かない」「巡目を引き継がない」という形でしか出ない。組む関数を1つにする。
 */
export function squareKey(sq: Square): string {
  return `${sq.x},${sq.y}`;
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

function requireOnBoard(sq: Square): void {
  if (!isValidCoords(sq.x, sq.y)) throw new RangeError(`盤の外の升: (${sq.x}, ${sq.y})`);
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

/** 盤の駒を、筋の順、同じ筋では段の順に返す */
export function piecesOnBoard(state: JKFState): { square: Square; piece: Required<JKFPiece> }[] {
  const found: { square: Square; piece: Required<JKFPiece> }[] = [];
  for (let x = 1; x <= BOARD_SIZE.WIDTH; x++) {
    for (let y = 1; y <= BOARD_SIZE.HEIGHT; y++) {
      const square = { x, y };
      const piece = pieceAt(state, square);
      if (piece) found.push({ square, piece });
    }
  }
  return found;
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
 * 盤の駒を別の升へ動かす。
 *
 * 移動先に駒があれば、成りを落として動かす側の駒台へ入れる。
 * `shogi.js` の `capture` は取られた駒の反対側へ積む（`inverse()` してから `hands[piece.color]`）。
 * 先後が違えば行き先は同じで、食い違うのは同じ側の駒を重ねたときだけになる。
 * 並べ替えている人にとってそれは取ったのではなくどかしたので、どかした駒は手元に残す。
 *
 * 移動先が玉なら2つの位置を入れ替える。玉は駒台に載らないので、取り除く先が無い。
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

/**
 * 盤の駒を駒台へ送る。成りは落とす
 *
 * `toHand` は**送り先の駒台**であって、動かしている駒の持ち主ではない。
 * 相手側の駒台へも送れる（並べ替えている人が、どちらの持ち駒にするかを選ぶ）。
 *
 * 玉は受け付けない。可否は `canSendToHand` が持つので、押す前に沈められる。
 */
export function sendToHand(state: JKFState, from: Square, toHand: Color): JKFState {
  const piece = pieceAt(state, from);
  if (!piece) throw new Error(`駒のない升から送ろうとした: (${from.x}, ${from.y})`);
  if (!canSendToHand(piece)) throw new Error("玉は駒台に載らない");

  const next = cloneState(state);
  pushToHand(next, toHand, piece.kind);
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

/**
 * 升に覚えておく巡目
 *
 * **駒の姿と対で持つ。** `cyc` だけを覚えると、その升の駒が入れ替わったときに
 * 前の駒の巡目が残る（下の `cycleFrom` を見ること）。
 */
export type CycleStep = {
  kind: Kind;
  color: Color;
  cyc: number;
};

/**
 * 盤の駒を裏返した次の姿を返す。
 *
 * 不成 → 成 → 相手の不成 → 相手の成 で1周する。順は `shogi.js` の `flip` と同じで、
 * 成れない駒（玉、金）は2巡。持ち主が変わるのは成から相手の不成へ渡るところだけ。
 *
 * 「後手の不成」の次が「先手の不成」か「後手の成」かは `kind` と `color` だけでは決まらないので、
 * 巡目を引数に取る。巡目は画面が升ごとに覚える値で、出口の `initial.data` に
 * 余計な欄を持ち込まないよう `JKFState` には入れない。
 *
 * `remembered` には、その升で最後に返した値をそのまま渡す。駒の姿がいま升にある駒と
 * 食い違えば引き継がないので、**呼び手は駒が動くたびに覚えを消さなくてよい。**
 * 消すのは種を載せ直すときだけ（`usePositionDraft` の `loadSeed`）。この照合が無いと、
 * 歩を2回裏返して（後手の歩、巡目2）別の先手歩をその升に重ねたとき、
 * 次の右クリックが同じ駒を返し、押しても何も起きない形になる。
 */
export function cycleFrom(kind: Kind, color: Color, remembered?: CycleStep): CycleStep {
  const raw = unpromotedKind(kind);
  const promoted = promotedKind(raw);
  const period = promoted ? 4 : 2;

  const carried =
    remembered && remembered.kind === kind && remembered.color === color
      ? remembered.cyc
      : undefined;
  if (carried !== undefined && !Number.isInteger(carried)) {
    // 畳む式（`((n % p) + p) % p`）が畳めるのは負値だけで、非整数はそのまま残る。
    // 残ると `steps[2.5]` が `undefined` になり、kind も color も持たない値が返る
    throw new RangeError(`巡目が整数でない: ${carried}`);
  }

  const current = (((carried ?? (UNPROMOTED[kind] ? 1 : 0)) % period) + period) % period;

  // いま何巡目かが分かれば、1巡目の持ち主が逆算できる
  const owner: Color = (promoted ? current >= 2 : current === 1) ? flipColor(color) : color;
  const nextCyc = (current + 1) % period;

  if (!promoted) {
    return { kind: raw, color: nextCyc === 0 ? owner : flipColor(owner), cyc: nextCyc };
  }
  const steps: Array<{ kind: Kind; color: Color }> = [
    { kind: raw, color: owner },
    { kind: promoted, color: owner },
    { kind: raw, color: flipColor(owner) },
    { kind: promoted, color: flipColor(owner) },
  ];
  return { ...steps[nextCyc], cyc: nextCyc };
}

/**
 * 盤の駒を裏返し、次の局面と覚えておく巡目を返す。
 *
 * 駒の顔ぶれは変えない。`setSquare` を非公開にしてあるのは、任意の駒を任意の升へ置ける関数を
 * 出すと「盤と駒台に無い駒を足せない」という前提が崩れるため。
 *
 * `remembered` の扱いは `cycleFrom` を見ること。
 */
export function cycleOnBoard(
  state: JKFState,
  sq: Square,
  remembered?: CycleStep,
): { state: JKFState; step: CycleStep } {
  const piece = pieceAt(state, sq);
  if (!piece) throw new Error(`駒のない升を裏返そうとした: (${sq.x}, ${sq.y})`);

  const step = cycleFrom(piece.kind, piece.color, remembered);
  const next = cloneState(state);
  setSquare(next, sq, { kind: step.kind, color: step.color });
  return { state: next, step };
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
  for (let x = 1; x <= BOARD_SIZE.WIDTH; x++) {
    const file: JKFPiece[] = [];
    for (let y = 1; y <= BOARD_SIZE.HEIGHT; y++) {
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

/**
 * SFEN を種にする。読めなければ `null` を返す。
 *
 * このファイルで唯一、不正な入力に throw しない。ここへ来るのは `study_positions.json` の中身
 * （Rust 側に SFEN の検査は無い）と URL の `sfen=` で、盤に載せられないことは正常な入力の一種。
 * throw にすると、React のイベントハンドラから呼んだときに受け手が無い
 * （`getDerivedStateFromError` はレンダとライフサイクルしか捕まえない）。
 * 他の関数の引数は画面が作る値で、押す前に沈めてあるので、届く不正は画面側の穴として上げてよい。
 *
 * `shogi.js` に丸投げできない。明示の `throw` は手番の欄が `b` / `w` でないときの1本だけで、
 * 段数も筋数も駒の綴りも見ない。欄が欠ければ偶然 `TypeError` になる。
 *
 * - `lnsgkgsnl/9/9 b - 1`（3段）→ 残りを空段で埋めた別の局面になる
 * - `9/…/9 b 250000P 1` → その枚数だけ駒を作る（`isWellFormedSfen` の doc を見ること）
 * - `x8/…` → `kind` が文字列 `"undefined"` の駒が盤に載る。`Piece.fromSFENString` は引けなくても投げず、
 *   投げるのは書き戻すときなので、載せた時点では気づけない
 *
 * どれも別の局面が盤に載るか、操作が無反応になるので、渡す前に形を見る。
 */
export function stateFromSfen(sfen: string): JKFState | null {
  if (!isWellFormedSfen(sfen)) return null;

  const shogi = new Shogi();
  try {
    shogi.initializeFromSFENString(sfen);
  } catch {
    return null;
  }

  const state = stateFromShogi(shogi);
  return exceedsPieceSupply(state) ? null : state;
}

/** SFEN の駒1文字。玉は `k`、成駒は `+` を伴う。`+G` / `+K` は無い */
const SFEN_UNPROMOTED = "plnsgbrk";
const SFEN_PROMOTABLE = "plnsbr";

/** 駒台に載る駒の SFEN と `Kind` の対応。玉は駒台に載らないので入っていない */
const SFEN_HAND_KIND: Record<string, HandKind> = {
  p: "FU",
  l: "KY",
  n: "KE",
  s: "GI",
  g: "KI",
  b: "KA",
  r: "HI",
};

/**
 * 将棋一式に何枚あるか
 *
 * `shogi.js` の `pieceHistogram` と同じ値だが、あちらは `{[kind: string]: number}` で
 * 綴りの検査に使えない。ここは `Kind` を鍵にして、増減があれば tsc に見せる。
 */
const PIECE_SUPPLY = {
  FU: 18,
  KY: 4,
  KE: 4,
  GI: 4,
  KI: 4,
  KA: 2,
  HI: 2,
  OU: 2,
} as const satisfies Partial<Record<Kind, number>>;

/**
 * `shogi.js` に渡してよい形かを返す。
 *
 * 構築の前に枚数まで見る。持ち駒の欄は数字の回数だけ駒を作るので、枚数に線形で、
 * 実測は `250000P` が 41ms、`4000000P` が 604ms。桁数を制限する綴りがライブラリ側に無く、
 * 作らせてから数えるのでは間に合わない。
 */
function isWellFormedSfen(sfen: string): boolean {
  const [board, turn, hands] = sfen.trim().split(/\s+/);
  if (board === undefined || hands === undefined) return false;
  if (turn !== "b" && turn !== "w") return false;
  return isWellFormedBoardField(board) && isWellFormedHandField(hands);
}

function isWellFormedBoardField(field: string): boolean {
  const ranks = field.split("/");
  if (ranks.length !== BOARD_SIZE.HEIGHT) return false;

  for (const rank of ranks) {
    let files = 0;
    for (let i = 0; i < rank.length; i++) {
      const promoted = rank[i] === "+";
      const letter = promoted ? rank[++i] : rank[i];
      if (letter === undefined) return false;

      if (!promoted && /[1-9]/.test(letter)) {
        files += Number(letter);
        continue;
      }
      const allowed = promoted ? SFEN_PROMOTABLE : SFEN_UNPROMOTED;
      if (!allowed.includes(letter.toLowerCase())) return false;
      files += 1;
    }
    if (files !== BOARD_SIZE.WIDTH) return false;
  }
  return true;
}

function isWellFormedHandField(field: string): boolean {
  if (field === "-") return true;

  const counted: Partial<Record<HandKind, number>> = {};
  for (const m of field.matchAll(/(\d*)([a-zA-Z])/g)) {
    const kind = SFEN_HAND_KIND[m[2]!.toLowerCase()];
    if (!kind) return false;
    const n = m[1] === "" ? 1 : Number(m[1]);
    if (n < 1) return false;
    counted[kind] = (counted[kind] ?? 0) + n;
    if (counted[kind]! > PIECE_SUPPLY[kind]) return false;
  }
  // 拾えなかった文字が残っていれば綴りが壊れている
  return field.replace(/\d*[a-zA-Z]/g, "") === "";
}

/** 盤と駒台を合わせて、将棋一式より多い駒があるか */
function exceedsPieceSupply(state: JKFState): boolean {
  const total = new Map<Kind, number>();
  for (const { piece } of piecesOnBoard(state)) {
    const raw = unpromotedKind(piece.kind);
    total.set(raw, (total.get(raw) ?? 0) + 1);
  }
  for (const color of [0, 1] as const) {
    for (const kind of HAND_KINDS) {
      total.set(kind, (total.get(kind) ?? 0) + handCount(state, color, kind));
    }
  }
  return [...total].some(([kind, n]) => n > (PIECE_SUPPLY[kind as keyof typeof PIECE_SUPPLY] ?? 0));
}

/**
 * いまの局面から `Shogi` を1つ作る。
 *
 * 公開しない。`Shogi` を返す関数が公開されていると、「`Shogi` を状態として持たない」を
 * 守るものがコメントだけになる（`useState(stateToShogi(...))` を tsc も lint も止めない）。
 * `shogi.js` にしか無い判定は、`isCheckOn` のように答えだけを返す形で出す。
 */
function stateToShogi(state: JKFState): Shogi {
  return new Shogi({ preset: "OTHER", data: normalizeForShogi(state) });
}

export function stateToSfen(state: JKFState): string {
  return stateToShogi(state).toSFENString();
}

/**
 * `color` の玉に王手がかかっているか
 *
 * `shogi.js` の `isCheck` を借りる。`getMovesFrom` は手番も編集モードも見ないので、
 * 組みかけの局面にそのまま当てられる。写すと、飛角香の遮りと桂の跳ね方を
 * 2箇所で持つことになる。
 *
 * **玉が無ければ `false`。** 詰将棋には攻め方の玉が無いので、その形を例外にしない。
 */
export function isCheckOn(state: JKFState, color: Color): boolean {
  return stateToShogi(state).isCheck(color);
}

/**
 * `shogi.js` に渡せる形に整える
 *
 * `fromPreset` は `data.board[i][j].kind` を素で読む。欠けた升があると
 * そこで throw するので、空升を `{}` で埋め直す。
 */
function normalizeForShogi(state: JKFState): JKFState {
  const board: JKFPiece[][] = [];
  for (let x = 1; x <= BOARD_SIZE.WIDTH; x++) {
    const file: JKFPiece[] = [];
    for (let y = 1; y <= BOARD_SIZE.HEIGHT; y++) {
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
  for (let x = 1; x <= BOARD_SIZE.WIDTH; x++) {
    for (let y = 1; y <= BOARD_SIZE.HEIGHT; y++) {
      const piece = pieceAt(state, { x, y });
      squares.push(piece ? `${piece.kind}${piece.color}` : ".");
    }
  }
  const hands = [0, 1]
    .map((color) => HAND_KINDS.map((kind) => handCount(state, color as Color, kind)).join(","))
    .join("|");
  return `${squares.join("")}|${hands}|${state.color}`;
}
