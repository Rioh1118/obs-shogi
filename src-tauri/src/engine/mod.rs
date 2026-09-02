use std::time::Duration;

pub mod analyzer; // 解析処理
pub mod bridge; // 解析のファサード
pub mod commands; // Tauri コマンドの入口
pub mod game; // 対局
pub mod protocol; // USI プロトコル
pub mod registry; // 起動済みプロセスの台帳
pub mod state; // Tauri コマンドが共有する持ち物
pub mod types;
pub mod utils;

/// `usi` を送ってから `usiok` を待つ上限。
///
/// ここに掛かるのは実行ファイルの起動直後だけで、評価関数の読み込みは
/// `isready` の側に来る。長く取る理由が無い。
pub const USI_OK_TIMEOUT: Duration = Duration::from_secs(30);

/// `isready` を送ってから `readyok` を待つ上限。
///
/// `usiok` より桁で長いのは、評価関数やハッシュの確保がここで走るため。
/// 短く切ると、重い設定のエンジンが起動できないという形で出る。
pub const READY_TIMEOUT: Duration = Duration::from_secs(120);
