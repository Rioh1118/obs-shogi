//! 評価関数ファイル（やねうら王の NNUE の `nn.bin`）の先頭に書かれた型を読む。
//!
//! 使い手は2つ。候補の一覧（`ai_library::profile`）はプリセット編集の評価関数の欄に型を出し、
//! 起動の失敗の分類（`start_failure::describe`）は型が合わずに終わった回の帯に型を添える。
//! エンジンは自分の型を申告しない（`id name` に型が無い）ので、型はファイルの側からしか取れない
//! （`research/engines/yaneuraou-files.md` の「評価関数の型」）。
//!
//! 形はやねうら王の公開ソースの評価関数の読み込み（版・ハッシュ・長さの3つの `u32` の後に、
//! その長さの型の文字列）による。手元の2ファイル（HalfKA2 と HalfKP）で確かめた。

use std::fs::File;
use std::io::Read;
use std::path::Path;

/// 先頭の型の文字列の長さの上限。手元の2ファイルは 98 と 184 バイト。
/// 超えるものは NNUE の評価関数ではないとみなし、巨大な確保をしない
const MAX_ARCH_LEN: usize = 4096;

/// `path` の評価関数の型（`HalfKA2 1024x2` のように、特徴量の名前と入力の幅）。
/// 読めない・NNUE の形でない・型の文字列に `Features=` が無ければ `None`（エラーにしない）
pub fn read_eval_type(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut head = [0u8; 12];
    file.read_exact(&mut head).ok()?;
    let len = u32::from_le_bytes([head[8], head[9], head[10], head[11]]) as usize;
    if len == 0 || len > MAX_ARCH_LEN {
        return None;
    }
    let mut arch = vec![0u8; len];
    file.read_exact(&mut arch).ok()?;
    eval_type_of(std::str::from_utf8(&arch).ok()?)
}

/// 型の文字列（`Features=HalfKA2(Friend)[131949->1024x2],Network=…`）から、特徴量の名前と入力の幅を取る
fn eval_type_of(arch: &str) -> Option<String> {
    let features = arch.split("Features=").nth(1)?;
    let features = features.split(',').next().unwrap_or(features);
    let name: String = features
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() {
        return None;
    }
    let width = features
        .split("->")
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .filter(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_alphanumeric()));
    Some(match width {
        Some(width) => format!("{name} {width}"),
        None => name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::dir::temp_dir;

    /// 手元の2ファイルの先頭と同じ形（版・ハッシュ・長さ・型の文字列）を作る
    fn nnue(arch: &str) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x7AF3_2F16u32.to_le_bytes());
        bytes.extend_from_slice(&0x3C20_3B32u32.to_le_bytes());
        bytes.extend_from_slice(&(arch.len() as u32).to_le_bytes());
        bytes.extend_from_slice(arch.as_bytes());
        bytes.extend_from_slice(&[0xFF, 0x00, 0x12]);
        bytes
    }

    #[test]
    fn the_type_is_the_feature_name_and_the_input_width() {
        let dir = temp_dir("eval-arch");
        for (arch, expected) in [
            (
                "ModelType=SFNNWithoutPsqt;Features=HalfKA2(Friend)[131949->1024x2],Network=SFNN-1024{LayerStack=9}",
                "HalfKA2 1024x2",
            ),
            (
                "Features=HalfKP(Friend)[125388->256x2],Network=AffineTransform[1<-256](ClippedReLU[256])",
                "HalfKP 256x2",
            ),
            ("Features=HalfKP,Network=x", "HalfKP"),
        ] {
            let path = dir.join("nn.bin");
            std::fs::write(&path, nnue(arch)).expect("書けない");
            assert_eq!(read_eval_type(&path).as_deref(), Some(expected), "{arch}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 読めないものはエラーにせず `None`
    #[test]
    fn what_is_not_an_nnue_header_has_no_type() {
        let dir = temp_dir("eval-arch-none");
        let mut too_long = nnue("Features=HalfKP");
        too_long[8..12].copy_from_slice(&((MAX_ARCH_LEN + 1) as u32).to_le_bytes());
        for (name, bytes) in [
            ("short.bin", vec![1, 2, 3]),
            ("no-features.bin", nnue("Network=x")),
            ("too-long.bin", too_long),
            ("truncated.bin", nnue("Features=HalfKP")[..14].to_vec()),
        ] {
            let path = dir.join(name);
            std::fs::write(&path, bytes).expect("書けない");
            assert_eq!(read_eval_type(&path), None, "{name}");
        }
        assert_eq!(read_eval_type(&dir.join("missing.bin")), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
