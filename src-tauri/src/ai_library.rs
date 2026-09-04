use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::command;

use crate::fs::error::{FsError, FsErrorCode};

use crate::fs::path::validate_basename;

/// エンジンの置き場。**AI のプロファイル名として使えない。**
///
/// `read_profiles` がこの名前を一覧から除くので、作れても出てこない。
/// 除く側と弾く側で綴りが分かれると、作成は通るのに一覧に出ないフォルダができる
const ENGINES_DIR: &str = "engines";

/// AI プロファイルが持つ下位フォルダ
const PROFILE_SUBS: [&str; 2] = ["eval", "book"];

/// 一覧に出るプロファイルか。
///
/// **一覧に出す側と作成を拒否する側で、同じ述語を使う。** 別々に書くと片方が
/// `any`、片方が `all` になり、`eval` だけを持つプロファイル（YaneuraOu の
/// 普通の形）に同じ名前で「作成」を押すと、既存の中へ黙って `book` が足される
fn is_listed_profile(dir: &Path) -> bool {
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsKind {
    File,
    Dir,
    Symlink,
    Unknown,
}

fn validate_dir(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    let p = Path::new(value);
    if !p.exists() {
        return Err(format!("{label} does not exist: {value}"));
    }
    if !p.is_dir() {
        return Err(format!("{label} is not a directory: {value}"));
    }
    Ok(())
}

fn kind_of(path: &Path) -> FsKind {
    match fs::symlink_metadata(path) {
        Ok(md) => {
            let ft = md.file_type();
            if ft.is_symlink() {
                FsKind::Symlink
            } else if ft.is_dir() {
                FsKind::Dir
            } else if ft.is_file() {
                FsKind::File
            } else {
                FsKind::Unknown
            }
        }
        Err(_) => FsKind::Unknown,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AiRootIndex {
    pub ai_root: String,

    pub engines_dir: DirInfo,
    pub engines: Vec<EngineCandidate>,

    pub profiles: Vec<ProfileCandidate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirInfo {
    pub path: String,
    pub exists: bool,
    pub kind: FsKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineCandidate {
    /// engines/ 以下のエントリ名（ファイル名）
    pub entry: String,
    /// フルパス
    pub path: String,
    pub kind: FsKind,
}

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

#[command]
pub fn scan_ai_root(ai_root: String) -> Result<AiRootIndex, String> {
    validate_dir("ai_root", &ai_root)?;
    let root = PathBuf::from(&ai_root);

    let engines_dir_path = root.join(ENGINES_DIR);
    let engines_dir_exists = engines_dir_path.exists();
    let engines_dir_kind = if engines_dir_exists {
        kind_of(&engines_dir_path)
    } else {
        FsKind::Unknown
    };

    let engines = if engines_dir_exists && engines_dir_path.is_dir() {
        read_engines(&engines_dir_path)?
    } else {
        vec![]
    };

    let profiles = read_profiles(&root)?;

    Ok(AiRootIndex {
        ai_root,
        engines_dir: DirInfo {
            path: engines_dir_path.to_string_lossy().to_string(),
            exists: engines_dir_exists,
            kind: engines_dir_kind,
        },
        engines,
        profiles,
    })
}

/// engines/ 以下を列挙。YaneuraOu* のみに絞る。
fn read_engines(engines_dir: &Path) -> Result<Vec<EngineCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(engines_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.is_empty() {
            continue;
        }

        if !file_name.starts_with("YaneuraOu") {
            continue;
        }

        let path = entry.path();
        let kind = kind_of(&path);

        out.push(EngineCandidate {
            entry: file_name,
            path: path.to_string_lossy().to_string(),
            kind,
        });
    }

    out.sort_by(|a, b| a.entry.cmp(&b.entry));
    Ok(out)
}

fn read_profiles(ai_root: &Path) -> Result<Vec<ProfileCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(ai_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        // **ここは綴りで比べない。** 除く側は破壊的なので、作成を断る側
        // （`eq_ignore_ascii_case`）と対称にしてはいけない。case-sensitive な
        // ファイルシステム（Linux、case-sensitive APFS）では `engines` と
        // `Engines` は別の実体として共存でき、後者は正当なプロファイル。
        // 綴りで除くと、どちらの一覧にも出ないフォルダができる
        if name.is_empty() || name == ENGINES_DIR {
            continue;
        }

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        if !is_listed_profile(&path) {
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
    //
    let trimmed = validate_basename(&name)?;

    // **作成を断る側は大文字小文字を無視する。** macOS の既定（APFS）は
    // case-insensitive なので、`Engines` は Rust の `==` では別物でも
    // ファイルシステムでは `engines` と同じ実体。通すと `eval` / `book` が
    // **エンジンの置き場の中に**作られ、しかも `read_profiles` は実際の名前
    // （`engines`）を読んで除外するので、一覧には出ない。
    //
    // 除く側（`read_profiles`）は逆に綴りで比べる。理由はあちらに書いてある
    if trimmed.eq_ignore_ascii_case(ENGINES_DIR) {
        return Err(FsError::new(
            FsErrorCode::InvalidNameReserved,
            format!("{ENGINES_DIR} is reserved for engine binaries"),
        ));
    }

    let profile = PathBuf::from(&ai_root).join(&trimmed);

    // 通すのは**作りかけの補完だけ**。作りかけは「下位フォルダが揃っておらず、
    // かつ中身が空」で見分ける。
    //
    // どちらか一方でも欠くと穴が開く。
    // - 揃っているかだけを見る（`all`）→ `eval` だけを持つ既存のプロファイル
    //   （YaneuraOu の普通の形。一覧にも出ている）へ黙って `book` を足して合流する
    // - 中身だけを見る → アプリで作った直後の空のプロファイルに同じ名前を打つと
    //   何も起きずに成功が返り、「作成は通ったのに一覧が変わらない」になる
    let complete = PROFILE_SUBS.iter().all(|sub| profile.join(sub).is_dir());
    if complete || (is_listed_profile(&profile) && has_any_content(&profile)) {
        return Err(
            FsError::new(FsErrorCode::AlreadyExists, "profile already exists")
                .with_path(profile.to_string_lossy().to_string()),
        );
    }

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
    Ok(profile.to_string_lossy().to_string())
}

#[command]
pub fn ensure_engines_dir(ai_root: String) -> Result<String, String> {
    validate_dir("ai_root", &ai_root)?;
    let root = PathBuf::from(&ai_root);

    let engines_dir = root.join(ENGINES_DIR);
    if engines_dir.exists() {
        if !engines_dir.is_dir() {
            return Err(format!(
                "engines exists but is not a directory: {}",
                engines_dir.display()
            ));
        }
        return Ok(engines_dir.to_string_lossy().to_string());
    }

    fs::create_dir_all(&engines_dir).map_err(|e| e.to_string())?;
    Ok(engines_dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// `read_profiles` が一覧から除く名前。作れても出てこないので、
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
