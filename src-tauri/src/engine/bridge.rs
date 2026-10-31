use crate::engine::utils::{shown, MAX_SUMMARY_LEN};

use super::analyzer::{
    AnalysisStreamItem, DepthOutcome, EngineAnalyzer, Request, StartInput, MAX_THINK_TIME,
};
use super::registry::EngineRegistry;
use super::start_failure;
use super::types::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, RwLock};

const LOGT: &str = "obs_shogi::engine::bridge";

/// Tauriコマンドとエンジン機能の橋渡し
pub struct EngineBridge {
    analyzer: EngineAnalyzer,
    active_sessions: Arc<RwLock<HashMap<String, AnalysisSession>>>,
    events: Arc<RwLock<Arc<dyn AnalysisEventSink>>>,
    /// いま動いているプロセスを起動した要求の番号。`stop` の通知に載せる
    started_by: AtomicU64,
    /// 開始と停止を1本ずつ通す。**開始の途中（席を取ってから `go` が線に出るまで）に停止が
    /// 割り込むと、席だけ消えてエンジンが読み続ける。** 順序をフロントの握手に頼らない
    search_turn: Mutex<()>,
}

/// 走っている解析1本ぶんの記録。**`active_sessions` の値**（鍵は `session_id`）。
///
/// この1エントリを「席」と呼ぶ（doc とフロントも同じ語を使う）。**席は同時に1つだけ。**
///
/// 持っているのは、そのセッションで最後に受け取った結果だけ。
///
/// **「解析中か」を表す欄は無い。** 走っているかどうかは
/// **`active_sessions` に居るかどうか**で表す。欄にすると同じことを2通りで
/// 表すことになり、片方だけ動いたとき（居るのに `false`、消えたのに `true`）を
/// 誰も検出できない。終わったセッションは席ごと消す。
#[derive(Debug)]
struct AnalysisSession {
    last_result: Option<AnalysisResult>,
}

/// 走っている解析の種類。**`session_id` の接頭辞になる。**
///
/// `#[allow(dead_code)]` を付けないこと。付けると「この種類でセッションを
/// 開く口が1つも無い」——どこかの入口がセッションを登録せずに解析を
/// 始めている——が黙って通る。
#[derive(Debug, Clone)]
enum SessionType {
    Infinite,
    Timed(Duration),
    Depth(u32),
}

/// `session_id` を作る。**種類と打ち切り条件が接頭辞に出る。**
///
/// 条件まで出すのは、同じ局面に対する `timed` と `depth` のセッションが
/// ログ上で見分けられないと、どちらが残ったのかを後から追えないため。
///
/// 副産物として `SessionType` の payload をここで必ず読むので、
/// `Timed` と `Depth` の中身が dead code に戻らない（→ `SessionType` の doc）。
fn new_session_id(session_type: &SessionType) -> String {
    let prefix = match session_type {
        SessionType::Infinite => "infinite".to_string(),
        SessionType::Timed(limit) => format!("timed{}s", limit.as_secs()),
        SessionType::Depth(depth) => format!("depth{depth}"),
    };
    format!("{}_{}", prefix, uuid::Uuid::new_v4())
}

/// 停止を受け取ったことを記録する1行。
///
/// **フロントから来た綴りを、そのままログへ流さない。** `session_id` も `by` も
/// 同じ `invoke` の引数で、産地は webview。改行を通すとその後ろに好きなログ行を作れ、
/// 長さの上限が無いと1回の呼びで `LOG_FILE_BUDGET` を何周もできる——
/// **席が在ったのかどうかを後から言える記録**を、その1本で流し切れる。
///
/// **潰すのは載せる値だけ。** 照合（`sessions.remove`）には生の `session_id` を渡すこと
/// ——文字数で切るので、上限より長い ID を先に潰すと照合が永久に外れる。
///
/// **行を組むのはこの関数だけ。** テストがここを通らないと、入口の潰しを外す変異が
/// 素通りする（`engine::registry` の `spawn_ok_line` と同じ形）。
fn stop_start_line(session_id: &str, by: &str) -> String {
    format!(
        "stop_session: start session_id='{}' by='{}'",
        shown(session_id, MAX_SUMMARY_LEN),
        shown(by, MAX_SUMMARY_LEN)
    )
}

impl EngineBridge {
    pub fn new(registry: Arc<EngineRegistry>) -> Self {
        Self {
            analyzer: EngineAnalyzer::new(registry),
            active_sessions: Arc::new(RwLock::new(HashMap::new())),
            events: Arc::new(RwLock::new(Arc::new(DiscardAnalysisEvents))),
            started_by: AtomicU64::new(0),
            search_turn: Mutex::new(()),
        }
    }

    /// 出来事の宛先を差し替える。アプリの起動時に1回（`lib.rs`）
    pub async fn set_events(&self, events: Arc<dyn AnalysisEventSink>) {
        *self.events.write().await = events;
    }

    /// 解析の席（`active_sessions`）を全部空ける。エンジンを起こし直す前に、起動を試みる前に通す。
    ///
    /// フロントの後始末を当てにできない口が在るため——ワークスペースの切り替えは
    /// webview をリロードするので、React の cleanup が1つも走らないまま席が残る
    /// （クラッシュでも同じ）。残すと以後の `take_session` が全部断り、
    /// 利用者には「▶ を押しても何も起きない」としか見えない。
    ///
    /// **起動より前に呼ぶこと。** 起動が落ちた回に席を残すと、そのまま次の解析が
    /// 断られる——落ちた回こそ空けておく必要がある。
    async fn release_sessions(&self, what: &str) {
        // 席を捨ててから、呼び手の起動（`EngineAnalyzer::start_engine`）が古いプロセスを畳む。
        // **この間だけ「席は空・古いエンジンはまだ読んでいる」になる。** 畳むほうが直後に
        // 殺すので短いが、**順序を「畳んでから捨てる」に変えないこと**——落ちた回に
        // 席が残り、そのまま次の解析が断られる。
        let stale: Vec<String> = self
            .active_sessions
            .write()
            .await
            .drain()
            .map(|(id, _)| id)
            .collect();
        if !stale.is_empty() {
            log::warn!(
                target: LOGT,
                "{what}: dropped {} stale session(s) {:?}",
                stale.len(),
                stale
            );
        }
    }

    /// 解析用のエンジンを起こし、設定を送って `readyok` まで待つ（`EngineAnalyzer::start_engine`）。
    ///
    /// 席は先に空ける（`release_sessions`）。失敗は種類に分けて返す
    /// （`start_failure::describe`）。画面の文言は種類から組み、`message` はログにだけ使う。
    ///
    /// `request` は順序の番号（`analyzer::Request`）。既に新しい要求を受けていれば、席にも
    /// 触らずに `Cancelled` で返す
    pub async fn start_analysis_engine_impl(
        &self,
        engine_path: String,
        input: StartInput,
        request: Request,
    ) -> Result<StartOutcome, StartFailure> {
        log::info!(target: LOGT, "start_analysis_engine: start");
        if self.analyzer.is_superseded(request).await {
            log::info!(target: LOGT, "start_analysis_engine: superseded");
            return Err(start_failure::classify(
                &EngineError::Cancelled("a newer request was already received".to_string()),
                false,
            ));
        }
        self.release_sessions("start_analysis_engine").await;

        let started = self
            .analyzer
            .start_engine(&engine_path, &input, request)
            .await;
        match started {
            Ok(outcome) => {
                log::info!(
                    target: LOGT,
                    "start_analysis_engine: ok ({} warning(s))",
                    outcome.warnings.len()
                );
                self.started_by.store(request, Ordering::Relaxed);
                self.watch_engine_end(request).await;
                Ok(outcome)
            }
            Err(e) => {
                let failure = start_failure::describe(&e, &engine_path).await;
                if failure.kind == StartFailureKind::Cancelled {
                    log::info!(target: LOGT, "start_analysis_engine: cancelled: {}", failure.message);
                } else {
                    log::error!(
                        target: LOGT,
                        "start_analysis_engine: failed: {:?}: {}",
                        failure.kind,
                        failure.message
                    );
                }
                Err(failure)
            }
        }
    }

