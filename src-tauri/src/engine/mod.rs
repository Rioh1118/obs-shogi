pub mod analyzer; // 解析処理
pub mod binding; // 評価関数・定跡の流し先を申告から決める
pub mod bridge; // 解析のファサード
pub mod child; // 子プロセスと標準入出力
pub mod commands; // Tauri コマンドの入口
pub mod game; // 対局
pub mod launchable; // OS がこのファイルを起動させるか
pub mod option_labels; // オプションの画面の名前（日本語）と分類
pub mod option_line; // USI の option 行を定義に写す
pub mod probe; // 申告だけを取る
pub mod protocol; // USI プロトコル
pub mod registry; // 起動済みプロセスの台帳
pub mod setup; // 設定を送って使える状態にする段
pub mod start_failure; // 起動の失敗を種類に分ける
pub mod state; // Tauri コマンドが共有する持ち物
pub mod types;
pub mod utils;
