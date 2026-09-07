use crate::engine::utils::{LogThrottle, EMIT_WARN_INTERVAL};

use super::analyzer::{DepthOutcome, EngineAnalyzer, MAX_THINK_TIME};
use super::registry::EngineRegistry;
use super::types::*;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};

use tauri::Emitter;

const LOGT: &str = "obs_shogi::engine::bridge";

/// Tauriコマンドとエンジン機能の橋渡し
pub struct EngineBridge {
    analyzer: EngineAnalyzer,
    active_sessions: Arc<RwLock<HashMap<String, AnalysisSession>>>,
    settings: Arc<RwLock<EngineSettings>>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
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

/// `analysis-update` の payload。
///
/// **`session_id` を載せるのは、受け手が自分のものか照合するため。**
/// 前の探索が畳まりきる前に次の `go` が出ると、古い `info` が新しい
/// リスナーへ配られる（`broadcast_to_listeners` は誰の `go` に対する行かを見ない）。
/// 照合しないと、前の局面の読み筋が現在の盤面の解析結果として画面に出る。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisUpdate {
    session_id: String,
    result: AnalysisResult,
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

impl EngineBridge {
    pub fn new(registry: Arc<EngineRegistry>) -> Self {
        Self {
            analyzer: EngineAnalyzer::new(registry),
            active_sessions: Arc::new(RwLock::new(HashMap::new())),
            settings: Arc::new(RwLock::new(EngineSettings::default())),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    // AppHandleを設定するメソッド
    pub async fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.write().await = Some(handle);
    }

    pub async fn initialize_engine_impl(
        &self,
        engine_path: String,
        working_dir: Option<String>,
    ) -> Result<(), String> {
        log::info!(target: LOGT, "initialize_engine: start");

        // 実行ファイルの検査は `EngineRegistry::spawn` が持つ。
        // 起動する経路を1本にしてあるので、ここで重ねて検査しない。
        match self
            .analyzer
            .initialize_engine(engine_path, working_dir)
            .await
        {
            Ok(_) => {
                log::info!(target: LOGT, "initialize_engine: ok");
                Ok(())
            }
            Err(e) => {
                log::error!(target: LOGT, "initialize_engine: failed: {:?}", e);
                Err(format!("Engine initialization failed: {e}"))
            }
        }
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

    pub async fn shutdown_engine_impl(&self) -> Result<(), String> {
        log::info!(target: LOGT, "shutdown_engine: start");

        // **止められなくても席の掃除まで進む。** `?` で折れると
        // `engine_id` が `Some` のまま残り、以降どのコマンドも
        // 「Engine is no longer running」を返すだけになる（終了ボタンが直せない）
        if let Err(e) = self.stop_all_sessions("shutdown").await {
            log::warn!(
                target: LOGT,
                "shutdown_engine: could not stop sessions, continuing: {e}"
            );
        }

        match self.analyzer.shutdown().await {
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

    pub async fn start_infinite_analysis_impl(&self) -> Result<String, String> {
        // **セッションを先に登録する。** 後にすると、走らせている間だけ
        // 「走っていない」に見える
        let session_id = self
            .take_session(SessionType::Infinite)
            .await
            .map_err(|e| {
                log::warn!(target: LOGT, "start_infinite_analysis: rejected: {}", e);
                e
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
                return Err(format!("Failed to start infinite analysis: {e}"));
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
        receiver: mpsc::UnboundedReceiver<AnalysisResult>,
    ) {
        let sessions_clone = Arc::clone(&self.active_sessions);
        let app_handle_clone = Arc::clone(&self.app_handle);
        let session_id_clone = session_id.to_string();

        tokio::spawn(async move {
            Self::forward_results_to_ui(
                app_handle_clone,
                sessions_clone,
                session_id_clone,
                receiver,
            )
            .await;
        });
    }

    /// UI向け結果転送処理
    async fn forward_results_to_ui(
        app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
        sessions: Arc<RwLock<HashMap<String, AnalysisSession>>>,
        session_id: String,
        mut receiver: mpsc::UnboundedReceiver<AnalysisResult>,
    ) {
        // session が消えたら emit/保存をやめるためのフラグ
        let mut session_exists = true;

        // emit の失敗は洪水になるので絞る。間隔は対局側と1つ（`EMIT_WARN_INTERVAL`）
        let mut emit_warn = LogThrottle::new(EMIT_WARN_INTERVAL);
        // session消失も1回だけdebug
        let mut session_missing_logged = false;

        while let Some(result) = receiver.recv().await {
            // session がまだあるなら last_result を保存 & active なら emit
            let mut emit = false;

            if session_exists {
                let mut sessions_guard = sessions.write().await;
                if let Some(session) = sessions_guard.get_mut(&session_id) {
                    session.last_result = Some(result.clone());
                    emit = true;
                } else {
                    session_exists = false;
                    if !session_missing_logged {
                        log::debug!(
                            target: LOGT,
                            "forward_results: session disappeared; draining only session_id={}",
                            session_id
                        );
                        session_missing_logged = true;
                    }
                }
            }

            // emit は session が存在して active の時だけ
            if emit {
                if let Some(handle) = app_handle.read().await.clone() {
                    let payload = AnalysisUpdate {
                        session_id: session_id.clone(),
                        result,
                    };
                    if let Err(e) = handle.emit("analysis-update", payload) {
                        if emit_warn.allow() {
                            log::warn!(
                                target: LOGT,
                                "forward_results: emit failed session_id={} err={}",
                                session_id,
                                e
                            );
                        }
                    }
                }
            }
            // session が消えた後は、receiver を drop せずに drain 継続する
        }

        // **席ごと消す。** 残すと `AnalysisSession.last_result` が候補手と PV を
        // 丸ごと持ったまま溜まる（上限は無い）。居ること自体が「走っている」なので、
        // 終わった席を残すと `take_session` が以後ずっと断ることにもなる。
        //
        // ここを通っても**フロントには何も飛ばない**。`sessionId` を握ったままの
        // 画面から「停止」が来るので、`stop_session` はそれを失敗にしない。
        // 最後の結果は `EngineAnalyzer::get_last_result` が1本だけ持つ
        sessions.write().await.remove(&session_id);
        log::debug!(
            target: LOGT,
            "forward_results: ended session_id={}",
            session_id
        );
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
    ///
    /// **省いた側は `take_session` の相互排除を素通りする。** 開始の途中
    /// （席を取ってから `go` が線に出るまで）に割り込むと、席だけ消えて
    /// エンジンが読み続ける。いまそれが収束しているのは、開始の応答を受け取った
    /// フロントが**その席をもう一度返す**からで、Rust 側の仕組みではない → #463
    pub async fn stop_analysis_impl(
        &self,
        session_id: Option<String>,
        by: Option<String>,
    ) -> Result<(), String> {
        // 呼び手が名乗らなかったときの既定。**名乗った回と区別できるようにしておく。**
        let by = by.as_deref().unwrap_or("unnamed");

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

    pub async fn apply_engine_settings_impl(&self, settings: EngineSettings) -> Result<(), String> {
        log::info!(
            target: LOGT,
            "apply_engine_settings: start options={}",
            settings.options.len()
        );

        self.analyzer
            .apply_settings(settings.clone())
            .await
            .map_err(|e| {
                log::error!(target: LOGT, "apply_engine_settings: failed: {:?}", e);
                format!("Failed to apply settings: {e}")
            })?;

        // 設定を保存
        *self.settings.write().await = settings;

        log::info!(target: LOGT, "apply_engine_settings: ok");
        Ok(())
    }

    pub async fn get_engine_settings_impl(&self) -> Result<EngineSettings, String> {
        Ok(self.settings.read().await.clone())
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

    pub async fn get_engine_info_impl(&self) -> Result<Option<EngineInfo>, String> {
        log::debug!(target: LOGT, "get_engine_info");

        match self.analyzer.get_engine_info().await {
            Ok(info) => Ok(Some(info)),
            Err(EngineError::NotInitialized(_)) => Ok(None),
            Err(e) => {
                log::warn!(target: LOGT, "get_engine_info: failed: {:?}", e);
                Err(format!("Failed to get engine info: {e}"))
            }
        }
    }

    // ===  session === //

    async fn stop_session(&self, session_id: &str, by: &str) -> Result<(), String> {
        log::info!(
            target: LOGT,
            "stop_session: start session_id={} by={}",
            session_id,
            by
        );

        // **他人のセッションは止めない。** `session_id` はフロントから来る任意の文字列で、
        // フロントはエラーの後も `sessionId` を握り続ける
        // （`docs/state-transitions/analysis.md` の ※1）。照合しないと、
        // 前の解析の ID を握ったままの画面が「停止」を撃ったときに
        // **いま走っている別の解析が止まって `Ok` が返る**。
        //
        // **「もう無い」は失敗にしない。** エンジンが落ちると
        // `forward_results_to_ui` が席を消すが、フロントへは何も飛ばないので
        // `sessionId` を握ったまま「停止」が来る。ここで `Err` にすると
        // 呼び出し側の再開が `catch` に落ち、**解析が始まり直さない**。
        // 要求は「止まっていること」で、席が無いならその要求は満たせている
        // （`EngineAnalyzer::stop_analysis` と同じ立場）。
        {
            let mut sessions = self.active_sessions.write().await;
            match sessions.remove(session_id) {
                Some(_) => {}
                None if sessions.is_empty() => {
                    log::debug!(target: LOGT, "stop_session: already gone id={session_id}");
                }
                // 別のセッションが走っている。撃った側のものではないので触らない
                None => {
                    log::warn!(target: LOGT, "stop_session: not the running one id={session_id}");
                    return Err(format!("unknown analysis session: {session_id}"));
                }
            }
        }

        self.analyzer.stop_analysis().await.map_err(|e| {
            log::error!(target: LOGT, "stop_session: analyzer stop failed: {e}");
            format!("Failed to stop analysis: {e}")
        })?;

        log::info!(target: LOGT, "stop_session: ok session_id={}", session_id);
        Ok(())
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
    async fn stop_all_sessions(&self, by: &str) -> Result<(), String> {
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

        self.analyzer.stop_analysis().await.map_err(|e| {
            log::error!(
                target: LOGT,
                "stop_all_sessions: by={} analyzer stop failed: {:?}",
                by,
                e
            );
            format!("Failed to stop all analysis: {e}")
        })?;

        log::info!(target: LOGT, "stop_all_sessions: ok by={by}");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    /// エンジンが落ちると `forward_results_to_ui` が席を消すが、フロントへは
    /// 何も飛ばないので `sessionId` を握ったまま「停止」が来る。ここで `Err` に
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
}
