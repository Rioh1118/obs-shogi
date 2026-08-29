use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Runtime};

use crate::file_system::error::{FsError, FsErrorCode};

use super::types::FileTreeNode;
use super::utils::{generate_id, get_file_extension, is_kifu_file, is_under, validate_under_root};

/// 降りてよい深さの上限。
///
/// 実体のディレクトリだけでもここまで積める人はいないが、**上限が無いと
/// スタックオーバーフローでプロセスごと落ちる**。Rust のそれは `catch_unwind` できず、
/// `get_file_tree` は `Err` すら返せない。起動のたびに無言で落ちるので、
/// 利用者は自力で原因に辿り着けない
const MAX_DEPTH: usize = 64;

/// 走査の途中の状態。
///
/// `ancestors` は**辿った symlink の解決先**を積む。root の中で閉じた symlink は
/// 一覧に出す（`ws/current -> ws/2026/08` は普通の使い方）ので、
/// `ws/self -> .` のような自分を指すものが1本あるだけで無限に降りてしまう。
/// 深さの上限だけでは、そこまでの段が全部複製されたツリーが返る
struct Walk<'a> {
    canonical_root: &'a Path,
    ancestors: Vec<PathBuf>,
    depth: usize,
}

fn build_file_tree_recursive(path: &Path, walk: &Walk) -> Result<FileTreeNode, FsError> {
    let metadata = fs::metadata(path).map_err(FsError::from)?;
    let is_dir = metadata.is_dir();

    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let absolute_path = path.to_string_lossy().to_string();

    let mut node = FileTreeNode {
        id: generate_id(),
        name,
        path: absolute_path,
        is_dir,
        children: None,
        last_modified: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64),
        size: if is_dir { None } else { Some(metadata.len()) },
        extension: if is_dir {
            None
        } else {
            get_file_extension(path)
        },
    };

    if is_dir && walk.depth < MAX_DEPTH {
        let mut children = Vec::new();
        let entries = fs::read_dir(path).map_err(FsError::from)?;

        for entry in entries {
            let entry = match entry {
                Ok(v) => v,
                Err(_) => continue,
            };
            let child_path = entry.path();

            // **root の外へ出る symlink は落とす。** `Path::is_dir` は symlink を辿るので、
            // 素通しにすると一覧がホーム以下まで広がる。しかも辿った先は `read_file` の
            // 関門が canonicalize して弾くので、**見えるのに開けない行**になる。
            //
            // root の中で閉じている symlink（`ws/current -> ws/2026/08`）は普通の使い方で、
            // 中身も開けるので残す。無条件に落とすと、何も伝えないまま一覧から消える。
            // 落とした行があることは利用者に出ない → issue #179
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            let mut child_walk = Walk {
                canonical_root: walk.canonical_root,
                ancestors: walk.ancestors.clone(),
                depth: walk.depth + 1,
            };

            if file_type.is_symlink() {
                let Ok(resolved) = fs::canonicalize(&child_path) else {
                    continue;
                };
                if !is_under(walk.canonical_root, &resolved) {
                    continue;
                }
                // 自分か祖先を指す symlink。降りると同じ部分木を積み直す
                if walk.ancestors.contains(&resolved) {
                    continue;
                }
                child_walk.ancestors.push(resolved);
            }

            // ディレクトリまたは棋譜ファイルのみを含める
            if child_path.is_dir() || is_kifu_file(&child_path) {
                match build_file_tree_recursive(&child_path, &child_walk) {
                    Ok(child_node) => children.push(child_node),
                    Err(_) => continue, // エラーは無視して続行
                }
            }
        }

        // ディレクトリを先に、その後ファイルの名前順でソート
        children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });

        if !children.is_empty() {
            node.children = Some(children);
        }
    }

    Ok(node)
}

/// ツリーの取得。**`root_dir` は呼び出し側から来るので、設定値と突き合わせる。**
///
/// 突き合わせないと `invoke("get_file_tree", { rootDir: "/Users/x" })` で
/// ホーム以下の全ディレクトリ名・棋譜のフルパス・サイズ・更新時刻が返る。
/// 中身は `read_file` が `validate_under_root` で守っているが、一覧は素通りになる。
/// 走査の側で root の外へ出ないことは `build_file_tree_recursive` が受け持つ
/// （関門は引数1点しか見ない）。
#[command]
pub fn get_file_tree<R: Runtime>(
    app: AppHandle<R>,
    root_dir: String,
) -> Result<FileTreeNode, FsError> {
    let root_path = PathBuf::from(&root_dir);
    validate_under_root(&app, &root_path)?;

    if !root_path.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "directory does not exist").with_path(root_dir),
        );
    }

    if !root_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidType, "path is not a directory")
                .with_path(root_path.to_string_lossy().to_string()),
        );
    }

    // 絶対パスに正規化
    let canonical_path = root_path.canonicalize().map_err(FsError::from)?;
    let walk = Walk {
        // **引数のディレクトリ**であって、設定上の root ではない。
        // 部分木を渡す呼び方（いまは無い）を足すと、その外を指す symlink が落ちる
        canonical_root: &canonical_path,
        ancestors: vec![canonical_path.clone()],
        depth: 0,
    };
    build_file_tree_recursive(&canonical_path, &walk)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `ws/self -> .` が1本あるだけでプロセスごと落ちていた。
    /// Rust のスタックオーバーフローは `catch_unwind` できないので、
    /// `get_file_tree` は `Err` すら返せず、起動のたびに無言で落ちる
    #[test]
    fn a_symlink_pointing_at_itself_does_not_recurse_forever() {
        let tmp = std::env::temp_dir().join(format!("obs-shogi-tree-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("2026/08")).expect("作れない");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&tmp, tmp.join("self")).expect("張れない");
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&tmp, tmp.join("self")).expect("張れない");

        let root = fs::canonicalize(&tmp).expect("解決できない");
        let walk = Walk {
            canonical_root: &root,
            ancestors: vec![root.clone()],
            depth: 0,
        };

        let node = build_file_tree_recursive(&root, &walk).expect("走査できない");
        let children = node.children.expect("子が無い");

        // `self` は自分を指すので降りない。`2026` は普通のディレクトリなので残る
        assert!(children.iter().any(|c| c.name == "2026"));
        assert!(
            children.iter().all(|c| c.name != "self"),
            "自分を指す symlink を降りている"
        );

        let _ = fs::remove_dir_all(&tmp);
    }

    /// root の中で閉じた symlink は普通の使い方なので残す
    #[test]
    fn keeps_a_symlink_that_stays_inside_the_root() {
        let tmp = std::env::temp_dir().join(format!("obs-shogi-tree-in-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("2026/08")).expect("作れない");

        #[cfg(unix)]
        std::os::unix::fs::symlink(tmp.join("2026/08"), tmp.join("current")).expect("張れない");
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(tmp.join("2026/08"), tmp.join("current"))
            .expect("張れない");

        let root = fs::canonicalize(&tmp).expect("解決できない");
        let walk = Walk {
            canonical_root: &root,
            ancestors: vec![root.clone()],
            depth: 0,
        };

        let node = build_file_tree_recursive(&root, &walk).expect("走査できない");
        let children = node.children.expect("子が無い");

        assert!(
            children.iter().any(|c| c.name == "current"),
            "root の中で閉じた symlink を落としている"
        );

        let _ = fs::remove_dir_all(&tmp);
    }
}
