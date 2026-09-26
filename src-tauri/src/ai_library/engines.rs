//! エンジン本体の置き場（`<ai_root>/engines`）。
//!
//! 候補はファイル名で絞らない。USI エンジンの名前に決まりは無く、名前で絞ると
//! `YaneuraOu` 以外（水匠の改名版、技巧、自作エンジン）が一覧に出ない。
//! 実行ファイルかどうかと起動できる見込みは `engine::launchable` が決める。

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

use super::dir::{kind_of, FsKind};
use crate::engine::launchable::{self, Inspection, Launchability};

/// エンジンの置き場。**AI のプロファイル名として使えない。**
///
/// `profile::read_all` がこの名前を一覧から除くので、作れても出てこない。
/// 除く側と弾く側で綴りが分かれると、作成は通るのに一覧に出ないフォルダができる
pub const ENGINES_DIR: &str = "engines";

/// engines/ の中の、実行ファイルに見えるもの1つ。
/// 開けなかったフォルダも、中身が出ない理由を見せるために1件として返す（`kind: Dir`）
#[derive(Debug, Clone, Serialize)]
pub struct EngineCandidate {
    /// engines/ からの相対。区切りは常に `/`。形は3つ:
    /// 直下のファイルは `<ファイル>`、1段下は `<フォルダ>/<ファイル>`、
    /// 開けなかったフォルダは `<フォルダ>/`（`kind: Dir`、`launchability: Unreadable`）
    pub entry: String,
    /// フルパス
    pub path: String,
    pub kind: FsKind,
    pub launchability: Launchability,
}

/// engines/ の直下と、その1段下のフォルダにある実行ファイルを列挙する。
///
/// 1段下まで見るのは、フォルダごと置いた配布物のエンジンを選べるようにするため
/// （同梱の評価関数や `engine_options.txt` をそのエンジンに読ませる仕組みはまだ無い）。
///
/// **Err になるのは engines/ 自体を読めないときだけ。** 中の1件の失敗では列挙を止めない
/// （止めると関係の無いエンジンまで選べなくなる）。失敗の扱いは2つに分かれる:
/// - 読み取り権限が無いファイル・開けないフォルダは `Launchability::Unreadable` として返す
/// - `stat` できないもの（切れたリンク、検索権限の無い先を指すリンク）は候補にしない。
///   ファイルかフォルダかも判らないので、見せる形が無い
pub fn read_all(engines_dir: &Path) -> Result<Vec<EngineCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(engines_dir).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if is_hidden(&name) {
            continue;
        }
        let path = entry.path();
        // symlink を辿る。切れたリンクは何も指さないので候補にならない
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };

        if meta.is_dir() {
            read_folder(&name, &path, &mut out);
        } else if meta.is_file() {
            out.extend(candidate(name, path));
        }
    }

    out.sort_by(|a, b| a.entry.cmp(&b.entry));
    Ok(out)
}

/// 1段下のフォルダを読む。**これより深くは見ない。**
fn read_folder(name: &str, path: &Path, out: &mut Vec<EngineCandidate>) {
    let Ok(children) = fs::read_dir(path) else {
        out.push(EngineCandidate {
            entry: format!("{name}/"),
            path: path.to_string_lossy().to_string(),
            kind: FsKind::Dir,
            launchability: Launchability::Unreadable,
        });
        return;
    };
    for child in children.flatten() {
        let child_name = child.file_name().to_string_lossy().to_string();
        if is_hidden(&child_name) {
            continue;
        }
        let child_path = child.path();
        if fs::metadata(&child_path).is_ok_and(|m| m.is_file()) {
            out.extend(candidate(format!("{name}/{child_name}"), child_path));
        }
    }
}

fn candidate(entry: String, path: PathBuf) -> Option<EngineCandidate> {
    let Inspection::Program(launchability) = launchable::inspect(&path) else {
        return None;
    };
    Some(EngineCandidate {
        entry,
        kind: kind_of(&path),
        path: path.to_string_lossy().to_string(),
        launchability,
    })
}

