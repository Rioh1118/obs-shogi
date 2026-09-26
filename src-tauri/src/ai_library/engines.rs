//! エンジン本体の置き場（`<ai_root>/engines`）。
//!
//! 候補はファイル名ではなく**中身で**決める。USI エンジンの名前に決まりは無く、
//! 名前で絞ると `YaneuraOu` 以外（水匠の改名版、技巧、自作エンジン）が一覧に出ない。

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

use super::dir::{kind_of, FsKind};

/// エンジンの置き場。**AI のプロファイル名として使えない。**
///
/// `profile::read_all` がこの名前を一覧から除くので、作れても出てこない。
/// 除く側と弾く側で綴りが分かれると、作成は通るのに一覧に出ないフォルダができる
pub const ENGINES_DIR: &str = "engines";

/// 候補を起動できる見込み。**一覧から外す理由ではなく、利用者に見せる理由。**
///
/// 外してしまうと「置いたのに出てこない」になり、直し方（実行権限を付ける、
/// macOS で開くのを許可する）に辿り着けない。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Launchability {
    Ready,
    /// 実行権限が無い。zip の展開で落ちるのが最も多い形
    NotExecutable,
    /// macOS の隔離属性が付いたまま、利用者がまだ開くのを許可していない。
    /// **許可済みなら属性が残っていても動く**ので、属性の有無ではなく許可の印で見る
    Quarantined,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineCandidate {
    /// engines/ からの相対。1段下のフォルダにあるものは `<フォルダ>/<ファイル>`（区切りは常に `/`）
    pub entry: String,
    /// フルパス
    pub path: String,
    pub kind: FsKind,
    pub launch: Launchability,
}

/// engines/ の直下と、その1段下のフォルダにある実行ファイルを列挙する。
///
/// 1段下まで見るのは、評価関数や設定ファイルを同梱した配布物をフォルダごと置けるようにするため。
/// 直下に平置きすると、やねうら王どうしは同じフォルダの `engine_options.txt` などを共有する。
pub fn read_all(engines_dir: &Path) -> Result<Vec<EngineCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(engines_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
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
            // 開けないフォルダは、その中身が候補に出ないだけにする。
            // engines/ 全体の列挙を止めると、関係の無いエンジンまで選べなくなる
            let Ok(children) = fs::read_dir(&path) else {
                continue;
            };
            for child in children.flatten() {
                let child_name = child.file_name().to_string_lossy().to_string();
                if is_hidden(&child_name) {
                    continue;
                }
                let child_path = child.path();
                let Ok(child_meta) = fs::metadata(&child_path) else {
                    continue;
                };
                if child_meta.is_file() {
                    let entry = format!("{name}/{child_name}");
                    out.extend(candidate(entry, child_path, &child_meta));
                }
            }
        } else if meta.is_file() {
            out.extend(candidate(name, path, &meta));
        }
    }

    out.sort_by(|a, b| a.entry.cmp(&b.entry));
    Ok(out)
}

fn candidate(entry: String, path: PathBuf, meta: &fs::Metadata) -> Option<EngineCandidate> {
    if is_shared_library(&entry) || !looks_like_program(&path) {
        return None;
    }
    let launch = launchability(&path, meta);
    Some(EngineCandidate {
        entry,
        kind: kind_of(&path),
        path: path.to_string_lossy().to_string(),
        launch,
    })
}

/// `.DS_Store` や、エディタ・同期ツールが置く隠しファイル
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// 共有ライブラリは実行ビットを持ち、先頭も実行ファイルと同じ形をしている。
/// 同梱のライブラリ（`libomp.dylib` など）を候補に出さないため、拡張子で除く
fn is_shared_library(entry: &str) -> bool {
    let lower = entry.to_ascii_lowercase();
    [".dylib", ".so", ".dll"]
        .iter()
        .any(|ext| lower.ends_with(ext))
        || lower.contains(".so.")
}

/// 実行できる形式か。評価関数（`nn.bin`）や説明書を候補に出さないため、
/// 実行ビットではなく**先頭のバイト**で見る（zip の展開で全ファイルに実行ビットが付くことがある）
#[cfg(not(windows))]
fn looks_like_program(path: &Path) -> bool {
    use std::io::Read;

    let mut head = [0u8; 4];
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    if file.read_exact(&mut head).is_err() {
        return false;
    }
    is_program_header(head)
}

#[cfg(windows)]
fn looks_like_program(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
}

