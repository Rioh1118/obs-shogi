use std::sync::Arc;

use shogi_core::PartialPosition;
use shogi_kifu_converter_obsshogi::jkf::{JsonKifuFormat, MoveFormat};

use crate::search::index::build_report::{BuildError, BuildWarn};
use crate::search::position::initial_position::initial_partial_position;
use crate::search::position::position_apply::{
    apply_node_action, jkf_move_to_core_move, ApplyError, ApplyStatus, NodeAction,
};
use crate::search::position::position_key::{advance_key, key_from_partial_position, PositionKey};
use crate::search::store::node_table::{NodeTable, NodeTableBuilder};
use crate::search::types::{CursorLite, FileId, ForkPointer, Gen, NodeId, Occurrence};

/// 指せない手に当たったとき、その1手順を捨てるか、ファイルごと諦めるか。
///
/// **索引に何が入るかを決める最大のスイッチ。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildPolicy {
    /// その手順だけ打ち切って [`BuildWarn`] を積む。**本番はこちらだけを使う。**
    ///
    /// **「その手順だけ」は、その線の残り全部を含む。** `walk_sequence` は
    /// `break` でその線の `for` を抜けるので、**指せなかった手より後ろのノードに
    /// ぶら下がる変化も歩かない**。歩き終わっているのは、その手までの本譜と、
    /// そこまでの各ノードから分かれた変化（`forks` は手を指す前に降りる）。
    /// `BuildWarn` の `Display` が「より先の局面は検索に出ません」と言うのは
    /// この範囲を指す
    Loose,
    /// ファイルごと [`BuildError`] にする。**本番の呼び手は無い。**
    /// 使うなら、`Display` が画面に出ることを先に手当てすること
    Strict,
}

#[derive(Debug)]
pub struct IndexedFile {
    /// 局面の鍵と、それが出た場所（どのファイルのどのノードか）の対。
    ///
    /// **[`crate::search::types::PositionHit`] ではない。** あちらは検索が返す形で、
    /// `cursor` を伴う。ここではまだ解決していない — `NodeTable` を引いて
    /// `cursor_lite` を通すのは `query_service` の仕事。
    pub entries: Vec<(PositionKey, Occurrence)>,
    pub node_table: Arc<NodeTable>,
    pub warns: Vec<BuildWarn>,
}

#[derive(Debug)]
struct IndexBuilder {
    file_id: FileId,
    gen: Gen,
    policy: BuildPolicy,
    node_table: NodeTableBuilder,
    entries: Vec<(PositionKey, Occurrence)>,
    warns: Vec<BuildWarn>,
}

impl IndexBuilder {
    fn new(file_id: FileId, gen: Gen, policy: BuildPolicy) -> Self {
        Self {
            file_id,
            gen,
            policy,
            node_table: NodeTableBuilder::new(),
            entries: Vec::new(),
            warns: Vec::new(),
        }
    }

    fn finish(self) -> IndexedFile {
        IndexedFile {
            entries: self.entries,
            node_table: Arc::new(self.node_table.finish()),
            warns: self.warns,
        }
    }

    #[inline]
    fn push_entry(&mut self, tesuu: u32, fork_path: &[ForkPointer], key: PositionKey) {
        let node_id: NodeId = self.node_table.push_node(tesuu, fork_path);

        let occ = Occurrence {
            file_id: self.file_id,
            gen: self.gen,
            node_id,
        };

        self.entries.push((key, occ));
    }

