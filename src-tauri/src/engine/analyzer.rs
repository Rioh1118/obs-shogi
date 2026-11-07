//! 検討に使うエンジン1本がどれかを決め、その上で探索を回す。
//!
//! 起動は要求の番号（`Request`）で順序を持ち、新しい要求が来たら前の起動を取り消す。
//! 起こして設定を送る手順そのものは `analysis_start` が持つ。
//! 探索の結果をどこへ流すかと、席を誰に配るかは知らない（`bridge`）。

use crate::engine::candidates::{apply_info_params, depth_of_rank};

use super::analysis_start::{self, cancelled_start, validate_input, StartInput};
use super::protocol::search::{LateAnswer, Search, SearchLine, StopAnswer};
use super::protocol::{contains_usi_breaking_char, EngineEndWatch, UsiProtocol};
use super::registry::{EngineId, EngineProcess, EngineRegistry};
use super::types::*;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, watch, Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use usi::ThinkParams;

const LOGT: &str = "obs_shogi::engine::analyzer";

/// 考慮時間が尽きてから `bestmove` を待つ猶予。
///
/// **`byoyomi` と同じ締切で待たない。** エンジンは指定した時間だけ考えてから
/// `bestmove` を書くので、同じ締切だと必ず先にこちらが折れる。
/// そのときの `Timeout` は「エンジンが遅い」ではなく「待ち方が短い」でしかない。
const BESTMOVE_GRACE: Duration = Duration::from_secs(3);

/// `stop` を撃ってから `bestmove` を待つ上限。
///
/// 超えたら席は返すが、**答えが来るまで次の `position` と `go` を通さない**
/// （`EngineAnalyzer::unanswered`）。探索中のエンジンへ重ねると、やねうら王は `stop` にも
/// `quit` にも答えなくなる（`research/engines/usi-measurements.md`）。
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

/// 無限解析のストリームが流すもの。
///
/// **結果と終わり方を1本の列で運ぶ。** 終わり方を別の経路で知らせると、最後の結果との
/// 順序を2本で揃えることになる。列が `Finished` を流さずに閉じたら、止められたか
/// プロセスが終わったか（どちらも別の経路が知っている）
#[derive(Debug)]
pub enum AnalysisStreamItem {
    /// 途中経過
    Update(AnalysisResult),
    /// エンジンが自分で `bestmove` を返した。止めた探索の `bestmove` は流れない
    /// （`Search::stop` が受けて捨てる）
    Finished(AnalysisResult),
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

/// 時間か深度を決めた検討で、止めた後の結果。**上限まで答えなければ失敗にする**
fn result_after_stop(
    stopped: Result<StopOutcome, EngineError>,
    result: AnalysisResult,
) -> Result<AnalysisResult, EngineError> {
    match stopped {
        Ok(StopOutcome::Stopped) => Ok(result),
        Ok(StopOutcome::Unanswered) => Err(EngineError::Timeout(format!(
            "{TIMED_OUT} waiting for a bestmove after stop"
        ))),
        Err(e) => Err(e),
    }
}

/// 止める頼みへ答える。止めるものが無かった回と、届かなかった回は「止まった」と答える
/// （`EngineAnalyzer::stop_analysis` の doc）。頼んだ者が居なければ何もしない
fn answer_stop_request(reply: Option<StopReply>, stopped: &Result<StopOutcome, EngineError>) {
    let outcome = match stopped {
        Ok(outcome) => *outcome,
        Err(e) => {
            log::debug!(target: LOGT, "stop: answered as stopped: {e}");
            StopOutcome::Stopped
        }
    };
    if let Some(reply) = reply {
        let _ = reply.send(outcome);
    }
}

/// 止めに上限まで答えなかった探索の、遅れた答えを待ってから `unanswered` を下ろす。
/// 出力が終わった回も下ろす（落としたプロセスには、もう次の `go` を書かない）
async fn wait_for_late_answer(late: LateAnswer, unanswered: Arc<watch::Sender<bool>>) {
    match late.wait().await {
        Ok(()) => log::info!(target: LOGT, "stop: the engine answered late"),
        Err(e) => log::debug!(target: LOGT, "stop: ended before a late answer: {e}"),
    }
    unanswered.send_replace(false);
}

/// 目標深度に届いたか。
///
/// `None`（時間だけで打ち切る解析）では**常に偽**。ここが真を返すと `stop` が飛ぶので、
/// 深度を指定していない解析まで途中で畳んでしまう。
fn reached_depth(result: &AnalysisResult, target: Option<u32>) -> bool {
    let Some(target) = target else {
        return false;
    };
    depth_of_rank(result, 1).is_some_and(|depth| depth >= target)
}

/// 検討に使うエンジン1本の起動と探索
///
/// 解析が使うエンジンは、対局が使うものと同じ台帳（`EngineRegistry`）に載る。
/// ここが持つのは「そのうちどれが解析用か」だけ。
pub struct EngineAnalyzer {
    registry: Arc<EngineRegistry>,
    engine_id: Arc<RwLock<Option<EngineId>>>,
    state: Arc<RwLock<AnalyzerState>>,
    /// 走っている探索（無限・時間・深度のどれでも）へ、止める頼みを渡すチャネルの送り手。
    ///
    /// **探索（`Search`）を持つのは探索を回す側**（`process_analysis_stream` と
    /// `collect_until_bestmove`）で、ここは頼みを渡すだけ。**`Some` は「走っている」を意味しない。**
    /// 探索が自分で終わっても送り手は残り、終わった探索への頼みは送れずに返る（止めるものが無かったと読む）
    search_stop: Mutex<Option<oneshot::Sender<StopReply>>>,

    /// `stop` の答えが上限までに来なかった。**立っている間は `position` と `go` を通さない。**
    ///
    /// 立てるのは止める手順（`stop_search`）で、下ろすのはそれが起こしたタスクが遅れた答え
    /// （`LateAnswer`）を待ち終えたときと、プロセスを落としたとき。
    /// `Sender` なのは、`watch_answered` が答えを待つため。
    unanswered: Arc<watch::Sender<bool>>,

