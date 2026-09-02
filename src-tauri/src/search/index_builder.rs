use std::sync::Arc;

use thiserror::Error;

use shogi_core::PartialPosition;
use shogi_kifu_converter_obsshogi::jkf::{JsonKifuFormat, MoveFormat};

use super::{
    initial_position::initial_partial_position,
    node_table::{NodeTable, NodeTableBuilder},
    position_apply::{apply_node_action, jkf_move_to_core_move, ApplyError, ApplyStatus},
    position_key::{advance_key, key_from_partial_position, PositionKey},
    traverse::NodeAction,
    types::{CursorLite, FileId, ForkPointer, Gen, NodeId, Occurrence},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildPolicy {
    Loose,
    Strict,
}

/// 索引を組む途中で打ち切った手順。**利用者に出すのは [`BuildWarn::to_user_message`] だけ。**
#[derive(Debug, Clone)]
pub struct BuildWarn {
    /// どこで打ち切ったか。`tesuu` は**その手を指したあとの手数**で、
    /// `tesuu = N` は「N手目が指せなかった」を意味する（`walk_sequence` は
    /// `moves[1..]` を `start_tesuu = 1` で歩く）
    pub cursor: CursorLite,
    /// `ApplyError` の英語。**画面には出さない**（内部の理由）
    pub message: String,
}

impl BuildWarn {
    /// 利用者に出す文言にする。**`EVT_INDEX_WARN` に載るのはこれ。**
    ///
    /// `cursor` の `Debug` と `message`（`ApplyError` の英語）をそのまま並べると、
    /// 画面に `CursorLite { tesuu: 30, fork_pointers: [] }: side-to-move mismatch: …`
    /// が素のテキストで出る（`WorkspaceTab` は Markdown を解釈しない）。
    /// 何が起きたかが利用者の言葉になっておらず、次に何をすればよいかも無い。
    ///
    /// **内部の理由（`message`）はここで捨てる。** 呼び手がログへ回す。
    /// `fork_pointers` は画面で使い道が無いので出さない。
    ///
    /// **`tesuu` に足さない。** `walk_sequence` は `moves[1..]` を `start_tesuu = 1` で
    /// 歩くので、`tesuu` はそのまま「何手目が指せなかったか」。足すと、
    /// 索引に入っていない1つ先の手を名指しすることになる。
    /// 検索結果の `手数` 表示（`PositionHitItem`）も `tesuu` を素で描くので、
    /// ずらすとアプリの中で数え方が2つになる。
    pub fn to_user_message(&self) -> String {
        format!(
            "{}手目に、その局面では指せない手があります。\
             この手順はそこで打ち切られるので、より先の局面は検索に出ません",
            self.cursor.tesuu
        )
    }
}

#[derive(Debug)]
pub struct FileIndexBuild {
    /// 局面の鍵と、それが出た場所（どのファイルのどのノードか）の対。
    ///
    /// **[`crate::search::types::PositionHit`] ではない。** あちらは検索が返す形で、
    /// `cursor` を伴う。ここではまだ解決していない — `NodeTable` を引いて
    /// `cursor_lite` を通すのは `query_service` の仕事。
    pub entries: Vec<(PositionKey, Occurrence)>,
    pub node_table: Arc<NodeTable>,
    pub warns: Vec<BuildWarn>,
}

#[derive(Debug, Error)]
pub enum BuildError {
    #[error("failed to create initial position: {0}")]
    Initial(#[from] shogi_kifu_converter_obsshogi::error::ConvertError),

    #[error("failed to apply move at {cursor:?}: {source}")]
    Apply {
        cursor: CursorLite,
        #[source]
        source: ApplyError,
    },
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

    fn finish(self) -> FileIndexBuild {
        FileIndexBuild {
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
            let parent_pos = pos.clone();
            let parent_key = key;

            // forks
            if let Some(forks) = &node.forks {
                for (i, fork_line) in forks.iter().enumerate() {
                    if fork_line.is_empty() {
                        continue;
                    }
                    let mut fork_path2 = fork_path.clone();
                    push_or_replace_fork(&mut fork_path2, tesuu, i as u32);

                    self.walk_sequence(
                        fork_line,
                        tesuu,
                        parent_pos.clone(),
                        parent_key,
                        fork_path2,
                    )?;
                }
            }

            // mainline
            let action = node_action(node);

            // 差分は**指す前の局面**から取る。`apply_node_action` が
            // 局面を進めてしまうので、手を core の形にするのも先
            let stepped = match action {
                NodeAction::Move(m) => jkf_move_to_core_move(m)
                    .ok()
                    .and_then(|mv| advance_key(key, &pos, mv)),
                // 局面が動かない腕は鍵も動かない
                NodeAction::Special(_) | NodeAction::None => Some(key),
            };

            match apply_node_action(&mut pos, action) {
                Ok(status) => {
                    // **差分が読めなかったら盤を舐め直す。** 黙って違う鍵を作らない
                    key = stepped.unwrap_or_else(|| key_from_partial_position(&pos));
                    self.push_entry(tesuu, &fork_path, key);
                    if status == ApplyStatus::Terminal {
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
) -> Result<FileIndexBuild, BuildError> {
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

/// 1 ファイル分の entries を bucket に振り分け、`(z0, z1)` で stable sort する。
///
/// 同一ファイル内では `file_id` は一定、`node_id` も push 順 = 既にソート済みなので
/// tie-break は不要 (stable sort で挿入順が保たれる)。
pub fn bucketize_entries(
    entries: Vec<(PositionKey, Occurrence)>,
) -> [Vec<(PositionKey, Occurrence)>; 256] {
    let mut buckets: [Vec<(PositionKey, Occurrence)>; 256] = std::array::from_fn(|_| Vec::new());

    for e in entries {
        buckets[e.0.bucket() as usize].push(e);
    }

    for b in &mut buckets {
        b.sort_by_key(|(k, _)| (k.z0, k.z1));
    }

    buckets
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::test_kifu::one_move_kif;

    /// 警告の手数が、指せなかった手そのものを指す。
    ///
    /// `tesuu` の起点は `walk_sequence(&moves[1..], 1, ..)` で決まっていて、
    /// 1手目が `tesuu = 1`。**足すと索引に入っていない1つ先を名指しする**
    /// （打ち切るので、その手より先は入らない）。
    /// 検索結果の `手数` 表示も `tesuu` を素で描くので、ずらすと数え方が2つになる。
    #[test]
    fn the_warning_names_the_move_that_could_not_be_played() {
        let warn = BuildWarn {
            cursor: CursorLite {
                tesuu: 30,
                fork_pointers: vec![],
            },
            message: "side-to-move mismatch".to_owned(),
        };
        let message = warn.to_user_message();

        assert!(
            message.starts_with("30手目"),
            "指せなかった手そのものを言っていない: {message}"
        );
        // 内部の理由は出さない。`WorkspaceTab` は素のテキストで描く
        assert!(
            !message.contains("side-to-move"),
            "内部の理由が画面に出る: {message}"
        );
    }

    /// `tesuu` の起点を、組み立ての側から固定する。
    ///
    /// 上のテストは `CursorLite` を手で組むので、**`walk_sequence` が
    /// 起点を変えても緑のまま**になる。1手指した棋譜の1手目が `tesuu = 1` で
    /// 索引に入ることを、実際に組み立てて見る。
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
}