    /// 起動を終えたプロセスの終わりを見張り、自分で終わったらフロントへ知らせる。
    ///
    /// **`readyok` の直後に終わったプロセスも取りこぼさない。** 見張りは今の状態から見るので、
    /// ここへ来る前に閉じていればその場で知らせる。そのとき通知は起動の応答より先に着くので、
    /// 受け手が順序を吸収する（`entities/engine` の provider）。
    ///
    /// 起動の直後に次の起動が割り込むと、新しいプロセスを古い番号で見張ることがある。
    /// 古い番号の通知はフロントが捨てるので、取り違えにはならない
    async fn watch_engine_end(&self, request: Request) {
        let Some(mut watch) = self.analyzer.end_watch().await else {
            return;
        };
        let events = Arc::clone(&self.events);
        tokio::spawn(async move {
            match watch.wait().await {
                EngineEnd::Exited => {
                    log::warn!(target: LOGT, "engine exited on its own request={request}");
                    Self::emit_to(
                        &events,
                        AnalysisEvent::EngineExited(EngineExited {
                            request,
                            last_output: watch.last_output().await,
                        }),
                    )
                    .await;
                }
                EngineEnd::Stalled => {
                    log::warn!(target: LOGT, "engine stopped reading stdin request={request}");
                    let unresponsive = EngineUnresponsive {
                        request,
                        reason: UnresponsiveReason::Unwritable,
                        last_output: watch.last_output().await,
                    };
                    Self::emit_to(&events, AnalysisEvent::EngineUnresponsive(unresponsive)).await;
                }
                EngineEnd::Requested => {}
            }
        });
    }

    /// 解析のセッションを1本登録し、その `session_id` を返す。
    ///
    /// **同時に走らせるのは1本まで。** 既に走っていれば断る。
    ///
    /// 検査と登録を同じロック区間でやる。分けると、2本の `invoke` が
    /// 両方とも「走っていない」を見てから両方とも登録する窓ができ、
    /// **探索中のエンジンへ2本目の `go` が出る**
    /// （USI は探索中の `position` / `go` を認めない）。
    /// 対局側が `Activity` と `Handover` で守っているのと同じ不変条件。
    ///
    /// 解析を始める口は全部ここを通ること。通らない口があると、
    /// その解析が走っている間ずっと「走っていない」に見える。
    async fn take_session(&self, session_type: SessionType) -> Result<String, String> {
        let mut sessions = self.active_sessions.write().await;
        if !sessions.is_empty() {
            return Err("Analysis already running".to_string());
        }

        let session_id = new_session_id(&session_type);
        sessions.insert(session_id.clone(), AnalysisSession { last_result: None });
        Ok(session_id)
    }

    /// セッションを閉じる。**失敗した口も必ず通ること。**
    /// 通らないと席が残り、以後の解析が全部「既に走っている」で断られる
    async fn release_session(&self, session_id: &str) {
        self.active_sessions.write().await.remove(session_id);
    }

    /// 解析用のエンジンを落とす。`request` は順序の番号（`analyzer::Request`）で、既に新しい
    /// 要求を受けていれば何もしない（後から撃たれた起動を落とさない）
    pub async fn shutdown_engine_impl(&self, request: Request) -> Result<(), String> {
        log::info!(target: LOGT, "shutdown_engine: start");
        if self.analyzer.is_superseded(request).await {
            log::info!(target: LOGT, "shutdown_engine: superseded");
            return Ok(());
        }

        let _turn = self.search_turn.lock().await;

        // **止められなくても席の掃除まで進む。** `?` で折れると
        // `engine_id` が `Some` のまま残り、以降どのコマンドも
        // 「Engine is no longer running」を返すだけになる（終了ボタンが直せない）
        if let Err(e) = self.stop_all_sessions("shutdown").await {
            log::warn!(
                target: LOGT,
                "shutdown_engine: could not stop sessions, continuing: {e}"
            );
        }

        match self.analyzer.shutdown(request).await {
            Ok(_) => {
                log::info!(target: LOGT, "shutdown_engine: ok");
                Ok(())
            }
            Err(e) => {
                log::error!(target: LOGT, "shutdown_engine: failed: {:?}", e);
                Err(format!("Engine shutdown failed: {e}"))
            }
        }
    }

    pub async fn set_position_impl(&self, position: String) -> Result<(), String> {
        log::debug!(target: LOGT, "set_position: len={}", position.len());

        self.analyzer.set_position(&position).await.map_err(|e| {
            log::warn!(target: LOGT, "set_position: failed: {:?}", e);
            format!("Position setting failed: {e}")
        })?;

        log::debug!(target: LOGT, "set_position: ok");
        Ok(())
    }

    pub async fn start_infinite_analysis_impl(&self) -> Result<String, StartRefusal> {
        let _turn = self.search_turn.lock().await;

        // **セッションを先に登録する。** 後にすると、走らせている間だけ
        // 「走っていない」に見える
        let session_id = self
            .take_session(SessionType::Infinite)
            .await
            .map_err(|message| {
                log::warn!(target: LOGT, "start_infinite_analysis: rejected: {message}");
                StartRefusal {
                    unreachable: false,
                    message,
                }
            })?;

        log::debug!(target: LOGT, "start_infinite_analysis: requested");

        let result_rx = match self.analyzer.start_infinite_analysis().await {
            Ok(rx) => rx,
            Err(e) => {
                log::error!(
                    target: LOGT,
                    "start_infinite_analysis: analyzer failed: {:?}",
                    e
                );
                self.release_session(&session_id).await;
                return Err(StartRefusal {
                    // 線に届かなかった回。積み置きが満杯の回も `CommunicationFailed` で来るが、
                    // エンジンが答えていないことに変わりはない
                    unreachable: matches!(
                        e,
                        EngineError::CommunicationFailed(_) | EngineError::Timeout(_)
                    ),
                    message: format!("Failed to start infinite analysis: {e}"),
                });
            }
        };

        log::info!(
            target: LOGT,
            "start_infinite_analysis: ok session_id={}",
            session_id
        );

        self.start_result_forwarding(&session_id, result_rx).await;
        Ok(session_id)
    }

    async fn start_result_forwarding(
        &self,
        session_id: &str,
        receiver: mpsc::UnboundedReceiver<AnalysisStreamItem>,
    ) {
        let sessions_clone = Arc::clone(&self.active_sessions);
        let events_clone = Arc::clone(&self.events);
        let session_id_clone = session_id.to_string();

        tokio::spawn(async move {
            Self::forward_results_to_ui(events_clone, sessions_clone, session_id_clone, receiver)
                .await;
        });
    }

