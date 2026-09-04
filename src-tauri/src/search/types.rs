//! 横断検索が画面とやり取りする形。
//!
//! **ここに書いた綴りがそのまま TS に出る**（`serde` の `camelCase`）。
//! 対岸は `src/entities/search/api/contract.ts`。欄の名前を変えるときは
//! 両方を同じ変更で直すこと。片方だけ直しても Rust も TS も緑のまま通り、
//! 実行時に欄が `undefined` になる。

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------
// 画面へ流すイベントの名前
// ---------------------------------------------------------------
// TS 側が待ち受けるのは `entities/search/api/events.ts`。
// 綴りを変えるとイベントが誰にも届かなくなるが、**どちらもエラーを出さない**

pub const EVT_INDEX_STATE: &str = "position-index-state";
pub const EVT_INDEX_PROGRESS: &str = "position-index-progress";
pub const EVT_INDEX_WARN: &str = "position-index-warn";
pub const EVT_SEARCH_BEGIN: &str = "position-search-begin";
pub const EVT_SEARCH_CHUNK: &str = "position-search-chunk";
pub const EVT_SEARCH_END: &str = "position-search-end";
pub const EVT_SEARCH_ERROR: &str = "position-search-error";

/// 検索1回を指す番号。取り消しと、遅れて届いた結果の捨て分けに使う。
pub type RequestId = u64;

/// ワークスペース内の棋譜ファイル1つを指す番号。**パスではない。**
///
/// パスに直すのは `store/file_table.rs`。索引には番号だけを入れる。
pub type FileId = u32;

/// ファイルが書き換わるたびに進む番号。**索引の項目が古いかを見分ける唯一の手段。**
///
/// 索引の項目（[`Occurrence`]）は作られた時点の世代を抱える。ファイルが消えたり
/// 書き換わると `file_table` 側の世代だけが進むので、両者が食い違う項目は
/// 引くときに落とされる（`store/file_table.rs` の `is_occ_alive`）。
///
/// **索引を組み直さずに済ませるための仕掛け。** 落とし忘れると、
/// 更新前の棋譜の局面が検索結果に出続ける。
pub type Gen = u32;

/// 1つのファイルの中の、棋譜の木の節を指す番号。
///
/// 節が持つ「何手目か・どの分岐を通ったか」に直すのは
/// `store/node_table.rs` の `cursor_lite`。索引には番号だけを入れる。
pub type NodeId = u32;

/// 索引が知っているファイル1件。**引くときの生死判定はここの `gen` と
/// [`Occurrence`] の `gen` を突き合わせて決まる。**
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub file_id: FileId,
    pub path: String,
    pub deleted: bool,
    #[serde(rename = "gen")]
    pub r#gen: Gen,
}

/// 検索結果に出たファイルの絶対パス。
///
/// 結果の本体（[`PositionHit`]）は [`FileId`] しか持たない。同じファイルの
/// hit が何十件も出るので、パスは重複を潰して別に送る。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePathEntry {
    pub file_id: FileId,
    pub abs_path: String,
}

/// 索引がいまどの段にいるか。
///
/// `Ready` 以外で検索すると、結果が欠けうる。そのことは
/// [`SearchBeginPayload::stale`] で画面に伝わる。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IndexState {
    Empty,
    Restoring,
    Building,
    Ready,
    Updating,
}

/// 索引の状態を画面へ知らせる。`EVT_INDEX_STATE` に載る。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatePayload {
    pub state: IndexState,
    pub dirty_count: u32,
    pub indexed_files: u32,
    pub total_files: u32,
}

/// 索引が組み上がるのを待つかどうか。
///
/// **どちらを渡しても振る舞いは変わらない。** `query_service` はこの欄を読まず、
/// 常に今ある索引で即座に引く。索引が `Ready` でなかったことは
/// [`SearchBeginPayload::stale`] で後から知らせるだけ。
/// 画面が送っているのも `BestEffort` の一択で、`WaitForClean` は
/// リポジトリのどこからも送られない。
///
/// 欄を残すか、待つ側を実装するかは #395。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Consistency {
    /// 今ある索引で引く
    BestEffort,
    /// 索引が組み上がるまで待ってから引く。**未実装。**
    WaitForClean,
}