/// Mach-O（32/64 ビット、両エンディアン、universal）、ELF、`#!` で始まるスクリプト
#[cfg_attr(windows, allow(dead_code))]
fn is_program_header(head: [u8; 4]) -> bool {
    const MACH_O: [[u8; 4]; 5] = [
        [0xfe, 0xed, 0xfa, 0xce],
        [0xfe, 0xed, 0xfa, 0xcf],
        [0xce, 0xfa, 0xed, 0xfe],
        [0xcf, 0xfa, 0xed, 0xfe],
        [0xca, 0xfe, 0xba, 0xbe],
    ];
    const ELF: [u8; 4] = [0x7f, b'E', b'L', b'F'];
    MACH_O.contains(&head) || head == ELF || head.starts_with(b"#!")
}

#[cfg(unix)]
fn launchability(path: &Path, meta: &fs::Metadata) -> Launchability {
    use std::os::unix::fs::PermissionsExt;
    if meta.permissions().mode() & 0o111 == 0 {
        return Launchability::NotExecutable;
    }
    if quarantine_blocks(path) {
        return Launchability::Quarantined;
    }
    Launchability::Ready
}

#[cfg(not(unix))]
fn launchability(_path: &Path, _meta: &fs::Metadata) -> Launchability {
    Launchability::Ready
}

