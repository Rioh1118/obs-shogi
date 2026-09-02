use crate::engine::utils::{apply_info_params, get_depth_of_rank, LogThrottle};

use serde::Serialize;

use super::protocol::{StopEffect, UsiProtocol};
use super::registry::{EngineId, EngineRegistry};
use super::types::*;
use super::USI_OK_TIMEOUT;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex, RwLock};
use usi::{EngineCommand, GuiCommand, ThinkParams};

const LOGT: &str = "obs_shogi::engine::analyzer";

/// 考慮時間が尽きてから `bestmove` を待つ猶予。
///
/// **`byoyomi` と同じ締切で待たない。** エンジンは指定した時間だけ考えてから
/// `bestmove` を書くので、同じ締切だと必ず先にこちらが折れる。
/// そのときの `Timeout` は「エンジンが遅い」ではなく「待ち方が短い」でしかない。
const BESTMOVE_GRACE: Duration = Duration::from_secs(3);

/// `stop` を撃ってから `bestmove` を待つ上限。
///
/// これを過ぎたら `Timeout` を返して席を返す。エンジンはまだ探索中かもしれないが、
/// 待ち続けても席が空かないので、利用者にエンジンの再起動を選ばせるほうが早い。
///
/// **対局側の `game::search::SEARCH_STOP_GRACE` とは別物。** 値も違う（あちらは5秒）。
/// 同じ綴りにすると `grep` で2つ当たり、doc がどちらを指すのか読み手に分からない。
/// あちらは捨てる `bestmove` を待つ猶予で、`SETTLE_TIMEOUT` との大小が
/// `the_watchdogs_are_ordered` に固定してある。こちらは誰とも突き合わせていない。
const ANALYSIS_STOP_GRACE: Duration = Duration::from_secs(3);

/// 深度指定の解析に掛ける考慮時間。
///
/// **`go depth` は送っていない。** `usi 0.6` の `ThinkParams` が組めるのは
/// `ponder` / `btime` / `wtime` / `byoyomi` / `binc` / `winc` / `infinite` / `mate` で、
/// 深度を載せる手段が無い。深度の打ち切りは `info depth` を見てこちらから
/// `stop` を撃つ側（`reached_depth`）が持つ。
///
/// この定数はその見張りが空振りしたときの時間側の打ち切り。**届かないまま
/// ここに当たることがある**ので、届いたかは呼び出し側へ返す（→ `DepthOutcome`）。
const DEPTH_ANALYSIS_BUDGET: Duration = Duration::from_secs(60);

/// 1回の解析に許す考慮時間の上限。
///
/// 上限が無いと、`analyze_with_time` は席を握ったまま何時間でも戻らない。
/// 席が空かない間は**解析の入口が全部断られる**（→ `bridge::take_session`）。
///
/// 対局は止まらない。あちらは `GameManager` が別のプロセスを起こすので、
/// 解析の席を一度も見ない。
pub const MAX_THINK_TIME: Duration = Duration::from_secs(600);

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn contains_usi_breaking_char(s: &str) -> bool {
    s.chars().any(|c| c == '\n' || c == '\r' || c == '\0')
}

/// 深度指定の解析が返すもの。
///
/// **`AnalysisResult` だけを返さない。** 返すと「届かなかった」が消え、
/// 深度22の結果が深度40の解析として読まれる。呼び出し側に見分ける手段が要る。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthOutcome {
    pub result: AnalysisResult,
    /// 要求した深度
    pub requested: u32,
    /// 実際に届いた深度（`info depth` の最善手のもの）。`info` が1行も
    /// 来なければ `None`
    pub deepest: Option<u32>,
    /// `requested` に届いたか
    pub reached: bool,
}

/// `stop` を撃った後、`bestmove` を待ってよいか。
///
/// **「待たなくてよい」を「書けた」に潰さない。** 潰すと `ANALYSIS_STOP_GRACE` を待ち切り、
/// 来るはずのない `bestmove` の後に「エンジンが `stop` に応じなかった」という
/// 説明が残る。エンジンは `go` を1バイトも受け取っていないことがある。
///
/// `game::search` の `outcome_of_stop` と写す元は同じだが、**写す先の粒度が違う**。
/// あちらは `Timeout` を `StopTimedOut` という別の状態へ落とし、対局を続ける／
/// 話しかけるのをやめる、の判断に使う。こちらは待ち方しか決めないので、
/// 送れなかったものは理由を問わず「待たない」に落ちる。
#[derive(Debug)]
enum StopVerdict {
    /// 書けた。この後 `bestmove` が来る
    Wait,
    /// まだ書いていない `go` を落とした。**`bestmove` は来ない**
    NothingToWait,
    /// 送れなかった。待っても意味が無い。
    ///
    /// `Timeout` もここに来る。**`await_write` が `fail_writes` を撃った後**なので、
    /// `Closed` が立って以後のリスナー登録は断られる。「待てば届くかも」ではなく、
    /// そのプロセスはもう使えない。
    Failed(EngineError),
}

