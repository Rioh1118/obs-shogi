//! 手順「探索」（`UsiProtocol::search`）と、探索1本の持ち分 `Search`。
//!
//! どの探索の `bestmove` かを決める判断のうち、止めた後に待つか・待った結果をどう読むかを
//! ここ1か所に置く（`answer_without_waiting` と `Search::stop`）。
//! 中身は、いまの受け手の登録と `send_command` の上に載せてある（ADR-0016 決定8 の U1）。

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, OwnedSemaphorePermit};
use usi::{BestMoveParams, CheckmateParams, EngineCommand, GuiCommand, InfoParams, ThinkParams};

use super::{StopEffect, UsiProtocol, LOGT};
use crate::engine::types::EngineError;

/// 探索1本が受ける行。生の USI の形のまま渡す（畳み方は呼び手が `apply_info_params` で決める）
#[derive(Debug)]
pub enum SearchLine {
    Info(Vec<InfoParams>),
    Checkmate(CheckmateParams),
    /// 最後の行。この後 `next_line` は何も返さない。
    /// 手を本番で読むのは、対局が移る U2b から（検討は手を使わない）
    BestMove(#[cfg_attr(not(test), allow(dead_code))] BestMoveParams),
}

/// 止めたときの答え。**`stop` の後に何が起きたかを、ここで1つの値にする。**
///
/// 呼び手は、待つか・待った結果がどれかを自分で読まない（読むと、検討と対局で
/// 写しが2つになる。監査の D-1）。
#[derive(Debug)]
pub enum StopAnswer {
    /// `bestmove` で答えた。エンジンは待機に戻った。止める前に答えていた探索もここ
    Answered,
    /// 止めるものが無かった。まだ書いていない `go` を落とした（`StopEffect::CancelledQueued`）。
    /// エンジンは探索を始めていない
    NothingToStop,
    /// 上限まで `bestmove` が来なかった。エンジンは止め待ちのまま残っている。
    /// 遅れて来る答えは中の `LateAnswer` で待てる
    Unanswered(LateAnswer),
    /// 届かない。`stop` を書けなかったか、待つ間に出力が終わった。
    ///
    /// 書き込みの上限（`WRITE_TIMEOUT`）を超えたときも `EngineError::Timeout` を持ってここへ来る。
    /// その時点で後続の書き込みは全部断られる（`fail_writes`）ので、そのプロセスへはもう届かない。
    /// 検討（`analyzer` の `stop_search`）は失敗と読み、止める頼みには「止まった」と答える
    /// （届かない理由は終わりの見張りが知らせる）。対局（`outcome_of_stop`）は「止めに答えない」と
    /// 読んで `Activity::Unresponsive` へ移す。どちらへ揃えるかは対局が移る U2b で決める
    Unreachable(EngineError),
}

/// `stop` を頼んだ結果から、待たずに答えが決まるか。`None` なら書けたので `bestmove` を待つ。
///
/// **「待たなくてよい」を「書けた」に潰さない。** 潰すと上限まで待ち、来ない `bestmove` の後に
/// 「エンジンが `stop` に答えなかった」という説明が付く。
fn answer_without_waiting(sent: Result<StopEffect, EngineError>) -> Option<StopAnswer> {
    match sent {
        Ok(StopEffect::Written) => None,
        Ok(StopEffect::CancelledQueued) => Some(StopAnswer::NothingToStop),
        Err(e) => Some(StopAnswer::Unreachable(e)),
    }
}

/// 止めずに捨てた探索の `bestmove` を待つ上限。対局の止めの上限（5秒）と同じ長さに取る。
///
/// 待つ間は次の探索を始めさせない（`UsiProtocol::search_slot`）。待たずに受け手を外すと、
/// 捨てた探索の `bestmove` が次の探索の受け手へ届き、次の探索の答えとして読まれる
const DROPPED_SEARCH_LIMIT: Duration = Duration::from_secs(5);

/// 探索1本の持ち分。手順「探索」（`UsiProtocol::search`）が返す。
///
/// できるのは4つだけ: 行を受ける（`next_line`）、先読みを本番にする（`ponderhit`）、
/// 止める（`stop`）、捨てる（`Drop`）。**止めずに捨てたら `stop` を書き、`bestmove` を
/// 上限まで受けてから枠を返す。** 次の探索は枠が返るまで始まらないので、前の探索の行を受けない。
///
/// 止めに上限まで答えなかった探索の枠は、`LateAnswer` を持っている間は返さない。
/// `LateAnswer` を捨てたときと、捨てた探索が上限を過ぎたときは返すので、その後に遅れて来た
/// `bestmove` は次の探索へ届きうる。止め待ちのエンジンに次の探索を頼まないのは、
/// いまは呼び手が守る（検討の `unanswered`、対局の `Activity::Unresponsive`）
pub struct Search {
    protocol: Arc<UsiProtocol>,
    /// 受け手の登録名。`Drop` で外す
    listener: String,
    lines: mpsc::UnboundedReceiver<EngineCommand>,
    /// 1本のプロセスで探索を1本に保つ枠。受け手を外した後に返す
    slot: Option<OwnedSemaphorePermit>,
    /// `go ponder` で始めて、まだ `ponderhit` を書いていない
    pondering: bool,
    /// `bestmove` を受けた。以後は止めるものが無い
    answered: bool,
    /// `stop` を書き終えた（または書けないと分かった）。`Drop` で書き直さない
    stop_sent: bool,
    /// 答えが決まった（`stop` が返った）か、`go` を書けなかった。`Drop` で待たない
    finished: bool,
}

impl std::fmt::Debug for Search {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Search")
            .field("listener", &self.listener)
            .field("pondering", &self.pondering)
            .field("answered", &self.answered)
            .field("stop_sent", &self.stop_sent)
            .field("finished", &self.finished)
            .finish_non_exhaustive()
    }
}