    /// 進行中の起動（`start_engine`）の世代と取り消しの欄。
    ///
    /// **世代を Rust の側に持つ。** 起動中のプロセスは `usiok` と `readyok` を待つ間
    /// `engine_id` に居ないので、止める・切り替える呼び出しは ID では届かない。
    /// ここの取り消しの欄を立てれば、起動中のプロセスも落ちる。起動が `engine_id` へ書くのは
    /// `publish` を通して、世代が最新のときだけ（同じロックの下で確かめる）
    startup: Arc<Mutex<Startup>>,
}

#[derive(Default)]
struct Startup {
    generation: u64,
    cancel: Option<CancellationToken>,
    /// これまでに受けた起動・停止の要求のうち最も新しい番号（`Request`）
    latest_request: Request,
    /// `engine_id` に載せたプロセスを起動した要求の番号。止めに答えない知らせに載せる
    /// （`EngineAnalyzer::started_by`）。**載せるのと同じロックの下で書く**（`publish`）
    started_by: Request,
}

impl Startup {
    /// `request` が既に受けた要求より古いか。**同じ番号は古くない**（`Request`）
    fn is_superseded(&self, request: Request) -> bool {
        request < self.latest_request
    }
}

/// フロントが起動・停止を撃つたびに上げる番号（`provider.tsx` の `seqRef`）。
///
/// **順序の出典はフロントの1箇所にする。** Tauri の async コマンドは別々のタスクで走り、
/// `startup` のロックに着く前に別の `await` を挟む（`bridge.rs` の `release_sessions` /
/// `stop_all_sessions`）。後から撃った要求が先にロックを取ると、Rust の世代の順が逆転し、
/// フロントが捨てた古い起動が `engine_id` に載って、新しい要求のほうが取り消される。
/// 番号が最新より古い要求は、何もせずに断る
pub type Request = u64;

/// 止める頼みへの答えを返す送り手（`EngineAnalyzer::stop_analysis` が待つ）
type StopReply = oneshot::Sender<StopOutcome>;

#[derive(Debug, Clone, Default)]
struct AnalyzerState {
    current_position: Option<String>,
    last_result: Option<AnalysisResult>,
    analysis_count: u64,
}

impl EngineAnalyzer {
    pub fn new(registry: Arc<EngineRegistry>) -> Self {
        Self {
            registry,
            engine_id: Arc::new(RwLock::new(None)),
            state: Arc::new(RwLock::new(AnalyzerState::default())),
            search_stop: Mutex::new(None),
            unanswered: Arc::new(watch::channel(false).0),
            startup: Arc::new(Mutex::new(Startup::default())),
        }
    }

    /// 解析用のエンジンを起動し、設定を送って `readyok` まで待つ。**1つの呼び出しで通す。**
    ///
    /// 前の起動が進行中なら取り消し、起動済みのエンジンは落としてから始める。
    /// 待っている間に `shutdown` か次の `start_engine` が来たら、起動中の
    /// プロセスも落として `Cancelled` で返る。`readyok` を待つ上限は置かない（DNN 系の初回の
    /// 読み込みに上限を置けない）——止める経路はこの取り消しで担保する。
    ///
    /// 値だけで断れる設定（`setup::validate_options`）は、プロセスを起こす前に断る。
    /// **前の起動と起動済みのエンジンは、断る回も落とす**——起動の要求は「いまの設定で
    /// 動かす」なので、断った設定の前のエンジンを残すと、フロントの失敗と並んで動き続ける。
    /// `request` が既に受けた要求より古ければ、何もせずに `Cancelled`（`Request`）。
    pub async fn start_engine(
        &self,
        engine_path: &str,
        input: &StartInput,
        request: Request,
    ) -> Result<StartOutcome, EngineError> {
        let Some((generation, cancel)) = self.begin_start(request).await else {
            return Err(superseded_request());
        };
        // **前の起動を取り消してから断る。** 利用者は既に別の設定へ移っている。
        // 断るだけにすると、前の起動が進んで `engine_id` に載り、フロントの失敗と並ぶ
        if let Err(e) = validate_input(input) {
            let mut startup = self.startup.lock().await;
            if startup.generation == generation {
                startup.cancel = None;
            }
            return Err(e);
        }

        let started = analysis_start::start(&self.registry, engine_path, input, &cancel).await;
        let (process, warnings) = match started {
            Ok(process) => process,
            // **取り消された後の失敗は取り消しとして返す。** 取り消しは待ちとしか競わないので、
            // 起こす段や書き込みで折れた起動は、止めた後でも本物の失敗の顔で返ってくる。
            // 利用者が既に離れた起動に「起動できませんでした」を出さない
            Err(e) if cancel.is_cancelled() => {
                log::debug!(target: LOGT, "start_engine: failed after it was cancelled: {e}");
                return Err(cancelled_start());
            }
            Err(e) => return Err(e),
        };
        let info = self.publish(generation, request, process).await?;
        Ok(StartOutcome { info, warnings })
    }

    /// 新しい起動を始める（`take_over`）。返すのはその起動の世代と取り消しの欄
    async fn begin_start(&self, request: Request) -> Option<(u64, CancellationToken)> {
        let cancel = CancellationToken::new();
        let generation = self.take_over(request, Some(cancel.clone())).await?;
        Some((generation, cancel))
    }

    /// 要求を受け、いまのプロセスを手放す。**起動と `shutdown` はどちらもここを通す。**
    ///
    /// 世代を上げ、進行中の起動を取り消して `next` に置き換え、覚えた局面を消し、
    /// `engine_id` から外したプロセスを落とす。`request` が既に受けた要求より古ければ何もせず `None`
    async fn take_over(&self, request: Request, next: Option<CancellationToken>) -> Option<u64> {
        let (generation, previous) = {
            let mut startup = self.startup.lock().await;
            if startup.is_superseded(request) {
                return None;
            }
            startup.latest_request = request;
            startup.generation += 1;
            if let Some(previous) = std::mem::replace(&mut startup.cancel, next) {
                previous.cancel();
            }
            // **前のプロセスの局面を次へ持ち越さない。** ロックの外で消すと、前のプロセスを
            // 落とす間に追い越した起動が覚えた局面を消す
            self.state.write().await.current_position = None;
            (startup.generation, self.engine_id.write().await.take())
        };
        if let Some(previous) = previous {
            self.drop_engine(&previous).await;
        }
        Some(generation)
    }

    /// 起動を終えたプロセスを `engine_id` に載せる。世代が古ければ落として `Cancelled`。
    ///
    /// **世代の確認と `engine_id` への書き込みを同じロックの下で。** 離すと、確かめてから
    /// 書くまでの間に次の起動が前の `engine_id` を落とし終え、ここが古いプロセスを書き戻す
    async fn publish(
        &self,
        generation: u64,
        request: Request,
        process: Arc<EngineProcess>,
    ) -> Result<EngineInfo, EngineError> {
        let mut startup = self.startup.lock().await;
        if startup.generation != generation {
            drop(startup);
            self.registry.shutdown(&process.id).await;
            return Err(cancelled_start());
        }
        startup.cancel = None;
        startup.started_by = request;
        *self.engine_id.write().await = Some(process.id.clone());
        Ok(process.info.clone())
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

    /// 解析用のエンジンを落とす。起動中のものも止める。
    ///
    /// `request` が既に受けた要求より古ければ何もしない——後から撃たれた起動を落とさない。
    /// 世代を上げるので、後から終わった起動は `engine_id` へ書かない
    pub async fn shutdown(&self, request: Request) -> Result<(), EngineError> {
        if self.take_over(request, None).await.is_none() {
            log::debug!(target: LOGT, "shutdown: superseded by a newer request");
        }
        Ok(())
    }

    /// エンジンを落とす。`stop` に答えていないなら `quit` を待たない
    async fn drop_engine(&self, id: &str) {
        if self.unanswered.send_replace(false) {
            self.registry.kill(id).await;
        } else {
            self.registry.shutdown(id).await;
        }
    }

    /// `stop` に答えていないなら断る
    fn refuse_if_unanswered(&self) -> Result<(), EngineError> {
        if *self.unanswered.borrow() {
            return Err(EngineError::InvalidState(
                "the engine has not answered stop yet".to_string(),
            ));
        }
        Ok(())
    }

    /// `stop` に答えが来るのを待つ。**プロセスを落としても返る**（呼び手は番号で捨てられる）
    pub fn watch_answered(&self) -> impl std::future::Future<Output = ()> + Send + 'static {
        let mut unanswered = self.unanswered.subscribe();
        async move {
            let _ = unanswered.wait_for(|waiting| !*waiting).await;
        }
    }

