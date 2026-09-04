//! AI の置き場を読む・作るコマンドの入口。
//!
//! **root の関門は掛からない。** `ai_root` はワークスペースの外にあるので、
//! ここで作るものの名前は `fs::path::validate_basename` で自分で弾く。

use std::path::PathBuf;
use tauri::command;

use crate::fs::error::{FsError, FsErrorCode};
use crate::fs::path::validate_basename;

use super::dir::validate_dir;
use super::engines::ENGINES_DIR;
use super::scan::AiRootIndex;
use super::{engines, profile, scan};

#[command]
pub fn scan_ai_root(ai_root: String) -> Result<AiRootIndex, String> {
    validate_dir("ai_root", &ai_root)?;
    scan::index(ai_root)
}

/// AI プロファイル（`<ai_root>/<name>/{eval,book}`）を作る。
///
/// **`create_directory` は使えない。** あちらはワークスペース配下かの関門を通るが、
/// `ai_root` は利用者が別に選ぶ場所で、ワークスペースの外にある。
/// 関門つきのコマンドで作ろうとすると、ワークスペースを設定済みの利用者は
/// 必ず `invalid_path`（「その場所は扱えません」）で弾かれる
#[command]
pub fn create_ai_profile_dirs(ai_root: String, name: String) -> Result<String, FsError> {
    // **`FsError` で返す。** `String` にすると code が落ちるので、受け側は
    // 「名前を直せば通る失敗」と「AI ルートが無い」を区別できない。
    // 区別できないと、名前と無関係な失敗まで名前の欄の下に出る
    validate_dir("ai_root", &ai_root)
        .map_err(|message| FsError::new(FsErrorCode::InvalidPath, message).with_path(&ai_root))?;

    // **名前の規則は写さない。** ここで書き直すと、`.` と `..` のような
    // 1つの規則を落としたときに `ai_root` の外へ作れてしまう
    // （`join("..")` は親へ抜ける。`create_dir_all` は途中の段も黙って作る）。
    let trimmed = validate_basename(&name)?;

    // **作成を断る側は大文字小文字を無視する。** macOS の既定（APFS）は
    // case-insensitive なので、`Engines` は Rust の `==` では別物でも
    // ファイルシステムでは `engines` と同じ実体。通すと `eval` / `book` が
    // **エンジンの置き場の中に**作られ、しかも `profile::read_all` は実際の名前
    // （`engines`）を読んで除外するので、一覧には出ない。
    //
    // 除く側（`profile::read_all`）は逆に綴りで比べる。理由はあちらに書いてある
    if trimmed.eq_ignore_ascii_case(ENGINES_DIR) {
        return Err(FsError::new(
            FsErrorCode::InvalidNameReserved,
            format!("{ENGINES_DIR} is reserved for engine binaries"),
        ));
    }

    let path = PathBuf::from(&ai_root).join(&trimmed);

    // 通すのは**作りかけの補完だけ**。何を作りかけと見るかは `already_made`
    if profile::already_made(&path) {
        return Err(
            FsError::new(FsErrorCode::AlreadyExists, "profile already exists")
                .with_path(path.to_string_lossy().to_string()),
        );
    }

    profile::create_dirs(&path)?;
    Ok(path.to_string_lossy().to_string())
}

