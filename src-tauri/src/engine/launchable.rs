//! OS がこのファイルをエンジンとして起動させるか。**起動する前に分かる範囲だけ**を見る。
//!
//! 候補の一覧（`ai_library::engines`）と、起動に失敗したときの理由の分類の両方が
//! 同じ答えを使う。片方だけ直すと、一覧は「起動できる」と言うのに起動で止まる、
//! という食い違いが生まれる。

use serde::Serialize;
use std::fs;
use std::path::Path;

/// 起動できる見込み。**候補から外す理由ではなく、利用者に見せる理由。**
///
/// 外してしまうと「置いたのに出てこない」になり、直し方（実行権限を付ける、
/// macOS で開くのを許可する、読み取り権限を付ける）に辿り着けない。
///
/// **理由は1つだけ返す。** 見る順は `inspect` の本文の順で、直す順と同じにしてある
/// （実行権限が無いと、macOS の許可を与えても起動できない）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Launchability {
    /// 起動の前に分かる範囲では、止めるものが無い
    Ready,
    /// 実行ファイルの形をしているが、実行権限が無い。
    /// Unix の権限を記録しない zip（Windows で作ったものなど）を展開すると 0644 になる
    NotExecutable,
    /// macOS の隔離属性が付いたまま、利用者がまだ開くのを許可していない。
    /// **許可済みなら属性が残っていても動く**ので、属性の有無ではなく許可の印で見る
    Quarantined,
    /// 読めないので、実行ファイルかどうかも判らない（読み取り権限が無い、など）
    Unreadable,
    /// 別の OS 向けの実行ファイル（macOS / Linux に置かれた Windows の `.exe`）
    WrongPlatform,
}

/// `inspect` の答え。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Inspection {
    /// 実行ファイルではない（評価関数、説明書、共有ライブラリ）。候補に出さない
    NotAProgram,
    Program(Launchability),
}

/// 1つのファイルを調べる。**symlink はリンク先を見る**（起動するのはリンク先なので）。
///
/// 実行権限・先頭のバイト・隔離属性の3つを、**全部同じ実体**から読む。
/// 1つでもリンク自身から読むと、リンク先が起動できないのに `Ready` を返す。
pub fn inspect(path: &Path) -> Inspection {
    let Ok(resolved) = fs::canonicalize(path) else {
        return Inspection::Program(Launchability::Unreadable);
    };
    let file_name = resolved
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if is_shared_library(&file_name) {
        return Inspection::NotAProgram;
    }

    match program_kind(&resolved) {
        Kind::NotAProgram => Inspection::NotAProgram,
        Kind::Unreadable => Inspection::Program(Launchability::Unreadable),
        Kind::OtherPlatform => Inspection::Program(Launchability::WrongPlatform),
        Kind::Native => Inspection::Program(launchability(&resolved)),
    }
}

enum Kind {
    Native,
    OtherPlatform,
    NotAProgram,
    Unreadable,
}

/// 共有ライブラリは実行ビットを持ち、先頭も実行ファイルと同じ形（Mach-O / ELF）をしている。
/// 同梱のライブラリ（`libomp.dylib` など）を候補に出さないため、**ファイル名の拡張子**で除く。
/// Windows の `.dll` は `program_kind` が `.exe` 以外を通さないので、ここでは見ない
fn is_shared_library(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    lower.ends_with(".dylib") || lower.ends_with(".so") || lower.contains(".so.")
}

/// Unix では**先頭のバイト**で見る。実行ビットは配布物の作り方次第で評価関数にも付く
/// （全ファイルを 0755 で保存した zip を展開した場合）ので、それでは判定できない
#[cfg(not(windows))]
fn program_kind(path: &Path) -> Kind {
    use std::io::{ErrorKind, Read};

    let mut head = [0u8; 4];
    let read = fs::File::open(path).and_then(|mut file| file.read_exact(&mut head));
    match read {
        Ok(()) => header_kind(head),
        // 4バイトに満たない。実行ファイルではありえない
        Err(e) if e.kind() == ErrorKind::UnexpectedEof => Kind::NotAProgram,
        Err(_) => Kind::Unreadable,
    }
}

