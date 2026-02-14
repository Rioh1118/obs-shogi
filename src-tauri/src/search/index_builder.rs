use thiserror::Error;

use shogi_core::PartialPosition;
use shogi_kifu_converter::jkf::{JsonKifuFormat, MoveFormat};

use super::{
    initial_position::{initial_partial_position, InitialPosError},
    position_apply::{apply_node_action, ApplyError, ApplyStatus},
    position_key::{key_from_partial_position, PositionKey},
    traverse::NodeAction,
    types::{CursorLite, FileId, ForkPointer, Gen, NodeId, Occurrence, PositionHit},
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
    pub entries: Vec<(PositionKey, PositionHit)>,
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
    let mut entries = Vec::new();
    let mut warns = Vec::new();
    let mut next_node_id: NodeId = 0;

    // 初期局面
    let init_pos = initial_partial_position(jkf)?;

    // root
    push_entry(
        file_id,
        gen,
        &mut next_node_id,
        &mut entries,
        CursorLite::root(),
        &init_pos,
    );

    // mainline: moves[0]はrootダミーなので、moves[1..]を tesuu=1 から処理
    if jkf.moves.len() > 1 {
        walk_sequence(
            file_id,
            gen,
            &jkf.moves[1..],
            1,        // start_tesuu
            init_pos, // parent at tesuu=0
            vec![],   // fork_path (mainlineは空)
            policy,
            &mut next_node_id,
            &mut entries,
            &mut warns,
        )?;
    }

    Ok(FileIndexBuild { entries, warns })
}

/// ある系列（mainline / fork line）を先頭から順に処理する。
///
/// seq[0] は tesuu=start_tesuu のノードとして扱う。
fn walk_sequence(
    file_id: FileId,
    gen: Gen,
    seq: &[MoveFormat],
    start_tesuu: u32,
    mut pos: PartialPosition,
    fork_path: Vec<ForkPointer>,
    policy: BuildPolicy,
    next_node_id: &mut NodeId,
    entries: &mut Vec<(PositionKey, PositionHit)>,
    warns: &mut Vec<BuildWarn>,
) -> Result<(), BuildError> {
    for (offset, node) in seq.iter().enumerate() {
        let tesuu = start_tesuu + offset as u32;

        // この手を指す前の親局面（forksは必ずここから開始する）
        let parent_pos = pos.clone();

        // 1) forks を先に探索（mainline適用が失敗してもforkは救える）
        if let Some(forks) = &node.forks {
            for (i, fork_line) in forks.iter().enumerate() {
                if fork_line.is_empty() {
                    continue;
                }
                let mut fork_path2 = fork_path.clone();
                push_or_replace_fork(&mut fork_path2, tesuu, i as u32);

                walk_sequence(
                    file_id,
                    gen,
                    fork_line,
                    tesuu,              // fork line の先頭は同じ tesuu
                    parent_pos.clone(), // 親局面から開始
                    fork_path2,
                    policy,
                    next_node_id,
                    entries,
                    warns,
                )?;
            }
        }

        // 2) 自分（mainline/この系列）の手を適用して前進
        let cursor = CursorLite {
            tesuu,
            fork_pointers: fork_path.clone(),
        };
        let action = node_action(node);

        match apply_node_action(&mut pos, action) {
            Ok(status) => {
                // 到達局面をインデックス化（Noop/SpecialでもOK）
                push_entry(file_id, gen, next_node_id, entries, cursor, &pos);

                // special ならこの系列は終端扱い
                if status == ApplyStatus::Terminal {
                    break;
                }
            }
            Err(e) => match policy {
                BuildPolicy::Strict => {
                    return Err(BuildError::Apply { cursor, source: e });
                }
                BuildPolicy::Loose => {
                    warns.push(BuildWarn {
                        cursor,
                        message: e.to_string(),
                    });
                    // この系列はここで打ち切り（posが進められないので）
                    break;
                }
            },
        }
    }

    Ok(())
}

#[inline]
fn push_entry(
    file_id: FileId,
    gen: Gen,
    next_node_id: &mut NodeId,
    entries: &mut Vec<(PositionKey, PositionHit)>,
    cursor: CursorLite,
    pos: &PartialPosition,
) {
    let key = key_from_partial_position(pos);

    let node_id = *next_node_id;
    *next_node_id = next_node_id.wrapping_add(1);

    let occ = Occurrence {
        file_id,
        gen,
        node_id,
    };

    entries.push((key, PositionHit { occ, cursor }));
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
    entries: Vec<(PositionKey, PositionHit)>,
) -> [Vec<(PositionKey, PositionHit)>; 256] {
    let mut buckets: [Vec<(PositionKey, PositionHit)>; 256] = std::array::from_fn(|_| Vec::new());

    for e in entries {
        buckets[e.0.bucket() as usize].push(e);
    }

    for b in &mut buckets {
        b.sort_by(|(k1, _), (k2, _)| (k1.z0, k1.z1).cmp(&(k2.z0, k2.z1)));
    }

    buckets
}
