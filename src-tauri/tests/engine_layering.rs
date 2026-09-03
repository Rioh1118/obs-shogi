//! `engine/` の依存を**下向きだけ**に保つ。
//!
//! TS 側は `import/no-cycle` と `no-restricted-imports` がレイヤを強制している
//! （`CLAUDE.md` の「依存の方向」）。Rust 側に同じものが無いので、ここで見る。
//!
//! **環があると「どちらが土台か」が言えない。** 片方を読むのにもう片方が要り、
//! 片方を差し替えるともう片方が壊れる。テストの継ぎ目も作れない
//! （下の層だけを組んで回す、ができない）。
//!
//! ここで見るのは4つ。
//!
//! 1. モジュール間に環が無いこと
//! 2. 決めた段より上のものを、下の段が `use` していないこと
//! 3. `engine/` が crate の他の枝を `use` していないこと
//! 4. 段が「使わない」と決めた外部クレートを**参照していない**こと（`Layer::forbids`）
//!
//! ## 走査の限界
//!
//! **1〜3 が拾うのは `use` の行だけ。** 関数の中で完全修飾に書けば素通りするが、
//! **それは `use` を書くより目立つ**ので走査を厚くするより読み手に任せる。
//!
//! **4 は違う。** 文字列とコメントを潰した本文全体で綴りを探す——この repo は
//! `AppHandle` を1度も `use` で書かず、`app: tauri::AppHandle` と型の位置に
//! 完全修飾で置くので、`use` だけを見ると**実際に書かれる形を1つも見ない**。
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

mod scanning;

use scanning::{blank_out_noncode, mentions_crate};

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

/// 段。**「何を決める場所か」と「何を使ってよいか」を並べる。**
///
/// 全順序にしない。順序を付けた分だけ**許可が生まれる**——`game` と
/// `analyzer` に上下を付けると、解析のファサードが対局の台帳を持つ形が
/// 「上から下」として通ってしまう。上下が言えない2つは**同位**として持つ。
///
/// 増やすときは、その段が「何を決める場所か」を1行で言えるときだけ。
/// 言えないなら、それは段ではなく置き場の都合。
struct Layer {
    name: &'static str,
    /// 何を決める場所か
    decides: &'static str,
    /// `use` してよい段
    may_use: &'static [&'static str],
    /// **本文に綴りが現れてはいけない外部クレート。**
    ///
    /// `use` の行だけでなく、型の位置の完全修飾も見る（`mentions_crate`）。
    ///
    /// 許可制にしない（`tokio` / `usi` / `serde` を全部書くことになる）。
    /// ここに挙げるのは、**逆転させた境界を戻させない**ためだけ。
    forbids: &'static [&'static str],
}

