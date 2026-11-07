//! 手順「探索」（`UsiProtocol::search`）と、探索1本の持ち分 `Search`。
//!
//! どの行をどの探索へ流すか、止めた後に何を待つかは状態機械（`usi_machine`）が決める。
//! ここは、その答えを `Search` と `StopAnswer` の形で呼び手へ渡す。

use std::time::Duration;

use tokio::sync::{mpsc, oneshot, watch};
use usi::ThinkParams;

use super::{refuse_breaking_field, Input, Request, Status, UsiProtocol, LOGT};
use crate::engine::types::EngineError;
pub use crate::engine::usi_machine::SearchLine;
#[cfg(test)]
use crate::engine::usi_machine::GONE;
use crate::engine::usi_machine::{closed_error, Asked, SearchId};

/// 止めたときの答え。**`stop` の後に何が起きたかを、ここで1つの値にする。**
///
/// 呼び手は、待つか・待った結果がどれかを自分で読まない（読むと、検討と対局で
/// 写しが2つになる。監査の D-1）。
#[derive(Debug)]
pub enum StopAnswer {
    /// `bestmove` で答えた。エンジンは待機に戻った。止める前に答えていた探索もここ
    /// （探索は `bestmove` か閉じることでしか終わらないので、閉じていなければ答え済み）
    Answered,
    /// 上限まで `bestmove` が来なかった。エンジンは止め待ちのまま残っている。
    /// 遅れて来る答えは中の `LateAnswer` で待てる
    Unanswered(LateAnswer),
    /// 届かない。`stop` を書けなかったか、待つ間に出力が終わった。
    ///
    /// 書き込みの上限（`WRITE_TIMEOUT`）を超えたときも `EngineError::Timeout` を持ってここへ来る。
    /// その時点で後続の書き込みは全部断られる（`fail_writes`）ので、そのプロセスへはもう届かない。
    /// 検討（`analyzer` の `stop_search`）は失敗と読み、止める頼みには「止まった」と答える
    /// （届かない理由は終わりの見張りが知らせる）。対局（`game/search.rs` の `outcome_after_stop`）は
    /// 「止めに答えない」と読んで `Activity::Unresponsive` へ移す（`gameover` を書かない）
    Unreachable(EngineError),
}

/// 前の探索の終わりを待つ上限。対局の止めの上限（`engine/game/search.rs` の `SEARCH_STOP_GRACE`）の倍以上に取る
/// （関係は `game/search.rs` の `waiting_for_the_previous_search_outlasts_a_stop` が固定する）。
///
/// 捨てた探索（`Search` の `Drop`）は `stop` を書くだけで、`bestmove` が来るまで状態機械は止め待ちに
/// 残り、次の探索を断る。手順「探索」は、断られる前にここまで待つ
pub const PREVIOUS_SEARCH_LIMIT: Duration = Duration::from_secs(10);

/// 探索1本の持ち分。手順「探索」（`UsiProtocol::search`）が返す。
///
/// できるのは4つだけ: 行を受ける（`next_line`）、先読みを本番にする（`ponderhit`）、
/// 止める（`stop`）、捨てる（`Drop`）。**止めずに捨てたら `stop` だけを書く。** 捨てた探索の
/// `bestmove` が来るまで状態機械は止め待ちに残るので、次の探索はその後でしか始まらず、
/// 前の探索の行を受けない。
///
/// 送る面（`UsiProtocol`）を持つので、持っている間は殻と子プロセスが生きる
pub struct Search {
    protocol: UsiProtocol,
    id: SearchId,
    lines: mpsc::UnboundedReceiver<SearchLine>,
    /// `bestmove` を受けた。以後は止めるものが無い
    answered: bool,
}

impl std::fmt::Debug for Search {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Search")
            .field("id", &self.id)
            .field("answered", &self.answered)
            .finish_non_exhaustive()
    }
}

impl Search {
    /// 殻が、状態機械へ探索を頼んだ直後に作る（`Shell::start_search`）
    pub(super) fn new(
        protocol: UsiProtocol,
        id: SearchId,
        lines: mpsc::UnboundedReceiver<SearchLine>,
    ) -> Self {
        Self {
            protocol,
            id,
            lines,
            answered: false,
        }
    }
}

