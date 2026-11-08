//! 起動したエンジンへ設定を送り、使える状態（`readyok`）にするレイヤ。
//!
//! 通るのは対局（`game/start.rs` の `prepare_engine`）と検討（`EngineAnalyzer::start_engine`）。
//! 手順を別々に書くと片方にだけ直しが入り（`readyok` を待つ／待たない、順序を保つ／保たない）、
//! 食い違いはエンジンを起こしてからしか出ない。
//! 送って待つのは手順「準備」と「値の確認」（`UsiProtocol::prepare` と `check_value`）で、
//! `setoption` を組むのがその2つだけであることは `tests/layering.rs` が見る。ここに残るのは、
//! 送る前に値で断ること（`validate_options`）と、返った行の読み方。

use std::time::{Duration, Instant};

use crate::engine::logging::shown;
use crate::engine::protocol::{contains_usi_breaking_char, UsiProtocol};
use crate::engine::types::{BookPathSupport, EngineError, SetOptionValue};

/// 線に出る1行の欄（`setoption` の名前・値、対局の開始局面）の長さの上限（バイト）。
///
/// 長さを見ないと、`check_writable` の `to_string` で写しが作られ、書き込みは `WRITE_TIMEOUT` で
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
/// **起動を始める前に呼ぶ。** `checked_prepare` も制御文字を見るが、そこで断るのは
/// プロセスを起こした後——検討なら動いていたエンジンを落とした後になる。
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

/// 値を検査してから、手順「準備」（`UsiProtocol::prepare`）を通す。返すのは `readyok` までの
/// `info string` の文。
///
/// - `deadline`: 全体の締切。`None` なら締切なし
/// - `ready_limit`: `readyok` を待つ上限。`None` なら上限なし（検討は、DNN 系の初回の読み込みに
///   上限を置けないので `None` を渡す）
///
/// **並べ替えない。** 値の解釈が前の `setoption` に依存するエンジンがあるので、順は呼び手が決める。
/// `usinewgame` は送らない（締切の見直し方が呼び手ごとに違う）。
pub async fn checked_prepare(
    protocol: &UsiProtocol,
    options: &[SetOptionValue],
    deadline: Option<Instant>,
    ready_limit: Option<Duration>,
) -> Result<Vec<String>, EngineError> {
    validate_options(options)?;
    protocol.prepare(options, deadline, ready_limit).await
}

/// 選択肢（combo）で申告した名前が、**選択肢に無い値をパスとして受けるか**を、送って確かめる。
///
/// 実在しないパスを1つ送り、手順「値の確認」（`UsiProtocol::check_value`）で `usiok` を待つ。
/// その間に選択肢に無いという行（`value not found`。大小を問わない。やねうら王 V9.00 は
/// `info string Error! : combo value not found, …`）が出れば `Rejects`、出なければ `Accepts`、`limit` までに
/// `usiok` が来なければ `NoAnswer`。
///
/// **`Accepts` は「断らなかった」でしかない。** 黙って捨てるエンジンもここを通るので、送った後に読んだかを
/// 確かめる（`binding::book_load_warning`）。確かめに送ったパスは実在しないので、後から本物の値で上書き
/// されなくても（`no_book` の無いエンジン）、読める定跡は無い。`readyok` の前に呼ぶ
pub async fn check_book_path_support(
    protocol: &UsiProtocol,
    name: &str,
    limit: Duration,
) -> Result<BookPathSupport, EngineError> {
    // 一時フォルダはワークツリー・プロセスをまたいで共有されるので、プロセスの番号も混ぜる
    let probe_path = std::env::temp_dir()
        .join(format!(
            "obs-shogi-no-such-book-{}-{}.db",
            std::process::id(),
            uuid::Uuid::new_v4()
        ))
        .to_string_lossy()
        .into_owned();
    validate_options(&[SetOptionValue {
        name: name.to_string(),
        value: probe_path.clone(),
    }])?;

    let support = match protocol.check_value(name, &probe_path, limit).await? {
        Some(texts) if texts.iter().any(|text| says_value_not_in_vars(text)) => {
            BookPathSupport::Rejects
        }
        Some(_) => BookPathSupport::Accepts,
        None => BookPathSupport::NoAnswer,
    };
    Ok(support)
}