/// Windows は起動の仕方を拡張子で決める（`CreateProcess`）。先頭の `MZ` は `.dll` も
/// 同じ形なので、中身を見ても拡張子に頼ることになる
#[cfg(windows)]
fn program_kind(path: &Path) -> Kind {
    let is_exe = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
    if is_exe {
        Kind::Native
    } else {
        Kind::NotAProgram
    }
}

/// Mach-O（32/64 ビット、両エンディアン、universal）、ELF、`#!` で始まるスクリプトは
/// この OS で動く。`MZ`（Windows の実行形式）は別の OS 向け
#[cfg_attr(windows, allow(dead_code))]
fn header_kind(head: [u8; 4]) -> Kind {
    const MACH_O: [[u8; 4]; 5] = [
        [0xfe, 0xed, 0xfa, 0xce],
        [0xfe, 0xed, 0xfa, 0xcf],
        [0xce, 0xfa, 0xed, 0xfe],
        [0xcf, 0xfa, 0xed, 0xfe],
        [0xca, 0xfe, 0xba, 0xbe],
    ];
    const ELF: [u8; 4] = [0x7f, b'E', b'L', b'F'];
    if MACH_O.contains(&head) || head == ELF || head.starts_with(b"#!") {
        Kind::Native
    } else if head.starts_with(b"MZ") {
        Kind::OtherPlatform
    } else {
        Kind::NotAProgram
    }
}

#[cfg(unix)]
fn launchability(path: &Path) -> Launchability {
    use std::os::unix::fs::PermissionsExt;
    let Ok(meta) = fs::metadata(path) else {
        return Launchability::Unreadable;
    };
    if meta.permissions().mode() & 0o111 == 0 {
        return Launchability::NotExecutable;
    }
    if quarantine_blocks(path) {
        return Launchability::Quarantined;
    }
    Launchability::Ready
}

#[cfg(not(unix))]
fn launchability(_path: &Path) -> Launchability {
    Launchability::Ready
}

