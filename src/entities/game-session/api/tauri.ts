/**
 * 対局の Tauri コマンド。
 *
 * **進行の段取りはここに出てこない。** `usiok` / `readyok` / `isready` /
 * `position` / `go` / `ponderhit` / `gameover` は Rust の中で完結する。
 * ここが扱うのは対局者・持ち時間・手番・決まった手・終局。
 *
 * **エンジンを起こすための設定は越える**（`setOption` の値、`ponder`、根の SFEN、
 * USI の指し手文字列）。どれを渡すかを決めるのはこちら側なので、内側に閉じようがない。
 */
import { invoke } from "@tauri-apps/api/core";
import type { GameId, GameSettings, GameSnapshot, Side } from "./rust-types";

/**
 * 対局を始める。
 *
 * エンジンの起動と `usinewgame` **まで**を待って返る。評価関数の読み込みが
 * 重いエンジンではここで数十秒かかるので、待っている表示を出すこと。
 * **待たせる長さは Rust の `START_TIMEOUT` で決まる。** 超えると reject するが、
 * 締切は段に入る前に見るので、跨いだ段のぶん（`setoption` 1件の書き込み、
 * 失敗したときの後始末）は少し超える。**厳密な上限として待ち UI を組まないこと。**
 * 取り消す口は無いので、それまでは待つことになる。
 *
 * **最初の `go` は待たない。** `Ok` は「エンジンが `usinewgame` まで応じた」で
 * あって「考え始めた」ではない。最初の `position` / `go` は別タスクで走り、
 * その失敗は戻り値ではなく `game-event` の `over { reason: engineFailure }` で届く。
 *
 * **`startGame` を呼ぶ前に `listenToGameEvents` を張ること。**
 * 最初の `turnChanged` と最初の `go` は、`start_game` が返る**前に**走る。
 * `Ok` を待ってから張ると必ず取りこぼし、`bestmove resign` を即返すエンジンでは
 * `moveDecided` と `over` も落ちる——初期局面が出たまま何も起きない。
 *
 * **それだけでは足りない。** `gameId` はここが解決するまで手に入らないので、
 * 解決前に届いたイベントは**どの対局のものか判定できない**。素直な
 * `if (e.gameId !== myGameId) return;` は、起動直後に終局した対局の `over` を必ず捨てる
 * （評価関数のパスを間違えたエンジンは `readyok` まで応じるので、起動段は通過して
 * 最初の `go` で落ちる）。捨てると `Phase::Over` の対局が画面に残り、
 * `on_tick` は即 return なので中断も時計も来ない。
 *
 * **解決するまでのイベントは溜め、解決した `gameId` で振り分け直すこと。**
 */
export async function startGame(settings: GameSettings): Promise<GameId> {
  return await invoke("start_game", { settings });
}

/**
 * 人間の着手。合法性を確かめてから呼ぶ。
 *
 * **解決したことは「採られた」の意味。** 着手が届くのと持ち時間が尽きるのが
 * 同じ tick に入ると reject する（`moveDecided` は出ず、代わりに
 * `over { reason: "timeout" }` が届く）。棋譜へ積むのは解決してからにすること。
 */
export async function submitGameMove(gameId: GameId, side: Side, usiMove: string): Promise<void> {
  return await invoke("submit_game_move", { gameId, side, usiMove });
}

/**
 * 裁定「まだ続く」。`moves` が指し手列の権威になる。
 *
 * `moveDecided` を受けたら、合法性と終局（詰み・千日手・持将棋・最大手数）を
 * 判定して、これか `endGameByRule` のどちらかを呼ぶ。
 * **どちらも呼ばないと対局は進まない。**
 *
 * **`moves` は根からの全手。** 対局開始局面が途中局面でも、`startGame` に渡した
 * `initialMoves` を含めて渡すこと。直前に決まった手までを丸ごと突き合わせるので、
 * 途中を落とした列や過去の手が入れ替わった列は reject する。
 *
 * **手数が Rust の `MAX_PLIES` を超えると、reject ではなく終局する**
 * （`over { reason: "rule" }`、`detail` に上限に当たったことが載る）。
 * 断ると、返せる列が1つに固定されているので裁定をやり直しても同じ結果になり、
 * 対局が「アプリが裁定を返さなかった」として畳まれてしまうため。
 */
export async function continueGame(gameId: GameId, moves: string[]): Promise<void> {
  return await invoke("continue_game", { gameId, moves });
}

/** 裁定「終局」。詰み・千日手・持将棋・最大手数・反則はすべてここから入る */
export async function endGameByRule(
  gameId: GameId,
  winner: Side | null,
  detail: string | null,
): Promise<void> {
  return await invoke("end_game_by_rule", { gameId, winner, detail });
}

/** 人間の投了。エンジンの投了は `bestmove resign` から入るのでここは通らない */
export async function resignGame(gameId: GameId, side: Side): Promise<void> {
  return await invoke("resign_game", { gameId, side });
}

/** 勝敗を付けずに終局にする */
export async function abortGame(gameId: GameId): Promise<void> {
  return await invoke("abort_game", { gameId });
}

/**
 * 対局を閉じ、使っていたエンジンを落とす。
 *
 * **終局しただけでは落ちない**（`gameover` の後に指し直せる形にしてあるため）。
 * 呼ばないとプロセスが残る。
 *
 * **失敗しうる。断り方は3つあり、呼び直す意味があるのは1つだけ。**
 *
 * - `the game is busy` → 他の操作が同じ対局を掴んでいる。**中断は試みたが通ったかは
 *   保証しない**（詰まっていれば探索も時計も続いている）。**エンジンは生きたまま**残る。
 *   そのまま呼び直すこと。握り潰すとプロセスが残る
 * - `the game is being closed` → 別の呼び出しがいま閉じている最中。待つこと
 * - `unknown game:` → その `gameId` は台帳に無い。何も起きていない
 *
 * 文言で区別することになる。型で割るのは #362 と同じ形の話。
 */
export async function closeGame(gameId: GameId): Promise<void> {
  return await invoke("close_game", { gameId });
}

/**
 * いまの対局の状態を取る。**イベントを取りこぼした後の突き合わせ用。**
 *
 * 進行は `listenToGameEvents` で届くので、常用しない。返る `moves` は Rust が持つ
 * 写しで、**権威はこちら側の棋譜**。`clocks.running` が `null` になる理由は
 * `ClocksView.running` に4つ挙げてある（うち2つは `phase: "thinking"` でも起きる）。
 */
export async function getGameState(gameId: GameId): Promise<GameSnapshot> {
  return await invoke("get_game_state", { gameId });
}

/**
 * 開いている対局の ID。**閉じ忘れを拾うためにある。**
 *
 * 終局してもエンジンのプロセスは落ちない。`closeGame` を呼ばずに画面を離れた
 * 対局はここに残る。
 */
export async function listGames(): Promise<GameId[]> {
  return await invoke("list_games");
}
