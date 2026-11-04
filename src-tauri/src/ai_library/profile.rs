//! AI フォルダ（`<ai_root>/<name>/{eval,book}`）。

use serde::Serialize;
use std::{fs, path::Path};

use ::fs::error::{FsError, FsErrorCode};

use super::dir::{kind_of, FsKind};
use super::engines::ENGINES_DIR;

/// AI フォルダが持つ下位フォルダ
const PROFILE_SUBS: [&str; 2] = ["eval", "book"];

/// eval/ や book/ のファイル候補
#[derive(Debug, Clone, Serialize)]
pub struct FileCandidate {
    pub entry: String, // ファイル名
    pub path: String,  // フルパス
    pub kind: FsKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileCandidate {
    /// ai_root 直下のディレクトリ名（= profile 名）
    pub name: String,
    /// profile ディレクトリのフルパス
    pub path: String,

    pub has_eval_dir: bool,
    pub has_book_dir: bool,

    /// eval/ 配下のファイル候補（フルパス）
    pub eval_files: Vec<FileCandidate>,
    /// book/ 配下の .db ファイル候補（フルパス）
    pub book_db_files: Vec<FileCandidate>,
}

/// 一覧に出る AI フォルダか。
///
/// **一覧に出す側と作成を拒否する側で、同じ述語を使う。** 別々に書くと片方が
/// `any`、片方が `all` になり、`eval` だけを持つ AI フォルダ（YaneuraOu の
/// 普通の形）に同じ名前で「作成」を押すと、既存の中へ黙って `book` が足される
fn is_listed(dir: &Path) -> bool {
    PROFILE_SUBS.iter().any(|sub| dir.join(sub).is_dir())
}

/// 中身が1つでも入っているか。空なら「作りかけ」として作成のやり直しを通す
fn has_any_content(dir: &Path) -> bool {
    PROFILE_SUBS.iter().any(|sub| {
        fs::read_dir(dir.join(sub))
            .map(|mut it| it.next().is_some())
            .unwrap_or(false)
    })
}

/// もう作られているか。**作りかけの補完だけを通すための判定。**
///
/// どちらか一方でも欠くと穴が開く。
/// - 揃っているかだけを見る（`all`）→ `eval` だけを持つ既存の AI フォルダ
///   （YaneuraOu の普通の形。一覧にも出ている）へ黙って `book` を足して合流する
/// - 中身だけを見る → アプリで作った直後の空の AI フォルダに同じ名前を打つと
///   何も起きずに成功が返り、「作成は通ったのに一覧が変わらない」になる
pub fn already_made(profile: &Path) -> bool {
    let complete = PROFILE_SUBS.iter().all(|sub| profile.join(sub).is_dir());
    complete || (is_listed(profile) && has_any_content(profile))
}

/// 下位フォルダを作る。
pub fn create_dirs(profile: &Path) -> Result<(), FsError> {
    for sub in PROFILE_SUBS {
        let dir = profile.join(sub);

        // 同名のファイルがあると `create_dir_all` は EEXIST で落ちる。
        // 名前を変える以外に直しようが無いので、名前の失敗として返す
        if dir.exists() && !dir.is_dir() {
            return Err(FsError::new(
                FsErrorCode::InvalidType,
                "a file blocks the profile directory",
            )
            .with_path(dir.to_string_lossy().to_string()));
        }

        fs::create_dir_all(&dir)
            .map_err(|e| FsError::from(e).with_path(dir.to_string_lossy().to_string()))?;
    }
    Ok(())
}

pub fn read_all(ai_root: &Path) -> Result<Vec<ProfileCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(ai_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        // **ここは綴りで比べない。** 除く側は破壊的なので、作成を断る側
        // （`eq_ignore_ascii_case`）と対称にしてはいけない。case-sensitive な
        // ファイルシステム（Linux、case-sensitive APFS）では `engines` と
        // `Engines` は別の実体として共存でき、後者は正当な AI フォルダ。
        // 綴りで除くと、どちらの一覧にも出ないフォルダができる
        if name.is_empty() || name == ENGINES_DIR {
            continue;
        }

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        if !is_listed(&path) {
            continue;
        }

        let eval_dir = path.join("eval");
        let book_dir = path.join("book");
        let has_eval_dir = eval_dir.is_dir();
        let has_book_dir = book_dir.is_dir();

        let eval_files = if has_eval_dir {
            list_file_candidates(&eval_dir, None, 200)
        } else {
            vec![]
        };

        let book_db_files = if has_book_dir {
            list_file_candidates(&book_dir, Some("db"), 200)
        } else {
            vec![]
        };

        out.push(ProfileCandidate {
            name,
            path: path.to_string_lossy().to_string(),
            has_eval_dir,
            has_book_dir,
            eval_files,
            book_db_files,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// dir 内のファイル候補を列挙（フルパス）。
/// ext_filter: Some("db") なら拡張子 db のみ
fn list_file_candidates(dir: &Path, ext_filter: Option<&str>, max: usize) -> Vec<FileCandidate> {
    let mut out: Vec<FileCandidate> = vec![];

    let it = match fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => return out,
    };

    for entry in it.take(max) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let kind = kind_of(&path);

        match kind {
            FsKind::File | FsKind::Symlink => {}
            _ => continue,
        }

        if let Some(ext) = ext_filter {
            let ok = path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case(ext))
                .unwrap_or(false);
            if !ok {
                continue;
            }
        }

        let entry_name = entry.file_name().to_string_lossy().to_string();

        out.push(FileCandidate {
            entry: entry_name,
            path: path.to_string_lossy().to_string(),
            kind,
        });
    }

    out.sort_by(|a, b| a.entry.cmp(&b.entry));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::dir::temp_dir;

    fn names(root: &Path) -> Vec<String> {
        read_all(root)
            .expect("読める")
            .into_iter()
            .map(|p| p.name)
            .collect()
    }

    /// `eval` か `book` を持つフォルダだけを一覧に出す。engines/ は持っていても出さない。
    /// 並びは綴りのバイト順で、大文字が先に来る（`read_dir` の順に任せない）
    #[test]
    fn only_folders_with_eval_or_book_are_listed() {
        let root = temp_dir("ai-profile-listed");
        fs::create_dir_all(root.join("b-eval/eval")).expect("作れない");
        fs::create_dir_all(root.join("a-book/book")).expect("作れない");
        fs::create_dir_all(root.join("Z-both/eval")).expect("作れない");
        fs::create_dir_all(root.join("plain")).expect("作れない");
        fs::create_dir_all(root.join(ENGINES_DIR).join("eval")).expect("作れない");

        assert_eq!(names(&root), ["Z-both", "a-book", "b-eval"]);
        let _ = fs::remove_dir_all(&root);
    }

    /// 除くのは綴りが `engines` のものだけ。`Engines` は正当な AI フォルダの名前
    #[test]
    fn a_differently_cased_engines_folder_is_still_listed() {
        let root = temp_dir("ai-profile-cased");
        fs::create_dir_all(root.join("Engines/eval")).expect("作れない");

        assert_eq!(names(&root), ["Engines"]);
        let _ = fs::remove_dir_all(&root);
    }

    /// 持っている下位フォルダを欄に写す。片方だけのフォルダで、無い方を在ると言わない
    #[test]
    fn each_subfolder_is_reported_on_its_own() {
        let root = temp_dir("ai-profile-subs");
        fs::create_dir_all(root.join("eval-only/eval")).expect("作れない");
        fs::create_dir_all(root.join("book-only/book")).expect("作れない");

        let found = read_all(&root).expect("読める");

        let book_only = &found[0];
        assert_eq!(book_only.name, "book-only");
        assert!(!book_only.has_eval_dir && book_only.has_book_dir);
        let eval_only = &found[1];
        assert!(eval_only.has_eval_dir && !eval_only.has_book_dir);
        let _ = fs::remove_dir_all(&root);
    }

    /// eval/ はファイルを全部、book/ は拡張子が `db` のもの（大文字も）だけを返す。フォルダは返さない
    #[test]
    fn files_are_listed_and_books_are_filtered_by_extension() {
        let root = temp_dir("ai-profile-files");
        let profile = root.join("suisho");
        fs::create_dir_all(profile.join("eval/nested")).expect("作れない");
        fs::create_dir_all(profile.join("book")).expect("作れない");
        for file in [
            "eval/nn.bin",
            "eval/README.txt",
            "book/a.db",
            "book/B.DB",
            "book/c.txt",
        ] {
            fs::write(profile.join(file), "").expect("書けない");
        }

        let found = read_all(&root).expect("読める");

        let eval: Vec<_> = found[0]
            .eval_files
            .iter()
            .map(|f| f.entry.as_str())
            .collect();
        assert_eq!(eval, ["README.txt", "nn.bin"]);
        let books: Vec<_> = found[0]
            .book_db_files
            .iter()
            .map(|f| f.entry.as_str())
            .collect();
        assert_eq!(books, ["B.DB", "a.db"]);
        let _ = fs::remove_dir_all(&root);
    }
}
