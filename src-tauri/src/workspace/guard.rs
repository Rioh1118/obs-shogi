//! パスが設定上の root の外へ出ていないかを判定する。
//!
//! パスの判定のために設定ファイルの `root_dir` を読むのはここだけ。名前とパスの判定そのものは
//! `fs::path` にあり、そちらは設定を読まない。

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

use ::fs::error::{FsError, FsErrorCode};
use ::fs::path::{canonicalize_for_compare, is_under};

/// 設定の置き場を解き、そこの設定ファイルの `root_dir` を返す。
///
/// 型とファイル名は `settings::app` から借り、写さない。
///
/// 写すと、あちらの変更がこちらに当たらない。`serde` は欠けたフィールドを黙って
/// `None` にし、`exists()` は見つからないファイルに偽を返すので、どちらの場合も
/// 「root_dir は未設定」に落ちる。この検査は未設定のとき無条件で通すので、
/// **全パスを通したままコンパイルも `cargo test` も通る**。
/// 借りていれば、あちらの変更は型検査か定数の不在に当たる
fn load_root_dir<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, FsError> {
    let cfg_path = app
        .path()
        .app_config_dir()
        .map_err(|e| FsError::new(FsErrorCode::InvalidPath, e.to_string()))?
        // 置き場も借りる（理由は上）
        .join(settings::app::CONFIG_FILE);
    read_root_dir(&cfg_path)
}

/// `cfg_path` の設定ファイルの `root_dir` を返す。
///
/// ファイルが無ければ `None` を返す。ワークスペースを選ぶ前の起動がそれに当たる。
/// 読めない、解けないときは、設定ファイルを名指しした `InvalidPath` を返す。
fn read_root_dir(cfg_path: &Path) -> Result<Option<PathBuf>, FsError> {
    if !cfg_path.exists() {
        return Ok(None);
    }
    // 失敗しているのは**設定ファイル**であって、利用者が触ったパスではない。
    // `path` を付けないと「その場所は扱えません」とだけ出て、原因が `app.json` に
    // あることも、どのファイルの話でもないことも伝わらない
    let named = |e: String| {
        FsError::new(FsErrorCode::InvalidPath, e).with_path(cfg_path.to_string_lossy().to_string())
    };
    let data = fs::read_to_string(cfg_path).map_err(|e| named(e.to_string()))?;
    let cfg: settings::app::AppConfig =
        serde_json::from_str(&data).map_err(|e| named(e.to_string()))?;
    Ok(cfg.root_dir.map(PathBuf::from))
}

/// `target` が設定上の root の下に無ければ、`InvalidPath` を返す。
///
/// 呼び手は存在確認より先に呼ぶ。後ろに置くと、root 外のパスについて
/// `is_file()` / `is_dir()` / `read_dir` の結果まで返してしまう。
/// 先に置いても、失敗には `canonicalize_for_compare` が `path` を載せるので
/// どのパスの話かは画面に残る。
///
/// その親の存否は隠せない。存在しないパスは親を canonicalize して組むので、
/// root 外でも「親が在る（`invalid_path`）」と「親も無い（`not_found`）」は
/// 返る code から読める。ここは webview を信用しない前提の防壁ではないので、
/// それは範囲外とする（下記）。
///
/// **`root_dir` が未設定なら、この検査は無条件で通す。**
/// ワークスペースを選ぶ前に起きるので UI からは踏めないが、
/// webview 側から `invoke` を直に呼べばどのパスでも通る。
/// `save_config` も `root_dir` を無検証で受けるので、2回の `invoke` で
/// この検査は無効にできる。ここが止めているのは UI 側の取り違えと壊れたパスであって、
/// webview を信用しない前提の防壁ではない。
// TODO(#215): webview を信用しない前提の検査にするなら、`save_config` の側でも root を確かめる
pub fn validate_under_root<R: Runtime>(app: &AppHandle<R>, target: &Path) -> Result<(), FsError> {
    check_under_root(load_root_dir(app)?, target)
}

/// [`validate_under_root`] の判定。`root` が `None` なら通す
fn check_under_root(root: Option<PathBuf>, target: &Path) -> Result<(), FsError> {
    let Some(root) = root else {
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
    is_root(load_root_dir(app)?, target)
}

/// [`is_project_root`] の判定。`root` が `None` なら偽
fn is_root(root: Option<PathBuf>, target: &Path) -> Result<bool, FsError> {
    let Some(root) = root else {
        return Ok(false);
    };
    Ok(canonicalize_for_compare(&root)? == canonicalize_for_compare(target)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::dir::temp_dir;

    /// 設定ファイルが無ければ root は未設定で、在れば `root_dir` を返す。
    ///
    /// 無いのを失敗にすると、ワークスペースを選ぶ前の起動でパスを受ける全コマンドが落ちる。
    #[test]
    fn the_root_comes_from_the_config_file_and_is_unset_without_one() {
        let dir = temp_dir("guard-config");
        let cfg = dir.join(settings::app::CONFIG_FILE);
        assert_eq!(read_root_dir(&cfg).expect("無いのは失敗でない"), None);

        fs::write(&cfg, r#"{"root_dir":"/ws"}"#).expect("書けない");
        assert_eq!(
            read_root_dir(&cfg).expect("読めること"),
            Some(PathBuf::from("/ws"))
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// 壊れた設定ファイルの失敗は、利用者が触ったパスでなく設定ファイルを名指しする。
    #[test]
    fn a_broken_config_names_the_config_file() {
        let dir = temp_dir("guard-broken");
        let cfg = dir.join(settings::app::CONFIG_FILE);
        fs::write(&cfg, "{").expect("書けない");

        let err = read_root_dir(&cfg).expect_err("壊れた設定を読めたことにした");
        assert!(
            matches!(err.code, FsErrorCode::InvalidPath),
            "{:?}",
            err.code
        );
        assert_eq!(err.path, Some(cfg.to_string_lossy().to_string()));

        fs::remove_dir_all(&dir).ok();
    }

    /// root の下は通し、外は断る。断るときは断ったパスを名指しする。
    /// root が未設定なら、どのパスも通す。
    #[test]
    fn only_paths_under_the_root_pass() {
        let base = temp_dir("guard-under");
        let ws = base.join("ws");
        fs::create_dir_all(&ws).expect("作れない");
        fs::create_dir_all(base.join("outside")).expect("作れない");

        check_under_root(Some(ws.clone()), &ws).expect("root 自身は通す");
        check_under_root(Some(ws.clone()), &ws.join("新規.kif")).expect("まだ無いパスも通す");

        let outside = base.join("outside").join("a.kif");
        let err = check_under_root(Some(ws.clone()), &outside).expect_err("外を通した");
        assert!(
            matches!(err.code, FsErrorCode::InvalidPath),
            "{:?}",
            err.code
        );
        assert_eq!(err.path, Some(outside.to_string_lossy().to_string()));

        check_under_root(None, &outside).expect("未設定なら通す");

        fs::remove_dir_all(&base).ok();
    }

    /// root そのものだけが root で、下のフォルダは root ではない。未設定なら何も root ではない。
    #[test]
    fn only_the_root_itself_is_the_root() {
        let ws = temp_dir("guard-root");
        fs::create_dir_all(ws.join("sub")).expect("作れない");

        assert!(is_root(Some(ws.clone()), &ws).expect("判定できる"));
        assert!(!is_root(Some(ws.clone()), &ws.join("sub")).expect("判定できる"));
        assert!(!is_root(None, &ws).expect("判定できる"));

        fs::remove_dir_all(&ws).ok();
    }
}
