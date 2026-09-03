//! 状態遷移表のセルと、**そのセルを名乗るテスト**を突き合わせる。
//!
//! `docs/state-transitions/game-session.md` は、どのセルが固定できていて
//! どれが素通りかを2箇所で言う——表のテスト列と「埋まっていないセル」節。
//! そこを根拠に次の人が着手するので、現物とずれると**既にあるテストを
//! 二重に書く**か、逆に**落ちない前提でガードを消す**。
//!
//! **人が手で突き合わせる形は続かない。** 表を直すたびに別の行が壊れる
//! （`(G1, E15)` / `E13` / E1 / E4 の `is_engine` / `E16` で実際に起きた）。
//!
//! 鍵はテストの側が既に持っている。この repo のテストは doc に
//! `（表の E1 / E4）` と自分で名乗る習慣がある。その綴りを拾う。
//!
//! **散文は見ていない。** 注（`※N`）の本文が「踏めていない」と書いていても
//! ここは落ちない。テストの有無を言うのは表のテスト列と
//! 「埋まっていないセル」節だけ、という約束の上に立っている。
//! 注については**番号が実在するか**だけを見る。
//!
//! **`△` の行も突き合わせない。** 一部の列だけ固定している形は普通にあり、
//! どの列かを表が持てないので、名乗りの有無から何も言えない。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

mod scanning;
use scanning::{blank_out_strings, doc_above, is_test_attribute};

/// 表のテスト列で「踏むテストが無い」を意味する印
const UNTESTED: char = '✗';
/// 表のテスト列で「そのセルを固定するテストがある」を意味する印
const TESTED: char = '✓';
/// 表のテスト列で「一部の列だけ固定している」を意味する印
const PARTIAL: char = '△';

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

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn table_source() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri の親")
        .join("docs/state-transitions/game-session.md");
    fs::read_to_string(&path).expect("状態遷移表を読めない")
}

/// `（表の E1 / E4）` のような名乗りから、セルの記号だけを取り出す。
///
/// **`表の` から `）` までに限る。** doc の他の場所に `E1` と書いてあっても
/// 名乗りではない（`E1 が来たら` のような本文の説明が普通にある）。
fn cells_named(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("表の") {
        let after = &rest[at + "表の".len()..];
        let scope = match after.find('）') {
            Some(end) => &after[..end],
            None => after,
        };
        found.extend(symbols_in(scope));
        rest = &after[scope.len()..];
    }
    found
}

/// `E7'` / `E16` / `※2` を拾う。
///
/// **直前が英数字なら拾わない。** `SearchOutcome` の `E` を `E1` の頭と
/// 読むと、名乗っていないセルを名乗ったことにする。
fn symbols_in(scope: &str) -> Vec<String> {
    let chars: Vec<char> = scope.chars().collect();
    let mut found = Vec::new();
    let mut at = 0;
    while at < chars.len() {
        let head = chars[at];
        let is_event = head == 'E' && !(at > 0 && chars[at - 1].is_ascii_alphanumeric());
        if !is_event && head != '※' {
            at += 1;
            continue;
        }
        let mut end = at + 1;
        while end < chars.len() && chars[end].is_ascii_digit() {
            end += 1;
        }
        if end == at + 1 {
            at += 1;
            continue;
        }
        if is_event && end < chars.len() && chars[end] == '\'' {
            end += 1;
        }
        found.push(chars[at..end].iter().collect());
        at = end;
    }
    found
}

/// セルの記号 → それを名乗っているテストの場所
fn claims() -> BTreeMap<String, Vec<String>> {
    let mut found: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for path in rust_files(&src_dir()) {
        // **文字列を潰してから読む。** 生文字列に doc コメントと `#[test]` の
        // 形を書いた行が、名乗っていないセルを名乗ったことにする
        let source = blank_out_strings(&fs::read_to_string(&path).unwrap_or_default());
        let relative = path.strip_prefix(src_dir()).unwrap_or(&path).to_path_buf();
        let lines: Vec<&str> = source.lines().collect();

        for (index, line) in lines.iter().enumerate() {
            if !is_test_attribute(line) {
                continue;
            }
            for (_, text) in doc_above(&lines, index) {
                for cell in cells_named(&text) {
                    found.entry(cell).or_default().push(format!(
                        "{}:{}",
                        relative.display(),
                        index + 1
                    ));
                }
            }
        }
    }
    found
}