/// `.DS_Store` や、エディタ・同期ツールが置く隠しファイル
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// 置き場が無ければ作る。既にあれば、そこがディレクトリであることだけ確かめる。
pub fn ensure(ai_root: &Path) -> Result<PathBuf, String> {
    let engines_dir = ai_root.join(ENGINES_DIR);
    if engines_dir.exists() {
        if !engines_dir.is_dir() {
            return Err(format!(
                "engines exists but is not a directory: {}",
                engines_dir.display()
            ));
        }
        return Ok(engines_dir);
    }

    fs::create_dir_all(&engines_dir).map_err(|e| e.to_string())?;
    Ok(engines_dir)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    use test_support::dir::temp_dir;

    /// この OS で動く実行形式の先頭（macOS は Mach-O、それ以外の Unix は ELF）
    const NATIVE: [u8; 4] = if cfg!(target_os = "macos") {
        [0xcf, 0xfa, 0xed, 0xfe]
    } else {
        [0x7f, b'E', b'L', b'F']
    };

    fn write(path: &Path, head: &[u8], mode: u32) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("作れない");
        }
        let mut bytes = head.to_vec();
        bytes.extend_from_slice(b"rest of the file");
        fs::write(path, bytes).expect("書けない");
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("権限を変えられない");
    }

    fn entries(dir: &Path) -> Vec<String> {
        read_all(dir)
            .expect("列挙できる")
            .into_iter()
            .map(|c| c.entry)
            .collect()
    }

    fn find(dir: &Path, entry: &str) -> EngineCandidate {
        read_all(dir)
            .expect("列挙できる")
            .into_iter()
            .find(|c| c.entry == entry)
            .unwrap_or_else(|| panic!("{entry} が候補に無い"))
    }

    /// 名前で絞らない。`YaneuraOu` で始まらない実行ファイルも候補になる
    #[test]
    fn a_program_is_listed_whatever_its_name() {
        let dir = temp_dir("engines-any-name");
        for name in ["zermelo-f558898", "YaneuraOu_NNUE-V900", "gikou"] {
            write(&dir.join(name), &NATIVE, 0o755);
        }

        assert_eq!(
            entries(&dir),
            ["YaneuraOu_NNUE-V900", "gikou", "zermelo-f558898"]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 評価関数・説明書・隠しファイル・共有ライブラリは候補にしない
    #[test]
    fn non_programs_are_not_listed() {
        let dir = temp_dir("engines-non-programs");
        write(&dir.join("nn.bin"), b"\x00\x01\x02\x03", 0o755);
        write(&dir.join("README.txt"), b"read", 0o644);
        write(&dir.join(".DS_Store"), &NATIVE, 0o755);
        write(&dir.join("libomp.dylib"), &NATIVE, 0o755);

        assert!(entries(&dir).is_empty(), "{:?}", entries(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    /// 起動できないものも外さずに理由を付けて返す。外すと「置いたのに出ない」になる
    #[test]
    fn programs_that_cannot_start_are_listed_with_the_reason() {
        let dir = temp_dir("engines-reasons");
        write(&dir.join("engine"), &NATIVE, 0o644);
        write(&dir.join("YaneuraOu_AVX2.exe"), b"MZ\x90\x00", 0o644);

        assert_eq!(
            find(&dir, "engine").launchability,
            Launchability::NotExecutable
        );
        assert_eq!(
            find(&dir, "YaneuraOu_AVX2.exe").launchability,
            Launchability::WrongPlatform
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 1段下のフォルダまで見る。2段下は見ない。フォルダ名に拡張子らしい綴りがあっても外さない
    #[test]
    fn programs_one_folder_down_are_listed_but_not_deeper() {
        let dir = temp_dir("engines-depth");
        write(&dir.join("suisho5/YaneuraOu-by-gcc"), &NATIVE, 0o755);
        write(&dir.join("suisho5/eval/nn.bin"), b"\x00\x00\x00\x00", 0o644);
        write(&dir.join("tanuki.so.2024/engine"), &NATIVE, 0o755);
        write(&dir.join("pkg/bin/deep-engine"), &NATIVE, 0o755);

        assert_eq!(
            entries(&dir),
            ["suisho5/YaneuraOu-by-gcc", "tanuki.so.2024/engine"]
        );
        let found = find(&dir, "suisho5/YaneuraOu-by-gcc");
        assert!(
            found.path.ends_with("suisho5/YaneuraOu-by-gcc"),
            "{}",
            found.path
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 開けないフォルダは、中身が出ない理由として1件返す。列挙は止めない。
    /// root で走ると権限が効かないので飛ばす
    #[test]
    fn an_unreadable_folder_is_listed_as_unreadable() {
        let dir = temp_dir("engines-unreadable-folder");
        write(&dir.join("locked/engine"), &NATIVE, 0o755);
        write(&dir.join("other"), &NATIVE, 0o755);
        fs::set_permissions(dir.join("locked"), fs::Permissions::from_mode(0o000))
            .expect("権限を変えられない");
        let readable_anyway = fs::read_dir(dir.join("locked")).is_ok();

        let listed = read_all(&dir).expect("列挙できる");

        let _ = fs::set_permissions(dir.join("locked"), fs::Permissions::from_mode(0o755));
        let _ = fs::remove_dir_all(&dir);
        if readable_anyway {
            return;
        }
        let names: Vec<_> = listed.iter().map(|c| c.entry.as_str()).collect();
        assert_eq!(names, ["locked/", "other"]);
        assert_eq!(listed[0].launchability, Launchability::Unreadable);
        assert!(matches!(listed[0].kind, FsKind::Dir));
    }

    /// symlink は辿る。ファイルを指すものは候補、フォルダを指すものは中を見る、
    /// 切れたものは何も指さないので出さない（列挙は止めない）
    #[test]
    fn symlinks_are_followed_and_broken_ones_are_skipped() {
        let dir = temp_dir("engines-symlink");
        let outside = temp_dir("engines-symlink-target");
        write(&outside.join("real-engine"), &NATIVE, 0o755);
        write(&outside.join("pkg/inner-engine"), &NATIVE, 0o755);

        symlink(outside.join("real-engine"), dir.join("linked")).expect("リンクを作れない");
        symlink(outside.join("pkg"), dir.join("linked-dir")).expect("リンクを作れない");
        symlink(outside.join("missing"), dir.join("broken")).expect("リンクを作れない");

        assert_eq!(entries(&dir), ["linked", "linked-dir/inner-engine"]);
        assert!(matches!(find(&dir, "linked").kind, FsKind::Symlink));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }
}