/// `stop` の後に `bestmove` を待つべきか。
///
/// **判定は `verdict_of_stop` の1本を通す。** 書き写すと片方だけ直る形になる。
/// 送れなかったときに待たないのは、待っても畳まれないため——エンジンは
/// `stop` を受け取っていない。
fn should_wait_for_bestmove(stopped: &Result<StopEffect, EngineError>) -> bool {
    match stopped {
        Ok(effect) => matches!(verdict_of_stop(Ok(*effect)), StopVerdict::Wait),
        Err(_) => false,
    }
}

fn verdict_of_stop(stopped: Result<StopEffect, EngineError>) -> StopVerdict {
    match stopped {
        Ok(StopEffect::Written) => StopVerdict::Wait,
        Ok(StopEffect::CancelledQueued) => StopVerdict::NothingToWait,
        // 理由で分けない。**分けても待ち方が変わらない。**
        // 分けたい判断があるなら `StopVerdict` にバリアントを足すこと——
        // コメントだけで分けると、腕が同じ値を返すまま残る
        Err(e) => StopVerdict::Failed(e),
    }
}

/// ログに出す理由。`verdict_of_stop` と同じ分岐を1箇所で言葉にする
fn stop_reason(stopped: &Result<StopEffect, EngineError>) -> String {
    match stopped {
        Ok(effect) => format!("{effect:?}"),
        Err(e) => e.to_string(),
    }
}

/// `go` が1度も書かれなかったときの失敗。
///
/// `Timeout` と分ける。あちらは「エンジンが答えない」で、こちらは
/// 「エンジンはまだ何も聞いていない」。次の手が違う（前者は再起動、
/// 後者は `isready` を待ってからやり直す）。
fn not_searching() -> EngineError {
    EngineError::InvalidState(
        "the engine never received the go command; it was still getting ready".to_string(),
    )
}

/// 積まれていた古い出力を捨てる。
///
/// **`go` を書き終えてから呼ぶこと。** その前にエンジンが出した行は、
/// この `go` への応答ではありえない（エンジンはまだ受け取っていない）。
/// 前の探索が `Timeout` で見捨てられた後も走り続けている場合、その
/// `bestmove` がこちらのリスナーに届く。捨てないと、それを自分の答えとして
/// 採り——候補手0件の空の結果が `Ok` で返る。
fn drain_stale(raw_rx: &mut mpsc::UnboundedReceiver<EngineCommand>) -> usize {
    let mut dropped = 0;
    while raw_rx.try_recv().is_ok() {
        dropped += 1;
    }
    dropped
}

/// 目標深度に届いたか。
///
/// `None`（時間だけで打ち切る解析）では**常に偽**。ここが真を返すと `stop` が飛ぶので、
/// 深度を指定していない解析まで途中で畳んでしまう。
fn reached_depth(result: &AnalysisResult, target: Option<u32>) -> bool {
    let Some(target) = target else {
        return false;
    };
    get_depth_of_rank(result, 1).is_some_and(|depth| depth >= target)
}

/// 将棋エンジン分析層 - 純粋な分析機能のみ提供
///
/// 解析が使うエンジンは、対局が使うものと同じ台帳（`EngineRegistry`）に載る。
/// ここが持つのは「そのうちどれが解析用か」だけ。
pub struct EngineAnalyzer {
    registry: Arc<EngineRegistry>,
    engine_id: Arc<RwLock<Option<EngineId>>>,
    state: Arc<RwLock<AnalyzerState>>,
    infinite_stop_requested: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    /// 無限解析のストリームを外から畳むための名前。
    ///
    /// **`Some` は「走っている」を意味しない。** ストリームが自分で終わったときも
    /// 名前は残る（外す側が誰かを増やすと、取り合いになる）。
    /// 「解析中か」の判定にこれを使わないこと。
    ///
    /// 要るのは、`bestmove` が来ない経路があるため。積み置きの `go` は
    /// 複数の口から落ちる（`stop` の取り消し、`isready` のやり直し、破棄、
    /// flush の失敗、`readyok` が来なかった場合）ので、
    /// `process_analysis_stream` が自分では抜けられないことがある
    infinite_listener: Arc<Mutex<Option<String>>>,

