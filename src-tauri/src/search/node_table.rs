use std::sync::Arc;

use super::types::{CursorLite, ForkPointer};

pub type NodeTableArc = Arc<NodeTable>;

#[derive(Debug, Clone, Default)]
pub struct NodeTable {
    pub nodes: Vec<NodeCursor>,
    pub forks: Vec<ForkPtr>,
}

impl NodeTable {
    pub fn empty() -> Self {
        Self::default()
    }

    /// node_id から CursorLite を復元（イベント用）
    pub fn cursor_lite(&self, node_id: u32) -> Option<CursorLite> {
        let n = self.nodes.get(node_id as usize)?;
        let off = n.fork_off as usize;
        let len = n.fork_len as usize;

        let slice = self.forks.get(off..off + len)?;

        let mut fps = Vec::with_capacity(len);
        for p in slice {
            fps.push(ForkPointer {
                te: p.te,
                fork_index: p.fork_index,
            });
        }

        Some(CursorLite {
            tesuu: n.tesuu,
            fork_pointers: fps,
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct NodeCursor {
    pub tesuu: u32,
    pub fork_off: u32,
    pub fork_len: u16,
}

#[derive(Debug, Clone, Copy)]
pub struct ForkPtr {
    pub te: u32,
    pub fork_index: u32,
}

/// build 用（余計な Vec clone を避ける）
#[derive(Debug, Default)]
pub struct NodeTableBuilder {
    nodes: Vec<NodeCursor>,
    forks: Vec<ForkPtr>,
}

impl NodeTableBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    pub fn len_nodes(&self) -> usize {
        self.nodes.len()
    }

    /// (tesuu, fork_path) を 1ノードとして追加し、node_id を返す
    pub fn push_node(&mut self, tesuu: u32, fork_path: &[ForkPointer]) -> u32 {
        let node_id = self.nodes.len() as u32;

        let off = self.forks.len() as u32;
        let len = fork_path.len();
        debug_assert!(len <= u16::MAX as usize);

        for p in fork_path {
            self.forks.push(ForkPtr {
                te: p.te,
                fork_index: p.fork_index,
            });
        }

        self.nodes.push(NodeCursor {
            tesuu,
            fork_off: off,
            fork_len: len as u16,
        });

        node_id
    }

    pub fn finish(self) -> NodeTable {
        NodeTable {
            nodes: self.nodes,
            forks: self.forks,
        }
    }
}
