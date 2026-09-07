//! 1ファイルを読んで索引の材料にする。**この手順の持ち主はここだけ。**
//!
//! 呼び手は2つある。全件構築（`build.rs`）と差分更新（`project_manager.rs`）で、
//! どちらも `spawn_blocking` の中からこれを呼ぶ。**警告を出すかどうか、
//! 何を出すか、どう束ねるかの判断はここにしか無い。**
//!
//! **判断の持ち主はここ1つ。** 呼び手（全件構築と差分更新）で違うのは
//! 「どこへ流すか」だけで、「何を流すか」は同じ。分けると、片方だけを直した日に
//! 同じ棋譜について違う警告が出る。

use std::sync::Arc;

use crate::search::index::index_builder::{build_index_for_jkf, BuildPolicy};
use crate::search::message::{for_screen, ScreenMessage};
use crate::search::read::fs_scan::FileRecord;
use crate::search::read::kifu_reader::read_to_jkf;
use crate::search::read::outcome::{KifuReadError, ReadOutcome};
use crate::search::store::bucket::{bucketize_entries, empty_buckets, BucketEntries};
use crate::search::store::node_table::NodeTable;
use crate::search::types::{FileId, Gen};

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
    ///
    /// **受け取るのは刈り終えた文言。** 読み手の側は `read_path_inner` が、
    /// 索引を組む側は下の `for_screen` が通す。刈るのは組んだ場所で1回だけ。
    pub warns: Vec<ScreenMessage>,
}

impl FileBuild {
    /// 局面を持たない項目。**登録はするが検索には出ない。**
    fn empty(warns: Vec<ScreenMessage>) -> Self {
        Self {
            by_bucket: empty_buckets(),
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
/// 読めなかったときと、**読めたが開始局面を組み立てられなかったとき**
/// （`BuildPolicy::Loose` でも `BuildError::Initial` は返る。根拠は `build_report` の doc）。
/// 文言はそのまま利用者の画面に出る
/// （呼び手が `EVT_INDEX_WARN` に流す）ので、内部の識別子を混ぜないこと。
///
/// **「読めたが入れる局面が無い」は `Err` ではない。** 空の [`FileBuild`] を返す。
/// それを失敗として扱うと、このアプリの新規作成で対局者名を入れずに作った棋譜に
/// 「読めません」と告げることになる。
pub fn build_file_index(
    rec: &FileRecord,
    file_id: FileId,
    gen: Gen,
) -> Result<FileBuild, ScreenMessage> {
    // **ここで刈り直さない。** `read/` は組んだ場所で刈り終えていて、
    // 上限の外で一文を足してある。もう一度通すとその一文が落ちる
    let outcome = read_to_jkf(rec).map_err(|KifuReadError::ParseFailed(m)| m)?;

    let (jkf, warns) = match outcome {
        ReadOutcome::Indexable { jkf, warns } => (jkf, warns),
        ReadOutcome::NothingToIndex { warns } => return Ok(FileBuild::empty(warns)),
    };

    let built =
        build_index_for_jkf(file_id, gen, &jkf, BuildPolicy::Loose).map_err(|e| for_screen(&e))?;

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
            for_screen(&w)
        }))
        .collect();

    Ok(FileBuild {
        by_bucket: bucketize_entries(built.entries),
        node_table: built.node_table,
        warns,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::message::SCREEN_MESSAGE_LIMIT;
    use crate::search::read::fs_scan::KifuKind;
    use std::fs;
    use test_support::dir::temp_dir;

    /// **失うものを言う一文が、画面へ渡る値にも残る。**
    ///
    /// 文言を組むのは `read/diagnosis`、画面へ渡すのはここ。読む段の assert だけだと
    /// **その間で刈り直しても緑のまま**になる。刈り直すと一文は上限の外なので
    /// 真っ先に落ち、利用者には「読めない行がある」だけが残って、
    /// そのファイルの局面が1件も索引に入らないことが伝わらない。
    #[test]
    fn what_the_file_costs_survives_all_the_way_to_the_warning() {
        let dir = temp_dir("file-build-costs");
        let path = dir.join("long.kif");
        // クレートは読めなかった位置から行末までを引用するので、行を長くすると
        // 本体だけで上限に達する。一文はその外側に足されている
        fs::write(
            &path,
            format!(
                "手合割：平手\n1 {}\n",
                "ん".repeat(SCREEN_MESSAGE_LIMIT * 2)
            ),
        )
        .expect("書き出し");

        let rec = FileRecord {
            path: path.clone(),
            kind: KifuKind::Kif,
            size: 0,
            mtime_ms: 0,
        };
        let Err(message) = build_file_index(&rec, 1, 1) else {
            panic!("読めないはずの題材が読めた");
        };
        let message = message.to_string();

        // **題材が上限に届いたことを先に見る。** 届いていなければ二重刈りを
        // 戻しても緑になり、このテストは何も見ていない
        assert!(
            message.chars().count() > SCREEN_MESSAGE_LIMIT,
            "題材が上限に届いていないので、二重刈りを見ていない: {} 文字",
            message.chars().count()
        );
        assert!(
            message.ends_with("このファイルの局面は検索に出ません"),
            "失うものが画面へ届いていない: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }
}
