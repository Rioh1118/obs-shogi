//! ワークスペースを歩いて、画面に出すツリーを組む。

use std::fs;
use std::path::{Path, PathBuf};

use crate::fs::error::FsError;
use crate::fs::path::{generate_id, get_file_extension, is_kifu_file, is_under};

use super::types::FileTreeNode;

/// 降りてよい深さの上限。**再帰のフレーム数を止める。**
///
/// `followed` は同じ実体を2度辿らないだけなので、**相異なる**ディレクトリを鎖状に
/// symlink で繋ぐと深さがディレクトリ数まで伸びる。走査は再帰なので、
/// 深いほどスタックが積み上がる。Rust のスタックオーバーフローは `catch_unwind`
/// できず、`get_file_tree` は `Err` すら返せないまま落ちる。
///
/// 実体のディレクトリだけでこの深さに達する棋譜庫は無い
const MAX_DEPTH: usize = 64;

/// 作ってよいノード数の上限。**総数を止める。**
///
/// 深さの上限では足りない。`ws/a0..a7` の中で互いを指す symlink を張ると、
/// 経路が順列に展開されて**深さ8のまま175万ノード**になる。深さの上限は
/// 一度も効かない。1ノードごとに UUID とフルパスの String を持つので、
/// 数百 MB の割り当てと直列化になり、`get_file_tree` は同期実行なので応答が返らない。
///
/// **ファイルも数える。** ディレクトリの下降だけを止めると、1つのフォルダに
/// 数十万の `.csa` を置いた形（floodgate の取り込み）で上限が効かない。
///
/// 20万は、想定する最大の棋譜庫（年/月/日で切って数万局）の1桁上に置いた値。
/// 実測で足りなくなったら、`find <root> | wc -l` の結果を根拠として上げる
const MAX_NODES: usize = 200_000;

