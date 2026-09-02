//! `engine/` の依存を**下向きだけ**に保つ。
//!
//! TS 側は `import/no-cycle` と `no-restricted-imports` がレイヤを強制している
//! （`CLAUDE.md` の「依存の方向」）。Rust 側には同じものが無く、
//! `AppState` が解析のファサードと同居して環になっていた。
//!
//! **環があると「どちらが土台か」が言えない。** 片方を読むのにもう片方が要り、
//! 片方を差し替えるともう片方が壊れる。テストの継ぎ目も作れない
//! （下の層だけを組んで回す、ができない）。
//!
//! ここで見るのは2つ。
//!
//! 1. モジュール間に環が無いこと
//! 2. 決めた段より上のものを、下の段が `use` していないこと
//!
//! ## 走査の限界
//!
//! 拾うのは `use` の行だけ。関数の中で完全修飾に書けば素通りするが、
//! **それは `use` を書くより目立つ**ので走査を厚くするより読み手に任せる。
//!
//! 拾う形は3つ。`use super::x`、`use crate::engine::x`、そして
//! **波括弧で並べた形**（`use crate::engine::{a::A, b::B}`）。
//! **波括弧を落とすと、書き方ひとつで段を跨げる**——`use crate::engine::state::X`
//! は落ちるのに `use crate::engine::{state::X}` は通る、という形になる。
//! 走査が空振りしていないことは `the_scanner_actually_walks_the_engine` が見る。
//!
//! `use super::` は**そのファイルの親**を指す。`game/*.rs` の `use super::types`
//! は `engine::types` ではなく `engine::game::types` なので、段の名前空間に
//! 混ぜない（`game` の中は段を割らないので、辺として意味を持たない）。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

/// 段。**「何を決める場所か」と「何を使ってよいか」を並べる。**
///
/// 全順序にしない。順序を付けた分だけ**許可が生まれる**——`game` と
/// `analyzer` に上下を付けると、解析のファサードが対局の台帳を持つ形
/// （もともと環になっていた辺）が「上から下」として通ってしまう。
/// 上下が言えない2つは**同位**として持つ。
///
/// 増やすときは、その段が「何を決める場所か」を1行で言えるときだけ。
/// 言えないなら、それは段ではなく置き場の都合。
struct Layer {
    name: &'static str,
    /// 何を決める場所か
    decides: &'static str,
    /// `use` してよい段
    may_use: &'static [&'static str],
}

const LAYERS: &[Layer] = &[
    Layer {
        name: "types",
        decides: "線に出す形と失敗の型。何も決めない",
        may_use: &[],
    },
    Layer {
        name: "utils",
        decides: "USI の行を値に写す変換と、ログの間引き・伏字",
        may_use: &["types"],
    },
    Layer {
        name: "protocol",
        decides: "1本のプロセスへ何を送れるか",
        may_use: &["types", "utils"],
    },
    Layer {
        name: "registry",
        decides: "どのプロセスが生きているか",
        may_use: &["types", "utils", "protocol"],
    },
    // `game` と `analyzer` は同位。互いを知らない
    Layer {
        name: "game",
        decides: "対局の状態機械と持ち時間",
        may_use: &["types", "utils", "protocol", "registry"],
    },
    Layer {
        name: "analyzer",
        decides: "解析の探索1回ぶん",
        may_use: &["types", "utils", "protocol", "registry"],
    },
    Layer {
        name: "bridge",
        decides: "解析のファサード",
        may_use: &["types", "utils", "protocol", "registry", "analyzer"],
    },
    Layer {
        name: "state",
        decides: "Tauri が持つ持ち物",
        may_use: &["types", "registry", "game", "analyzer", "bridge"],
    },
    Layer {
        name: "commands",
        decides: "Tauri コマンドの入口",
        may_use: &[
            "types", "utils", "protocol", "registry", "game", "analyzer", "bridge", "state",
        ],
    },
];

fn layer(name: &str) -> Option<&'static Layer> {
    LAYERS.iter().find(|l| l.name == name)
}

fn engine_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/engine")
}

/// `src/engine/` からの相対で、そのファイルが属するモジュール名。
///
/// `game/session.rs` は `game`。段は `game` の中では割らない
/// （割ると、対局の内部を外から段として参照させることになる）。
fn module_of(relative: &Path) -> String {
    let first = relative
        .components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .unwrap_or_default();
    first.trim_end_matches(".rs").to_string()
}

fn rust_files(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(rust_files(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            found.push(path);
        }
    }
    found.sort();
    found
}

/// 先頭の識別子を1つ取る。`{` や `*` で始まっていれば `None`。
fn leading_name(rest: &str) -> Option<String> {
    let name: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    (!name.is_empty()).then_some(name)
}

