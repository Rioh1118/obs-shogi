//! **索引の段を画面へ出す場所が1つに閉じているか。**
//!
//! `IndexStatePayload::of` は旗（`scan_failed` / `partially_unreadable`）を
//! **全部伏せた形から始める**。組み立てる場所が散っていると、旗を知らない側が
//! 伏せたまま出し、あとから出たほうが緑で塗り潰す。前の再走査で立った旗は、
//! 次の再走査に入った瞬間に消える（reducer は payload の欄を丸ごと写す）。
//!
//! 段が増えるより先に旗が増えるので、**壊れ方は「新しい旗が黙って伏せられる」**。
//! 出す口が1つなら `IndexAnnouncement` / `IndexProgress` に腕を足すときに
//! 全経路が同時に直る。
//!
//! ここが見るのは**どこで出しているか**だけ。段と旗の対応が正しいかは
//! `search/announce.rs` の `mod tests` が見る（`IndexAnnouncement` と
//! `IndexProgress` の両方の写像に腕ごとのテストがある）。
//!
//! **迂回できる綴りを3つ塞いである。** 定数名（`EVT_INDEX_STATE`）だけを見ると
//! どれも素通りする。
//!
//! 1. 値（`"position-index-state"`）を直に書く——**import を1つも増やさずに通る**
//! 2. `IndexStatePayload` を構造体リテラルで組む——import が1行増えるだけで
//!    型検査は止めない（欄は全部 `pub`）
//! 3. `use ... as P` で別名にする——`cargo fmt` は書き戻さないので他の検査も拾わない
//!
//! **走査するのは `src` 全体。** `EVT_INDEX_STATE` も `IndexStatePayload` も `pub` で、
//! `search` の外のどの枝からでも組んで出せる。

use std::fs;
use std::path::{Path, PathBuf};

mod scanning;
use scanning::{blank_out_comments, blank_out_noncode};

/// 段を組んでよい唯一のファイル。
const THE_ONE_ANNOUNCER: &str = "src/search/announce.rs";

/// 段の綴りを持ってよい場所。**`types` は定義するだけで出さない。**
const NOT_CALLERS: [&str; 2] = ["src/search/announce.rs", "src/search/types.rs"];

/// `EVT_INDEX_STATE` の値。**定数名を迂回した綴りを塞ぐ。**
const EVENT_NAME: &str = "position-index-state";

/// そのファイルの中に在るべき emit の数。
/// **終端（`announce_state`）と進行中（`announce_progress`）の2箇所。**
const EXPECTED_EMIT_SITES: usize = 2;

/// 画面へ出しうる側を**歩いて集める**。
///
/// ベタ書きの一覧にすると、`search` に新しいファイルを足して emit を書いた回に
/// 検査の対象にすら入らない——**列挙の漏れは静かに通る**。
fn callers() -> Vec<PathBuf> {
    // **`src` 全体を歩く。** `EVT_INDEX_STATE` も `IndexStatePayload` も `pub` なので、
    // `search` の外のどの枝からでも組んで出せる——`search` だけを歩く形だと、
    // そこに書かれた emit は検査の対象にすら入らない
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    walk(&root, &mut out);
    let skip: Vec<PathBuf> = NOT_CALLERS
        .iter()
        .map(|r| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(r))
        .collect();
    out.retain(|p| !skip.contains(p));
    // **空振りを緑と読まない。** 走査が半分で止まっても、見つからなければ
    // 「違反なし」になる
    assert!(
        out.len() > 50,
        "`src` を歩けていない（{}件）。走査が空振りしたのを緑と読まないこと",
        out.len()
    );
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(dir).unwrap_or_else(|e| panic!("{} を歩けない: {e}", dir.display()));
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

fn rel(p: &Path) -> String {
    p.strip_prefix(env!("CARGO_MANIFEST_DIR"))
        .unwrap_or(p)
        .to_string_lossy()
        .into_owned()
}

/// コメントも文字列も潰した本文。**綴りを数えるとき用。**
fn read_code(rel: &str) -> String {
    blank_out_noncode(&read_raw(rel))
}

/// コメントだけ潰した本文。**文字列リテラルの中身を読むとき用。**
fn read_with_strings(p: &Path) -> String {
    let s = fs::read_to_string(p).unwrap_or_else(|e| panic!("{} を読めない: {e}", p.display()));
    blank_out_comments(&s)
}

fn read_raw(rel: &str) -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} を読めない: {e}", p.display()))
}

