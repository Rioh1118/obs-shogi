/**
 * 1手ごとの終局判定。
 *
 * **`moveDecided` を受けた側が呼ぶ。** `null` が返ったときだけ `continueGame` を
 * 返してよい。どちらも返さないと Rust は裁定待ちのまま止まり、`RULING_TIMEOUT` で
 * 畳まれる（`entities/game-session/api/tauri.ts`）。
 *
 * **利用者に見せる文言はここで決めない。** 返すのは種別と勝者だけで、
 * `endGameByRule` に渡す `detail` の綴りは呼び出し側が決める。理由は
 * `KifuLoadFailure`（`entities/game/model/types.ts`）と同じ——ライブラリの英文や
 * 内部の語をそのまま外へ出すと、段と文言を決める場所が呼び出し側ごとに分かれる。
 *
 * **返すのは詰み・手詰まり・千日手・連続王手・トライルール・最大手数の6つだけ。**
 * 27点法と24点法はここに入らない——どちらも宣言の規則で、条件を満たしただけでは
 * 終局しない。宣言の可否は `judgeDeclaration`（`jishogiDeclaration.ts`）が持つ。
 *
 * **ルールの持ち主が2つに割れている。** 合法手の生成は shogi.js、千日手・
 * 連続王手・持将棋の点数は tsshogi。どちらか一方では賄えない——tsshogi は
 * 合法手を生成せず、shogi.js は千日手も点数も持たない。
 * **tsshogi 一本に寄せられないのは、盤の表示（移動可能マスの強調・成り選択）が
 * 既に shogi.js を使っていて消せないため。** 合法手の生成を重ねると2実装になる
 * （`docs/state-transitions/game-session.md` の「責任の切れ目」）。
 * その2つが割れたときに何が起きるかは #536。
 *
 * **値段は手数に比例する。** 呼ばれるたびに根から `Record` を組み直すので、
 * 1回が実測で 100手 4.6ms / 400手 16ms / 2000手 60ms。毎手呼ぶと合計は2乗で効き、
 * 400手の対局を通しで裁定すると 2.8 秒になる。
 * **画面を作るときは、対局セッションの間だけ判定器を持ち回る形にすること。**
 * ただし消えるのは**組み直しの分だけ**（同じ400手で約2ms）で、1手ごとの
 * `hasLegalMove` と千日手の判定は残る（同じ400手で約7ms）。
 */
import { Color, Shogi } from "shogi.js";
import { Position, Record as ShogiRecord } from "tsshogi";

import type { Side } from "@/entities/game-session";
import { Err, Ok, type Result } from "@/shared/lib/result";
import type { GameRules, JishogiRule } from "./gameRules";
import { hasLegalMove } from "./moveValidation";
import { tsColorToColor, opponentOf, colorToSide } from "./ruleColor";

/**
 * 終局の種別。**投了・時間切れ・中断は入らない**——それらは Rust が決めるので
 * 裁定として返す機会が無い（`GameOverReason`）。
 */
export type GameOutcomeKind =
  /** 詰み。手番側に合法手が無く、王手がかかっている */
  | "checkmate"
  /**
   * 手詰まり。手番側に合法手が無く、王手はかかっていない。
   *
   * **詰みと分けてあるのは棋譜に落とす綴りが違うため**（`TSUMI` に寄せられない）。
   * 勝敗の付き方は詰みと同じで、指せなくなった側が負け
   */
  | "stalemate"
  /** 千日手。同一局面が4回現れた */
  | "repetitionDraw"
  /** 連続王手の千日手。王手を続けた側の反則負け */
  | "perpetualCheck"
  /** トライルール。玉が相手玉の初期位置に着いた */
  | "tryRule"
  /** 最大手数（`GameRules.maxMoves`）に達した */
  | "maxMoves";