/// 表の1行を `|` で割る。前後の空欄は落とす
fn row_cells(line: &str) -> Vec<&str> {
    line.trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(str::trim)
        .collect()
}

/// その見出しから次の `## ` までの行。
///
/// **節で区切らないと、同じ形の表が2つある文書で後ろ勝ちになる。**
/// この文書には「## イベント」の一覧も `| **E1** | …` の形で並んでいて、
/// 節を見ないと本体の行と混ざる。混ざったまま `insert` で上書きしていると、
/// 節を並べ替えただけでテスト列が**発生源の説明文**に化ける——`✗` でも `✓` でも
/// 始まらないので、下の検査は何も言わずに通る。
fn section(heading: &str) -> Vec<String> {
    let source = table_source();
    let mut found = Vec::new();
    let mut inside = false;

    for line in source.lines() {
        if line.starts_with("## ") {
            inside = line.starts_with(heading);
            continue;
        }
        if inside {
            found.push(line.to_string());
        }
    }
    found
}

/// テスト列の見出し
const TEST_COLUMN: &str = "テスト";

/// イベントの記号 → テスト列。**「## 表」の中だけを読む。**
///
/// **列は見出しから引く。** 末尾を採ると、表に列を1本足しただけで
/// 別の欄を読み、`✓` でも `✗` でも始まらない値になる——下の検査は
/// 3本とも何も言わずに通る。
fn test_column() -> BTreeMap<String, String> {
    let rows = section("## 表");
    let at = rows
        .iter()
        .find_map(|line| row_cells(line).iter().position(|cell| *cell == TEST_COLUMN))
        .unwrap_or_else(|| panic!("`## 表` に `{TEST_COLUMN}` 列が無い"));

    let mut found = BTreeMap::new();
    for line in &rows {
        let cells = row_cells(line);
        if cells.len() <= at {
            continue;
        }
        let Some(name) = cells[0].strip_prefix("**") else {
            continue;
        };
        let Some(name) = name.split("**").next() else {
            continue;
        };
        if symbols_in(name).first().map(String::as_str) != Some(name) {
            continue;
        }
        found.insert(name.to_string(), cells[at].to_string());
    }
    found
}

/// 「埋まっていないセル」節の1列目が名乗っている記号
fn listed_as_uncovered() -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    for line in section("## 埋まっていないセル") {
        let cells = row_cells(&line);
        if cells.len() < 2 {
            continue;
        }
        found.extend(symbols_in(cells[0]));
    }
    found
}

/// 文書が定義している注（`※N`）
fn notes() -> BTreeSet<String> {
    table_source()
        .lines()
        .filter(|line| line.starts_with('※'))
        .filter_map(|line| symbols_in(line).into_iter().next())
        .collect()
}

/// 走査が何も拾えていない状態で緑にならないこと。
///
/// **名乗りの綴りは慣習で、機械が強制していない。** `（表の …）` を書く人が
/// 居なくなれば `claims` は空になり、下の2本は何も見ないまま通る。
/// そのときここが落ちて、検査が空振りしていることに気付ける。
#[test]
fn the_scanner_finds_the_claims() {
    let claims = claims();
    assert!(
        claims.len() >= 5,
        "テストの doc が名乗るセルを {} 件しか拾えていない: {:?}",
        claims.len(),
        claims.keys().collect::<Vec<_>>()
    );
    let columns = test_column();
    assert!(columns.len() >= 10, "表の本体を読めていない: {columns:?}");

    // **列がずれていないこと。** 行数だけでは、別の欄を読んでいる状態を
    // 見分けられない（読んだ値が印で始まらないので、下の検査は静かに通る）
    let strays: Vec<String> = columns
        .iter()
        .filter(|(_, column)| !column.starts_with([TESTED, UNTESTED, PARTIAL]))
        .map(|(cell, column)| format!("{cell}  {column}"))
        .collect();
    assert!(
        strays.is_empty(),
        "テスト列に印以外の値がある。列がずれているか、印を増やした:\n{}",
        strays.join("\n")
    );
}