    /// 探索が畳まれたことを知らせる口。
    ///
    /// **`stop` を書けただけでは畳まれていない。** エンジンは `stop` を受け取ってから
    /// `bestmove` を書くまでの間、`info` を吐き続ける。次の `go` をその前に出すと、
    /// 古い `info` が新しいセッションのリスナーへ配られる
    /// （`broadcast_to_listeners` は誰の `go` に対する行かを見ない）。
    ///
    /// `Notify` なのは、待つ側より先に畳まれても取りこぼさないため
    /// （`notify_one` は permit を1つ残す）。
    infinite_settled: Arc<Mutex<Option<Arc<tokio::sync::Notify>>>>,
}

#[derive(Debug, Clone, Default)]
struct AnalyzerState {
    current_position: Option<String>,
    last_result: Option<AnalysisResult>,
    analysis_count: u64,
}

/// ストリームの畳み方。
///
/// `Finite` は**まだ誰も構築しない**。有限の解析（時間／深度）は
/// `collect_until_bestmove` が自前で待つので、このストリームを通らない。
/// 落とさずに残してあるのは、`process_analysis_stream` の分岐が
/// 「無限だからこう畳む」を明示するため——腕が1つだと、その条件が
/// 無限解析に固有であることがコードから読めない。
enum StreamMode {
    Infinite(Arc<AtomicBool>),
    #[allow(dead_code)]
    Finite,
}

impl EngineAnalyzer {
    pub fn new(registry: Arc<EngineRegistry>) -> Self {
        Self {
            registry,
            engine_id: Arc::new(RwLock::new(None)),
            state: Arc::new(RwLock::new(AnalyzerState::default())),
            infinite_stop_requested: Arc::new(Mutex::new(None)),
            infinite_listener: Arc::new(Mutex::new(None)),
            infinite_settled: Arc::new(Mutex::new(None)),
        }
    }

    /// 解析用のエンジンを起動する。既に持っていれば先に落とす。
    pub async fn initialize_engine(
        &self,
        engine_path: String,
        working_dir: Option<String>,
    ) -> Result<(), EngineError> {
        self.shutdown().await?;

        let process = self
            .registry
            .spawn(&engine_path, working_dir.as_deref(), USI_OK_TIMEOUT)
            .await?;

        *self.engine_id.write().await = Some(process.id.clone());
        Ok(())
    }

    /// 解析用エンジンのプロトコル層。起動していなければ `NotInitialized`。
    async fn protocol(&self) -> Result<Arc<UsiProtocol>, EngineError> {
        let id = self
            .engine_id
            .read()
            .await
            .clone()
            .ok_or_else(|| EngineError::NotInitialized("Engine not initialized".to_string()))?;

        // 台帳から消えている＝落とされた後。ID を持っているだけでは起動を意味しない
        let process = self.registry.get(&id).await.ok_or_else(|| {
            EngineError::NotInitialized("Engine is no longer running".to_string())
        })?;

        Ok(process.protocol())
    }

    pub async fn apply_settings(&self, settings: EngineSettings) -> Result<(), EngineError> {
        let protocol = self.protocol().await?;

        for (name, value) in &settings.options {
            // USI プロトコルは行指向なので、name/value への改行注入を拒否する
            if contains_usi_breaking_char(name) || contains_usi_breaking_char(value) {
                return Err(EngineError::CommunicationFailed(
                    "setoption name/value contains forbidden control character".to_string(),
                ));
            }
            let cmd = GuiCommand::SetOption(name.clone(), Some(value.clone()));
            protocol.send_command(&cmd).await?;
        }

        protocol.send_command(&GuiCommand::IsReady).await?;
        protocol.send_command(&GuiCommand::UsiNewGame).await?;
        Ok(())
    }

    pub async fn shutdown(&self) -> Result<(), EngineError> {
        let id = self.engine_id.write().await.take();
        if let Some(id) = id {
            self.registry.shutdown(&id).await;
        }
        Ok(())
    }

    pub async fn get_engine_info(&self) -> Result<EngineInfo, EngineError> {
        let protocol = self.protocol().await?;
        protocol.get_engine_info(USI_OK_TIMEOUT).await
    }

    /// 局面を設定
    pub async fn set_position(&self, position: &str) -> Result<(), EngineError> {
        // USI プロトコルは行指向なので、position 文字列への改行注入を拒否する
        if contains_usi_breaking_char(position) {
            return Err(EngineError::CommunicationFailed(
                "position string contains forbidden control character".to_string(),
            ));
        }

        let protocol = self.protocol().await?;

        let position_command = GuiCommand::Position(position.to_string());
        protocol.send_command(&position_command).await?;

        // 状態更新
        self.state.write().await.current_position = Some(position.to_string());

        Ok(())
    }

