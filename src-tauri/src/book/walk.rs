//! 候補手の先を、定跡が続くかぎり辿る。
//!
//! 定跡ビューは盤を持たない（ADR-0010）。「その手を指した先も定跡にあるか」を
//! 出す手段が列しか無いので、**どこまで続くかを数える**のがこの段の仕事。
//!
//! **フロントで辿らせない。** 1手進めるたびに `lookup_book_moves` を呼ぶ形にすると、
//! 候補 N 本 × 深さのぶんだけ IPC を往復する。局面を進めるたびに全部やり直すので、
//! 盤の操作が定跡の深さに比例して重くなる。
//!
//! 局面を進めるのは `shogi_core`、指し手の綴りを読むのは [`super::usi_move`]。

use crate::book::error::{excerpt, truncate_path, BookError, BookErrorCode};
use crate::book::session::BookSession;
use crate::book::sfen::key::{to_book_key, BookKey};
use crate::book::usi_move::to_core_move;
use crate::search::position::sfen_position::partial_position_from_sfen;
use serde::Serialize;
use shogi_core::PartialPosition;

/// 1本の線を辿る上限（手数）。
///
/// **上限そのものに正しい値は無い。** 同じ局面へ戻る線を含む定跡は無限に続く
/// （キーから手数が落ちているので、循環は必ず循環として現れる）ので、止める値が要る。
/// 64 手は、実物の定跡が切れるより先にここへ当たることが起きにくい長さとして選んである。
///
/// **当たったのか切れたのかを混ぜない。** 当たったことは
/// [`BookWalkStop::DepthCap`] として画面に出る。
pub(crate) const MAX_WALK_PLIES: u32 = 64;

/// 候補手1本を辿った結果。
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookLine {
    /// 辿り始めた手。**入力の綴りをそのまま返す。**
    ///
    /// 並びだけで突き合わせさせない —— 呼び出し側が候補手の一覧を並べ替えた後に
    /// 添字で引くと、黙って別の手の長さを出す
    pub usi_move: String,
    /// 定跡に沿って進めた手数。**辿り始めた手を含む。**
    ///
    /// `1` は「その手は指せたが、指した先は定跡に無い」＝行き止まり。
    /// `0` は辿り始めた手すら局面に当てられなかったとき（[`BookWalkStop::BrokenMove`]）
    pub plies: u32,
    pub stopped: BookWalkStop,
}

/// 辿るのをやめた理由。
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BookWalkStop {
    /// 進めた先が定跡に無かった。**これが普通の終わり方**
    OutOfBook,
    /// [`MAX_WALK_PLIES`] に当たった。**まだ続いている可能性がある**
    DepthCap,
    /// 定跡に書かれている手が、その局面に当てられなかった。
    ///
    /// 定跡ファイルの破損か、別の初期配置に向けて作られた定跡を開いている。
    /// **失敗にして全体を止めない** —— 1本の線が壊れているだけで、
    /// 他の候補手は読めることのほうが多い
    BrokenMove,
}

/// 候補手それぞれの先を辿る。**返る並びは `moves` と同じ。**
///
/// `sfen` は辿り始める局面。`moves` はその局面の候補手で、
/// [`crate::book::commands::lookup_book_moves`] が返したものを渡すことを想定している
/// （ここでは確かめない。定跡に無い手を渡せば 1 手で切れるだけ）。
///
/// 仕事の量は `moves.len() × MAX_WALK_PLIES` 回の lookup で頭打ちになる。
pub(crate) fn walk_lines(
    book: &BookSession,
    start: &BookKey,
    moves: &[String],
) -> Result<Vec<BookLine>, BookError> {
    let position = start_position(start)?;

    moves
        .iter()
        .map(|usi| walk_line(book, &position, usi))
        .collect()
}

/// 辿り始める局面。
///
/// **受けるのは生の SFEN ではなく [`BookKey`]。** 綴りを正規化するのは
/// コマンド境界（`resolve_lookup`）の仕事で、`lookup_book_moves` と同じ関門を
/// 通った後のものだけがここへ来る。生の綴りを直に受けると、`startpos` や
/// `position sfen` の前置きを受ける／受けないが引く側と食い違い、
/// **同じ局面で引けるのに辿れない**という形になる。
///
/// **`book` から `search` へ伸びる唯一の辺。** 綴りを局面にする実装をこちらへ
/// 写すと、受理集合が3つになる（2つある問題は #236）。
fn start_position(key: &BookKey) -> Result<PartialPosition, BookError> {
    // 手数はキーから落ちている。辿るのに手数は要らないので、綴りを通すためだけに 1 を足す
    partial_position_from_sfen(&format!("{} 1", key.as_str())).map_err(|reason| {
        BookError::new(
            BookErrorCode::InvalidSfen,
            format!(
                "この局面から定跡を辿れない（{reason}: {}）。\
                 盤面を操作し直しても直らなければ不具合として報告すること",
                excerpt(key.as_str())
            ),
        )
    })
}

