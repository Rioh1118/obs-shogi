//! 横断検索が画面とやり取りする形。
//!
//! **ここに書いた綴りがそのまま TS に出る**（`serde` の `camelCase`）。
//! 対岸は `src/entities/search/api/` の3本 — 要求と応答が `contract.ts`、
//! イベントの payload が `events.ts`、識別子と結果の形が `ids.ts`。
//!
//! 欄の名前を変えるときは両方を同じ変更で直すこと。片方だけ直しても
//! Rust も TS も緑のまま通り、実行時に欄が `undefined` になる。

use serde::{Deserialize, Serialize};

use crate::search::message::ScreenMessage;

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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub file_id: FileId,
    pub path: String,
    pub deleted: bool,
    /// **索引を組めたか。** 偽なら、その棋譜の局面は1つも入っていない。
    ///
    /// **真は「局面が入った」ではない。** このアプリが新規作成した棋譜は
    /// 指し手が0手なので局面も入らないが、失われたものが無いので真。
    /// 割れ目は `search::index::file_build::FileBuild::indexed`。
    ///
    /// 表に載ること自体は組めた棋譜と変わらない（`gen` を上げて前の世代の
    /// セグメントを落とす必要があるため）ので、**この欄が唯一の見分け**。
    /// 数え直す形にすると経路ごとに違う数を出す——差分更新は自分の回に
    /// 触れた分しか知らないので、前の回の失敗を引き継げない。
    pub indexed: bool,
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IndexState {
    Empty,
    Restoring,
    Building,
    Ready,
    Updating,
}

/// 索引の状態を画面へ知らせる。`EVT_INDEX_STATE` に載る。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatePayload {
    pub state: IndexState,
    pub dirty_count: u32,
    /// **段によって意味が違う。**
    ///
    /// | 段 | 何の数か |
    /// | --- | --- |
    /// | `Ready` | [`FileEntry::indexed`] が真の件数。`total_files` との差が**検索に出ない棋譜** |
    /// | `Updating` | 据わっている索引の件数。差は**まだ当てていない差分** |
    /// | `Building` | その回でいままでに組めた件数。差は**未処理と失敗の合計** |
    /// | `Restoring` | 0（索引を捨てた直後） |
    ///
    /// 画面が `Ready` に限って差を読むのはこのため
    /// （`entities/search/lib/indexHealth.ts`）。段を足すときに条件を
    /// 広げると、進行中の走行中カウントが「一部を索引に入れられていません」に化ける。
    pub indexed_files: u32,
    pub total_files: u32,
    /// **最後の走査を最後まで通せなかった。** 索引そのものは最後に読めた
    /// ときのまま健全なので段は `Ready` に上がるが、**それ以降の追加・変更・
    /// 削除は1件も反映されていない**。
    ///
    /// このとき `dirty_count` の 0 は「当てるものが無かった」ではなく
    /// **「分からない」**。0 をそのまま「未同期 0」と描くと、
    /// 利用者は索引が最新だと確信する。
    pub scan_failed: bool,
    /// **一部の場所を読めなかった。** 走査そのものは完走している。
    ///
    /// `scan_failed` とは失われるものが違う——あちらは「索引が新しく
    /// なっていない」、こちらは「**索引に入っていない棋譜がある**」。
    /// 畳むと、検索が0件を返した理由を利用者が取り違える。
    pub partially_unreadable: bool,
}

impl IndexStatePayload {
    /// 状態を出す。**旗はすべて伏せた形から始める。**
    ///
    /// **組み立てる口をここ1つに閉じてある。** 呼び手が構造体リテラルを手で
    /// 書く形にすると、欄を足したときに全員が `false` を書き足すことになり、
    /// **本当に渡す口がその中に埋もれる**。
    pub fn of(state: IndexState, total_files: u32) -> Self {
        Self {
            state,
            dirty_count: 0,
            indexed_files: 0,
            total_files,
            scan_failed: false,
            partially_unreadable: false,
        }
    }

