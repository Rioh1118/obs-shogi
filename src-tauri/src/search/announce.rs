//! 索引の具合を、**利用者の言葉と画面の状態にする**。
//!
//! **`EVT_INDEX_STATE` に載るものはここで組む。** 差分を当てる側（`project_manager`）にも
//! 全件構築の側（`build` / `commands`）にも置くと、旗を知らない側が
//! `IndexStatePayload::of`（全部 `false` から始まる）で組んで、あとから出たほうが
//! 緑で塗り潰す。`src-tauri/tests/state_is_announced_once.rs` が綴りで固定している。
//!
//! **`EVT_INDEX_WARN` はここが全部ではない。** ここが組むのは、走査とワークスペースに
//! ついての文言（`place`）と、**索引を組む仕事そのものが落ちたとき**の文言
//! （`build_failure`）。棋譜の**読み取り**が失敗した理由は `read/diagnosis.rs` が組む。
//!
//! 割れ目は `place` / `file` ではなく**理由を誰が持っているか**。読み取りの失敗は
//! 読み手が理由を知っているが、`spawn_blocking` の join が落ちた回は読み手が
//! 何も知らない——だから後者だけここに居る。
//!
//! **文言は `AppHandle` を要らない形に切ってある**ので、テストから直に呼べる。
//! ただし**呼ばれていることまでは見ていない**——emit の側を落としても緑のまま。

use std::collections::HashSet;
use std::sync::Arc;

use tauri::{AppHandle, Emitter};

use crate::search::read::fs_scan::ScanError;
use crate::search::store::index_store::IndexStore;
use crate::search::types::{
    IndexState, IndexStatePayload, IndexWarnPayload, EVT_INDEX_STATE, EVT_INDEX_WARN,
};

/// 進捗を出す間隔。
///
/// **`search/mod.rs` に置かない。** `mod.rs` は段の表の外なので、上下の言えない
/// 2つ（`build` と `project_manager`）がそこを共有の置き場にできてしまう。
/// ここは「画面へ何をどれだけの頻度で出すか」を決める段なので、間隔もここが持つ。
///
/// **段の検査は当てにできない。** `tests/layering.rs` が歩くのは `src/engine` だけで
/// （#399）、`search` は `mod.rs` も `announce.rs` も等しく検査の外に居る。
/// 置き場の根拠は責務であって、機械ではない。
///
/// **経路ごとに変えない。** 同じ進捗バーへ全件構築と差分更新の両方が流すので、
/// 片方だけ間引くと、同じ件数の変更でも経路によって画面の滑らかさが違う。
///
/// 間引かないと、フォルダを1つ移しただけで数千件の直列化と IPC が
/// 途切れなく走り、tokio のワーカーを1本占有する。
pub const EMIT_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

/// 差分適用がどう終わったか。
///
/// **`bool` に畳まないこと。** 「据え直された」と「走査できなかった」は、
/// 呼び手のするべきことが逆になる——前者は索引がもう自分のものではないので
/// `Ready` を出してはいけない、後者は**索引は自分のもののまま健全**で
/// 差分が当たっていないだけなので `Ready` を出さなければならない。
///
/// 畳むと後者が前者として扱われ、復元した索引がメモリに丸ごと在るのに
/// 画面は「更新中」のまま戻らない（再試行の導線は無いので、開き直しても同じ）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[must_use = "結末を捨てると、旗を知らない側が `Ready` を伏せた旗で塗り潰す（`announce_state` に `IndexAnnouncement::Rescanned` で渡すこと）"]
pub enum RescanOutcome {
    /// 自分の代のまま完走し、帳簿を進めた。差分があれば索引にも書いた。
    ///
    /// **読めなかった場所があったかを一緒に運ぶ。** 結末と別に持つと、
    /// 結末を出す口が旗を知らないまま `false` を書いて塗り潰す
    Committed {
        /// 読めなかった場所があった。**索引に入っていない棋譜がある**の印
        partially_unreadable: bool,
    },
    /// 走っている間にワークスペースが据え直された。**何も書いていない**
    Superseded,
    /// 走査そのものが失敗した（root が消えた、未マウント、権限）。
    ///
    /// **索引は最後に読めたときのまま健全。** 差分が当たっていないだけなので、
    /// 呼び手は `Ready` を出したうえで `scan_failed` を立てること。
    ScanFailed,
}

/// 仕事が終わったことを画面へ出す。
///
/// **件数は呼び手に数えさせない。** 据え直された後の呼び手に数えさせると、
/// **新しい索引の件数**を自分の結末に載せる。ここで索引から数える。
///
/// **代を確かめてから出す。** 合わなければ何も出さない——その索引はもう
/// このタスクのものではない。
pub fn announce_state(
    app: &AppHandle,
    store: &Arc<IndexStore>,
    epoch: u64,
    state: IndexAnnouncement,
) {
    let Some(snap) = store.snapshot_if_epoch(epoch) else {
        return;
    };
    // **墓標を数えない。** 消しても数が減らないと「削除が反映されていない」と読める
    let live = snap.file_table.live_len() as u32;
    // 組めた数は索引が覚えている（`FileEntry::indexed` の doc に理由）
    let indexed = snap.file_table.indexed_len() as u32;
    let Some(payload) = state.into_payload(live, indexed) else {
        return;
    };
    let _ = app.emit(EVT_INDEX_STATE, payload);
}

