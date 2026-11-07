//! 1回の `go` を最後まで見届けるタスク。
//!
//! 探索は手順「探索」（`UsiProtocol::search`）が返す `Search` で回し、受け手の登録は持たない。
//! 止めた後に待つか・待った結果をどう読むかは `Search::stop` が決めて `StopAnswer` で返し、
//! ここはそれを対局の終わり方（`SearchOutcome`）へ写すだけ（`outcome_after_stop`）。
//!
//! 止めた探索の `bestmove` を着手に採らないのは `session.rs` の `Activity::Stopping` と、
//! 下の `StopTimedOut`。

use std::time::Duration;

use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use usi::{BestMoveParams, ThinkParams};

use crate::engine::candidates::apply_info_params;
use crate::engine::protocol::search::{SearchLine, StopAnswer};
use crate::engine::protocol::UsiProtocol;
use crate::engine::types::{AnalysisResult, EngineError};

use super::types::Side;

const LOGT: &str = "obs_shogi::engine::game::search";

/// `stop` を送ってから、捨てる `bestmove` を待つ上限。
///
/// 待つのは礼儀ではなく必要。USI は探索中の `position` / `go` を認めないので、
/// 次の思考を始める前にエンジンを idle に戻さないといけない。
pub(super) const SEARCH_STOP_GRACE: Duration = Duration::from_secs(5);

/// 1回の探索がどう終わったか。
#[derive(Debug, Clone)]
pub enum SearchOutcome {
    Move {
        usi: String,
        /// エンジンが「次はこう来る」と付けてきた手。先読みに使う
        ponder: Option<String>,
    },
    Resign,
    /// `bestmove win`（入玉宣言）
    DeclareWin,
    /// 打ち切って、捨てる `bestmove` も受け取れた。エンジンは idle に戻っている。
    ///
    /// **`GameOverReason::Aborted` と名前を分けてある。** あちらは
    /// 「勝敗なしで対局が終わった」で、こちらは「探索が正常に止まった」。
    /// 意味が正反対なのに `on_search_outcome` の中で同居する
    StoppedCleanly,
    /// **`stop` を送っても `bestmove` が返らなかった。**
    ///
    /// エンジンはまだ探索中で、遅れた `bestmove` が来るまで次の探索は断られる
    /// （状態機械の止め待ち）。話し続けてはいけない。
    ///
    /// `stop` の書き込みが上限を超えたときもここ（`outcome_after_stop`）
    StopTimedOut,
    /// **探索が終わったか、そもそも始められなかったか。**
    ///
    /// 産地は3つ——探索を始められなかった（`UsiProtocol::search` の断り）、
    /// `bestmove` の前に出力が終わった、`stop` が届かなかった。
    /// **「プロセスが死んだ」ではない**（`position` / `go` の送信が `WRITE_TIMEOUT` で
    /// 切れた場合、その手は後から届きうる）。
    ///
    /// `String` は外来（`EngineError` の文言）。`finish` が `MAX_DETAIL_LEN` で
    /// 切るまで無検査で、切った後は `Over` イベントと棋譜に残る。
    Failed(String),
}

/// 探索の種類。`go` と `go ponder` を分ける。
#[derive(Debug, Clone)]
pub enum SearchKind {
    /// 自分の手番の思考。`bestmove` を着手として採る
    Search,
    /// 相手の手番の先読み。`ponder_move` が実際に指されたら `ponderhit`
    Ponder { ponder_move: String },
}

/// 1回の探索に渡すもの。**組むのは `GameSession`、走らせるのは `run_search`。**
///
/// `req` は同じ側の何本目かで、**古い探索の結果を捨てるための鍵**。
/// 局面と `go` のパラメータは組んだ時点の値で、走り出した後は変わらない。
pub struct SearchRequest {
    pub protocol: UsiProtocol,
    pub side: Side,
    pub req: u64,
    /// `position sfen` の後ろに続ける文字列
    pub position: String,
    /// `go` に載せる時間と `ponder`。**先読みかどうかはここにしか無い。**
    ///
    /// 別に `bool` で持たない。持つと、`ponderhit` で本番へ昇格したときに
    /// 片方だけ古いままになる（このタスクは起動時の値を握って走る）。
    pub params: ThinkParams,
    pub cancel: CancellationToken,
    /// 先読みの探索にだけ渡す、`ponderhit` の頼みの受け取り側。頼む側は `PonderHit`
    pub ponderhit: Option<PonderHitAsks>,
}

/// `ponderhit` を書いた結果の送り手。探索のタスクが答える
type PonderHitReply = oneshot::Sender<Result<(), EngineError>>;

/// 先読みの探索が受ける `ponderhit` の頼み。1本の探索につき高々1回
pub type PonderHitAsks = oneshot::Receiver<PonderHitReply>;

/// 先読みの探索へ「当たった」と伝える取っ手。**`Search` は探索のタスクが握っているので、
/// `ponderhit` はタスクに書いてもらう。** 1本の探索につき1回だけ使える（`self` を消費する）。
pub struct PonderHit(oneshot::Sender<PonderHitReply>);

