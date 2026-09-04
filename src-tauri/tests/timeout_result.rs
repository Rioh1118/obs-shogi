//! `tokio::time::timeout` の**内側の `Result` を捨てない**。
//!
//! 戻りは `Result<Result<T, E>, Elapsed>` の二重。`.is_ok()` / `.is_err()` は
//! 外側しか見ないので、内側の `Err` が「成功した」に化ける。
//!
//! 化けると、**失敗が別の失敗として説明される**。`stop` の書き込みが断られたのに
//! 「エンジンが `stop` に応じなかった」という説明が棋譜と画面に残る、という形で出た。
//!
//! 分けたいなら `match` で3分岐にすること。潰してよいと判断したなら、
//! `let _ = ...` ではなく理由をコメントに書いたうえで `matches!` を使う。
//!
//! `let _ = timeout(...)` も同じ穴として止める。上限超過と内側の `Err` が
//! どちらも捨てられ、ログを読んでも「詰まった」のか「相手が先に居なくなった」
//! のかが分からない。

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

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

/// `timeout(` から数えて、この行数のうちに `.is_ok()` / `.is_err()` が来たら
/// 同じ式だとみなす。
///
/// 式を跨いで数えるので、無関係な `.is_ok()` を巻き込むことがある。
/// **巻き込む側に倒してある**。見逃すより、書いた人に一度読ませるほうがよい。
const WINDOW: usize = 6;

/// 上限を超えたか**だけ**を見たい呼び出し。中身が `()` なので捨てる `Result` が無い。
///
/// **待つ相手の綴りで持つ。** 行番号で持つと、無関係な1行を足すだけで赤くなり、
/// 直す作業が「番号を書き換える」だけになる——**免除の中身は誰も読み直さない**。
/// 綴りなら、その `timeout` を動かしても消しても意味のある形で落ちる。
///
/// 増やすときは、その `timeout` の内側が `Result` を返さないことを確かめること。
const EXEMPT: &[&str] = &[
    // `EngineRegistry::shutdown_all` は戻り値を持たない
    "registry.shutdown_all()",
    // `Notify::notified` は `()` を返す。畳まれたか超えたかの2値しかない
    "settled.notified()",
];

/// `timeout(` が現れる位置を、`src` からの相対パスと行番号で並べる
fn timeout_sites() -> Vec<String> {
    let mut sites = Vec::new();

    for path in rust_files(&src_dir()) {
        let source = fs::read_to_string(&path).unwrap_or_default();
        let relative = path.strip_prefix(src_dir()).unwrap_or(&path).to_path_buf();

        for (index, line) in source.lines().enumerate() {
            if line.contains("timeout(") {
                sites.push(format!("{}:{}", relative.display(), index + 1));
            }
        }
    }
    sites
}

/// 免除が**実際に効いていること**。
///
/// **効いていない免除は誰も見ない。** 免除された側は免除のつもりのまま
/// 検査を受け、免除の行だけが化石として残る。
///
/// ソース全体への `contains` では足りない。その `timeout` を消しても、
/// 綴りが doc コメントや別の関数に残っていれば緑で通る——
/// **免除の根拠（内側が `Result` を返さないこと）は消えているのに。**
/// 走査が実際にその免除を使ったかで見る。
#[test]
fn every_exemption_is_actually_used() {
    let (_, used) = scan();
    let dead: Vec<&&str> = EXEMPT.iter().filter(|e| !used.contains(**e)).collect();

    assert!(
        dead.is_empty(),
        "免除が1件も使われていない。その `timeout` を消したなら免除も消すこと。\
         綴りがソースに残っていても、`timeout(` の {WINDOW} 行内に無ければ効いていない:\n{dead:?}"
    );
}

/// 走査の本体。違反と、**実際に使った免除**を返す
fn scan() -> (Vec<String>, BTreeSet<&'static str>) {
    let mut offenders = Vec::new();
    let mut used = BTreeSet::new();

    for path in rust_files(&src_dir()) {
        let source = fs::read_to_string(&path).unwrap_or_default();
        let lines: Vec<&str> = source.lines().collect();

        for (index, line) in lines.iter().enumerate() {
            if !line.contains("timeout(") {
                continue;
            }
            let relative = path.strip_prefix(src_dir()).unwrap_or(&path);
            let here = format!("{}:{}", relative.display(), index + 1);

            // 免除は待つ相手の綴りで見る。`timeout(` の行から数行のうちに
            // その綴りがあれば、同じ式だとみなす
            let end = (index + WINDOW).min(lines.len());
            let window = lines[index..end].join("\n");
            if let Some(hit) = EXEMPT.iter().find(|e| window.contains(**e)) {
                used.insert(*hit);
                continue;
            }

            // `let _ = timeout(...)` も同じ穴。上限超過と内側の `Err` が
            // どちらも捨てられ、ログを読んでも区別が付かない
            if line.trim_start().starts_with("let _ =") {
                offenders.push(format!("{}  {}", here, line.trim()));
                continue;
            }

            if window.contains(".is_ok()") || window.contains(".is_err()") {
                offenders.push(format!("{}  {}", here, line.trim()));
            }
        }
    }

    (offenders, used)
}

#[test]
fn a_timeout_never_swallows_the_inner_result() {
    let (offenders, _) = scan();

    assert!(
        offenders.is_empty(),
        "`timeout` の戻りを `.is_ok()` / `.is_err()` で見ている。\
         内側の `Result` が捨てられ、失敗が「成功」に化ける。\
         `match` で3分岐にすること:\n{}",
        offenders.join("\n")
    );
}

/// 走査が空振りしても違反0になる。`timeout` を実際に拾えていることを固定する
#[test]
fn the_scanner_finds_the_timeouts() {
    let hits = timeout_sites().len();

    assert!(hits > 3, "`timeout(` を {hits} 件しか拾えていない");
}