    /// 解析の結果をフロントへ流す。
    ///
    /// **席が消えたら流さない。** 消えた席の結果は誰の席でもない。受け取りは続ける——
    /// `receiver` を落としても `process_analysis_stream` が配り先を失うだけで、得るものが無い
    async fn forward_results_to_ui(
        events: Arc<RwLock<Arc<dyn AnalysisEventSink>>>,
        sessions: Arc<RwLock<HashMap<String, AnalysisSession>>>,
        session_id: String,
        mut receiver: mpsc::UnboundedReceiver<AnalysisStreamItem>,
    ) {
        while let Some(item) = receiver.recv().await {
            match item {
                AnalysisStreamItem::Update(result) => {
                    {
                        let mut sessions = sessions.write().await;
                        let Some(session) = sessions.get_mut(&session_id) else {
                            continue;
                        };
                        session.last_result = Some(result.clone());
                    }
                    let update = AnalysisUpdate {
                        session_id: session_id.clone(),
                        result,
                    };
                    Self::emit_to(&events, AnalysisEvent::Update(update)).await;
                }
                // **席を消してから知らせる。** 知らせてから消すと、受け取ったフロントの次の
                // 開始が `take_session` に断られる窓ができる。
                //
                // 席が無いなら `stop` の答え（止める口は席を消してから `stop` を送る）
                AnalysisStreamItem::Finished(result) => {
                    if sessions.write().await.remove(&session_id).is_some() {
                        let update = AnalysisUpdate {
                            session_id: session_id.clone(),
                            result,
                        };
                        Self::emit_to(&events, AnalysisEvent::Complete(update)).await;
                    }
                }
            }
        }

        // **席ごと消す。** 残すと `AnalysisSession.last_result` が候補手と PV を
        // 丸ごと持ったまま溜まる（上限は無い）。居ること自体が「走っている」なので、
        // 終わった席を残すと `take_session` が以後ずっと断ることにもなる。
        //
        // プロセスが終わった回もここを通る。フロントへの知らせは `watch_engine_end` が持つ。
        // 最後の結果は `EngineAnalyzer::get_last_result` が1本だけ持つ
        sessions.write().await.remove(&session_id);
        log::debug!(
            target: LOGT,
            "forward_results: ended session_id={}",
            session_id
        );
    }

    /// 停止の結末を知らせる。**答えが無ければ、遅れて来た答えも見張る。**
    ///
    /// 通知を応答より先に出す。フロントは応答を受けた時点で語を `応答なし` にできる
    ///
    /// `request` は停止を始めた時点の番号。**通知の時点で読まない**——待っている間に
    /// 起動し直すと、古いプロセスの待ちが新しいプロセスを名乗る
    async fn report_stop(&self, outcome: StopOutcome, request: Request) {
        if outcome != StopOutcome::Unanswered {
            return;
        }
        let unresponsive = EngineUnresponsive {
            request,
            reason: UnresponsiveReason::NoAnswer,
            last_output: self.analyzer.last_output().await,
        };
        Self::emit_to(
            &self.events,
            AnalysisEvent::EngineUnresponsive(unresponsive),
        )
        .await;

        let answered = self.analyzer.watch_answered();
        let events = Arc::clone(&self.events);
        tokio::spawn(async move {
            answered.await;
            log::info!(target: LOGT, "engine answered stop late request={request}");
            Self::emit_to(
                &events,
                AnalysisEvent::EngineAnswered(EngineAnswered { request }),
            )
            .await;
        });
    }

    /// 今の宛先へ1件流す。**宛先のロックを握ったまま流さない**
    async fn emit_to(events: &RwLock<Arc<dyn AnalysisEventSink>>, event: AnalysisEvent) {
        let sink = Arc::clone(&*events.read().await);
        sink.emit(event);
    }

    /// 時間指定の解析。
    ///
    /// **考慮時間に上限を掛ける。** `time_seconds` はフロントから来るので、
    /// そのまま渡すと、セッションを1本占めたまま何時間でも戻らない解析を作れてしまう。
    /// 断らずに丸めるのは、上限が「安全のための天井」であって
    /// 利用者の指定が誤りだったわけではないため。
    pub async fn analyze_with_time_impl(
        &self,
        time_seconds: u64,
    ) -> Result<AnalysisResult, String> {
        let duration = Duration::from_secs(time_seconds).min(MAX_THINK_TIME);
        if duration != Duration::from_secs(time_seconds) {
            log::warn!(
                target: LOGT,
                "analyze_with_time: {}s は上限の {}s に丸めた",
                time_seconds,
                MAX_THINK_TIME.as_secs()
            );
        }
        let session_id = self.take_session(SessionType::Timed(duration)).await?;

        let result = self
            .analyzer
            .analyze_with_time(duration)
            .await
            .map_err(|e| format!("Timed analysis failed: {e}"));

        self.release_session(&session_id).await;
        result
    }

    /// 深度指定の解析。
    ///
    /// **目標に届かなくても `Ok` が返る。** 届いたかは `DepthOutcome::reached` にある。
    /// `go depth` は送れない（`usi` crate に手段が無い）ので、届くかは
    /// `DEPTH_ANALYSIS_BUDGET` の中で `info depth` がそこまで伸びるか次第。
    pub async fn analyze_with_depth_impl(&self, depth: u32) -> Result<DepthOutcome, String> {
        let session_id = self.take_session(SessionType::Depth(depth)).await?;

        let result = self
            .analyzer
            .analyze_with_depth(depth)
            .await
            .map_err(|e| format!("Depth analysis failed: {e}"));

        self.release_session(&session_id).await;
        result
    }

    /// 解析を止める。
    ///
    /// **`session_id` を省くと席を全部空ける。** 呼び手が席の ID を持てない場面
    /// （画面が畳まれた後の後始末）は指せないので、この形が要る。
    ///
    /// `by` は**どの口から撃ったか**。ログにだけ出る（意味と値は `stop_all_sessions`）。
    ///
    /// **どちらの枝でも、席は止めるより先に消える。** 指した側の `Err` は2種類——
    /// 照合に落ちた回（席に居るのが別のセッションなので**席は残る**）と、
    /// 席を消した後にエンジンの停止が落ちた回（**席は空**）。省いた側の `Err` は後者だけ。
    /// **フロントからこの2つは区別できない**
    /// （→ `docs/state-transitions/analysis.md` ※12）。
    pub async fn stop_analysis_impl(
        &self,
        session_id: Option<String>,
        by: Option<String>,
    ) -> Result<StopOutcome, String> {
        // 呼び手が名乗らなかったときの既定。**名乗った回と区別できるようにしておく。**
        //
        let by = by.as_deref().unwrap_or("unnamed");
        let _turn = self.search_turn.lock().await;

        if let Some(id) = session_id {
            self.stop_session(&id, by).await
        } else {
            self.stop_all_sessions(by).await
        }
    }

    pub async fn get_analysis_result_impl(
        &self,
        session_id: String,
    ) -> Result<Option<AnalysisResult>, String> {
        let sessions = self.active_sessions.read().await;
        match sessions.get(&session_id) {
            Some(session) => Ok(session.last_result.clone()),
            None => Err("Session not found".to_string()),
        }
    }

    pub async fn get_last_result_impl(&self) -> Result<Option<AnalysisResult>, String> {
        Ok(self.analyzer.get_last_result().await)
    }

    pub async fn get_analysis_status_impl(&self) -> Result<Vec<AnalysisStatus>, String> {
        let analysis_count = self.analyzer.get_analysis_stats().await;
        let sessions = self.active_sessions.read().await;

        let statuses = sessions
            .keys()
            // 席が在る＝走っている。消えたら終わっている
            .map(|id| AnalysisStatus {
                is_analyzing: true,
                session_id: Some(id.clone()),
                elapsed_time: None,
                config: None,
                analysis_count,
            })
            .collect();

        Ok(statuses)
    }

