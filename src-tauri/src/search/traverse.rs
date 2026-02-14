use crate::search::kifu_reader::Jkf;
use shogi_kifu_converter::jkf::{MoveFormat, MoveMoveFormat, MoveSpecial};

use super::types::{CursorLite, ForkPointer};

impl CursorLite {
    pub fn root() -> Self {
        Self {
            tesuu: 0,
            fork_pointers: vec![],
        }
    }

    /// tesuu に対して適用される forkPointers（te<=tesuu）
    pub fn filtered_for_tesuu(&self, tesuu: u32) -> Self {
        let fps: Vec<ForkPointer> = self
            .fork_pointers
            .iter()
            .cloned()
            .filter(|p| p.te <= tesuu)
            .collect();

        Self {
            tesuu,
            fork_pointers: fps,
        }
    }
}

/// 走査で得られる「ノードの意味」
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeAction {
    Move(MoveMoveFormat),
    Special(MoveSpecial),
    None,
}

#[derive(Debug, Clone)]
pub struct TraverseItem {
    pub cursor: CursorLite,
    pub parent_cursor: Option<CursorLite>,
    pub action: NodeAction,
}

/// JKFを仕様通りに木として走査し、ノードを列挙する。
pub fn traverse_jkf<F>(jkf: &Jkf, mut visit: F)
where
    F: FnMut(TraverseItem),
{
    if jkf.moves.is_empty() {
        return;
    }

    // root node (tesuu=0)
    visit(TraverseItem {
        cursor: CursorLite::root(),
        parent_cursor: None,
        action: node_action(&jkf.moves[0]),
    });

    // mainline
    traverse_line_main(&jkf.moves, vec![], &mut visit);
}

fn traverse_line_main<F>(moves: &[MoveFormat], fork_path: Vec<ForkPointer>, visit: &mut F)
where
    F: FnMut(TraverseItem),
{
    if moves.len() <= 1 {
        return;
    }

    for t in 1..moves.len() {
        let tesuu = t as u32;
        let node = &moves[t];

        let cursor = CursorLite {
            tesuu,
            fork_pointers: fork_path.clone(),
        };

        let parent = CursorLite {
            tesuu: tesuu - 1,
            fork_pointers: fork_path.iter().cloned().filter(|p| p.te < tesuu).collect(),
        };

        visit(TraverseItem {
            cursor: cursor.clone(),
            parent_cursor: Some(parent),
            action: node_action(node),
        });

        if let Some(forks) = &node.forks {
            for (i, fork_line) in forks.iter().enumerate() {
                if fork_line.is_empty() {
                    continue;
                }
                let mut fork_path2 = fork_path.clone();
                push_or_replace_fork(&mut fork_path2, tesuu, i as u32);

                traverse_fork_line(fork_line, tesuu, fork_path2, visit);
            }
        }
    }
}

fn traverse_fork_line<F>(
    line: &[MoveFormat],
    start_tesuu: u32,
    fork_path: Vec<ForkPointer>,
    visit: &mut F,
) where
    F: FnMut(TraverseItem),
{
    for (offset, node) in line.iter().enumerate() {
        let tesuu = start_tesuu + offset as u32;

        let cursor = CursorLite {
            tesuu,
            fork_pointers: fork_path.clone(),
        };

        let parent = if tesuu == 0 {
            None
        } else {
            Some(CursorLite {
                tesuu: tesuu - 1,
                fork_pointers: fork_path.iter().cloned().filter(|p| p.te < tesuu).collect(),
            })
        };

        visit(TraverseItem {
            cursor: cursor.clone(),
            parent_cursor: parent,
            action: node_action(node),
        });

        if let Some(forks) = &node.forks {
            for (i, fork_line2) in forks.iter().enumerate() {
                if fork_line2.is_empty() {
                    continue;
                }
                let mut fork_path2 = fork_path.clone();
                push_or_replace_fork(&mut fork_path2, tesuu, i as u32);

                traverse_fork_line(fork_line2, tesuu, fork_path2, visit);
            }
        }
    }
}

fn node_action(node: &MoveFormat) -> NodeAction {
    if let Some(m) = node.move_ {
        NodeAction::Move(m)
    } else if let Some(s) = node.special {
        NodeAction::Special(s)
    } else {
        NodeAction::None
    }
}

fn push_or_replace_fork(fps: &mut Vec<ForkPointer>, te: u32, fork_index: u32) {
    if let Some(pos) = fps.iter().position(|p| p.te == te) {
        fps[pos].fork_index = fork_index;
    } else {
        fps.push(ForkPointer { te, fork_index });
    }
    fps.sort_by_key(|p| p.te);
}
