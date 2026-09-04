//! 設定された作業場所の外へ出ていないか。
//!
//! **ここだけが「どこが root か」を知る。** 名前とパスの判定そのものは
//! `fs::path` にあり、そちらは設定を読まない。

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

use crate::fs::error::{FsError, FsErrorCode};
use crate::fs::path::{canonicalize_for_compare, is_under};

/// AppConfig.root_dir を取得（未設定なら None）。
///
/// **`config_dir` から型もファイル名も借りる。写さない。**
///
/// 写すと、あちらの変更がこちらに当たらない。`serde` は欠けたフィールドを黙って
/// `None` にし、`exists()` は見つからないファイルに偽を返すので、どちらの場合も
/// 「root_dir は未設定」に落ちる。関門は未設定のとき無条件で開くので、
/// **全パスで開いたままコンパイルも `cargo test` も通る**。
/// 借りていれば、あちらの変更は型検査か定数の不在に当たる
fn load_root_dir<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, FsError> {
    let cfg_path = app
        .path()
        .app_config_dir()
        .map_err(|e| FsError::new(FsErrorCode::InvalidPath, e.to_string()))?
        // 置き場も借りる（理由は上）
        .join(crate::config_dir::CONFIG_FILE);
    if !cfg_path.exists() {
        return Ok(None);
    }
    // 失敗しているのは**設定ファイル**であって、利用者が触ったパスではない。
    // `path` を付けないと「その場所は扱えません」とだけ出て、原因が `app.json` に
    // あることも、どのファイルの話でもないことも伝わらない
    let named = |e: String| {
        FsError::new(FsErrorCode::InvalidPath, e).with_path(cfg_path.to_string_lossy().to_string())
    };
    let data = fs::read_to_string(&cfg_path).map_err(|e| named(e.to_string()))?;
    let cfg: crate::config_dir::AppConfig =
        serde_json::from_str(&data).map_err(|e| named(e.to_string()))?;
    Ok(cfg.root_dir.map(PathBuf::from))
}

/// 与えられた target が AppConfig.root_dir 配下にあるか検証する。
///
/// **存在確認より先に呼ぶ。** 後ろに置くと、root 外のパスについて
/// `is_file()` / `is_dir()` / `read_dir` の結果まで返してしまう。
/// 先に置いても、失敗には `canonicalize_for_compare` が `path` を載せるので
/// どのパスの話かは画面に残る。
///
/// **その親の存否は隠せない。** 存在しないパスは親を canonicalize して組むので、
/// root 外でも「親が在る（`invalid_path`）」と「親も無い（`not_found`）」は
/// 返る code から読める。ここは webview を信用しない前提の防壁ではないので、
/// それは範囲外とする（下記）。
///
/// **`root_dir` が未設定なら、この関門は無条件で開く。**
/// ワークスペースを選ぶ前に起きるので UI からは踏めないが、
/// webview 側から `invoke` を直に呼べばどのパスでも通る。
/// `save_config` も `root_dir` を無検証で受けるので、2回の `invoke` で
/// この関門は開けられる。ここが止めているのは UI 側の取り違えと壊れたパスであって、
/// webview を信用しない前提の防壁ではない → issue #215
pub fn validate_under_root<R: Runtime>(app: &AppHandle<R>, target: &Path) -> Result<(), FsError> {
    let Some(root) = load_root_dir(app)? else {
        return Ok(());
    };
    let canonical_root = canonicalize_for_compare(&root)?;
    let canonical_target = canonicalize_for_compare(target)?;

    if !is_under(&canonical_root, &canonical_target) {
        return Err(
            FsError::new(FsErrorCode::InvalidPath, "path is outside project root")
                .with_path(target.to_string_lossy().to_string()),
        );
    }
    Ok(())
}

/// `target` が設定上の root そのものか。
///
/// root 自身の改名だけは行き先が root の**兄弟**になるので、
/// `validate_under_root` では必ず落ちる。呼び出し側はこれで分岐する
pub fn is_project_root<R: Runtime>(app: &AppHandle<R>, target: &Path) -> Result<bool, FsError> {
    let Some(root) = load_root_dir(app)? else {
        return Ok(false);
    };
    Ok(canonicalize_for_compare(&root)? == canonicalize_for_compare(target)?)
}