    // ===  session === //

    async fn stop_session(&self, session_id: &str, by: &str) -> Result<StopOutcome, String> {
        log::info!(target: LOGT, "{}", stop_start_line(session_id, by));

        // **他人のセッションは止めない。** `session_id` はフロントから来る任意の文字列で、
        // フロントはエラーの後も `sessionId` を握り続ける
        // （`docs/state-transitions/analysis.md` の ※1）。照合しないと、
        // 前の解析の ID を握ったままの画面が「停止」を撃ったときに
        // **いま走っている別の解析が止まって `Ok` が返る**。
        //
        // **「もう無い」は失敗にしない。** エンジンが落ちると
        // `forward_results_to_ui` が席を消す。その知らせと「停止」は行き違うので、
        // `sessionId` を握ったまま「停止」が来る。ここで `Err` にすると
        // 呼び出し側の再開が `catch` に落ち、**解析が始まり直さない**。
        // 要求は「止まっていること」で、席が無いならその要求は満たせている
        // （`EngineAnalyzer::stop_analysis` と同じ立場）。
        {
            let mut sessions = self.active_sessions.write().await;
            match sessions.remove(session_id) {
                Some(_) => {}
                None if sessions.is_empty() => {
                    log::debug!(
                        target: LOGT,
                        "stop_session: already gone id='{}'",
                        shown(session_id, MAX_SUMMARY_LEN)
                    );
                }
                // 別のセッションが走っている。撃った側のものではないので触らない
                None => {
                    log::warn!(
                        target: LOGT,
                        "stop_session: not the running one id='{}'",
                        shown(session_id, MAX_SUMMARY_LEN)
                    );
                    return Err(format!(
                        "unknown analysis session: {}",
                        shown(session_id, MAX_SUMMARY_LEN)
                    ));
                }
            }
        }

        let request = self.started_by.load(Ordering::Relaxed);
        let outcome = self.analyzer.stop_analysis().await.map_err(|e| {
            log::error!(target: LOGT, "stop_session: analyzer stop failed: {e}");
            format!("Failed to stop analysis: {e}")
        })?;
        self.report_stop(outcome, request).await;

        log::info!(
            target: LOGT,
            "stop_session: {outcome:?} session_id='{}'",
            shown(session_id, MAX_SUMMARY_LEN)
        );
        Ok(outcome)
    }