impl UsiProtocol {
    /// 手順「探索」。`position` と `go`（`go ponder` を含む）を書き、探索1本の持ち分を返す。
    /// 待つのは書けたことだけ。
    ///
    /// **前の探索が終わるまで書かない。** 捨てた探索が `bestmove` を返すまで待ち
    /// （`PREVIOUS_SEARCH_LIMIT`）、過ぎたら状態機械が断る。`readyok` の前も断る（ADR-0016 決定3）。
    /// 線を壊す局面（改行入り）は、状態機械へ頼む前に断る（頼んでから断ると `go` だけが線に出る）。
    ///
    /// **`Search` は殻が状態機械へ頼んだ直後に作る**（`Shell::start_search`）。答えを受け取る前や、書けたかを
    /// 待つ間に future を捨てても、`Search` の `Drop` が `stop` を書くので、走り始めた探索が誰にも持たれずに
    /// 残らない。書けなかったときも同じ `Drop` を通る。詰まった回（W1）と落とした後は状態機械が閉じているので
    /// 何も書かず、それ以外（書き込みが失敗したがまだ出力が終わっていない回）は `stop` を書いて止め待ちになる
    pub async fn search(
        &self,
        position: String,
        params: ThinkParams,
    ) -> Result<Search, EngineError> {
        let mut status = self.handle.status.clone();
        let previous_ended = status.wait_for(|status| !status.searching || status.end.is_some());
        // 過ぎても待つのをやめるだけ。断るかは状態機械が決める
        match tokio::time::timeout(PREVIOUS_SEARCH_LIMIT, previous_ended).await {
            // 終わったか、写しの送り手が消えた（殻ごと抜けている）
            Ok(_) => {}
            Err(_) => log::warn!(
                target: LOGT,
                "search: the previous search did not end within {PREVIOUS_SEARCH_LIMIT:?}"
            ),
        }

        refuse_breaking_field("a position", &position)?;
        let (search, written) = self
            .handle
            .ask(|reply| Request::Search {
                position,
                params,
                reply,
            })
            .await?;
        self.handle.finish(written).await?;
        Ok(search)
    }
}

impl Search {
    /// 次の行を待つ。`bestmove` を返した後は `Ok(None)`。
    /// `bestmove` の前に閉じたら、閉じた写しを見てから届かない理由（`UsiProtocol::cannot_reach`）で断る。
    ///
    /// 取り消してよい（`select!` に置ける）。受けていない行は失われない
    pub async fn next_line(&mut self) -> Result<Option<SearchLine>, EngineError> {
        if self.answered {
            return Ok(None);
        }
        match self.lines.recv().await {
            Some(line) => {
                self.answered = matches!(line, SearchLine::BestMove(_));
                Ok(Some(line))
            }
            // 送り手が落ちるのは閉じたときだけ（`bestmove` の後は上で返る）。理由は閉じた写しから組む
            None => Err(self.protocol.handle.closed_reason().await),
        }
    }

    /// 先読みを本番にする（`ponderhit` を書く）。先読み中でない探索と、既に答えた探索では断る
    pub async fn ponderhit(&mut self) -> Result<(), EngineError> {
        let id = self.id;
        let handle = &self.protocol.handle;
        let ((), written) = handle.ask(|reply| Request::Ponderhit { id, reply }).await?;
        handle.finish(written).await
    }

    /// 止める。`stop` を書き、`bestmove` を `limit` まで待って答えを返す（`StopAnswer`）。
    ///
    /// **上限は呼び手が渡す**（検討と対局で違う）。上限まで待っても答えなければ `Unanswered` を返し、
    /// エンジンは止め待ちのまま残る。止めた探索の `info` は状態機械が捨てる。
    ///
    /// **出力の終わりを「答えない」に潰さない。** 潰すと、落ちたエンジンに
    /// 「`stop` に答えなかった」という説明が付き、次の手（起こし直す）が出ない。
    ///
    /// 途中で future を捨てても探索は残らない。`stop` を書く前なら `Drop` が書き、書いた後なら
    /// 状態機械が止め待ちのまま `bestmove` を待つ
    pub async fn stop(self, limit: Duration) -> StopAnswer {
        if self.answered {
            return StopAnswer::Answered;
        }
        let id = self.id;
        let handle = &self.protocol.handle;
        let (answer, mut answered) = oneshot::channel();
        let written = match handle
            .ask(|reply| Request::Stop { id, answer, reply })
            .await
        {
            Ok((Asked::Waiting(()), written)) => written,
            Ok((Asked::Done(()), _nothing_written)) => return StopAnswer::Answered,
            Err(e) => return StopAnswer::Unreachable(e),
        };
        let sent = handle.finish(written).await;
        log::debug!(target: LOGT, "search: stop -> {sent:?}");
        if let Err(e) = sent {
            return StopAnswer::Unreachable(e);
        }
        match tokio::time::timeout(limit, &mut answered).await {
            Ok(Ok(Ok(()))) => StopAnswer::Answered,
            Ok(Ok(Err(e))) => StopAnswer::Unreachable(e),
            Ok(Err(_)) => StopAnswer::Unreachable(handle.cannot_reach()),
            Err(_) => StopAnswer::Unanswered(LateAnswer {
                answer: answered,
                status: handle.status.clone(),
            }),
        }
    }
}