/// 仕事が進んでいることを画面へ出す。
///
/// **対象の件数は呼び手が持ち、据わっている索引の件数はここで数える。**
/// まだ索引に入っていないものは呼び手しか知らないが、既に据わっている数は
/// 索引が覚えている（[`crate::search::types::FileEntry::indexed`]）。
///
/// **代は同じように確かめる。** 確かめないと、ワークスペースを切り替えた後の
/// 画面へ**前のワークスペースの進捗**が流れ続ける——全件構築は
/// [`EMIT_INTERVAL`] ごとに出すので、次のバッチが
/// `update_if_epoch` に弾かれるまで毎秒10回それが届く。
pub fn announce_progress(
    app: &AppHandle,
    store: &Arc<IndexStore>,
    epoch: u64,
    progress: IndexProgress,
) {
    let Some(snap) = store.snapshot_if_epoch(epoch) else {
        return;
    };
    // **据わっている索引の数を運ぶ。** 0 のまま出すと、差分を当てているあいだ
    // 画面が「索引済み 0 / 5,000」になる——バッジは「更新中」と言っているのに
    // 数字は「1件も入っていない」と言う。起動直後は復元が出した数から 0 へ
    // 落ちて戻るので、壊れた索引にしか見えない
    let indexed = snap.file_table.indexed_len() as u32;
    let _ = app.emit(EVT_INDEX_STATE, progress.into_payload(indexed));
}

/// 進行中の段。**対象の件数は呼び手が持つ。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexProgress {
    /// ディスク上のキャッシュを読みに行っている
    Restoring,
    /// 復元できた。差分を当てるまでは `Ready` にしない
    Restored { files: u32 },
    /// 全件構築の最中
    Building {
        total: u32,
        /// **索引に入れ終えた数。** 組めなかった棋譜を含めない
        indexed: u32,
        partially_unreadable: bool,
    },
    /// 差分を当てている最中
    Updating {
        total: u32,
        dirty: u32,
        /// **`Building` と同じ旗を運ぶ。** 片方だけ運ばないと、再走査に入った
        /// 瞬間に旗が伏せられる——同じ事実が経路によって消える
        partially_unreadable: bool,
    },
}

impl IndexProgress {
    /// `indexed` は**いま据わっている索引が組めている数**（`FileTable::indexed_len`）。
    ///
    /// 進行中の腕のうち、既に索引が据わっているもの（`Restored` / `Updating`）が使う。
    ///
    /// `Restoring` は `restart` の直後で索引が空。**`Building` は空ではない**
    /// （`COMMIT_BATCH` ごとに積みながら進む）が、`indexed_len` はその
    /// バッチのぶんだけ遅れるので、進捗には自前の走行中の勘定を使う
    /// ——揃えると数字が `COMMIT_BATCH` 刻みで飛ぶ。
    fn into_payload(self, indexed: u32) -> IndexStatePayload {
        match self {
            Self::Restoring => IndexStatePayload::of(IndexState::Restoring, 0),
            Self::Restored { files } => {
                IndexStatePayload::of(IndexState::Updating, files).indexed(indexed)
            }
            Self::Building {
                total,
                indexed,
                partially_unreadable,
            } => IndexStatePayload::of(IndexState::Building, total)
                .indexed(indexed)
                .partially_unreadable(partially_unreadable),
            Self::Updating {
                total,
                dirty,
                partially_unreadable,
            } => IndexStatePayload::of(IndexState::Updating, total)
                .indexed(indexed)
                .dirty(dirty)
                .partially_unreadable(partially_unreadable),
        }
    }
}

/// 仕事が終わったことの告げ方。**`IndexState` そのものではない**——
/// 段と旗をどう組むかはこの型が決める。
///
/// **TS の `IndexAnnouncement`（reducer が積む索引の現況）とは別物。**
/// あちらは8欄のオブジェクトで、こちらは1回の結末。線には出ない。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexAnnouncement {
    /// 全件構築が終わった
    Built {
        /// 読めなかった**場所**があった（走査由来）
        partially_unreadable: bool,
    },
    /// 差分適用が終わった
    Rescanned(RescanOutcome),
    /// **作ろうとして作れなかった。** 索引は空のまま
    ///
    /// 画面の段を `Ready` にしない——`indexHealth`
    /// （`entities/search/lib/indexHealth.ts`）は `Empty` ＋ `scanFailed` でだけ
    /// `buildFailed`（＝必ず0件）に落ちる。`Ready` を出すと
    /// 「更新できていません」（＝前回の索引が残っている）と同じ語になり、
    /// **必ず0件になることが画面から消える**。
    ///
    /// **`IndexStore` の段は動かしていない。** ここが決めるのは画面へ出す段だけで、
    /// 中は `restart(Restart::Building)` が入れた `Building` のまま
    /// （`docs/state-transitions/search.md` の同名の節）。
    BuildFailed,
}

