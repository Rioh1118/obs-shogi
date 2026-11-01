/**
 * 走っている対局。`entities/game` が棋譜を読む状態を持つのに対し、ここは対局の進行を持つ。
 *
 * 手番、時計、エンジンの権威は Rust で、こちらは指し手列と裁定の返却を持つ。
 * 表は `docs/state-transitions/game-session.md`。
 *
 * 裁定の判定は持たず、`RulingAdapter` を注入で受ける。判定は `entities/game` にあるが、
 * あちらが `Side` をここから読むので、読み返すと互いを読み合う組ができる。
 *
 * Rust は手数の上限でも `rule` の `over` を出す。`endGameByRule` を呼んでいなくても届く。
 *
 * 生の Tauri コマンドは載せない。`closeGame` を直に呼ぶと Rust の台帳から消えるのに
 * 進行の記録が残り、`start` が断り続ける。
 *
 * 公開するのは、いま呼び手が読んでいるものだけにする（`docs/spec/features/game-play.md`）。
 * 対局の面を戻すときに、要るものを呼び手と一緒に載せる。
 */
export { GameSessionProvider } from "./model/provider";
export { useGameSession } from "./model/useGameSession";
export type { GameProgressView, GameRuling, GameSessionView, RulingAdapter } from "./model/types";
export type { GameId, Side } from "./api/rust-types";