const LAYERS: &[Layer] = &[
    Layer {
        name: "types",
        decides: "線に出す形と失敗の型。何も決めない",
        may_use: &[],
        forbids: &[],
    },
    Layer {
        name: "utils",
        decides: "USI の行を値に写す変換と、ログの間引き・伏字",
        may_use: &["types"],
        forbids: &[],
    },
    Layer {
        name: "protocol",
        decides: "1本のプロセスへ何を送れるか",
        may_use: &["types", "utils"],
        forbids: &[],
    },
    Layer {
        name: "registry",
        decides: "どのプロセスが生きているか",
        may_use: &["types", "protocol"],
        forbids: &[],
    },
    // `game` と `analyzer` は同位。互いを知らない
    Layer {
        name: "game",
        decides: "対局の状態機械と持ち時間",
        may_use: &["types", "utils", "protocol", "registry"],
        forbids: &["tauri"],
    },
    Layer {
        name: "analyzer",
        decides: "解析の探索1回ぶん",
        may_use: &["types", "utils", "protocol", "registry"],
        forbids: &[],
    },
    Layer {
        name: "bridge",
        decides: "解析のファサード",
        may_use: &["types", "utils", "registry", "analyzer"],
        forbids: &[],
    },
    Layer {
        name: "state",
        decides: "Tauri が持つ持ち物",
        may_use: &["registry", "game", "bridge"],
        forbids: &[],
    },
    Layer {
        name: "commands",
        decides: "Tauri コマンドの入口",
        may_use: &["types", "utils", "game", "analyzer", "state"],
        forbids: &[],
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

/// `use` の行なら、`use ` から後ろを返す。
///
/// **`pub` と可視性の括弧を落としてから見る。** `pub(crate) use` は
/// `"use "` でも `"pub use "` でも始まらないので、綴りを直に比べると
/// **走査に一度も入らない**。1行足すだけで段を跨げる形になる。
fn use_body(line: &str) -> Option<&str> {
    let line = line.trim_start();
    let line = match line.strip_prefix("pub") {
        Some(rest) => match rest.strip_prefix('(') {
            Some(inner) => inner.split_once(')').map(|(_, after)| after)?.trim_start(),
            None => rest.trim_start(),
        },
        None => line,
    };
    line.strip_prefix("use ")
}

/// `use ...;` を1つずつ返す。**行で切らない。**
///
/// rustfmt は100桁を超える `use` を波括弧で折る。行単位で見ていると、
/// 折られた `use crate::engine::{` の行は中身が空に見えて**辺が1本も出ない**。
/// 依存が増えたモジュールほど検査から外れる——段の違反が起きやすい側で先に穴が開く。
fn use_statements(source: &str) -> Vec<(String, usize)> {
    // **コメントも文字列も潰してから数える。** 潰さないと、`// mod tests {` や
    // `const A: &str = "mod x {";` の1行が幻の module を積み、閉じないので
    // 以降すべての `use super::` が1段ずれる——**辺が1本も立たなくなる**。
    // `use` の中に文字列は現れないので、潰して困らない。
    let source = &blank_out_noncode(source);
    let mut found = Vec::new();
    let mut buffer = String::new();
    // **`mod` の入れ子を数える。** `super` が指す先はファイルの位置ではなく
    // その `use` を囲む**モジュール**の数で決まる。`#[cfg(test)] mod tests` の
    // 中の `use super::super::events::..` は `engine::game::events` を指すのに、
    // ファイルの深さだけで見ると `engine::events` という**存在しない辺**が立つ。
    // `fn` の中の塊は数えない（`super` の意味を変えないので）。
    let mut modules = 0usize;
    let mut nesting: Vec<bool> = Vec::new();

    for line in source.lines() {
        let line = line.trim();

        if buffer.is_empty() && use_body(line).is_none() {
            // `mod x {` は開いた塊がモジュールであることの印
            for ch in line.chars() {
                match ch {
                    '{' => {
                        let is_module = line.contains("mod ") && nesting.is_empty();
                        nesting.push(is_module);
                        if is_module {
                            modules += 1;
                        }
                    }
                    '}' if nesting.pop() == Some(true) => modules -= 1,
                    _ => {}
                }
            }
            continue;
        }

        if buffer.is_empty() {
            buffer.push_str(line);
        } else {
            buffer.push(' ');
            buffer.push_str(line);
        }
        if buffer.contains(';') {
            found.push((std::mem::take(&mut buffer), modules));
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
fn resolve(statement: &str, depth: usize) -> Resolved {
    // **先頭の `::` を落とす。** `use ::tauri::AppHandle;` は Rust として正当な形で、
    // 落とさないと最初の分割片が空文字列になり、外部クレートとして数えられない
    let body = use_body(statement)
        .unwrap_or(statement)
        .trim()
        .trim_start_matches("::");
    let outside = || Some(statement.trim_end_matches(';').to_string());

    if let Some(rest) = body.strip_prefix("crate::engine::") {
        return Resolved::edges(imports_from(rest));
    }
    if body.starts_with("crate::") {
        return Resolved {
            outside: outside(),
            ..Resolved::default()
        };
    }

    let mut levels = 0usize;
    let mut rest = body;
    while let Some(next) = rest.strip_prefix("super::") {
        levels += 1;
        rest = next;
    }

    // **`crate::` でも `super::` でも `self::` でもないなら外部クレート。**
    // ここで分けないと、`use tauri::AppHandle;` から辺も「外への参照」も立たない
    if levels == 0 && !body.starts_with("self::") {
        return Resolved {
            crates: body
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
                .filter(|name| !name.is_empty())
                .map(str::to_string)
                .into_iter()
                .collect(),
            ..Resolved::default()
        };
    }

    match levels.cmp(&depth) {
        std::cmp::Ordering::Equal => Resolved::edges(imports_from(rest)),
        std::cmp::Ordering::Greater => Resolved {
            outside: outside(),
            ..Resolved::default()
        },
        // `engine` の中の枝。段を割っていないので辺として意味を持たない
        std::cmp::Ordering::Less => Resolved::default(),
    }
}

/// 1つの `use` が指す先。**3つは同時に立たない。**
#[derive(Default)]
struct Resolved {
    /// `engine` 直下の段
    edges: BTreeSet<String>,
    /// `engine` の外（crate の他の枝）への参照
    outside: Option<String>,
    /// 外部クレートの名前
    crates: BTreeSet<String>,
}

impl Resolved {
    fn edges(edges: BTreeSet<String>) -> Self {
        Self {
            edges,
            ..Self::default()
        }
    }
}

/// そのファイルが `use` している `engine` 直下のモジュール名と、外への参照。
fn scan_file(source: &str, depth: usize) -> (BTreeSet<String>, Vec<String>) {
    let (edges, outside, _) = scan_file_all(source, depth);
    (edges, outside)
}

fn scan_file_all(source: &str, depth: usize) -> (BTreeSet<String>, Vec<String>, BTreeSet<String>) {
    let mut edges = BTreeSet::new();
    let mut outside = Vec::new();
    let mut crates = BTreeSet::new();

    for (statement, inside_modules) in use_statements(source) {
        let found = resolve(&statement, depth + inside_modules);
        edges.extend(found.edges);
        outside.extend(found.outside);
        crates.extend(found.crates);
    }
    (edges, outside, crates)
}

/// モジュール名 → そのモジュールが `use` しているモジュール名。
fn graph() -> BTreeMap<String, BTreeSet<String>> {
    let root = engine_dir();
    let mut graph: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    for path in rust_files(&root) {
        let relative = path.strip_prefix(&root).unwrap_or(&path);
        let module = module_of(relative);
        // `engine/mod.rs` は段に載せない（`pub mod` を並べるだけの場所）。
        // 何も置かないことは `the_engine_root_only_declares_modules` が見る
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

    // **可視性が付いた形。** `pub use` を特別扱いする以上、その兄弟も要る。
    // `pub(crate) use` は `"use "` でも `"pub use "` でも始まらないので、
    // 綴りを直に比べる形だと**走査に一度も入らない**——1行足すだけで段を跨げる
    for spelling in ["pub use", "pub(crate) use", "pub(super) use"] {
        let (edges, _) = scan_file(&format!("{spelling} crate::engine::state::AppState;\n"), 2);
        assert_eq!(
            edges,
            ["state"].map(String::from).into(),
            "`{spelling}` から辺が取れていない"
        );
    }

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

    // **`mod` の入れ子は `super` の意味を変える。**
    // `game/session.rs`（深さ2）の `mod tests` の中では、`engine::game` へ戻るのに
    // `super::super` が要る——そこは段の辺ではない
    let source = "#[cfg(test)]\nmod tests {\n    use super::super::events::RecordedEvents;\n}\n";
    let (edges, out) = scan_file(source, 2);
    assert!(
        edges.is_empty(),
        "`mod tests` の中の `super::super::` を段の辺として数えている: {edges:?}"
    );
    assert!(out.is_empty(), "外への参照として数えている: {out:?}");

    // その中から本当に `engine::state` を指す形は、段の辺として取れること
    let source = "#[cfg(test)]\nmod tests {\n    use super::super::super::state::AppState;\n}\n";
    let (edges, _) = scan_file(source, 2);
    assert_eq!(
        edges,
        ["state"].map(String::from).into(),
        "`mod` の中から段を跨ぐ形が取れていない"
    );

    // **コメントの中の `mod {` を module として数えない。**
    // 数えると幻の module が積まれ、閉じないので以降の `use` が全部ずれる
    let source = "// 置き場の例: `mod tests {` のような形\nuse super::registry::EngineId;\n";
    let (edges, _) = scan_file(source, 1);
    assert_eq!(
        edges,
        ["registry"].map(String::from).into(),
        "コメントの中の `mod {{` を module として数えている"
    );

    // 文字列の中の括弧も同じ
    let source = "const A: &str = \"mod x {\";\nuse super::registry::EngineId;\n";
    let (edges, _) = scan_file(source, 1);
    assert_eq!(edges, ["registry"].map(String::from).into());

    // `fn` の中の塊は `super` の意味を変えない
    let source = "fn f() {\n    use super::super::state::AppState;\n}\n";
    let (edges, _) = scan_file(source, 2);
    assert_eq!(
        edges,
        ["state"].map(String::from).into(),
        "`fn` の塊を `mod` として数えている"
    );
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

/// 段が「使わない」と決めた外部クレートを**参照していない**こと。
///
/// **ADR-0008 決定2 の核はここにある。** `game/` から `tauri` への `use` が
/// 1本も無いから、対局の状態機械はプロセスもランタイムも無しで回せる
/// （`test_runner` / `runner_with_events` / `manager.rs` の3本がその形）。
///
/// 決定を書いただけだと、`Runner` に `AppHandle` を1本引いても
/// `verify:rust` は全部緑のまま通る。壊れるのは上の継ぎ目で、それを直す
/// 一番素直な形が `app: Option<AppHandle>`——**ADR が「背景」として名指しした
/// 改修前の状態そのもの**。だから決定と一緒に機械を置く。
///
/// **許可制にしない。** `tokio` / `usi` / `serde` を全部書くことになり、
/// 段を足すたびに写経が増える。挙げるのは逆転させた境界だけ。
///
/// **`use` の行だけでは足りない。** この repo は `AppHandle` を1度も `use` で
/// 書いていない——`bridge.rs` も `commands/game.rs` も `app: tauri::AppHandle` と
/// 型の位置に完全修飾で置く。`use` しか見ない検査は、**実際に書かれる綴りを
/// 1つも見ていない**ことになる。だから本文も見る。
///
/// 見るのは文字列とコメントを潰した写しなので、`session.rs` や `events.rs` の
/// doc が `tauri::AppHandle` に言及していても当たらない。
#[test]
fn no_layer_uses_a_crate_it_must_not() {
    let root = engine_dir();
    let mut offenders = Vec::new();

    for path in rust_files(&root) {
        let relative = path.strip_prefix(&root).unwrap_or(&path).to_path_buf();
        let Some(layer) = layer(&module_of(&relative)) else {
            continue;
        };
        if layer.forbids.is_empty() {
            continue;
        }
        let source = fs::read_to_string(&path).unwrap_or_default();
        let code = blank_out_noncode(&source);
        for name in layer.forbids {
            if !mentions_crate(&code, name) {
                continue;
            }
            offenders.push(format!(
                "{}  {name} を参照している（{} は {}）",
                relative.display(),
                layer.name,
                layer.decides
            ));
        }
    }

    assert!(
        offenders.is_empty(),
        "段が使わないと決めたクレートを参照している:\n{}",
        offenders.join("\n")
    );
}

/// 走査が外部クレートを見分けていること。
///
/// **`use tauri::AppHandle;` は `crate::` でも `super::` でも始まらない。**
/// そこを分けないと、辺も「外への参照」も立たないまま通る。
#[test]
fn the_scanner_tells_an_outside_crate_from_a_sibling() {
    let (edges, outside, crates) = scan_file_all("use tauri::AppHandle;\n", 2);
    assert!(edges.is_empty() && outside.is_empty());
    assert!(crates.contains("tauri"), "外部クレートを見分けていない");

    // **先頭に `::` が付いた形。** ローカルの同名モジュールと区別したいときに書く
    let (_, _, crates) = scan_file_all("use ::tauri::AppHandle;\n", 2);
    assert!(
        crates.contains("tauri"),
        "`::` から始まる形を外部クレートと数えていない"
    );

    // `self::` は自分の中。外ではない
    let (_, _, crates) = scan_file_all("use self::inner::X;\n", 2);
    assert!(crates.is_empty(), "`self::` を外部クレートと数えている");

    // 段の辺は今までどおり立つ
    let (edges, _, crates) = scan_file_all("use crate::engine::registry::X;\n", 2);
    assert!(edges.contains("registry"), "段の辺を落としている");
    assert!(crates.is_empty());
}

/// `engine/mod.rs` が `pub mod` を並べるだけであること。
///
/// **ここは段の表の外にある**（`graph()` が飛ばす）ので、置いたものは
/// どの検査にも掛からない。`pub const` を置けば、上下の言えない2つが
/// そこを共有の置き場にできる。`pub fn` を置いて `use super::f;` で呼べば、
/// 段3から段8へ届く経路が4つの検査すべて緑のまま通る。
///
/// 何か置きたくなったら、それは**段を1つ足す合図**（`LAYERS` に
/// 「何を決める場所か」を1行で書けるなら足してよい）。
#[test]
fn the_engine_root_only_declares_modules() {
    let source = fs::read_to_string(engine_dir().join("mod.rs")).unwrap_or_default();
    let stray: Vec<&str> = source
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("//")
                && !line.starts_with("pub mod ")
                && !line.starts_with("mod ")
        })
        .collect();

    assert!(
        stray.is_empty(),
        "`engine/mod.rs` に宣言以外のものがある。ここは段の表の外なので、\
         置いたものはどの検査にも掛からない。決める場所が要るなら段を足すこと:\n{}",
        stray.join("\n")
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
/// 段は同位を許すので、順序では環を消せない。
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

/// **使っていない許可を残さない。**
///
/// `may_use` は手で書く。実体の無い辺を残すと、表は「いま何がどう分かれているか」の
/// 記述ではなく願望になり、そのぶんだけ**先回りで許可が置かれる**。
/// `commands → protocol` が残っていれば、`send_usi(state, engine_id, line)` を
/// `commands/game.rs` に足して `registry.get()` → `send_command()` と書く形が
/// 全部の検査を緑で通る——`commands/mod.rs` の「判断を書かない」に反しているのに。
///
/// 辺を1本増やすたびに表を触ることになる。それが ADR-0008 の
/// 「モジュールを足すときに段を決めることになる」。
#[test]
fn no_permission_is_granted_without_a_real_edge() {
    let graph = graph();
    let mut unused = Vec::new();

    for layer in LAYERS {
        for target in layer.may_use {
            let used = graph
                .get(layer.name)
                .is_some_and(|edges| edges.contains(*target));
            if !used {
                unused.push(format!("{} -> {target}", layer.name));
            }
        }
    }

    assert!(
        unused.is_empty(),
        "`may_use` に実体の無い辺がある。使うようになってから足すこと:\n{}",
        unused.join("\n")
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
            // **段に無い行き先を黙って飛ばさない。** 飛ばすと、走査が名前を
            // 取り違えて存在しないモジュールへ辺を立てても誰も気付かない。
            if layer(&to).is_none() {
                upward.push(format!(
                    "{from} -> {to}（{to} は段に無い。走査の取り違えか、段への載せ忘れ）"
                ));
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
