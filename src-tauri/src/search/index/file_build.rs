//! 1ファイルを読んで索引の材料にする。**この手順の持ち主はここだけ。**
//!
//! 呼び手は2つある。全件構築（`build.rs`）と差分更新（`project_manager.rs`）で、
//! どちらも `spawn_blocking` の中からこれを呼ぶ。**警告を出すかどうか、
//! 何を出すか、どう束ねるかの判断はここにしか無い。**
//!
//! 2つに分かれていたときは、片方だけを直すと**同じ棋譜について全件構築と
//! 差分更新で違う警告が出る**状態になっていた。分けておく理由は無い —
//! 呼び手が違うのは「どこへ流すか」だけで、「何を流すか」は同じ。

use std::sync::Arc;

use crate::search::index::index_builder::{build_index_for_jkf, BuildPolicy};
use crate::search::read::fs_scan::FileRecord;
use crate::search::read::kifu_reader::read_to_jkf;
use crate::search::read::outcome::ReadOutcome;
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
    pub warns: Vec<String>,
    /// **索引に局面が入ったか。**
    ///
    /// `Ok` で返ったことと、局面が入ったことは別。読めたが入れる局面が無い
    /// 棋譜（途中で切れた CSA など）も `Ok` で返るので、`Ok`/`Err` で数えると
    /// **局面を1つも持たない棋譜が「索引済み」に数えられる**。
    ///
    /// 決め方は2つ。**局面が入ったか**（`Indexable` の腕）と、
    /// **空なのが正しい姿か**（`NothingToIndex` の `looks_intentional`）。
    ///
    /// **本当に空の棋譜と割る。** このアプリが新規作成した棋譜は指し手が0手で
    /// 局面も入らないが、失われたものは無い。それを「入れられなかった」に
    /// 数えると、**棋譜を1つ作るたびにワークスペースが黄色くなる**。
    pub indexed: bool,
}