impl IndexAnnouncement {
    /// 段と旗を組む。**`AppHandle` も索引も要らない形**なのでテストから直に呼べる。
    ///
    /// `None` は「出してはいけない」。**結末を出す口の外で `Superseded` を
    /// 判定させないため**——呼び手が `outcome` を見て分岐する形にすると、
    /// 経路ごとに判定が割れる。
    fn into_payload(self, live: u32, indexed: u32) -> Option<IndexStatePayload> {
        Some(match self {
            Self::Rescanned(RescanOutcome::Superseded) => return None,
            Self::BuildFailed => IndexStatePayload::of(IndexState::Empty, 0).scan_failed(true),
            Self::Built {
                partially_unreadable,
            } => IndexStatePayload::of(IndexState::Ready, live)
                .indexed(indexed)
                .partially_unreadable(partially_unreadable),
            Self::Rescanned(outcome) => IndexStatePayload::of(IndexState::Ready, live)
                .indexed(indexed)
                .scan_failed(outcome == RescanOutcome::ScanFailed)
                .partially_unreadable(matches!(
                    outcome,
                    RescanOutcome::Committed {
                        partially_unreadable: true
                    }
                )),
        })
    }
}

/// 走査そのものが失敗したことを画面へ出す。
///
/// **理由を言えるのはここだけ。** 旗は「失敗した」しか運ばないので、
/// 落とすと未マウントか権限かが画面から完全に消える。
///
/// **代を確かめてから出す。** 警告は場所を**絶対パスで名指しする**ので、
/// 据え直された後に出すと、いま開いていないワークスペースのパスが画面に残る
/// ——**ワークスペースを開き直しても警告は消えない**ので、利用者が
/// 「警告をクリア」を押すまでそのセッション中ずっと居座る。
pub fn warn_scan_failed(
    app: &AppHandle,
    store: &Arc<IndexStore>,
    epoch: u64,
    root: &std::path::Path,
    reason: &ScanError,
    survival: IndexSurvival,
) {
    if store.snapshot_if_epoch(epoch).is_none() {
        return;
    }
    let _ = app.emit(
        EVT_INDEX_WARN,
        IndexWarnPayload::place(root.to_string_lossy(), scan_failure(reason, survival)),
    );
}

/// 索引を作り始められなかったことを画面へ出す。
///
/// **場所についての文言はこの段が組む。** 呼び手が裸のリテラルで組むと、
/// そこだけ言い分け（[`IndexSurvival`]）も語彙の統一も掛からない。
///
/// **代は見ない。ここへ来る回は既に代が合っている。** 呼び手（`build.rs`）が
/// `snapshot_if_epoch` を通した後の腕でだけ呼ぶので、名指しする `root` は
/// いま据わっているワークスペースのもの。二度目の関門は素通りするだけ。
///
/// **代が合わない回はここへ来ない。** そちらは据え直しであって、利用者に
/// 告げることが無いので呼び手が無言で帰る。
pub fn warn_build_not_started(app: &AppHandle, root: &std::path::Path) {
    let _ = app.emit(
        EVT_INDEX_WARN,
        IndexWarnPayload::place(root.to_string_lossy(), warn_build_not_started_message()),
    );
}

/// 上の文言。**`AppHandle` を要らない形**なので内部語彙の検査に載せられる。
pub(crate) fn warn_build_not_started_message() -> String {
    "索引を作り始められませんでした。いま検索しても0件になります。\
     ワークスペースを開き直してください"
        .to_string()
}

/// 読めなかった場所を画面へ出す。
///
/// **代を確かめてから出す。** 理由は [`warn_scan_failed`] と同じ。
///
/// **引き継げた場所と引き継げなかった場所を1件に畳まない。** 失われるものが
/// 逆になる——前者の棋譜は検索に出続け、後者の棋譜は索引に無い。畳むと、
/// 名指しした場所に対して**逆のこと**を告げることになる。
pub fn warn_unreadable(
    app: &AppHandle,
    store: &Arc<IndexStore>,
    epoch: u64,
    unreadable: &[String],
    unknown_gaps: bool,
    carried_places: &HashSet<String>,
    survival: IndexSurvival,
) {
    if store.snapshot_if_epoch(epoch).is_none() {
        return;
    }
    for w in unreadable_warnings(unreadable, unknown_gaps, carried_places, survival) {
        let _ = app.emit(EVT_INDEX_WARN, w);
    }
}

