//! キャッシュをどこへ置くか。
//!
//! **中身を知らない。** blob の形式も書く手順も `index_cache.rs`。ここはパスだけ。
//!
//! プロジェクトごとに1つ持つので、**プロジェクトのパスから一意な名前を作る**。
//! パスをそのままファイル名にはできない（区切り文字・長さ・大文字小文字の扱い）ので、
//! ハッシュを16進で綴ってディレクトリ名にする。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

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
/// キャッシュを掴んだら弾くため（`index_cache.rs` の `root hash mismatch`）。
pub(super) fn root_hash(root_dir: &Path) -> [u8; 32] {
    let s = root_dir.to_string_lossy();
    blake3::hash(s.as_bytes()).into()
}

/// キャッシュ全体の置き場。**全プロジェクト共通。**
///
/// 消えても作り直せる派生データなので、OS の「キャッシュ」の側に置く
/// （設定やデータの側ではない）。
fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("obs-shogi")
        .join("index");
    Ok(dir)
}

/// このプロジェクト1つ分の `(ディレクトリ, 本体, 退避)`。
///
/// **[`cache_dir`] より1段細かい。** あちらは全プロジェクト共通の置き場で、
/// こちらはその中の1プロジェクト分。
///
/// 退避が要るのは Windows で上書き rename が失敗するため。本体を退避へ動かして
/// から置くので、**復元は本体 → 退避の順に2回試す**（`index_cache.rs` の `try_restore`）。
///
/// ファイル名の `v1` は固定の綴り。版で弾くのは `CACHE_VERSION` の役で、
/// 名前を変えると古いファイルが誰にも消されずに残る。
pub(super) fn cache_paths(
    app: &AppHandle,
    root_dir: &Path,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let dir = cache_dir(app)?;
    let proj = dir.join(hex32(&root_hash(root_dir)));
    let final_path = proj.join("index.v1.zst");
    let bak_path = proj.join("index.v1.bak");
    Ok((proj, final_path, bak_path))
}

/// 32バイトを64文字の16進に。**ディレクトリ名にするため。**
fn hex32(h: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for b in h {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}