export interface GameOutcome {
  kind: GameOutcomeKind;
  /**
   * 引き分けなら null。**`endGameByRule` にそのまま渡せる形で返す。**
   *
   * shogi.js の `Color` で返さないのは `Color.Black` が `0` だから
   * （`ruleColor.ts`）。`winner ? … : 引き分け` と書かれた瞬間に
   * 先手勝ちが引き分けに潰れ、tsc は通してしまう
   */
  winner: Side | null;
}

/**
 * 局面を組み立てられなかった。**「まだ終わっていない」と混ぜないこと。**
 *
 * これが返ったら、渡された指し手列からいまの局面を再現できていない。
 * `continueGame` を返しても Rust 側の検算で弾かれるので、対局を中断して
 * 利用者に見せるほかない。
 *
 * **「その手が反則だった」の受け皿ではない。** 対局者が指した手の合法性は、
 * 裁定に入る前に見るもの（`ShogiMoveValidator.isLegalMove`）。ここまで来た
 * 反則手は、その検査を通していないか、通した検査と食い違ったかのどちらかで、
 * **どちらも反則負けにはできない**——`GameOutcomeKind` に反則の種別が無いので、
 * 誰の反則かをこの型は表せない。合法性の権威が2つに割れている件は #536。
 */
export type GameOutcomeFailure =
  | { code: "unplayable_start_sfen"; startSfen: string }
  | {
      code: "unplayable_move";
      usiMove: string;
      ply: number;
      /**
       * その手を指す**直前**の局面。詰まった場所を盤に出すために持たせてある。
       * これが無いと利用者へ言えるのは「N手目の xxxx が指せない」までで、
       * どこまで進んでいたのかを見せられない
       */
      sfen: string;
    };

export interface GameProgress {
  /**
   * 対局の根の局面。`GameSettings.startSfen` と同じもの。
   * **`startpos` は受け付けない**（あちらと同じ制約）
   */
  startSfen: string;
  /**
   * 根から現在までの USI 指し手。**`continueGame` に渡す列と同じもの。**
   * 途中局面から始めた対局なら `GameSettings.initialMoves` も含む
   */
  usiMoves: readonly string[];
}

/** トライルールの到達点は相手玉の初期位置。先手なら5一、後手なら5九 */
function trySquareOf(color: Color): { usi: string; x: number; y: number } {
  return color === Color.Black ? { usi: "5a", x: 5, y: 1 } : { usi: "5i", x: 5, y: 9 };
}

/**
 * `color` が直前の手でトライを成立させたか。
 *
 * **盤の上に玉が在ることだけで判定しない。** 途中局面から始める対局
 * （`GameSettings.startSfen` は平手に限らない）で、根の SFEN が既に先手玉5一なら、
 * 先手が何を指してもその直後に成立してしまう。成立するのは**その手で着いたとき**だけ。
 *
 * 着けた時点で「取られない」ことは確かめ済み——`buildRecord` の `record.append` が
 * 合法手しか積まないので、`color` の手番が終わった直後に `color` の玉が
 * 王手されている局面は組み立てられない。
 */
function reachedTrySquare(shogi: Shogi, color: Color, usiMoves: readonly string[]): boolean {
  const square = trySquareOf(color);
  const lastUsiMove = usiMoves.length === 0 ? null : usiMoves[usiMoves.length - 1];
  if (lastUsiMove === null || !lastUsiMove.endsWith(square.usi)) return false;

  // 玉以外もその地点へ動ける。着いたのが玉であることを盤で確かめる
  const piece = shogi.get(square.x, square.y);
  return !!piece && piece.color === color && piece.kind === "OU";
}

/**
 * 設定が「宣言を待たずに終局させる」持将棋の規則なら、その終局を返す。
 *
 * **`switch` で書く。** `JishogiRule` に値を足したとき、`=== "try"` の形だと
 * 新しい規則が黙って素通りし、**自動で終わるはずの対局が最大手数まで続く**。
 * ここは戻り値を返し切らないと tsc が落ちるので、足した人が必ず選ぶことになる。
 */