/// 読めなかった場所を警告へ組む。**`AppHandle` を要らない形**なのでテストから直に呼べる。
///
/// 出るのは多くて3件——引き継げた場所の分、引き継げなかった場所の分、
/// 場所が分からない失敗の分。**それぞれ自分の代表と自分の件数を名乗る。**
fn unreadable_warnings(
    unreadable: &[String],
    unknown_gaps: bool,
    carried_places: &HashSet<String>,
    survival: IndexSurvival,
) -> Vec<IndexWarnPayload> {
    let (carried, lost): (Vec<&String>, Vec<&String>) = unreadable
        .iter()
        .partition(|u| carried_places.contains(u.trim_end_matches('/')));

    let mut out = Vec::new();
    for (places, carried_over) in [(&lost, false), (&carried, true)] {
        if let Some(first) = places.first() {
            out.push(IndexWarnPayload::place(
                (*first).clone(),
                unreadable_places(places.len(), carried_over),
            ));
        }
    }
    if unknown_gaps {
        // 場所が分からない失敗。**代表に選べる場所が無い**ので `path` は空
        out.push(IndexWarnPayload::place(
            String::new(),
            unreadable_gaps(survival),
        ));
    }
    out
}

/// 走査が失敗したとき、**索引が残っているか**。
///
/// 同じ失敗でも、失われるものが逆になる。差分更新なら索引は最後に読めた
/// ときのまま健全で、当たっていないのは差分だけ。全件構築なら
/// `restart(Restart::Building)` が既に中身を捨てているので**索引は空**。
///
/// 畳むと、空にした回に「索引は最後に読めたときのままです」と告げることになり、
/// 利用者は**古い索引でなら検索できる**と読んで、0件を「棋譜が無い」と受け取る。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexSurvival {
    /// 差分更新。索引は前のまま残っている
    Kept,
    /// 全件構築。索引は捨てられていて、いま検索しても0件
    Gone,
}

/// 走査そのものが失敗したことを、利用者に出す一文へ組む。
///
/// **何が起きたか・何が失われたか・次に何をすればよいかの3つを言う。**
///
/// **内部の語彙を出さない。** `ScanError` の `Display` は
/// `io error: Permission denied (os error 13)` のような綴りなので、
/// 素で流すと利用者は自分に関係のある文字列だと読んで検索する。
pub(crate) fn scan_failure(reason: &ScanError, survival: IndexSurvival) -> String {
    let what = match reason {
        ScanError::RootNotFound(_) => "ワークスペースが見つかりません",
        ScanError::RootUnreadable(_) => "ワークスペースを読む権限がありません",
        ScanError::Io(_) => "ワークスペースを読めませんでした",
    };
    let how = match reason {
        ScanError::RootNotFound(_) => {
            "つないでいるディスクや共有フォルダを確かめるか、設定からワークスペースを選び直してください"
        }
        ScanError::RootUnreadable(_) => {
            "フォルダの権限を確かめるか、設定からワークスペースを選び直してください"
        }
        ScanError::Io(_) => "ディスクやネットワークの接続を確かめてください",
    };
    let lost = match survival {
        IndexSurvival::Kept => "索引は最後に読めたときのままで、新しくなっていません",
        IndexSurvival::Gone => "索引を作れていないので、いま検索しても0件になります",
    };
    format!("{what}。{lost}。{how}")
}

/// 読めなかった場所を、利用者に出す一文へ組む。
///
/// **「フォルダ」と言い切らない。** 読めなかったものにはファイル自身も入る
/// （`metadata` に失敗した腕）ので、`.kif` を指して「このフォルダ」と出すと、
/// 利用者は無いフォルダを探すか、案内どおり棋譜を外へ移す。
///
/// **失われるものは呼び手で違う。** `carried_over` は「その場所の棋譜を
/// 前回の走査から引き継げたか」。引き継げていれば検索には出続ける代わりに
/// その場所の追加・変更が反映されず、引き継げていなければ索引に入らない。
/// 逆のことを言うと、利用者は出ているものを「出ない」と読んで探しに行き、
/// 案内どおりワークスペースを選び直して**そのとき初めて本当に消す**。
pub(crate) fn unreadable_places(count: usize, carried_over: bool) -> String {
    let more = if count > 1 {
        format!("（ほか {} 件）", count - 1)
    } else {
        String::new()
    };
    let lost = if carried_over {
        "中の棋譜は前回の索引のまま残ります。ここでの追加・変更は反映されません"
    } else {
        "中の棋譜は索引に入っていないので、検索に出ません"
    };
    format!("この場所を読めません{more}。{lost}。権限を確かめてください")
}

/// 場所の分からない読み取り失敗を、利用者に出す一文へ組む。
///
/// **場所が分かる失敗と同じ関数にしない。** 言えることが全く違う——
/// あちらは場所を名指しできるが、こちらは名指しできる場所が無い。
/// 1つの関数に同居させると、片方でしか起きない引数の組み合わせが残る。
///
/// **失われるものは呼び手で違う。** 差分更新はこの回の削除を当てないだけで
/// 索引は残る。全件構築は引き継ぐ前回が無いので、読めなかった分は索引に入らない。
/// 逆を言うと、利用者は「索引そのものは正しい」と読んで0件を受け取る。
pub(crate) fn unreadable_gaps(survival: IndexSurvival) -> String {
    let lost = match survival {
        IndexSurvival::Kept => "どの場所かは分からないので、この回の削除は索引に反映していません",
        IndexSurvival::Gone => "どの場所かは分からないので、索引に入っていない棋譜があります",
    };
    format!(
        "ワークスペースの一部を読み取れませんでした。{lost}。\
         ディスクやネットワークの接続を確かめてください（次に変更があれば取り直します）"
    )
}

