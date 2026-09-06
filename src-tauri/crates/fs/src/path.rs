//! 名前とパスが使える形か。
//!
//! **どれも「どこが作業場所か」を知らずに答えられるものだけ。**
//! root の中かどうかは設定を読まないと決まらないので、そちらは上のスライスが持つ。

use std::fs;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

use crate::error::{FsError, FsErrorCode};

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

/// `target` が `root` と同じか、その配下にあるか。
///
/// 両方 canonicalize 済みであることを前提にする。`Path::starts_with` は
/// 成分単位で見るので `/root2` は `/root` 配下と判定されない
pub fn is_under(root: &Path, target: &Path) -> bool {
    target.starts_with(root)
}

/// 存在しないパスでも比べられる形にして返す。
///
/// **ENOENT を `not_found` のまま通し、必ず `path` を載せる。**
/// `invalid_path` に丸めると、画面には「その場所は扱えません」とだけ出て
/// どのフォルダの話か分からず、tier が `danger` なので「再読み込み」の導線も消える
/// （ワークスペースを Finder で消したときに一番よく踏む）
pub fn canonicalize_for_compare(target: &Path) -> Result<PathBuf, FsError> {
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
        &canonicalize_for_compare(src)?,
        &canonicalize_for_compare(dest)?,
    ))
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