/// `com.apple.quarantine` が付いていて、利用者がまだ開くのを許可していないか
#[cfg(target_os = "macos")]
fn quarantine_blocks(path: &Path) -> bool {
    read_quarantine(path).is_some_and(|value| !quarantine_is_approved(&value))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn quarantine_blocks(_path: &Path) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn read_quarantine(path: &Path) -> Option<String> {
    let value = xattr::get(path, "com.apple.quarantine").ok()??;
    Some(String::from_utf8_lossy(&value).into_owned())
}

/// 隔離属性の値は `<flags(16進)>;<時刻>;<アプリ>;<UUID>`。
/// flags の 0x0040 が「利用者が開くのを許可した」印（Finder の「開く」や
/// システム設定での許可で立つ）。読めない値は許可されていないものとして扱う
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn quarantine_is_approved(value: &str) -> bool {
    const USER_APPROVED: u16 = 0x0040;
    value
        .split(';')
        .next()
        .and_then(|flags| u16::from_str_radix(flags, 16).ok())
        .is_some_and(|flags| flags & USER_APPROVED != 0)
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

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::dir::temp_dir;

    const MACH_O_64: [u8; 4] = [0xcf, 0xfa, 0xed, 0xfe];

    fn write(path: &Path, head: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("作れない");
        }
        let mut bytes = head.to_vec();
        bytes.extend_from_slice(b"rest of the file");
        fs::write(path, bytes).expect("書けない");
    }

    #[cfg(unix)]
    fn chmod(path: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
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
    #[cfg(unix)]
    #[test]
    fn a_program_is_listed_whatever_its_name() {
        let dir = temp_dir("engines-any-name");
        for name in ["zermelo-f558898", "YaneuraOu_NNUE-V900", "gikou"] {
            write(&dir.join(name), &MACH_O_64);
            chmod(&dir.join(name), 0o755);
        }

        assert_eq!(
            entries(&dir),
            ["YaneuraOu_NNUE-V900", "gikou", "zermelo-f558898"]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 評価関数・説明書・隠しファイル・共有ライブラリは候補にしない。
    /// ライブラリは実行ビットも先頭の形も実行ファイルと同じなので、拡張子で除いている
    #[cfg(unix)]
    #[test]
    fn non_programs_are_not_listed() {
        let dir = temp_dir("engines-non-programs");
        write(&dir.join("nn.bin"), b"\x00\x01\x02\x03");
        write(&dir.join("README.txt"), b"read");
        write(&dir.join(".DS_Store"), &MACH_O_64);
        write(&dir.join("libomp.dylib"), &MACH_O_64);
        write(&dir.join("libfoo.so.1"), b"\x7fELF");
        for name in [
            "nn.bin",
            "README.txt",
            ".DS_Store",
            "libomp.dylib",
            "libfoo.so.1",
        ] {
            chmod(&dir.join(name), 0o755);
        }
        // 4バイトに満たないファイルも読めて、候補にならない
        fs::write(dir.join("tiny"), b"#").expect("書けない");
        chmod(&dir.join("tiny"), 0o755);

        assert!(entries(&dir).is_empty(), "{:?}", entries(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn elf_and_scripts_are_programs() {
        let dir = temp_dir("engines-formats");
        write(&dir.join("linux-engine"), b"\x7fELF");
        write(&dir.join("run.sh"), b"#!/bin/sh\n");
        chmod(&dir.join("linux-engine"), 0o755);
        chmod(&dir.join("run.sh"), 0o755);

        assert_eq!(entries(&dir), ["linux-engine", "run.sh"]);
        let _ = fs::remove_dir_all(&dir);
    }

    /// 実行権限が無いものは**外さずに理由を付けて返す**。外すと「置いたのに出ない」になる
    #[cfg(unix)]
    #[test]
    fn a_program_without_the_execute_bit_is_listed_as_not_executable() {
        let dir = temp_dir("engines-noexec");
        write(&dir.join("engine"), &MACH_O_64);
        chmod(&dir.join("engine"), 0o644);

        assert_eq!(find(&dir, "engine").launch, Launchability::NotExecutable);

        chmod(&dir.join("engine"), 0o755);
        assert_eq!(find(&dir, "engine").launch, Launchability::Ready);
        let _ = fs::remove_dir_all(&dir);
    }

    /// 1段下のフォルダまで見る。2段下は見ない
    #[cfg(unix)]
    #[test]
    fn programs_one_folder_down_are_listed_but_not_deeper() {
        let dir = temp_dir("engines-depth");
        write(&dir.join("suisho5/YaneuraOu-by-gcc"), &MACH_O_64);
        write(&dir.join("suisho5/eval/nn.bin"), b"\x00\x00\x00\x00");
        write(&dir.join("pkg/bin/deep-engine"), &MACH_O_64);
        chmod(&dir.join("suisho5/YaneuraOu-by-gcc"), 0o755);
        chmod(&dir.join("pkg/bin/deep-engine"), 0o755);

        assert_eq!(entries(&dir), ["suisho5/YaneuraOu-by-gcc"]);
        let found = find(&dir, "suisho5/YaneuraOu-by-gcc");
        assert!(
            found.path.ends_with("suisho5/YaneuraOu-by-gcc"),
            "{}",
            found.path
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// symlink は辿る。ファイルを指すものは候補、フォルダを指すものは中を見る、
    /// 切れたものは何も指さないので出さない（列挙は止めない）
    #[cfg(unix)]
    #[test]
    fn symlinks_are_followed_and_broken_ones_are_skipped() {
        use std::os::unix::fs::symlink;

        let dir = temp_dir("engines-symlink");
        let outside = temp_dir("engines-symlink-target");
        write(&outside.join("real-engine"), &MACH_O_64);
        chmod(&outside.join("real-engine"), 0o755);
        write(&outside.join("pkg/inner-engine"), &MACH_O_64);
        chmod(&outside.join("pkg/inner-engine"), 0o755);

        symlink(outside.join("real-engine"), dir.join("linked")).expect("リンクを作れない");
        symlink(outside.join("pkg"), dir.join("linked-dir")).expect("リンクを作れない");
        symlink(outside.join("missing"), dir.join("broken")).expect("リンクを作れない");

        assert_eq!(entries(&dir), ["linked", "linked-dir/inner-engine"]);
        assert!(matches!(find(&dir, "linked").kind, FsKind::Symlink));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn the_quarantine_flag_decides_approval() {
        // 実機の許可済みエンジンに付いていた値
        assert!(quarantine_is_approved(
            "00c1;6720a1b0;Chrome;D7E1A0F3-0000-0000-0000-000000000000"
        ));
        // ダウンロード直後（まだ開いていない）
        assert!(!quarantine_is_approved("0081;6720a1b0;Chrome;"));
        assert!(!quarantine_is_approved("0083;6720a1b0;Safari;"));
        // 読めない値は許可されていないものとして扱う
        assert!(!quarantine_is_approved(""));
        assert!(!quarantine_is_approved("zz;1;x;"));
    }

    /// 属性の有無ではなく許可の印で見ることを、実ファイルの属性で固定する
    #[cfg(target_os = "macos")]
    #[test]
    fn an_unapproved_quarantine_is_reported_and_an_approved_one_is_not() {
        fn set_quarantine(path: &Path, value: &str) {
            xattr::set(path, "com.apple.quarantine", value.as_bytes()).expect("属性を付けられない");
        }

        let dir = temp_dir("engines-quarantine");
        write(&dir.join("engine"), &MACH_O_64);
        chmod(&dir.join("engine"), 0o755);

        set_quarantine(&dir.join("engine"), "0081;6720a1b0;Chrome;");
        assert_eq!(find(&dir, "engine").launch, Launchability::Quarantined);

        set_quarantine(&dir.join("engine"), "00c1;6720a1b0;Chrome;");
        assert_eq!(find(&dir, "engine").launch, Launchability::Ready);
        let _ = fs::remove_dir_all(&dir);
    }
}
