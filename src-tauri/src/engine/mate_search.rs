//! 詰み探索（`go mate`）。詰将棋エンジンを検討とは別のプロセスで動かし、途中の候補手と結論を流す
//! （`docs/spec/features/mate-search.md` の AC-M1〜AC-M5）。
//!
//! **探索は同時に1本。** 始めるときは前の詰み探索を先に終わらせる。検討の探索との排他は `bridge` が持つ
//! （検討を中断してからここを呼び、検討を始める前にここの `stop` を呼ぶ）。
//!
//! エンジンのプロセスは、最初に始めたときに起こし、別の設定で始めるか失敗するまで残す
//! （同じ設定ならそのまま使う）。終わったとき・`stop` に答えなかったとき・届かなくなったときは落とす。

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{watch, Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use usi::{InfoParams, MateParam, ScoreKind, ThinkParams};

use super::analysis_events::{AnalysisEvent, AnalysisEventSink};
use super::analysis_start::{self, StartInput};
use super::candidates::{apply_info_params, extract_rank};
use super::logging::shown;
use super::protocol::search::{MateAnswer, Search, SearchLine, StopAnswer, StopReply};
use super::registry::{EngineId, EngineRegistry};
use super::start_failure;
use super::types::*;

const LOGT: &str = "obs_shogi::engine::mate_search";

/// 中止のとき `stop` への答えを待つ上限。検討の止めの上限と同じ3秒
/// （越えたら詰将棋エンジンを落とす。検討のエンジンには触らない）
const STOP_GRACE: Duration = Duration::from_secs(3);

/// 上限を過ぎてもエンジンが終わらないとき、`stop` を送るまでの猶予。上限どおりに終わるエンジンの
/// 最後の行を追い越さない長さ
const LIMIT_GRACE: Duration = Duration::from_secs(5);

/// ログと失敗の文に載せるエンジンの出力の長さ（文字）
const MAX_LOGGED: usize = 256;

/// 起こしてあるエンジン
struct Engine {
    path: String,
    /// 設定の綴り（`StartInput` の `Debug`）。同じなら起こし直さない
    input: String,
    id: EngineId,
}

/// 走っている探索。**外すのは終わりを流し終えた `Run::finish` だけ。** 止める側が先に外すと、止めている途中の
/// 探索が2人目から見えず、検討が `go` を出せてしまう
struct Running {
    session_id: String,
    stop: CancellationToken,
    /// 探索が終わり、終わりを流し終えたら `true`
    finished: watch::Receiver<bool>,
}

/// 走っている探索を止め、終わりを流し終えるまで待つ。何人が同時に待ってもよい
async fn end(running: Option<(CancellationToken, watch::Receiver<bool>)>) {
    if let Some((stop, mut finished)) = running {
        stop.cancel();
        // 送り手が落ちるのは探索のタスクごと消えたときだけで、そのときも終わっている
        let _ = finished.wait_for(|done| *done).await;
    }
}

#[derive(Default)]
struct Inner {
    engine: Option<Engine>,
    running: Option<Running>,
    /// 始めている途中のリクエスト（エンジンの起動を待つ間）。`stop` と次の `reserve` が取り消す
    starting: Option<CancellationToken>,
    /// リクエスト（`reserve` と `stop`）の順番。新しいリクエストが来たら、待っている古い `start` は始めない。
    /// 取り消しの欄（`starting`）だけでは、欄を置く前に来た `stop` を取りこぼす
    epoch: u64,
}

/// 始めるリクエストの順番を表す値。検討を中断するのと同じ順番の中で取り、待っている間に中止や検討の開始が
/// 来たかを `start` が見る
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reservation(u64);

impl Inner {
    /// 新しいリクエスト。途中の `start` を取り消す
    fn supersede(&mut self) -> u64 {
        if let Some(starting) = self.starting.take() {
            starting.cancel();
        }
        self.epoch += 1;
        self.epoch
    }

    /// 走っている探索を止めるのに要るもの。探索は外さない（`Running`）
    fn running(&self) -> Option<(CancellationToken, watch::Receiver<bool>)> {
        self.running
            .as_ref()
            .map(|r| (r.stop.clone(), r.finished.clone()))
    }
}

/// 詰み探索の持ち主
pub struct MateSearcher {
    registry: Arc<EngineRegistry>,
    events: Arc<RwLock<Arc<dyn AnalysisEventSink>>>,
    inner: Arc<Mutex<Inner>>,
    /// `start` を1本ずつ通す。取り消された `start` が片付けてから次が始まる
    turn: Mutex<()>,
}

impl MateSearcher {
    pub fn new(
        registry: Arc<EngineRegistry>,
        events: Arc<RwLock<Arc<dyn AnalysisEventSink>>>,
    ) -> Self {
        Self {
            registry,
            events,
            inner: Arc::new(Mutex::new(Inner::default())),
            turn: Mutex::new(()),
        }
    }

    /// 始めるリクエストを1つ入れる。待っている古いリクエストと途中の起動を取り消す。この後に `stop` か
    /// 別の `reserve` が来れば、この順番の `start` は始めない
    pub async fn reserve(&self) -> Reservation {
        Reservation(self.inner.lock().await.supersede())
    }

    /// 詰み探索を始める。返すのはこの探索の番号で、途中経過と終わりの通知に載る。
    /// 上限 `None` は無制限。`position` は検討の `set_position` と同じ綴り。
    ///
    /// 前の詰み探索は先に終わらせる（結論は中止）。`reserve` の後に `stop` か別のリクエストが来たら `Superseded`
    pub async fn start(
        &self,
        reservation: Reservation,
        engine_path: &str,
        input: &StartInput,
        position: String,
        limit: Option<Duration>,
    ) -> Result<String, MateStartFailure> {
        self.end_running_for(reservation).await?;
        let _turn = self.turn.lock().await;
        // 待っている間に別のリクエストが走らせた探索があれば終わらせる
        self.end_running_for(reservation).await?;

        let cancel = CancellationToken::new();
        {
            let mut inner = self.inner.lock().await;
            if inner.epoch != reservation.0 {
                return Err(MateStartFailure::Superseded);
            }
            inner.starting = Some(cancel.clone());
        }
        let outcome = self
            .start_with(engine_path, input, position, limit, &cancel)
            .await;
        // `turn` を持っているので、ここで残っている欄は自分のもの（`stop` と次の `reserve` が外していれば無い）
        let mut inner = self.inner.lock().await;
        if !cancel.is_cancelled() {
            inner.starting = None;
        }
        outcome
    }

    /// 走っている探索を終わらせる。**追い越されていたら触らない**——確認と、止める相手を取ることを同じロックの
    /// 下で行わないと、古い `start` が新しい `start` の探索を止める
    async fn end_running_for(&self, reservation: Reservation) -> Result<(), MateStartFailure> {
        let running = {
            let inner = self.inner.lock().await;
            if inner.epoch != reservation.0 {
                return Err(MateStartFailure::Superseded);
            }
            inner.running()
        };
        end(running).await;
        Ok(())
    }

    async fn start_with(
        &self,
        engine_path: &str,
        input: &StartInput,
        position: String,
        limit: Option<Duration>,
        cancel: &CancellationToken,
    ) -> Result<String, MateStartFailure> {
        let id = self.ensure_engine(engine_path, input, cancel).await?;
        let mut inner = self.inner.lock().await;
        // 取り消しの確認と探索のリクエストは同じロックの下で行う。`stop` も同じロックの下で取り消すので、
        // 取り消されたリクエストが探索を始めることはなく、始めた探索は必ず `stop` から見える
        if cancel.is_cancelled() {
            return Err(MateStartFailure::Superseded);
        }
        let Some(process) = self.registry.get(&id).await else {
            inner.engine = None;
            return Err(MateStartFailure::Refused {
                message: "the engine left the registry before the search".to_string(),
            });
        };
        let param = limit.map_or(MateParam::Infinite, MateParam::Timeout);
        // 前の探索は終わっているので（`end_running_for`）、待つのは書けたことだけ
        let search = process
            .protocol()
            .search(position, ThinkParams::new().mate(param))
            .await;
        let search = match search {
            Ok(search) => search,
            Err(e) => {
                let message = shown(&e.to_string(), MAX_LOGGED);
                log::error!(target: LOGT, "start: search refused: {message}");
                // 探索をリクエストできないエンジンは残さない。次に始めるときに起こし直す
                inner.engine = None;
                drop(inner);
                self.registry.kill(&id).await;
                return Err(MateStartFailure::Refused { message });
            }
        };
        let session_id = format!("mate_{}", uuid::Uuid::new_v4());
        let stop = CancellationToken::new();
        let (finished_tx, finished) = watch::channel(false);
        inner.running = Some(Running {
            session_id: session_id.clone(),
            stop: stop.clone(),
            finished,
        });
        let run = Run {
            session_id: session_id.clone(),
            engine_id: id,
            events: Arc::clone(&self.events),
            inner: Arc::clone(&self.inner),
            registry: Arc::clone(&self.registry),
        };
        tokio::spawn(async move {
            run.run(search, stop, limit).await;
            let _ = finished_tx.send(true);
        });
        log::info!(target: LOGT, "start: {session_id} limit={limit:?}");
        Ok(session_id)
    }

    /// 走っている詰み探索と、始めている途中のリクエストを終わらせ、終わりを流し終えるまで待つ。
    /// 無ければ何もしない
    pub async fn stop(&self) {
        let running = {
            let mut inner = self.inner.lock().await;
            inner.supersede();
            inner.running()
        };
        end(running).await;
    }

    /// 起こしてあるエンジンを使うか、別の設定か閉じたエンジンなら落として起こす
    async fn ensure_engine(
        &self,
        engine_path: &str,
        input: &StartInput,
        cancel: &CancellationToken,
    ) -> Result<EngineId, MateStartFailure> {
        let input_text = format!("{input:?}");
        let old = {
            let mut inner = self.inner.lock().await;
            if cancel.is_cancelled() {
                return Err(MateStartFailure::Superseded);
            }
            if let Some(engine) = &inner.engine {
                if engine.path == engine_path
                    && engine.input == input_text
                    && self.is_alive(&engine.id).await
                {
                    return Ok(engine.id.clone());
                }
            }
            inner.engine.take()
        };
        if let Some(old) = old {
            self.registry.shutdown(&old.id).await;
        }
        match analysis_start::start(&self.registry, engine_path, input, cancel).await {
            Ok((process, warnings)) => {
                if !warnings.is_empty() {
                    log::info!(target: LOGT, "start: {} warning(s)", warnings.len());
                }
                let id = process.id.clone();
                let mut inner = self.inner.lock().await;
                // 起こしている間に取り消されたリクエストのエンジンは使わない
                if cancel.is_cancelled() {
                    drop(inner);
                    self.registry.shutdown(&id).await;
                    return Err(MateStartFailure::Superseded);
                }
                inner.engine = Some(Engine {
                    path: engine_path.to_string(),
                    input: input_text,
                    id: id.clone(),
                });
                Ok(id)
            }
            // 取り消した後の失敗は、起動できなかったと読まない（失敗の後片付けの間に `stop` が来た回）
            Err(_) if cancel.is_cancelled() => Err(MateStartFailure::Superseded),
            Err(e) => {
                let failure =
                    start_failure::describe(&e, engine_path, input.eval_path.as_deref()).await;
                log::error!(target: LOGT, "start: engine failed: {:?}", failure.kind);
                Err(MateStartFailure::EngineFailed { failure })
            }
        }
    }

    /// `EngineRegistry` に居て、閉じていないか。プロセスが自分で終わっても項目は残る
    async fn is_alive(&self, id: &EngineId) -> bool {
        match self.registry.get(id).await {
            Some(process) => process.protocol().end_watch().ended().is_none(),
            None => false,
        }
    }
}

/// 探索1本の受け手
struct Run {
    session_id: String,
    engine_id: EngineId,
    events: Arc<RwLock<Arc<dyn AnalysisEventSink>>>,
    inner: Arc<Mutex<Inner>>,
    registry: Arc<EngineRegistry>,
}

impl Run {
    async fn emit(&self, event: AnalysisEvent) {
        let sink = Arc::clone(&*self.events.read().await);
        sink.emit(event);
    }

    async fn run(&self, mut search: Search, stop: CancellationToken, limit: Option<Duration>) {
        let mut result = AnalysisResult::default();
        let mut win = None;
        let deadline = limit.map(|limit| tokio::time::Instant::now() + limit + LIMIT_GRACE);
        let conclusion = loop {
            let line = tokio::select! {
                biased;
                _ = stop.cancelled() => {
                    break match search.stop(STOP_GRACE).await {
                        StopAnswer::Answered(_) => MateConclusion::Cancelled,
                        StopAnswer::Unanswered(_) => MateConclusion::StopUnanswered,
                        StopAnswer::Unreachable(_) => MateConclusion::EngineExited,
                    };
                }
                line = search.next_line() => line,
                _ = until(deadline) => {
                    log::warn!(target: LOGT, "{}: the engine ran past the limit; stopping it", self.session_id);
                    break conclusion_at_limit(search.stop(STOP_GRACE).await, win);
                }
            };
            match line {
                Ok(Some(SearchLine::Info(params))) => {
                    note_win(&params, &mut win);
                    apply_info_params(&params, &mut result);
                    self.emit(AnalysisEvent::MateUpdate(MateSearchUpdate {
                        session_id: self.session_id.clone(),
                        result: result.clone(),
                    }))
                    .await;
                }
                Ok(Some(SearchLine::Checkmate(answer))) => break conclusion_of(answer),
                Ok(Some(SearchLine::BestMove(_))) => break conclusion_of_bestmove(win),
                Ok(None) | Err(_) => break MateConclusion::EngineExited,
            }
        };
        self.finish(conclusion, result).await;
    }

    async fn finish(&self, conclusion: MateConclusion, result: AnalysisResult) {
        log::info!(target: LOGT, "finish: {} {conclusion:?}", self.session_id);
        // 届かない・答えないエンジンは落とし、次に始めるときに起こし直す
        if matches!(
            conclusion,
            MateConclusion::EngineExited | MateConclusion::StopUnanswered
        ) {
            {
                let mut inner = self.inner.lock().await;
                if inner
                    .engine
                    .as_ref()
                    .is_some_and(|e| e.id == self.engine_id)
                {
                    inner.engine = None;
                }
            }
            self.registry.kill(&self.engine_id).await;
        }
        self.emit(AnalysisEvent::MateFinished(MateSearchFinished {
            session_id: self.session_id.clone(),
            conclusion,
            result,
        }))
        .await;
        // **流してから外す。** 先に外すと、止める側と次の探索が、終わりを流す前に進む
        let mut inner = self.inner.lock().await;
        if inner
            .running
            .as_ref()
            .is_some_and(|r| r.session_id == self.session_id)
        {
            inner.running = None;
        }
    }
}

/// 上限が無ければ永久に待つ
async fn until(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

/// 上限を過ぎても終わらないので止めたときの結論。**何で答えたかで決める**——通常のエンジンは
/// `go mate` の上限を読まずに探索を続け、`stop` に `bestmove` で答える
/// （`research/engines/mate-engines.md`）
fn conclusion_at_limit(stopped: StopAnswer, win: Option<Win>) -> MateConclusion {
    match stopped {
        StopAnswer::Answered(StopReply::BestMove) => conclusion_of_bestmove(win),
        StopAnswer::Answered(StopReply::Checkmate(answer)) => conclusion_of(answer),
        StopAnswer::Answered(StopReply::AlreadyAnswered) => MateConclusion::Timeout,
        StopAnswer::Unanswered(_) => MateConclusion::StopUnanswered,
        StopAnswer::Unreachable(_) => MateConclusion::EngineExited,
    }
}

/// 最善手の読み筋が言う勝ち
#[derive(Debug, Clone, PartialEq, Eq)]
struct Win {
    plies: u32,
    moves: Vec<String>,
}

/// 最善手（`multipv` 1）の行から、勝ちを読み切ったかを覚え直す。確定の `score mate N`（N > 0）だけを採り、
/// 上界・下界と、負け（N < 0）は採らない。評価値の無い行では変えない
fn note_win(params: &[InfoParams], win: &mut Option<Win>) {
    if extract_rank(params) != 1 {
        return;
    }
    let Some((value, kind)) = params.iter().find_map(|p| match p {
        InfoParams::Score(value, kind) => Some((*value, kind)),
        _ => None,
    }) else {
        return;
    };
    *win = match (kind, u32::try_from(value)) {
        (ScoreKind::MateExact, Ok(plies)) if plies > 0 => Some(Win {
            plies,
            moves: params
                .iter()
                .find_map(|p| match p {
                    InfoParams::Pv(moves) => Some(moves.clone()),
                    _ => None,
                })
                .unwrap_or_default(),
        }),
        _ => None,
    };
}

/// `bestmove` で終わった詰み探索。詰み探索をしないエンジンは `go mate` を通常の探索として扱うが、
/// 勝ちを読み切っていれば、それを答えにする。読み切っていなければ、詰まないとも言えないので非対応
fn conclusion_of_bestmove(win: Option<Win>) -> MateConclusion {
    match win {
        Some(Win { plies, moves }) => MateConclusion::WinFound { plies, moves },
        None => MateConclusion::NotSupported,
    }
}

/// `checkmate` の答えを結論にする。読めない行はログに残す
fn conclusion_of(answer: MateAnswer) -> MateConclusion {
    match answer {
        MateAnswer::Mate(moves) => MateConclusion::Mate { moves },
        MateAnswer::NoMate => MateConclusion::NoMate,
        MateAnswer::Timeout => MateConclusion::Timeout,
        MateAnswer::NotImplemented => MateConclusion::NotSupported,
        MateAnswer::Unreadable(line) => {
            log::warn!(target: LOGT, "unreadable checkmate line: {}", shown(&line, MAX_LOGGED));
            MateConclusion::Unreadable
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::engine::registry::script::place_script;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex as StdMutex;

    /// 流した出来事を、途中経過と終わりに分けて残す
    #[derive(Default)]
    struct Recorded(StdMutex<Vec<AnalysisEvent>>);

    impl AnalysisEventSink for Recorded {
        fn emit(&self, event: AnalysisEvent) {
            self.0.lock().expect("記録").push(event);
        }
    }

    impl Recorded {
        fn finished(&self) -> Vec<MateSearchFinished> {
            self.0
                .lock()
                .expect("記録")
                .iter()
                .filter_map(|e| match e {
                    AnalysisEvent::MateFinished(f) => Some(f.clone()),
                    _ => None,
                })
                .collect()
        }

        fn updates(&self) -> usize {
            self.0
                .lock()
                .expect("記録")
                .iter()
                .filter(|e| matches!(e, AnalysisEvent::MateUpdate(_)))
                .count()
        }
    }

    struct Setup {
        searcher: MateSearcher,
        recorded: Arc<Recorded>,
        registry: Arc<EngineRegistry>,
        engine: String,
        dir: PathBuf,
    }

    /// 受けた行を `seen.log` に残し、`go mate` と `stop` への答えだけを差し替える台本
    fn script(on_go: &str, on_stop: &str) -> String {
        script_with(on_go, on_stop, "echo readyok")
    }

    fn script_with(on_go: &str, on_stop: &str, on_isready: &str) -> String {
        format!(
            r#"while read line; do
  echo "$line" >> seen.log
  case "$line" in
    usi) printf 'id name Mate\nusiok\n' ;;
    isready) {on_isready} ;;
    "go mate"*) {on_go} ;;
    stop) {on_stop} ;;
    quit) exit 0 ;;
  esac
done"#
        )
    }

    async fn setup(name: &str, body: &str) -> Setup {
        let dir = test_support::dir::temp_dir(name);
        let path = place_script(&dir, "engine.sh", body).await;
        let registry = Arc::new(EngineRegistry::new());
        let recorded = Arc::new(Recorded::default());
        let events: Arc<RwLock<Arc<dyn AnalysisEventSink>>> = Arc::new(RwLock::new(Arc::clone(
            &recorded,
        )
            as Arc<dyn AnalysisEventSink>));
        Setup {
            searcher: MateSearcher::new(Arc::clone(&registry), events),
            recorded,
            registry,
            engine: path.to_str().expect("パス").to_string(),
            dir,
        }
    }

    impl Setup {
        async fn start(&self, limit: Option<Duration>) -> Result<String, MateStartFailure> {
            let reservation = self.searcher.reserve().await;
            self.searcher
                .start(
                    reservation,
                    &self.engine,
                    &StartInput::default(),
                    "startpos".to_string(),
                    limit,
                )
                .await
        }

        async fn conclusion(&self) -> MateConclusion {
            wait_until("詰み探索の終わり", || {
                !self.recorded.finished().is_empty()
            })
            .await;
            self.recorded.finished().pop().expect("終わり").conclusion
        }

        fn seen(&self) -> Vec<String> {
            seen(&self.dir)
        }

        fn close(self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn seen(dir: &Path) -> Vec<String> {
        std::fs::read_to_string(dir.join("seen.log"))
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    async fn wait_until(what: &str, condition: impl Fn() -> bool) {
        for _ in 0..1000 {
            if condition() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("上限内に起きない: {what}");
    }

    /// AC-M1: `go mate <ミリ秒>` を送り、上限なしなら `go mate infinite`
    #[tokio::test]
    async fn the_limit_goes_out_in_milliseconds_or_as_infinite() {
        let s = setup("mate-limit", &script("echo 'checkmate nomate'", ":")).await;
        s.start(Some(Duration::from_secs(30)))
            .await
            .expect("始まる");
        assert_eq!(s.conclusion().await, MateConclusion::NoMate);
        s.start(None).await.expect("始まる");
        wait_until("2本目の終わり", || s.recorded.finished().len() == 2).await;
        let seen = s.seen();
        assert!(seen.contains(&"go mate 30000".to_string()), "{seen:?}");
        assert!(seen.contains(&"go mate infinite".to_string()), "{seen:?}");
        s.close();
    }

    /// AC-M1: 探索中の `info` は検討と同じ候補手として流れ、終わりの結果にも残る
    #[tokio::test]
    async fn info_lines_become_candidates() {
        let s = setup(
            "mate-info",
            &script(
                "echo 'info depth 5 multipv 1 score mate 3 pv 7g7f'; echo 'checkmate 7g7f'",
                ":",
            ),
        )
        .await;
        let session = s.start(None).await.expect("始まる");
        let conclusion = s.conclusion().await;
        assert_eq!(
            conclusion,
            MateConclusion::Mate {
                moves: vec!["7g7f".to_string()]
            }
        );
        assert!(s.recorded.updates() >= 1);
        let finished = s.recorded.finished().pop().expect("終わり");
        assert_eq!(finished.session_id, session);
        assert_eq!(finished.result.candidates.len(), 1);
        s.close();
    }

    /// AC-M2 AC-M4: 答えごとに別の結論になる。`bestmove` は非対応
    #[tokio::test]
    async fn each_answer_has_its_own_conclusion() {
        for (answer, expected) in [
            ("checkmate nomate", MateConclusion::NoMate),
            ("checkmate timeout", MateConclusion::Timeout),
            ("checkmate notimplemented", MateConclusion::NotSupported),
            ("bestmove 7g7f", MateConclusion::NotSupported),
            ("checkmate none", MateConclusion::Unreadable),
            ("checkmate", MateConclusion::Unreadable),
        ] {
            let s = setup("mate-answers", &script(&format!("echo '{answer}'"), ":")).await;
            s.start(None).await.expect("始まる");
            assert_eq!(s.conclusion().await, expected, "{answer}");
            s.close();
        }
    }

    /// AC-M3: 中止は `stop` を送り、エンジンの答え（時間切れ）でなく「中止」を返す
    #[tokio::test]
    async fn stopping_sends_stop_and_concludes_cancelled() {
        let s = setup(
            "mate-stop",
            &script(
                "echo 'info depth 1 multipv 1 score cp 1 pv 7g7f'",
                "echo 'checkmate timeout'",
            ),
        )
        .await;
        s.start(None).await.expect("始まる");
        wait_until("途中経過", || s.recorded.updates() > 0).await;
        s.searcher.stop().await;
        // `stop` が返った時点で終わりは流れている
        assert_eq!(
            s.recorded.finished().pop().expect("終わり").conclusion,
            MateConclusion::Cancelled
        );
        assert!(s.seen().contains(&"stop".to_string()));
        // エンジンは残り、次はそのまま探索できる
        s.start(None).await.expect("始まる");
        assert_eq!(s.seen().iter().filter(|l| *l == "usi").count(), 1);
        s.searcher.stop().await;
        s.close();
    }

    /// 走っていない詰み探索を止めても何も起きない
    #[tokio::test]
    async fn stopping_nothing_does_nothing() {
        let s = setup("mate-idle-stop", &script(":", ":")).await;
        s.searcher.stop().await;
        assert!(s.recorded.finished().is_empty());
        s.close();
    }

    /// `stop` に答えないエンジンは落とし、次に始めるときに起こし直す
    #[tokio::test]
    async fn an_engine_that_does_not_answer_stop_is_killed_and_restarted() {
        let s = setup("mate-deaf", &script(":", ":")).await;
        s.start(None).await.expect("始まる");
        s.searcher.stop().await;
        assert_eq!(
            s.recorded.finished().pop().expect("終わり").conclusion,
            MateConclusion::StopUnanswered
        );
        assert!(s.registry.ids().await.is_empty(), "落としていない");
        s.start(None).await.expect("起こし直せる");
        assert_eq!(s.seen().iter().filter(|l| *l == "usi").count(), 2);
        s.searcher.stop().await;
        s.close();
    }

    /// 探索中に終わったエンジンは「エンジンが終わった」で、次は起こし直す
    #[tokio::test]
    async fn an_engine_that_exits_is_reported_and_restarted() {
        let s = setup("mate-exit", &script("exit 1", ":")).await;
        s.start(None).await.expect("始まる");
        assert_eq!(s.conclusion().await, MateConclusion::EngineExited);
        assert!(s.registry.ids().await.is_empty(), "残している");
        s.start(None).await.expect("起こし直せる");
        assert_eq!(s.seen().iter().filter(|l| *l == "usi").count(), 2);
        s.close();
    }

    /// 同じ設定なら起こし直さず、別のパスなら前のエンジンを落として起こす
    #[tokio::test]
    async fn the_engine_is_kept_for_the_same_settings_and_replaced_for_others() {
        let s = setup("mate-reuse", &script("echo 'checkmate nomate'", ":")).await;
        s.start(None).await.expect("始まる");
        wait_until("終わり", || s.recorded.finished().len() == 1).await;
        s.start(None).await.expect("始まる");
        wait_until("終わり", || s.recorded.finished().len() == 2).await;
        assert_eq!(
            s.seen().iter().filter(|l| *l == "usi").count(),
            1,
            "同じ設定なのに入れ替えた"
        );

        // 設定が違えば起こし直す
        let reservation = s.searcher.reserve().await;
        let input = StartInput {
            eval_path: Some("/nonexistent/nn.bin".to_string()),
            ..StartInput::default()
        };
        s.searcher
            .start(reservation, &s.engine, &input, "startpos".to_string(), None)
            .await
            .expect("始まる");
        wait_until("終わり", || s.recorded.finished().len() == 3).await;
        assert_eq!(
            s.seen().iter().filter(|l| *l == "usi").count(),
            2,
            "使い回した"
        );
        assert_eq!(s.registry.ids().await.len(), 1, "前のエンジンが残っている");
        s.close();
    }

    /// 2本目を始めると、1本目は中止として終わる（同時に走らない）
    #[tokio::test]
    async fn starting_again_ends_the_running_search() {
        let s = setup(
            "mate-again",
            &script(
                "echo 'info depth 1 multipv 1 score cp 1 pv 7g7f'",
                "echo 'checkmate timeout'",
            ),
        )
        .await;
        let first = s.start(None).await.expect("始まる");
        let second = s.start(None).await.expect("始まる");
        assert_ne!(first, second);
        let finished = s.recorded.finished();
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].session_id, first);
        assert_eq!(finished[0].conclusion, MateConclusion::Cancelled);
        s.searcher.stop().await;
        s.close();
    }

    /// 起動を待っている間に止めたら始めず、起こしたプロセスも残さない。`reserve` の後の `stop` も同じ
    #[tokio::test]
    async fn stopping_while_the_engine_starts_supersedes_the_start() {
        let s = Arc::new(
            setup(
                "mate-cancel-start",
                &script_with(":", ":", "sleep 30; echo readyok"),
            )
            .await,
        );
        let start = tokio::spawn({
            let s = Arc::clone(&s);
            async move { s.start(None).await }
        });
        wait_until("usi を受ける", || {
            s.seen().iter().any(|l| l == "isready")
        })
        .await;
        s.searcher.stop().await;
        let started = tokio::time::timeout(Duration::from_secs(10), start)
            .await
            .expect("起動を待ち続けている")
            .expect("task");
        assert!(
            matches!(started, Err(MateStartFailure::Superseded)),
            "{started:?}"
        );
        assert!(
            s.registry.ids().await.is_empty(),
            "取り消したエンジンが残っている"
        );
        assert!(
            s.recorded.finished().is_empty(),
            "始めていないのに終わりを流した"
        );

        // `reserve` の後に止めたら、その `start` は始めない
        let stale = s.searcher.reserve().await;
        s.searcher.stop().await;
        let started = s
            .searcher
            .start(
                stale,
                &s.engine,
                &StartInput::default(),
                "startpos".to_string(),
                None,
            )
            .await;
        assert!(
            matches!(started, Err(MateStartFailure::Superseded)),
            "{started:?}"
        );
        let Ok(s) = Arc::try_unwrap(s) else {
            panic!("持ち手が残っている")
        };
        s.close();
    }

    /// `stop` に1秒遅れて答える台本
    fn slow_to_stop() -> String {
        script(
            "echo 'info depth 1 multipv 1 score cp 1 pv 7g7f'",
            "sleep 1; echo 'checkmate timeout'",
        )
    }

    /// 止めている途中に来た2人目の `stop` も、終わりを流し終えるまで返らない。
    /// 先に返ると、検討がエンジンの探索中に `go` を出す
    #[tokio::test]
    async fn a_second_stop_waits_for_the_same_end() {
        let s = Arc::new(setup("mate-two-stops", &slow_to_stop()).await);
        s.start(None).await.expect("始まる");
        let first = tokio::spawn({
            let s = Arc::clone(&s);
            async move { s.searcher.stop().await }
        });
        wait_until("stop が届く", || s.seen().iter().any(|l| l == "stop")).await;
        assert!(s.recorded.finished().is_empty(), "もう終わっている");

        s.searcher.stop().await;

        assert_eq!(s.recorded.finished().len(), 1, "終わる前に返った");
        first.await.expect("task");
        let Ok(s) = Arc::try_unwrap(s) else {
            panic!("持ち手が残っている")
        };
        s.close();
    }

    /// 追い越された古い `start` は、新しい `start` の探索を止めない
    #[tokio::test]
    async fn an_overtaken_start_leaves_the_newer_search_running() {
        let s = Arc::new(setup("mate-overtaken", &slow_to_stop()).await);
        let running = s.start(None).await.expect("始まる");
        let older = s.searcher.reserve().await;
        let old_start = tokio::spawn({
            let s = Arc::clone(&s);
            async move {
                s.searcher
                    .start(
                        older,
                        &s.engine,
                        &StartInput::default(),
                        "startpos".to_string(),
                        None,
                    )
                    .await
            }
        });
        wait_until("stop が届く", || s.seen().iter().any(|l| l == "stop")).await;

        let newer = s.start(None).await.expect("新しい方は始まる");

        let old = old_start.await.expect("task");
        assert!(matches!(old, Err(MateStartFailure::Superseded)), "{old:?}");
        // 古い順番の `start` が、新しい探索が走り出した後に来ても同じ
        let late = s
            .searcher
            .start(
                older,
                &s.engine,
                &StartInput::default(),
                "startpos".to_string(),
                None,
            )
            .await;
        assert!(
            matches!(late, Err(MateStartFailure::Superseded)),
            "{late:?}"
        );
        let finished = s.recorded.finished();
        assert_eq!(finished.len(), 1, "新しい探索まで終わらせた: {finished:?}");
        assert_eq!(finished[0].session_id, running);
        s.searcher.stop().await;
        assert_eq!(s.recorded.finished()[1].session_id, newer);
        let Ok(s) = Arc::try_unwrap(s) else {
            panic!("持ち手が残っている")
        };
        s.close();
    }

    /// 探索の合間に終わったエンジンは使い回さず、その場で起こし直す
    #[tokio::test]
    async fn an_engine_that_died_between_searches_is_restarted_at_once() {
        let s = setup("mate-died", &script("echo 'checkmate nomate'; exit 0", ":")).await;
        for n in 1..=2 {
            s.start(None).await.expect("始まる");
            wait_until("終わり", || s.recorded.finished().len() == n).await;
            // 出力の終わりが届くまで待つ
            let id = s
                .searcher
                .inner
                .lock()
                .await
                .engine
                .as_ref()
                .map(|e| e.id.clone());
            let id = id.expect("席にある");
            for _ in 0..200 {
                if !s.searcher.is_alive(&id).await {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
        assert_eq!(s.seen().iter().filter(|l| *l == "usi").count(), 2);
        s.close();
    }

    /// 上限を読まずに続けるエンジン（通常のエンジン）は、こちらから止め、`bestmove` なら非対応と言う
    #[tokio::test]
    async fn an_engine_that_ignores_the_limit_is_stopped_and_not_supported() {
        let s = setup("mate-overrun", &script(":", "echo 'bestmove 7g7f'")).await;
        s.start(Some(Duration::from_millis(50)))
            .await
            .expect("始まる");
        assert_eq!(s.conclusion().await, MateConclusion::NotSupported);
        s.close();
    }

    /// 上限で止めたときの結論は、何で答えたかで決まる
    #[test]
    fn the_conclusion_at_the_limit_follows_the_reply() {
        let at_limit = |reply| conclusion_at_limit(StopAnswer::Answered(reply), None);
        assert_eq!(at_limit(StopReply::BestMove), MateConclusion::NotSupported);
        assert_eq!(
            at_limit(StopReply::AlreadyAnswered),
            MateConclusion::Timeout
        );
        assert_eq!(
            at_limit(StopReply::Checkmate(MateAnswer::Timeout)),
            MateConclusion::Timeout
        );
        assert_eq!(
            at_limit(StopReply::Checkmate(MateAnswer::NoMate)),
            MateConclusion::NoMate
        );
    }

    /// 通常のエンジンが勝ちを読み切って `bestmove` で終えたら、非対応と言わずに手順を返す。
    /// 最後に見た最善手の行で決まる
    #[tokio::test]
    async fn a_bestmove_with_a_proven_mate_is_a_win_found() {
        let win = |plies, moves: &[&str]| MateConclusion::WinFound {
            plies,
            moves: moves.iter().map(|m| (*m).to_string()).collect(),
        };
        for (lines, expected) in [
            (
                "info depth 1 multipv 1 score mate 1 pv G*5b",
                win(1, &["G*5b"]),
            ),
            // 読み筋が手数に足りない
            (
                "info depth 9 multipv 1 score mate 3 pv G*5b",
                win(3, &["G*5b"]),
            ),
            // 2番目の候補手・下界・負けは採らない
            (
                "info depth 1 multipv 2 score mate 1 pv G*5b",
                MateConclusion::NotSupported,
            ),
            (
                "info depth 1 multipv 1 score mate 1 lowerbound pv G*5b",
                MateConclusion::NotSupported,
            ),
            (
                "info depth 1 multipv 1 score mate -2 pv 5i5h",
                MateConclusion::NotSupported,
            ),
        ] {
            let s = setup(
                "mate-win-found",
                &script(&format!("echo '{lines}'; echo 'bestmove G*5b'"), ":"),
            )
            .await;
            s.start(None).await.expect("始まる");
            assert_eq!(s.conclusion().await, expected, "{lines}");
            s.close();
        }
    }

    /// 後の行で評価値が変われば取り消し、評価値の無い行（`nps` だけなど）では変えない
    #[test]
    fn the_last_best_line_decides_the_win() {
        let mut win = None;
        let mut note = |line: &str| {
            let usi::EngineCommand::Info(params) = usi::EngineCommand::parse(line).expect("解ける")
            else {
                panic!("{line}")
            };
            note_win(&params, &mut win);
            win.clone()
        };
        assert!(note("info depth 1 score mate 3 pv G*5b").is_some());
        assert!(note("info nps 100").is_some());
        assert!(note("info depth 2 score cp 100 pv G*5b").is_none());
    }

    /// 上限で止めた通常のエンジンも、勝ちを読み切っていればそれを答えにする
    #[tokio::test]
    async fn a_win_found_before_the_limit_is_kept() {
        let s = setup(
            "mate-win-limit",
            &script(
                "echo 'info depth 1 multipv 1 score mate 1 pv G*5b'",
                "echo 'bestmove G*5b'",
            ),
        )
        .await;
        s.start(Some(Duration::from_millis(50)))
            .await
            .expect("始まる");
        assert!(matches!(
            s.conclusion().await,
            MateConclusion::WinFound { plies: 1, .. }
        ));
        s.close();
    }
}
