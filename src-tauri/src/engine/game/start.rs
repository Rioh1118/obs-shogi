//! 対局のエンジンを起こし、`usinewgame` まで進める段取りと、その締切。
//!
//! 隠すのは、1局ぶんの締切（`START_TIMEOUT`）を段ごとの上限へどう配るかと、
//! 締切で断るときの断り文句の形（先頭の `TIMED_OUT`）。

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::engine::logging::{shown, MAX_SUMMARY_LEN};
use crate::engine::protocol::{self, READY_TIMEOUT, USI_OK_TIMEOUT};
use crate::engine::registry::SPAWN_TIMEOUT;
use crate::engine::registry::{EngineId, EngineProcess, EngineRegistry};
use crate::engine::setup;
use crate::engine::types::{engine_error_text, EngineError, StartupReason, TIMED_OUT};

use super::types::*;

/// `start_game` が返るまでの上限。**1局ぶん全体で見る。**
///
/// 段ごとの上限（`SPAWN_TIMEOUT` / `USI_OK_TIMEOUT` / `READY_TIMEOUT`）を
/// 素直に足すとここを大きく超える（関係は `the_steps_alone_would_overrun_the_start_budget`）。
/// その間 `start_game` は返らず、
/// **フロントには進捗も残り時間も無く、取り消す経路も無い**。
/// `EvalDir` を1文字間違えて `readyok` を返さなくなったエンジン——F-27 が
/// 「最も起きやすい」と書いている形——がそこに落ちる。
///
/// **段ごとの上限を消さない。** ここは全体の締切で、段ごとの上限は
/// 「そこで待つのが妥当な長さ」。どちらか一方だと、片方の段が全部を食う。
/// 各段には残りを渡して縮めさせる（`SPAWN_TIMEOUT.min(left)` の形）——
/// 渡さないと、締切が尽きかけていても段は自前の上限を丸ごと使える。
///
/// **厳密な上限ではない。** 段に入る前に残りを見るので、入った段が
/// 締切を跨ぐぶんは超える。**どの段も入口で残りを見る**ので、跨ぎうるのは
/// 書き込み1件ぶん（`WRITE_TIMEOUT`）と、失敗したときの後始末
/// （`registry::shutdown`）。どのコマンドかは書かない——`send_game_setup` に
/// 1行足すたびに離れたここが嘘になる。
///
/// 90秒にしたのは、評価関数の読み込みが重いエンジン（数十秒）を通し、
/// かつ人が「反応が無い」と判断する前に返るため。
///
/// **この締切で断るときは `TIMED_OUT` の綴りを入れる。** フロントは
/// それだけで「再試行してよい失敗」を見分ける（→ 台帳の F-27）。
pub const START_TIMEOUT: Duration = Duration::from_secs(90);

/// 締切までの残り（`setup::remaining`）を、対局の断り文句の形で返す。
fn remaining(deadline: Instant, what: &str) -> Result<Duration, String> {
    protocol::remaining(deadline, what).map_err(|e| engine_error_text(&e))
}

/// エンジン側の対局者を全部起動する。
/// 途中で失敗したら、それまでに起動したものを道連れに落とす
pub(super) async fn spawn_players(
    registry: &EngineRegistry,
    settings: &GameSettings,
    deadline: Instant,
) -> Result<(Vec<EngineId>, [Option<Arc<EngineProcess>>; 2]), String> {
    let mut ids = Vec::new();
    let mut engines: [Option<Arc<EngineProcess>>; 2] = [None, None];

    for side in SIDES {
        let spec = settings.spec(side);
        let PlayerSpec::Engine {
            engine_path,
            work_dir,
            options,
            ..
        } = spec
        else {
            continue;
        };

        match prepare_engine(
            registry,
            engine_path,
            work_dir.as_deref(),
            options,
            deadline,
        )
        .await
        {
            Ok(process) => {
                ids.push(process.id.clone());
                engines[side.index()] = Some(process);
            }
            Err(e) => {
                for id in &ids {
                    registry.shutdown(id).await;
                }
                // **目印を先頭から外さない。** 包むと `TIMED_OUT` が中へ潜り、
                // フロントが「遅かっただけ」を見分けられなくなる。
                // **名前も潰す。** webview から来る値なので、素で載せると
                // 断り文句に制御文字が入る（利用者にそのまま見せる契約）
                let name = shown(spec.name(), MAX_SUMMARY_LEN);
                return Err(if e.starts_with(TIMED_OUT) {
                    format!("{e} (while starting {name})")
                } else {
                    format!("failed to start {name}: {e}")
                });
            }
        }
    }

    Ok((ids, engines))
}