impl FileBuild {
    /// 局面を持たない項目。**登録はするが検索には出ない。**
    ///
    /// **空になった理由は読み手が決める。** ここで `warns` の有無から導くと、
    /// 警告を出す口が無い形式（CSA 以外）が必ず「本当に空」になる
    /// ——0バイトの `.kif` が黙って「索引済み」に数えられていた。
    ///
    /// **割れるのは検査が見つけられた範囲だけ。** `warn_if_moves_were_dropped` が
    /// 黙る形（最初の `%` 行で数を打ち切る／UTF-16 は指し手行の形にならず0件と
    /// 数える）は、0バイトでなければここで**真に落ちる**。局面が入っていない
    /// のに緑になる回が、その分だけ残っている。
    fn empty(warns: Vec<String>, looks_intentional: bool) -> Self {
        Self {
            by_bucket: empty_buckets(),
            node_table: Arc::new(NodeTable::empty()),
            indexed: looks_intentional,
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
        ReadOutcome::NothingToIndex {
            warns,
            looks_intentional,
        } => return Ok(FileBuild::empty(warns, looks_intentional)),
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
            w.to_string()
        }))
        .collect();

    // **`Ok` だから真、にしない。** 局面が1つも出なければ検索に出ないので、
    // 数え方は空の腕と同じ「入ったか」で決める。
    //
    // **いまこの式が偽になる入力は見つかっていない**（初期局面が必ず入るため）。
    // 守りであって、直した不具合ではない——`Ok` を根拠にしたままだと、
    // 初期局面が入らなくなった日に黙って数が合わなくなる
    let indexed = !built.entries.is_empty();

    Ok(FileBuild {
        by_bucket: bucketize_entries(built.entries),
        node_table: built.node_table,
        warns,
        indexed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::read::fs_scan::KifuKind;

    fn write_and_build(name: &str, body: &str) -> FileBuild {
        let dir = test_support::dir::temp_dir("file-build");
        let path = dir.join(name);
        std::fs::write(&path, body).expect("下ごしらえ");
        let rec = FileRecord {
            path: path.clone(),
            // **形式は名前から取る。** `Csa` を直に書くと、他の形式の腕を
            // 落とす変異が緑で通る——警告を出す口があるのは CSA だけなので、
            // 割り方の穴はいつも他の形式に空く
            kind: KifuKind::from_path(&path).expect("拡張子から種別が決まること"),
            size: body.len() as u64,
            mtime_ms: 0,
        };
        let built = build_file_index(&rec, 1, 1).expect("読めるはず");
        let _ = std::fs::remove_dir_all(&dir);
        built
    }

    /// **`Ok` を「索引に入った」と読まないこと。**
    ///
    /// 途中で切れた CSA はヘッダだけ読めて `Ok` で返るが、入る局面は無い。
    /// `Ok`/`Err` で数えると**局面を1つも持たない棋譜が「索引済み」になり**、
    /// 1000件中200件がこの形でも `indexed == total` で緑の「準備完了」が出る。
    #[test]
    fn a_kifu_that_reads_but_yields_nothing_is_not_counted_as_indexed() {
        let built = write_and_build(
            "broken.csa",
            "V2.2\nPI\n+\nZZZZ not a kifu line\n+7776FU\n-3334FU\n%TORYO\n",
        );
        assert!(
            !built.warns.is_empty(),
            "読み残しの警告が出ていない。題材が古い: {:?}",
            built.warns
        );
        assert!(
            !built.indexed,
            "局面を1つも持たない棋譜を「索引済み」に数えている: {:?}",
            built.warns
        );
    }

    /// **本当に空の棋譜まで「入れられなかった」に数えないこと。**
    ///
    /// このアプリが新規作成した棋譜は指し手が0手で局面も入らないが、
    /// 失われたものは無い。数えると**棋譜を1つ作るたびにワークスペースが
    /// 黄色くなる**。
    #[test]
    fn a_genuinely_empty_kifu_is_not_a_failure() {
        for (name, body) in [
            ("empty.csa", "V2.2\nPI\n+\n"),
            (
                "appnew.kif",
                "手合割：平手\n\n手数----指手---------消費時間--\n",
            ),
        ] {
            let built = write_and_build(name, body);
            assert!(built.indexed, "本当に空の棋譜を失敗に数えている: {name}");
        }
    }

    /// **中身が無いファイルを「本当に空の棋譜」と読まないこと。**
    ///
    /// 同期の途中で置かれた 0 バイトのプレースホルダや、保存が落ちた残骸が
    /// この形になる。**警告の有無で割ると KIF / KI2 は必ず素通りする**
    /// ——警告を出す口があるのは CSA だけなので、0バイトでも `warns` は空。
    #[test]
    fn a_zero_byte_file_is_not_a_genuinely_empty_kifu() {
        for name in ["empty.kif", "empty.ki2"] {
            let built = write_and_build(name, "");
            assert!(
                !built.indexed,
                "0バイトのファイルを「索引済み」に数えている: {name}"
            );
        }
    }

    /// **指し手の途中で切れた CSA を「本当に空」と読まないこと。**
    ///
    /// `+7776F` は6バイトなので、指し手行を長さで数えると 0 件になり、
    /// 読み残しの警告が出ない。**指し手のある棋譜が黙って索引から消える。**
    #[test]
    fn a_csa_cut_mid_move_is_not_a_genuinely_empty_kifu() {
        let built = write_and_build("trunc.csa", "V2.2\nPI\n+\n+7776F");
        assert!(
            !built.warns.is_empty(),
            "切れた指し手に警告が出ていない: {:?}",
            built.warns
        );
        assert!(!built.indexed, "切れた棋譜を「索引済み」に数えている");
    }

    /// 局面が入った棋譜は数えること。
    #[test]
    fn a_kifu_with_moves_is_counted() {
        let built = write_and_build(
            "ok.csa",
            "V2.2\nN+Sente\nN-Gote\nPI\n+\n+7776FU\n-3334FU\n%TORYO\n",
        );
        assert!(built.indexed, "指し手のある棋譜を数えていない");
    }
}