#[command]
pub fn ensure_engines_dir(ai_root: String) -> Result<String, String> {
    validate_dir("ai_root", &ai_root)?;
    let dir = engines::ensure(&PathBuf::from(&ai_root))?;
    Ok(dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("obs-shogi-ai-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("作れない");
        dir
    }

    /// `ai_root` と、その**親**を返す。
    ///
    /// 親を分けないと `ai_root/../eval` が `$TMPDIR/eval` になる。そこは共有なので、
    /// 検出したい退行が一度入ると `$TMPDIR/eval` が残り、直したあとも
    /// このテストは落ち続ける（開発者は assert を消す方へ行く）
    fn temp_ai_root(tag: &str) -> (PathBuf, PathBuf) {
        let base = temp_root(tag);
        let root = base.join("ai");
        fs::create_dir_all(&root).expect("作れない");
        (base, root)
    }

    fn create(root: &Path, name: &str) -> Result<String, FsError> {
        create_ai_profile_dirs(root.to_string_lossy().to_string(), name.to_string())
    }

    /// `..` を通すと `ai_root` の外へ作れる。名前の規則を写さず
    /// `validate_basename` を呼んでいることを、実際の入力で固定する
    #[test]
    fn a_profile_name_cannot_climb_out_of_the_ai_root() {
        let (base, root) = temp_ai_root("climb");

        assert!(create(&root, "..").is_err(), "`..` を通している");
        assert!(create(&root, "a/b").is_err(), "区切りを通している");
        assert!(!base.join("eval").exists(), "ai_root の外に作っている");

        let _ = fs::remove_dir_all(&base);
    }

    /// 文言でなく code を返す。TS 側は code で「名前の欄に出すか」を決めるので、
    /// `String` に潰すと名前と無関係な失敗まで名前の欄の下に出る
    #[test]
    fn a_rejected_name_carries_a_code() {
        let (base, root) = temp_ai_root("wording");

        let error = create(&root, "a/b").expect_err("通している");
        assert!(
            matches!(error.code, FsErrorCode::InvalidNameSeparator),
            "名前の失敗として返していない: {:?}",
            error.code
        );

        // AI ルートが無いのは名前の失敗ではない。同じ箱に混ぜない
        let gone = create(Path::new("/nope/missing"), "suisho").expect_err("通している");
        assert!(
            matches!(gone.code, FsErrorCode::InvalidPath),
            "AI ルートの失敗を名前の失敗にしている: {:?}",
            gone.code
        );

        let _ = fs::remove_dir_all(&base);
    }

    /// `profile::read_all` が一覧から除く名前。作れても出てこないので、
    /// 利用者からは作成の失敗と区別が付かない
    #[test]
    fn the_engines_directory_is_not_a_profile_name() {
        let (base, root) = temp_ai_root("engines");

        // 大文字小文字も。macOS の既定（APFS）では同じ実体を指す
        for name in [ENGINES_DIR, "Engines", "ENGINES"] {
            assert!(create(&root, name).is_err(), "{name} を通している");
        }
        assert!(!root.join(ENGINES_DIR).exists(), "engines を作っている");

        let _ = fs::remove_dir_all(&base);
    }

    /// `create_dir_all` は既存のフォルダでも `Ok` を返す。素通しにすると
    /// 別の AI の `eval` / `book` へ黙って合流する
    #[test]
    fn an_existing_profile_name_is_rejected_instead_of_merged() {
        let (base, root) = temp_ai_root("dup");

        assert!(create(&root, "suisho").is_ok(), "1つ目を作れない");
        assert!(create(&root, "suisho").is_err(), "同じ名前で通している");

        let _ = fs::remove_dir_all(&base);
    }

    /// 途中で落ちた作成のやり直しを塞がない。`profile` の有無だけを見ると、
    /// `eval` だけ残った状態と、Finder で名前だけ作った状態が永久に直せなくなる
    /// （画面の警告は「`<AI名>/eval` に nn.bin 等」と作成を促してくる）
    #[test]
    fn a_half_made_profile_can_be_completed() {
        let (base, root) = temp_ai_root("half");
        fs::create_dir_all(root.join("suisho/eval")).expect("作れない");

        assert!(create(&root, "suisho").is_ok(), "作りかけを直せない");
        assert!(root.join("suisho/book").is_dir(), "book を補っていない");

        let _ = fs::remove_dir_all(&base);
    }

    /// `eval` だけを持つプロファイルは YaneuraOu の普通の形で、一覧にも出ている。
    /// 「両方あるときだけ拒否」にすると、そこへ同じ名前で `book` を足して
    /// **既存の AI へ黙って合流する**
    #[test]
    fn an_eval_only_profile_is_not_merged_into() {
        let (base, root) = temp_ai_root("evalonly");
        fs::create_dir_all(root.join("suisho/eval")).expect("作れない");
        fs::write(root.join("suisho/eval/nn.bin"), "").expect("書けない");

        assert!(create(&root, "suisho").is_err(), "既存へ合流している");
        assert!(!root.join("suisho/book").is_dir(), "book を足している");

        let _ = fs::remove_dir_all(&base);
    }

    /// `create_dir_all` は同名のファイルがあると EEXIST で落ちる。OS の失敗を
    /// そのまま返すと `io` になり、利用者には「読み書きに失敗しました」としか出ない
    #[test]
    fn a_blocking_file_is_named_as_such() {
        let (base, root) = temp_ai_root("blocked");
        fs::create_dir_all(root.join("suisho")).expect("作れない");
        fs::write(root.join("suisho/eval"), "").expect("書けない");

        let error = create(&root, "suisho").expect_err("通している");
        assert!(
            matches!(error.code, FsErrorCode::InvalidType),
            "邪魔しているものを名指しできていない: {:?}",
            error.code
        );

        let _ = fs::remove_dir_all(&base);
    }
}
