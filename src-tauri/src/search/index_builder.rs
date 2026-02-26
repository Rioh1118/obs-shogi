use std::sync::Arc;

use thiserror::Error;

use shogi_core::PartialPosition;
use shogi_kifu_converter::jkf::{JsonKifuFormat, MoveFormat};

use super::{
    initial_position::{initial_partial_position, InitialPosError},
    node_table::{NodeTable, NodeTableBuilder},
    position_apply::{apply_node_action, ApplyError, ApplyStatus},
    position_key::{key_from_partial_position, PositionKey},
    traverse::NodeAction,
    types::{CursorLite, FileId, ForkPointer, Gen, NodeId, Occurrence},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildPolicy {
    Loose,
    Strict,
}

#[derive(Debug, Clone)]
pub struct BuildWarn {
    pub cursor: CursorLite,
    pub message: String,
}

#[derive(Debug)]
pub struct FileIndexBuild {
    /// (PositionKey, PositionHit)
    pub entries: Vec<(PositionKey, Occurrence)>,
    pub node_table: Arc<NodeTable>,
    pub warns: Vec<BuildWarn>,
}

#[derive(Debug, Error)]
pub enum BuildError {
    #[error("failed to create initial position: {0}")]
    Initial(#[from] InitialPosError),

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
    fn push_entry(&mut self, tesuu: u32, fork_path: &[ForkPointer], pos: &PartialPosition) {
        let key = key_from_partial_position(pos);

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
        fork_path: Vec<ForkPointer>,
    ) -> Result<(), BuildError> {
        for (offset, node) in seq.iter().enumerate() {
            let tesuu = start_tesuu + offset as u32;
            let parent_pos = pos.clone();

            // forks
            if let Some(forks) = &node.forks {
                for (i, fork_line) in forks.iter().enumerate() {
                    if fork_line.is_empty() {
                        continue;
                    }
                    let mut fork_path2 = fork_path.clone();
                    push_or_replace_fork(&mut fork_path2, tesuu, i as u32);

                    self.walk_sequence(fork_line, tesuu, parent_pos.clone(), fork_path2)?;
                }
            }

            // mainline
            let action = node_action(node);

            match apply_node_action(&mut pos, action) {
                Ok(status) => {
                    self.push_entry(tesuu, &fork_path, &pos);
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

    let mut b = IndexBuilder::new(file_id, gen, policy);

    // root
    b.push_entry(0, &[], &init_pos);

    if jkf.moves.len() > 1 {
        b.walk_sequence(&jkf.moves[1..], 1, init_pos, vec![])?;
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

/// この段階でbucket分割したい場合
pub fn bucketize_entries(
    entries: Vec<(PositionKey, Occurrence)>,
) -> [Vec<(PositionKey, Occurrence)>; 256] {
    let mut buckets: [Vec<(PositionKey, Occurrence)>; 256] = std::array::from_fn(|_| Vec::new());

    for e in entries {
        buckets[e.0.bucket() as usize].push(e);
    }

    for b in &mut buckets {
        b.sort_by(|(k1, o1), (k2, o2)| {
            (k1.z0, k1.z1, o1.file_id, o1.node_id).cmp(&(k2.z0, k2.z1, o2.file_id, o2.node_id))
        });
    }

    buckets
}