    /// 無限解析開始
    pub async fn start_infinite_analysis(
        &self,
    ) -> Result<mpsc::UnboundedReceiver<AnalysisResult>, EngineError> {
        log::debug!(target: LOGT, "analysis.infinite.start: requested");

        let stop_flag = Arc::new(AtomicBool::new(false));
        *self.infinite_stop_requested.lock().await = Some(stop_flag.clone());

        let settled = Arc::new(tokio::sync::Notify::new());
        *self.infinite_settled.lock().await = Some(Arc::clone(&settled));

        let protocol = self.protocol().await?;

        // channel
        let (result_tx, result_rx) = mpsc::unbounded_channel();
        let (raw_tx, mut raw_rx) = mpsc::unbounded_channel();

        // 壁時計に依存しない。一意でありさえすればよい
        let listener_id = format!("infinite_analysis_{}", uuid::Uuid::new_v4());

        *self.infinite_listener.lock().await = Some(listener_id.clone());

        log::debug!(
            target: LOGT,
            "analysis.infinite: register_listener id={}",
            listener_id
        );

        if let Err(e) = protocol
            .register_listener(listener_id.clone(), raw_tx)
            .await
        {
            log::error!(
                target: LOGT,
                "analysis.infinite: register_listener failed: {:?}",
                e
            );
            return Err(e);
        }

        log::debug!(target: LOGT, "analysis.infinite: send_command go=infinite");
        let go_command = GuiCommand::Go(ThinkParams::new().infinite());

        if let Err(e) = protocol.send_command(&go_command).await {
            log::error!(
                target: LOGT,
                "analysis.infinite: send_command failed: {:?}",
                e
            );
            let _ = protocol.remove_listener(&listener_id).await;
            return Err(e);
        }

        // **書き終えてから捨てる。** 前の探索が畳まりきる前に始まった場合、
        // その `info` と `bestmove` がこのリスナーに積まれている
        let stale = drain_stale(&mut raw_rx);
        if stale > 0 {
            log::debug!(target: LOGT, "analysis.infinite: dropped {stale} stale line(s)");
        }

        // 結果処理タスク開始前にログ
        log::info!(
            target: LOGT,
            "analysis.infinite.started listener_id={}",
            listener_id
        );

        // 結果処理タスク
        let state_clone = Arc::clone(&self.state);
        let protocol_for_task = protocol.clone();
        let listener_id_for_task = listener_id.clone();

        tokio::spawn(async move {
            log::debug!(
                target: LOGT,
                "analysis.infinite.stream: start listener_id={}",
                listener_id_for_task
            );
            Self::process_analysis_stream(
                raw_rx,
                result_tx,
                state_clone,
                StreamMode::Infinite(stop_flag),
            )
            .await;

            protocol_for_task
                .remove_listener(&listener_id_for_task)
                .await;

            // **抜けたことを知らせる。** 待っている `stop_analysis` はこれを見て
            // 次の `go` を出してよいと判断する。抜ける理由は `bestmove` を受けたか、
            // チャンネルが閉じたか、外からリスナーを外されたか——どれでも
            // 「このリスナーにはもう配られない」なので、待ち手にとっては同じ
            settled.notify_one();
            log::debug!(
                target: LOGT,
                "analysis.infinite.stream: end listener_id={}",
                listener_id_for_task
            );
        });

        Ok(result_rx)
    }

    /// 固定時間解析
    pub async fn analyze_with_time(
        &self,
        time_limit: Duration,
    ) -> Result<AnalysisResult, EngineError> {
        let protocol = self.protocol().await?;

        let (raw_tx, mut raw_rx) = mpsc::unbounded_channel();

        let listener_id = format!("timed_analysis_{}", now_nanos());

        protocol
            .register_listener(listener_id.clone(), raw_tx)
            .await?;

        // 時間制限付き解析開始
        let go_command = GuiCommand::Go(ThinkParams::new().byoyomi(time_limit));
        protocol.send_command(&go_command).await?;

        // **書き終えてから捨てる。** それより前の出力はこの `go` への応答ではない
        let stale = drain_stale(&mut raw_rx);
        if stale > 0 {
            log::debug!(target: LOGT, "timed: dropped {stale} stale line(s)");
        }

        let result = self
            .collect_until_bestmove(&protocol, &mut raw_rx, time_limit, None)
            .await;

        // クリーンアップ
        protocol.remove_listener(&listener_id).await;

        let analysis_result = result?;

        // 状態更新
        {
            let mut state = self.state.write().await;
            state.last_result = Some(analysis_result.clone());
            state.analysis_count += 1;
        }

        Ok(analysis_result)
    }