    /// 索引に入れ終えた数。既定は0
    ///
    /// **対象より多い数を渡さない。** 入れた数が対象を超える数字は、
    /// 画面では壊れた索引にしか見えない。
    ///
    /// **`debug_assert!` で止めない。** ここが評価されるのは spawn した
    /// 監視ループと再走査タスクの中で、panic しても誰も join しない
    /// ——ログにも画面にも出ないまま、以後どのファイル変更も拾われなくなる。
    /// **番人が不発のとき、直そうとしている症状そのものになる。**
    /// 丸めて `log::error!` に残し、タスクは生かす。
    ///
    /// **丸めた回は、画面から健全と見分けが付かない。** `indexed_files ==
    /// total_files` になるので `indexHealth` は `ok` を返し、緑の「準備完了」が出る
    /// ——気付けるのはログを開いた人だけ。壊れて見える表示を捨てる代わりに、
    /// 気付く手掛かりも捨てている。
    pub fn indexed(mut self, n: u32) -> Self {
        let n = if n > self.total_files {
            log::error!(
                "[announce] 索引済み {n} が対象 {} を超えている。数える順を確かめること",
                self.total_files
            );
            self.total_files
        } else {
            n
        };
        self.indexed_files = n;
        self
    }

    /// まだ当てていない差分の数。**数えられなかったときは呼ばない**
    /// ——0 は「無い」であって「分からない」ではない。
    pub fn dirty(mut self, n: u32) -> Self {
        self.dirty_count = n;
        self
    }

    /// 走査が完走していない。**索引が新しくなっていない**
    pub fn scan_failed(mut self, yes: bool) -> Self {
        self.scan_failed = yes;
        self
    }

    /// 読めなかった場所があった。**索引に入っていない棋譜がある**
    pub fn partially_unreadable(mut self, yes: bool) -> Self {
        self.partially_unreadable = yes;
        self
    }
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
    /// （SFEN より広く、USI の `position` 行も通る）。定跡側にもう1本の
    /// 受理集合を置く予定があり、どちらへ寄せるかは #236
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
/// そこまでの chunk の後にこれが出る。**chunk が0本でも届きうる。**
/// 打ち切られた検索と出し切った検索は、これだけでは区別できない。
///
/// **届かない経路がある。** 綴りが読めなかったとき、検索の本体が落ちたとき、
/// 取り出しを始める前に取り消しが観測されたとき。前の2つは
/// [`SearchErrorPayload`] が出る。
///
/// **待ちを解く側は、これと `EVT_SEARCH_ERROR` の両方を見ること。**
/// 出す側は `query_service` を読むこと。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEndPayload {
    pub request_id: RequestId,
}

/// 検索が失敗した。`EVT_SEARCH_ERROR` に載る。
///
/// **emit 専用。** `Deserialize` を持たないのは、`message` の欄の型が
/// 刈る口を通った値しか受けないため（綴りから直に作れると門を回避できる）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchErrorPayload {
    pub request_id: RequestId,
    /// **英語の内部の理由がそのまま入る。** 綴りが読めなかった理由も
    /// ここへ来る。画面に素で出す前に言葉を用意すること（#398）。
    ///
    /// **長さと制御文字を落とすのは Rust 側の仕事**（`search::message`）。
    /// 型が `ScreenMessage` なのは、刈っていない `String` を載せられなくするため。
    ///
    /// **画面側に刈り込みは無く、器を越えたぶんは3箇所とも読まれない。** 描くのは状態行
    /// （`PositionSearchStatusBar`）と、一致0件の箱・打ち切りの知らせ
    /// （`PositionSearchHitList`）。どれも `overflow-wrap` の指定が無いので、
    /// **空白を含まない綴りには折り返す場所が無く**、器を越えたぶんは祖先の
    /// `overflow: hidden` が切る。刈った印の省略記号も切られる側に入る。
    ///
    /// だから**載せる文言は何が悪いのかを文頭で言うこと。**
    /// 画面側で折り返させるかは #457。
    pub message: ScreenMessage,
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