function judgeAutomaticJishogi(
  shogi: Shogi,
  lastMover: Color,
  usiMoves: readonly string[],
  rule: JishogiRule,
): GameOutcome | null {
  switch (rule) {
    case "try":
      return reachedTrySquare(shogi, lastMover, usiMoves)
        ? { kind: "tryRule", winner: colorToSide(lastMover) }
        : null;
    // 宣言の規則。条件を満たしただけでは終局しないので、ここでは何も返さない
    case "general24":
    case "general27":
    case "none":
      return null;
  }
}

/**
 * USI の指し手1つ。移動は `7g7f` / `2b3a+`、駒打ちは `P*5b`。
 *
 * **末尾まで見る。** `createMoveByUSI` は先頭から読める分だけ解釈して余りを捨てるので、
 * `7g7f7f` のような綴りが `7g7f` として通る。指し手列の権威はこちら側なので、
 * 通すと**盤は `7g7f` を、エンジンは元の文字列を**それぞれ解釈して別の局面を進む。
 */
const USI_MOVE = /^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/;

/**
 * `record` の末尾へ指し手を積む。**`basePly` は既に積んである手数**
 * （落ちたときに何手目かを名乗るために要る）。
 *
 * **途中で落ちたら `record` は積みかけのまま。** 呼び出し側が捨てること。
 */
function appendMoves(
  record: ShogiRecord,
  usiMoves: readonly string[],
  basePly: number,
): Result<void, GameOutcomeFailure> {
  for (const [index, usiMove] of usiMoves.entries()) {
    const failure = { code: "unplayable_move", usiMove, ply: basePly + index + 1 } as const;
    if (!USI_MOVE.test(usiMove)) {
      return Err({ ...failure, sfen: record.position.sfen });
    }
    const move = record.position.createMoveByUSI(usiMove);
    if (!move) return Err({ ...failure, sfen: record.position.sfen });

    // **`append` の前に控える。** 積んだ後では `record.position` が次の局面になり、
    // 「その手を指す直前」を指せなくなる
    const before = record.position.sfen;
    if (!record.append(move)) return Err({ ...failure, sfen: before });
  }
  return Ok(undefined);
}

function buildRecord(progress: GameProgress): Result<ShogiRecord, GameOutcomeFailure> {
  const position = Position.newBySFEN(progress.startSfen);
  if (!position) {
    return Err({ code: "unplayable_start_sfen", startSfen: progress.startSfen });
  }

  // **`Record.newByUSI` を使わない。** あちらは読めない指し手で黙って打ち切り、
  // 途中までの棋譜を `Ok` として返すので、短い局面を「現在局面」と誤って裁定する
  const record = new ShogiRecord(position);
  const appended = appendMoves(record, progress.usiMoves, 0);
  return appended.success ? Ok(record) : appended;
}

/**
 * 組み上がった `Record` の現在局面を裁定する。
 *
 * **判定の順は勝敗が付くものが先。** 詰んだ局面は、最大手数に達していても
 * 引き分けにしない。千日手も最大手数より先に立つ。
 */
function evaluate(
  record: ShogiRecord,
  usiMoves: readonly string[],
  rules: GameRules,
): Result<GameOutcome | null, GameOutcomeFailure> {
  const shogi = new Shogi();
  shogi.initializeFromSFENString(record.position.sfen);
  const toMove = shogi.turn;
  const lastMover = opponentOf(toMove);

  if (!hasLegalMove(shogi, toMove)) {
    return Ok({
      kind: shogi.isCheck(toMove) ? "checkmate" : "stalemate",
      winner: colorToSide(lastMover),
    });
  }

  const jishogi = judgeAutomaticJishogi(shogi, lastMover, usiMoves, rules.jishogiRule);
  if (jishogi !== null) return Ok(jishogi);

  if (record.repetition) {
    // **返るのは王手を続けた側**、つまり反則負けになる側。
    // 双方が王手を続けていた形では tsshogi は先手だけを返す（あちらの決め方であって、
    // どちらを負けにすべきかを規則が定めているわけではない）
    const checking = record.perpetualCheck;
    return Ok(
      checking === null
        ? { kind: "repetitionDraw", winner: null }
        : { kind: "perpetualCheck", winner: colorToSide(opponentOf(tsColorToColor(checking))) },
    );
  }

  if (rules.maxMoves > 0 && usiMoves.length >= rules.maxMoves) {
    return Ok({ kind: "maxMoves", winner: null });
  }

  return Ok(null);
}

