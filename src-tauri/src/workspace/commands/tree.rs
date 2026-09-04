//! ワークスペースのツリーを返すコマンド。

use std::path::PathBuf;
use tauri::{command, AppHandle, Runtime};

use crate::fs::error::{FsError, FsErrorCode};
use crate::workspace::guard::validate_under_root;
use crate::workspace::tree::walk_from;
use crate::workspace::types::FileTreeNode;

/// ツリーの取得。**`root_dir` は呼び出し側から来るので、設定値と突き合わせる。**
///
/// 突き合わせないと `invoke("get_file_tree", { rootDir: "/Users/x" })` で
/// ホーム以下の全ディレクトリ名・棋譜のフルパス・サイズ・更新時刻が返る。
/// 中身は `read_file` が `validate_under_root` で守っているが、一覧は素通りになる。
/// 走査の側で root の外へ出ないことは [`walk_from`] が受け持つ
/// （関門は引数1点しか見ない）。
#[command]
pub fn get_file_tree<R: Runtime>(
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

    walk_from(&root_path)
}