/// `use crate::engine::x` から `x` を拾う。**波括弧で並べた形も開く。**
///
/// `use super::` は `game/*.rs` では `engine::game::*` を指すので、
/// この走査では扱わない（段を割っていない場所への辺は意味を持たない）。
/// ただし `engine/` 直下のファイルでは `super` = `engine` なので、
/// そちらは呼び出し側が `crate::engine::` と同じに扱う。
fn imports_from(rest: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();

    let Some(inner) = rest.strip_prefix('{') else {
        // `use crate::engine::protocol::UsiProtocol;`
        found.extend(leading_name(rest));
        return found;
    };

    // `use crate::engine::{types::*, utils::cmd_summary};`
    // 入れ子の波括弧はこの repo に無いので、深さは数えない。
    // 出たら `every_module_is_placed_on_a_layer` が拾えない名前として現れる
    let inner = inner.trim_end_matches([';', '}']);
    for part in inner.split(',') {
        found.extend(leading_name(part.trim()));
    }
    found
}

/// そのファイルが `use` している `engine` 直下のモジュール名。
fn imports_of(source: &str, is_top_level: bool) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    for line in source.lines() {
        let line = line.trim_start();

        if let Some(rest) = line.strip_prefix("use crate::engine::") {
            found.extend(imports_from(rest));
            continue;
        }
        // `engine/` 直下なら `super` は `engine` そのもの
        if is_top_level {
            if let Some(rest) = line.strip_prefix("use super::") {
                found.extend(imports_from(rest));
            }
        }
    }
    found
}

/// `engine/` の外（`crate::` の他の枝）へ伸びる `use` があるか。
///
/// **段の一番上より、さらに上。** `engine` は crate の他の部分を知らない、が
/// 保てているかを見る。`the_close_budget_is_deliberately_short` が
/// `crate::CLOSE_TIMEOUT` を引いていたのがこれ。
fn reaches_outside(source: &str) -> Vec<String> {
    source
        .lines()
        .map(str::trim_start)
        .filter(|l| l.starts_with("use crate::") && !l.starts_with("use crate::engine::"))
        .map(|l| l.trim_end_matches(';').to_string())
        .collect()
}

/// モジュール名 → そのモジュールが `use` しているモジュール名。
fn graph() -> BTreeMap<String, BTreeSet<String>> {
    let root = engine_dir();
    let mut graph: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    for path in rust_files(&root) {
        let relative = path.strip_prefix(&root).unwrap_or(&path);
        let module = module_of(relative);
        if module == "mod" {
            continue;
        }
        let source = fs::read_to_string(&path).unwrap_or_default();
        let is_top_level = relative.components().count() == 1;
        let edges = graph.entry(module.clone()).or_default();
        for target in imports_of(&source, is_top_level) {
            if target != module {
                edges.insert(target);
            }
        }
    }
    graph
}

#[test]
fn the_scanner_actually_walks_the_engine() {
    let graph = graph();
    assert!(
        graph.len() >= LAYERS.len(),
        "モジュールを {} 個しか拾えていない",
        graph.len()
    );
    for Layer { name, .. } in LAYERS {
        assert!(
            graph.contains_key(*name),
            "段に挙げた `{name}` が現物に無い。消したなら段からも消すこと"
        );
    }

    // **辺が1本も取れていなくてもモジュール名は並ぶ。** 走査が空振りすると
    // 「違反0」で緑になるので、既知の辺を名指しで固定する。
    // `protocol.rs` は波括弧で `use` しているので、そこが取れていれば
    // 波括弧を開けている
    for (from, to) in [
        ("registry", "protocol"),
        ("protocol", "types"),
        ("state", "game"),
    ] {
        assert!(
            graph.get(from).is_some_and(|e| e.contains(to)),
            "既知の辺 `{from} -> {to}` が取れていない。走査が空振りしている"
        );
    }
}

/// `engine/` が crate の他の枝を知らないこと。
///
/// **段の一番上より、さらに上。** ここを見ないと、`engine` の中から
/// `crate::CLOSE_TIMEOUT` のように上を引く行が素通りする
/// （`use crate::engine::` で始まらないので、段の走査には現れない）。
#[test]
fn the_engine_does_not_reach_out_of_itself() {
    let root = engine_dir();
    let mut outside = Vec::new();

    for path in rust_files(&root) {
        let relative = path.strip_prefix(&root).unwrap_or(&path).to_path_buf();
        let source = fs::read_to_string(&path).unwrap_or_default();
        for line in reaches_outside(&source) {
            outside.push(format!("{}  {}", relative.display(), line));
        }
    }

    assert!(
        outside.is_empty(),
        "`engine/` の外を `use` している。共有したいものは `engine` の中へ下ろすこと:\n{}",
        outside.join("\n")
    );
}

