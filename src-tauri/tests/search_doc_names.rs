//! `docs/state-transitions/search.md` が名乗る `fn` 名と呼び出しが実在するか。
//!
//! この doc の状態表は「どうやってその段に入るか」を答えるための索引で、
//! 読み手はそこに書かれた綴りで現物を引く。**引けないと、表が古いのか
//! 実装が消えたのかを判断できない。**
//!
//! 既存の `state_transition_cells` は `game-session.md` **だけ**を読む。
//! `search.md` を載せられないのは表の形ではなく、**遷移表にテスト列が無く、
//! セルを名乗るテストも1本も無いから**（`search.md` 自身がそう書いている）。
//! ここは代わりに**綴りの実在だけ**を見る。
//!
//! ## 見るのは5つ
//!
//! 1. バッククォートが対で閉じているか
//! 2. 候補が減っていないか（**空振りで緑になるのを止める**。3つの向きすべてに床がある）
//! 3. `fn` 名が `src/search/**` に実在するか
//! 4. `名前(引数)` の形の呼び出しが実在するか
//! 5. `Type::Variant` の**両側が語として**実在するか
//!
//! ## ここが見ないもの
//!
//! **散文は見ていない。** 「〜が固定している」の主張が本当かは人が見る。
//!
//! **`src/search/**` に閉じている。** 綴りが workspace の別 crate
//! （`crates/kifu-text` など）へ移ると、doc が正しくてもここが赤くなる。
//! そのときはこの検査の根も直すこと。
//!
//! **[`EXEMPT`] に並べた綴りは見ない。** 欄の名前など、`fn` でないもの。
//!
//! **`Type::Variant` の組み合わせは見ない。** 型とバリアントが別々の場所に
//! 語として在れば通るので、型を跨いだ取り違え（`BuildError::Loose` のような綴り）は
//! 素通りする。並びを要求すると、`#[from]` で作られる正しい綴り
//! （`BuildError::Initial`）が落ちるため、そこは人が読む。

use std::fs;
use std::path::{Path, PathBuf};

mod scanning;
use scanning::blank_out_noncode;

/// `fn` でないので実在を見ない綴り。
///
/// 欄の名前（`file_id` など）、モジュール名（`query_service` など）、
/// 外の crate の API（`app_cache_dir`）。
///
/// **足すときは「なぜ `fn` でないか」が読み手に分かる並びに置くこと。**
const EXEMPT: [&str; 17] = [
    // 欄の名前
    "file_id",
    "node_id",
    "fork_off",
    "fork_len",
    "fork_path",
    "root_dir",
    "file_table",
    "node_tables",
    "next_file_id",
    "path_to_id",
    "mtime_ms",
    "looks_intentional",
    // モジュール名
    "query_service",
    "project_manager",
    "fs_scan",
    // `src/search/**` の外にある fn。この検査は search 配下しか歩かない
    "app_cache",
    "app_cache_dir",
];

/// 候補がこれを下回ったら、走査が壊れているとみなす。
///
/// **実測値をここに書かない。** 書いた瞬間から `search.md` の編集で離れる。
/// 床は「桁で落ちたら気付く」ためのもので、実測に張り付ける意味は無い。
/// 表の行が増減するので余裕を取ってあるが、**桁で落ちたら気付く**ための下限。
const MIN_FN_CANDIDATES: usize = 15;
const MIN_CALL_CANDIDATES: usize = 6;

/// `Type::Variant` の候補の下限。**数えるのは重複を含む件数。**
///
/// **この床が無いと、新しい向きだけが空振りで緑になる。** `without_fences` は
/// コード塀を落とすので、表の書き方を変えて `Type::Variant` の言及が塀の中へ
/// 移るだけで候補が0件になり、`missing` は空、テストは永久に緑。
const MIN_VARIANT_CANDIDATES: usize = 2;

fn doc() -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri の親")
        .join("docs/state-transitions/search.md");
    fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} を読めない: {e}", p.display()))
}

/// `src/search/**` の中身を、**コメントも文字列も潰して**繋げたもの。
///
/// 潰さないと、doc が指す綴りがログの文言やコメントにあるだけで
/// 「実在する」と判定される。`commands.rs` のログが実例。
fn search_sources() -> String {
    fn walk(dir: &Path, out: &mut String) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                if let Ok(s) = fs::read_to_string(&p) {
                    out.push_str(&blank_out_noncode(&s));
                    out.push('\n');
                }
            }
        }
    }
    let mut out = String::new();
    walk(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/search"),
        &mut out,
    );
    out
}