/// 起動の失敗を文字列にする。**`usiok` が来なかったときだけ、待った長さで分ける。**
///
/// `identify` は「答えなかった＝そのファイルは USI エンジンではない」と
/// 断る（`NO_USIOK`）。それが正しいのは**満額の `USI_OK_TIMEOUT` を渡したとき**
/// だけで、締切で取り分を削ったときは、満額なら答えていた可能性が残る。
///
/// 削られるのは実際に起きる。`START_TIMEOUT` は2体ぶんの合計で、1体目の
/// `readyok` は評価関数の重いエンジンで合法に数十秒を使う。その後ろに立つ
/// 2体目の取り分は 0 と `USI_OK_TIMEOUT` の間の任意の値になる。
///
/// **`for_usiok.is_zero()` の判定だけでは足りない。** 0 は断るが、1ミリ秒は通る。
/// 分けないと、締切の食い潰しが「設定の誤り」として届き、受け手は正常なエンジンの
/// パスを疑う——押し直せば通ったはずの起動をそこで捨てる（F-27）。
fn usiok_refusal(error: EngineError, for_usiok: Duration) -> String {
    // **理由の欄で見る。** 文で見ると、OS の文言やパスに同じ綴りを持ち込まれたときに分類が動く
    let starved = for_usiok < USI_OK_TIMEOUT
        && matches!(&error, EngineError::StartupFailed(detail) if matches!(detail.reason, StartupReason::NoUsiOk { .. }));
    if starved {
        format!("{TIMED_OUT} before the engine said usiok")
    } else {
        engine_error_text(&error)
    }
}

async fn prepare_engine(
    registry: &EngineRegistry,
    engine_path: &str,
    work_dir: Option<&str>,
    options: &[SetOptionValue],
    deadline: Instant,
) -> Result<Arc<EngineProcess>, String> {
    // **段ごとの上限を締切で縮める。** 縮めないと、`start_game` 全体の締切が
    // 尽きかけていても各段は自前の上限を丸ごと使えるので、`START_TIMEOUT` は
    // 「返るまでの上限」にならない（2体ぶんで `SPAWN_TIMEOUT` の20秒が外に積まれる）
    // **残りを2段に配る。** 1つの `min` で済ませると、`spawn` の取り分が残りを
    // 丸ごと食って `usiok` の取り分が 0 になる——プロセスは実際に起こしたうえで
    // 1回 poll しただけで殺し、フロントには「エンジンが `usiok` を返さない」と返る。
    // 利用者は起こしたばかりのエンジンのパスと評価関数を疑うが、
    // **そのエンジンには1ナノ秒も与えていない。**
    //
    // `spawn` は fork/exec だけで普通は数ミリ秒しか使わないので、取り分を先に
    // 決めてから引く。`usiok` に何も残らないなら**起こす前に締切として断る。**
    let left = remaining(deadline, "the engine started")?;
    let for_spawn = SPAWN_TIMEOUT.min(left);
    let for_usiok = USI_OK_TIMEOUT.min(left.saturating_sub(for_spawn));
    if for_usiok.is_zero() {
        return Err(format!("{TIMED_OUT} before the engine said usiok"));
    }
    let process = registry
        .spawn(engine_path, work_dir, for_spawn, for_usiok)
        .await
        .map_err(|e| usiok_refusal(e, for_usiok))?;

    let prepared = send_game_setup(&process, options, deadline).await;
    if let Err(e) = prepared {
        registry.shutdown(&process.id).await;
        return Err(e);
    }
    Ok(process)
}