    /// `request` が既に受けた要求より古いか（読むだけ。確定は `start_engine` / `shutdown` が
    /// 同じロックの下で決める）
    pub async fn is_superseded(&self, request: Request) -> bool {
        self.startup.lock().await.is_superseded(request)
    }

    /// 最後に起動を終えたプロセスを起動した要求の番号。まだ1度も起動していなければ 0。
    ///
    /// 落とした後も前の番号のまま残る。読み手（`bridge` の停止）が知らせに載せるのは
    /// 止めに答えなかったときだけで、それは起動したプロセスがあるときに限る
    pub async fn started_by(&self) -> Request {
        self.startup.lock().await.started_by
    }

    /// 読む局面を覚える。**線には書かない。**
    ///
    /// `position` を書くのは `go` の直前だけ（`start_search`）。盤が動くたびに書くと、
    /// 探索中のエンジンへ `position` が届く（USI は認めない）。順序をここ1か所で持つので、
    /// 呼び手が `stop` を待つ必要は無い
    pub async fn set_position(&self, position: &str) -> Result<(), EngineError> {
        // USI プロトコルは行指向なので、position 文字列への改行注入を拒否する
        if contains_usi_breaking_char(position) {
            return Err(EngineError::CommunicationFailed(
                "position string contains forbidden control character"
                    .to_string()
                    .into(),
            ));
        }

        self.protocol().await?;
        self.state.write().await.current_position = Some(position.to_string());
        Ok(())
    }

    /// 覚えた局面で探索を始める（手順「探索」）。**`position` と `go` を送る経路は全部ここを通す。**
    /// 答えていないエンジンには何も書かない。返すのは探索と、それへの止める頼みを受ける側
    async fn start_search(
        &self,
        params: ThinkParams,
    ) -> Result<(Search, oneshot::Receiver<StopReply>), EngineError> {
        let protocol = self.protocol().await?;
        self.refuse_if_unanswered()?;
        // **局面が無いなら `go` も出さない。** エンジンの中の前の局面か初期局面を読んで、
        // 盤と違う候補手が黙って出る
        let position = self.state.read().await.current_position.clone();
        let position = position.ok_or_else(|| {
            EngineError::InvalidState("no position has been set for this engine".to_string())
        })?;
        let search = protocol.search(position, params).await?;
        let (stop_tx, stop_rx) = oneshot::channel();
        *self.search_stop.lock().await = Some(stop_tx);
        Ok((search, stop_rx))
    }

    /// 解析用エンジンが最後に出した行
    pub async fn last_output(&self) -> Option<String> {
        self.protocol().await.ok()?.last_output()
    }

    /// 解析用エンジンの終わりを見る取っ手。起動していなければ `None`（見張るものが無い）
    pub async fn end_watch(&self) -> Option<EngineEndWatch> {
        Some(self.protocol().await.ok()?.end_watch())
    }

    /// 無限の検討を始め、途中経過と終わりを流す列を返す
    pub async fn start_infinite_analysis(
        &self,
    ) -> Result<mpsc::UnboundedReceiver<AnalysisStreamItem>, EngineError> {
        log::debug!(target: LOGT, "analysis.infinite.start: requested");
        let (search, stop_rx) = self.start_search(ThinkParams::new().infinite()).await?;

        let (result_tx, result_rx) = mpsc::unbounded_channel();
        tokio::spawn(Self::process_analysis_stream(
            search,
            stop_rx,
            result_tx,
            Arc::clone(&self.state),
            Arc::clone(&self.unanswered),
        ));
        log::info!(target: LOGT, "analysis.infinite.started");
        Ok(result_rx)
    }

    /// 固定時間解析
    pub async fn analyze_with_time(
        &self,
        time_limit: Duration,
    ) -> Result<AnalysisResult, EngineError> {
        let (search, stop_rx) = self
            .start_search(ThinkParams::new().byoyomi(time_limit))
            .await?;
        let analysis_result =
            Self::collect_until_bestmove(search, stop_rx, &self.unanswered, time_limit, None)
                .await?;
        self.keep_result(&analysis_result).await;
        Ok(analysis_result)
    }

    /// 深度指定の解析。
    ///
    /// **目標に届かなくても結果は返る。** 届いたかは `DepthOutcome::reached` を見ること。
    /// 届かない理由は `DEPTH_ANALYSIS_BUDGET` に当たったときで、
    /// 深度22の結果を深度40の解析として読ませないためにこの欄がある。
    pub async fn analyze_with_depth(&self, depth_limit: u32) -> Result<DepthOutcome, EngineError> {
        // 深度は載せられないので、時間だけを渡して `info depth` を見張る
        let (search, stop_rx) = self
            .start_search(ThinkParams::new().byoyomi(DEPTH_ANALYSIS_BUDGET))
            .await?;
        let analysis_result = Self::collect_until_bestmove(
            search,
            stop_rx,
            &self.unanswered,
            DEPTH_ANALYSIS_BUDGET,
            Some(depth_limit),
        )
        .await?;
        self.keep_result(&analysis_result).await;

        let deepest = depth_of_rank(&analysis_result, 1);
        Ok(DepthOutcome {
            reached: reached_depth(&analysis_result, Some(depth_limit)),
            deepest,
            requested: depth_limit,
            result: analysis_result,
        })
    }

    /// 終わった検討の結果を覚え、数を1つ増やす
    async fn keep_result(&self, result: &AnalysisResult) {
        let mut state = self.state.write().await;
        state.last_result = Some(result.clone());
        state.analysis_count += 1;
    }