    /// 深度指定の解析。
    ///
    /// **目標に届かなくても結果は返る。** 届いたかは `DepthOutcome::reached` を見ること。
    /// 届かない理由は `DEPTH_ANALYSIS_BUDGET` に当たったときで、
    /// 深度22の結果を深度40の解析として読ませないためにこの欄がある。
    pub async fn analyze_with_depth(&self, depth_limit: u32) -> Result<DepthOutcome, EngineError> {
        let protocol = self.protocol().await?;

        let (raw_tx, mut raw_rx) = mpsc::unbounded_channel();

        let listener_id = format!("depth_analysis_{}", now_nanos());

        protocol
            .register_listener(listener_id.clone(), raw_tx)
            .await?;

        // 深度は載せられないので、時間だけを渡して `info depth` を見張る
        let go_command = GuiCommand::Go(ThinkParams::new().byoyomi(DEPTH_ANALYSIS_BUDGET));
        protocol.send_command(&go_command).await?;

        let stale = drain_stale(&mut raw_rx);
        if stale > 0 {
            log::debug!(target: LOGT, "depth: dropped {stale} stale line(s)");
        }

        let result = self
            .collect_until_bestmove(
                &protocol,
                &mut raw_rx,
                DEPTH_ANALYSIS_BUDGET,
                Some(depth_limit),
            )
            .await;

        // クリーンアップ
        protocol.remove_listener(&listener_id).await;

        let analysis_result = result?;

        // 状態更新
        {
            let mut state = self.state.write().await;
            state.last_result = Some(analysis_result.clone());
            state.analysis_count += 1;
        }

        let deepest = get_depth_of_rank(&analysis_result, 1);
        Ok(DepthOutcome {
            reached: reached_depth(&analysis_result, Some(depth_limit)),
            deepest,
            requested: depth_limit,
            result: analysis_result,
        })
    }

    /// 解析停止。
    ///
    /// **エンジンが既に居なくても成功にする。** 要求は「止まっていること」で、
    /// 落ちているならその要求は満たせている。`Err` を返すと、後片付けの途中に
    /// 置かれた呼び出し（`stop_all_sessions`）が `?` で折れて、
    /// その先の台帳の掃除まで走らなくなる
    pub async fn stop_analysis(&self) -> Result<(), EngineError> {
        let protocol = match self.protocol().await {
            Ok(protocol) => protocol,
            Err(EngineError::NotInitialized(reason)) => {
                log::debug!(target: LOGT, "stop_analysis: nothing to stop ({reason})");
                return Ok(());
            }
            Err(e) => return Err(e),
        };

        if let Some(flag) = self.infinite_stop_requested.lock().await.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }

        // **`stop` の結果を待たずに外す。** `?` を先に置くと、
        // `Refuse` と書き込みの詰まりの経路でリスナーが残る。
        // `fail_writes` が `Closed` を立てるので、`Refuse` は例外的な経路ではない。
        //
        // 「`bestmove` が来たら畳む」を条件にしないのは、来ない口が複数あるため
        // （`stop` の取り消し、`isready` のやり直し、破棄、flush の失敗、
        // `readyok` が来なかった場合）。数え上げると必ず1つ漏れる。
        //
        // 外すと `process_analysis_stream` の `raw_rx.recv()` が `None` を返して
        // 抜け、`result_tx` の drop が `forward_results_to_ui` を終わらせる。
        // 正常に止めた場合も同じ場所で終わるので、外して困らない。
        // `remove_listener` は冪等
        let stopped = protocol.stop().await;

        // **畳まれるまで待つ。** `stop` を書けただけでは探索は終わっていない。
        // エンジンは `stop` を受け取ってから `bestmove` を書くまでの間 `info` を
        // 吐き続ける。ここで待たずに返すと、呼び出し側は次の `go` をその前に出し、
        // **古い局面の `info` が新しいセッションのリスナーへ配られる**
        // （`broadcast_to_listeners` は誰の `go` に対する行かを見ない）。
        // 利用者には、前の局面の評価値と読み筋が現在の盤面の解析結果として見える。
        //
        // 待つのは書けたときだけ。積み置きを落としたのなら探索は始まっていないし、
        // 送れなかったのなら待っても畳まれない（→ `verdict_of_stop`）。
        if should_wait_for_bestmove(&stopped) {
            self.wait_until_settled().await;
        }

        if let Some(id) = self.infinite_listener.lock().await.take() {
            log::debug!(target: LOGT, "stop_analysis: closing stream id={id}");
            protocol.remove_listener(&id).await;
        }

