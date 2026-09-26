//! 起動したエンジンへ設定を送り、使える状態（`readyok`）にする段。
//!
//! 通るのは対局（`game/session.rs` の `prepare_engine`）と解析（`EngineAnalyzer::start_engine`。
//! `apply_settings` は送るところだけ）。手順を別々に書くと片方にだけ直しが入り（`readyok` を待つ／待たない、
//! 順序を保つ／保たない）、食い違いはエンジンを起こしてからしか出ない。
//! `setoption` を組むのがこのファイルだけであることは `tests/layering.rs` が見る。

use std::time::{Duration, Instant};

use usi::GuiCommand;

use crate::engine::protocol::{contains_usi_breaking_char, UsiProtocol};
use crate::engine::types::{EngineError, SetOptionValue, TIMED_OUT};
use crate::engine::utils::shown;

/// 線に出る1行の欄（`setoption` の名前・値、対局の開始局面）の長さの上限（バイト）。
///
/// 長さを見ないと、`check_writable` の `to_string` で写しが1本、`push_pending` の `clone` で
/// もう1本作られ、積み置きは `PENDING_LIMIT` 件まで滞留する。書き込みは `WRITE_TIMEOUT` で
/// 切れて `fail_writes` が走り、**そのエンジンは以後何も受け付けなくなる**——出るのは
/// 「stdin を読まなくなった」で、長すぎたことは分からない。
///
/// 8KB にしたのは、平手の SFEN が 60 バイト前後、最長の駒落ちでも 100 バイト未満で、
/// `setoption` の値（評価関数のパス、`USI_Hash` の数値）も収まる幅だから。
pub const MAX_WIRE_FIELD: usize = 8 * 1024;

/// 1回の起動で送れる `setoption` の件数の上限。
///
/// 1件ごとに `WRITE_TIMEOUT` が積まれるので、件数がそのまま起動の待ち時間になる。
/// 実在するエンジンの option は多くて数十件。
pub const MAX_SENT_OPTIONS: usize = 128;

/// 送る前に断れるものを断る（件数・長さ・制御文字）。値だけで決まる。
///
/// **起動を始める前に呼ぶ。** `send_setup` も制御文字を見るが、そこで断るのは
/// プロセスを起こした後——解析なら動いていたエンジンを落とした後になる。
pub fn validate_options(options: &[SetOptionValue]) -> Result<(), EngineError> {
    if options.len() > MAX_SENT_OPTIONS {
        return Err(EngineError::InvalidState(format!(
            "{} options; the limit is {MAX_SENT_OPTIONS}",
            options.len()
        )));
    }
    for SetOptionValue { name, value } in options {
        if name.len() > MAX_WIRE_FIELD || value.len() > MAX_WIRE_FIELD {
            return Err(EngineError::InvalidState(format!(
                "option '{}' is longer than {MAX_WIRE_FIELD} bytes",
                shown(name, 40)
            )));
        }
        // USI は行指向なので、改行を混ぜられると別のコマンドを注入できる
        if contains_usi_breaking_char(name) || contains_usi_breaking_char(value) {
            return Err(EngineError::InvalidState(format!(
                "option '{}' contains a forbidden control character",
                shown(name, 40)
            )));
        }
    }
    Ok(())
}

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
    send_options(protocol, options, deadline).await?;

    let limit = match deadline {
        Some(deadline) => {
            let left = remaining(deadline, "the engine said readyok")?;
            Some(ready_limit.map_or(left, |limit| limit.min(left)))
        }
        None => ready_limit,
    };
    protocol.become_ready(limit).await
}

/// `setoption` を並べた順に送るだけ。`readyok` は待たない。
///
/// 送る途中でエンジンが落ちたら、`readyok` の前に落ちたときと同じく直近の出力を添えて返す。
/// **待たない呼び手は `EngineAnalyzer::apply_settings` だけ**——フロントの停止が進行中の起動を
/// 待ってから止めるので、そこで `readyok` を待つと、答えないエンジンで停止ごと固まる。
pub async fn send_options(
    protocol: &UsiProtocol,
    options: &[SetOptionValue],
    deadline: Option<Instant>,
) -> Result<(), EngineError> {
    validate_options(options)?;
    for SetOptionValue { name, value } in options {
        if let Some(deadline) = deadline {
            remaining(deadline, "the options were sent")?;
        }
        let sent = protocol
            .send_command(&GuiCommand::SetOption(name.clone(), Some(value.clone())))
            .await;
        if let Err(e) = sent {
            return Err(protocol.with_recent_output(e).await);
        }
    }
    Ok(())
}