/**
 * 現在局面が終局かを判定する。終わっていなければ `null`。
 *
 * **判定の順は勝敗が付くものが先。** 詰んだ局面は、最大手数に達していても
 * 引き分けにしない。千日手も最大手数より先に立つ。
 */
export function judgeGameOutcome(
  progress: GameProgress,
  rules: GameRules,
): Result<GameOutcome | null, GameOutcomeFailure> {
  const built = buildRecord(progress);
  return built.success ? evaluate(built.data, progress.usiMoves, rules) : built;
}

/**
 * 対局の間ずっと持ち回る判定器。**進んだぶんだけ積む。**
 *
 * `judgeGameOutcome` は呼ばれるたびに根から棋譜を組み直すので、毎手呼ぶと
 * 合計が手数の2乗で効く（値段はこのファイルの冒頭に実測がある）。
 * 対局はまさに毎手呼ぶ側なので、そこだけはこちらを使う。
 *
 * **消えるのは組み直しの分だけ。** 1手ごとの `hasLegalMove` と千日手の判定は残る。
 *
 * **前に裁定した列の続きでなければ、黙って組み直す。** 別の対局が始まった、
 * 途中局面が変わった、前の裁定が落ちた —— どれも「続きではない」で同じ扱いにする。
 * 積みかけの `Record` は捨てる（残すと、次の裁定が続きだと思って更に積む）。
 */
interface OutcomeJudge {
  judge(progress: GameProgress, rules: GameRules): Result<GameOutcome | null, GameOutcomeFailure>;
}

/** 積んである棋譜と、それを組んだ材料 */
interface HeldRecord {
  startSfen: string;
  /** 積んだ指し手。**`record` に入っているものと必ず一致する** */
  applied: string[];
  record: ShogiRecord;
}

/**
 * 積んである列が `usiMoves` の接頭辞か。
 *
 * **末尾と長さだけで決めない。** 途中の手が入れ替わった列でも通ってしまい、
 * 積んである棋譜とは別の局面を「現在局面」として裁定することになる
 * （Rust 側が `accept_continue` で接頭辞を丸ごと見ているのと同じ理由）。
 */
function continues(held: HeldRecord, progress: GameProgress): boolean {
  return (
    held.startSfen === progress.startSfen &&
    held.applied.length <= progress.usiMoves.length &&
    held.applied.every((usiMove, ply) => usiMove === progress.usiMoves[ply])
  );
}

export function createOutcomeJudge(): OutcomeJudge {
  let held: HeldRecord | null = null;

  return {
    judge(progress, rules) {
      const reusable = held !== null && continues(held, progress) ? held : null;

      if (reusable === null) {
        held = null;
        const built = buildRecord(progress);
        if (!built.success) return built;
        held = {
          startSfen: progress.startSfen,
          applied: [...progress.usiMoves],
          record: built.data,
        };
        return evaluate(held.record, progress.usiMoves, rules);
      }

      const tail = progress.usiMoves.slice(reusable.applied.length);
      const appended = appendMoves(reusable.record, tail, reusable.applied.length);
      if (!appended.success) {
        held = null;
        return appended;
      }

      reusable.applied.push(...tail);
      return evaluate(reusable.record, progress.usiMoves, rules);
    },
  };
}
