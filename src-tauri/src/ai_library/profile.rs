//! AI フォルダ（`<ai_root>/<name>/{eval,book}`）。

use serde::Serialize;
use std::{fs, path::Path};

use ::fs::error::{FsError, FsErrorCode};

use super::dir::{kind_of, FsKind};
use super::engines::ENGINES_DIR;

const EVAL_DIR: &str = "eval";
const BOOK_DIR: &str = "book";

/// AI フォルダが持つ下位フォルダ
const PROFILE_SUBS: [&str; 2] = [EVAL_DIR, BOOK_DIR];

/// やねうら王が `isready` で `EvalDir` の中から読み、送ったオプションを上書きするファイル
/// （`research/engines/yaneuraou-files.md`）。評価関数ではないので候補に出さない
const EVAL_OPTIONS_FILE: &str = "eval_options.txt";

/// `eval_options.txt` を読む上限（バイト）。数行のファイルなので、超えるものは別物として読まない
const MAX_EVAL_OPTIONS_BYTES: u64 = 64 * 1024;

/// eval/ と book/ の1つから読む項目の上限。数え方は `list_file_candidates`
const MAX_FILES_PER_DIR: usize = 200;

/// eval/ や book/ の直下にある、選べるファイル1つ
#[derive(Debug, Clone, Serialize)]
pub struct FileCandidate {
    /// ファイル名
    pub entry: String,
    pub path: String,
    /// `File` か `Symlink`。symlink は指す先を確かめずに候補にする
    pub kind: FsKind,
}

/// `eval_options.txt` の1行（`<名前> <値>`）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalOption {
    pub name: String,
    pub value: String,
}

/// 一覧に出る AI フォルダ1つ。`eval` と `book` の少なくとも一方を持つ
#[derive(Debug, Clone, Serialize)]
pub struct ProfileCandidate {
    /// AI ルート直下のフォルダ名
    pub name: String,
    pub path: String,

    pub has_eval_dir: bool,
    pub has_book_dir: bool,