/// コード塀（``` の行）を落とす。中の綴りは doc の主張ではなく例なので見ない。
fn without_fences(md: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;
    for l in md.lines() {
        if l.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if !in_fence {
            out.push_str(l);
            out.push('\n');
        }
    }
    out
}

/// バッククォートで囲まれた断片。
///
/// # Panics
///
/// バッククォートが奇数個なら落とす。**閉じ忘れると以降の対応が全部ずれ、
/// 候補が地の文になって検査が何も見なくなる。**
fn quoted(md: &str) -> Vec<String> {
    let body = without_fences(md);
    let ticks = body.matches('`').count();
    assert!(
        ticks % 2 == 0,
        "`search.md` のバッククォートが奇数個（{ticks}）。閉じ忘れると\
         この検査は緑のまま何も見なくなる"
    );

    let mut out = Vec::new();
    let mut rest = body.as_str();
    while let Some(a) = rest.find('`') {
        let after = &rest[a + 1..];
        let Some(b) = after.find('`') else { break };
        let inner = &after[..b];
        if !inner.is_empty() {
            out.push(inner.to_owned());
        }
        rest = &after[b + 1..];
    }
    out
}

/// `fn` 名として実在を見る綴り。
///
/// 小文字・数字・下線だけで、下線を1つ以上含むもの。型名は大文字を含むので落ちる。
/// 欄の名前は [`EXEMPT`] で外す。
fn fn_candidates(md: &str) -> Vec<String> {
    quoted(md)
        .into_iter()
        // `install_restored(..)` のように引数付きで書かれていても頭を取る
        .map(|q| q.split_once('(').map(|(h, _)| h.to_owned()).unwrap_or(q))
        .filter(|q| {
            q.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                && q.contains('_')
                && !EXEMPT.contains(&q.as_str())
        })
        .collect()
}

/// `名前(引数)` の形で実在を見る綴り。`..` を含むものは略記なので除く。
fn call_candidates(md: &str) -> Vec<String> {
    quoted(md)
        .into_iter()
        .filter(|q| {
            let Some((head, tail)) = q.split_once('(') else {
                return false;
            };
            tail.ends_with(')')
                && !q.contains("..")
                && !head.is_empty()
                && head
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        })
        .collect()
}

/// `Type::Variant` の形で実在を見る綴り。
///
/// **`fn` 名の走査では拾えない。** あちらは小文字・数字・下線だけを候補にするので、
/// 大文字を含む型名は候補にすら入らない。**バリアントを名乗る綴りは
/// この向きが無いと誰も見ない。**
///
/// 見るのは**両側が語として在るか**だけ。その型がそのバリアントを持つかまでは
/// 見ていないので、そこは人が読む。
///
/// **`::` の左が小文字で始まるものは除く**（`crate::search::…` のようなパス）。
fn variant_candidates(md: &str) -> Vec<(String, String)> {
    quoted(md)
        .into_iter()
        .filter_map(|q| {
            let q = q.split_once('(').map(|(h, _)| h.to_owned()).unwrap_or(q);
            let (ty, var) = q.rsplit_once("::")?;
            let ident = |s: &str| {
                !s.is_empty()
                    && s.chars().next().is_some_and(|c| c.is_ascii_uppercase())
                    && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            };
            (ident(ty) && ident(var)).then(|| (ty.to_owned(), var.to_owned()))
        })
        .collect()
}

/// `name` が**語として**現れるか。前後が英数字・下線なら別の綴りの一部。
///
/// 素の `contains` だと、接尾を足す改名（`Superseded` → `SupersededByRestart`）が
/// 部分文字列として残って緑のまま通る。
fn mentions_word(code: &str, name: &str) -> bool {
    let is_ident = |c: char| c.is_alphanumeric() || c == '_';
    let mut from = 0;
    while let Some(at) = code[from..].find(name) {
        let at = from + at;
        let before = code[..at].chars().next_back();
        let after = code[at + name.len()..].chars().next();
        if !before.is_some_and(is_ident) && !after.is_some_and(is_ident) {
            return true;
        }
        from = at + name.len();
    }
    false
}

