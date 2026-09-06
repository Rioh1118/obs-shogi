//! 索引の具合を、**利用者の言葉と画面の状態にする**。
//!
//! **`EVT_INDEX_STATE` と `EVT_INDEX_WARN` に載るものはここで組む。** 差分を当てる側
//! （`project_manager`）にも全件構築の側（`build` / `commands`）にも置くと、
//! 同じ失敗が経路ごとに違う言い方になり、旗を知らない側が伏せたまま出す。
//!
//! **文言は `AppHandle` を要らない形に切ってある**ので、テストから直に呼べる。
//! ただし**呼ばれていることまでは見ていない**——emit の側を落としても緑のまま。

use std::sync::Arc;

use tauri::{AppHandle, Emitter};

use crate::search::read::fs_scan::ScanError;
use crate::search::store::index_store::IndexStore;
use crate::search::types::{
    IndexState, IndexStatePayload, IndexWarnPayload, EVT_INDEX_STATE, EVT_INDEX_WARN,
};

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
#[must_use = "結末を捨てると、旗を知らない側が `Ready` を伏せた旗で塗り潰す（`announce_rescan` を通すこと）"]
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

/// 索引の段と旗を画面へ出す。**`EVT_INDEX_STATE` を出す口はここだけ。**
///
/// 出口が散ると、旗を知らない側が伏せたまま組む（`IndexStatePayload::of` は
/// 全部 `false` から始まる）ので、あとから出たほうが緑で塗り潰す。
///
/// **代を確かめてから出す。** `total_files` を呼び手に数えさせると、
/// 据え直された後の呼び手が**新しい索引の件数**を自分の結末に載せる。
pub fn announce_state(app: &AppHandle, store: &Arc<IndexStore>, epoch: u64, state: IndexUiState) {
    let Some(snap) = store.snapshot_if_epoch(epoch) else {
        // その索引はもうこのタスクのものではない。何も出さない
        return;
    };
    // **墓標を数えない。** 消しても数が減らないと「削除が反映されていない」と読める
    let live = snap.file_table.live_len() as u32;
    let Some(payload) = state.into_payload(live) else {
        return;
    };
    let _ = app.emit(EVT_INDEX_STATE, payload);
}

/// 画面へ出す段と旗。**件数は載せない**——数えるのは `announce_state` の仕事で、
/// 呼び手に数えさせると据え直された後の索引を数える。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexUiState {
    /// 全件構築が終わった。読めなかった場所があったかを運ぶ
    Built { partially_unreadable: bool },
    /// 差分適用が終わった
    Rescanned(RescanOutcome),
    /// **作ろうとして作れなかった。** 索引は空のまま
    ///
    /// `Ready` にしない——`query_service` の `stale` は段だけを見るので、
    /// 空の索引を `Ready` にすると**0件が「最新」として並ぶ**
    /// （`store/index_store.rs` の `//!` が名指しで警告している形）。
    BuildFailed,
}