    /// 解析停止。
    ///
    /// **エンジンが既に居なくても、届かなくても成功にする。** 要求は「止まっていること」で、
    /// 落ちているならその要求は満たせている。届かない理由（書けない、終わった）は終わりの見張り
    /// （`bridge` の `watch_engine_end`）が別に知らせる。`Err` を返すと、後片付けの途中に
    /// 置かれた呼び出し（`stop_all_sessions`）が `?` で折れて、その先の台帳の掃除まで走らなくなる。
    ///
    /// 止めるのは探索を回す側（`process_analysis_stream` と `collect_until_bestmove`）で、
    /// ここは頼んで答えを待つだけ。**答えは `bestmove` を待ってから返る**（`stop_search`）。
    /// `stop` を書けただけでは探索は終わっておらず、ここで返すと、呼び出し側は次の `go` をその前に出す。
    /// 上限までに答えが来なければ `Unanswered`
    pub async fn stop_analysis(&self) -> Result<StopOutcome, EngineError> {
        if let Err(e) = self.protocol().await {
            log::debug!(target: LOGT, "stop_analysis: nothing to stop ({e})");
            return Ok(StopOutcome::Stopped);
        }

        // 既に待ち切った探索へ撃ち直しても、同じ上限を待つだけ
        if *self.unanswered.borrow() {
            return Ok(StopOutcome::Unanswered);
        }

        let Some(stop) = self.search_stop.lock().await.take() else {
            return Ok(StopOutcome::Stopped);
        };
        let (reply, answer) = oneshot::channel();
        if stop.send(reply).is_err() {
            log::debug!(target: LOGT, "stop_analysis: the search had already ended");
            return Ok(StopOutcome::Stopped);
        }
        // 答えずに抜けたなら、探索はもう持たれていない
        Ok(answer.await.unwrap_or(StopOutcome::Stopped))
    }

    /// 最後に受けた検討の結果を返す
    pub async fn get_last_result(&self) -> Option<AnalysisResult> {
        self.state.read().await.last_result.clone()
    }

    /// これまでに回した検討の数を返す
    pub async fn get_analysis_stats(&self) -> u64 {
        self.state.read().await.analysis_count
    }

    // === 内部ヘルパーメソッド ===

    /// 無限の検討の探索を1本持ち、届いた行を結果の列へ読み替える。止める頼みが来たら止めて答える
    async fn process_analysis_stream(
        mut search: Search,
        mut stop_requested: oneshot::Receiver<StopReply>,
        result_tx: mpsc::UnboundedSender<AnalysisStreamItem>,
        state: Arc<RwLock<AnalyzerState>>,
        unanswered: Arc<watch::Sender<bool>>,
    ) {
        log::debug!(target: LOGT, "stream: start");

        let mut current_result = AnalysisResult::default();
        let mut processed: u64 = 0;

        loop {
            let line = tokio::select! {
                biased;
                // 送り手が捨てられた（次の探索が置き換えたか、検討の持ち主が消えた）回も止める。
                // 答える先が無いだけ
                request = &mut stop_requested => {
                    let stopped = Self::stop_search(search, &unanswered).await;
                    answer_stop_request(request.ok(), &stopped);
                    break;
                }
                line = search.next_line() => line,
            };
            processed += 1;

            match line {
                Ok(Some(SearchLine::Info(info_params))) => {
                    apply_info_params(&info_params, &mut current_result);
                    if result_tx
                        .send(AnalysisStreamItem::Update(current_result.clone()))
                        .is_err()
                    {
                        log::debug!(target: LOGT, "stream: result channel closed");
                        break;
                    }
                }
                Ok(Some(SearchLine::Checkmate(checkmate_params))) => {
                    Self::process_checkmate(&checkmate_params, &mut current_result);
                    log::info!(target: LOGT, "stream: checkmate received");
                    let _ = result_tx.send(AnalysisStreamItem::Update(current_result.clone()));
                }
                Ok(Some(SearchLine::BestMove(_))) => {
                    let _ = result_tx.send(AnalysisStreamItem::Finished(current_result.clone()));
                    break;
                }
                // 出力が終わった。知らせるのは終わりの見張り（`bridge` の `watch_engine_end`）
                Ok(None) | Err(_) => break,
            }
        }
        {
            let mut st = state.write().await;
            st.last_result = Some(current_result);
            st.analysis_count = st.analysis_count.wrapping_add(1);
        }
        log::debug!(target: LOGT, "stream: end processed={}", processed);
    }

    /// 探索を止める（`Search::stop`）。上限まで答えなければ `unanswered` を立て、
    /// 遅れた答えを待って下ろすタスクを起こす。
    ///
    /// **立ててから返す。** 返してから立てると、呼び手が次の `go` を通す窓ができる。
    /// 待つ間は `LateAnswer` が探索の枠を握るので、このプロセスで次の探索は始まらない。
    /// 止めるものが無かった回は `not_searching`、届かない回はその理由で断る
    async fn stop_search(
        search: Search,
        unanswered: &Arc<watch::Sender<bool>>,
    ) -> Result<StopOutcome, EngineError> {
        match search.stop(ANALYSIS_STOP_GRACE).await {
            StopAnswer::Answered => Ok(StopOutcome::Stopped),
            StopAnswer::NothingToStop => Err(not_searching()),
            StopAnswer::Unreachable(e) => Err(e),
            StopAnswer::Unanswered(late) => {
                unanswered.send_replace(true);
                log::warn!(
                    target: LOGT,
                    "stop: no bestmove within {ANALYSIS_STOP_GRACE:?}; refusing the next position and go"
                );
                tokio::spawn(wait_for_late_answer(late, Arc::clone(unanswered)));
                Ok(StopOutcome::Unanswered)
            }
        }
    }