    /// 席を全部空ける。
    ///
    /// `by` は**どの口から撃ったか**。フロントの `stop_analysis` が名乗った値、
    /// `shutdown_engine` からの `"shutdown"`、名乗らなかった回の `"unnamed"`
    /// （`stop_analysis_impl`）の3通り。畳まれた画面から来た停止は、失敗しても
    /// 利用者にも開発者にも出せない（出す先の画面がもう無い）ので、
    /// **席が在ったのかどうかを後から言えるのはこのログだけ**。
    /// エンジンの入れ替えで空いた回や利用者が押した停止と字面が同じだと、
    /// #441 の再発を追う人が取り違える。
    async fn stop_all_sessions(&self, by: &str) -> Result<StopOutcome, String> {
        log::info!(target: LOGT, "stop_all_sessions: start by={by}");

        let cleared: Vec<String> = self
            .active_sessions
            .write()
            .await
            .drain()
            .map(|(id, _)| id)
            .collect();
        log::info!(
            target: LOGT,
            "stop_all_sessions: by={} cleared {} session(s) {:?}",
            by,
            cleared.len(),
            cleared
        );

        let request = self.started_by.load(Ordering::Relaxed);
        let outcome = self.analyzer.stop_analysis().await.map_err(|e| {
            log::error!(
                target: LOGT,
                "stop_all_sessions: by={} analyzer stop failed: {:?}",
                by,
                e
            );
            format!("Failed to stop all analysis: {e}")
        })?;
        self.report_stop(outcome, request).await;

        log::info!(target: LOGT, "stop_all_sessions: {outcome:?} by={by}");
        Ok(outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::utils::LOG_FILE_BUDGET;

    /// セッションの出し入れだけを見る。**エンジンのプロセスは要らない。**
    ///
    /// 起動しないと `analyzer` の側は動かないが、`take_session` /
    /// `release_session` は `active_sessions` しか触らないので、
    /// ここだけを回せる。回さないと、セッションを閉じ忘れる口が素通りする。
    ///
    /// **停止まで通す検査も回せる。** `analyzer.stop_analysis()` は
    /// エンジンが居なければ `Ok` に落ちる（`analyzer.rs`）ので、席の出入りだけが残る。
    /// 裏を返すと、**ここで見えるのは席の一覧だけ**——エンジンに `stop` が届いたかは
    /// どのテストも見ていない。
    fn bridge() -> EngineBridge {
        EngineBridge::new(Arc::new(EngineRegistry::new()))
    }

    /// 2本目を断ること。
    ///
    /// 断らないと、探索中のエンジンへ2本目の `go` が出る
    /// （USI は探索中の `position` / `go` を認めない）
    #[tokio::test]
    async fn a_second_analysis_is_refused_while_one_holds_the_seat() {
        let bridge = bridge();

        let first = bridge.take_session(SessionType::Infinite).await;
        assert!(first.is_ok());

        let second = bridge
            .take_session(SessionType::Timed(Duration::from_secs(5)))
            .await;
        assert!(second.is_err(), "既に走っているのに2本目を登録できている");
    }

    /// 返せば次が取れること。**返す口が抜けると解析が二度と始まらない**
    #[tokio::test]
    async fn releasing_the_seat_lets_the_next_analysis_in() {
        let bridge = bridge();

        let id = bridge.take_session(SessionType::Depth(20)).await.unwrap();
        bridge.release_session(&id).await;

        assert!(
            bridge.take_session(SessionType::Infinite).await.is_ok(),
            "返したのに次が取れない"
        );
    }

    /// フロントが名乗る `by` が、ログの行を偽造したり予算を流し切ったりしないこと。
    ///
    /// **IPC の境界は素の文字列。** TS 側の型（`SeatReleasePoint`）は閉じた8値だが、
    /// `invoke` はその型を持って来ない。ここが素通しだと、1回の呼びで
    /// `LOG_FILE_BUDGET` を何周もでき、**#441 の再発を追う唯一の記録**
    /// （席が在ったのかどうか）をその1本で流し切れる。改行も同じ1本で通る。
    ///
    /// 同じ形は `registry` が
    /// `the_registry_lines_cannot_rotate_the_log_or_forge_a_line` で押さえている。
    #[tokio::test]
    async fn the_release_point_cannot_rotate_the_log_or_forge_a_line() {
        /// 1行が予算のうち占めてよい割合の逆数
        const SHARE: u128 = 50;

        // 潰されず（制御文字ではない）、UTF-8 でいちばん重い4バイト文字
        let heavy = "\u{10ffff}".repeat(LOG_FILE_BUDGET as usize / 4);
        let forged = "unmount\n[ERROR] forged";

        // **本番が組む行そのものを測る。** `shown` を直に呼ぶと、入口の潰しを
        // 外す変異が素通りする（`engine::registry` の兄弟と同じ形）。
        for raw in [heavy.as_str(), forged] {
            for line in [stop_start_line(raw, "unmount"), stop_start_line("s1", raw)] {
                assert!(
                    !line.contains('\n'),
                    "改行が通っている。偽のログ行を1本作れる: {line:.40}"
                );
                assert!(
                    line.len() as u128 * SHARE <= LOG_FILE_BUDGET,
                    "1回の停止が予算の1/{SHARE} を超える（{} バイト）",
                    line.len()
                );
            }
        }

        // **実在する `session_id` が切れないこと**（＝上限の下側）。切れると、
        // どの席を止めたのかがログから読めなくなる。
        let real = new_session_id(&SessionType::Depth(u32::MAX));
        assert!(
            !stop_start_line(&real, "unmount").contains('…'),
            "実在する session_id が切れている: {real}"
        );
    }

    /// 起こし直しが、残っている席を捨てること。
    ///
    /// **フロントの後始末を当てにできない口が在る**——ワークスペースの切り替えは
    /// webview をリロードするので、React の cleanup が1つも走らないまま席が残る
    /// （クラッシュでも同じ）。残ると以後の `take_session` が全部断り、
    /// 利用者には「▶ を押しても何も起きない」としか見えない。
    ///
    /// **実行ファイルは渡さない。** 起動は落ちてよく、見たいのは席が空くことだけ
    /// ——席を捨てるのは起動を試みる前でなければならない。
    #[tokio::test]
    async fn starting_the_engine_drops_a_seat_that_outlived_the_screen() {
        let bridge = bridge();

        let stale = bridge.take_session(SessionType::Infinite).await.unwrap();
        assert!(!stale.is_empty());

        // 起動そのものは落ちる（実行ファイルが無い）。それでよい。
        let _ = bridge
            .start_analysis_engine_impl("/nonexistent/engine".to_string(), StartInput::default(), 1)
            .await;

        assert!(
            bridge.take_session(SessionType::Infinite).await.is_ok(),
            "起こし直したのに、画面より長生きした席が残っている"
        );
    }

    /// `session_id` が種類と条件を持つこと。
    ///
    /// 持たないと `SessionType` の payload を誰も読まず、
    /// `Timed` と `Depth` の中身が dead code に戻る
    #[tokio::test]
    async fn the_seat_name_carries_what_kind_of_analysis_it_is() {
        let bridge = bridge();

        let id = bridge
            .take_session(SessionType::Timed(Duration::from_secs(30)))
            .await
            .unwrap();
        assert!(
            id.starts_with("timed30s_"),
            "`session_id` が条件を持っていない: {id}"
        );
        bridge.release_session(&id).await;

        let id = bridge.take_session(SessionType::Depth(24)).await.unwrap();
        assert!(
            id.starts_with("depth24_"),
            "`session_id` が条件を持っていない: {id}"
        );
    }

    /// セッションがもう無いときの「停止」を失敗にしないこと。
    ///
    /// エンジンが落ちると `forward_results_to_ui` が席を消す。その知らせと「停止」は
    /// 行き違うので、`sessionId` を握ったまま「停止」が来る。ここで `Err` に
    /// すると、呼び出し側の再開が `catch` に落ちて**解析が始まり直さない**。
    /// 利用者から見ると「解析中」の表示が無言で「停止中」に変わる。
    ///
    /// 要求は「止まっていること」で、席が無いならその要求は満たせている。
    #[tokio::test]
    async fn stopping_a_session_that_is_already_gone_succeeds() {
        let bridge = bridge();

        let id = bridge.take_session(SessionType::Infinite).await.unwrap();
        bridge.release_session(&id).await;

        assert!(
            bridge.stop_session(&id, "test").await.is_ok(),
            "もう無いセッションの停止が失敗している。再開の経路が catch に落ちる"
        );
    }

    /// 知らない ID で他人の解析を止めないこと。
    ///
    /// `session_id` はフロントから来る任意の文字列。照合しないと、
    /// 前の解析の ID を握ったままの画面が「停止」を撃ったときに、
    /// **いま走っている別の解析が止まって `Ok` が返る**
    #[tokio::test]
    async fn stopping_an_unknown_session_does_not_touch_the_running_one() {
        let bridge = bridge();
        let mine = bridge.take_session(SessionType::Infinite).await.unwrap();

        let refused = bridge.stop_session("someone-elses-id", "test").await;
        assert!(refused.is_err(), "知らない ID が成功している");

        assert!(
            bridge.take_session(SessionType::Infinite).await.is_err(),
            "知らない ID で走っているセッションが消えてしまった"
        );
        bridge.release_session(&mine).await;
    }

    /// `session_id` を省いた停止が席を空けること。**見ているのは席の一覧だけ**（→ `bridge`）。
    ///
    /// **席の ID を持てない呼び手が居る。** 画面が畳まれた後の後始末は、
    /// 握っている ID が席の主とずれていることがあるので指せない
    /// （指すと上の照合に断られて席が残る）。この形が空けられなくなると、
    /// 以降の解析が全部「Analysis already running」で断られ、
    /// エンジンを畳み直すまで戻れない。
    #[tokio::test]
    async fn stopping_without_naming_a_session_empties_the_seat() {
        let bridge = bridge();

        bridge.take_session(SessionType::Infinite).await.unwrap();

        assert!(
            bridge.stop_analysis_impl(None, None).await.is_ok(),
            "エンジンが居ないときの停止が失敗している"
        );
        assert!(
            bridge.take_session(SessionType::Infinite).await.is_ok(),
            "指さない停止の後も席が埋まったまま"
        );
    }

    /// 指した停止が、公開している口でも他人の席を触らないこと。
    ///
    /// 照合しているのは `stop_session` だが、**外から通るのは
    /// `stop_analysis_impl`**。ここを通さずに検査していると、
    /// 「`session_id` はログにだけ使い、常に全部止める」に書き換えても緑のまま通る。
    /// そのとき、古い `sessionId` を握った画面の停止が、
    /// **いま走っている別の解析を黙って殺す**。
    #[tokio::test]
    async fn stopping_by_a_stale_name_does_not_touch_the_running_one() {
        let bridge = bridge();
        let mine = bridge.take_session(SessionType::Infinite).await.unwrap();

        let refused = bridge
            .stop_analysis_impl(Some("someone-elses-id".to_string()), None)
            .await;
        assert!(refused.is_err(), "知らない ID が成功している");

        assert!(
            bridge.take_session(SessionType::Infinite).await.is_err(),
            "知らない ID で走っているセッションが消えてしまった"
        );
        bridge.release_session(&mine).await;
    }

    /// 探索とプロセスの終わりが、フロントへ届くこと。
    ///
    /// **見ているのは台本（実プロセス）を通した宛先の記録。** `stop` を送った回と
    /// 送っていない回で知らせが分かれることが要で、席の一覧だけを見ても区別できない。
    #[cfg(unix)]
    mod endings {
        use super::*;
        use crate::engine::registry::script::place_script;
        use std::sync::Mutex;

        #[derive(Default)]
        struct Recorded(Mutex<Vec<AnalysisEvent>>);

        impl AnalysisEventSink for Recorded {
            fn emit(&self, event: AnalysisEvent) {
                self.0.lock().expect("記録").push(event);
            }
        }

        impl Recorded {
            fn completes(&self) -> usize {
                let events = self.0.lock().expect("記録");
                events
                    .iter()
                    .filter(|e| matches!(e, AnalysisEvent::Complete(_)))
                    .count()
            }

            fn exits(&self) -> Vec<EngineExited> {
                let events = self.0.lock().expect("記録");
                events
                    .iter()
                    .filter_map(|e| match e {
                        AnalysisEvent::EngineExited(exited) => Some(exited.clone()),
                        _ => None,
                    })
                    .collect()
            }

            fn unresponsive(&self) -> Vec<EngineUnresponsive> {
                let events = self.0.lock().expect("記録");
                events
                    .iter()
                    .filter_map(|e| match e {
                        AnalysisEvent::EngineUnresponsive(u) => Some(u.clone()),
                        _ => None,
                    })
                    .collect()
            }

            fn answered(&self) -> Vec<EngineAnswered> {
                let events = self.0.lock().expect("記録");
                events
                    .iter()
                    .filter_map(|e| match e {
                        AnalysisEvent::EngineAnswered(a) => Some(a.clone()),
                        _ => None,
                    })
                    .collect()
            }

            fn updates(&self) -> usize {
                let events = self.0.lock().expect("記録");
                events
                    .iter()
                    .filter(|e| matches!(e, AnalysisEvent::Update(_)))
                    .count()
            }
        }

        /// `go` の答えだけを差し替える台本。`stop` には `bestmove` で、`quit` には終了で答える
        fn script(on_go: &str, on_position: &str) -> String {
            script_with(on_go, on_position, "echo 'bestmove 7g7f'", "exit 0")
        }

        /// 受けた行を `seen.log` に残す台本（cwd は実行ファイルのフォルダ）
        fn script_with(on_go: &str, on_position: &str, on_stop: &str, on_quit: &str) -> String {
            format!(
                r#"while read line; do
  echo "$line" >> seen.log
  case "$line" in
    usi) printf 'id name Script\nusiok\n' ;;
    isready) echo readyok ;;
    position*) {on_position} ;;
    go*) echo 'info depth 1 multipv 1 score cp 10 pv 7g7f'; {on_go} ;;
    stop) {on_stop} ;;
    quit) {on_quit} ;;
  esac