impl IndexUiState {
    /// 段と旗を組む。**`AppHandle` も索引も要らない形**なのでテストから直に呼べる。
    ///
    /// `None` は「出してはいけない」。据え直された回に `Ready` を出すと、
    /// **他人の索引の上に自分の代の旗が乗る**——代の照合は `announce_state`
    /// にもあるが、据え直しを検出した時点ではまだ照合が通ることがある。
    fn into_payload(self, live: u32) -> Option<IndexStatePayload> {
        Some(match self {
            Self::Rescanned(RescanOutcome::Superseded) => return None,
            Self::BuildFailed => IndexStatePayload::of(IndexState::Empty, 0).scan_failed(true),
            Self::Built {
                partially_unreadable,
            } => IndexStatePayload::of(IndexState::Ready, live)
                .indexed(live)
                .partially_unreadable(partially_unreadable),
            Self::Rescanned(outcome) => IndexStatePayload::of(IndexState::Ready, live)
                .indexed(live)
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
pub fn warn_scan_failed(app: &AppHandle, root: &std::path::Path, reason: &ScanError) {
    let _ = app.emit(
        EVT_INDEX_WARN,
        IndexWarnPayload::place(root.to_string_lossy(), scan_failure(reason)),
    );
}

/// 読めなかった場所を画面へ出す。
///
/// **代表として先頭を `path` に載せる。** 場所が分からない失敗しか無い回は空。
/// この決めごとを呼び手に持たせると、経路ごとに指す場所が変わる。
pub fn warn_unreadable(app: &AppHandle, unreadable: &[String], unknown_gaps: bool, carried: usize) {
    if unreadable.is_empty() && !unknown_gaps {
        return;
    }
    let _ = app.emit(
        EVT_INDEX_WARN,
        IndexWarnPayload::place(
            unreadable.first().cloned().unwrap_or_default(),
            unreadable_places(unreadable.len(), unknown_gaps, carried > 0),
        ),
    );
}

/// 走査そのものが失敗したことを、利用者に出す一文へ組む。
///
/// **何が起きたか・何が失われたか・次に何をすればよいかの3つを言う。**
/// 索引そのものは最後に読めたときのまま残っているので、
/// 「検索できない」ではなく「新しくなっていない」が正しい。
///
/// **内部の語彙を出さない。** `ScanError` の `Display` は
/// `io error: Permission denied (os error 13)` のような綴りなので、
/// 素で流すと利用者は自分に関係のある文字列だと読んで検索する。
pub(crate) fn scan_failure(reason: &ScanError) -> String {
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
    format!("{what}。索引は最後に読めたときのままで、新しくなっていません。{how}")
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
pub(crate) fn unreadable_places(count: usize, unknown_gaps: bool, carried_over: bool) -> String {
    let more = if count > 1 {
        format!("（ほか {} 件）", count - 1)
    } else {
        String::new()
    };
    if count == 0 {
        // 場所が分からない失敗だけ。**抑止したことと、次にどうなるかを言う**
        return "ワークスペースの一部を読み取れませんでした。どの場所かは分からないので、\
                この回の削除は索引に反映していません。\
                ディスクやネットワークの接続を確かめてください（次に変更があれば取り直します）"
            .to_string();
    }
    let gaps = if unknown_gaps {
        "。ほかにも場所の分からない読み取り失敗があります"
    } else {
        ""
    };
    let lost = if carried_over {
        "中の棋譜は前回の索引のまま残ります。ここでの追加・変更は反映されません"
    } else {
        "中の棋譜は索引に入っていないので、検索に出ません"
    };
    format!("この場所を読めません{more}。{lost}{gaps}。権限を確かめてください")
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

    /// 段と旗の写像。**`announce_state` の中身は `AppHandle` を要るので、
    /// ここが落ちないかぎり写像は誰も見ていない。**
    fn payload(state: IndexUiState, live: u32) -> Option<IndexStatePayload> {
        state.into_payload(live)
    }

    /// 場所が分かるものと分からないもので、文言が分かれること。
    #[test]
    fn the_message_says_what_was_lost() {
        let known = unreadable_places(2, false, false);
        assert!(
            known.contains("検索に出ません"),
            "何が失われたかが無い: {known}"
        );
        assert!(known.contains("ほか 1 件"), "件数が出ていない: {known}");

        let unknown = unreadable_places(0, true, false);
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
        let carried = unreadable_places(1, false, true);
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
            unreadable_places(1, false, false),
            unreadable_places(0, true, false),
            scan_failure(&ScanError::RootNotFound("/w".into())),
            scan_failure(&ScanError::RootUnreadable("/w".into())),
            scan_failure(&ScanError::Io(std::io::Error::other("x"))),
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

    #[test]
    fn a_failed_build_is_empty_and_never_ready() {
        // `Ready` を出すと `query_service` の `stale` は段しか見ないので、
        // **空の索引の 0 件が「最新」として並ぶ**
        let p = payload(IndexUiState::BuildFailed, 0).expect("構築失敗は画面へ出す");
        assert_eq!(p.state, IndexState::Empty);
        assert!(p.scan_failed, "作れなかったことが旗に出ていない");
        assert_eq!(p.total_files, 0);
    }

    #[test]
    fn a_superseded_rescan_says_nothing() {
        // 据え直された回に何か出すと、**他人の索引の上に自分の代の旗が乗る**
        assert_eq!(
            payload(IndexUiState::Rescanned(RescanOutcome::Superseded), 7),
            None
        );
    }

    #[test]
    fn a_failed_scan_stays_ready_but_flags_that_nothing_was_applied() {
        // 索引は最後に読めたときのまま健全なので `Ready`。ただし旗を落とすと
        // 「未同期 0」が「最新」と読める
        let p = payload(IndexUiState::Rescanned(RescanOutcome::ScanFailed), 5)
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
            IndexUiState::Rescanned(RescanOutcome::Committed {
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

    #[test]
    fn a_clean_rescan_raises_no_flag() {
        let p = payload(
            IndexUiState::Rescanned(RescanOutcome::Committed {
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
            IndexUiState::Built {
                partially_unreadable: true,
            },
            3,
        )
        .expect("構築の完了は画面へ出す");
        assert_eq!(p.state, IndexState::Ready);
        assert!(p.partially_unreadable);
        assert_eq!((p.indexed_files, p.total_files), (3, 3));
    }
}