    /// `bestmove` が返るまで応答を集める。
    ///
    /// **締切で黙って抜けない。** 抜けるだけだとエンジンの探索は走ったままで、
    /// こちらは席を返す。席は空くので**次の解析は始まってしまい**、
    /// 同じエンジンへ2本目の `go` が出る（→ #365）。締切に当たったら止め（`Search::stop`）、
    /// `bestmove` を `ANALYSIS_STOP_GRACE` まで待つ。
    ///
    /// `target_depth` を渡すと、その深度に届いた時点でも止める。
    /// 深度と時間で入口は分かれるが、**待ち方と後始末は同じ**なのでここに畳んである。
    ///
    /// 止める頼み（`EngineAnalyzer::stop_analysis`）が来たら、止めてそこへ答え、ここまでの結果を返す
    async fn collect_until_bestmove(
        mut search: Search,
        mut stop_requested: oneshot::Receiver<StopReply>,
        unanswered: &Arc<watch::Sender<bool>>,
        budget: Duration,
        target_depth: Option<u32>,
    ) -> Result<AnalysisResult, EngineError> {
        let mut result = AnalysisResult::default();
        let deadline = tokio::time::Instant::now() + budget + BESTMOVE_GRACE;

        loop {
            let line = tokio::select! {
                biased;
                request = &mut stop_requested => {
                    let stopped = Self::stop_search(search, unanswered).await;
                    answer_stop_request(request.ok(), &stopped);
                    return result_after_stop(stopped, result);
                }
                _ = tokio::time::sleep_until(deadline) => {
                    let stopped = Self::stop_search(search, unanswered).await;
                    return result_after_stop(stopped, result);
                }
                line = search.next_line() => line?,
            };
            match line {
                Some(SearchLine::Info(info_params)) => {
                    apply_info_params(&info_params, &mut result);
                    if reached_depth(&result, target_depth) {
                        let stopped = Self::stop_search(search, unanswered).await;
                        return result_after_stop(stopped, result);
                    }
                }
                Some(SearchLine::Checkmate(checkmate_params)) => {
                    Self::process_checkmate(&checkmate_params, &mut result);
                }
                Some(SearchLine::BestMove(_)) | None => return Ok(result),
            }
        }
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

/// 要求が、既に受けたより新しい要求に追い越されていた（`Request`）
fn superseded_request() -> EngineError {
    EngineError::Cancelled("a newer request was already received".to_string())
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

    /// `go` が書かれなかった失敗と、答えが返らなかった失敗を分けること
    #[test]
    fn never_sent_is_not_the_same_as_never_answered() {
        assert!(matches!(not_searching(), EngineError::InvalidState(_)));
        assert_ne!(
            not_searching().to_string(),
            EngineError::Timeout(format!("{TIMED_OUT} waiting for a bestmove after stop"))
                .to_string()
        );
    }

    /// 起動（`start_engine`）を実プロセスで確かめる
    #[cfg(unix)]
    mod starting {
        use super::*;
        use crate::engine::protocol::USI_OK_TIMEOUT;
        use crate::engine::registry::script::place_script as place;
        use std::path::Path;

        /// `usi` に答え、`isready` に答えない台本
        const NEVER_READY: &str = r#"while read line; do
  case "$line" in
    usi) printf 'id name Silent\nusiok\n' ;;
  esac
done"#;

        /// `usi` と `isready` に答える台本
        const READY: &str = r#"while read line; do
  case "$line" in
    usi) printf 'id name Ready\nusiok\n' ;;
    isready) echo readyok ;;
  esac
done"#;

        fn engine(path: &Path) -> &str {
            path.to_str().expect("パス")
        }