/// 語境界の判定そのものを固定する。
///
/// **doc 側の変異では捕まらない。** `mentions_word` が常に真を返すよう壊すと
/// `missing` は空になり、候補の数を見る検査も通るので、**両方緑のまま**
/// この走査だけが何も見なくなる。
#[test]
fn mentions_word_looks_at_boundaries() {
    assert!(
        !mentions_word("SupersededByRestart", "Superseded"),
        "接尾を通している"
    );
    assert!(
        !mentions_word("RestartSuperseded", "Superseded"),
        "接頭を通している"
    );
    assert!(
        mentions_word("enum X { Superseded }", "Superseded"),
        "記号に挟まれた語を落としている"
    );
    // **1つ目が語でなくても2つ目で当たること。** `from` の前進が
    // 後ろの出現を飛ばしていたら、ここが落ちる
    assert!(
        mentions_word("A_Loose Loose", "Loose"),
        "2つ目の出現を飛ばしている"
    );
}

/// doc が名乗る `Type::Variant` の両側が実在すること。
#[test]
fn every_variant_the_doc_names_exists() {
    let md = doc();
    let code = search_sources();

    let missing: Vec<String> = variant_candidates(&md)
        .into_iter()
        // **語として在るかを見る。** 素の `contains` だと
        // `Superseded` → `SupersededByRestart` のような接尾つきの改名が
        // 部分文字列として残って**緑のまま通る**。
        //
        // **`Type::Variant` の並びは要求しない。** バリアントは `enum` の中で
        // 裸で宣言され、`#[from]` や `?` で作られる腕は**どこにも
        // `Type::Variant` と書かれない**（`BuildError::Initial` がそれ）。
        // 並びを要求すると、正しい doc がその一事で落ちる
        .filter(|(ty, var)| !mentions_word(&code, ty) || !mentions_word(&code, var))
        .map(|(ty, var)| format!("{ty}::{var}"))
        .collect();

    assert!(
        missing.is_empty(),
        "`search.md` が実在しない綴りを名乗っている: {missing:?}\n\
         型かバリアントのどちらかが `src/search/**` に無い"
    );
}

/// **走査が壊れていないこと。**
///
/// バッククォートが1個ずれると候補が地の文になり、`missing` が空になって
/// 2本とも緑で通る。**空振りを失敗として出す。**
#[test]
fn the_scan_still_finds_what_the_doc_names() {
    let md = doc();
    let fns = fn_candidates(&md).len();
    let calls = call_candidates(&md).len();

    assert!(
        fns >= MIN_FN_CANDIDATES,
        "`fn` 名の候補が {fns} 件しかない（下限 {MIN_FN_CANDIDATES}）。\
         走査が壊れているか、表から名乗りが消えた"
    );
    assert!(
        calls >= MIN_CALL_CANDIDATES,
        "呼び出しの候補が {calls} 件しかない（下限 {MIN_CALL_CANDIDATES}）"
    );

    let variants = variant_candidates(&md).len();
    assert!(
        variants >= MIN_VARIANT_CANDIDATES,
        "`Type::Variant` の候補が {variants} 件しかない（下限 {MIN_VARIANT_CANDIDATES}）。\
         塀の中へ移ったか、綴りが変わっている"
    );
}

/// **doc が名乗る `fn` が実在すること。**
///
/// テストに限らない。**候補の多くは本番の関数**（`run_rescan_diff_apply` /
/// `read_to_jkf` / `is_occ_alive` など）で、改名したら doc も直す。
#[test]
fn every_fn_named_by_the_doc_exists() {
    let src = search_sources();
    let missing: Vec<String> = fn_candidates(&doc())
        .into_iter()
        // 末尾まで見る。`fn foo` の前方一致だと `foo_and_bar` を実在と読む
        .filter(|q| !src.contains(&format!("fn {q}(")) && !src.contains(&format!("fn {q}<")))
        .collect();

    assert!(
        missing.is_empty(),
        "`search.md` が名乗る fn が `src/search/**` に無い。\
         改名したら doc も直すこと（`fn` でないなら `EXEMPT` へ）:\n{}",
        missing.join("\n")
    );
}

/// **doc が書く呼び出しが実在すること。**
///
/// `restart(Restart::Building)` のような、引数まで含めた形。
/// これが引けないと、表の「判定条件」の欄が索引として働かない。
#[test]
fn every_call_written_by_the_doc_exists() {
    let src = search_sources();
    let missing: Vec<String> = call_candidates(&doc())
        .into_iter()
        .filter(|q| !src.contains(q.as_str()))
        .collect();

    assert!(
        missing.is_empty(),
        "`search.md` が書く呼び出しが `src/search/**` に無い。\
         口を変えたら doc も直すこと:\n{}",
        missing.join("\n")
    );
}