/// 走査の途中の状態。
///
/// `followed` は**root と、いまの経路で辿った symlink の解決先**を積む。
/// root の中で閉じた symlink は一覧に出す（`ws/current -> ws/2026/08` は普通の
/// 使い方）ので、これが無いと自分や祖先を指す1本で同じ部分木を積み直す。
/// 深さは `MAX_DEPTH` が止めるが、そこまでの部分木が毎回複製される。
///
/// **root を最初に入れておく。** 入れないと `ws/self -> .` が1段降りてから
/// 初めて弾かれる。
///
/// **経路ごとに持ち、`&mut` で回す。** 訪問済みの集合にすると、同じ実体を指す
/// 2本の symlink のうち後の1本が黙って消える。複製にすると項目ごとに Vec を作る
struct Walk<'a> {
    canonical_root: &'a Path,
    followed: Vec<PathBuf>,
    depth: usize,
    /// あと何ノード作ってよいか。**走査全体で1つ**を分け合う。
    ///
    /// 0 になったところで、そのディレクトリを `truncated` にして以降の項目を積まない。
    /// 枝ごとに持たせると、枝の数だけ上限が掛け算になって上限にならない
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

    // **深さの上限を見るのはここだけ。** 下のループはノード数しか見ないので、
    // この条件を外すと `MAX_DEPTH` が完全に消える（結果はスタックオーバーフローで、
    // `catch_unwind` できずプロセスごと落ちる）
    if is_dir && walk.depth >= MAX_DEPTH {
        node.truncated = true;
    } else if is_dir {
        let mut children = Vec::new();

        // **降りる前に並べる。** `read_dir` の順は OS まかせ（APFS はハッシュ順）なので、
        // 並べずに打ち切ると、同じディレクトリでも読み直すたびに消える行が入れ替わる。
        // キーは `OsString` を新しく確保するので `sort_by_cached_key`
        // （`sort_by_key` はキー関数を比較のたびに呼ぶ）
        let mut entries: Vec<_> = fs::read_dir(path)
            .map_err(FsError::from)?
            .filter_map(Result::ok)
            .collect();
        entries.sort_by_cached_key(|entry| entry.file_name());

        // 予算が尽きていても `read_dir` は済んでいる。**空のディレクトリで
        // 「以降は出ません」と出さない**ために、1つでも隠したときだけ印を立てる。
        // ここを入口の条件（`budget == 0` で降りない）にすると、予算が
        // ちょうど尽きた瞬間に降りた空のフォルダにも印が付く
        for entry in entries {
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

            let mut pushed = false;
            if file_type.is_symlink() {
                let Ok(resolved) = fs::canonicalize(&child_path) else {
                    continue;
                };
                if !is_under(walk.canonical_root, &resolved) {
                    continue;
                }
                // 自分か祖先を指す symlink。降りると同じ部分木を積み直す
                if walk.followed.contains(&resolved) {
                    continue;
                }
                walk.followed.push(resolved);
                pushed = true;
            }

            if !child_path.is_dir() && !is_kifu_file(&child_path) {
                // 一覧に出さない項目（`.DS_Store` など）。予算にも打ち切りにも数えない。
                // 数えると、隠した行が1つも無いのに「以降は出ません」と出る
                if pushed {
                    walk.followed.pop();
                }
                continue;
            }

            if walk.budget == 0 {
                node.truncated = true;
                if pushed {
                    walk.followed.pop();
                }
                break;
            }

            walk.depth += 1;
            walk.budget -= 1;
            let built = build_file_tree_recursive(&child_path, walk);
            walk.depth -= 1;
            if pushed {
                walk.followed.pop();
            }
            match built {
                Ok(child_node) => children.push(child_node),
                // 1項目を読めなくても一覧全体は返す。返さないと、
                // 権限の無いフォルダが1つあるだけでツリーが出なくなる
                Err(_) => continue,
            }
        }

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

/// 渡されたディレクトリを根としてツリーを組む。
///
/// **root の外へ出ないことはここが受け持つ。** 呼び出し側の関門は引数1点しか
/// 見ないので、走査の途中で symlink が外へ出るかどうかは見られない。
pub fn walk_from(root_path: &Path) -> Result<FileTreeNode, FsError> {
    // symlink まで解決しておく。解決前のパスを `canonical_root` にすると、
    // 配下かどうかの判定が解決後のパスと噛み合わない
    let canonical_path = root_path.canonicalize().map_err(FsError::from)?;
    let mut walk = Walk {
        // **引数のディレクトリ**であって、設定上の root ではない。
        // 部分木を渡す呼び方（いまは無い）を足すと、その外を指す symlink が落ちる
        canonical_root: &canonical_path,
        followed: vec![canonical_path.clone()],
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

    /// ディレクトリへの symlink。**張れたかを返す。**
    ///
    /// Windows は開発者モードか権限が要る。ここで `return` しても呼び出し側の
    /// テストは続くので、飛ばす判断は呼び出し側でしかできない
    #[must_use]
    fn symlink_dir(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).expect("張れない");
            true
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(target, link).is_ok()
        }
    }

    fn walk_children(dir: &Path) -> Vec<FileTreeNode> {
        let root = fs::canonicalize(dir).expect("解決できない");
        let mut walk = Walk {
            canonical_root: &root,
            followed: vec![root.clone()],
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

    /// `ws/self -> .` は自分を指すので降りない。降りると同じ部分木を
    /// 積み直し、深さの上限まで複製が増える
    #[test]
    fn a_symlink_pointing_at_itself_does_not_recurse_forever() {
        let tmp = std::env::temp_dir().join(format!("obs-shogi-tree-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("2026/08")).expect("作れない");

        if !symlink_dir(&tmp, &tmp.join("self")) {
            return; // symlink を張れない環境（Windows の既定）
        }

        let root = fs::canonicalize(&tmp).expect("解決できない");
        let mut walk = Walk {
            canonical_root: &root,
            followed: vec![root.clone()],
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
        if !symlink_dir(&base.join("outside"), &ws.join("escape")) {
            return; // symlink を張れない環境（Windows の既定）
        }

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
                if !symlink_dir(&ws.join(to), &ws.join(from).join(format!("to-{to}"))) {
                    return; // symlink を張れない環境（Windows の既定）
                }
            }
        }

        let root = fs::canonicalize(&ws).expect("解決できない");
        let mut walk = Walk {
            canonical_root: &root,
            followed: vec![root.clone()],
            depth: 0,
            budget: 500,
        };
        let node = build_file_tree_recursive(&root, &mut walk).expect("走査できない");

        // 予算 + 自分。**余裕を持たせない。** `<= 600` のように緩めると、
        // 予算の減らし忘れが100ノードぶん見逃される
        assert!(count_nodes(&node) <= 501, "ノード数が抑えられていない");

        let _ = fs::remove_dir_all(&base);
    }

    /// 予算はファイルも数える。数えないと、1つのフォルダに数十万の棋譜を置いた形
    /// （floodgate の取り込み）で上限が効かない
    #[test]
    fn the_node_budget_counts_files_too() {
        let base = temp_dir("budget");
        let ws = base.join("ws");
        fs::create_dir_all(&ws).expect("作れない");
        for i in 0..40 {
            fs::write(ws.join(format!("{i:03}.kif")), "").expect("書けない");
        }

        let root = fs::canonicalize(&ws).expect("解決できない");
        let mut walk = Walk {
            canonical_root: &root,
            followed: vec![root.clone()],
            depth: 0,
            budget: 10,
        };
        let node = build_file_tree_recursive(&root, &mut walk).expect("走査できない");

        assert_eq!(
            count_nodes(&node),
            11,
            "予算を超えて積んでいる（自分 + 10）"
        );
        assert!(node.truncated, "打ち切ったことを返していない");

        let _ = fs::remove_dir_all(&base);
    }

    /// 予算がちょうど尽きた瞬間に降りたフォルダに、隠した行が1つも無いのに
    /// 「以降は出ません」と出さない
    #[test]
    fn an_empty_folder_at_the_budget_edge_is_not_marked_truncated() {
        let base = temp_dir("edge");
        let ws = base.join("ws");
        fs::create_dir_all(ws.join("empty")).expect("作れない");

        let root = fs::canonicalize(&ws).expect("解決できない");
        let mut walk = Walk {
            canonical_root: &root,
            followed: vec![root.clone()],
            depth: 0,
            // `empty` へ降りるぶんだけ。降りた先では 0 になっている
            budget: 1,
        };
        let node = build_file_tree_recursive(&root, &mut walk).expect("走査できない");

        let child = &node.children.as_deref().expect("子が無い")[0];
        assert_eq!(child.name, "empty");
        assert!(
            !child.truncated,
            "隠した行が無いのに打ち切りの印が付いている"
        );

        let _ = fs::remove_dir_all(&base);
    }

    /// 打ち切る位置が読み直しのたびに変わらない。`read_dir` の順は OS まかせ
    #[test]
    fn truncation_falls_on_the_same_entries_every_time() {
        let base = temp_dir("stable");
        let ws = base.join("ws");
        fs::create_dir_all(&ws).expect("作れない");
        for i in 0..20 {
            fs::write(ws.join(format!("{i:03}.kif")), "").expect("書けない");
        }

        let names = |budget: usize| {
            let root = fs::canonicalize(&ws).expect("解決できない");
            let mut walk = Walk {
                canonical_root: &root,
                followed: vec![root.clone()],
                depth: 0,
                budget,
            };
            build_file_tree_recursive(&root, &mut walk)
                .expect("走査できない")
                .children
                .unwrap_or_default()
                .into_iter()
                .map(|c| c.name)
                .collect::<Vec<_>>()
        };

        assert_eq!(names(5), names(5));
        assert_eq!(
            names(5),
            vec!["000.kif", "001.kif", "002.kif", "003.kif", "004.kif"]
        );

        let _ = fs::remove_dir_all(&base);
    }

    /// root の中で閉じた symlink は普通の使い方なので残す
    #[test]
    fn keeps_a_symlink_that_stays_inside_the_root() {
        let tmp = std::env::temp_dir().join(format!("obs-shogi-tree-in-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("2026/08")).expect("作れない");

        if !symlink_dir(&tmp.join("2026/08"), &tmp.join("current")) {
            return; // symlink を張れない環境（Windows の既定）
        }

        let root = fs::canonicalize(&tmp).expect("解決できない");
        let mut walk = Walk {
            canonical_root: &root,
            followed: vec![root.clone()],
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
