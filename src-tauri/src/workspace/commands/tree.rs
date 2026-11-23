//! ワークスペースのツリーを返すコマンド。

use std::path::PathBuf;
use tauri::{command, AppHandle, Runtime};

use crate::workspace::guard::validate_under_root;
use crate::workspace::tree::walk_from;
use crate::workspace::types::FileTreeNode;
use ::fs::error::{FsError, FsErrorCode};

/// `root_dir` から歩いたツリーを返す。
///
/// **`root_dir` は呼び出し側から来るので、設定値と突き合わせる。**
///
/// 突き合わせないと `invoke("get_file_tree", { rootDir: "/Users/x" })` で
/// ホーム以下の全ディレクトリ名・棋譜のフルパス・サイズ・更新時刻が返る。
/// 中身は `read_file` が `validate_under_root` で守っているが、一覧は素通りになる。
/// 走査の側で root の外へ出ないことは [`walk_from`] が受け持つ
/// （`validate_under_root` は引数1点しか見ない）。
///
/// **走査は `spawn_blocking` へ逃がす。** 同期のコマンドは Tauri がメインスレッドで走らせる。
/// ツリーは外の変更のたびとウィンドウへ戻るたびに取り直されるので、メインスレッドで
/// 歩くと、そのたびにウィンドウの操作と他のコマンドの応答が走査の間止まる。
#[command]
pub async fn get_file_tree<R: Runtime>(
    app: AppHandle<R>,
    root_dir: String,
) -> Result<FileTreeNode, FsError> {
    let root_path = PathBuf::from(&root_dir);
    validate_under_root(&app, &root_path)?;

    if !root_path.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "directory does not exist").with_path(root_dir),
        );
    }

    if !root_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidType, "path is not a directory")
                .with_path(root_path.to_string_lossy().to_string()),
        );
    }

    tauri::async_runtime::spawn_blocking(move || walk_from(&root_path))
        .await
        .unwrap_or_else(|e| Err(FsError::new(FsErrorCode::Unknown, e.to_string())))
}
