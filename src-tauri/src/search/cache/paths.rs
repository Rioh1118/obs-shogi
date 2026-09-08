//! キャッシュをどの名前で置くか。
//!
//! **置き場は知らない。** どこへ置くかは `storage` の実装が決める。
//! ここは「プロジェクトを1つに定める名前」を作るだけ。
//!
//! パスをそのままファイル名にはできない（区切り文字・長さ・大文字小文字の扱い）ので、
//! ハッシュを16進で綴る。

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// いまの時刻。**blob に書いて、次に読んだとき「いつのものか」を示す。**
pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// プロジェクトのパスから、ディレクトリ名に使えるハッシュ。
///
/// **暗号の強さは要らない。** 別のプロジェクトが同じ名前にならなければよい。
///
/// blob の中にも書いて読み戻すときに突き合わせる —— 別のプロジェクトの
/// キャッシュを掴んだら弾くため（`format.rs` の `root hash mismatch`）。
pub(super) fn root_hash(root_dir: &Path) -> [u8; 32] {
    let s = root_dir.to_string_lossy();
    blake3::hash(s.as_bytes()).into()
}

/// このプロジェクトのキャッシュを指す名前。
///
/// **置き場は知らない。** どこへ置くかは `storage` に渡す根が決める。
/// ここはプロジェクトを1つに定める名前だけを作る。
pub(super) fn cache_key(root_dir: &Path) -> String {
    hex32(&root_hash(root_dir))
}

/// 32バイトを64文字の16進に。**ファイル名にするため。**
fn hex32(h: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for b in h {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **名前はプロジェクトごとに違う。**
    ///
    /// 同じ名前になると、別のプロジェクトのキャッシュを掴む。
    /// 中身の `root hash` でも止まるが、**そこまで行かせない**のがこの層の役。
    #[test]
    fn two_projects_never_share_a_key() {
        let a = cache_key(Path::new("/tmp/project-a"));
        let b = cache_key(Path::new("/tmp/project-b"));
        assert_ne!(a, b, "別のプロジェクトが同じ名前になっている");
    }

    /// **同じプロジェクトなら何度呼んでも同じ名前。**
    #[test]
    fn the_same_project_always_gets_the_same_key() {
        let p = Path::new("/tmp/project-a");
        assert_eq!(cache_key(p), cache_key(p));
    }

    /// **名前はファイル名に使える文字だけ。**
    ///
    /// パスをそのまま使えないので16進に綴っている。
    #[test]
    fn a_key_is_safe_as_a_file_name() {
        let k = cache_key(Path::new("/tmp/a b/日本語/../c"));
        assert_eq!(k.len(), 64, "16進64文字でない");
        assert!(
            k.chars().all(|c| c.is_ascii_hexdigit()),
            "16進以外が混ざっている: {k}"
        );
    }
}
