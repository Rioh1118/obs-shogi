//! 1ファイルを読んで索引の材料にする。**この手順の持ち主はここだけ。**
//!
//! 呼び手は2つある。全件構築（`api`）と差分更新（`project_manager`）で、
//! どちらも `spawn_blocking` の中からこれを呼ぶ。**警告を出すかどうか、
//! 何を出すか、どう束ねるかの判断はここにしか無い。**
//!
//! 2つに分かれていたときは、片方だけを直すと**同じ棋譜について全件構築と
//! 差分更新で違う警告が出る**状態になっていた。分けておく理由は無い —
//! 呼び手が違うのは「どこへ流すか」だけで、「何を流すか」は同じ。

use std::sync::Arc;

use crate::search::{
    fs_scan::FileRecord,
    index_builder::{bucketize_entries, build_index_for_jkf, BuildPolicy},
    kifu_reader::{read_to_jkf, ReadOutcome},
    node_table::NodeTable,
    position_key::PositionKey,
    types::{FileId, Gen, Occurrence},
};

/// 局面の鍵を先頭バイトで振り分けた 256 の桶
pub type BucketEntries = [Vec<(PositionKey, Occurrence)>; 256];

/// 1ファイルぶんの索引の材料。
///
/// **局面が1つも無いこともある**（読めたが入れる局面が無い棋譜）。
/// そのときも項目としては登録する — `file_table` の `gen` が上がらないと
/// **前の世代のセグメントが索引に残る**。
pub struct FileBuild {
    pub by_bucket: BucketEntries,
    pub node_table: Arc<NodeTable>,
    /// 利用者に出す文言。空なら何も出さない。
    ///
    /// 読み手の警告（読めたが一部を採れなかった）と、索引を組む側の警告
    /// （指せない手）が混ざる。**呼び手はこれを区別しない** — どちらも
    /// 同じ `EVT_INDEX_WARN` に載り、利用者にとっては同じ「この棋譜のここが変」。
    pub warns: Vec<String>,
}

impl FileBuild {
    /// 局面を持たない項目。**登録はするが検索には出ない。**
    fn empty(warns: Vec<String>) -> Self {
        Self {
            by_bucket: std::array::from_fn(|_| Vec::new()),
            node_table: Arc::new(NodeTable::empty()),
            warns,
        }
    }
}

/// 1ファイルを読んで索引の材料にする。
///
/// **ブロッキング。** ファイルを読んで全分岐を歩くので、呼び手は
/// `spawn_blocking` の中から呼ぶこと。
///
/// # Errors
///
/// 読めなかったときだけ。文言はそのまま利用者の画面に出る
/// （呼び手が `EVT_INDEX_WARN` に流す）ので、内部の識別子を混ぜないこと。
///
/// **「読めたが入れる局面が無い」は `Err` ではない。** 空の [`FileBuild`] を返す。
/// それを失敗として扱うと、このアプリの新規作成で対局者名を入れずに作った棋譜に
/// 「読めません」と告げることになる。
pub fn build_file_index(rec: &FileRecord, file_id: FileId, gen: Gen) -> Result<FileBuild, String> {
    let outcome = read_to_jkf(rec).map_err(|e| e.to_string())?;

    let (jkf, warns) = match outcome {
        ReadOutcome::Indexable { jkf, warns } => (jkf, warns),
        ReadOutcome::NothingToIndex { warns } => return Ok(FileBuild::empty(warns)),
    };

    let built =
        build_index_for_jkf(file_id, gen, &jkf, BuildPolicy::Loose).map_err(|e| e.to_string())?;

    let warns = warns
        .into_iter()
        .chain(built.warns.into_iter().map(|w| {
            // 内部の理由は画面に出さない。追えるようログへ残す
            log::warn!(
                "[index] {}: {:?}: {}",
                rec.path.display(),
                w.cursor,
                w.message
            );
            w.to_user_message()
        }))
        .collect();

    Ok(FileBuild {
        by_bucket: bucketize_entries(built.entries),
        node_table: built.node_table,
        warns,
    })
}