/// 検索の要求。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPositionInput {
    /// 探す局面の綴り。**受理する形は `position/sfen_position.rs` が決める**
    /// （SFEN より広く、USI の `position` 行も通る）。`book` 側にもう1本
    /// 別の受理集合があり、どちらへ寄せるかは #236
    pub sfen: String,
    pub consistency: Consistency,
    pub chunk_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPositionOutput {
    pub request_id: RequestId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelSearchInput {
    pub request_id: RequestId,
}

/// 分岐点で、どの線に入ったか。
#[derive(Debug, Copy, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkPointer {
    /// 分かれた手数
    pub te: u32,
    /// その手数の変化のうち何番目か（0 起点）。
    ///
    /// 画面は1を足して「変化N」と呼ぶ（`entities/kifu/model/branch.ts` の
    /// `branchLabel`）。ここでずらすと、警告や検索結果で名指しした変化を
    /// 棋譜欄で探せなくなる。
    pub fork_index: u32,
}

/// ある局面が現れた場所。索引の項目は `(PositionKey, Occurrence)` の対。
///
/// **[`Gen`] を抱えるのは、この項目が作られた時点を覚えておくため。** ファイルが
/// 書き換わっても索引はそのまま残るので、引くときに世代を突き合わせて落とす。
#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub file_id: FileId,
    /// この項目を作ったときのファイルの世代。**現在の世代ではない。**
    #[serde(rename = "gen")]
    pub r#gen: Gen,
    pub node_id: NodeId,
}

/// 棋譜の木の中の位置。**何手目か + そこへ至るまでに入った分岐。**
///
/// 「Lite」は、画面側の `KifuCursor` が持つ `tesuuPointer`（着いた局面の観測値）
/// を持たないという意味。**索引を張った時点の棋譜に対する値**なので、いま開いて
/// いるファイルの上で同じ局面に着ける保証が無い。局面の同一性が要る側は、
/// 辿り着いた player から作り直すこと。
///
/// **これを画面の `CursorPath` に直す口は `cursorFromLite`
/// （`entities/search/lib/cursorAdapter.ts`）だけ。** 並びと `te <= tesuu` の
/// 前提をそこで揃えている。自分で組み直さないこと。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorLite {
    pub tesuu: u32,
    /// **`te <= tesuu` のものだけ。** 索引は分岐点でしか伸ばさないので、
    /// この位置より先の分岐は入らない。
    pub fork_pointers: Vec<ForkPointer>,
}

impl CursorLite {
    /// 開始局面。**どの分岐にも入っていない0手目。**
    ///
    /// 索引を引いた先の節が見つからないときの落とし所でもある
    /// （`query_service`）。盤は必ず開始局面から始まるので、
    /// ここへ落ちても画面は成立する。
    pub fn root() -> Self {
        Self {
            tesuu: 0,
            fork_pointers: vec![],
        }
    }
}

/// 検索が当てた1件。**どのファイルの、木のどこか。**
///
/// 索引が持っているのは [`Occurrence`] だけで、`cursor` は引いた後に
/// `store/node_table.rs` を通して解いたもの（`query_service` の仕事）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionHit {
    pub occ: Occurrence,
    pub cursor: CursorLite,
}

/// 検索を始めた。`EVT_SEARCH_BEGIN` に載る。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchBeginPayload {
    pub request_id: RequestId,
    /// 索引が [`IndexState::Ready`] でないまま引いた。**結果は欠けうる。**
    ///
    /// 待たずに引くのは [`Consistency`] の判定が無いため。
    pub stale: bool,
}

/// 結果の一部。`EVT_SEARCH_CHUNK` に載る。
///
/// **何度も届く。** 全部溜めてから返すと、大きなワークスペースで最初の1件が
/// 出るまで画面が止まる。`chunk_size` は要求で決める。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchChunkPayload {
    pub request_id: RequestId,
    pub chunk: Vec<PositionHit>,
    pub files: Vec<FilePathEntry>,
}

/// 結果を出し終えた。`EVT_SEARCH_END` に載る。
///
/// **「全件出し終えた」ではない。** 取り出しの途中で取り消されたときも、
/// そこまでの chunk の後にこれが出る（`query_service` は `break` で
/// 抜けてから emit する）。届かないのは chunk を1つも出す前に
/// 取り消したときだけ。
///
/// つまり**打ち切られた検索と、出し切った検索が、これだけでは区別できない**。
/// 区別が要るなら欄を足すこと。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEndPayload {
    pub request_id: RequestId,
}

/// 検索が失敗した。`EVT_SEARCH_ERROR` に載る。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchErrorPayload {
    pub request_id: RequestId,
    /// **英語の内部の理由がそのまま入る。** 綴りが読めなかった理由も
    /// ここへ来る。画面に素で出す前に言葉を用意すること
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectInput {
    pub root_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectOutput {
    pub total_files: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgressPayload {
    pub current_path: String,
    pub done_files: u32,
    pub total_files: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexWarnPayload {
    pub path: String,
    pub message: String,
}
