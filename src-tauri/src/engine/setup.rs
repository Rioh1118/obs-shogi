//! 起動したエンジンへ設定を送り、使える状態（`readyok`）にする段。解析と対局が同じ手順を通る。
//!
//! 手順を2箇所に書くと、片方にだけ直しが入る（`readyok` を待つ／待たない、順序を保つ／保たない）。
//! 食い違いはエンジンを起こしてからしか出ないので、テストより前に気付く手段が無い。

use std::time::{Duration, Instant};

use usi::GuiCommand;

use crate::engine::launchable::{self, Inspection, Launchability};
use crate::engine::protocol::{contains_usi_breaking_char, UsiProtocol, NO_USIOK};
use crate::engine::types::{
    EngineError, SetOptionValue, StartFailure, StartFailureKind, TIMED_OUT,
};
use crate::engine::utils::shown;

/// `StartFailure::message` に載せる長さ（文字）。エンジンの出力を含むので切る
const MAX_FAILURE_MESSAGE: usize = 512;

/// `setoption` を**並べた順に**送り、`isready` を必ず送って `readyok` を待つ。
///
/// - `deadline`: 全体の締切。`setoption` を1件送るごとに残りを見る。`None` なら締切なし
/// - `ready_limit`: `readyok` を待つ上限。締切の残りと小さいほうを使う。`None` なら上限なし
///   （解析は、DNN 系の初回の読み込みに上限を置けないので `None` を渡す）
///
/// **並べ替えない。** 値の解釈が前の `setoption` に依存するエンジンがあるので、順は呼び手が決める。
/// `usinewgame` は送らない（締切の見直し方が呼び手ごとに違う）。
pub async fn send_setup(
    protocol: &UsiProtocol,
    options: &[SetOptionValue],
    deadline: Option<Instant>,
    ready_limit: Option<Duration>,
) -> Result<(), EngineError> {
    for SetOptionValue { name, value } in options {
        // USI は行指向なので、改行を混ぜられると別のコマンドを注入できる
        if contains_usi_breaking_char(name) || contains_usi_breaking_char(value) {
            return Err(EngineError::InvalidState(format!(
                "option '{}' contains a forbidden control character",
                shown(name, 64)
            )));
        }
        if let Some(deadline) = deadline {
            remaining(deadline, "the options were sent")?;
        }
        protocol
            .send_command(&GuiCommand::SetOption(name.clone(), Some(value.clone())))
            .await?;
    }

    let limit = match deadline {
        Some(deadline) => {
            let left = remaining(deadline, "the engine said readyok")?;
            Some(ready_limit.map_or(left, |limit| limit.min(left)))
        }
        None => ready_limit,
    };
    protocol.become_ready(limit).await
}

/// 締切までの残り。尽きていたら時間切れ（`TIMED_OUT` で始まる文言）
pub fn remaining(deadline: Instant, what: &str) -> Result<Duration, EngineError> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(EngineError::Timeout(format!("{TIMED_OUT} before {what}")));
    }
    Ok(left)
}

/// 起動の失敗を種類に分ける。**画面の文言は種類から組む**ので、分類はここ1つにする。
///
/// 出力が終わった失敗は、macOS が開くのを許可していない実行ファイルかを見て分ける。
/// 許可されていない実行ファイルは、起動した直後に OS に止められて同じ形で終わる。
pub fn classify(error: &EngineError, engine_path: &str) -> StartFailure {
    let kind = match error {
        EngineError::Cancelled(_) => StartFailureKind::Cancelled,
        EngineError::Timeout(_) => StartFailureKind::TimedOut,
        EngineError::InvalidState(_) => StartFailureKind::InvalidValue,
        EngineError::StartupFailed(why) if why.starts_with(NO_USIOK) => StartFailureKind::NotUsi,
        EngineError::StartupFailed(_) => StartFailureKind::SpawnFailed,
        EngineError::CommunicationFailed(_) if blocked_by_macos(engine_path) => {
            StartFailureKind::Quarantined
        }
        EngineError::CommunicationFailed(_) => StartFailureKind::ExitedEarly,
        EngineError::NotInitialized(_)
        | EngineError::ProtocolViolation(_)
        | EngineError::AnalysisFailed(_)
        | EngineError::AlreadyListening(_) => StartFailureKind::Other,
    };
    StartFailure {
        kind,
        message: shown(&error.to_string(), MAX_FAILURE_MESSAGE),
    }
}

