use shogi_kifu_converter::jkf::{MoveMoveFormat, MoveSpecial};

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