impl PonderHit {
    /// 頼む側と受け取り側の組を作る。受け取り側は `SearchRequest::ponderhit` に渡す
    pub fn pair() -> (Self, PonderHitAsks) {
        let (ask, asks) = oneshot::channel();
        (Self(ask), asks)
    }

    /// `ponderhit` を書いてもらい、書けたかを返す。
    ///
    /// **探索のタスクが既に居なければ `Ok` を返す。** タスクが戻るのは答え（`bestmove`）か
    /// 失敗を `SearchMessage::Outcome` に出した後なので、その答えは同じ `req` で後から届く。
    /// 断りにすると、先読みのまま答えた手（当たった局面の手）を捨てて考え直させることになる
    pub async fn send(self) -> Result<(), EngineError> {
        let (reply, answer) = oneshot::channel();
        if self.0.send(reply).is_err() {
            return Ok(());
        }
        answer.await.unwrap_or(Ok(()))
    }
}

/// 探索タスクからセッションへ返す出来事。
pub enum SearchMessage {
    Info {
        side: Side,
        /// どの `go` に対する読み筋か。
        ///
        /// **`Outcome` と同じく世代を持つ。** 持たないと、打ち切った探索が
        /// cancel と同時に吐いた `info` が新しい手番の読み筋として流れる。
        /// 盤に無い局面（外れた先読み手を指した後）の評価値が一瞬出る。
        req: u64,
        result: AnalysisResult,
    },
    Outcome {
        side: Side,
        req: u64,
        outcome: SearchOutcome,
    },
}

/// `position` と `go` を送り、`bestmove` まで見届けて `tx` へ流す。
///
/// **戻り値を持たない。** 起きたことは全部 `SearchMessage` として `tx` に出る
/// （`Info` を0回以上、最後に `Outcome` を1回）。`tx` の受け手が消えていれば黙って捨てられる。
///
/// **`Idle` の側にだけ呼ぶこと。** 前の探索が終わる前に重ねると、`UsiProtocol::search` が
/// 前の探索の終わりを上限まで待ってから断り、`Failed` で対局が終わる。止めに答えなかった探索
/// （`outcome_after_stop` が `LateAnswer` を捨てる）に重ねても、遅れた `bestmove` が来るまで同じく断られる。
/// 呼ぶ箇所を `GameSession::spawn_search` の1本に絞ってあるのはそのため。
///
/// 取り消しは `request.cancel`。**落とすのではなく止める**（`Search::stop`）ので、
/// 捨てる `bestmove` を `SEARCH_STOP_GRACE` まで待つ間はこの関数は返らない。
pub async fn run_search(request: SearchRequest, tx: mpsc::UnboundedSender<SearchMessage>) {
    let SearchRequest {
        protocol,
        side,
        req,
        position,
        params,
        cancel,
        mut ponderhit,
    } = request;
    let report = |outcome: SearchOutcome| {
        let _ = tx.send(SearchMessage::Outcome { side, req, outcome });
    };

    let mut search = match protocol.search(position, params).await {
        Ok(search) => search,
        Err(e) => {
            report(SearchOutcome::Failed(format!(
                "failed to start the search: {e}"
            )));
            return;
        }
    };

    // **黙ったエンジンの番人はここに置かない。** このタスクは起動時の値を
    // 握ったまま走るので、`ponderhit` で先読みから本番へ昇格したことを
    // 観測できない。見張るのは `session.rs` の `on_tick`（判定は `stall.rs` の `stalled_turn`）で、
    // 打ち切りは `cancel` を通ってここへ届く。
    let mut result = AnalysisResult::default();
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            reply = next_ponderhit(&mut ponderhit) => {
                let _ = reply.send(search.ponderhit().await);
            }
            line = search.next_line() => match line {
                Ok(Some(SearchLine::Info(params))) => {
                    apply_info_params(&params, &mut result);
                    // **ここで間引かない。** このタスクは起動時の `ponder` を握ったまま
                    // 走るので、`ponderhit` で本番へ昇格しても先読み扱いのまま。
                    // 間引くと、先読みが当たった手番だけ読み筋が1行も出ない
                    // （当たる率はエンジンが強いほど高い）。
                    // 落とす判断は `on_search_info` の `is_to_move` 1本に寄せてある
                    let _ = tx.send(SearchMessage::Info {
                        side,
                        req,
                        result: result.clone(),
                    });
                }
                Ok(Some(SearchLine::BestMove(params))) => {
                    report(outcome_of(params));
                    return;
                }
                Ok(Some(SearchLine::Checkmate(_))) => {}
                // `bestmove` の後にしか `None` は来ない。上の腕で戻っているので、来たら出力の終わりと同じに読む
                Ok(None) | Err(_) => {
                    report(SearchOutcome::Failed("engine stopped responding".to_string()));
                    return;
                }
            },
        }
    }

    let answer = search.stop(SEARCH_STOP_GRACE).await;
    if let StopAnswer::Unanswered(_) = &answer {
        log::warn!(target: LOGT, "stop: no bestmove within grace side={side:?} req={req}");
    } else {
        log::debug!(target: LOGT, "stop: side={side:?} req={req} answer={answer:?}");
    }
    report(outcome_after_stop(answer));
}

