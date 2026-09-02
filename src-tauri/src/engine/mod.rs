pub mod analyzer; // 解析処理
pub mod bridge; // 解析のファサード
pub mod commands; // Tauri コマンドの入口
pub mod game; // 対局
pub mod protocol; // USI プロトコル
pub mod registry; // 起動済みプロセスの台帳
pub mod state; // Tauri コマンドが共有する持ち物
pub mod types;
pub mod utils;
