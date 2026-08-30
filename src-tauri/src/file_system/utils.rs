use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

use crate::file_system::error::{FsError, FsErrorCode};

pub fn generate_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn get_file_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase())
}

pub fn is_kifu_file(path: &Path) -> bool {
    matches!(
        get_file_extension(path).as_deref(),
        Some("kif") | Some("ki2") | Some("jkf") | Some("csa")
    )
}

/// 名前として使えるかを見て、**実際に使う形（前後の空白を落としたもの）を返す**。
///
/// 検証した文字列と、そのあとパスを組む文字列は同じものでなければならない。
/// 生の名前でパスを組むと、`"a "` のように検証は通るが OS 側で別の名前になる
/// （Windows は末尾の空白と `.` を落とす）ものが素通りする。
///
/// `message` は開発者向けのログ。利用者に見せる文は code から引く
pub fn validate_basename(name: &str) -> Result<String, FsError> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(FsError::new(FsErrorCode::InvalidNameEmpty, "name is empty"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(FsError::new(
            FsErrorCode::InvalidNameReserved,
            "name is a reserved path segment",
        ));
    }
    // **成分がちょうど1つかを `Path` に判定させる。** 区切り文字を列挙すると、
    // プラットフォームの規則をここへ写すことになる。Windows の `C:x` は `\\` を
    // 含まないが prefix を持つので、`parent.join("C:x")` は `parent` を捨てて
    // `C:x`（ドライブ相対パス）になる。列挙で弾いていると、
    // 「行き先は `parent.join(name)` なので親の外へ出ない」が成り立たない
    let mut components = Path::new(trimmed).components();
    if !matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    ) {
        return Err(FsError::new(
            FsErrorCode::InvalidNameSeparator,
            "name is not a single path component",
        ));
    }

    // 区切り文字も明示的に弾く。`\` は Unix では区切りでないので上の判定を通るが、
    // その名前のフォルダを Windows で開くと区切りとして解釈される
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(FsError::new(
            FsErrorCode::InvalidNameSeparator,
            "name contains a path separator",
        ));
    }
    // null byte は OS によっては別のパスに化けるので拒否
    if trimmed.contains('\0') {
        return Err(FsError::new(
            FsErrorCode::InvalidNameControl,
            "name contains a NUL byte",
        ));
    }
    Ok(trimmed.to_string())
}

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

/// `target` が `root` と同じか、その配下にあるか。
///
/// 両方 canonicalize 済みであることを前提にする。`Path::starts_with` は
/// 成分単位で見るので `/root2` は `/root` 配下と判定されない
pub fn is_under(root: &Path, target: &Path) -> bool {
    target.starts_with(root)
}

/// 存在しないパスでも判定できる形にして返す。
///
/// **ENOENT を `not_found` のまま通し、必ず `path` を載せる。**
/// `invalid_path` に丸めると、画面には「その場所は扱えません」とだけ出て
/// どのフォルダの話か分からず、tier が `danger` なので「再読み込み」の導線も消える
/// （ワークスペースを Finder で消したときに一番よく踏む）
fn canonicalize_for_guard(target: &Path) -> Result<PathBuf, FsError> {
    let attach =
        |e: std::io::Error| FsError::from(e).with_path(target.to_string_lossy().to_string());

    if target.exists() {
        return fs::canonicalize(target).map_err(attach);
    }
    let parent = target.parent().ok_or_else(|| {
        FsError::new(FsErrorCode::InvalidPath, "no parent")
            .with_path(target.to_string_lossy().to_string())
    })?;
    let name = target.file_name().ok_or_else(|| {
        FsError::new(FsErrorCode::InvalidPath, "no filename")
            .with_path(target.to_string_lossy().to_string())
    })?;
    Ok(fs::canonicalize(parent).map_err(attach)?.join(name))
}

/// 与えられた target が AppConfig.root_dir 配下にあるか検証する。
///
/// **存在確認より先に呼ぶ。** 後ろに置くと、root 外のパスについて
/// `is_file()` / `is_dir()` / `read_dir` の結果まで返してしまう。
/// 先に置いても、失敗には `canonicalize_for_guard` が `path` を載せるので
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
    let canonical_root = canonicalize_for_guard(&root)?;
    let canonical_target = canonicalize_for_guard(target)?;

    if !is_under(&canonical_root, &canonical_target) {
        return Err(
            FsError::new(FsErrorCode::InvalidPath, "path is outside project root")
                .with_path(target.to_string_lossy().to_string()),
        );
    }
    Ok(())
}

/// `dest` が `src` 自身か、その配下か。
///
/// ディレクトリを自分の中へ動かすのは `fs::rename` が `EINVAL` で落とす。
/// そのまま返すと `io` に丸まり、tier が `warning` なので「再読み込み」が出る。
/// 何度読み直しても同じなので、押しても直らない導線を出すことになる。
///
/// **字面で比べない。** `ws/current -> ws/2026` を行き先に選ぶと、
/// `starts_with` は偽になるのに `rename` は EINVAL で落ちる。ツリーは
/// root の中で閉じた symlink を普通のフォルダとして出すので、そこへ
/// ドロップするのは踏める操作
pub fn is_move_into_itself(src: &Path, dest: &Path) -> Result<bool, FsError> {
    Ok(is_under(
        &canonicalize_for_guard(src)?,
        &canonicalize_for_guard(dest)?,
    ))
}

