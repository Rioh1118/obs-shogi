/**
 * 対局の Tauri コマンド。対局者、持ち時間、手番、決まった手、終局を扱う。
 *
 * USI の段取り（`isready`、`position`、`go`、`gameover` など）は Rust の中で完結する。
 * 例外は `setoption` の値、`ponder`、根の SFEN、指し手の文字列で、どれを渡すかは
 * こちらが決めるので境界を越える。
 */
import { invoke } from "@tauri-apps/api/core";
import type { GameId, GameSettings, GameSnapshot, Side } from "./rust-types";

/**
 * 対局を始め、エンジンが `usinewgame` まで応じたら解決する。
 *
 * 待つ長さの上限は Rust の `START_TIMEOUT` で、評価関数の重いエンジンでは数十秒かかる。
 * 締切は段に入る前に見るので、跨いだ段のぶんは少し超える。取り消すコマンドは無い。
 *
 * 最初の `go` は待たない。その失敗は戻り値ではなく `over { reason: engineFailure }` で届く。
 *
 * 失敗の分け方は文言で、`Err` が `timed out` で始まっていたら遅かっただけなので、
 * そのまま再試行してよい。`includes` で見ない。断りには対局者の表示名も OS の文言
 * （macOS の `Operation timed out`）も載るので、設定の誤りが遅かっただけを名乗る。
 *
 * 始まっていないときの大半は設定の誤りだが、内部の取り落としも同じ `Err(String)` で
 * 届く。パスを直せと断言せず、文言をそのまま見せて再試行も残す。
 *
 * 呼ぶ前に `listenToGameEvents` を張る。最初の `turnChanged` と最初の `go` は
 * 解決より先に走るので、解決を待ってから張ると取りこぼす。
 *
 * 解決前に届いた出来事は `gameId` で判定できないので、溜めて解決後に振り分ける。
 * 捨てると、起動段を通って最初の `go` で落ちたエンジンの `over` を失い、
 * 終局した対局が画面に残る。
 */
export async function startGame(settings: GameSettings): Promise<GameId> {
  return await invoke("start_game", { settings });
}

/**
 * Rust が終局済みの対局への操作を断るときの綴り。故障ではなく、結末は `over` が運ぶ。
 *
 * 完全一致で見る。Rust は着手、裁定、投了、中断でこの1つの定数を返すので、
 * 部分一致は要らず、別の原因の文言にこの語が混ざったときまで正常と読む。
 */
export const ALREADY_OVER = "game is already over";

/**
 * 人の着手を送る。合法性はこちらが確かめてから呼ぶ。解決したら Rust が採った手で、
 * 棋譜へ積むのは解決してからにする。
 *
 * 呼び直してよい断りは1つだけ。
 *
 * - `a ruling is still pending; retry after continue_game`: 裁定の往復の間に来た。
 *   往復が済めば同じ手を指せるので、捨てない
 * - {@link ALREADY_OVER}: 呼び直しても同じ `Err`。結末は `over` が運ぶ
 * - `the clock ran out before the move landed`: 着手が届く前に持ち時間が尽きた。
 *   手は採られず、`moveDecided` の代わりに `over { reason: "timeout" }` が届く
 * - それ以外（手番が違う、その側がエンジン、指し手の書式、対局が台帳に無い）: 呼び直しても同じ
 */
export async function submitGameMove(gameId: GameId, side: Side, usiMove: string): Promise<void> {
  return await invoke("submit_game_move", { gameId, side, usiMove });
}

/**
 * 裁定「続く」を返す。`moveDecided` を受けたら、これか `endGameByRule` のどちらかを呼ぶ。
 * どちらも呼ばないと対局は進まず、`RULING_TIMEOUT` で終局する。
 *
 * `moves` は根からの全手で、`initialMoves` を含める。Rust は直前に決まった手までを
 * 丸ごと突き合わせ、途中を落とした列や過去の手が入れ替わった列を断る。
 *
 * 手数が Rust の `MAX_PLIES` を超えると、断らずに `over { reason: "rule" }` で終局する。
 * 返せる列は1つに固定されているので、断ると `rulingTimeout` で終局してしまう。
 *
 * 断りはどれも呼び直しても同じ。
 *
 * - {@link ALREADY_OVER}: 中断や時間切れが判定の間に入った。結末は `over` が運ぶ
 * - `not awaiting a ruling`: 裁定を待っていない
 * - それ以外（`moves` がいまの写しの続きでない、末尾が直前の手でない、長さが手番と
 *   合わない）: 送った列の誤り
 */