/// 次の `ponderhit` の頼みを待つ。受け取り側が無いか、`PonderHit` が捨てられたら返らない
async fn next_ponderhit(asks: &mut Option<PonderHitAsks>) -> PonderHitReply {
    if let Some(waiting) = asks.as_mut() {
        let asked = waiting.await;
        *asks = None;
        if let Ok(reply) = asked {
            return reply;
        }
    }
    std::future::pending().await
}

/// 止めた答えを、探索の終わり方へ写す。止めた後に待つか・待った結果がどれかは読まない
/// （それは `Search::stop` が決める。写しを持つと、検討と対局で判断が2つになる）。
///
/// 止めに答えた・まだ探索中・届かない、の3つは、次にできることが違うので同じ値にしない。
/// とくに出力の終わりを `StopTimedOut` に潰すと、落ちたエンジンに「stop に応じなかった」という
/// 説明が付く。
///
/// **`stop` の書き込みが上限を超えた（`Unreachable(EngineError::Timeout)`）は `StopTimedOut`。**
/// stdin を読んでいないエンジンは探索中とみなし、`gameover` を書かずに畳む（`Activity::Unresponsive`）。
/// 検討は同じ答えを失敗と読むが、対局は「止めに答えない」と説明する。その後の書き込みは全部断られる
/// （`fail_writes`）ので、`Failed` にして `gameover` を書きに行っても届かない
fn outcome_after_stop(answer: StopAnswer) -> SearchOutcome {
    match answer {
        // 止めに答えた。止める前に答えていた探索もここ
        StopAnswer::Answered => SearchOutcome::StoppedCleanly,
        // 上限まで答えなかった。エンジンは探索中とみなす
        StopAnswer::Unanswered(_) => SearchOutcome::StopTimedOut,
        StopAnswer::Unreachable(EngineError::Timeout(_)) => SearchOutcome::StopTimedOut,
        // 送る先が無いか、待つ間に出力が終わった。探索中とは限らない
        StopAnswer::Unreachable(e) => {
            SearchOutcome::Failed(format!("could not stop the search: {e}"))
        }
    }
}

fn outcome_of(params: BestMoveParams) -> SearchOutcome {
    match params {
        BestMoveParams::MakeMove(usi, ponder) => SearchOutcome::Move { usi, ponder },
        BestMoveParams::Resign => SearchOutcome::Resign,
        BestMoveParams::Win => SearchOutcome::DeclareWin,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 止めた答えの写し方。**待ちの上限切れ（`Unanswered`）は `LateAnswer` を作るのに
    /// 実プロセスが要るので、`session.rs` の `an_engine_that_ignores_stop_loses_and_gets_no_gameover`（T4）が持つ**
    #[test]
    fn a_stop_answer_does_not_collapse_its_endings() {
        // 止めに答えた。エンジンは待機に戻っている
        assert!(matches!(
            outcome_after_stop(StopAnswer::Answered),
            SearchOutcome::StoppedCleanly
        ));
        // 送る先が無いか、出力が終わった。**探索中とは限らないので `StopTimedOut` にしない**
        let closed = EngineError::CommunicationFailed("closed".to_string().into());
        assert!(matches!(
            outcome_after_stop(StopAnswer::Unreachable(closed)),
            SearchOutcome::Failed(_)
        ));
    }

    /// 手順「探索」が前の探索の終わりを待つ上限は、対局の止めの上限の倍以上。
    /// 短いと、止めに答えるのが遅いだけのエンジンで次の探索が断られ、対局が `Failed` で終わる
    #[test]
    fn waiting_for_the_previous_search_outlasts_a_stop() {
        use crate::engine::protocol::search::PREVIOUS_SEARCH_LIMIT;
        assert!(
            PREVIOUS_SEARCH_LIMIT >= SEARCH_STOP_GRACE * 2,
            "前の探索を待つ上限({PREVIOUS_SEARCH_LIMIT:?})が止めの上限({SEARCH_STOP_GRACE:?})の倍より短い"
        );
    }

    /// `stop` の書き込みが上限を超えたら、対局は「止めに答えない」と読む。
    ///
    /// **`Failed` にすると `Activity::Idle` に戻り、`finish` が stdin を読まないエンジンへ
    /// `gameover` を書きに行く。** 説明も「止めに答えない」から送信の失敗の文言に変わる
    #[test]
    fn a_stop_that_could_not_be_written_in_time_is_an_unanswered_stop() {
        let blocked = EngineError::Timeout("blocked".to_string());
        assert!(matches!(
            outcome_after_stop(StopAnswer::Unreachable(blocked)),
            SearchOutcome::StopTimedOut
        ));
    }
}