        /// 設定を送り `readyok` まで通したら、エンジンの情報を返し `engine_id` に載せる
        #[tokio::test]
        async fn a_start_returns_the_info_and_keeps_the_engine() {
            let dir = test_support::dir::temp_dir("analyzer-start-ok");
            let path = place(&dir, "ready.sh", READY).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = EngineAnalyzer::new(Arc::clone(&registry));

            let info = analyzer
                .start_engine(engine(&path), &StartInput::default(), 1)
                .await
                .expect("起動できる");
            assert_eq!(info.info.name, "Ready");
            assert!(
                analyzer.protocol().await.is_ok(),
                "`engine_id` に載っていない"
            );

            analyzer.shutdown(8).await.expect("落とせる");
            assert!(registry.ids().await.is_empty());
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `readyok` を待っている間に止めたら、取り消しで返り、起動中のプロセスも残さない
        #[tokio::test]
        async fn stopping_while_loading_cancels_and_leaves_nothing() {
            let dir = test_support::dir::temp_dir("analyzer-start-stop");
            let path = place(&dir, "silent.sh", NEVER_READY).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = Arc::new(EngineAnalyzer::new(Arc::clone(&registry)));

            let starting = {
                let analyzer = Arc::clone(&analyzer);
                let path = path.clone();
                tokio::spawn(async move {
                    analyzer
                        .start_engine(engine(&path), &StartInput::default(), 2)
                        .await
                })
            };
            // 握手を終えて `readyok` を待つところまで進める
            wait_until(|| async { !registry.ids().await.is_empty() }).await;
            analyzer.shutdown(9).await.expect("止められる");

            let result = tokio::time::timeout(Duration::from_secs(10), starting)
                .await
                .expect("止めても起動の待ちが解けない")
                .expect("タスク");
            assert!(
                matches!(result, Err(EngineError::Cancelled(_))),
                "取り消しとして返っていない: {result:?}"
            );
            assert!(
                registry.ids().await.is_empty(),
                "起動中のプロセスが残っている"
            );
            assert!(
                analyzer.protocol().await.is_err(),
                "止めたのに `engine_id` に載っている"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 起動中に次の起動が来たら、前の起動は取り消され、残るのは後の1本だけ
        #[tokio::test]
        async fn a_newer_start_replaces_the_one_still_loading() {
            let dir = test_support::dir::temp_dir("analyzer-start-replace");
            let silent = place(&dir, "silent.sh", NEVER_READY).await;
            let ready = place(&dir, "ready.sh", READY).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = Arc::new(EngineAnalyzer::new(Arc::clone(&registry)));

            let first = {
                let analyzer = Arc::clone(&analyzer);
                tokio::spawn(async move {
                    analyzer
                        .start_engine(engine(&silent), &StartInput::default(), 3)
                        .await
                })
            };
            wait_until(|| async { !registry.ids().await.is_empty() }).await;

            let info = analyzer
                .start_engine(engine(&ready), &StartInput::default(), 4)
                .await
                .expect("後の起動は通る");
            assert_eq!(info.info.name, "Ready");

            let first = tokio::time::timeout(Duration::from_secs(10), first)
                .await
                .expect("前の起動の待ちが解けない")
                .expect("タスク");
            assert!(
                matches!(first, Err(EngineError::Cancelled(_))),
                "前の起動が取り消されていない: {first:?}"
            );
            let ids = registry.ids().await;
            assert_eq!(ids.len(), 1, "残っているプロセスが1本でない: {ids:?}");
            assert_eq!(analyzer.engine_id.read().await.as_ref(), ids.first());

            analyzer.shutdown(10).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `usi` を受けたら印を置き、答えない台本
        const NEVER_USIOK: &str = r#"while read line; do
  case "$line" in
    usi) touch saw-usi ;;
  esac
done"#;

        /// `usiok` を待っている間に止めたら、待ちの上限（`USI_OK_TIMEOUT`）を待たずに
        /// 取り消しで返り、起動中のプロセスも残さない
        #[tokio::test]
        async fn stopping_before_usiok_cancels_without_waiting_for_the_limit() {
            let dir = test_support::dir::temp_dir("analyzer-start-before-usiok");
            let path = place(&dir, "mute.sh", NEVER_USIOK).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = Arc::new(EngineAnalyzer::new(Arc::clone(&registry)));

            let starting = {
                let analyzer = Arc::clone(&analyzer);
                let path = path.clone();
                tokio::spawn(async move {
                    analyzer
                        .start_engine(engine(&path), &StartInput::default(), 5)
                        .await
                })
            };
            let saw_usi = dir.join("saw-usi");
            wait_until(|| {
                let saw_usi = saw_usi.clone();
                async move { saw_usi.exists() }
            })
            .await;
            analyzer.shutdown(11).await.expect("止められる");

            assert!(
                Duration::from_secs(10) < USI_OK_TIMEOUT,
                "待ちの上限より先に諦めていない"
            );
            let result = tokio::time::timeout(Duration::from_secs(10), starting)
                .await
                .expect("止めても `usiok` の待ちが解けない")
                .expect("タスク");
            assert!(
                matches!(result, Err(EngineError::Cancelled(_))),
                "取り消しとして返っていない: {result:?}"
            );
            assert!(
                registry.ids().await.is_empty(),
                "起動中のプロセスが台帳に載っている"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 送れない値の起動も、前の起動を取り消してから断る。利用者は既に別の設定へ移っており、
        /// 断るだけだと前の起動が `engine_id` に載って、フロントの失敗と並んで動き続ける
        #[tokio::test]
        async fn an_unsendable_option_still_replaces_the_start_in_flight() {
            let dir = test_support::dir::temp_dir("analyzer-start-invalid");
            let path = place(&dir, "silent.sh", NEVER_READY).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = Arc::new(EngineAnalyzer::new(Arc::clone(&registry)));

            let first = {
                let analyzer = Arc::clone(&analyzer);
                let path = path.clone();
                tokio::spawn(async move {
                    analyzer
                        .start_engine(engine(&path), &StartInput::default(), 1)
                        .await
                })
            };
            wait_until(|| async { !registry.ids().await.is_empty() }).await;

            let broken = SetOptionValue {
                name: "EvalDir".to_string(),
                value: "/eval\nquit".to_string(),
            };
            let error = analyzer
                .start_engine(
                    engine(&path),
                    &StartInput {
                        values: vec![broken],
                        ..StartInput::default()
                    },
                    2,
                )
                .await
                .expect_err("改行を含む値を通している");
            assert!(matches!(error, EngineError::InvalidState(_)), "{error}");

            let first = tokio::time::timeout(Duration::from_secs(10), first)
                .await
                .expect("前の起動の待ちが解けない")
                .expect("タスク");
            assert!(
                matches!(first, Err(EngineError::Cancelled(_))),
                "前の起動が取り消されていない: {first:?}"
            );
            assert!(registry.ids().await.is_empty(), "前の起動が残っている");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 既に受けた要求より古い起動は、何もせずに断る（`Request`）。Rust に着く順が
        /// 撃った順と逆になっても、フロントが捨てた古い起動が動いているエンジンを落とさない
        #[tokio::test]
        async fn an_older_start_request_does_not_replace_a_newer_one() {
            let dir = test_support::dir::temp_dir("analyzer-start-stale");
            let path = place(&dir, "ready.sh", READY).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = EngineAnalyzer::new(Arc::clone(&registry));

            analyzer
                .start_engine(engine(&path), &StartInput::default(), 5)
                .await
                .expect("起動できる");
            let before = registry.ids().await;

            let stale = analyzer
                .start_engine(engine(&path), &StartInput::default(), 3)
                .await;
            assert!(
                matches!(stale, Err(EngineError::Cancelled(_))),
                "古い要求が通っている: {stale:?}"
            );
            assert_eq!(
                registry.ids().await,
                before,
                "古い要求が動いているエンジンを入れ替えた"
            );

            // 古い停止も効かない
            analyzer.shutdown(4).await.expect("断るだけ");
            assert_eq!(
                registry.ids().await,
                before,
                "古い停止が動いているエンジンを落とした"
            );
            assert!(
                analyzer.protocol().await.is_ok(),
                "`engine_id` から外れている"
            );

            analyzer.shutdown(6).await.expect("落とせる");
            assert!(registry.ids().await.is_empty());
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 載せたプロセスを起動した要求の番号を返す（`started_by`）。世代でも、最後に受けた要求でもない
        #[tokio::test]
        async fn started_by_names_the_request_that_started_the_running_engine() {
            let dir = test_support::dir::temp_dir("analyzer-started-by");
            let path = place(&dir, "ready.sh", READY).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = EngineAnalyzer::new(Arc::clone(&registry));

            for request in [5, 9] {
                analyzer
                    .start_engine(engine(&path), &StartInput::default(), request)
                    .await
                    .expect("起動できる");
                assert_eq!(analyzer.started_by().await, request);
            }

            let stale = analyzer
                .start_engine(engine(&path), &StartInput::default(), 7)
                .await;
            assert!(matches!(stale, Err(EngineError::Cancelled(_))), "{stale:?}");
            assert_eq!(
                analyzer.started_by().await,
                9,
                "断った要求の番号を名乗っている"
            );

            analyzer.shutdown(10).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `EvalFile` を申告し、受けた行と cwd を書き残す台本（zermelo の形）
        const LOGS_WHAT_IT_GETS: &str = r#"pwd > cwd.txt
while read line; do
  echo "$line" >> got.txt
  case "$line" in
    usi) printf 'id name Logged\noption name EvalFile type string default \noption name USI_Ponder type check default false\nusiok\n' ;;
    isready) echo readyok ;;
  esac
done"#;

        /// 評価関数は**申告した名前で**届き（`EvalFile` を申告するエンジンに `EvalDir` を送らない）、
        /// cwd は実行ファイルのフォルダ
        #[tokio::test]
        async fn the_eval_goes_by_the_declared_name_and_cwd_is_the_engine_folder() {
            let dir = test_support::dir::temp_dir("analyzer-start-binding");
            let path = place(&dir, "logged.sh", LOGS_WHAT_IT_GETS).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = EngineAnalyzer::new(Arc::clone(&registry));

            let input = StartInput {
                values: vec![SetOptionValue {
                    name: "Unknown".to_string(),
                    value: "1".to_string(),
                }],
                eval_path: Some("/ai/zermelo/eval/model.bin".to_string()),
                book: None,
            };
            let outcome = analyzer
                .start_engine(engine(&path), &input, 1)
                .await
                .expect("起動できる");

            let got = std::fs::read_to_string(dir.join("got.txt")).expect("受けた行");
            assert!(
                got.contains("setoption name EvalFile value /ai/zermelo/eval/model.bin"),
                "{got}"
            );
            assert!(
                !got.contains("EvalDir"),
                "申告に無い名前を送っている: {got}"
            );
            assert!(
                !got.contains("Unknown"),
                "申告に無い利用者の値を送っている: {got}"
            );
            assert!(outcome.warnings.contains(&StartWarning::NotDeclared {
                name: "Unknown".to_string()
            }));
            let cwd = std::fs::read_to_string(dir.join("cwd.txt")).expect("cwd");
            assert_eq!(
                std::fs::canonicalize(cwd.trim()).expect("cwd"),
                std::fs::canonicalize(&dir).expect("dir"),
                "cwd が実行ファイルのフォルダでない"
            );

            analyzer.shutdown(2).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `BookDir` と選択肢の `BookFile` を申告し、受けた行を書き残す台本。`mode` で定跡まわりの答え方を変える:
        /// `reject`（V9.00: 選択肢に無い `BookFile` に `combo value not found`）、`read`（V8.30: 黙って受け、
        /// `isready` で `read book file : <パス>`）、`cantread`（受けて `can't read file : <パス>`）、
        /// `silent`（受けて何も言わない）、`noanswer`（2回目の `usi` に答えない）、`exit`（確かめで落ちる）
        fn book_engine(mode: &str) -> String {
            format!(
                r#"MODE={mode}
N=0
V=
while read line; do
  echo "$line" >> got.txt
  case "$line" in
    usi)
      N=$((N+1))
      if [ "$N" -gt 1 ] && [ "$MODE" = noanswer ]; then continue; fi
      printf 'id name Book\noption name BookDir type string default book\noption name BookFile type combo default standard_book.db var no_book var standard_book.db var user_book1.db\noption name USI_OwnBook type check default true\nusiok\n' ;;
    "setoption name BookFile value no_book"|"setoption name BookFile value standard_book.db"|"setoption name BookFile value user_book1.db") V= ;;
    "setoption name BookFile value "*)
      V="${{line#setoption name BookFile value }}"
      case "$MODE" in
        reject) echo "info string Error! : combo value not found, value = x" ;;
        exit) echo boom >&2; exit 1 ;;
      esac ;;
    isready)
      if [ -n "$V" ]; then
        case "$MODE" in
          read) echo "info string read book file : $V" ;;
          cantread) echo "info string Error! : can't read file : $V" ;;
        esac
      fi
      echo readyok ;;
  esac
done"#
            )
        }