fn line(first: &str, plies: u32, stopped: BookWalkStop) -> BookLine {
    BookLine {
        usi_move: first.to_string(),
        plies,
        stopped,
    }
}

/// 辿った先の局面を鍵にできないときの理由文。
///
/// **`to_book_key` の理由文をそのまま出さない。** あちらは「盤面を操作し直せ」で
/// 終わるが、ここで読めない局面は利用者の盤操作ではなく、定跡の手を当てて自分で
/// 作った局面。従える操作が対応しない。
///
/// **組み立てだけを切り出す。** クロージャの中に文面を埋めると、
/// この枝だけ誰も見ないまま残る（`commands.rs` の `unknown_message` と同じ理由）。
fn unreachable_key_message(reason: &str, at: u32) -> String {
    format!(
        "定跡を{at}手まで辿ったところで局面を鍵にできなかった（{reason}）。\
         定跡ファイルが壊れているかもしれない。取得し直すか、別の定跡を開くこと"
    )
}

/// 定跡に書かれた手を当てられなかったことを、ログに残す。
///
/// **値で返すだけでは診断が残らない。** 「この先の列が全部おかしい」と報告された
/// とき、[`BookWalkStop::BrokenMove`] の doc が挙げる2つの原因（ファイルの破損か、
/// 別の初期配置向けか）を切り分ける材料が他に1つも無い。
/// `Ok` で返るので `commands.rs` の `logged` は通らない。
///
/// 線ごとに高々1回なので、1回の `walk_book_lines` で候補手の本数を超えない。
fn log_broken_move(path: &str, usi: &str, plies: u32) {
    log::warn!(
        "[book] 定跡の手を局面に当てられない path={} move={} plies={plies}",
        truncate_path(path),
        excerpt(usi)
    );
}

