use std::sync::Arc;

use crate::search::types::{CursorLite, FileId, ForkPointer};

pub type NodeTableArc = Arc<NodeTable>;

/// `file_id` から、その棋譜の節表を引く表。
///
/// **添字がそのまま `file_id`。** `file_id` は棋譜を1つ見つけるたびに 0 から
/// 振っていく密な番号なので、`HashMap` でなく `Vec` の穴あき配列で足りる。
/// `None` は「その `file_id` に節表が無い」——削除された棋譜、読めなかった棋譜、
/// まだ作っていない棋譜。
///
/// **穴は普通に空く。** 出現ゼロの節表が blob に載るのはそのため
/// （`docs/state-transitions/search.md` のビット化けの表）。
#[derive(Debug, Clone, Default)]
pub struct NodeTables {
    by_id: Vec<Option<NodeTableArc>>,
}

impl NodeTables {
    /// その棋譜の節表。無ければ `None`。
    pub fn get(&self, file_id: FileId) -> Option<&NodeTableArc> {
        self.by_id.get(file_id as usize)?.as_ref()
    }

    /// 足りなければ `None` で伸ばしてから入れる。**縮まない。**
    ///
    /// **同じ `file_id` に2度入れると黙って上書きする。** 復元の経路では
    /// それが起きないことを `cache/index_cache.rs` の `decode_all` が
    /// 節表の `file_id` の並びで縛っている（破れると、上書きされた側の
    /// 全ヒットが別の棋譜の手数を持つ）。
    pub fn upsert(&mut self, file_id: FileId, nt: NodeTableArc) {
        let idx = file_id as usize;
        if self.by_id.len() <= idx {
            self.by_id.resize_with(idx + 1, || None);
        }
        self.by_id[idx] = Some(nt);
    }

    /// `file_id` の昇順。**穴（`None`）も含めて全部返す。**
    ///
    /// 添字が `file_id` なので、`enumerate()` の添字をそのまま使える。
    /// `cache/index_cache.rs` の `encode_all` がそれを使って
    /// 節表を昇順かつ一意に書く。
    pub fn by_id_iter(&self) -> impl Iterator<Item = &Option<NodeTableArc>> {
        self.by_id.iter()
    }
}

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

    /// (tesuu, fork_path) を 1ノードとして追加し、node_id を返す。
    ///
    /// **`fork_off + fork_len <= forks.len()` を保つ。** `fork_off` を
    /// 追加直前の `forks.len()` に置き、その直後に `fork_len` 個だけ push するため。
    ///
    /// これは呼び手の都合ではなく**保存の前提**で、`cache/index_cache.rs` の
    /// `encode_all` がこの範囲を検査し、破れるとチェックポイントを1バイトも書かない。
    /// そのとき壊れるのは索引の中身ではなく保存なので、症状は
    /// **「起動が毎回遅い」だけ**で原因を辿る手掛かりが無い。
    /// 分岐路の共通接頭辞を使い回すような最適化を入れるなら、先に `encode_all` を見ること。
    ///
    /// # Panics
    ///
    /// `fork_path` が `u16::MAX` を超えると debug ビルドで `debug_assert!` が落とす
    /// （`cargo test` も `npm run tauri dev` も debug）。release では `fork_len` が
    /// 切り捨てで**小さくなる**ので不変条件そのものは破れず、
    /// `cursor_lite` が短い経路を返すだけになる。
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

#[cfg(test)]
mod tests {
    use super::*;

    fn fp(te: u32, fork_index: u32) -> ForkPointer {
        ForkPointer { te, fork_index }
    }

    /// **`push_node` が `encode_all` の前提を保つこと。**
    ///
    /// `cache/index_cache.rs` の `encode_all` は
    /// `fork_off + fork_len > forks.len()` ならチェックポイント全体を書かない。
    /// 本番で `NodeCursor` を作る口はここと `decode_all`（あちらは自分で検査する）
    /// だけなので、**この不変条件を守っているのは `push_node` 一箇所。**
    ///
    /// 長さの違う `fork_path` を混ぜるのは、`fork_off` が前のノードの
    /// 長さに引きずられないことを見るため。
    #[test]
    fn push_node_keeps_every_fork_range_inside_the_table() {
        let mut b = NodeTableBuilder::new();
        b.push_node(0, &[]);
        b.push_node(3, &[fp(3, 0)]);
        b.push_node(7, &[fp(3, 0), fp(5, 1)]);
        b.push_node(9, &[]);
        b.push_node(11, &[fp(3, 1), fp(8, 2), fp(10, 0)]);

        let nt = b.finish();
        let forks = nt.forks.len();
        for (node_id, n) in nt.nodes.iter().enumerate() {
            assert!(
                n.fork_off as usize + n.fork_len as usize <= forks,
                "node {node_id} の範囲 {}+{} が分岐の表 {forks} を超える",
                n.fork_off,
                n.fork_len
            );
        }
    }

    /// **`push_node` が返した `node_id` で、入れた経路がそのまま戻ること。**
    ///
    /// 上のテストは範囲が表の中にあることしか見ないので、
    /// `fork_off` が**別のノードの**範囲を指していても通る。
    #[test]
    fn push_node_returns_an_id_that_reads_back_the_same_path() {
        let paths: Vec<Vec<ForkPointer>> = vec![
            vec![],
            vec![fp(3, 0)],
            vec![fp(3, 0), fp(5, 1)],
            vec![],
            vec![fp(3, 1), fp(8, 2), fp(10, 0)],
        ];

        let mut b = NodeTableBuilder::new();
        let ids: Vec<u32> = paths
            .iter()
            .enumerate()
            .map(|(i, p)| b.push_node(i as u32, p))
            .collect();
        let nt = b.finish();

        for (i, id) in ids.iter().enumerate() {
            let c = nt.cursor_lite(*id).expect("入れた node_id が読めない");
            assert_eq!(c.tesuu, i as u32);
            assert_eq!(c.fork_pointers.len(), paths[i].len(), "node {id} の長さ");
            for (got, want) in c.fork_pointers.iter().zip(&paths[i]) {
                assert_eq!((got.te, got.fork_index), (want.te, want.fork_index));
            }
        }

        assert!(
            nt.cursor_lite(ids.len() as u32).is_none(),
            "表の外の node_id が読めてしまった"
        );
    }
}