/// 警告が**何について**のものか。
///
/// **場所とファイルを混ぜない。** 画面は限られた枠しか出せないので、
/// 混ぜると1回の再走査で出るファイル単位の警告が場所の警告を押し出す
/// ——押し出されるのは「ワークスペースを読めません」のような、
/// **利用者が次にすることを含んだ唯一の文言**のほう。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IndexWarnKind {
    /// ワークスペースそのもの、または読めなかった場所についての警告
    Place,
    /// 棋譜1件についての警告
    File,
}

/// 索引を組む途中で、1件ぶん伝えることがあった。`EVT_INDEX_WARN` に載る。
///
/// **「索引に入らなかった」とは限らない。** 読めなかったファイル（局面が1件も
/// 入らない）と、読めたが一部を採れなかった棋譜（**途中までは入っている**）が
/// 同じ口に載る。どちらなのかは文言が言う。
///
/// **emit 専用**（`SearchErrorPayload` と同じ理由で `Deserialize` を持たない）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexWarnPayload {
    /// 場所についてか、棋譜1件についてか。**画面はこれで並べ分ける。**
    pub kind: IndexWarnKind,
    /// どのファイルの話か。画面はこちらを別の行に出す（`wsTab__warnPath`）。
    pub path: String,
    /// **何が起きて、何を失ったかを言う。** 読めなかったファイルは局面が1件も
    /// 索引に入らないので、理由だけを出すと「読めない行が1つある」と受け取られる。
    /// **この欄に載る文言はどれもこの基準に従う**（作る場所は複数ある）。
    ///
    /// **長さと制御文字を落とすのは Rust 側の仕事**（`search::message`）。
    /// 画面側に刈り込みは無い。`WorkspaceTab` が素のテキストで描くのは `warns` の**先頭5件**。
    /// `reducer` は新しいものを末尾に積み、**200件を超えると先頭から落とす**ので、
    /// 200件までは最初の5件で固定され、それ以降は**新着ごとに5行すべてが1つずつずれる**。
    /// どちらの側でも、後から出した警告を読ませることはできない（#465）。
    ///
    /// 日本語の案内は折り返して箱が縦に伸びるが、**空白を含まない綴りは折り返す場所が
    /// 無く、横へはみ出して読まれない**（`overflow-wrap` の指定が無い）。
    /// `path` と違って `title` も無く、箱を包む `.sui-section` が `overflow: hidden` なので、
    /// はみ出した末尾を読む手段は無い。
    /// **何が悪いのかは先に言うこと。**
    ///
    /// 件数のほうは webview の state に200件まで溜まる（`entities/search/model/reducer.ts`）。
    pub message: ScreenMessage,
}

impl IndexWarnPayload {
    /// 場所についての警告。**組み立てはここを通すこと。**
    ///
    /// 欄が `pub` なので構造体リテラルも書けてしまう。閉じているのは型ではなく
    /// `tests/state_is_announced_once.rs` の走査
    /// （`no_one_builds_a_warning_payload_with_a_struct_literal`）。
    /// **`kind` を取り違えると、場所の警告が `pickWarns` の場所優先の枠から外れ、
    /// ファイル単位の警告に押し出されて画面から消える。**
    pub fn place(path: impl Into<String>, message: ScreenMessage) -> Self {
        Self {
            kind: IndexWarnKind::Place,
            path: path.into(),
            message,
        }
    }

    /// 棋譜1件についての警告。
    pub fn file(path: impl Into<String>, message: ScreenMessage) -> Self {
        Self {
            kind: IndexWarnKind::File,
            path: path.into(),
            message,
        }
    }
}