    /// eval/ の直下のファイル。`eval_options.txt` は除く
    pub eval_files: Vec<FileCandidate>,
    /// eval/ の `eval_options.txt` に書かれたオプション。ファイルが無い・読めなければ空。
    /// エンジンはこれで送った値を上書きするので、画面はこの名前の欄を固定する
    pub eval_options: Vec<EvalOption>,
    /// `eval_options.txt` が eval/ に無く、AI フォルダの直下にある。エンジンは読まない
    pub eval_options_outside_eval: bool,
    /// book/ の直下の、拡張子が `db` のファイル（大文字小文字を問わない）
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

/// `eval` と `book` を作る。在るものはそのまま残す。
///
/// 同じ名前のファイルが邪魔していれば `InvalidType` で返す
pub fn create_dirs(profile: &Path) -> Result<(), FsError> {
    for sub in PROFILE_SUBS {
        let dir = profile.join(sub);

        // 同名のファイルがあると `create_dir_all` は EEXIST で落ち、`already_exists` に写る。
        // AI フォルダがもう在るように読めるので、邪魔しているファイルのパスを付けて先に断る
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

/// AI ルートの直下から、一覧に出る AI フォルダを名前の順に返す。
///
/// `Err` になるのは AI ルートを開けないときと、中の1件を読めないとき
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

        let eval_dir = path.join(EVAL_DIR);
        let book_dir = path.join(BOOK_DIR);
        let has_eval_dir = eval_dir.is_dir();
        let has_book_dir = book_dir.is_dir();

        let eval_files = if has_eval_dir {
            list_file_candidates(&eval_dir, None, MAX_FILES_PER_DIR)
                .into_iter()
                .filter(|f| !f.entry.eq_ignore_ascii_case(EVAL_OPTIONS_FILE))
                .collect()
        } else {
            vec![]
        };
        let eval_options_inside = eval_dir.join(EVAL_OPTIONS_FILE);
        let eval_options = read_eval_options(&eval_options_inside);
        let eval_options_outside_eval =
            !eval_options_inside.is_file() && path.join(EVAL_OPTIONS_FILE).is_file();

        let book_db_files = if has_book_dir {
            list_file_candidates(&book_dir, Some("db"), MAX_FILES_PER_DIR)
        } else {
            vec![]
        };

        out.push(ProfileCandidate {
            name,
            path: path.to_string_lossy().to_string(),
            has_eval_dir,
            has_book_dir,
            eval_files,
            eval_options,
            eval_options_outside_eval,
            book_db_files,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// `eval_options.txt` を読む。無い・読めない・大きすぎるときは空。
///
/// 1行が `<名前> <値>`。値の前後の空白と CR（配布物は CRLF）は落とす。値の無い行、
/// `#` か `//` で始まる行は飛ばす（そういう名前のオプションは無いので、エンジンが読んでも何も変わらない）
fn read_eval_options(path: &Path) -> Vec<EvalOption> {
    let Ok(meta) = fs::metadata(path) else {
        return vec![];
    };
    if !meta.is_file() || meta.len() > MAX_EVAL_OPTIONS_BYTES {
        return vec![];
    }
    let Ok(bytes) = fs::read(path) else {
        return vec![];
    };
    parse_eval_options(&String::from_utf8_lossy(&bytes))
}

fn parse_eval_options(text: &str) -> Vec<EvalOption> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.starts_with('#') && !line.starts_with("//"))
        .filter_map(|line| {
            let (name, value) = line.split_once(char::is_whitespace)?;
            let value = value.trim();
            (!value.is_empty()).then(|| EvalOption {
                name: name.to_string(),
                value: value.to_string(),
            })
        })
        .collect()
}

/// `dir` の直下のファイルと symlink を名前の順に返す。`ext_filter` があれば、その拡張子だけ。
///
/// 見るのは `read_dir` が返す先頭の `max` 件で、絞り込みより前に数える。
/// 多いフォルダでは、どれが入るかは `read_dir` の順で決まる
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

    /// `eval/eval_options.txt` は読んで、評価関数の候補からは外す
    #[test]
    fn eval_options_in_eval_are_read_and_not_offered_as_an_eval() {
        let root = temp_dir("ai-profile-eval-options");
        let profile = root.join("tuyoura");
        fs::create_dir_all(profile.join("eval")).expect("作れない");
        fs::write(profile.join("eval/nn.bin"), "").expect("書けない");
        fs::write(
            profile.join("eval/eval_options.txt"),
            "FV_SCALE 24\r\n# memo\r\n\r\nNoValue\r\nBookFile  user_book1.db \r\n",
        )
        .expect("書けない");

        let found = read_all(&root).expect("読める");

        let eval: Vec<_> = found[0]
            .eval_files
            .iter()
            .map(|f| f.entry.as_str())
            .collect();
        assert_eq!(eval, ["nn.bin"]);
        assert_eq!(
            found[0].eval_options,
            [
                EvalOption {
                    name: "FV_SCALE".to_string(),
                    value: "24".to_string()
                },
                EvalOption {
                    name: "BookFile".to_string(),
                    value: "user_book1.db".to_string()
                },
            ]
        );
        assert!(!found[0].eval_options_outside_eval);
        let _ = fs::remove_dir_all(&root);
    }

    /// AI フォルダの直下にだけある `eval_options.txt` はエンジンが読まない。読まずに、外にあると返す
    #[test]
    fn eval_options_outside_eval_are_reported_and_not_read() {
        let root = temp_dir("ai-profile-eval-options-outside");
        let profile = root.join("tuyoura");
        fs::create_dir_all(profile.join("eval")).expect("作れない");
        fs::write(profile.join("eval_options.txt"), "FV_SCALE 24\n").expect("書けない");

        let found = read_all(&root).expect("読める");
        assert!(found[0].eval_options.is_empty());
        assert!(found[0].eval_options_outside_eval);

        // 両方にあれば、エンジンは eval/ の方を読むので言わない
        fs::write(profile.join("eval/eval_options.txt"), "FV_SCALE 40\n").expect("書けない");
        let found = read_all(&root).expect("読める");
        assert!(!found[0].eval_options_outside_eval);
        assert_eq!(found[0].eval_options[0].value, "40");
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