        stopped?;
        Ok(())
    }

    /// 探索が畳まれるのを待つ。**上限つき。**
    ///
    /// 超えても進む。ここで返らないと `stop_analysis` が返らず、
    /// 停止ボタンも棋譜を閉じる操作も固まる。畳めていないまま次の `go` を
    /// 出すことになるが、待ち続けて操作を失うよりましだという判断。
    async fn wait_until_settled(&self) {
        let Some(settled) = self.infinite_settled.lock().await.clone() else {
            return;
        };

        if tokio::time::timeout(ANALYSIS_STOP_GRACE, settled.notified())
            .await
            .is_err()
        {
            log::warn!(
                target: LOGT,
                "stop_analysis: no bestmove within {ANALYSIS_STOP_GRACE:?}; the engine may still be searching"
            );
        }
    }

    /// 最後の分析結果取得
    pub async fn get_last_result(&self) -> Option<AnalysisResult> {
        self.state.read().await.last_result.clone()
    }

    /// 分析統計取得
    pub async fn get_analysis_stats(&self) -> u64 {
        self.state.read().await.analysis_count
    }

    // === 内部ヘルパーメソッド ===

    /// 分析ストリーム処理（無限解析用）
    async fn process_analysis_stream(
        mut raw_rx: mpsc::UnboundedReceiver<EngineCommand>,
        result_tx: mpsc::UnboundedSender<AnalysisResult>,
        state: Arc<RwLock<AnalyzerState>>,
        mode: StreamMode,
    ) {
        log::debug!(target: LOGT, "stream: start");

        let mut current_result = AnalysisResult::default();
        let mut processed: u64 = 0;

        let mut stale_bestmove_warn = LogThrottle::new(Duration::from_secs(5));

        while let Some(cmd) = raw_rx.recv().await {
            processed += 1;

            match cmd {
                EngineCommand::Info(info_params) => {
                    apply_info_params(&info_params, &mut current_result);
                    // 更新された結果を送信
                    if result_tx.send(current_result.clone()).is_err() {
                        log::debug!(target: LOGT, "stream: result channel closed");
                        break;
                    }
                }
                EngineCommand::Checkmate(checkmate_params) => {
                    Self::process_checkmate(&checkmate_params, &mut current_result);

                    log::info!(target: LOGT, "stream: checkmate received");
                    let _ = result_tx.send(current_result.clone());
                }

                EngineCommand::BestMove(_) => {
                    match &mode {
                        StreamMode::Finite => {
                            let _ = result_tx.send(current_result.clone());
                            break;
                        }
                        StreamMode::Infinite(stop_flag) => {
                            // stop してないのに bestmove が来たらstaleの可能性
                            if !stop_flag.load(Ordering::SeqCst) {
                                if stale_bestmove_warn.allow() {
                                    log::warn!(
                                        target: LOGT,
                                        "stream: bestmove received without stop request; ignoring (stale?)"
                                    );
                                }
                                continue;
                            }
                            let _ = result_tx.send(current_result.clone());
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
        {
            let mut st = state.write().await;
            st.last_result = Some(current_result);
            st.analysis_count = st.analysis_count.wrapping_add(1);
        }

        log::debug!(target: LOGT, "stream: end processed={}", processed);
    }

    /// `bestmove` が返るまで応答を集める。
    ///
    /// **締切で黙って抜けない。** 抜けるだけだとエンジンの探索は走ったままで、
    /// こちらは席を返す。席は空くので**次の解析は始まってしまい**、
    /// 同じエンジンへ2本目の `go` が出る（→ #365）。締切に当たったら `stop` を撃ち、
    /// `bestmove` をもう一度だけ待つ。
    ///
    /// `target_depth` を渡すと、その深度に届いた時点でも `stop` を撃つ。
    /// 深度と時間で入口は分かれるが、**待ち方と後始末は同じ**なのでここに畳んである。
    async fn collect_until_bestmove(
        &self,
        protocol: &UsiProtocol,
        raw_rx: &mut mpsc::UnboundedReceiver<EngineCommand>,
        budget: Duration,
        target_depth: Option<u32>,
    ) -> Result<AnalysisResult, EngineError> {
        let mut result = AnalysisResult::default();
        let mut deadline = Instant::now() + budget + BESTMOVE_GRACE;

        // `stop` は1回だけ撃つ。`info` は毎秒何十行も来るので、印を持たないと
        // `bestmove` が返るまで撃ち続け、書き込みの列が `stop` で埋まる
        let mut stop_sent = false;

        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                if stop_sent {
                    return Err(EngineError::Timeout(
                        "engine did not answer after stop".to_string(),
                    ));
                }
                stop_sent = true;
                match self.stop_for_collection(protocol).await {
                    StopVerdict::Wait => deadline = Instant::now() + ANALYSIS_STOP_GRACE,
                    StopVerdict::NothingToWait => return Err(not_searching()),
                    StopVerdict::Failed(e) => return Err(e),
                }
                continue;
            }

            match tokio::time::timeout(left, raw_rx.recv()).await {
                Ok(Some(EngineCommand::Info(info_params))) => {
                    apply_info_params(&info_params, &mut result);

                    if !stop_sent && reached_depth(&result, target_depth) {
                        stop_sent = true;
                        match self.stop_for_collection(protocol).await {
                            StopVerdict::Wait => deadline = Instant::now() + ANALYSIS_STOP_GRACE,
                            // 深度には届いている。`go` が積み置きのままだったなら
                            // その `info` は別の探索のもの——ここへは来ない
                            StopVerdict::NothingToWait => return Ok(result),
                            StopVerdict::Failed(e) => return Err(e),
                        }
                    }
                }
                Ok(Some(EngineCommand::Checkmate(checkmate_params))) => {
                    Self::process_checkmate(&checkmate_params, &mut result);
                }
                Ok(Some(EngineCommand::BestMove(_))) => return Ok(result),
                Ok(Some(_)) => {}
                // 出力が終わったプロセス。**「Channel closed」と言わない。**
                // 落としたのか、詰まったのか、エンジンが終わったのかで
                // 次の手が違う（→ `UsiProtocol::cannot_reach`）
                Ok(None) => return Err(protocol.cannot_reach()),
                // 締切。次の周回の頭が扱う
                Err(_) => continue,
            }
        }
    }

    /// 集めている途中で探索を止める。
    ///
    /// **`stop_analysis` を通さない。** あちらは無限解析の後始末
    /// （`infinite_stop_requested` を立てる・`infinite_listener` を外す）も持つ。
    /// 収集ループが呼ぶと、**別に走っている無限解析のストリームを畳む**。
    /// フロントには `analysis-update` が止まるだけで、エラーも完了も飛ばない。
    ///
    /// 猶予を測り始めるのは `stop()` が返ってから。先に測ると、書き込みの列に
    /// 先客が居たぶん（最大 `WRITE_TIMEOUT`）が猶予から引かれる。
    async fn stop_for_collection(&self, protocol: &UsiProtocol) -> StopVerdict {
        let stopped = protocol.stop().await;
        log::debug!(target: LOGT, "collect: stop -> {}", stop_reason(&stopped));
        verdict_of_stop(stopped)
    }

    fn process_checkmate(params: &usi::CheckmateParams, result: &mut AnalysisResult) {
        use usi::CheckmateParams;

        match params {
            CheckmateParams::Mate(moves) => {
                result.mate_sequence = Some(moves.clone());
            }
            CheckmateParams::NoMate => {
                // 「詰み探索したが詰み無し」を表す
                result.mate_sequence = Some(Vec::new());
            }
            CheckmateParams::NotImplemented | CheckmateParams::Timeout => {
                // 最低限、結果としては「手順なし」にしておく
                // ここは将来、別フィールドに拡張しても良い
                result.mate_sequence = Some(Vec::new());
            }
        }
    }
}

impl Clone for EngineAnalyzer {
    fn clone(&self) -> Self {
        Self {
            registry: Arc::clone(&self.registry),
            engine_id: Arc::clone(&self.engine_id),
            state: Arc::clone(&self.state),
            infinite_stop_requested: Arc::clone(&self.infinite_stop_requested),
            infinite_listener: Arc::clone(&self.infinite_listener),
            infinite_settled: Arc::clone(&self.infinite_settled),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result_with_depth(depth: u32) -> AnalysisResult {
        AnalysisResult {
            candidates: vec![AnalysisCandidate {
                rank: 1,
                first_move: None,
                pv_line: Vec::new(),
                evaluation: None,
                depth: Some(depth),
                nodes: None,
                time_ms: None,
            }],
            ..Default::default()
        }
    }

    /// 深度を指定していない解析を、深度で止めないこと。
    ///
    /// **`None` で真を返すと `stop` が飛ぶ。** 時間だけで打ち切るはずの解析が、
    /// エンジンが最初の `info depth` を出した時点で畳まれる
    #[test]
    fn a_time_only_analysis_is_never_cut_short_by_depth() {
        for depth in [0, 1, 20, u32::MAX] {
            assert!(
                !reached_depth(&result_with_depth(depth), None),
                "深度 {depth} で止めてはいけない"
            );
        }
    }

    /// 届いたかの境目。**「以上」であること。**
    ///
    /// `>` にすると、目標ちょうどで止まらずに次の深度まで探索が続く。
    /// 深度を指定した意味が無くなる
    #[test]
    fn the_target_depth_itself_counts_as_reached() {
        assert!(!reached_depth(&result_with_depth(9), Some(10)));
        assert!(reached_depth(&result_with_depth(10), Some(10)));
        assert!(reached_depth(&result_with_depth(11), Some(10)));
    }

    /// 候補がまだ1つも来ていない段階で止めないこと
    #[test]
    fn nothing_is_reached_before_the_first_info() {
        assert!(!reached_depth(&AnalysisResult::default(), Some(1)));
    }

    /// `stop` の終わり方を、待ち方へ潰さずに写すこと。
    ///
    /// **`CancelledQueued` を `Wait` に潰すのが一番の穴。** 潰すと
    /// `ANALYSIS_STOP_GRACE` を待ち切り、来るはずのない `bestmove` の後に
    /// 「エンジンが `stop` に応じなかった」という説明が残る。
    /// エンジンは `go` を1バイトも受け取っていない。
    #[test]
    fn the_ways_a_stop_can_end_are_not_collapsed_into_waiting() {
        assert!(matches!(
            verdict_of_stop(Ok(StopEffect::Written)),
            StopVerdict::Wait
        ));
        assert!(matches!(
            verdict_of_stop(Ok(StopEffect::CancelledQueued)),
            StopVerdict::NothingToWait
        ));
        assert!(matches!(
            verdict_of_stop(Err(EngineError::Timeout("blocked".to_string()))),
            StopVerdict::Failed(EngineError::Timeout(_))
        ));
        assert!(matches!(
            verdict_of_stop(Err(EngineError::CommunicationFailed("gone".to_string()))),
            StopVerdict::Failed(EngineError::CommunicationFailed(_))
        ));
    }

    /// 送れなかった理由を潰さないこと。
    ///
    /// `Timeout`（詰まった）と `CommunicationFailed`（届く先が無い）で
    /// 利用者の次の手が違う。`Failed` に包むときに文言を作り直さない
    #[test]
    fn a_failed_stop_keeps_which_failure_it_was() {
        let StopVerdict::Failed(e) = verdict_of_stop(Err(EngineError::Timeout("x".to_string())))
        else {
            panic!("Failed が返っていない");
        };
        assert_eq!(
            e.to_string(),
            EngineError::Timeout("x".to_string()).to_string()
        );
    }

    /// `go` が書かれなかった失敗と、答えが返らなかった失敗を分けること
    #[test]
    fn never_sent_is_not_the_same_as_never_answered() {
        assert!(matches!(not_searching(), EngineError::InvalidState(_)));
        assert_ne!(
            not_searching().to_string(),
            EngineError::Timeout("engine did not answer after stop".to_string()).to_string()
        );
    }

    /// `stop` を書けたときだけ `bestmove` を待つこと。
    ///
    /// **待たずに返すと、次の `go` が古い探索の途中で出る。** エンジンは
    /// `stop` を受け取ってから `bestmove` を書くまで `info` を吐き続けるので、
    /// その `info` が新しいセッションのリスナーへ配られる。利用者には
    /// 前の局面の評価値と読み筋が現在の盤面の解析結果として見える。
    ///
    /// 逆に、積み置きを落としたときや送れなかったときに待つと、
    /// 来ない `bestmove` を `ANALYSIS_STOP_GRACE` ぶん待って停止が遅れる。
    #[test]
    fn only_a_written_stop_is_worth_waiting_for() {
        assert!(should_wait_for_bestmove(&Ok(StopEffect::Written)));
        assert!(!should_wait_for_bestmove(&Ok(StopEffect::CancelledQueued)));
        assert!(!should_wait_for_bestmove(&Err(EngineError::Timeout(
            "blocked".to_string()
        ))));
        assert!(!should_wait_for_bestmove(&Err(
            EngineError::CommunicationFailed("gone".to_string())
        )));
    }

    /// 積まれていた古い出力を捨てること。
    ///
    /// 捨てないと、前の探索の `bestmove` を自分の答えとして採る。
    /// `bestmove` が先に届けば**候補手0件の空の結果が `Ok` で返る**
    #[test]
    fn stale_output_is_dropped_before_collecting() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        tx.send(EngineCommand::BestMove(usi::BestMoveParams::Resign))
            .unwrap();
        tx.send(EngineCommand::BestMove(usi::BestMoveParams::Resign))
            .unwrap();

        assert_eq!(drain_stale(&mut rx), 2);
        assert_eq!(drain_stale(&mut rx), 0, "2度目は何も残っていない");
    }
}
