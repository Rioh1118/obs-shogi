pub mod analyzer; // 解析処理
pub mod bridge; // 解析のファサード
pub mod child; // 子プロセスと標準入出力
pub mod commands; // Tauri コマンドの入口
pub mod game; // 対局
pub mod launchable; // OS がこのファイルを起動させるか
pub mod option_line; // USI の option 行を定義に写す
pub mod protocol; // USI プロトコル
pub mod registry; // 起動済みプロセスの台帳
pub mod setup; // 設定を送って使える状態にする段
pub mod state; // Tauri コマンドが共有する持ち物
pub mod types;
pub mod utils;