        fn mybook() -> StartInput {
            StartInput {
                book: Some(BookChoice {
                    path: "/ai/li/book/mybook.db".to_string(),
                    use_in_analysis: true,
                }),
                ..StartInput::default()
            }
        }

        /// 選択肢に無い名前の定跡は、**その回のプロセスに**パスを受けるかを確かめてから送り、送ったら
        /// 読めたかを `readyok` までの出力で確かめる。どの答え方でも黙って別の定跡で動かさない
        #[tokio::test]
        async fn a_book_outside_the_vars_is_sent_as_a_path_only_when_it_is_accepted_and_read() {
            let file = || "mybook.db".to_string();
            for (mode, sent_path, warning) in [
                (
                    "reject",
                    false,
                    Some(StartWarning::BookNameNotInVars { file: file() }),
                ),
                ("read", true, None),
                (
                    "cantread",
                    true,
                    Some(StartWarning::BookNotLoaded { file: file() }),
                ),
                (
                    "silent",
                    true,
                    Some(StartWarning::BookLoadUnconfirmed { file: file() }),
                ),
            ] {
                let dir = test_support::dir::temp_dir("analyzer-start-book-path");
                let path = place(&dir, "book.sh", &book_engine(mode)).await;
                let registry = Arc::new(EngineRegistry::new());
                let analyzer = EngineAnalyzer::new(Arc::clone(&registry));

                let outcome = analyzer
                    .start_engine(engine(&path), &mybook(), 1)
                    .await
                    .expect("起動できる");

                let got = std::fs::read_to_string(dir.join("got.txt")).expect("受けた行");
                assert_eq!(
                    got.contains("setoption name BookFile value /ai/li/book/mybook.db"),
                    sent_path,
                    "{mode}: {got}"
                );
                let book_warnings: Vec<&StartWarning> = outcome
                    .warnings
                    .iter()
                    .filter(|w| {
                        matches!(
                            w,
                            StartWarning::BookNameNotInVars { .. }
                                | StartWarning::BookNotLoaded { .. }
                                | StartWarning::BookLoadUnconfirmed { .. }
                                | StartWarning::BookPathCheckTimedOut { .. }
                        )
                    })
                    .collect();
                assert_eq!(book_warnings, warning.iter().collect::<Vec<_>>(), "{mode}");

                analyzer.shutdown(2).await.expect("落とせる");
                let _ = std::fs::remove_dir_all(&dir);
            }
        }

        /// 2回目の `usi` に答えないエンジンは、上限で「答えなかった」として定跡を切り、名前の問題とは別の
        /// 警告で知らせる（`BOOK_PATH_CHECK_LIMIT` ぶん待つ）
        #[tokio::test]
        async fn no_answer_to_the_path_check_switches_the_book_off_with_its_own_warning() {
            let dir = test_support::dir::temp_dir("analyzer-start-book-noanswer");
            let path = place(&dir, "book.sh", &book_engine("noanswer")).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = EngineAnalyzer::new(Arc::clone(&registry));

            let outcome = analyzer
                .start_engine(engine(&path), &mybook(), 1)
                .await
                .expect("起動できる");

            assert!(
                outcome
                    .warnings
                    .contains(&StartWarning::BookPathCheckTimedOut {
                        file: "mybook.db".to_string()
                    }),
                "{:?}",
                outcome.warnings
            );
            analyzer.shutdown(2).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 確かめの途中で落ちたら、起動の他の段と同じく直近の出力（stderr）を添えて断る
        #[tokio::test]
        async fn an_engine_that_dies_during_the_path_check_fails_with_its_output() {
            let dir = test_support::dir::temp_dir("analyzer-start-book-exit");
            let path = place(&dir, "book.sh", &book_engine("exit")).await;
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = EngineAnalyzer::new(Arc::clone(&registry));

            let failed = analyzer.start_engine(engine(&path), &mybook(), 1).await;
            let message = format!("{:?}", failed.expect_err("落ちる"));
            assert!(message.contains("boom"), "{message}");
            assert!(registry.ids().await.is_empty(), "プロセスが残っている");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 評価関数・定跡のパスも、改行を含めば**起こす前に**断る（`setoption` の値として送るので）
        #[tokio::test]
        async fn a_path_with_a_newline_is_refused_before_starting() {
            let dir = test_support::dir::temp_dir("analyzer-start-bad-path");
            // 起きたら印を置く台本（起こしてから断ると、落としても印が残る）
            let path = place(&dir, "marked.sh", &format!("touch started\n{READY}")).await;
            let _ = std::fs::remove_file(dir.join("started"));
            let registry = Arc::new(EngineRegistry::new());
            let analyzer = EngineAnalyzer::new(Arc::clone(&registry));

            for input in [
                StartInput {
                    eval_path: Some("/ai/e\nquit/nn.bin".to_string()),
                    ..StartInput::default()
                },
                StartInput {
                    book: Some(BookChoice {
                        path: "/ai/b\nquit.db".to_string(),
                        use_in_analysis: true,
                    }),
                    ..StartInput::default()
                },
            ] {
                let error = analyzer
                    .start_engine(engine(&path), &input, 1)
                    .await
                    .expect_err("改行を含むパスを通している");
                assert!(matches!(error, EngineError::InvalidState(_)), "{error}");
                assert!(
                    registry.ids().await.is_empty(),
                    "断る前にエンジンを起こしている"
                );
                assert!(
                    !dir.join("started").exists(),
                    "断る前にエンジンを起こしている"
                );
            }
            let _ = std::fs::remove_dir_all(&dir);
        }

        async fn wait_until<F, Fut>(condition: F)
        where
            F: Fn() -> Fut,
            Fut: std::future::Future<Output = bool>,
        {
            for _ in 0..500 {
                if condition().await {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("上限内に条件が満たされない");
        }
    }
    /// 時間と深度を決めた検討を実プロセスで確かめる（`docs/state-transitions/engine.md` の T7・T8）
    #[cfg(unix)]
    mod searching {
        use super::*;
        use crate::engine::registry::script::place_script as place;

        /// 受けた行を `seen.log` に残し、`go` と `stop` の答えを差し替える台本
        fn script(on_go: &str, on_stop: &str) -> String {
            format!(
                r#"while read line; do
  echo "$line" >> seen.log
  case "$line" in
    usi) printf 'id name Searching\nusiok\n' ;;
    isready) echo readyok ;;
    go*) {on_go} ;;
    stop) {on_stop} ;;
  esac
done"#
            )
        }