/// `com.apple.quarantine` が付いていて、利用者がまだ開くのを許可していないか。
/// 呼び手は `canonicalize` 済みのパスを渡す（`xattr::get` はリンクを辿らない）
#[cfg(target_os = "macos")]
fn quarantine_blocks(path: &Path) -> bool {
    let Ok(Some(value)) = xattr::get(path, "com.apple.quarantine") else {
        return false;
    };
    !quarantine_is_approved(&String::from_utf8_lossy(&value))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn quarantine_blocks(_path: &Path) -> bool {
    false
}

/// 隔離属性の値は `<flags(16進)>;<時刻>;<アプリ>;<UUID>`。
/// flags の 0x0040 が立っていれば、利用者が開くのを許可している（手元の許可済みエンジンは
/// `00c1`、ダウンロード直後は `0081`）。**読めない値は許可されていないものとして扱う**
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn quarantine_is_approved(value: &str) -> bool {
    const USER_APPROVED: u16 = 0x0040;
    value
        .split(';')
        .next()
        .and_then(|flags| u16::from_str_radix(flags, 16).ok())
        .is_some_and(|flags| flags & USER_APPROVED != 0)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    use test_support::dir::temp_dir;

    const MACH_O_64: [u8; 4] = [0xcf, 0xfa, 0xed, 0xfe];

    fn write(path: &Path, head: &[u8], mode: u32) {
        let mut bytes = head.to_vec();
        bytes.extend_from_slice(b"rest of the file");
        fs::write(path, bytes).expect("書けない");
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("権限を変えられない");
    }

    fn program(launch: Launchability) -> Inspection {
        Inspection::Program(launch)
    }

    #[test]
    fn native_formats_are_programs_and_others_are_not() {
        let dir = temp_dir("launchable-formats");
        write(&dir.join("macho"), &MACH_O_64, 0o755);
        write(&dir.join("elf"), b"\x7fELF", 0o755);
        write(&dir.join("run.sh"), b"#!/bin/sh\n", 0o755);
        write(&dir.join("nn.bin"), b"\x00\x01\x02\x03", 0o755);
        fs::write(dir.join("tiny"), b"#").expect("書けない");

        assert_eq!(inspect(&dir.join("macho")), program(Launchability::Ready));
        assert_eq!(inspect(&dir.join("elf")), program(Launchability::Ready));
        assert_eq!(inspect(&dir.join("run.sh")), program(Launchability::Ready));
        assert_eq!(inspect(&dir.join("nn.bin")), Inspection::NotAProgram);
        // 4バイトに満たないものは読めないのではなく、実行ファイルではない
        assert_eq!(inspect(&dir.join("tiny")), Inspection::NotAProgram);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Mac に置かれた Windows 版は、黙って外さず別の OS 向けと言う
    #[test]
    fn a_windows_executable_is_reported_as_the_wrong_platform() {
        let dir = temp_dir("launchable-mz");
        write(&dir.join("YaneuraOu_AVX2.exe"), b"MZ\x90\x00", 0o644);

        assert_eq!(
            inspect(&dir.join("YaneuraOu_AVX2.exe")),
            program(Launchability::WrongPlatform)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 共有ライブラリはファイル名の拡張子で除く。フォルダ名は見ない
    #[test]
    fn shared_libraries_are_not_programs() {
        let dir = temp_dir("launchable-libs");
        fs::create_dir_all(dir.join("v1.so.2")).expect("作れない");
        write(&dir.join("libomp.dylib"), &MACH_O_64, 0o755);
        write(&dir.join("libfoo.so.1"), b"\x7fELF", 0o755);
        write(&dir.join("v1.so.2/engine"), &MACH_O_64, 0o755);

        assert_eq!(inspect(&dir.join("libomp.dylib")), Inspection::NotAProgram);
        assert_eq!(inspect(&dir.join("libfoo.so.1")), Inspection::NotAProgram);
        assert_eq!(
            inspect(&dir.join("v1.so.2/engine")),
            program(Launchability::Ready)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_program_without_the_execute_bit_is_not_executable() {
        let dir = temp_dir("launchable-noexec");
        write(&dir.join("engine"), &MACH_O_64, 0o644);

        assert_eq!(
            inspect(&dir.join("engine")),
            program(Launchability::NotExecutable)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 読めないものは黙って外さない。root で走ると権限が効かないので飛ばす
    #[test]
    fn an_unreadable_file_is_reported_as_unreadable() {
        let dir = temp_dir("launchable-unreadable");
        write(&dir.join("engine"), &MACH_O_64, 0o000);
        if fs::File::open(dir.join("engine")).is_ok() {
            let _ = fs::remove_dir_all(&dir);
            return;
        }

        assert_eq!(
            inspect(&dir.join("engine")),
            program(Launchability::Unreadable)
        );
        let _ = fs::set_permissions(dir.join("engine"), fs::Permissions::from_mode(0o644));
        let _ = fs::remove_dir_all(&dir);
    }

    /// symlink はリンク先の権限を見る
    #[test]
    fn a_symlink_is_judged_by_its_target() {
        let dir = temp_dir("launchable-link");
        write(&dir.join("real"), &MACH_O_64, 0o644);
        symlink(dir.join("real"), dir.join("link")).expect("リンクを作れない");

        assert_eq!(
            inspect(&dir.join("link")),
            program(Launchability::NotExecutable)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_quarantine_flag_decides_approval() {
        // 手元の許可済みエンジンに付いていた値
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

    /// 属性の有無ではなく許可の印で見る。リンク越しでもリンク先の属性で判定する
    #[cfg(target_os = "macos")]
    #[test]
    fn an_unapproved_quarantine_is_reported_even_through_a_symlink() {
        fn set_quarantine(path: &Path, value: &str) {
            xattr::set(path, "com.apple.quarantine", value.as_bytes()).expect("属性を付けられない");
        }

        let dir = temp_dir("launchable-quarantine");
        write(&dir.join("engine"), &MACH_O_64, 0o755);
        symlink(dir.join("engine"), dir.join("link")).expect("リンクを作れない");

        set_quarantine(&dir.join("engine"), "0081;6720a1b0;Chrome;");
        assert_eq!(
            inspect(&dir.join("engine")),
            program(Launchability::Quarantined)
        );
        assert_eq!(
            inspect(&dir.join("link")),
            program(Launchability::Quarantined)
        );

        set_quarantine(&dir.join("engine"), "00c1;6720a1b0;Chrome;");
        assert_eq!(inspect(&dir.join("engine")), program(Launchability::Ready));
        assert_eq!(inspect(&dir.join("link")), program(Launchability::Ready));
        let _ = fs::remove_dir_all(&dir);
    }
}