impl UsiProtocol {
    /// 手順「探索」。`position` と `go`（`go ponder` を含む）を書き、探索1本の持ち分を返す。
    /// 待つのは書けたことだけ。
    ///
    /// **前の探索の枠が返るまで書かない。** 捨てた探索が `bestmove` を返すまで待つ
    /// （`DROPPED_SEARCH_LIMIT`）。前の `Search` を握ったまま呼ぶと上限の後に断る。
    /// 受け手は書く前に張る。後に張ると、すぐ答えるエンジンの `bestmove` を取りこぼす。
    /// `position` か `go` を書けなかったら、`stop` を書かずに受け手を外して断る
    pub async fn search(
        self: &Arc<Self>,
        position: String,
        params: ThinkParams,
    ) -> Result<Search, EngineError> {
        let go = GuiCommand::Go(params);
        // 先読みかどうかは `ThinkParams` から読めない（欄が非公開）。線に出る1行で見る
        let pondering = go.to_string().starts_with("go ponder");

        let waited = tokio::time::timeout(
            DROPPED_SEARCH_LIMIT * 2,
            Arc::clone(&self.search_slot).acquire_owned(),
        )
        .await;
        let Ok(Ok(slot)) = waited else {
            return Err(EngineError::InvalidState(
                "the previous search on this engine has not ended".to_string(),
            ));
        };

        let (tx, lines) = mpsc::unbounded_channel();
        let listener = format!("search_{}", uuid::Uuid::new_v4());
        self.register_listener(listener.clone(), tx).await?;
        let mut search = Search {
            protocol: Arc::clone(self),
            listener,
            lines,
            slot: Some(slot),
            pondering,
            answered: false,
            stop_sent: false,
            finished: false,
        };

        let sent = match self.send_command(&GuiCommand::Position(position)).await {
            Ok(()) => self.send_command(&go).await,
            Err(e) => Err(e),
        };
        if let Err(e) = sent {
            search.finished = true;
            return Err(e);
        }
        Ok(search)
    }
}

impl Search {
    /// 次の行を待つ。`bestmove` を返した後は `Ok(None)`。
    /// `bestmove` の前に出力が終わったら、届かない理由（`UsiProtocol::cannot_reach`）で断る。
    ///
    /// 取り消してよい（`select!` に置ける）。受けていない行は失われない
    pub async fn next_line(&mut self) -> Result<Option<SearchLine>, EngineError> {
        if self.answered {
            return Ok(None);
        }
        let line = next_search_line(&mut self.lines).await;
        match line {
            Some(line) => {
                self.answered = matches!(line, SearchLine::BestMove(_));
                Ok(Some(line))
            }
            None => Err(self.protocol.cannot_reach()),
        }
    }

    /// 先読みを本番にする（`ponderhit` を書く）。先読みでない探索と、既に答えた探索では断る。
    ///
    /// 本番の呼び手は、対局が移る U2b まで無い（検討は先読みをしない）
    #[cfg_attr(not(test), allow(dead_code))]
    pub async fn ponderhit(&mut self) -> Result<(), EngineError> {
        if !self.pondering || self.answered {
            return Err(EngineError::InvalidState(
                "ponderhit is only for a ponder search that has not answered".to_string(),
            ));
        }
        self.protocol.send_command(&GuiCommand::Ponderhit).await?;
        self.pondering = false;
        Ok(())
    }

