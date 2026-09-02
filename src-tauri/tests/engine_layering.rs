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

/// `use ...;` を1つずつ返す。**行で切らない。**
///
/// rustfmt は100桁を超える `use` を波括弧で折る。行単位で見ていると、
/// 折られた `use crate::engine::{` の行は中身が空に見えて**辺が1本も出ない**。
/// 依存が増えたモジュールほど検査から外れる——段の違反が起きやすい側で先に穴が開く。
fn use_statements(source: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut buffer = String::new();

    for line in source.lines() {
        let line = line.trim();
        if buffer.is_empty() {
            if !line.starts_with("use ") && !line.starts_with("pub use ") {
                continue;
            }
            buffer.push_str(line);
        } else {
            buffer.push(' ');
            buffer.push_str(line);
        }
        if buffer.contains(';') {
            found.push(std::mem::take(&mut buffer));
        }
    }
    found
}

/// 1つの `use` が指す先。段の名前と、`engine/` の外への参照。
///
/// `depth` は `engine/` からの相対パスの要素数（`protocol.rs` なら1、
/// `game/session.rs` なら2）。**`super` を数えた数が `depth` と一致したとき、
/// そこは `engine` 直下**——`game/session.rs` の `super::super::state::AppState` は
/// `crate::engine::state::AppState` と同じものを指す。
///
/// `super` が足りなければ `engine` の中の枝（`game::types` など）で、段の辺にならない。
/// 多ければ `engine` の外へ出ている。
fn resolve(statement: &str, depth: usize) -> (BTreeSet<String>, Option<String>) {
    let body = statement
        .trim_start_matches("pub ")
        .trim_start_matches("use ")
        .trim();
    let outside = || Some(statement.trim_end_matches(';').to_string());

    if let Some(rest) = body.strip_prefix("crate::engine::") {
        return (imports_from(rest), None);
    }
    if body.starts_with("crate::") {
        return (BTreeSet::new(), outside());
    }

    let mut levels = 0usize;
    let mut rest = body;
    while let Some(next) = rest.strip_prefix("super::") {
        levels += 1;
        rest = next;
    }
    match levels.cmp(&depth) {
        std::cmp::Ordering::Equal => (imports_from(rest), None),
        std::cmp::Ordering::Greater => (BTreeSet::new(), outside()),
        // `engine` の中の枝。段を割っていないので辺として意味を持たない
        std::cmp::Ordering::Less => (BTreeSet::new(), None),
    }
}

/// そのファイルが `use` している `engine` 直下のモジュール名と、外への参照。
fn scan_file(source: &str, depth: usize) -> (BTreeSet<String>, Vec<String>) {
    let mut edges = BTreeSet::new();
    let mut outside = Vec::new();

    for statement in use_statements(source) {
        let (names, out) = resolve(&statement, depth);
        edges.extend(names);
        outside.extend(out);
    }
    (edges, outside)
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
        let (targets, _) = scan_file(&source, relative.components().count());
        let edges = graph.entry(module.clone()).or_default();
        for target in targets {
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

/// 走査そのものを、文字列を直に食わせて確かめる。
///
/// **現物を食わせて「既知の辺が取れている」では、取れていない綴りが増えても気付けない。**
/// 拾うべき形と拾ってはいけない形を1つずつ並べて、境目を固定する。
#[test]
fn the_scanner_reads_every_spelling_of_use() {
    // 1行に収まる形
    let (edges, out) = scan_file("use crate::engine::state::AppState;\n", 2);
    assert_eq!(
        edges,
        ["state"].map(String::from).into(),
        "素の形が取れていない"
    );
    assert!(out.is_empty());

    // **折り返された波括弧。** rustfmt が100桁を超えると自動でこう折る
    let source = "use crate::engine::{\n    protocol::UsiProtocol,\n    state::AppState,\n};\n";
    let (edges, _) = scan_file(source, 1);
    assert_eq!(
        edges,
        ["protocol", "state"].map(String::from).into(),
        "折り返した `use` から辺が取れていない"
    );

    // 1行に収まる波括弧
    let (edges, _) = scan_file("use crate::engine::{types::*, utils::cmd_summary};\n", 1);
    assert_eq!(edges, ["types", "utils"].map(String::from).into());

    // **`super` を数えた数が深さと一致すれば `engine` 直下。**
    // `game/session.rs`（深さ2）の `super::super::state` は `crate::engine::state` と同じ
    let (edges, _) = scan_file("use super::super::state::AppState;\n", 2);
    assert_eq!(
        edges,
        ["state"].map(String::from).into(),
        "`super::super::` が段の辺として取れていない"
    );

    // 足りなければ `engine` の中の枝。段を割っていないので辺にならない
    let (edges, out) = scan_file("use super::types::Side;\n", 2);
    assert!(edges.is_empty(), "`game` の中への辺を段として数えている");
    assert!(out.is_empty());

    // `engine/` 直下（深さ1）の `super` は `engine` そのもの
    let (edges, _) = scan_file("use super::protocol::UsiProtocol;\n", 1);
    assert_eq!(edges, ["protocol"].map(String::from).into());

    // **多すぎれば `engine` の外。** `crate::CLOSE_TIMEOUT` と同じものを指す
    let (edges, out) = scan_file("use super::super::CLOSE_TIMEOUT;\n", 1);
    assert!(edges.is_empty());
    assert_eq!(
        out.len(),
        1,
        "`super` を数えすぎた形が外への参照になっていない"
    );

    let (_, out) = scan_file("use crate::file_system::open;\n", 1);
    assert_eq!(out.len(), 1, "`crate::` の他の枝が外への参照になっていない");
}

/// `engine/` が crate の他の枝を知らないこと。
///
/// **段の一番上より、さらに上。** ここを見ないと、`engine` の中から
/// `crate::CLOSE_TIMEOUT` のように上を引く行が素通りする
/// （`use crate::engine::` で始まらないので、段の走査には現れない）。
///
/// `super` を数えすぎた形（`analyzer.rs` の `use super::super::X`）も同じところを指す。
#[test]
fn the_engine_does_not_reach_out_of_itself() {
    let root = engine_dir();
    let mut outside = Vec::new();

    for path in rust_files(&root) {
        let relative = path.strip_prefix(&root).unwrap_or(&path).to_path_buf();
        let source = fs::read_to_string(&path).unwrap_or_default();
        let (_, reaching) = scan_file(&source, relative.components().count());
        for line in reaching {
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