/// 索引を組む仕事そのものが落ちたときの文言。
///
/// **内部の語彙を画面に出さない。** `JoinError` の `Display` は
/// `task 42 panicked` のような綴り。
pub(crate) fn build_failure() -> String {
    "この棋譜を索引に入れられませんでした。検索には出ません。\
     開き直しても直らないときは、ファイルが壊れていないか確かめてください"
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::types::IndexWarnKind;

    /// 段と旗の写像。**`announce_state` の中身は `AppHandle` を要るので、
    /// ここが落ちないかぎり写像は誰も見ていない。**
    fn payload(state: IndexAnnouncement, live: u32) -> Option<IndexStatePayload> {
        state.into_payload(live, live)
    }

    /// 生きている数と組めた数が違う形。**索引が覚えている値を渡す。**
    fn payload_with(
        state: IndexAnnouncement,
        live: u32,
        indexed: u32,
    ) -> Option<IndexStatePayload> {
        state.into_payload(live, indexed)
    }

    /// 場所が分かるものと分からないもので、文言が分かれること。
    #[test]
    fn the_message_says_what_was_lost() {
        let known = unreadable_places(2, false);
        assert!(
            known.contains("検索に出ません"),
            "何が失われたかが無い: {known}"
        );
        assert!(known.contains("ほか 1 件"), "件数が出ていない: {known}");

        let unknown = unreadable_gaps(IndexSurvival::Kept);
        assert!(
            unknown.contains("削除は索引に反映していません"),
            "抑止したことを言っていない: {unknown}"
        );
    }

    /// **引き継げた回に「検索に出ません」と言わないこと。**
    ///
    /// 差分更新では読めない場所の下を前回の走査から引き継ぐので、その棋譜は
    /// 索引に残り検索にも出る。ここで「出ません」と言うと、利用者は消えたと
    /// 信じ、案内どおりワークスペースを選び直して**そのとき初めて本当に消す**。
    #[test]
    fn carried_over_files_are_not_described_as_gone() {
        let carried = unreadable_places(1, true);
        assert!(
            !carried.contains("検索に出ません"),
            "引き継いだ棋譜を「出ない」と言っている: {carried}"
        );
        assert!(
            carried.contains("前回の索引のまま残ります"),
            "何が起きたかを言っていない: {carried}"
        );
    }

    /// 画面に出る文言に内部の語彙が混じらないこと。
    ///
    /// **`ScanError` と `JoinError` の `Display` は内部の綴り**
    /// （`io error: Permission denied (os error 13)` / `task 42 panicked`）。
    /// 素で流すと、利用者は自分に関係のある文字列だと読んで検索する。
    #[test]
    fn no_user_message_carries_internal_words() {
        let messages = [
            unreadable_places(1, false),
            unreadable_gaps(IndexSurvival::Kept),
            unreadable_gaps(IndexSurvival::Gone),
            warn_build_not_started_message(),
            scan_failure(&ScanError::RootNotFound("/w".into()), IndexSurvival::Kept),
            scan_failure(&ScanError::RootUnreadable("/w".into()), IndexSurvival::Kept),
            scan_failure(
                &ScanError::Io(std::io::Error::other("x")),
                IndexSurvival::Gone,
            ),
            build_failure(),
        ];
        for m in messages {
            for internal in [
                "io error",
                "root directory",
                "panicked",
                "spawn_blocking",
                "join",
                "read_dir",
                "unknown_gaps",
                "Err",
            ] {
                assert!(
                    !m.contains(internal),
                    "内部の識別子が画面に出る（{internal}）: {m}"
                );
            }
            assert!(m.contains("ください"), "次に何をすればよいかが無い: {m}");
        }
    }

    fn places(v: &[&str]) -> HashSet<String> {
        v.iter().map(|s| (*s).to_string()).collect()
    }

    /// **引き継げた場所と引き継げなかった場所に、逆のことを言わないこと。**
    ///
    /// 1件に畳んで代表を先頭から選ぶと、引き継げなかった場所を指して
    /// 「前回の索引のまま残ります」と告げうる——その下の棋譜は索引に1件も
    /// 入っていないので検索に出ない。利用者は出てこない棋譜を「無い」と判断する。
    #[test]
    fn each_place_is_told_what_actually_happened_to_it() {
        let unreadable = vec!["/w/新規".to_string(), "/w/既存".to_string()];
        let ws = unreadable_warnings(
            &unreadable,
            false,
            &places(&["/w/既存"]),
            IndexSurvival::Kept,
        );

        let lost = ws
            .iter()
            .find(|w| w.path == "/w/新規")
            .expect("引き継げなかった場所の警告が無い");
        assert!(
            lost.message.contains("検索に出ません"),
            "索引に入っていない場所を「残る」と言っている: {}",
            lost.message
        );

        let kept = ws
            .iter()
            .find(|w| w.path == "/w/既存")
            .expect("引き継げた場所の警告が無い");
        assert!(
            kept.message.contains("前回の索引のまま残ります"),
            "引き継げた棋譜を「出ない」と言っている: {}",
            kept.message
        );

        // **件数もその組のもの。** 全体の件数を載せると、1件しか無い組が
        // 「ほか 1 件」と言う——利用者は在りもしない場所を探す
        for w in [lost, kept] {
            assert!(
                !w.message.contains("ほか"),
                "1件しか無い組が他の組の件数を数えている: {}",
                w.message
            );
        }
    }

    /// 同じ組に2件以上あるときだけ「ほか N 件」と言うこと。
    #[test]
    fn the_count_belongs_to_its_own_group() {
        let unreadable = vec!["/w/a".to_string(), "/w/b".to_string(), "/w/c".to_string()];
        let ws = unreadable_warnings(&unreadable, false, &places(&["/w/c"]), IndexSurvival::Kept);

        let lost = ws.iter().find(|w| w.path == "/w/a").expect("組が無い");
        assert!(
            lost.message.contains("ほか 1 件"),
            "2件の組が自分の件数を言っていない: {}",
            lost.message
        );
        let kept = ws.iter().find(|w| w.path == "/w/c").expect("組が無い");
        assert!(
            !kept.message.contains("ほか"),
            "1件の組が他の組まで数えている: {}",
            kept.message
        );
    }

    /// **場所についての警告は `place` を名乗ること。**
    ///
    /// `IndexWarnPayload::place` と `::file` は引数の型も数も同じなので、
    /// 取り違えても型検査は止めない。`file` になると
    /// `pickWarns`（TS 側）の場所優先の枠から外れ、**利用者が次にすることを
    /// 含んだ唯一の文言**が普通のパース警告に押し出されて画面から消える。
    #[test]
    fn warnings_about_places_say_they_are_about_places() {
        let ws = unreadable_warnings(
            &["/w/a".to_string()],
            true,
            &HashSet::new(),
            IndexSurvival::Kept,
        );
        assert_eq!(ws.len(), 2, "場所の分からない失敗が別の1件になっていない");
        for w in &ws {
            assert_eq!(w.kind, IndexWarnKind::Place, "種類が place でない: {w:?}");
        }
    }

    /// 読めなかった場所が1つも無ければ、何も出さないこと。
    #[test]
    fn nothing_unreadable_says_nothing() {
        assert!(unreadable_warnings(&[], false, &HashSet::new(), IndexSurvival::Kept).is_empty());
    }

    /// **索引が残っている回と、捨てた回で逆のことを言わないこと。**
    ///
    /// 全件構築は `restart(Restart::Building)` が先に中身を捨てているので、
    /// 「最後に読めたときのまま」と言うと、利用者は**古い索引でなら検索できる**と
    /// 読んで、0件を「棋譜が無い」と受け取る。
    #[test]
    fn a_thrown_away_index_is_not_described_as_intact() {
        let e = ScanError::RootNotFound("/w".into());
        let kept = scan_failure(&e, IndexSurvival::Kept);
        assert!(kept.contains("最後に読めたときのまま"), "{kept}");

        let gone = scan_failure(&e, IndexSurvival::Gone);
        assert!(
            !gone.contains("最後に読めたときのまま"),
            "捨てた索引を「残っている」と言っている: {gone}"
        );
        assert!(gone.contains("0件"), "何が起きるかを言っていない: {gone}");
    }

    /// 進行中の段の写像。**`IndexAnnouncement` 側とは別の関数なので、
    /// あちらのテストは1つも当たらない。**
    fn progress(p: IndexProgress) -> IndexStatePayload {
        p.into_payload(0)
    }

    /// 据わっている索引の数を渡す形。
    fn progress_with(p: IndexProgress, indexed: u32) -> IndexStatePayload {
        p.into_payload(indexed)
    }

    /// **進行中の段が「走査に失敗した」と名乗らないこと。**
    ///
    /// 進行中はまだ走査の結末が出ていないので、この旗を立てられる回が無い。
    /// 立ったまま終端の告知が代の不一致で出なければ、**それが最後の状態として
    /// 残り**、画面は「更新できていません」で止まる（`indexHealth` は進行中を
    /// 先に見るので、そこに至るまで誰も気付けない）。
    ///
    /// **`partially_unreadable` は「伏せた入力を勝手に立てないか」だけ見る。**
    /// 立てた入力をちゃんと運ぶかは
    /// [`both_running_states_carry_the_unreadable_flag`] が固定している。
    #[test]
    fn no_progress_state_claims_the_scan_failed() {
        for p in [
            IndexProgress::Restoring,
            IndexProgress::Restored { files: 3 },
            IndexProgress::Building {
                total: 5,
                indexed: 2,
                partially_unreadable: false,
            },
            IndexProgress::Updating {
                total: 5,
                dirty: 2,
                partially_unreadable: false,
            },
        ] {
            let out = progress(p);
            assert!(
                !out.scan_failed,
                "進行中に「更新できていません」を立てている: {p:?} -> {out:?}"
            );
            // 渡した入力は全部 `partially_unreadable: false`。ここで真になるのは
            // 写像が勝手に立てたときだけ
            assert!(
                !out.partially_unreadable,
                "入力が伏せているのに旗が立っている: {p:?} -> {out:?}"
            );
        }
    }

    /// 復元中は件数を名乗らないこと。**まだ何も読めていない。**
    #[test]
    fn restoring_claims_no_files() {
        let out = progress(IndexProgress::Restoring);
        assert_eq!(out.state, IndexState::Restoring);
        assert_eq!((out.total_files, out.indexed_files), (0, 0));
        assert_eq!(out.dirty_count, 0, "当てる差分をまだ知らない");
    }

    /// **復元しただけでは `Ready` にしないこと。**
    ///
    /// 差分を当てるまでは古いので、`Ready` を出すと `query_service` の
    /// `stale` が下りて、当たっていない差分の分だけ結果が欠ける。
    #[test]
    fn a_restored_index_is_still_updating() {
        let out = progress_with(IndexProgress::Restored { files: 7 }, 7);
        assert_eq!(out.state, IndexState::Updating);
        assert_eq!((out.total_files, out.indexed_files), (7, 7));
    }

    /// **差分を当てているあいだ、据わっている索引の数を伏せないこと。**
    ///
    /// 0 のまま出すと「索引済み 0 / 5,000」になり、バッジの「更新中」と
    /// 同じ画面で食い違う。起動直後は復元が出した数から 0 へ落ちて戻るので、
    /// 壊れた索引にしか見えない。
    #[test]
    fn updating_keeps_showing_what_the_index_already_has() {
        let out = progress_with(
            IndexProgress::Updating {
                total: 5000,
                dirty: 1,
                partially_unreadable: false,
            },
            4800,
        );
        assert_eq!(out.indexed_files, 4800, "据わっている索引の数を伏せている");
        assert_eq!(out.total_files, 5000);
    }

    /// 構築中は、入れ終えた数と対象の数を別に運ぶこと。
    #[test]
    fn building_keeps_indexed_apart_from_total() {
        let out = progress(IndexProgress::Building {
            total: 100,
            indexed: 40,
            partially_unreadable: true,
        });
        assert_eq!(out.state, IndexState::Building);
        assert_eq!((out.indexed_files, out.total_files), (40, 100));
        assert!(out.partially_unreadable, "読めない場所の旗が落ちている");
        assert_eq!(out.dirty_count, 0, "全件構築に「未同期」は無い");
    }

    /// **`total` と `dirty` を取り違えないこと。**
    ///
    /// 入れ替わると、未同期の件数の欄にワークスペース全体の件数が出る
    /// ——「未同期 50,000」は索引が壊れたようにしか見えない。
    #[test]
    fn updating_does_not_swap_total_and_dirty() {
        let out = progress(IndexProgress::Updating {
            total: 5000,
            dirty: 12,
            partially_unreadable: false,
        });
        assert_eq!(out.state, IndexState::Updating);
        assert_eq!(out.total_files, 5000);
        assert_eq!(out.dirty_count, 12);
    }

    /// **入れた数が対象を超えたら丸めること。**
    ///
    /// 数える順が入れ替わると（墓標の前に出すなど）起きる。画面に出すと
    /// 壊れた索引にしか見えないので、丸めてログへ残す——`debug_assert!` で
    /// 止めると、spawn したタスクが誰にも気付かれずに死ぬ。
    #[test]
    fn a_count_larger_than_the_total_is_clamped() {
        let p = IndexStatePayload::of(IndexState::Updating, 4500).indexed(5000);
        assert_eq!(p.indexed_files, 4500, "対象を超えた数をそのまま出している");
    }

    /// **`Building` と `Updating` が同じ旗を運ぶこと。**
    ///
    /// 片方だけ運ばないと、再走査に入った瞬間に旗が伏せられる——
    /// reducer は payload の欄を丸ごと写すので、同じ事実が経路によって消える。
    #[test]
    fn both_running_states_carry_the_unreadable_flag() {
        let building = progress(IndexProgress::Building {
            total: 5,
            indexed: 1,
            partially_unreadable: true,
        });
        let updating = progress(IndexProgress::Updating {
            total: 5,
            dirty: 1,
            partially_unreadable: true,
        });
        assert!(
            building.partially_unreadable && updating.partially_unreadable,
            "旗が経路によって落ちる: building={building:?} updating={updating:?}"
        );
    }

    #[test]
    fn a_failed_build_is_empty_and_never_ready() {
        // `Ready` を出すと `query_service` の `stale` は段しか見ないので、
        // **空の索引の 0 件が「最新」として並ぶ**
        let p = payload(IndexAnnouncement::BuildFailed, 0).expect("構築失敗は画面へ出す");
        assert_eq!(p.state, IndexState::Empty);
        assert!(p.scan_failed, "作れなかったことが旗に出ていない");
        assert_eq!(p.total_files, 0);
    }

    #[test]
    fn a_superseded_rescan_says_nothing() {
        // 据え直された回に何か出すと、**他人の索引の上に自分の代の旗が乗る**
        assert_eq!(
            payload(IndexAnnouncement::Rescanned(RescanOutcome::Superseded), 7),
            None
        );
    }

    #[test]
    fn a_failed_scan_stays_ready_but_flags_that_nothing_was_applied() {
        // 索引は最後に読めたときのまま健全なので `Ready`。ただし旗を落とすと
        // 「未同期 0」が「最新」と読める
        let p = payload(IndexAnnouncement::Rescanned(RescanOutcome::ScanFailed), 5)
            .expect("走査の失敗は画面へ出す");
        assert_eq!(p.state, IndexState::Ready);
        assert!(p.scan_failed);
        assert!(
            !p.partially_unreadable,
            "走査が失敗した回に「一部を読めなかった」まで立てると、利用者は別のことを直しに行く"
        );
        assert_eq!(p.total_files, 5, "件数は生きている分");
    }

    #[test]
    fn unreadable_places_survive_into_the_state() {
        // 警告だけだと設定タブを開かないかぎり届かず、局面検索は0件を裸で断言する
        let p = payload(
            IndexAnnouncement::Rescanned(RescanOutcome::Committed {
                partially_unreadable: true,
            }),
            5,
        )
        .expect("完走した回は画面へ出す");
        assert_eq!(p.state, IndexState::Ready);
        assert!(p.partially_unreadable);
        assert!(
            !p.scan_failed,
            "完走しているのに「更新できていない」と言っている"
        );
    }

    /// **再走査が「組めなかった」を緑で塗り潰さないこと。**
    ///
    /// 差分更新は自分が触れた分しか知らないので、その回の数で埋めると
    /// **前の回の失敗が1回の再走査で消える**。ワークスペース内でファイルを
    /// 1つ保存するだけで起きるうえ、開き直すと復元経路が必ず再走査を通るので、
    /// 次回以降は一度も出なくなる。数えるのは索引（`indexed_len`）。
    #[test]
    fn a_rescan_does_not_erase_what_the_build_could_not_index() {
        let p = payload_with(
            IndexAnnouncement::Rescanned(RescanOutcome::Committed {
                partially_unreadable: false,
            }),
            1000,
            800,
        )
        .expect("完走した回は画面へ出す");
        assert_eq!(
            p.indexed_files, 800,
            "再走査が組めなかった200本を「入れた」ことにしている"
        );
        assert_eq!(p.total_files, 1000);
    }

    #[test]
    fn a_clean_rescan_raises_no_flag() {
        let p = payload(
            IndexAnnouncement::Rescanned(RescanOutcome::Committed {
                partially_unreadable: false,
            }),
            5,
        )
        .expect("完走した回は画面へ出す");
        assert!(!p.scan_failed && !p.partially_unreadable);
        assert_eq!(p.indexed_files, 5);
    }

    #[test]
    fn a_full_build_carries_the_unreadable_flag() {
        let p = payload(
            IndexAnnouncement::Built {
                partially_unreadable: true,
            },
            3,
        )
        .expect("構築の完了は画面へ出す");
        assert_eq!(p.state, IndexState::Ready);
        assert!(p.partially_unreadable);
        assert!(
            !p.scan_failed,
            "完走した構築を「更新できていません」と言っている"
        );
        assert_eq!((p.indexed_files, p.total_files), (3, 3));
    }

    /// **いちばん普通の経路に旗が1本も立たないこと。**
    ///
    /// ここが抜けていると、`Built` の腕に旗を1つ足す変異が素通りする——
    /// 問題なく終わった構築が毎回「更新できていません」になり、利用者は
    /// 正常な索引をワークスペースの選び直しで作り直しに行く。
    #[test]
    fn a_clean_full_build_raises_no_flag() {
        let p = payload(
            IndexAnnouncement::Built {
                partially_unreadable: false,
            },
            3,
        )
        .expect("構築の完了は画面へ出す");
        assert_eq!(p.state, IndexState::Ready);
        assert!(
            !p.scan_failed && !p.partially_unreadable,
            "何も起きていない構築で旗が立っている: {p:?}"
        );
    }

    /// **組めなかった棋譜を「索引に入れた」と数えないこと。**
    ///
    /// 生きている件数（`live_len`）で代えると、組めなかった棋譜が何本あっても
    /// `indexed == total` になり、失敗が数字から完全に消える——警告は出るが、
    /// バッジは緑の「準備完了」のまま。
    ///
    /// 数えるのは索引（`FileTable::indexed_len`）。理由は
    /// `FileEntry::indexed` の doc。
    #[test]
    fn files_that_could_not_be_indexed_are_not_counted_as_indexed() {
        // 表には1000件居るが、組めたのは800件——差の200件は局面を1つも持たない
        let p = payload_with(
            IndexAnnouncement::Built {
                partially_unreadable: false,
            },
            1000,
            800,
        )
        .expect("構築の完了は画面へ出す");
        assert_eq!(p.indexed_files, 800, "組めなかった200本を数に入れている");
        assert_eq!(p.total_files, 1000);
    }
}