/// 1本の線を、定跡が続くかぎり辿る。
///
/// **辿る先は、定跡に書かれている順の先頭。** どれを主戦線と見なすかを評価値で
/// 決め直さない —— 並びは reader が形式ごとに保っているもので、ここで並べ替えると
/// 「定跡の作者が置いた順」という情報が消える。
fn walk_line(
    book: &BookSession,
    start: &PartialPosition,
    first: &str,
) -> Result<BookLine, BookError> {
    let mut position = start.clone();
    let mut next = first.to_string();
    let mut plies = 0;

    loop {
        // **手番は局面から取る。** 手番が要るのは打つ手だけ（打つ手の綴りには
        // 手番が現れない）で、盤上の手は `make_move` が局面の側の手番を使う。
        // 別に持ち回ると、ずれても盤上の手は動いてしまい、打つ手だけが
        // 「自分の駒ではない」で弾かれる
        let broken = match to_core_move(&next, position.side_to_move()) {
            None => true,
            Some(mv) => position.make_move(mv).is_none(),
        };
        if broken {
            log_broken_move(&book.info.path, &next, plies);
            return Ok(line(first, plies, BookWalkStop::BrokenMove));
        }
        plies += 1;

        if plies >= MAX_WALK_PLIES {
            return Ok(line(first, plies, BookWalkStop::DepthCap));
        }

        let key = to_book_key(&position.to_sfen_owned()).map_err(|err| {
            BookError::new(
                BookErrorCode::InvalidContent,
                unreachable_key_message(err.message(), plies),
            )
            .with_path(&book.info.path)
        })?;
        match book.reader.lookup(&key)?.first() {
            Some(top) => next = top.usi_move.clone(),
            None => return Ok(line(first, plies, BookWalkStop::OutOfBook)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::reader::BookReader;
    use crate::book::types::{BookFormat, BookInfo, BookMove};
    use std::collections::HashMap;

    const HIRATE: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

    /// キーの綴りから候補手を返すだけの定跡。
    ///
    /// **実ファイルを置かない。** 辿る側が見ているのは「引けたか」だけで、
    /// 形式ごとの読み方は `yaneuraou_db` の側が見ている。
    struct MapReader(HashMap<String, Vec<BookMove>>);

    impl BookReader for MapReader {
        fn lookup(&self, key: &BookKey) -> Result<Vec<BookMove>, BookError> {
            Ok(self.0.get(key.as_str()).cloned().unwrap_or_default())
        }
    }

    fn book_move(usi: &str) -> BookMove {
        BookMove {
            usi_move: usi.to_string(),
            ponder: None,
            value: None,
            depth: None,
            count: None,
        }
    }

    fn session(entries: HashMap<String, Vec<BookMove>>) -> BookSession {
        BookSession {
            info: BookInfo {
                handle: 1,
                path: "/books/walk.db".to_string(),
                format: BookFormat::YaneuraouDb,
                position_count: Some(entries.len() as u64),
                dropped_fields: Some(0),
            },
            reader: Box::new(MapReader(entries)),
        }
    }

    fn key(sfen: &str) -> BookKey {
        to_book_key(sfen).expect("引ける局面")
    }

    fn key_of(sfen: &str) -> String {
        key(sfen).as_str().to_string()
    }

    /// 初期局面から `moves` を順に指した局面のキー。
    fn key_after(moves: &[&str]) -> String {
        let mut position = start_position(&key(HIRATE)).expect("平手は読める");
        for usi in moves {
            let mv = to_core_move(usi, position.side_to_move()).expect("綴りは正しい");
            position.make_move(mv).expect("指せる手");
        }
        key_of(&position.to_sfen_owned())
    }

    /// 初期局面から `moves` を順に指した各局面へ、その次の手だけを載せた定跡。
    ///
    /// 最後の手を指した先には何も載らないので、そこが定跡の切れ目になる。
    fn book_along(moves: &[&str]) -> BookSession {
        let mut position = start_position(&key(HIRATE)).expect("平手は読める");
        let mut entries = HashMap::new();

        for usi in moves {
            entries.insert(key_of(&position.to_sfen_owned()), vec![book_move(usi)]);
            let mv = to_core_move(usi, position.side_to_move()).expect("綴りは正しい");
            position.make_move(mv).expect("指せる手");
        }

        session(entries)
    }

    fn walk(book: &BookSession, first: &str) -> BookLine {
        let lines = walk_lines(book, &key(HIRATE), &[first.to_string()]).expect("辿れるはず");
        lines.into_iter().next().expect("1本返る")
    }

    /// 定跡が切れたところまでの手数が返ること。**最初の手を含めて数える。**
    ///
    /// 数え方を1つずらす変異（`plies += 1` を lookup の後へ移す）はここで落ちる。
    #[test]
    fn counts_the_plies_until_the_book_runs_out() {
        let book = book_along(&["7g7f", "3c3d", "2g2f"]);

        let walked = walk(&book, "7g7f");

        assert_eq!(walked.plies, 3);
        assert_eq!(walked.stopped, BookWalkStop::OutOfBook);
    }

    /// 定跡に続きの無い手は1手で終わること（＝行き止まり）。
    #[test]
    fn a_move_the_book_does_not_continue_is_one_ply() {
        let book = book_along(&["7g7f", "3c3d"]);

        // 指せるが、この定跡はこの手の先を持っていない
        let walked = walk(&book, "2g2f");

        assert_eq!(walked.plies, 1);
        assert_eq!(walked.stopped, BookWalkStop::OutOfBook);
    }

    /// その局面に当てられない手は、手数 0 の壊れた行として返ること。
    ///
    /// **失敗にしない。** 失敗にすると、1行壊れているだけの定跡で表が丸ごと消える。
    #[test]
    fn a_move_that_does_not_apply_is_reported_as_broken() {
        let book = book_along(&["7g7f"]);

        // 5五に駒は無い
        let walked = walk(&book, "5e5f");

        assert_eq!(walked.plies, 0);
        assert_eq!(walked.stopped, BookWalkStop::BrokenMove);
    }

    /// 循環する定跡でも止まること。**止まった理由が切れ目と区別できること。**
    ///
    /// キーから手数が落ちているので、同じ局面へ戻る線は必ず循環になる。
    /// 上限が無いと、この定跡を開いた時点で画面が返らなくなる。
    #[test]
    fn a_book_that_loops_stops_at_the_cap() {
        let book = book_along(&["7i6h", "3a4b", "6h7i", "4b3a"]);

        let walked = walk(&book, "7i6h");

        assert_eq!(walked.plies, MAX_WALK_PLIES);
        assert_eq!(walked.stopped, BookWalkStop::DepthCap);
    }

    /// 辿る先は、定跡が並べた順の先頭であること。
    ///
    /// **並びが効くのは、辿っている途中で引いた局面だけ。** 辿り始めの手は
    /// 呼び出し側が渡すので、最初の局面に何本並べても実装の選び方は現れない。
    /// 分かれ目は1手目を指した**後**に置く。
    ///
    /// 先頭（3c3d）はそこで切れ、2番目（8c8d）だけが続きを持つので、
    /// 評価値で選び直す実装は長いほうを返して落ちる。
    #[test]
    fn the_order_the_book_wrote_decides_the_line() {
        let entries = HashMap::from([
            (key_after(&[]), vec![book_move("7g7f")]),
            (
                key_after(&["7g7f"]),
                vec![
                    BookMove {
                        value: Some(10),
                        ..book_move("3c3d")
                    },
                    BookMove {
                        value: Some(999),
                        ..book_move("8c8d")
                    },
                ],
            ),
            (key_after(&["7g7f", "8c8d"]), vec![book_move("2g2f")]),
        ]);

        let walked = walk(&session(entries), "7g7f");

        // 先頭を辿るなら 7g7f → 3c3d で切れて 2 手。
        // 評価値で選ぶと 7g7f → 8c8d → 2g2f で 3 手になる
        assert_eq!(walked.plies, 2);
    }

    /// 渡した並びのまま、手の綴りを添えて返ること。
    ///
    /// **1本が壊れていても他は返ること**も同時に見る。
    #[test]
    fn every_candidate_comes_back_in_the_order_it_was_given() {
        let book = book_along(&["7g7f", "3c3d"]);
        let asked = ["5e5f".to_string(), "7g7f".to_string(), "2g2f".to_string()];

        let lines = walk_lines(&book, &key(HIRATE), &asked).expect("辿れるはず");

        assert_eq!(
            lines
                .iter()
                .map(|l| l.usi_move.as_str())
                .collect::<Vec<_>>(),
            ["5e5f", "7g7f", "2g2f"]
        );
        assert_eq!(
            lines.iter().map(|l| l.stopped).collect::<Vec<_>>(),
            [
                BookWalkStop::BrokenMove,
                BookWalkStop::OutOfBook,
                BookWalkStop::OutOfBook
            ]
        );
    }

    /// 辿った先が鍵にできないときの文面が、次にやることで終わること。
    ///
    /// **この枝は踏みにくい** —— 局面から作った綴りは `to_book_key` を通るのが
    /// 普通なので、文面だけが誰にも読まれないまま腐る。`to_book_key` の理由文
    /// （「盤面を操作し直せ」）を流用していないことも同時に見る。
    #[test]
    fn the_unreachable_key_message_ends_with_something_the_user_can_do() {
        let message = unreachable_key_message("持駒の綴りが読めない", 7);

        assert!(message.ends_with("こと"), "{message}");
        // 原文は残す。落とすとログから切り分けられなくなる
        assert!(message.contains("持駒の綴りが読めない"), "{message}");
        // どこまで辿れたかを添える。添えないと壊れた行を探せない
        assert!(message.contains("7手"), "{message}");
        // 利用者の盤操作ではないので、そちらへ案内しない
        assert!(!message.contains("盤面を操作"), "{message}");
    }

    /// 後手番の局面で、後手が打つ手を辿れること。
    ///
    /// **手番が効くのは打つ手だけ。** 盤上の手は `make_move` が局面の側の手番を
    /// 使うので、先手に決め打っても動いてしまう。打つ手の綴りには手番が現れないので、
    /// [`to_core_move`] へ渡す手番を取り違えると `make_move` が「自分の駒ではない」で弾き、
    /// **後手番の局面の打つ手だけが「壊れた行」に見える。**
    ///
    /// `partial_position_from_sfen` が手番を落とす変異でも落ちる。
    #[test]
    fn a_drop_by_white_is_walked_with_whites_hand() {
        // 後手番。後手の持駒に歩が1枚（盤の歩を1枚減らして18枚に収めてある）
        let start = key("lnsgkgsnl/1r5b1/1pppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w p 1");
        let book = session(HashMap::from([(
            start.as_str().to_string(),
            vec![book_move("P*5e")],
        )]));

        let lines = walk_lines(&book, &start, &["P*5e".to_string()]).expect("辿れるはず");
        let walked = lines.into_iter().next().expect("1本返る");

        assert_eq!(walked.stopped, BookWalkStop::OutOfBook);
        assert_eq!(walked.plies, 1);
    }
}