/// `target` が設定上の root そのものか。
///
/// root 自身の改名だけは行き先が root の**兄弟**になるので、
/// `validate_under_root` では必ず落ちる。呼び出し側はこれで分岐する
pub fn is_project_root<R: Runtime>(app: &AppHandle<R>, target: &Path) -> Result<bool, FsError> {
    let Some(root) = load_root_dir(app)? else {
        return Ok(false);
    };
    Ok(canonicalize_for_guard(&root)? == canonicalize_for_guard(target)?)
}

/// テンポラリファイル経由の atomic write
/// 既存ファイルの上書きが途中で壊れないように、tmp に書いてから rename する
pub fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let tmp = match path.extension() {
        Some(ext) => {
            let mut new_ext = ext.to_os_string();
            new_ext.push(".tmp");
            path.with_extension(new_ext)
        }
        None => path.with_extension("tmp"),
    };
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        f.write_all(data)?;
        f.flush()?;
    }
    match fs::rename(&tmp, path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

// TODO(#215): dest が src と同じ実体かを見ていない。APFS では大文字小文字だけを
// 変える改名が、自分自身を衝突相手として弾かれる
pub fn ensure_not_exists(path: &Path) -> Result<(), FsError> {
    if path.exists() {
        return Err(
            FsError::new(FsErrorCode::AlreadyExists, "destination already exists")
                .with_existing_path(path.to_string_lossy().to_string()),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_the_name_that_will_be_used() {
        // 前後の空白を落とした形を返す。呼び出し元はこれでパスを組む。
        // 生の名前で組むと、Windows が末尾の空白と `.` を落とすため、
        // 検証した文字列と実際にできるファイルが別のものになる
        assert_eq!(validate_basename("  研究.kif  ").unwrap(), "研究.kif");
    }

    #[test]
    fn rejects_names_that_are_not_a_single_segment() {
        for name in ["", "   ", ".", "..", "a/b", "a\\b", "a\0b"] {
            assert!(
                validate_basename(name).is_err(),
                "{name:?} を通してはいけない"
            );
        }
    }

    /// 名前の前方一致で見ると `/root2` が `/root` 配下になる。
    /// `Path::starts_with` は成分単位なのでそうならない、を固定する
    #[test]
    fn treats_the_root_as_a_boundary_of_path_segments() {
        let root = Path::new("/root");

        assert!(is_under(root, Path::new("/root")));
        assert!(is_under(root, Path::new("/root/a/b.kif")));
        assert!(!is_under(root, Path::new("/root2/a.kif")));
        assert!(!is_under(root, Path::new("/etc/passwd")));
        assert!(!is_under(root, Path::new("/")));
    }

    /// ディレクトリを自分の中へ動かす形。`/root/a` と `/root/ab` を
    /// 取り違えないことも一緒に固定する。
    ///
    /// 判定そのものは `is_under` で、`is_move_into_itself` はその手前で
    /// 両側を canonicalize する（symlink を挟んだ行き先を字面で見逃さないため）。
    /// 実体を作らずに済むのは `is_under` の側なので、ここはそちらを見る
    #[test]
    fn rejects_moving_a_directory_into_itself() {
        let src = Path::new("/root/a");

        assert!(is_under(src, Path::new("/root/a")));
        assert!(is_under(src, Path::new("/root/a/b/a")));
        assert!(!is_under(src, Path::new("/root/ab/a")));
        assert!(!is_under(src, Path::new("/root/b/a")));
    }

    /// symlink を挟んだ行き先。字面の `starts_with` では見逃す
    #[test]
    fn resolves_symlinks_before_deciding_a_move_into_itself() {
        let tmp = std::env::temp_dir().join(format!("obs-shogi-mv-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("a/b")).expect("作れない");

        #[cfg(unix)]
        std::os::unix::fs::symlink(tmp.join("a"), tmp.join("link")).expect("張れない");
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(tmp.join("a"), tmp.join("link")).expect("張れない");

        // `a` を `link/x`（＝`a/x`）へ動かすのは自分の中への移動
        let src = tmp.join("a");
        let dest = tmp.join("link").join("x");
        assert!(!is_under(&src, &dest), "字面では見逃す形であること");
        assert!(is_move_into_itself(&src, &dest).expect("判定できない"));

        let outside = tmp.join("c");
        assert!(!is_move_into_itself(&src, &outside).expect("判定できない"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn reports_why_it_was_rejected() {
        use crate::file_system::error::FsErrorCode;

        let code = |name: &str| format!("{:?}", validate_basename(name).unwrap_err().code);
        assert_eq!(code(""), format!("{:?}", FsErrorCode::InvalidNameEmpty));
        assert_eq!(
            code(".."),
            format!("{:?}", FsErrorCode::InvalidNameReserved)
        );
        assert_eq!(
            code("a/b"),
            format!("{:?}", FsErrorCode::InvalidNameSeparator)
        );
        assert_eq!(
            code("a\0b"),
            format!("{:?}", FsErrorCode::InvalidNameControl)
        );
    }
}