done"#
            )
        }

        async fn started(
            name: &str,
            on_go: &str,
            on_position: &str,
            request: Request,
        ) -> (EngineBridge, Arc<Recorded>, std::path::PathBuf) {
            started_as(name, &script(on_go, on_position), request).await
        }

        async fn started_as(
            name: &str,
            body: &str,
            request: Request,
        ) -> (EngineBridge, Arc<Recorded>, std::path::PathBuf) {
            let dir = test_support::dir::temp_dir(name);
            let path = place_script(&dir, "engine.sh", body).await;
            let bridge = bridge();
            let recorded = Arc::new(Recorded::default());
            bridge.set_events(Arc::clone(&recorded) as _).await;
            bridge
                .start_analysis_engine_impl(
                    path.to_str().expect("パス").to_string(),
                    StartInput::default(),
                    request,
                )
                .await
                .expect("起動できる");
            bridge
                .set_position_impl("startpos".to_string())
                .await
                .expect("局面を覚える");
            (bridge, recorded, dir)
        }

        async fn wait_until(what: &str, condition: impl Fn() -> bool) {
            for _ in 0..500 {
                if condition() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("上限内に起きない: {what}");
        }

        /// 少し待っても起きないことを見るときの幅。起きるなら `wait_until` の1周で着く長さ
        const QUIET: Duration = Duration::from_millis(300);

        /// (V3, E9): 頼んでいない `bestmove` は完了で、席が空く。
        ///
        /// **席が空かないと、次の局面の開始が `take_session` に断られる。**
        #[tokio::test]
        async fn a_search_the_engine_ended_itself_is_reported_and_frees_the_seat() {
            let (bridge, recorded, dir) =
                started("bridge-self-finish", "echo 'bestmove 7g7f'", ":", 1).await;

            let id = bridge.start_infinite_analysis_impl().await.expect("始まる");
            wait_until("完了の知らせ", || recorded.completes() == 1).await;

            let events = recorded.0.lock().expect("記録").clone();
            let complete = events.iter().find_map(|e| match e {
                AnalysisEvent::Complete(update) => Some(update.clone()),
                _ => None,
            });
            let complete = complete.expect("完了が記録されている");
            assert_eq!(complete.session_id, id, "どの席の完了かが読めない");
            assert_eq!(
                complete.result.candidates.len(),
                1,
                "最後の結果が載っていない"
            );
            assert!(
                bridge.take_session(SessionType::Infinite).await.is_ok(),
                "完了したのに席が残っている"
            );

            bridge.shutdown_engine_impl(2).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 席を見る宛先。**知らせが出た時点で席が空いていること**を見る
        struct SeatAtComplete {
            sessions: Arc<RwLock<HashMap<String, AnalysisSession>>>,
            empty: Mutex<Option<bool>>,
        }

        impl AnalysisEventSink for SeatAtComplete {
            fn emit(&self, event: AnalysisEvent) {
                if matches!(event, AnalysisEvent::Complete(_)) {
                    let sessions = self
                        .sessions
                        .try_read()
                        .expect("席のロックを握ったまま流した");
                    *self.empty.lock().expect("記録") = Some(sessions.is_empty());
                }
            }
        }

        /// 完了を受けたフロントは次の開始を撃つ。**席が先に空いていないと、それが断られる**
        #[tokio::test]
        async fn the_seat_is_free_by_the_time_the_completion_is_told() {
            let (bridge, _, dir) =
                started("bridge-complete-order", "echo 'bestmove 7g7f'", ":", 1).await;
            let sink = Arc::new(SeatAtComplete {
                sessions: Arc::clone(&bridge.active_sessions),
                empty: Mutex::new(None),
            });
            bridge.set_events(Arc::clone(&sink) as _).await;

            bridge.start_infinite_analysis_impl().await.expect("始まる");
            wait_until("完了の知らせ", || {
                sink.empty.lock().expect("記録").is_some()
            })
            .await;

            assert_eq!(*sink.empty.lock().expect("記録"), Some(true));
            bridge.shutdown_engine_impl(2).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (V4, E10): `stop` の答えは完了ではない。**完了にすると ■ の後に `検討完了` が出る**
        #[tokio::test]
        async fn the_answer_to_a_stop_is_not_a_completion() {
            let (bridge, recorded, dir) = started("bridge-stop-answer", ":", ":", 1).await;

            let id = bridge.start_infinite_analysis_impl().await.expect("始まる");
            wait_until("途中経過", || recorded.updates() >= 1).await;
            bridge
                .stop_analysis_impl(Some(id), None)
                .await
                .expect("止まる");

            tokio::time::sleep(QUIET).await;
            assert_eq!(recorded.completes(), 0, "`stop` の答えを完了と読んでいる");

            bridge.shutdown_engine_impl(2).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (V3, E12): 探索中に終わったら、起動の番号つきで知らせ、完了とは言わず、席を空ける
        #[tokio::test]
        async fn an_engine_that_exits_during_a_search_is_reported_with_its_start() {
            let (bridge, recorded, dir) = started("bridge-exit-search", "exit 1", ":", 7).await;

            bridge.start_infinite_analysis_impl().await.expect("始まる");
            wait_until("終了の知らせ", || !recorded.exits().is_empty()).await;

            let exits = recorded.exits();
            assert_eq!(exits.len(), 1);
            assert_eq!(exits[0].request, 7);
            assert!(
                exits[0]
                    .last_output
                    .as_deref()
                    .is_some_and(|o| o.contains("info depth 1")),
                "最後の出力が載っていない: {exits:?}"
            );
            assert_eq!(recorded.completes(), 0, "終了を完了と読んでいる");
            for _ in 0..500 {
                if bridge.active_sessions.read().await.is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert!(
                bridge.active_sessions.read().await.is_empty(),
                "終わったエンジンの席が残っている"
            );

            bridge.shutdown_engine_impl(8).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (V2, E12): 探索していない間に終わっても知らせる
        #[tokio::test]
        async fn an_engine_that_exits_while_idle_is_reported() {
            let body = r#"while read line; do
  case "$line" in
    usi) printf 'id name Script\nusiok\n' ;;
    isready) echo readyok; (sleep 1; kill -9 $$) & ;;
  esac
done"#;
            let (bridge, recorded, dir) = started_as("bridge-exit-idle", body, 3).await;

            wait_until("終了の知らせ", || !recorded.exits().is_empty()).await;
            assert_eq!(recorded.exits()[0].request, 3);

            bridge.shutdown_engine_impl(4).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// こちらが落とした回は知らせない。**`quit` に答えて `kill` より先に終わるエンジンが要。**
        /// 印が `kill_engine` まで立たないと、再起動のたびに `エンジン終了` が出る
        #[tokio::test]
        async fn an_engine_we_shut_down_is_not_reported() {
            let (bridge, recorded, dir) = started("bridge-shutdown", ":", ":", 1).await;

            bridge.shutdown_engine_impl(2).await.expect("落とせる");
            tokio::time::sleep(QUIET).await;

            assert!(
                recorded.exits().is_empty(),
                "こちらが落としたのに終了を知らせている"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `stop` にも `quit` にも答えない（`research/engines/usi-measurements.md` の固まった形）
        const SILENT: (&str, &str) = (":", ":");

        fn seen(dir: &std::path::Path) -> String {
            std::fs::read_to_string(dir.join("seen.log")).expect("台本の記録")
        }

        /// (V3, E11) AC-9: 答えないと知らせ、**次の局面も `go` も線に出さない**（不変条件2）。
        ///
        /// 出すと、やねうら王はプロセスを殺す以外に抜ける口が無くなる
        #[tokio::test]
        async fn an_engine_that_does_not_answer_stop_gets_no_next_position() {
            let body = script_with(":", ":", SILENT.0, SILENT.1);
            let (bridge, recorded, dir) = started_as("bridge-no-answer", &body, 5).await;

            let id = bridge.start_infinite_analysis_impl().await.expect("始まる");
            let outcome = bridge.stop_analysis_impl(Some(id), None).await;
            assert_eq!(outcome, Ok(StopOutcome::Unanswered));
            let unresponsive = recorded.unresponsive();
            assert_eq!(unresponsive.len(), 1);
            assert_eq!(unresponsive[0].request, 5);
            assert_eq!(unresponsive[0].reason, UnresponsiveReason::NoAnswer);
            assert!(
                unresponsive[0]
                    .last_output
                    .as_deref()
                    .is_some_and(|o| o.contains("info depth 1")),
                "最後の出力が載っていない: {unresponsive:?}"
            );

            // `unanswered` が下りないこと。ストリームを外していると、この間に下りる
            tokio::time::sleep(QUIET).await;
            bridge
                .set_position_impl("startpos".to_string())
                .await
                .expect("覚えるだけなので断らない");
            assert!(
                bridge.start_infinite_analysis_impl().await.is_err(),
                "答えていないエンジンへ `go` を通している"
            );
            assert!(
                bridge.analyze_with_time_impl(1).await.is_err(),
                "答えていないエンジンへ時間の `go` を通している"
            );
            assert!(
                bridge.analyze_with_depth_impl(1).await.is_err(),
                "答えていないエンジンへ深さの `go` を通している"
            );
            let lines = seen(&dir);
            assert_eq!(lines.matches("go").count(), 1, "`go` が重なった: {lines}");
            assert_eq!(
                lines.matches("position").count(),
                1,
                "次の局面が線に出た: {lines}"
            );

            // 待ち切った後の停止は書き直さず、すぐ返る。**`応答なし` からの操作が3秒ずつ固まらない**
            let again = tokio::time::timeout(QUIET, bridge.stop_analysis_impl(None, None)).await;
            assert_eq!(again.expect("待ち直している"), Ok(StopOutcome::Unanswered));
            assert_eq!(seen(&dir).matches("stop").count(), 1);

            bridge.shutdown_engine_impl(6).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (V6, E10) AC-11: 遅れて答えが来たら知らせ、次の局面を通す
        #[tokio::test]
        async fn a_late_answer_lets_the_next_position_through() {
            let body = script_with(":", ":", "(sleep 4; echo 'bestmove 7g7f') &", "exit 0");
            let (bridge, recorded, dir) = started_as("bridge-late-answer", &body, 5).await;

            let id = bridge.start_infinite_analysis_impl().await.expect("始まる");
            assert_eq!(
                bridge.stop_analysis_impl(Some(id), None).await,
                Ok(StopOutcome::Unanswered)
            );
            wait_until("遅れた答えの知らせ", || {
                !recorded.answered().is_empty()
            })
            .await;

            assert_eq!(recorded.answered(), vec![EngineAnswered { request: 5 }]);
            assert_eq!(recorded.completes(), 0, "`stop` の答えを完了と読んでいる");
            assert!(
                bridge.start_infinite_analysis_impl().await.is_ok(),
                "答えがあったのに次を読ませない"
            );

            bridge.shutdown_engine_impl(6).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (V6, E13) AC-10: 起動し直すと、`quit` を送らずに落として新しいプロセスへ移る。
        /// 新しいプロセスには前の印が残らない
        #[tokio::test]
        async fn restarting_an_unresponsive_engine_kills_it_without_quit() {
            let body = script_with(":", ":", SILENT.0, SILENT.1);
            let (bridge, _, dir) = started_as("bridge-restart-silent", &body, 5).await;
            let id = bridge.start_infinite_analysis_impl().await.expect("始まる");
            let path = dir.join("engine.sh");
            let _ = bridge.stop_analysis_impl(Some(id), None).await;

            bridge
                .start_analysis_engine_impl(
                    path.to_str().expect("パス").to_string(),
                    StartInput::default(),
                    6,
                )
                .await
                .expect("起動し直せる");
            bridge
                .set_position_impl("startpos".to_string())
                .await
                .expect("局面を覚える");

            assert!(
                !seen(&dir).contains("quit"),
                "答えないエンジンへ `quit` を送っている"
            );
            assert!(
                bridge.start_infinite_analysis_impl().await.is_ok(),
                "新しいプロセスに前の印が残っている"
            );

            bridge.shutdown_engine_impl(7).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (V4, E1) AC-60: 落とす要求は、上限まで待ってから `quit` を待たずに落とす
        #[tokio::test]
        async fn shutting_down_during_a_silent_search_ends_the_engine() {
            let body = script_with(":", ":", SILENT.0, SILENT.1);
            let (bridge, _, dir) = started_as("bridge-shutdown-silent", &body, 5).await;
            bridge.start_infinite_analysis_impl().await.expect("始まる");

            bridge.shutdown_engine_impl(6).await.expect("落とせる");

            let lines = seen(&dir);
            assert!(lines.contains("stop"), "止めずに落としている: {lines}");
            assert!(!lines.contains("quit"), "`quit` を送っている: {lines}");
            assert!(
                bridge.analyzer.end_watch().await.is_none(),
                "プロセスが残っている"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 即答の `bestmove` を失わない。**`go` の後で積まれた行を捨てると検討中のまま残る**
        #[tokio::test]
        async fn an_instant_bestmove_is_not_lost() {
            for attempt in 0..20 {
                let name = format!("bridge-instant-{attempt}");
                let (bridge, recorded, dir) = started(&name, "echo 'bestmove 7g7f'", ":", 1).await;
                bridge.start_infinite_analysis_impl().await.expect("始まる");
                wait_until("完了の知らせ", || recorded.completes() == 1).await;
                bridge.shutdown_engine_impl(2).await.expect("落とせる");
                let _ = std::fs::remove_dir_all(&dir);
            }
        }

        /// (AC-19 の土台) **開始と停止がどの順に重なっても「席が無いのに読み続ける」にならない。**
        ///
        /// 席が空なら、線の最後の `go` の後に `stop` がある
        #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
        async fn a_start_and_a_stop_at_once_leave_no_search_without_a_seat() {
            for attempt in 0..12 {
                let name = format!("bridge-overlap-{attempt}");
                // 実物と同じく、探索していない `stop` には答えない
                let body = script_with(
                    "searching=1",
                    ":",
                    "[ -n \"$searching\" ] && echo 'bestmove 7g7f'; searching=",
                    "exit 0",
                );
                let (bridge, _, dir) = started_as(&name, &body, 1).await;
                let bridge = Arc::new(bridge);

                let start = {
                    let bridge = Arc::clone(&bridge);
                    tokio::spawn(async move { bridge.start_infinite_analysis_impl().await })
                };
                let stop = {
                    let bridge = Arc::clone(&bridge);
                    tokio::spawn(async move { bridge.stop_analysis_impl(None, None).await })
                };
                let _ = start.await.expect("開始のタスク");
                let _ = stop.await.expect("停止のタスク");
                tokio::time::sleep(Duration::from_millis(30)).await;

                let lines = seen(&dir);
                let last_go = lines.rfind("go");
                let last_stop = lines.rfind("stop");
                if bridge.active_sessions.read().await.is_empty() {
                    assert!(
                        last_go.is_none() || last_stop > last_go,
                        "席が無いのにエンジンが読み続ける: {lines}"
                    );
                }

                bridge.shutdown_engine_impl(2).await.expect("落とせる");
                let _ = std::fs::remove_dir_all(&dir);
            }
        }

        /// (V2, E15): stdin を読まなくなったら書けないことを知らせる
        #[tokio::test]
        async fn an_engine_that_stops_reading_is_reported_as_unwritable() {
            let body = r#"while read line; do
  case "$line" in
    usi) printf 'id name Script\nusiok\n' ;;
    isready) echo readyok ;;
    usinewgame) sleep 30 ;;
  esac
done"#;
            let (bridge, recorded, dir) = started_as("bridge-unwritable", body, 5).await;

            // パイプを埋める大きさ。書き込みの上限まで待つ
            let big = format!("startpos moves {}", "7g7f ".repeat(400_000));
            bridge.set_position_impl(big).await.expect("覚える");
            assert!(bridge.start_infinite_analysis_impl().await.is_err());

            wait_until("書けない知らせ", || {
                !recorded.unresponsive().is_empty()
            })
            .await;
            let unresponsive = recorded.unresponsive();
            assert_eq!(unresponsive.len(), 1);
            assert_eq!(unresponsive[0].reason, UnresponsiveReason::Unwritable);

            bridge.shutdown_engine_impl(6).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// (V3, E8) AC-19: 探索中に局面が動いても線に出ない。**順は `stop` → 答え → `position` → `go`**
        /// （不変条件2。やねうら王はこれを破ると固まる）
        #[tokio::test]
        async fn a_position_during_a_search_goes_out_only_after_the_stop() {
            let (bridge, _, dir) = started("bridge-position-order", ":", ":", 1).await;

            bridge
                .set_position_impl("first".to_string())
                .await
                .expect("覚える");
            let id = bridge.start_infinite_analysis_impl().await.expect("始まる");
            bridge
                .set_position_impl("second".to_string())
                .await
                .expect("覚える");
            bridge
                .set_position_impl("third".to_string())
                .await
                .expect("覚える");
            assert!(
                !seen(&dir).contains("third"),
                "探索中のエンジンへ局面が届いた"
            );

            bridge
                .stop_analysis_impl(Some(id), None)
                .await
                .expect("止まる");
            bridge.start_infinite_analysis_impl().await.expect("始まる");
            bridge.shutdown_engine_impl(2).await.expect("落とせる");

            let lines = seen(&dir);
            let wire: Vec<&str> = lines
                .lines()
                .filter(|l| l.starts_with("position") || l.starts_with("go") || *l == "stop")
                .collect();
            assert_eq!(
                wire,
                [
                    "position sfen first",
                    "go infinite",
                    "stop",
                    "position sfen third",
                    "go infinite",
                    "stop"
                ],
                "線の順が違う"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 別のプロセスへ前の局面を持ち越さない。**局面が無ければ `go` も出さない**
        #[tokio::test]
        async fn a_new_process_does_not_inherit_the_position() {
            let (bridge, _, dir) = started("bridge-position-reset", ":", ":", 1).await;
            bridge
                .set_position_impl("old".to_string())
                .await
                .expect("覚える");

            bridge
                .start_analysis_engine_impl(
                    dir.join("engine.sh").to_str().expect("パス").to_string(),
                    StartInput::default(),
                    2,
                )
                .await
                .expect("起動し直せる");
            let refused = bridge.start_infinite_analysis_impl().await;

            assert!(
                refused.is_err_and(|e| !e.unreachable),
                "局面が無いのに `go` を出した"
            );
            let lines = seen(&dir);
            assert_eq!(lines.matches("sfen old").count(), 0, "持ち越した: {lines}");
            assert_eq!(lines.matches("go").count(), 0, "`go` が出た: {lines}");

            bridge.shutdown_engine_impl(3).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 起動が重なっても、後の起動に覚えた局面を前の起動が消さない。
        /// 前の起動は古いプロセスを落とす間（`quit` の猶予）止まっている
        #[tokio::test]
        async fn an_overtaken_start_does_not_erase_the_new_position() {
            let (bridge, _, dir) = started("bridge-start-overlap", ":", ":", 1).await;
            let bridge = Arc::new(bridge);
            let path = dir.join("engine.sh").to_str().expect("パス").to_string();

            let first = {
                let bridge = Arc::clone(&bridge);
                let path = path.clone();
                tokio::spawn(async move {
                    bridge
                        .start_analysis_engine_impl(path, StartInput::default(), 2)
                        .await
                })
            };
            tokio::time::sleep(Duration::from_millis(50)).await;
            bridge
                .start_analysis_engine_impl(path, StartInput::default(), 3)
                .await
                .expect("後の起動は通る");
            bridge
                .set_position_impl("new".to_string())
                .await
                .expect("覚える");
            let _ = first.await.expect("前の起動のタスク");

            bridge.start_infinite_analysis_impl().await.expect("始まる");
            wait_until("局面が線に出る", || {
                seen(&dir).contains("position sfen new")
            })
            .await;

            bridge.shutdown_engine_impl(4).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 線に届かなかった開始は、断りと区別できる
        #[tokio::test]
        async fn a_start_that_could_not_be_written_says_so() {
            let body = r#"while read line; do
  case "$line" in
    usi) printf 'id name Script\nusiok\n' ;;
    isready) echo readyok ;;
    usinewgame) sleep 30 ;;
  esac
done"#;
            let (bridge, _, dir) = started_as("bridge-start-unreachable", body, 5).await;
            let big = format!("startpos moves {}", "7g7f ".repeat(400_000));
            bridge.set_position_impl(big).await.expect("覚える");

            let refused = bridge.start_infinite_analysis_impl().await;

            assert!(refused.is_err_and(|e| e.unreachable));
            bridge.shutdown_engine_impl(6).await.expect("落とせる");
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
