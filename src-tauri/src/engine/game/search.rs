//! 1回の `go` を最後まで見届けるタスク。
//!
//! **`go` ごとにリスナーを作って、終わったら外す。** 使い回すと、打ち切った
//! 探索の `bestmove` が次の探索のものとして届く。届いた先で世代を照合するより、
//! そもそも届かないようにするほうが穴が少ない。

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use usi::{BestMoveParams, EngineCommand, GuiCommand, ThinkParams};

use crate::engine::protocol::UsiProtocol;
use crate::engine::types::AnalysisResult;
use crate::engine::utils::apply_info_params;

use super::types::Side;

const LOGT: &str = "obs_shogi::engine::game::search";

/// `stop` を送ってから、捨てる `bestmove` を待つ上限。
///
/// 待つのは礼儀ではなく必要。USI は探索中の `position` / `go` を認めないので、
/// 次の思考を始める前にエンジンを idle に戻さないといけない。
const STOP_GRACE: Duration = Duration::from_secs(5);

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
    /// 打ち切られた。着手として採らない
    Aborted,
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

pub struct SearchRequest {
    pub protocol: Arc<UsiProtocol>,
    pub side: Side,
    pub req: u64,
    /// `position sfen` の後ろに続ける文字列
    pub position: String,
    pub params: ThinkParams,
    pub ponder: bool,
    pub cancel: CancellationToken,
}

/// 探索タスクからセッションへ返す出来事。
pub enum SearchMessage {
    Info {
        side: Side,
        result: AnalysisResult,
    },
    Outcome {
        side: Side,
        req: u64,
        outcome: SearchOutcome,
    },
}

pub async fn run_search(request: SearchRequest, tx: mpsc::UnboundedSender<SearchMessage>) {
    let SearchRequest {
        protocol,
        side,
        req,
        position,
        params,
        ponder,
        cancel,
    } = request;

    let listener = format!("game_search_{:?}_{}", side, req);
    let (raw_tx, mut raw_rx) = mpsc::unbounded_channel();

    if let Err(e) = protocol.register_listener(listener.clone(), raw_tx).await {
        let _ = tx.send(SearchMessage::Outcome {
            side,
            req,
            outcome: SearchOutcome::Failed(format!("failed to listen to engine: {e}")),
        });
        return;
    }

    let sent = async {
        protocol
            .send_command(&GuiCommand::Position(position))
            .await?;
        protocol.send_command(&GuiCommand::Go(params)).await
    }
    .await;

    if let Err(e) = sent {
        protocol.remove_listener(&listener).await;
        let _ = tx.send(SearchMessage::Outcome {
            side,
            req,
            outcome: SearchOutcome::Failed(format!("failed to send go: {e}")),
        });
        return;
    }

    // 第1相: `bestmove` が来るか、打ち切られるかのどちらか。
    let mut settled: Option<SearchOutcome> = None;
    let mut result = AnalysisResult::default();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            command = raw_rx.recv() => match command {
                Some(EngineCommand::Info(params)) => {
                    apply_info_params(&params, &mut result);
                    // 先読み中の読み筋は相手の手番の画面に出てしまうので流さない
                    if !ponder {
                        let _ = tx.send(SearchMessage::Info { side, result: result.clone() });
                    }
                }
                Some(EngineCommand::BestMove(params)) => {
                    settled = Some(outcome_of(params));
                    break;
                }
                Some(_) => {}
                None => {
                    settled = Some(SearchOutcome::Failed(
                        "engine stopped responding".to_string(),
                    ));
                    break;
                }
            },
        }
    }

    // 第2相: 打ち切られたなら `stop` を送り、捨てる `bestmove` を待ってから戻る。
    let outcome = match settled {
        Some(outcome) => outcome,
        None => {
            let _ = protocol.send_command(&GuiCommand::Stop).await;
            let drained = tokio::time::timeout(STOP_GRACE, async {
                while let Some(command) = raw_rx.recv().await {
                    if matches!(command, EngineCommand::BestMove(_)) {
                        return true;
                    }
                }
                false
            })
            .await;

            if drained != Ok(true) {
                // エンジンは探索中のまま。次の `go` は受け付けられない可能性が高い
                log::warn!(
                    target: LOGT,
                    "stop: no bestmove within grace side={:?} req={}",
                    side,
                    req
                );
            }
            SearchOutcome::Aborted
        }
    };

    protocol.remove_listener(&listener).await;
    let _ = tx.send(SearchMessage::Outcome { side, req, outcome });
}

fn outcome_of(params: BestMoveParams) -> SearchOutcome {
    match params {
        BestMoveParams::MakeMove(usi, ponder) => SearchOutcome::Move { usi, ponder },
        BestMoveParams::Resign => SearchOutcome::Resign,
        BestMoveParams::Win => SearchOutcome::DeclareWin,
    }
}