export async function continueGame(gameId: GameId, moves: string[]): Promise<void> {
  return await invoke("continue_game", { gameId, moves });
}

/**
 * 裁定「終局」を返す。詰み、千日手、持将棋、最大手数、反則はどれもここから入る。
 *
 * `detail` は `over` の結末に載って返る説明。Rust の `MAX_DETAIL_LEN` を超えると、
 * 断らずに切り詰めて末尾に `…` を付ける。断ると `rulingTimeout` で終局し、勝敗が消える。
 *
 * 改行やタブのような制御文字は `\uFFFD` に化けて返る（この値はログの1行にも載る）。
 * 複数行を出したいなら、こちらで組み立てて表示する。
 *
 * 既に終局していたら {@link ALREADY_OVER} で断る。呼び直しても同じで、結末は `over` が運ぶ。
 */
export async function endGameByRule(
  gameId: GameId,
  winner: Side | null,
  detail: string | null,
): Promise<void> {
  return await invoke("end_game_by_rule", { gameId, winner, detail });
}

/**
 * 人の投了を送る。エンジンの席を指すと Rust が断る。
 *
 * 既に終局していたら {@link ALREADY_OVER} で断る。`Ok` を投了の成立として棋譜へ書かない。
 * 結末の権威は `over` で、時間切れと同じ拍に入ると別の結末になる。
 */
export async function resignGame(gameId: GameId, side: Side): Promise<void> {
  return await invoke("resign_game", { gameId, side });
}

/**
 * 勝敗を付けずに終局する。
 *
 * 既に終局していたら {@link ALREADY_OVER} で断る。`Ok` を中断の成立として棋譜へ書かない。
 * 結末の権威は `over` で、時間切れと同じ拍に入ると別の結末になる。
 */
export async function abortGame(gameId: GameId): Promise<void> {
  return await invoke("abort_game", { gameId });
}

/**
 * 対局を畳む。エンジンを落とし、Rust の台帳から外す。
 *
 * 終局しただけではエンジンは落ちない（`gameover` の後に指し直せる形にしてあるため）。
 *
 * 呼び直す意味があるのは `busy` だけ。Rust は3つを `Rejection` で持つが、線では文言になる。
 *
 * - `the game is busy`: 他の操作が同じ対局を掴んでいて、エンジンは生きたまま残る。
 *   中断は試みるが、通ったかは保証しない。呼び直さないとプロセスが残る。
 *   この断りはミリ秒で返るので、数秒の間隔を空ける。Rust が絞るのはログだけで、連打は
 *   止めない。掴んでいる操作が返らないと `busy` が続くので、諦める条件も要る
 * - `the game is being closed`: 別の呼び出しが畳んでいる最中。待つ
 * - `unknown game:`: その `gameId` は台帳に無い。何も起きていない
 */
export async function closeGame(gameId: GameId): Promise<void> {
  return await invoke("close_game", { gameId });
}

/**
 * いまの対局の状態を返す。出来事を取りこぼした後の突き合わせに使う。呼び手はまだ無い。
 *
 * 進行は `listenToGameEvents` で届くので常用しない。`moves` は Rust の写しで、
 * 権威はこちらの指し手列。
 *
 * 断りは文言で分ける（`closeGame` と同じ）。
 *
 * - `the game is being closed`: 別の呼び出しが畳んでいる最中。待って呼び直す
 * - `unknown game:`: 台帳に無い。呼び直しても同じで、結末は分からない
 */
export async function getGameState(gameId: GameId): Promise<GameSnapshot> {
  return await invoke("get_game_state", { gameId });
}

/** Rust の台帳に載っている対局の ID を返す。畳んでいる最中のものも含む。呼び手はまだ無い */
export async function listGames(): Promise<GameId[]> {
  return await invoke("list_games");
}