        async fn started(name: &str, body: &str) -> (EngineAnalyzer, std::path::PathBuf) {
            let dir = test_support::dir::temp_dir(name);
            let path = place(&dir, "engine.sh", body).await;
            let analyzer = EngineAnalyzer::new(Arc::new(EngineRegistry::new()));
            analyzer
                .start_engine(path.to_str().expect("パス"), &StartInput::default(), 1)
                .await
                .expect("起動できる");
            analyzer
                .set_position("startpos")
                .await
                .expect("局面を覚える");
            (analyzer, dir)
        }

        fn seen(dir: &std::path::Path) -> String {
            std::fs::read_to_string(dir.join("seen.log")).unwrap_or_default()
        }

        /// (Q3, L7): 時間を決めた検討は、その探索の `bestmove` で結果を返す。
        ///
        /// **上限を待たずに返ることを見る。** 検討の上限（30秒）より外側の上限（10秒）を短く
        /// 取ってあるので、`bestmove` で抜けずに上限まで待つ実装は外側の上限で落ちる。
        /// `stop` の断言は別のことを見る: `bestmove` を受けた後に要らない `stop` を書かないこと
        #[tokio::test]
        async fn a_timed_analysis_returns_at_its_bestmove() {
            let body = script(
                "echo 'info depth 5 multipv 1 score cp 42 pv 2g2f 8c8d'; echo 'bestmove 2g2f ponder 8c8d'",
                ":",
            );
            let (analyzer, dir) = started("analyzer-timed", &body).await;

            let result = tokio::time::timeout(
                Duration::from_secs(10),
                analyzer.analyze_with_time(Duration::from_secs(30)),
            )
            .await
            .expect("`bestmove` を受けても返らない")
            .expect("結果が返る");

            let best = result.candidates.first().expect("候補手が無い");
            assert_eq!(best.first_move.as_deref(), Some("2g2f"));
            assert_eq!(best.depth, Some(5));
            assert!(
                !seen(&dir).lines().any(|l| l == "stop"),
                "`bestmove` を待たずに止めている: {}",
                seen(&dir)
            );
            analyzer.shutdown(2).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (Q3, L5) (Q3, R7): 深度を決めた検討は、目標の深度の `info` を受けたら `stop` を書き、
        /// その答えの `bestmove` で結果を返す。
        ///
        /// **台本は `stop` を受けるまで `bestmove` を書かない。** 書くと、深度を見て止めたのか
        /// エンジンが自分で終えたのかが分からない。止めないと時間の上限（`DEPTH_ANALYSIS_BUDGET`）まで
        /// 返らないので、外側の上限で落ちる
        #[tokio::test]
        async fn a_depth_analysis_stops_when_the_depth_is_reached() {
            // 探索は後ろで走らせ、`go` の後も行を読み続ける。前で書き切ると、早く書かれた
            // `stop` もパイプに溜まって深さ3の後に読まれ、深さを見て止めたのかが分からない。
            // 深さ3を書く直前に印（`emitted3`）を残し、`stop` がその後に来たことを見る
            let body = script(
                "{ echo 'info depth 1 multipv 1 score cp 10 pv 7g7f'; \
                   echo 'info depth 2 multipv 1 score cp 20 pv 7g7f 3c3d'; \
                   sleep 0.3; echo emitted3 >> seen.log; \
                   echo 'info depth 3 multipv 1 score cp 30 pv 2g2f 8c8d 2f2e'; } &",
                "wait; echo 'bestmove 2g2f'",
            );
            let (analyzer, dir) = started("analyzer-depth", &body).await;

            let outcome =
                tokio::time::timeout(Duration::from_secs(10), analyzer.analyze_with_depth(3))
                    .await
                    .expect("目標の深度に届いても止めていない")
                    .expect("結果が返る");

            assert!(outcome.reached, "届いたのに届いていないと言う");
            assert_eq!(outcome.deepest, Some(3));
            assert_eq!(
                outcome
                    .result
                    .candidates
                    .first()
                    .and_then(|c| c.first_move.as_deref()),
                Some("2g2f")
            );
            let seen = seen(&dir);
            let lines: Vec<&str> = seen.lines().collect();
            let emitted = lines
                .iter()
                .position(|l| *l == "emitted3")
                .unwrap_or_else(|| panic!("台本が深さ3を書いていない: {seen}"));
            let stop = lines
                .iter()
                .position(|l| *l == "stop")
                .unwrap_or_else(|| panic!("`stop` を書いていない: {seen}"));
            assert!(
                emitted < stop,
                "目標の深度に届く前に `stop` を書いている: {seen}"
            );
            analyzer.shutdown(2).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 時間を決めた検討の止めに上限まで答えなければ、遅れた答えが来るまで次の `go` を通さない。
        ///
        /// 通すと、遅れた `bestmove` が次の探索の答えとして読まれる
        #[tokio::test]
        async fn a_timed_analysis_unanswered_at_its_stop_holds_back_the_next_go() {
            let body = script(":", "(sleep 4; echo 'bestmove 2g2f') &");
            let (analyzer, dir) = started("analyzer-timed-late", &body).await;

            let timed = analyzer.analyze_with_time(Duration::from_secs(1)).await;
            assert!(matches!(timed, Err(EngineError::Timeout(_))), "{timed:?}");
            assert!(
                analyzer.start_infinite_analysis().await.is_err(),
                "止めに答えていないエンジンへ `go` を通している"
            );

            let answered =
                tokio::time::timeout(Duration::from_secs(10), analyzer.watch_answered()).await;
            // 中身は `()` なので、上限で切れたかだけを見る
            let Ok(()) = answered else {
                panic!("遅れた答えの後も印が下りない: {}", seen(&dir));
            };
            assert!(
                analyzer.start_infinite_analysis().await.is_ok(),
                "答えがあったのに次を読ませない"
            );
            analyzer.shutdown(2).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