/// **段を出す口が `announce` の外に無いこと。**
#[test]
fn no_caller_emits_the_index_state_itself() {
    let offenders: Vec<String> = callers()
        .into_iter()
        .filter(|p| {
            let with_strings = read_with_strings(p);
            // 定数名でも、その値を直に書いた形でも落とす
            with_strings.contains("EVT_INDEX_STATE") || with_strings.contains(EVENT_NAME)
        })
        .map(|p| rel(&p))
        .collect();

    assert!(
        offenders.is_empty(),
        "段を出す口が `{THE_ONE_ANNOUNCER}` の外にある: {offenders:?}\n\
         `announce_state`（終端）か `announce_progress`（進行中）を通すこと。\
         生で組むと、旗を知らない側が伏せたまま出す",
    );
}

/// **その1つの口が実在すること。**
///
/// 上の検査は「無いこと」しか見ないので、`announce.rs` から emit が消えても緑になる。
#[test]
fn the_announcer_still_emits_from_both_paths() {
    // **`use` 行では満たされない形で見る。** 綴りの有無だけだと、
    // emit を両方消しても `use` に名前が残っているかぎり緑になる
    //
    // **箇所の数で見る。** emit は2箇所（終端と進行中）あるので「1箇所以上あるか」
    // だと**片方が黙っても緑**になる。進行中が黙れば構築の段が1つも画面に届かず、
    // 終端が黙れば `Ready` が二度と来ないので検索は永久に `stale`
    let code = read_code(THE_ONE_ANNOUNCER);
    let sites = code.matches("emit(EVT_INDEX_STATE").count();
    assert_eq!(
        sites, EXPECTED_EMIT_SITES,
        "{THE_ONE_ANNOUNCER} の emit が {sites} 箇所（終端と進行中で {EXPECTED_EMIT_SITES} 箇所のはず）。\n\
         増やしたならこの数も動かすこと——減っているなら、その経路の段は誰も出せない",
    );
}

/// **旗を組み立てる口も `announce` に閉じていること。**
///
/// `IndexStatePayload::of` を呼べる場所が散ると、上の検査を通したまま
/// payload だけ別の場所で組んで `announce` に渡す形になり、旗の伏せ方が戻る。
#[test]
fn no_caller_builds_the_payload_itself() {
    // 構造体リテラル（`IndexStatePayload {`）も塞ぐ。欄は全部 `pub` なので
    // `::of` を通らずに組める
    let offenders: Vec<String> = callers()
        .into_iter()
        .filter(|p| {
            let code = blank_out_noncode(&read_with_strings(p));
            code.contains("IndexStatePayload::of") || code.contains("IndexStatePayload {")
        })
        .map(|p| rel(&p))
        .collect();

    assert!(
        offenders.is_empty(),
        "旗を組む口が `{THE_ONE_ANNOUNCER}` の外にある: {offenders:?}\n\
         段と旗の対応は `IndexAnnouncement` / `IndexProgress` の写像1箇所で決めること",
    );
}

/// **場所についての警告も `announce` が組むこと。**
///
/// `IndexWarnPayload::place` と `::file` は引数の型も数も同じなので、
/// 取り違えても型検査は止めない。`announce` の外で組むと、そこだけ
/// 言い分け（`IndexSurvival`）も語彙の統一も掛からない。
///
/// **`::file`（棋譜1件）は許す。** 文言の出所が2つ（`read/diagnosis.rs` と
/// `announce::build_failure`）あり、どちらも段の旗を組まないので、
/// 出す場所と組む場所を分ける理由が無い。
#[test]
fn no_caller_builds_a_place_warning_itself() {
    let offenders: Vec<String> = callers()
        .into_iter()
        .filter(|p| blank_out_noncode(&read_with_strings(p)).contains("IndexWarnPayload::place"))
        .map(|p| rel(&p))
        .collect();

    assert!(
        offenders.is_empty(),
        "場所の警告を組む口が `{THE_ONE_ANNOUNCER}` の外にある: {offenders:?}\n\
         `announce` の関数を通すこと。裸のリテラルで組むと、そこだけ言い分けが掛からない",
    );
}

/// **別名で `use` して検査を素通りしないこと。**
///
/// `use ...IndexStatePayload as P;` と書くと、`P::of(..)` も `P { .. }` も
/// 綴りの走査に掛からない。`cargo fmt` は別名を書き戻さないので、
/// **`verify:rust` の他の検査も拾わない**。
#[test]
fn no_caller_hides_the_names_behind_an_alias() {
    const HIDDEN: [&str; 3] = ["IndexStatePayload", "IndexWarnPayload", "EVT_INDEX_STATE"];

    let offenders: Vec<String> = callers()
        .into_iter()
        .filter(|p| {
            blank_out_noncode(&read_with_strings(p))
                .lines()
                .filter(|l| l.contains("use ") && l.contains(" as "))
                .any(|l| HIDDEN.iter().any(|h| l.contains(h)))
        })
        .map(|p| rel(&p))
        .collect();

    assert!(
        offenders.is_empty(),
        "段の名前を別名で隠している: {offenders:?}\n\
         別名にすると綴りの走査が全部素通りする。素の名前で `use` すること",
    );
}
