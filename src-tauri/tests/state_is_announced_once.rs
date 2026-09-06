//! **索引の段を画面へ出す口が1つに閉じているか。**
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
//! ここが見るのは綴りだけ。**旗の中身が正しいかは見ない**
//! ——それは `search/announce.rs` の `mod tests` が見る。

use std::fs;
use std::path::PathBuf;

mod scanning;
use scanning::blank_out_noncode;

/// 段を組んでよい唯一の場所。
const THE_ONE_MOUTH: &str = "src/search/announce.rs";

/// `store` を持ち回って画面へ出しうる側。**ここに生の emit があってはいけない。**
const CALLERS: [&str; 3] = [
    "src/search/build.rs",
    "src/search/project_manager.rs",
    "src/search/commands.rs",
];

fn read_code(rel: &str) -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    let s = fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} を読めない: {e}", p.display()));
    blank_out_noncode(&s)
}

/// **段を出す口が `announce` の外に無いこと。**
#[test]
fn no_caller_emits_the_index_state_itself() {
    let offenders: Vec<&str> = CALLERS
        .iter()
        .copied()
        .filter(|rel| read_code(rel).contains("EVT_INDEX_STATE"))
        .collect();

    assert!(
        offenders.is_empty(),
        "段を出す口が `{THE_ONE_MOUTH}` の外にある: {offenders:?}\n\
         `announce_state`（終端）か `announce_progress`（進行中）を通すこと。\
         生で組むと、旗を知らない側が伏せたまま出す",
    );
}

/// **その1つの口が実在すること。**
///
/// 上の検査は「無いこと」しか見ないので、`announce.rs` から emit が消えても緑になる。
#[test]
fn the_one_mouth_still_emits() {
    let code = read_code(THE_ONE_MOUTH);
    assert!(
        code.contains("EVT_INDEX_STATE"),
        "{THE_ONE_MOUTH} が段を出さなくなっている。出す口を動かしたなら、この検査も動かすこと",
    );
}

/// **旗を組み立てる口も `announce` に閉じていること。**
///
/// `IndexStatePayload::of` を呼べる場所が散ると、上の検査を通したまま
/// payload だけ別の場所で組んで `announce` に渡す形になり、旗の伏せ方が戻る。
#[test]
fn no_caller_builds_the_payload_itself() {
    let offenders: Vec<&str> = CALLERS
        .iter()
        .copied()
        .filter(|rel| read_code(rel).contains("IndexStatePayload::of"))
        .collect();

    assert!(
        offenders.is_empty(),
        "旗を組む口が `{THE_ONE_MOUTH}` の外にある: {offenders:?}\n\
         段と旗の対応は `IndexAnnouncement` / `IndexProgress` の写像1箇所で決めること",
    );
}
