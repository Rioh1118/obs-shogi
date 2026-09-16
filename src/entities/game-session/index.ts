/**
 * 対局セッション。**`entities/game` とは別物。**
 * あちらは「棋譜を読んでいる状態」、ここは「対局が進んでいる状態」。
 *
 * 進行の権威は Rust（手番・時計・エンジン）。こちら側が持つのは
 * 局面と指し手列（棋譜）とルールの判定で、`continueGame` が毎手それを渡す。
 * 表は `docs/state-transitions/game-session.md`。
 *
 * 終局の判定は `entities/game` にある。`moveDecided` を受けたら
 * `judgeGameOutcome`（`lib/gameOutcome.ts`）に掛けて、`continueGame` と
 * `endGameByRule` のどちらを返すかを決める。**返るのは詰み・手詰まり・千日手・
 * 連続王手・トライルール・最大手数の6つだけ**で、持将棋の27点法と24点法は
 * 入らない——あちらは宣言の規則なので、利用者の宣言操作から
 * `judgeDeclaration`（`lib/jishogiDeclaration.ts`）を呼ぶ。
 * ただし Rust は手数の上限で `rule` を出す——`endGameByRule` を呼んでいなくても届く。
 *
 * `entities/game` の barrel に載っているのは `createOutcomeJudge`（差分で進む形）で、
 * 唯一の呼び出し元は `features/game-ruling/lib/rulingAdapter.ts`。
 * **根から組み直す `judgeGameOutcome` は載せていない** —— 毎手呼ぶと手数の2乗になる。
 * `judgeDeclaration` もまだ呼ぶ側が無いので載せていない。
 * **公開面へ載せるのは、最初の呼び出し元と一緒のときだけ。**
 * それまで深い import を増やさないこと。
 *
 * **生の Tauri コマンドは載せない。** このスライスの対外的な口は
 * `GameSessionProvider` と `useGameSession` で、進行の権威は provider の中の
 * `sessionRef` に在る。並べて出すと `useGameSession` を通さずに
 * `closeGame(gameId)` を直に呼ぶのが自然に見える —— 呼ばれると Rust の台帳からは
 * 消えるのに `sessionRef` は残り、`start` が永久に断って
 * 「すでに対局があります」から抜けられなくなる。
 */

// 進行を持つ層。**裁定を返す口は注入で受ける**（`RulingAdapter`）——
// 判定は `entities/game` に在るが、あちらが `Side` をここから取っているので、
// 読み返すと互いを読み合う組ができる
export { GameSessionProvider } from "./model/provider";
export { useGameSession } from "./model/useGameSession";
// **対局の画面を外したので、公開面はそこまで縮んでいる**
// （`docs/spec/features/game-play.md`）。いま残っているのは、進行の外側
// （橋・ゲート・盤の門）が実際に読んでいるものだけ。
// **面を戻すときに、要るものだけを呼び出し元と一緒に載せ直すこと** ——
// 先に並べておくと、何が使われているかが公開面から読めなくなる
// （`GameStartRequest` を載せていないのも同じ理由）。
export type { GameProgressView, GameRuling, GameSessionView, RulingAdapter } from "./model/types";
export type { GameId, Side } from "./api/rust-types";