/// 表が「踏むテストが無い」と言うセルを、テストが名乗っていないこと。
///
/// 名乗っているなら表が古い。これを読んで「落ちないから消せる」と判断した人が
/// ガードを削ると、**そのテストが落ちる**——赤くなってから気付くのでは、
/// 表を根拠に設計を決めた後になる。
#[test]
fn no_test_claims_a_cell_the_table_calls_untested() {
    let columns = test_column();
    let mut offenders = Vec::new();

    for (cell, sites) in claims() {
        let Some(column) = columns.get(&cell) else {
            continue;
        };
        if column.starts_with(UNTESTED) {
            offenders.push(format!("{cell}  表: {column}  テスト: {}", sites.join(" ")));
        }
    }

    assert!(
        offenders.is_empty(),
        "表が「未検証」と言うセルを、テストが自分から名乗っている:\n{}",
        offenders.join("\n")
    );
}

/// 「埋まっていないセル」節と表のテスト列が反対を言っていないこと。
///
/// 節に載っているのにテスト列が `{TESTED}` なら、どちらかが古い。
/// **`△` は許す**——一部の列だけ固定している形は普通にある
/// （`E16` は `Info` 側だけ踏めている）。
#[test]
fn no_uncovered_cell_is_marked_as_covered() {
    let columns = test_column();
    let mut offenders = Vec::new();

    for cell in listed_as_uncovered() {
        let Some(column) = columns.get(&cell) else {
            continue;
        };
        if column.starts_with(TESTED) {
            offenders.push(format!("{cell}  表: {column}"));
        }
    }

    assert!(
        offenders.is_empty(),
        "「埋まっていないセル」に載っているのに、表のテスト列が固定済みになっている:\n{}",
        offenders.join("\n")
    );
}

/// テストが名乗る記号が実在すること。**イベントも注も同じに扱う。**
///
/// 行や注を消したり番号を振り直したりしたとき、テストの doc は黙って
/// 存在しない先を指し続ける。**そうなると、上の2本はそのセルについて
/// 永久に空振りする**——`columns.get()` が `None` を返して読み飛ばすので、
/// 表とテストが反対を言っていても何も出ない。
///
/// **記号で分けない。** 名乗りの大半はイベント（`E*`）で、番号の振り直しも
/// そちらで起きる。`※` だけを見る形だと、その大半が検査の外に出る。
#[test]
fn every_symbol_a_test_names_exists() {
    let columns = test_column();
    let notes = notes();

    let mut missing = Vec::new();
    for (cell, sites) in claims() {
        let known = if cell.starts_with('※') {
            notes.contains(&cell)
        } else {
            columns.contains_key(&cell)
        };
        if !known {
            missing.push(format!("{cell}  テスト: {}", sites.join(" ")));
        }
    }

    assert!(
        missing.is_empty(),
        "テストが実在しない行／注を指している:\n{}",
        missing.join("\n")
    );
}

/// 表が「固定するテストがある」と言う行を、どれかのテストが名乗っていること。
///
/// **上の2本と向きが逆。** あちらは「表が未検証と言うのに名乗りがある」を見る。
/// こちらが無いと、`{TESTED}` の行の実体が消えても表は `{TESTED}` のまま
/// 4本とも緑になる——次の人はその枝が固定済みだと信じて落とせる。
///
/// **`△` は対象外。** 一部の列だけ固定している形は名乗りが無くても成り立つ
/// （どの列かを表が持てない）。
#[test]
fn every_covered_row_is_named_by_a_test() {
    let claims = claims();
    let mut unnamed = Vec::new();

    for (cell, column) in test_column() {
        if column.starts_with(TESTED) && !claims.contains_key(&cell) {
            unnamed.push(format!("{cell}  表: {column}"));
        }
    }

    assert!(
        unnamed.is_empty(),
        "表が固定済みと言う行を、どのテストも名乗っていない。\
         テストの doc に `（表の <記号>）` を書くこと:\n{}",
        unnamed.join("\n")
    );
}