/// 締切までの残り。尽きていたら時間切れ（`TIMED_OUT` で始まる文言）。
///
/// **`timeout` で包ませず、残りを渡して各段に自分で締めさせる。** 包むと、上限に当たったときに
/// 中の future ごと落ちる——`registry.spawn` が返した直後だと、台帳に載ったプロセスの ID を
/// 誰も知らないまま消える。
pub fn remaining(deadline: Instant, what: &str) -> Result<Duration, EngineError> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(EngineError::Timeout(format!("{TIMED_OUT} before {what}")));
    }
    Ok(left)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(name: &str, value: &str) -> SetOptionValue {
        SetOptionValue {
            name: name.to_string(),
            value: value.to_string(),
        }
    }

    /// 件数・長さ・制御文字を、送る前に値だけで断る
    #[test]
    fn options_that_cannot_be_sent_are_refused_before_starting() {
        let refused = |options: &[SetOptionValue]| {
            matches!(validate_options(options), Err(EngineError::InvalidState(_)))
        };
        assert!(validate_options(&vec![option("EvalDir", "/eval"); MAX_SENT_OPTIONS]).is_ok());
        assert!(validate_options(&[option("x", &"1".repeat(MAX_WIRE_FIELD))]).is_ok());

        assert!(refused(&vec![option("x", "1"); MAX_SENT_OPTIONS + 1]));
        assert!(refused(&[option("x", &"1".repeat(MAX_WIRE_FIELD + 1))]));
        assert!(refused(&[option(&"x".repeat(MAX_WIRE_FIELD + 1), "1")]));
        assert!(refused(&[option("EvalDir", "/eval\ninjected")]));
        assert!(refused(&[option("Eval\rDir", "/eval")]));
    }

    /// 実プロセスで確かめる
    #[cfg(unix)]
    mod with_a_process {
        use super::*;
        use crate::engine::protocol::script::spawn_protocol;
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
            Arc::new(spawn_protocol(dir, body).await)
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
            let EngineError::CommunicationFailed(why) = &error else {
                panic!("出力が終わった失敗になっていない: {error}");
            };
            assert!(why.contains("failed to read nn.bin"), "{why}");
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// `setoption` を送れなかったときも、直近の出力を添えて返す（出力が終わった後の送信は
        /// 書く前に断られるので、`readyok` の待ちまで進まない）
        #[tokio::test]
        async fn an_option_refused_by_a_dead_engine_is_reported_with_its_output() {
            let dir = test_support::dir::temp_dir("setup-dead-before-option");
            let protocol = spawn(&dir, "echo 'Error! : bad option Threads' >&2; exit 1").await;
            // 出力が終わったと見えるまで待つ（見えた後の送信は書く前に断られる）
            let mut refused = false;
            for _ in 0..500 {
                if protocol.send_command(&GuiCommand::Usi).await.is_err() {
                    refused = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert!(refused, "落ちたエンジンへの送信が断られない");

            let error = send_setup(&protocol, &[option("Threads", "1")], None, None)
                .await
                .expect_err("落ちたのに通っている");
            let EngineError::CommunicationFailed(why) = &error else {
                panic!("出力が終わった失敗になっていない: {error}");
            };
            assert!(why.contains("bad option Threads"), "{why}");
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
            assert!(
                matches!(error, EngineError::Cancelled(_)),
                "取り消しになっていない: {error}"
            );
            protocol.kill_engine().await;
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 締切を過ぎていたら、送る前に時間切れで断る（目印は先頭）
        #[tokio::test]
        async fn a_spent_deadline_is_a_timeout_before_sending() {
            let dir = test_support::dir::temp_dir("setup-deadline");
            let protocol = spawn(&dir, ANSWERS).await;
            let error = send_setup(&protocol, &[option("A", "1")], Some(Instant::now()), None)
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