fn blocked_by_macos(engine_path: &str) -> bool {
    launchable::inspect(std::path::Path::new(engine_path))
        == Inspection::Program(Launchability::Quarantined)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_are_sorted_by_what_the_user_can_do() {
        let kind = |error: EngineError| classify(&error, "/nonexistent/engine").kind;
        assert_eq!(
            kind(EngineError::Cancelled("x".into())),
            StartFailureKind::Cancelled
        );
        assert_eq!(
            kind(EngineError::Timeout(format!("{TIMED_OUT} waiting"))),
            StartFailureKind::TimedOut
        );
        assert_eq!(
            kind(EngineError::StartupFailed(format!("{NO_USIOK} in 30s"))),
            StartFailureKind::NotUsi
        );
        assert_eq!(
            kind(EngineError::StartupFailed(
                "Failed to spawn engine: Permission denied".into()
            )),
            StartFailureKind::SpawnFailed
        );
        assert_eq!(
            kind(EngineError::CommunicationFailed(
                "engine exited before it became ready".into()
            )),
            StartFailureKind::ExitedEarly
        );
        assert_eq!(
            kind(EngineError::InvalidState("option 'x' contains".into())),
            StartFailureKind::InvalidValue
        );
    }

    /// 理由に載る文言は長さと制御文字を落としてある
    #[test]
    fn the_message_is_bounded_and_has_no_control_characters() {
        let failure = classify(
            &EngineError::CommunicationFailed(format!("x\n\u{1b}[31m{}", "y".repeat(10_000))),
            "/nonexistent/engine",
        );
        assert!(failure.message.chars().count() <= MAX_FAILURE_MESSAGE + 1);
        assert!(!failure.message.chars().any(char::is_control));
    }

    /// 実プロセスで確かめる
    #[cfg(unix)]
    mod with_a_process {
        use super::*;
        use crate::engine::child::script::spawn_script;
        use std::sync::Arc;

        /// 受けた行を `log` に書き、`usi` と `isready` に答える台本
        const ANSWERS: &str = r#"while read line; do
  echo "$line" >> log
  case "$line" in
    usi) printf 'id name Setup\nusiok\n' ;;
    isready) echo readyok ;;
  esac
done"#;

        async fn spawn(dir: &std::path::Path, body: &str) -> Arc<UsiProtocol> {
            Arc::new(UsiProtocol::new(spawn_script(dir, body).await))
        }

        fn log_lines(dir: &std::path::Path) -> Vec<String> {
            std::fs::read_to_string(dir.join("log"))
                .unwrap_or_default()
                .lines()
                .map(str::to_string)
                .collect()
        }

        /// 並べた順に送り、準備済みでも `isready` を送り直す（送った設定を読ませるため）
        #[tokio::test]
        async fn options_go_in_order_and_isready_is_sent_every_time() {
            let dir = test_support::dir::temp_dir("setup-order");
            let protocol = spawn(&dir, ANSWERS).await;
            let option = |name: &str, value: &str| SetOptionValue {
                name: name.to_string(),
                value: value.to_string(),
            };

            send_setup(&protocol, &[option("B", "1"), option("A", "2")], None, None)
                .await
                .expect("readyok まで通る");
            send_setup(&protocol, &[option("C", "3")], None, None)
                .await
                .expect("2度目も readyok まで通る");

            assert_eq!(
                log_lines(&dir),
                [
                    "setoption name B value 1",
                    "setoption name A value 2",
                    "isready",
                    "setoption name C value 3",
                    "isready",
                ]
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `readyok` の前に終わったら、直近の出力を添えて出力が終わった失敗として返す
        #[tokio::test]
        async fn an_engine_that_dies_on_isready_is_reported_with_its_output() {
            let dir = test_support::dir::temp_dir("setup-dies");
            let protocol = spawn(
                &dir,
                r#"while read line; do
  case "$line" in
    usi) printf 'id name Dies\nusiok\n' ;;
    isready) echo 'Error! : failed to read nn.bin' >&2; exit 1 ;;
  esac
done"#,
            )
            .await;

            let error = send_setup(&protocol, &[], None, None)
                .await
                .expect_err("readyok を返さずに終わったのに通っている");
            let failure = classify(&error, "/nonexistent/engine");
            assert_eq!(failure.kind, StartFailureKind::ExitedEarly);
            assert!(
                failure.message.contains("failed to read nn.bin"),
                "{}",
                failure.message
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `readyok` を待っている最中に落とすと、取り消しとして返る（失敗として見せない）
        #[tokio::test]
        async fn killing_while_waiting_for_readyok_is_a_cancellation() {
            let dir = test_support::dir::temp_dir("setup-cancel");
            // `isready` に答えない
            let protocol = spawn(
                &dir,
                r#"while read line; do
  case "$line" in
    usi) printf 'id name Silent\nusiok\n' ;;
  esac
done"#,
            )
            .await;

            let waiting = {
                let protocol = std::sync::Arc::clone(&protocol);
                tokio::spawn(async move { send_setup(&protocol, &[], None, None).await })
            };
            tokio::time::sleep(Duration::from_millis(100)).await;
            protocol.kill_engine().await;

            let error = tokio::time::timeout(Duration::from_secs(10), waiting)
                .await
                .expect("落としても待ちが解けない")
                .expect("タスク")
                .expect_err("落としたのに通っている");
            assert_eq!(
                classify(&error, "/nonexistent/engine").kind,
                StartFailureKind::Cancelled
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 締切を過ぎていたら、送る前に時間切れで断る（目印は先頭）
        #[tokio::test]
        async fn a_spent_deadline_is_a_timeout_before_sending() {
            let dir = test_support::dir::temp_dir("setup-deadline");
            let protocol = spawn(&dir, ANSWERS).await;
            let option = SetOptionValue {
                name: "A".to_string(),
                value: "1".to_string(),
            };

            let error = send_setup(&protocol, &[option], Some(Instant::now()), None)
                .await
                .expect_err("締切を過ぎているのに送っている");
            let EngineError::Timeout(why) = &error else {
                panic!("時間切れとして断っていない: {error}");
            };
            assert!(why.starts_with(TIMED_OUT), "{why}");
            assert!(
                !log_lines(&dir).iter().any(|l| l.starts_with("setoption")),
                "締切の後に送っている"
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
