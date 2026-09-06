//! 同じ候補手が2度書かれた定跡を、**先に書かれた方を残して**畳む。
//!
//! 先頭がその局面の best move、というのが形式の約束。本家（やねうら王）は
//! 後勝ちで畳むが、それだと2度目の綴りが best move の座を奪う ——
//! ここは先勝ちにして、ファイルに書かれた順の意味を保つ。
//!
//! **溜める側の空き容量もここが持つ。** `Vec::push` の倍々成長は、
//! 読み切るまで解放されない空きを局面ごとに残す。畳む処理と同じ場所に置くのは、
//! どちらも「溜めた列をどう扱うか」だけを決めているため。

use crate::book::sfen::BookKey;
use crate::book::types::BookMove;
use std::collections::{HashMap, HashSet};

/// 溜める側を伸ばす刻み。
///
/// **倍々に伸ばさない。** `Vec::push` は容量を2倍にするので、`len` が2の冪を
/// 1つ超えた直後に最大の空きを残す（33 手なら容量 64）。その空きは
/// [`super::expand`] の `flush` が `mem::take` で map へ渡す列に乗ったまま、読み切るまで残る。
/// 刻みで伸ばせば空きはこの数で頭打ちになる。
///
/// 8 は「正常な定跡の候補手は 10 手前後」から。再確保の回数は 10 手で2回、
/// 257 手で 33 回で、どちらも局面あたりの費用として無視できる。
pub(super) const MOVE_CHUNK: usize = 8;

/// 候補手を溜める。**倍々の成長をさせない**（理由は [`MOVE_CHUNK`]）。
pub(super) fn push_without_doubling(buffered: &mut Vec<BookMove>, parsed: BookMove) {
    if buffered.len() == buffered.capacity() {
        buffered.reserve_exact(MOVE_CHUNK);
    }
    buffered.push(parsed);
}

/// 1局面の候補手として異常に長いと見なす数。
///
/// **正常な定跡の候補手は 10 手前後。** これを超える列は、同じ局面が延々と
/// 繰り返されるファイルでしか出ない。
///
/// [`super::expand`] の `flush` が使う。ちょうどの大きさへ移し替えるか、そのまま渡すか。
/// 移し替えは一瞬だけ2本持つので、長い列では逆に膨らむ（実測 +47.8%）。
///
/// **`keep_first_of_each_move` の `SCAN_LIMIT` と同じ値だが、同じ定数にしない。**
/// 動かしたい向きが逆で、片方を実測で直した人がもう片方を壊す。
/// あちらは低くしたい（走査が二乗）、こちらは高くしたい（移し替えの費用）。
pub(super) const LONG_MOVE_LIST: usize = 32;

/// 読み切った後に1回だけ、全ての局面の重複を畳む。
///
/// **同じ指し手が2度出たら先に来た方を残す。本家は後勝ち。**
/// やねうら王は `MemoryBook::insert`（`book.cpp:166-183`。既定引数は `book.h:215`）が
/// `BookMoves::insert`（`book.cpp:120-145`）へ委譲する。`overwrite` の既定が `true` なので、
/// 既にある指し手を後の行で丸ごと置換し、採択回数だけ合算する（`book.cpp:129-138`）。
/// つまり `7g7f 8c8d 50 10` の後に `7g7f 8c8d 900 20` が並ぶ定跡で、
/// 本家は 900 を、こちらは 50 を返す。
///
/// **どちらでもよい。** 費用は変わらず（どちらの枝も1周のまま）、順序への依存も同じ
/// （上の2行を入れ替えれば、先勝ちでも返るのは 900 になる）。先勝ちを選んだのは、
/// [`keep_first_of_each_move`] の2つの枝が素直に書けるから。
///
/// **替えるなら、手順はここに求めず実装を読むこと。** 踏むものが複数ある ——
/// 2つの枝で残す位置を揃えること、[`keep_first_of_each_move`] の `HashSet` の枝の借用、
/// その枝を踏むテストが長さしか見ていないこと（`a_position_with_very_many_moves_is_still_deduped`。
/// 先勝ちでも後勝ちでも同じ 81 が通る）、`count` が `Option` なので合算の規則を先に決めること、
/// 先勝ちを名乗る綴りが名前とコメントに散っていること。
/// **どれも現物を開かないと正しい手順にならないので、ここには置かない。**
/// ただし1つだけ Rust のツリーの外にある —— `docs/state-transitions/yaneuraou-db-parse.md`
/// の一次資料の表が、この差を本家との差として記録している。**`cargo` は落とさない。**
///
/// **併合のたびに畳んではいけない。** 1回の仕事が `existing.len()` に比例するので、
/// 同じキーが N ブロックに分かれた定跡で総計が二乗になる。実測（同じキーを
/// N ブロック、各1手）:
///
/// | N | 併合のたびに畳む | 読み切った後に1回 |
/// | --- | --- | --- |
/// | 10,000 | 18.8 s | 0.34 s |
/// | 40,000 | 412 s | 38.9 s |
///
/// 畳む前は重複を抱えたままになるが、その量は [`super::limits::MAX_EXPANDED_BYTES`] が
/// `total_moves` の側で上界を持つ。
///
/// 畳んでから `shrink_to_fit` を掛ける。`push` の倍々成長が残す空き容量は、
/// 実測で展開後の 28%。
pub(super) fn keep_first_of_each_move_everywhere(positions: &mut HashMap<BookKey, Vec<BookMove>>) {
    for moves in positions.values_mut() {
        keep_first_of_each_move(moves);
        moves.shrink_to_fit();
    }
}

/// 同じ綴りの指し手を、先に来た方だけ残す。
///
/// **走査で畳むのは短い列のときだけ。** 1局面の候補手は普通10手前後なので、
/// そこで `HashSet` を作ると確保が局面の数だけ増える（実物の定跡で 225 万回）。
/// 一方、同じ局面が延々と繰り返されるファイルでは列が伸びて走査が二乗になる。
/// 実測で 6.22MB のファイルに 16 秒かかり、100MB なら 70 分を超える
/// （`open_book` は `spawn_blocking` の中で進捗も中断も持たないので、
/// アプリは無反応のまま戻らない）。長い列だけ `HashSet` へ切り替える。
fn keep_first_of_each_move(moves: &mut Vec<BookMove>) {
    /// 走査と `HashSet` の切り替え点。1局面の候補手がこれを超えるのは異常な形。
    ///
    /// [`LONG_MOVE_LIST`] と同じ値だが**別の判断**（あちらは移し替えの費用）。
    /// 動かしたい向きが逆なので、同じ定数にしない。
    const SCAN_LIMIT: usize = 32;

    if moves.len() <= SCAN_LIMIT {
        let mut kept = 0usize;
        for i in 0..moves.len() {
            if moves[..kept]
                .iter()
                .any(|m| m.usi_move == moves[i].usi_move)
            {
                continue;
            }
            moves.swap(kept, i);
            kept += 1;
        }
        moves.truncate(kept);
        return;
    }

    // 綴りを clone せず、添字だけ持つ。畳む対象が長い列なので、ここで
    // 要素数ぶんの `String` を確保すると畳む意味が薄れる。
    let mut seen: HashSet<&str> = HashSet::with_capacity(moves.len());
    let mut keep = Vec::with_capacity(moves.len());
    for m in moves.iter() {
        keep.push(seen.insert(m.usi_move.as_str()));
    }
    let mut kept = keep.into_iter();
    moves.retain(|_| kept.next().unwrap_or(false));
}