/// `setoption` を送って `readyok` を待ち、`usinewgame` を出す。
///
/// 送って待つところは `setup::checked_prepare`（解析の `EngineAnalyzer::start_engine` と同じ段）を通す。
/// **締切を引き直しながら進む**
/// （`setoption` の件数はフロントから来るので、1件あたり `WRITE_TIMEOUT` が積まれる）。
async fn send_game_setup(
    process: &EngineProcess,
    options: &[SetOptionValue],
    deadline: Instant,
) -> Result<(), String> {
    let protocol = process.protocol();
    setup::checked_prepare(&protocol, options, Some(deadline), Some(READY_TIMEOUT))
        .await
        .map_err(|e| engine_error_text(&e))?;

    // **ここも残りを見る。** 見ないと、`readyok` の待ちが残りを使い切った直後でも
    // 無条件に書きに行く。しかもその `usinewgame` は、直後に2体目の
    // `prepare_engine` が締切で断って**落とすエンジン**へ送っていることがある
    remaining(deadline, "usinewgame was sent")?;
    protocol
        .new_game()
        .await
        .map_err(|e| engine_error_text(&e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::fixtures::two_humans;
    use super::*;
    use crate::engine::types::NO_USIOK;

    /// 締切で削った取り分で `usiok` を待ち損ねたとき、**エンジンのせいにしないこと。**
    ///
    /// `a_thin_budget_never_starts_an_engine_it_cannot_wait_for` が守るのは
    /// **厳密に 0 のときだけ**。1ミリ秒は `is_zero()` の判定を通り、そこで答えが来なければ
    /// `identify` は「そのファイルは USI エンジンではない」と断る。
    ///
    /// **その断り方は満額を渡したときにしか正しくない。** 締切の食い潰しが
    /// 「設定の誤り」として届くと、受け手は正常なエンジンのパスを疑い、
    /// 押し直せば通ったはずの起動をそこで捨てる（F-27）。
    ///
    /// 実プロセスは要らない——分けているのは `usiok_refusal` の中だけなので、
    /// 4通り（満額 × 理由が `NoUsiOk` か）を直に当てる。
    #[test]
    fn a_budget_starved_start_is_not_blamed_on_the_engine() {
        let no_usiok = || {
            EngineError::StartupFailed(
                StartupReason::NoUsiOk {
                    waited: Duration::from_millis(1),
                }
                .into(),
            )
        };

        // 削られた取り分 × `usiok` が来ない → 時間切れとして返す
        assert!(
            usiok_refusal(no_usiok(), USI_OK_TIMEOUT - Duration::from_millis(1))
                .starts_with(TIMED_OUT),
            "締切の食い潰しをエンジンのせいにしている"
        );

        // 満額 × `usiok` が来ない → そのまま。**待ち直しても変わらない**
        let full = usiok_refusal(no_usiok(), USI_OK_TIMEOUT);
        assert!(
            !full.starts_with(TIMED_OUT) && full.contains(NO_USIOK),
            "満額待った失敗が再試行の目印を名乗っている: {full}"
        );

        // 削られた取り分 × `usiok` 以外の失敗 → 書き換えない。
        // **実行権限が無いファイルを「遅かっただけ」にすると、直すものが消える**
        let denied =
            EngineError::StartupFailed("Failed to spawn engine: …os error 13".to_string().into());
        let text = usiok_refusal(denied, Duration::from_millis(1));
        assert!(
            !text.starts_with(TIMED_OUT) && text.contains("os error 13"),
            "`usiok` と無関係な失敗まで時間切れにしている: {text}"
        );

        // 削られた取り分 × 文に綴りがあるだけ → 書き換えない
        let smuggled =
            EngineError::StartupFailed(format!("Failed to spawn engine: /x/{NO_USIOK}/eng").into());
        assert!(
            !usiok_refusal(smuggled, Duration::from_millis(1)).starts_with(TIMED_OUT),
            "外から持ち込んだ綴りで分類が動いている"
        );
    }

    /// 締切が細ったとき、`usiok` の取り分を 0 にしないこと。
    ///
    /// **0 にすると、プロセスは実際に起こしたうえで1回 poll しただけで殺される。**
    /// フロントに返るのは「エンジンが `usiok` を返さない」で、利用者は起こしたばかりの
    /// エンジンのパスと評価関数を疑う——**そのエンジンには1ナノ秒も与えていないのに。**
    /// 与えられないなら、起こす前に締切として断る。
    #[tokio::test]
    async fn a_thin_budget_never_starts_an_engine_it_cannot_wait_for() {
        let mut settings = two_humans(vec![]);
        settings.black = PlayerSpec::Engine {
            name: "後手番のエンジン".to_string(),
            engine_path: "/nonexistent/engine".to_string(),
            work_dir: None,
            options: Vec::new(),
            ponder: false,
        };

        let registry = EngineRegistry::new();
        // `spawn` の取り分（`SPAWN_TIMEOUT`）は残っているが、`usiok` に回らない幅
        let deadline = Instant::now() + SPAWN_TIMEOUT;
        let error = spawn_players(&registry, &settings, deadline)
            .await
            .expect_err("`usiok` を待てない締切で起動している");

        assert!(
            error.contains(TIMED_OUT),
            "エンジンのせいとして断っている: {error}"
        );
    }

    /// 起動段の時間切れが、`TIMED_OUT` の綴りを必ず持つこと。
    ///
    /// **フロントが「再試行してよい失敗」を見分ける唯一の鍵。**（→ 台帳の F-27）
    /// 綴りが揃っていないと、**再試行で通る失敗を見分けられない**。
    ///
    /// 見ているのは `remaining` と `prepare_engine` の2つだけ。実プロセスを要する側の
    /// `readyok` の締切は `setup.rs` の `a_spent_deadline_is_a_timeout_before_sending` が踏む。
    /// `registry::spawn` と書き込みの締切は踏めない。
    #[test]
    fn a_startup_timeout_always_carries_the_marker() {
        let past = Instant::now() - Duration::from_secs(1);
        let error = remaining(past, "the options were sent").expect_err("締切を過ぎている");
        assert!(error.starts_with(TIMED_OUT), "先頭に目印が無い: {error}");
    }

    /// 時間切れ**でない**失敗が、目印を名乗れないこと。
    ///
    /// **部分一致で見ると、外から同じ綴りを持ち込める。** 断り文句には
    /// 対局者の表示名が素で載り、OS の文言も連なる（macOS の `ETIMEDOUT` は
    /// `Operation timed out`）。フロントは目印を見て「遅かっただけ。設定は
    /// 誤っていない」と表示するので、名乗られると**パスを直す導線が出ない**
    /// ——F-27 が挙げている唯一の導線。何度再試行しても通らない。
    #[tokio::test]
    async fn a_setup_failure_cannot_claim_the_retry_marker() {
        let registry = EngineRegistry::new();
        let mut settings = two_humans(vec![]);
        settings.black = PlayerSpec::Engine {
            // 目印を名乗る表示名
            name: TIMED_OUT.to_string(),
            engine_path: "/nonexistent/engine".to_string(),
            work_dir: None,
            options: vec![],
            ponder: false,
        };

        // **締切は十分に残す。** 残りが `SPAWN_TIMEOUT` を切ると
        // `prepare_engine` が本物の時間切れで断り、測りたいものが測れない
        let error = spawn_players(
            &registry,
            &settings,
            Instant::now() + SPAWN_TIMEOUT + USI_OK_TIMEOUT,
        )
        .await
        .expect_err("実在しないエンジンで起動している");

        assert!(
            !error.starts_with(TIMED_OUT),
            "設定の誤りが「遅かっただけ」を名乗っている: {error}"
        );

        // **本物の時間切れは、包んでも先頭に残ること。** 包み方を素に戻すと
        // 目印が中へ潜り、再試行で通る失敗を行き止まりとして案内することになる
        let timed_out = spawn_players(
            &registry,
            &settings,
            Instant::now() - Duration::from_secs(1),
        )
        .await
        .expect_err("締切を過ぎている");

        assert!(
            timed_out.starts_with(TIMED_OUT),
            "包んだせいで目印が先頭から外れている: {timed_out}"
        );
    }

    /// 対局の起動が、締切を過ぎたら**プロセスを起こす前に**断ること。
    ///
    /// 段ごとの上限しか無いと、それを足したぶんのあいだ `start_game` が返らない。
    /// フロントには進捗も残り時間も無く、取り消す経路も無い。
    ///
    /// **`timeout` で包まないので、後始末が普通に走る。** 包むと、上限に当たった
    /// ときに中の future ごと落ちて、台帳に載ったプロセスの ID を誰も知らないまま消える。
    #[tokio::test]
    async fn starting_a_game_stops_at_the_deadline() {
        let mut settings = two_humans(vec![]);
        settings.black = PlayerSpec::Engine {
            name: "存在しないエンジン".to_string(),
            engine_path: "/nonexistent/engine".to_string(),
            work_dir: None,
            options: Vec::new(),
            ponder: false,
        };

        let registry = EngineRegistry::new();
        let error = spawn_players(&registry, &settings, Instant::now())
            .await
            .expect_err("締切を過ぎているのに起動している");

        // 起こそうとして失敗したのではなく、起こす前に締切で断ったこと
        assert!(
            error.contains(TIMED_OUT),
            "締切ではなく起動の失敗で断っている: {error}"
        );
    }
}