    /// 止める。`stop` を書き、`bestmove` を `limit` まで待って答えを返す（`StopAnswer`）。
    ///
    /// **上限は呼び手が渡す**（検討と対局で違う）。上限まで待っても答えなければ `Unanswered` を返し、
    /// エンジンは止め待ちのまま残る。止めた探索の `info` は捨てる。
    ///
    /// **出力の終わりを「答えない」に潰さない。** 潰すと、落ちたエンジンに
    /// 「`stop` に答えなかった」という説明が付き、次の手（起こし直す）が出ない。
    ///
    /// 途中で future を捨てても探索は残らない。`stop` を書く前なら `Drop` が書き、書いた後なら
    /// `Drop` が `bestmove` を待つ
    pub async fn stop(mut self, limit: Duration) -> StopAnswer {
        if self.answered {
            self.finished = true;
            return StopAnswer::Answered;
        }
        let sent = self.protocol.stop().await;
        self.stop_sent = true;
        log::debug!(target: LOGT, "search: stop -> {sent:?}");
        if let Some(answer) = answer_without_waiting(sent) {
            self.finished = true;
            return answer;
        }
        let waited = tokio::time::timeout(limit, self.until_bestmove()).await;
        self.finished = true;
        match waited {
            Ok(Ok(())) => StopAnswer::Answered,
            Ok(Err(e)) => StopAnswer::Unreachable(e),
            Err(_) => StopAnswer::Unanswered(LateAnswer(self)),
        }
    }

    async fn until_bestmove(&mut self) -> Result<(), EngineError> {
        while let Some(line) = self.next_line().await? {
            if matches!(line, SearchLine::BestMove(_)) {
                return Ok(());
            }
        }
        Ok(())
    }
}

/// 止めに上限まで答えなかった探索の残り（`StopAnswer::Unanswered`）。
///
/// **持っている間は、このプロセスで次の探索を始めさせない**（探索の枠を握る）。
/// 遅れた `bestmove` の前に次の `go` を書くと、その `bestmove` が次の探索の答えとして読まれる
#[derive(Debug)]
pub struct LateAnswer(Search);

impl LateAnswer {
    /// 遅れて来る `bestmove` を待つ。来たら `Ok`。その前に出力が終わったら、届かない理由
    /// （`UsiProtocol::cannot_reach`）で断る。上限は持たない（落とせば出力が終わる）
    pub async fn wait(mut self) -> Result<(), EngineError> {
        self.0.until_bestmove().await
    }
}

/// 探索の行だけを取り出す。出力が終わったら `None`
async fn next_search_line(
    lines: &mut mpsc::UnboundedReceiver<EngineCommand>,
) -> Option<SearchLine> {
    loop {
        match lines.recv().await? {
            EngineCommand::Info(params) => return Some(SearchLine::Info(params)),
            EngineCommand::Checkmate(params) => return Some(SearchLine::Checkmate(params)),
            EngineCommand::BestMove(params) => return Some(SearchLine::BestMove(params)),
            _ => continue,
        }
    }
}

impl Drop for Search {
    /// 答えの決まっていない探索なら、`stop` を書き（まだなら）、`bestmove` を上限まで受ける。
    /// その後で受け手を外し、枠を返す。どれも await が要るので、取っ手の持つ実行環境へ渡す
    fn drop(&mut self) {
        let protocol = Arc::clone(&self.protocol);
        let listener = std::mem::take(&mut self.listener);
        let (_, closed) = mpsc::unbounded_channel();
        let mut lines = std::mem::replace(&mut self.lines, closed);
        let slot = self.slot.take();
        let unsettled = !self.finished && !self.answered;
        let write_stop = unsettled && !self.stop_sent;
        let runtime = protocol.runtime_handle.clone();
        runtime.spawn(async move {
            let mut wait = unsettled;
            if write_stop {
                let sent = protocol.stop().await;
                log::debug!(target: LOGT, "search: dropped; stop -> {sent:?}");
                wait = answer_without_waiting(sent).is_none();
            }
            if wait {
                let answered = tokio::time::timeout(DROPPED_SEARCH_LIMIT, async {
                    while let Some(line) = next_search_line(&mut lines).await {
                        if matches!(line, SearchLine::BestMove(_)) {
                            return;
                        }
                    }
                })
                .await;
                if answered.is_err() {
                    log::warn!(target: LOGT, "search: dropped; no bestmove within the limit");
                }
            }
            protocol.remove_listener(&listener).await;
            drop(slot);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn closed() -> EngineError {
        EngineError::CommunicationFailed("closed".into())
    }

    /// 止めを頼んだ結果の全通り。書けたときだけ待つ
    #[test]
    fn only_a_written_stop_is_waited_for() {
        assert!(answer_without_waiting(Ok(StopEffect::Written)).is_none());
        assert!(matches!(
            answer_without_waiting(Ok(StopEffect::CancelledQueued)),
            Some(StopAnswer::NothingToStop)
        ));
        // 送る先が無い。**探索中とは限らないので `Unanswered` にしない**
        assert!(matches!(
            answer_without_waiting(Err(closed())),
            Some(StopAnswer::Unreachable(EngineError::CommunicationFailed(_)))
        ));
        // 書き込みの上限を超えた。後続は全部断られるので、届かない側
        assert!(matches!(
            answer_without_waiting(Err(EngineError::Timeout("blocked".to_string()))),
            Some(StopAnswer::Unreachable(EngineError::Timeout(_)))
        ));
    }

    /// 実プロセスで確かめる
    #[cfg(unix)]
    mod with_a_process {
        use super::*;
        use crate::engine::protocol::script::spawn_protocol;
        use std::path::Path;

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