/// 段に載っていないモジュールを残さない。
///
/// **載せ忘れは素通りする**ので、ここで拾う。新しいモジュールを足した人は、
/// それが何を決める場所かを `LAYERS` に1行で書くことになる。
#[test]
fn every_module_is_placed_on_a_layer() {
    // 「何を決める場所か」を空にしない。空で置けるなら、それは段ではなく置き場の都合
    for Layer { name, decides, .. } in LAYERS {
        assert!(
            !decides.trim().is_empty(),
            "段 `{name}` に「何を決める場所か」が書かれていない"
        );
    }

    let placed: BTreeSet<&str> = LAYERS.iter().map(|l| l.name).collect();
    let stray: Vec<String> = graph()
        .keys()
        .filter(|m| !placed.contains(m.as_str()))
        .cloned()
        .collect();

    assert!(
        stray.is_empty(),
        "段に載っていないモジュールがある。`LAYERS` に「何を決める場所か」を書くこと: {stray:?}"
    );
}

/// 環を1つ探す。見つかれば辿った順に返す。
///
/// **長さ2で打ち切らない。** `a → b → c → a` は「互いに `use` し合う2つ」を
/// 探すだけの検査には映らないのに、上下が言えないことは同じ。
/// 段を全順序にしていたころは順序が環を消していたが、同位を許した今は消えない。
fn find_cycle(graph: &BTreeMap<String, BTreeSet<String>>) -> Option<Vec<String>> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        Walking,
        Done,
    }

    fn walk(
        node: &str,
        graph: &BTreeMap<String, BTreeSet<String>>,
        marks: &mut BTreeMap<String, Mark>,
        path: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        marks.insert(node.to_string(), Mark::Walking);
        path.push(node.to_string());

        for next in graph.get(node).into_iter().flatten() {
            match marks.get(next.as_str()) {
                Some(Mark::Done) => continue,
                // いま辿っている道の上に戻った = 環
                Some(Mark::Walking) => {
                    let head = path.iter().position(|n| n == next).unwrap_or(0);
                    let mut cycle = path[head..].to_vec();
                    cycle.push(next.clone());
                    return Some(cycle);
                }
                None => {
                    if let Some(cycle) = walk(next, graph, marks, path) {
                        return Some(cycle);
                    }
                }
            }
        }

        path.pop();
        marks.insert(node.to_string(), Mark::Done);
        None
    }

    let mut marks = BTreeMap::new();
    for node in graph.keys() {
        if marks.contains_key(node.as_str()) {
            continue;
        }
        if let Some(cycle) = walk(node, graph, &mut marks, &mut Vec::new()) {
            return Some(cycle);
        }
    }
    None
}

/// 環が無いこと。
///
/// 環は「上下が言えない」そのものなので、段の違反より重い。
/// 先に見つけて、どこが噛み合っているかを名指しで出す。
#[test]
fn no_module_depends_on_something_that_depends_back() {
    let cycle = find_cycle(&graph());

    assert!(
        cycle.is_none(),
        "モジュールが環になっている。どちらが土台かが言えない:\n{}",
        cycle.unwrap_or_default().join(" -> ")
    );
}

/// **宣言そのものが環でないこと。**
///
/// `may_use` は手で書く。全順序をやめて同位を許した結果、
/// `a` が `b` を、`b` が `c` を、`c` が `a` を使ってよい、と**書けてしまう**。
/// そう書くと `dependencies_only_point_downwards` は全部通り、
/// 実際に環を作っても `no_module_depends_on_something_that_depends_back` が
/// 落ちるまで気付けない。**表のほうが先に壊れる**ので、表を先に見る。
#[test]
fn the_declared_layers_are_not_a_cycle() {
    let declared: BTreeMap<String, BTreeSet<String>> = LAYERS
        .iter()
        .map(|l| {
            (
                l.name.to_string(),
                l.may_use.iter().map(|m| m.to_string()).collect(),
            )
        })
        .collect();

    for layer in LAYERS {
        for target in layer.may_use {
            assert!(
                declared.contains_key(*target),
                "{} の may_use にある {target} が段に無い",
                layer.name
            );
        }
    }

    let cycle = find_cycle(&declared);
    assert!(
        cycle.is_none(),
        "段の表が環になっている。上下が言えない2つは同位にする（どちらの may_use にも書かない）:\n{}",
        cycle.unwrap_or_default().join(" -> ")
    );
}

/// 許していない段を `use` していないこと。
#[test]
fn dependencies_only_point_downwards() {
    let mut upward = Vec::new();
    for (from, targets) in graph() {
        let Some(from_layer) = layer(&from) else {
            continue;
        };
        for to in targets {
            if layer(&to).is_none() {
                continue;
            }
            if !from_layer.may_use.contains(&to.as_str()) {
                upward.push(format!(
                    "{from} -> {to}（{} が使ってよいのは {:?}）",
                    from_layer.name, from_layer.may_use
                ));
            }
        }
    }

    assert!(
        upward.is_empty(),
        "許していない段を使っている。共有したいものは共有できる段まで下げること:\n{}",
        upward.join("\n")
    );
}