/// 止めに上限まで答えなかった探索の残り（`StopAnswer::Unanswered`）。
///
/// 答えを待っているのは状態機械で、持っている間も捨てた後も、遅れた `bestmove` が来るまで
/// このプロセスで次の探索は始まらない（止め待ちの状態機械が断る）。これは答えを受け取る札と状態の写しだけを
/// 持ち、**殻への送り手を持たない**（持っている間も、取っ手を全部捨てればプロセスは落ちる）
pub struct LateAnswer {
    answer: oneshot::Receiver<Result<(), EngineError>>,
    status: watch::Receiver<Status>,
}

impl std::fmt::Debug for LateAnswer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LateAnswer").finish_non_exhaustive()
    }
}

impl LateAnswer {
    /// 遅れて来る `bestmove` を待つ。来たら `Ok`。その前に閉じたら、届かない理由
    /// （`UsiProtocol::cannot_reach`）で断る。上限は持たない（落とせば閉じる）
    pub async fn wait(self) -> Result<(), EngineError> {
        match self.answer.await {
            Ok(answered) => answered,
            Err(_) => Err(closed_error(self.status.borrow().unreachable)),
        }
    }
}

impl Drop for Search {
    /// 答えの決まっていない探索なら `stop` だけを書くよう殻へ頼む（状態機械の R8。走っていなければ何もしない）。
    /// 送るだけで待たない。書けたかを待つ者は居ない（書けなければ書き込みの列が記録する）
    fn drop(&mut self) {
        if self.answered {
            return;
        }
        let id = self.id;
        // 殻が抜けていれば、プロセスごと落ちている
        let _ = self
            .protocol
            .handle
            .inputs
            .send(Input::Ask(Request::DropSearch { id }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use usi::{BestMoveParams, CheckmateParams, InfoParams};

    /// 実プロセスで確かめる
    #[cfg(unix)]
    mod with_a_process {
        use super::*;
        use crate::engine::protocol::script::spawn_protocol;
        use std::path::Path;
        use std::sync::Arc;

        /// 受けた行を `log` に書く。`go` には `info` を1行出して黙り、`stop` に `bestmove` で答える。
        /// `go byoyomi` にはすぐ答える
        const ANSWERS_STOP: &str = r#"while read line; do
  echo "$line" >> log
  case "$line" in
    usi) printf 'id name Search\nusiok\n' ;;
    isready) echo readyok ;;
    "go byoyomi"*) printf 'info depth 1 score cp 5 pv 7g7f\nbestmove 7g7f\n' ;;
    "go mate"*) printf 'checkmate nomate\n' ;;
    go*) echo 'info depth 1 score cp 10 pv 2g2f' ;;
    stop) echo 'bestmove 2g2f' ;;
  esac
done"#;

        /// `stop` に答えない
        const IGNORES_STOP: &str = r#"while read line; do
  echo "$line" >> log
  case "$line" in
    isready) echo readyok ;;
  esac
done"#;

        /// `stop` に1秒遅れて答える。答える直前に `log` へ `late` を残す
        const ANSWERS_STOP_LATE: &str = r#"while read line; do
  echo "$line" >> log
  case "$line" in
    isready) echo readyok ;;
    stop) (sleep 1; echo late >> log; echo 'bestmove 2g2f') & ;;
  esac