    fn walk_sequence(
        &mut self,
        seq: &[MoveFormat],
        start_tesuu: u32,
        mut pos: PartialPosition,
        mut key: PositionKey,
        fork_path: Vec<ForkPointer>,
    ) -> Result<(), BuildError> {
        for (offset, node) in seq.iter().enumerate() {
            let tesuu = start_tesuu + offset as u32;

            // **変化は、この節の手を指す前に降りる。** 変化はこの手の
            // 代わりに指されるものなので、始まりの盤は指す前の局面。
            // 指した後に降りると、変化の中の局面が全部ずれて別の鍵になる
            if let Some(forks) = &node.forks {
                for (i, fork_line) in forks.iter().enumerate() {
                    if fork_line.is_empty() {
                        continue;
                    }
                    let mut fork_path2 = fork_path.clone();
                    push_or_replace_fork(&mut fork_path2, tesuu, i as u32);

                    self.walk_sequence(fork_line, tesuu, pos.clone(), key, fork_path2)?;
                }
            }

            match step(&mut pos, key, node) {
                Ok((next_key, status)) => {
                    key = next_key;
                    self.push_entry(tesuu, &fork_path, key);
                    if status == ApplyStatus::Special {
                        break;
                    }
                }
                Err(e) => match self.policy {
                    BuildPolicy::Strict => {
                        let cursor = CursorLite {
                            tesuu,
                            fork_pointers: fork_path.clone(),
                        };
                        return Err(BuildError::Apply { cursor, source: e });
                    }
                    BuildPolicy::Loose => {
                        self.warns.push(BuildWarn {
                            cursor: CursorLite {
                                tesuu,
                                fork_pointers: fork_path.clone(),
                            },
                            message: e.to_string(),
                        });
                        break;
                    }
                },
            }
        }
        Ok(())
    }
}

/// 1つのJKFを全分岐込みで列挙して、局面キーと出現箇所を集める
///
/// - root( tesuu=0 ) も必ず入れる（開始局面）
/// - node_id はこの関数内で 0.. の連番で採番する
pub fn build_index_for_jkf(
    file_id: FileId,
    gen: Gen,
    jkf: &JsonKifuFormat,
    policy: BuildPolicy,
) -> Result<IndexedFile, BuildError> {
    let init_pos = initial_partial_position(jkf)?;
    // 初期局面だけはフル計算。ここから先は差分で進める
    let init_key = key_from_partial_position(&init_pos);

    let mut b = IndexBuilder::new(file_id, gen, policy);

    // root
    b.push_entry(0, &[], init_key);

    if jkf.moves.len() > 1 {
        b.walk_sequence(&jkf.moves[1..], 1, init_pos, init_key, vec![])?;
    }

    Ok(b.finish())
}

/// 節を1つ食べて、盤と鍵を進める。
///
/// 失敗したら `pos` は動いていない（`apply_node_action` が盤に触る前に返る）。
///
/// # 鍵を進める順番に前提がある
///
/// **差分は指す前の局面から取る。** `apply_node_action` が `pos` を進めてしまうので、
/// 手を `shogi_core` の形にするのも `advance_key` を呼ぶのも、指す前に済ませる。
///
/// 順番を入れ替えても**鍵は正しいまま**。進んだ後の盤では `from` に駒がおらず
/// （打ちなら `to` が埋まっており）`advance_key` が必ず `None` を返すので、
/// 下のフル計算が正しい値を出す。**壊れるのは速さだけ** — 差分更新が丸ごと死んで
/// 全ノードで盤を舐め直すようになる。**どのテストにも見えない**ので、
/// ここを動かすときは `benches/search_bench.rs` を測ること。
///
/// **差分が読めなかったら盤を舐め直す。** `advance_key` が `None` を返すのは
/// 持駒の枚数が `u8` の上限で折り返すなど、差分が答えられない形。
/// そのとき黙って違う鍵を作らずにフル計算へ落とす。落とさないと、索引に入る値が
/// 静かに壊れる — 検索が当たらなくなるだけで、エラーも警告も出ない。
fn step(
    pos: &mut PartialPosition,
    key: PositionKey,
    node: &MoveFormat,
) -> Result<(PositionKey, ApplyStatus), ApplyError> {
    let action = node_action(node);

    let stepped = match action {
        NodeAction::Move(m) => jkf_move_to_core_move(m)
            .ok()
            .and_then(|mv| advance_key(key, pos, mv)),
        // 局面が動かない腕は鍵も動かない
        NodeAction::Special(_) | NodeAction::None => Some(key),
    };

    let status = apply_node_action(pos, action)?;
    Ok((
        stepped.unwrap_or_else(|| key_from_partial_position(pos)),
        status,
    ))
}

#[inline]
fn node_action(node: &MoveFormat) -> NodeAction {
    if let Some(m) = node.move_ {
        NodeAction::Move(m)
    } else if let Some(s) = node.special {
        NodeAction::Special(s)
    } else {
        NodeAction::None
    }
}

