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
//! 走査は `use super::` と `use crate::engine::` の行だけ。関数の中で
//! 完全修飾で書けば素通りするが、**それは `use` を書くより目立つ**ので
//! 走査を厚くするより読み手に任せる。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

/// 段。**下ほど土台。** 同じ段の中の依存は許す（環でなければよい）。
///
/// 増やすときは、その段が「何を決める場所か」を1行で言えるときだけ。
/// 言えないなら、それは段ではなく置き場の都合。
const LAYERS: &[(&str, &str)] = &[
    ("types", "線に出す形と失敗の型。何も決めない"),
    ("utils", "USI の行を値に写す。何も決めない"),
    ("protocol", "1本のプロセスへ何を送れるか"),
    ("registry", "どのプロセスが生きているか"),
    ("game", "対局の状態機械と持ち時間"),
    ("analyzer", "解析の探索1回ぶん"),
    ("bridge", "解析のファサード"),
    ("state", "Tauri が持つ持ち物"),
    ("commands", "Tauri コマンドの入口"),
];

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

/// `use super::x` と `use crate::engine::x` から `x` を拾う。
fn imports_of(source: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    for line in source.lines() {
        let line = line.trim_start();
        let rest = line
            .strip_prefix("use super::")
            .or_else(|| line.strip_prefix("use crate::engine::"));
        let Some(rest) = rest else { continue };

        let name: String = rest
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if !name.is_empty() {
            found.insert(name);
        }
    }
    found
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
        let edges = graph.entry(module.clone()).or_default();
        for target in imports_of(&source) {
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
    for (name, _) in LAYERS {
        assert!(
            graph.contains_key(*name),
            "段に挙げた `{name}` が現物に無い。消したなら段からも消すこと"
        );
    }
}

/// 段に載っていないモジュールを残さない。
///
/// **載せ忘れは素通りする**ので、ここで拾う。新しいモジュールを足した人は、
/// それが何を決める場所かを `LAYERS` に1行で書くことになる。
#[test]
fn every_module_is_placed_on_a_layer() {
    let placed: BTreeSet<&str> = LAYERS.iter().map(|(n, _)| *n).collect();
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

/// 環が無いこと。
///
/// 環は「上下が言えない」そのものなので、段の違反より重い。
/// 先に見つけて、どの2つが噛み合っているかを名指しで出す。
#[test]
fn no_module_depends_on_something_that_depends_back() {
    let graph = graph();
    let mut cycles = Vec::new();

    for (from, targets) in &graph {
        for to in targets {
            let Some(back) = graph.get(to) else { continue };
            if back.contains(from) && from < to {
                cycles.push(format!("{from} ⇄ {to}"));
            }
        }
    }

    assert!(
        cycles.is_empty(),
        "モジュールが環になっている。どちらが土台かが言えない:\n{}",
        cycles.join("\n")
    );
}

/// 下の段が上の段を `use` しないこと。
#[test]
fn dependencies_only_point_downwards() {
    let rank: BTreeMap<&str, usize> = LAYERS
        .iter()
        .enumerate()
        .map(|(i, (name, _))| (*name, i))
        .collect();

    let mut upward = Vec::new();
    for (from, targets) in graph() {
        let Some(&from_rank) = rank.get(from.as_str()) else {
            continue;
        };
        for to in targets {
            let Some(&to_rank) = rank.get(to.as_str()) else {
                continue;
            };
            if to_rank > from_rank {
                upward.push(format!("{from} -> {to}"));
            }
        }
    }

    assert!(
        upward.is_empty(),
        "下の段が上の段を使っている。共有したいものは共有できる段まで下げること:\n{}",
        upward.join("\n")
    );
}