done"#;

        /// `stop` を受けたら終わる
        const EXITS_ON_STOP: &str = r#"while read line; do
  case "$line" in
    isready) echo readyok ;;
    stop) exit 0 ;;
  esac
done"#;

        async fn ready(dir: &Path, body: &str) -> Arc<UsiProtocol> {
            let protocol = Arc::new(spawn_protocol(dir, body).await);
            protocol.prepare(&[], None, None).await.expect("準備できる");
            protocol
        }

        fn logged(dir: &Path) -> Vec<String> {
            std::fs::read_to_string(dir.join("log"))
                .unwrap_or_default()
                .lines()
                .map(str::to_string)
                .collect()
        }

        async fn wait_logged(dir: &Path, line: &str) -> bool {
            for _ in 0..500 {
                if logged(dir).iter().any(|l| l == line) {
                    return true;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            false
        }

        fn startpos() -> String {
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1".to_string()
        }

        /// (Q3, L5) (Q3, L7): 行を着いた順に返し、`bestmove` の後は何も返さない
        #[tokio::test]
        async fn lines_come_in_order_and_end_at_bestmove() {
            let dir = test_support::dir::temp_dir("search-lines");
            let protocol = ready(&dir, ANSWERS_STOP).await;
            let mut search = protocol
                .search(
                    startpos(),
                    ThinkParams::new().byoyomi(Duration::from_secs(1)),
                )
                .await
                .expect("書ける");

            assert!(matches!(
                search.next_line().await,
                Ok(Some(SearchLine::Info(ref params))) if params.contains(&InfoParams::Pv(vec!["7g7f".to_string()]))
            ));
            assert!(matches!(
                search.next_line().await,
                Ok(Some(SearchLine::BestMove(BestMoveParams::MakeMove(ref m, None)))) if m == "7g7f"
            ));
            // 待たずに返る（`bestmove` の後の行を待ち続けない）
            let after = tokio::time::timeout(Duration::from_secs(1), search.next_line())
                .await
                .expect("`bestmove` の後も行を待っている");
            assert!(matches!(after, Ok(None)), "{after:?}");

            // (Q2, R7): 答えた探索を止めても `stop` は書かない
            assert!(matches!(
                search.stop(Duration::from_secs(1)).await,
                StopAnswer::Answered
            ));
            protocol.new_game().await.expect("書ける");
            assert!(wait_logged(&dir, "usinewgame").await);
            assert!(
                !logged(&dir).iter().any(|l| l == "stop"),
                "{:?}",
                logged(&dir)
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q3, L6): `checkmate` もその探索の行として返す。`bestmove` ではないので探索は続く
        #[tokio::test]
        async fn a_checkmate_line_is_passed_on() {
            let dir = test_support::dir::temp_dir("search-checkmate");
            let protocol = ready(&dir, ANSWERS_STOP).await;
            let mut search = protocol
                .search(
                    startpos(),
                    ThinkParams::new().mate(usi::MateParam::Infinite),
                )
                .await
                .expect("書ける");
            assert!(matches!(
                search.next_line().await,
                Ok(Some(SearchLine::Checkmate(CheckmateParams::NoMate)))
            ));
            // 答えていないので止められる（台本は `stop` に `bestmove` で答える）
            assert!(matches!(
                search.stop(Duration::from_secs(5)).await,
                StopAnswer::Answered
            ));
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q3, R7) (Q4, L7): 止めると `stop` を書き、`bestmove` を待って「答えた」を返す
        #[tokio::test]
        async fn a_stopped_search_answers() {
            let dir = test_support::dir::temp_dir("search-stop");
            let protocol = ready(&dir, ANSWERS_STOP).await;
            let mut search = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("書ける");
            assert!(matches!(
                search.next_line().await,
                Ok(Some(SearchLine::Info(_)))
            ));

            assert!(matches!(
                search.stop(Duration::from_secs(5)).await,
                StopAnswer::Answered
            ));
            assert_eq!(
                logged(&dir),
                [
                    "isready",
                    &format!("position sfen {}", startpos()),
                    "go infinite",
                    "stop"
                ]
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q4, L7 が来ない): 上限まで答えなければ「答えない」。上限で返る
        #[tokio::test]
        async fn a_stop_without_bestmove_is_unanswered_at_the_limit() {
            let dir = test_support::dir::temp_dir("search-unanswered");
            let protocol = ready(&dir, IGNORES_STOP).await;
            let search = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("書ける");

            let answer = tokio::time::timeout(
                Duration::from_secs(5),
                search.stop(Duration::from_millis(200)),
            )
            .await
            .expect("上限で返らない");
            assert!(matches!(answer, StopAnswer::Unanswered(_)), "{answer:?}");
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q4, L7): 上限の後に来た答えを `LateAnswer` で待てる。待つ間は次の探索を始めない。
        ///
        /// 始めると、遅れた `bestmove` が次の探索の答えとして読まれる
        #[tokio::test]
        async fn a_late_answer_can_be_waited_for_and_holds_back_the_next_search() {
            let dir = test_support::dir::temp_dir("search-late");
            let protocol = ready(&dir, ANSWERS_STOP_LATE).await;
            let search = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("書ける");
            let StopAnswer::Unanswered(late) = search.stop(Duration::from_millis(100)).await else {
                panic!("上限の前に答えたことになっている");
            };

            let next = tokio::time::timeout(
                Duration::from_millis(300),
                protocol.search(startpos(), ThinkParams::new().infinite()),
            )
            .await;
            // 上限で切れることだけを見る。内側が何であれ、返ったら誤り
            if let Ok(next) = next {
                panic!("遅れた答えを待つ間に次の探索を始めた: {next:?}");
            }

            tokio::time::timeout(Duration::from_secs(5), late.wait())
                .await
                .expect("遅れた答えで返らない")
                .expect("答えが来る");
            assert!(
                logged(&dir).iter().any(|l| l == "late"),
                "答えが来る前に返った: {:?}",
                logged(&dir)
            );

            let next = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("遅れた答えの後は次の探索を始められる");
            drop(next);
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q4, L8): 止めを待つ間に出力が終わったら「届かない」。「答えない」にしない
        #[tokio::test]
        async fn an_engine_that_exits_on_stop_is_unreachable() {
            let dir = test_support::dir::temp_dir("search-exits");
            let protocol = ready(&dir, EXITS_ON_STOP).await;
            let search = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("書ける");

            let answer = search.stop(Duration::from_secs(5)).await;
            assert!(
                matches!(
                    answer,
                    StopAnswer::Unreachable(EngineError::CommunicationFailed(_))
                ),
                "{answer:?}"
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q3, R8): 止めずに捨てると `stop` だけを書く
        #[tokio::test]
        async fn dropping_a_search_writes_stop() {
            let dir = test_support::dir::temp_dir("search-drop");
            let protocol = ready(&dir, ANSWERS_STOP).await;
            let search = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("書ける");
            drop(search);
            assert!(wait_logged(&dir, "stop").await, "{:?}", logged(&dir));
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 捨てた探索の `bestmove` は、直後に始めた探索へ届かない。次の探索の `position` は
        /// 捨てた探索の `stop` より後に書く（探索中のエンジンへ `position` を送らない）
        #[tokio::test]
        async fn a_search_started_after_a_dropped_one_does_not_take_its_bestmove() {
            let dir = test_support::dir::temp_dir("search-drop-then-search");
            let protocol = ready(&dir, ANSWERS_STOP).await;
            let first = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("書ける");
            drop(first);

            let mut second = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("書ける");
            // 台本は `go` に `info` を1行出して黙る。`bestmove` は自分で止めるまで来ない
            assert!(matches!(
                second.next_line().await,
                Ok(Some(SearchLine::Info(_)))
            ));
            let next = tokio::time::timeout(Duration::from_millis(300), second.next_line()).await;
            // 上限で切れることだけを見る。内側が何であれ、行が来たら誤り
            if let Ok(line) = next {
                panic!("止めていない探索が答えを受けた: {line:?}");
            }

            let position = format!("position sfen {}", startpos());
            assert_eq!(
                logged(&dir),
                [
                    "isready",
                    position.as_str(),
                    "go infinite",
                    "stop",
                    position.as_str(),
                    "go infinite"
                ]
            );
            assert!(matches!(
                second.stop(Duration::from_secs(5)).await,
                StopAnswer::Answered
            ));
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 手順「探索」を、書けたかを待つ途中で捨てても、走り始めた探索は残らない（`Search` の `Drop` が
        /// `stop` を書く）。残ると、次の探索が前の探索の終わりを上限まで待ってから断られる
        #[tokio::test]
        async fn a_search_dropped_while_writing_does_not_hold_the_engine() {
            let dir = test_support::dir::temp_dir("search-cancelled");
            let protocol = ready(&dir, ANSWERS_STOP).await;
            {
                let starting = protocol.search(startpos(), ThinkParams::new().infinite());
                tokio::pin!(starting);
                // 1回だけ進めて捨てる（状態機械へ頼み、書けたかを待つところで止まる）
                let polled = std::future::poll_fn(|cx| {
                    std::task::Poll::Ready(std::future::Future::poll(starting.as_mut(), cx))
                })
                .await;
                let std::task::Poll::Pending = polled else {
                    panic!("1回で返った: {polled:?}");
                };
            }
            assert!(wait_logged(&dir, "stop").await, "{:?}", logged(&dir));
            let next = tokio::time::timeout(
                Duration::from_secs(3),
                protocol.search(startpos(), ThinkParams::new().infinite()),
            )
            .await;
            let Ok(Ok(next)) = next else {
                panic!("捨てた探索の後の探索が始まらない: {next:?}");
            };
            drop(next);
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 線を壊す局面は、状態機械へ頼む前に断る。`go` だけが線に出て前の局面のまま探索が始まることは無い
        #[tokio::test]
        async fn a_position_that_breaks_the_line_writes_nothing() {
            let dir = test_support::dir::temp_dir("search-bad-position");
            let protocol = ready(&dir, ANSWERS_STOP).await;
            let refused = protocol
                .search("bad\nline".to_string(), ThinkParams::new().infinite())
                .await;
            assert!(
                matches!(refused, Err(EngineError::InvalidState(_))),
                "{refused:?}"
            );
            let search = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("断った後も探索できる");
            search.stop(Duration::from_secs(5)).await;
            let position = format!("position sfen {}", startpos());
            assert_eq!(
                logged(&dir),
                ["isready", position.as_str(), "go infinite", "stop"]
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q3, R11): 探索中に落とすと、行を待つ `Search` は落とした理由（`GONE`）で返る。
        /// 殻は探索の送り手を落とすのと閉じた写しを書くのを別々に行うので、写しを先に読むと
        /// 「出力が終わった」（`CLOSED`）で返りうる。**競合なので回数を取り、複数のスレッドで走らせる**
        #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
        async fn a_search_cut_by_the_kill_says_we_stopped_it() {
            for round in 0..20 {
                let dir = test_support::dir::temp_dir("search-killed");
                let protocol = ready(&dir, ANSWERS_STOP).await;
                let mut search = protocol
                    .search(startpos(), ThinkParams::new().infinite())
                    .await
                    .expect("書ける");
                assert!(matches!(
                    search.next_line().await,
                    Ok(Some(SearchLine::Info(_)))
                ));
                let (next, ()) = tokio::join!(search.next_line(), protocol.kill_engine());
                assert!(
                    matches!(&next, Err(EngineError::CommunicationFailed(detail)) if detail.to_string().contains(GONE)),
                    "{round} 回目: 落とした理由で返っていない: {next:?}"
                );
                let _ = std::fs::remove_dir_all(&dir);
            }
        }

        /// (Q3p, R6) (Q3, R6): `ponderhit` を書けるのは先読みの探索だけ。書いた後は本番の探索
        #[tokio::test]
        async fn only_a_ponder_search_takes_ponderhit() {
            let dir = test_support::dir::temp_dir("search-ponderhit");
            let protocol = ready(&dir, ANSWERS_STOP).await;

            let mut search = protocol
                .search(startpos(), ThinkParams::new().infinite())
                .await
                .expect("書ける");
            assert!(matches!(
                search.ponderhit().await,
                Err(EngineError::InvalidState(_))
            ));
            search.stop(Duration::from_secs(5)).await;

            let mut pondering = protocol
                .search(startpos(), ThinkParams::new().ponder().infinite())
                .await
                .expect("書ける");
            pondering.ponderhit().await.expect("書ける");
            assert!(wait_logged(&dir, "ponderhit").await, "{:?}", logged(&dir));
            // 2回目は本番の探索なので断る
            assert!(matches!(
                pondering.ponderhit().await,
                Err(EngineError::InvalidState(_))
            ));
            pondering.stop(Duration::from_secs(5)).await;
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