#[inline]
fn push_or_replace_fork(fps: &mut Vec<ForkPointer>, te: u32, fork_index: u32) {
    if let Some(pos) = fps.iter().position(|p| p.te == te) {
        fps[pos].fork_index = fork_index;
    } else {
        fps.push(ForkPointer { te, fork_index });
    }
    fps.sort_by_key(|p| p.te);
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::kifu::one_move_kif;

    /// `Loose` でも開始局面の失敗は返る。**そのときの文言も利用者の言葉であること。**
    ///
    /// `build_index_for_jkf` は `initial_partial_position` を `policy` より前で
    /// 呼ぶので、`Loose` はこの失敗を受け止めない。`.jkf` は外部の JSON を
    /// そのまま信じ、`says_nothing` も `preset != PresetHirate` を通すので、
    /// **`{"initial":{"preset":"OTHER"}}` だけでここへ届く**。
    ///
    /// `BuildError` の `Display` は呼び手の `map_err(|e| e.to_string())` を通って
    /// `EVT_INDEX_WARN` に素のテキストで出る（`api.rs` / `project_manager.rs`）。
    #[test]
    fn a_jkf_without_an_initial_board_fails_in_the_users_words() {
        // `preset: OTHER` は「盤面を書く」の意味なのに `data` が無い
        let jkf: JsonKifuFormat =
            serde_json::from_str(r#"{"header":{},"initial":{"preset":"OTHER"},"moves":[{}]}"#)
                .expect("題材の JKF が読めること");

        let err = build_index_for_jkf(1, 1, &jkf, BuildPolicy::Loose)
            .expect_err("開始局面が組めない棋譜が通った");
        let message = err.to_string();

        assert!(
            !message.starts_with("failed to"),
            "内部の英語がそのまま画面に出る: {message}"
        );
        assert!(
            message.contains("検索に出ません"),
            "何を失ったかを言っていない: {message}"
        );
        assert!(
            message.contains("ください"),
            "次に何をすればよいかが無い: {message}"
        );
    }

    /// **組み立てから警告までを1本の題材で繋ぐ。**
    ///
    /// `BuildWarn` の `Display` を見る他のテストは `CursorLite` を手で組むので、
    /// **`BuildWarn` を作る行（`walk_sequence` の `Loose` の腕）を通らない**。
    /// そこを `tesuu + 1` に書き換えると他は緑のまま文言だけがずれるので、
    /// 実際に指せない手を通して番号を見る。
    ///
    /// 題材は先手の1手目を2回並べる。断るのは `make_move` ではなく
    /// **`apply_node_action` の手番の照合**で、盤に触る前に返る
    /// （`position_apply.rs` の `SideToMoveMismatch`）。
    /// 2手目は先手の手なのに、そこでの手番は後手。
    #[test]
    fn the_warning_names_the_move_the_builder_stopped_at() {
        use shogi_kifu_converter_obsshogi::parser::parse_kif_str;

        let one = parse_kif_str(&one_move_kif("平手")).expect("題材の KIF が読めること");
        let mut jkf = one.clone();
        // 1手目をもう1度繰り返す。7七の歩はもう居ないので2手目で必ず失敗する
        jkf.moves.push(one.moves[1].clone());

        let built =
            build_index_for_jkf(1, 1, &jkf, BuildPolicy::Loose).expect("Loose は Err にしない");

        assert_eq!(built.warns.len(), 1, "警告が1件でない: {:?}", built.warns);
        assert_eq!(
            built.warns[0].cursor.tesuu, 2,
            "指せなかったのは2手目なのに {} と言っている",
            built.warns[0].cursor.tesuu
        );
        assert!(
            built.warns[0].to_string().contains("2手目"),
            "文言が2手目を指していない: {}",
            built.warns[0]
        );
        // 断った理由を固定する。題材を変えて別の理由で落ちるようになると、
        // 上の doc が指している経路を通らないまま緑になる
        assert!(
            built.warns[0].message.contains("side-to-move"),
            "手番の照合で断っていない: {}",
            built.warns[0].message
        );
        // 指せなかった手は索引に入らない。入るのは初期局面と1手目だけ
        let tesuu: Vec<u32> = built.node_table.nodes.iter().map(|n| n.tesuu).collect();
        assert!(
            !tesuu.contains(&2),
            "指せなかった手が索引に入っている: {tesuu:?}"
        );
    }

    /// `tesuu` の起点を、組み立ての側から固定する。
    ///
    /// `Display` だけを見る2本（`the_warning_names_the_move_that_could_not_be_played`
    /// と `the_warning_names_the_innermost_variation`）は `CursorLite` を手で組むので、
    /// **`walk_sequence` が起点を変えても緑のまま**になる。
    ///
    /// `the_warning_names_the_move_the_builder_stopped_at` も組み立てを通るが、
    /// **あちらが見るのは指せなかった手の番号**。成功した手が `tesuu = 1` から
    /// 始まることは見ていない（打ち切った先は索引に入らないので、見ようがない）。
    /// 1手指した棋譜を最後まで組んで、入った側の起点を見る。
    #[test]
    fn the_first_move_is_tesuu_one() {
        let jkf = shogi_kifu_converter_obsshogi::parser::parse_kif_str(&one_move_kif("平手"))
            .expect("題材の KIF が読めること");
        let built =
            build_index_for_jkf(1, 1, &jkf, BuildPolicy::Loose).expect("1手の棋譜が組めること");

        let tesuu: Vec<u32> = built.node_table.nodes.iter().map(|n| n.tesuu).collect();
        assert!(
            tesuu.contains(&0) && tesuu.contains(&1),
            "初期局面が 0、1手目が 1 になっていない: {tesuu:?}"
        );
    }

    // -----------------------------------------------------------
    // 歩き方そのもの
    //
    // 上の群が見ているのは利用者に出す文言。こちらは歩く順・分岐に降りる
    // 範囲・打ち切りがどこまで及ぶかを見る。**doc が主張していることを、
    // 主張のまま置かないための群。**
    //
    // 節に付く `node_id` は push 順の連番（`build_index_for_jkf` の doc）なので、
    // `node_table` を順に読めば訪問の順序がそのまま見える。
    // -----------------------------------------------------------

    /// 2手目に変化が1本ある棋譜。本譜は3手、変化は2手目から2手。
    fn kif_with_one_variation() -> &'static str {
        "手合割：平手\n\
手数----指手---------消費時間--\n   \
1 ７六歩(77)   ( 0:01/00:00:01)\n   \
2 ３四歩(33)   ( 0:01/00:00:02)\n   \
3 ２六歩(27)   ( 0:01/00:00:03)\n\
\n変化：2手\n   \
2 ８四歩(83)   ( 0:01/00:00:02)\n   \
3 ２五歩(27)   ( 0:01/00:00:03)\n"
    }

    fn build(text: &str) -> IndexedFile {
        let jkf = shogi_kifu_converter_obsshogi::parser::parse_kif_str(text)
            .expect("題材の KIF が読めること");
        build_index_for_jkf(1, 1, &jkf, BuildPolicy::Loose).expect("組めること")
    }

    /// 訪れた順に `(tesuu, fork_pointers)` を並べる。`node_id` は push 順の連番。
    fn visits(built: &IndexedFile) -> Vec<(u32, Vec<(u32, u32)>)> {
        (0..built.node_table.nodes.len() as u32)
            .map(|id| {
                let c = built
                    .node_table
                    .cursor_lite(id)
                    .expect("node_id は連番なので必ず引ける");
                (
                    c.tesuu,
                    c.fork_pointers
                        .iter()
                        .map(|p| (p.te, p.fork_index))
                        .collect(),
                )
            })
            .collect()
    }

    /// **変化は、それが置き換える手より先に歩かれる。**
    ///
    /// `walk_sequence` は節の `forks` を、その節の手を指すより前に降りる。
    /// 逆にすると、変化の中の局面が本譜の手を指した後の盤から作られて
    /// **全部違う鍵になる**（症状は検索が当たらないことだけ）。
    ///
    /// 変化の1手目は、置き換える手と**同じ手数**で始まる。
    #[test]
    fn a_variation_is_walked_before_the_move_it_replaces() {
        let built = build(kif_with_one_variation());

        assert_eq!(
            visits(&built),
            vec![
                (0, vec![]),       // 初期局面
                (1, vec![]),       // 本譜1手目
                (2, vec![(2, 0)]), // 変化の1手目。本譜の2手目より先
                (3, vec![(2, 0)]), // 変化の2手目
                (2, vec![]),       // 本譜2手目
                (3, vec![]),       // 本譜3手目
            ],
            "歩く順か分岐の印が変わった"
        );
    }

    /// **変化の中で指せない手に当たっても、本譜は最後まで入る。**
    ///
    /// `BuildPolicy::Loose` の doc が言う「その手順だけ打ち切る」の範囲を見る。
    /// 打ち切りは `break` なので**その線の残り全部**が落ちるが、
    /// 呼び手の `for` は次へ進むので兄弟の線と本譜は生き残る。
    #[test]
    fn an_unplayable_move_in_a_variation_leaves_the_mainline_indexed() {
        // 変化の2手目に、その局面では指せない手（1手目の繰り返し）を置く
        let text = "手合割：平手\n\
手数----指手---------消費時間--\n   \
1 ７六歩(77)   ( 0:01/00:00:01)\n   \
2 ３四歩(33)   ( 0:01/00:00:02)\n   \
3 ２六歩(27)   ( 0:01/00:00:03)\n\
\n変化：2手\n   \
2 ８四歩(83)   ( 0:01/00:00:02)\n   \
3 ８四歩(83)   ( 0:01/00:00:03)\n";
        let built = build(text);

        assert_eq!(built.warns.len(), 1, "警告が1件でない: {:?}", built.warns);
        assert_eq!(
            built.warns[0].cursor.fork_pointers.len(),
            1,
            "打ち切ったのが変化の中だと言っていない"
        );

        assert_eq!(
            visits(&built),
            vec![
                (0, vec![]),
                (1, vec![]),
                (2, vec![(2, 0)]), // 変化の1手目は入る
                // 変化の2手目は指せないので入らない
                (2, vec![]), // 本譜は続く
                (3, vec![]),
            ],
            "打ち切りが本譜まで巻き込んでいる"
        );
    }

    /// **特殊手の節も索引に入り、そこで線が止まる。**
    ///
    /// 投了は局面を動かさないので鍵は直前と同じ。それでも節としては
    /// 積まれる（`walk_sequence` は `push_entry` を済ませてから `break` する）。
    #[test]
    fn a_special_node_is_indexed_and_ends_the_line() {
        let text = "手合割：平手\n\
手数----指手---------消費時間--\n   \
1 ７六歩(77)   ( 0:01/00:00:01)\n   \
2 投了   ( 0:01/00:00:02)\n";
        let built = build(text);

        assert_eq!(
            visits(&built),
            vec![(0, vec![]), (1, vec![]), (2, vec![])],
            "投了の節が索引に入っていない"
        );

        let keys: Vec<PositionKey> = built.entries.iter().map(|(k, _)| *k).collect();
        assert_eq!(keys[1], keys[2], "投了で局面が動いたことになっている");
    }

    /// **同じ手数で分岐し直したら、印は増えずに置き換わる。**
    ///
    /// 変化の1手目にさらに変化がぶら下がると、`fork_path` に同じ `te` が
    /// 2度来る。足してしまうと `te` が重複した経路になり、画面側の
    /// `cursorFromLite` が解けない形が索引に入る。
    ///
    /// **この腕は組み立てを通るテストでは踏めない**（題材を作れない）ので、
    /// 印を組む関数を直に見る。
    #[test]
    fn a_second_fork_at_the_same_move_replaces_the_pointer() {
        let mut fps = vec![];
        push_or_replace_fork(&mut fps, 10, 0);
        push_or_replace_fork(&mut fps, 20, 1);
        assert_eq!(fps.len(), 2, "別の手数なら足す");

        push_or_replace_fork(&mut fps, 20, 2);
        assert_eq!(fps.len(), 2, "同じ手数で増えた");
        assert_eq!(fps[1].fork_index, 2, "置き換わっていない");

        // 並びは手数の昇順。`cursorFromLite` が前提にしている
        push_or_replace_fork(&mut fps, 15, 0);
        let te: Vec<u32> = fps.iter().map(|p| p.te).collect();
        assert_eq!(te, vec![10, 15, 20], "手数の昇順になっていない");
    }
}