/// `info string` の行が「選択肢に無い値」を言っているか（やねうら王 V9.00 の綴りを大小を問わずに）
fn says_value_not_in_vars(text: &str) -> bool {
    text.to_ascii_lowercase().contains("value not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::types::TIMED_OUT;
    use usi::InfoParams;

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
            checked_prepare(&protocol, &[option("B", "1"), option("A", "2")], None, None)
                .await
                .expect("readyok まで通る");
            checked_prepare(&protocol, &[option("C", "3")], None, None)
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

        /// 準備は `readyok` までの `info string` の文を、着いた順に返す（定跡を読めたかの判定に使う）。
        /// `info string` でない行と、読み筋の `info` は返さない
        #[tokio::test]
        async fn the_info_strings_before_readyok_are_returned() {
            let dir = test_support::dir::temp_dir("setup-info-strings");
            let protocol = spawn(
                &dir,
                r#"while read line; do
  case "$line" in
    usi) printf 'id name Talks\nusiok\n' ;;
    isready) printf 'info string reading book\ninfo depth 1 score cp 0 pv 7g7f\ninfo string book loaded\nreadyok\n' ;;
  esac
done"#,
            )
            .await;

            let texts = checked_prepare(&protocol, &[option("BookFile", "a.db")], None, None)
                .await
                .expect("readyok まで通る");
            assert_eq!(texts, ["reading book", "book loaded"]);
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

            let error = checked_prepare(&protocol, &[], None, None)
                .await
                .expect_err("readyok を返さずに終わったのに通っている");
            let EngineError::CommunicationFailed(why) = &error else {
                panic!("出力が終わった失敗になっていない: {error}");
            };
            assert!(why.to_string().contains("failed to read nn.bin"), "{why}");
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
            let ended =
                tokio::time::timeout(Duration::from_secs(5), protocol.end_watch().wait()).await;
            let Ok(_) = ended else {
                panic!("落ちたエンジンの出力の終わりが見えない");
            };

            let error = checked_prepare(&protocol, &[option("Threads", "1")], None, None)
                .await
                .expect_err("落ちたのに通っている");
            let EngineError::CommunicationFailed(why) = &error else {
                panic!("出力が終わった失敗になっていない: {error}");
            };
            assert!(why.to_string().contains("bad option Threads"), "{why}");
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
                tokio::spawn(async move { checked_prepare(&protocol, &[], None, None).await })
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
            let error = checked_prepare(&protocol, &[option("A", "1")], Some(Instant::now()), None)
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

    /// やねうら王 V9.00 の実機の行（`tests/fixtures/usi/yaneuraou-book-lines.txt` の1行目）が、
    /// 行の読み取り（`EngineCommand::parse`）を通って「選択肢に無い」と読めること。
    /// **読めないと「断らなかった」になり、パスを送る**
    #[test]
    fn the_real_v900_rejection_line_is_read_as_a_rejection() {
        let lines: Vec<&str> = include_str!("../../tests/fixtures/usi/yaneuraou-book-lines.txt")
            .lines()
            .filter(|l| !l.starts_with('#'))
            .collect();
        let parsed = usi::EngineCommand::parse(lines[0]).expect("解ける");
        let usi::EngineCommand::Info(params) = parsed else {
            panic!("info として読めない: {parsed:?}");
        };
        assert!(params
            .iter()
            .any(|p| matches!(p, InfoParams::Text(t) if says_value_not_in_vars(t))));
        // 別の行（読んだ・読めない）は断りと読まない
        for line in &lines[1..] {
            assert!(!says_value_not_in_vars(line), "{line}");
        }
        assert!(says_value_not_in_vars("info string COMBO VALUE NOT FOUND"));
    }
}
