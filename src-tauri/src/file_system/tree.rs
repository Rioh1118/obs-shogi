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

/// 作ってよいノード数の上限。
///
/// 深さの上限だけでは足りない。`ws/a0..a7` の中で互いを指す symlink を張ると、
/// 経路が順列に展開されて**深さ8のまま175万ノード**になる。1ノードごとに
/// UUID とフルパスの String を持つので、数百 MB の割り当てと直列化になり、
/// `get_file_tree` は同期実行なので応答が返らない
const MAX_NODES: usize = 200_000;

/// 走査の途中の状態。
///
/// `ancestors` は**辿った symlink の解決先**を積む。root の中で閉じた symlink は
/// 一覧に出す（`ws/current -> ws/2026/08` は普通の使い方）ので、
/// `ws/self -> .` のような自分を指すものが1本あるだけで無限に降りてしまう。
///
/// **経路ごとに持ち、`&mut` で回す。** 訪問済みの集合にすると、同じ実体を指す
/// 2本の symlink のうち後の1本が黙って消える。複製にすると項目ごとに Vec を作る
struct Walk<'a> {
    canonical_root: &'a Path,
    ancestors: Vec<PathBuf>,
    depth: usize,
    /// 残り。0 になったらその枝を `truncated` にして降りない
    budget: usize,
}

fn build_file_tree_recursive(path: &Path, walk: &mut Walk) -> Result<FileTreeNode, FsError> {
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
        truncated: false,
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

    if is_dir && (walk.depth >= MAX_DEPTH || walk.budget == 0) {
        node.truncated = true;
    } else if is_dir {
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

            let mut followed = false;
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
                walk.ancestors.push(resolved);
                followed = true;
            }

            // ディレクトリまたは棋譜ファイルのみを含める
            if child_path.is_dir() || is_kifu_file(&child_path) {
                walk.depth += 1;
                walk.budget = walk.budget.saturating_sub(1);
                let built = build_file_tree_recursive(&child_path, walk);
                walk.depth -= 1;
                if followed {
                    walk.ancestors.pop();
                }
                match built {
                    Ok(child_node) => children.push(child_node),
                    Err(_) => continue, // エラーは無視して続行
                }
            } else if followed {
                walk.ancestors.pop();
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
    let mut walk = Walk {
        // **引数のディレクトリ**であって、設定上の root ではない。
        // 部分木を渡す呼び方（いまは無い）を足すと、その外を指す symlink が落ちる
        canonical_root: &canonical_path,
        ancestors: vec![canonical_path.clone()],
        depth: 0,
        budget: MAX_NODES,
    };
    build_file_tree_recursive(&canonical_path, &mut walk)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("obs-shogi-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    /// ディレクトリへの symlink。Windows は開発者モードか権限が要るので、
    /// 張れない環境ではテストごと飛ばす（黙って通さない）
    fn symlink_dir(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).expect("張れない");
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(target, link).is_err() {
            eprintln!("symlink を張れないので飛ばす（開発者モードが要る）");
            return;
        }
    }

    fn walk_children(dir: &Path) -> Vec<FileTreeNode> {
        let root = fs::canonicalize(dir).expect("解決できない");
        let mut walk = Walk {
            canonical_root: &root,
            ancestors: vec![root.clone()],
            depth: 0,
            budget: MAX_NODES,
        };
        build_file_tree_recursive(&root, &mut walk)
            .expect("走査できない")
            .children
            .unwrap_or_default()
    }

    fn count_nodes(node: &FileTreeNode) -> usize {
        1 + node
            .children
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(count_nodes)
            .sum::<usize>()
    }

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
        let mut walk = Walk {
            canonical_root: &root,
            ancestors: vec![root.clone()],
            depth: 0,
            budget: MAX_NODES,
        };

        let node = build_file_tree_recursive(&root, &mut walk).expect("走査できない");
        let children = node.children.expect("子が無い");

        // `self` は自分を指すので降りない。`2026` は普通のディレクトリなので残る
        assert!(children.iter().any(|c| c.name == "2026"));
        assert!(
            children.iter().all(|c| c.name != "self"),
            "自分を指す symlink を降りている"
        );

        let _ = fs::remove_dir_all(&tmp);
    }

    /// root の外へ出る symlink は落とす。一覧がホーム以下まで広がるのを止める
    /// 唯一の場所なので、無効化する変異で必ず落ちる形にしておく
    #[test]
    fn drops_a_symlink_that_escapes_the_root() {
        let base = temp_dir("escape");
        let ws = base.join("ws");
        fs::create_dir_all(ws.join("2026")).expect("作れない");
        fs::create_dir_all(base.join("outside/secret")).expect("作れない");
        symlink_dir(&base.join("outside"), &ws.join("escape"));

        let children = walk_children(&ws);

        assert!(children.iter().any(|c| c.name == "2026"));
        assert!(
            children.iter().all(|c| c.name != "escape"),
            "root の外へ出る symlink を残している"
        );

        let _ = fs::remove_dir_all(&base);
    }

    /// 互いを指す symlink の網。循環はしないが、経路が順列に展開されて
    /// ノード数が指数的に増える。深さは浅いままなので `MAX_DEPTH` は効かない
    #[test]
    fn a_web_of_symlinks_does_not_blow_up_the_node_count() {
        let base = temp_dir("web");
        let ws = base.join("ws");
        let names = ["a0", "a1", "a2", "a3", "a4", "a5"];
        for name in names {
            fs::create_dir_all(ws.join(name)).expect("作れない");
        }
        for from in names {
            for to in names {
                if from == to {
                    continue;
                }
                symlink_dir(&ws.join(to), &ws.join(from).join(format!("to-{to}")));
            }
        }

        let root = fs::canonicalize(&ws).expect("解決できない");
        let mut walk = Walk {
            canonical_root: &root,
            ancestors: vec![root.clone()],
            depth: 0,
            budget: 500,
        };
        let node = build_file_tree_recursive(&root, &mut walk).expect("走査できない");

        assert!(count_nodes(&node) <= 600, "ノード数が抑えられていない");

        let _ = fs::remove_dir_all(&base);
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
        let mut walk = Walk {
            canonical_root: &root,
            ancestors: vec![root.clone()],
            depth: 0,
            budget: MAX_NODES,
        };

        let node = build_file_tree_recursive(&root, &mut walk).expect("走査できない");
        let children = node.children.expect("子が無い");

        assert!(
            children.iter().any(|c| c.name == "current"),
            "root の中で閉じた symlink を落としている"
        );

        let _ = fs::remove_dir_all(&tmp);
    }
}
