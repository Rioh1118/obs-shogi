//! 起動の失敗を、利用者が取れる行動の種類（`StartFailureKind`）に分けるレイヤ。
//!
//! **画面の文言は種類から組む**ので、検討の起動（`start_analysis_engine`）の分類はここに置く。
//! 対局の起動は文字列で返し、締切で削った `usiok` の待ちを時間切れとして読み直す
//! （`game/start.rs` の `usiok_refusal`）。ここはその前提を持たない——`StartupReason::NoUsiOk` を
//! `NotUsi` とするのは、呼び手が `USI_OK_TIMEOUT` を満額渡したときだけ正しい。

use std::path::PathBuf;
use std::time::Duration;

use crate::engine::eval_arch::read_eval_type;
use crate::engine::launchable::{self, Inspection, Launchability};
use crate::engine::logging::shown;
use crate::engine::types::{EngineError, StartFailure, StartFailureKind, StartupReason};

/// `StartFailure::message` に載せる長さ（文字）。エンジンの出力を含むので切る
const MAX_FAILURE_MESSAGE: usize = 512;

/// 隔離属性を読みに行く上限。応答しないボリュームでは読み取りが返らないので、
/// 超えたら「隔離ではない」側に倒す（分類が変わるだけで、失敗であることは変わらない）
const QUARANTINE_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

/// 評価関数の型が合わないときに、やねうら王が出して終わる語（`research/engines/yaneuraou-files.md`）
const EVAL_TYPE_MISMATCH: &str = "FileMissMatch";

/// 失敗を分類する。出力が終わった失敗のときだけ、macOS が止めた実行ファイルかを見に行く
/// （許可されていない実行ファイルは、起動した直後に OS に止められて同じ形で終わる）。
/// 評価関数の型が合わずに終わったときは、`eval_path`（選んだ評価関数。ファイルかフォルダ）の型を添える
pub async fn describe(
    error: &EngineError,
    engine_path: &str,
    eval_path: Option<&str>,
) -> StartFailure {
    let quarantined = matches!(error, EngineError::CommunicationFailed(_))
        && is_quarantined(PathBuf::from(engine_path)).await;
    let mut failure = classify(error, quarantined);
    if failure.kind == StartFailureKind::EvalTypeMismatch {
        if let Some(path) = eval_path {
            let named = failure.last_output.as_deref().and_then(named_eval_file);
            failure.eval_type = eval_type_of(PathBuf::from(path), named).await;
        }
    }
    failure
}

/// 型が合わなかったとエンジンが言ったファイルの名前（`failed to read nn.bin : FileMissMatch` の
/// `nn.bin`）。行が切られていて取れなければ `None`
fn named_eval_file(output: &str) -> Option<String> {
    let line = output
        .split(" / ")
        .find(|line| line.contains(EVAL_TYPE_MISMATCH))?;
    let name = line.split("failed to read ").nth(1)?;
    let name = name.split(" : ").next()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// エンジンが読んで型が合わなかった評価関数の型を、`is_quarantined` と同じく専用スレッドで上限つきで読む。
///
/// **選んだファイルをそのまま読まない。** フォルダで受けるエンジン（`EvalDir`）には選んだファイルの
/// 親だけを送るので、エンジンが読むのはそのフォルダの決まった名前のファイル（やねうら王は `nn.bin`）で、
/// 選んだファイルとは限らない。読むのは、エンジンが名指したファイルを選んだフォルダ（ファイルならその親）
/// に繋いだもの。名指しが取れなければ、フォルダなら中の `nn.bin`、ファイルならそれ自身
async fn eval_type_of(chosen: PathBuf, named: Option<String>) -> Option<String> {
    let read = tokio::task::spawn_blocking(move || {
        let is_dir = chosen.is_dir();
        let folder = if is_dir {
            chosen.clone()
        } else {
            chosen.parent().map(PathBuf::from).unwrap_or_default()
        };
        let file = match named {
            Some(name) => folder.join(name),
            None if is_dir => chosen.join("nn.bin"),
            None => chosen,
        };
        read_eval_type(&file)
    });
    tokio::time::timeout(QUARANTINE_CHECK_TIMEOUT, read)
        .await
        .ok()?
        .ok()?
}

/// **ファイルを読むのは専用スレッドで、上限つき。** `canonicalize` もファイルの読み取りも
/// 同期のシステムコールで、応答しないボリュームでは返らない。async のタスクで直に呼ぶと
/// 同じワーカに載っている対局の `run_loop` / `tick_loop` が進まない（`registry` の `spawn_cancellable` と同じ扱い）
async fn is_quarantined(path: PathBuf) -> bool {
    let inspected = tokio::task::spawn_blocking(move || launchable::inspect(&path));
    matches!(
        tokio::time::timeout(QUARANTINE_CHECK_TIMEOUT, inspected).await,
        Ok(Ok(Inspection::Program(Launchability::Quarantined)))
    )
}

/// 分類の本体。ファイルを読まない（`quarantined` は呼び手が調べて渡す）
pub fn classify(error: &EngineError, quarantined: bool) -> StartFailure {
    let kind = match error {
        EngineError::Cancelled(_) => StartFailureKind::Cancelled,
        EngineError::Timeout(_) => StartFailureKind::TimedOut,
        EngineError::InvalidState(_) => StartFailureKind::InvalidValue,
        // **理由の欄で見る。** 文で見ると、OS の文言やパスに同じ綴りを持ち込まれたときに分類が動く
        EngineError::StartupFailed(detail) => match detail.reason {
            StartupReason::NoUsiOk { .. } | StartupReason::NoIdName => StartFailureKind::NotUsi,
            StartupReason::Other(_) => StartFailureKind::SpawnFailed,
        },
        EngineError::CommunicationFailed(_) if quarantined => StartFailureKind::Quarantined,
        // **ここだけはエンジンの出力の文で見る。** 型の不一致を言う欄は無く、やねうら王が出す語しか無い。
        // パスにこの語が入って取り違えても、帯が「型が合わない」と言うだけで失敗には変わりない
        EngineError::CommunicationFailed(detail)
            if detail
                .last_output
                .as_deref()
                .is_some_and(|out| out.contains(EVAL_TYPE_MISMATCH)) =>
        {
            StartFailureKind::EvalTypeMismatch
        }
        EngineError::CommunicationFailed(_) => StartFailureKind::ExitedEarly,
        EngineError::NotInitialized(_) => StartFailureKind::Other,
    };
    let last_output = match error {
        EngineError::StartupFailed(detail) => detail.last_output.as_deref(),
        EngineError::CommunicationFailed(detail) => detail.last_output.as_deref(),
        _ => None,
    };
    StartFailure {
        kind,
        last_output: last_output.map(|output| shown(output, MAX_FAILURE_MESSAGE)),
        message: shown(&error.to_string(), MAX_FAILURE_MESSAGE),
        eval_type: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::types::{FailureDetail, NO_ID_NAME, TIMED_OUT};

    fn kind(error: EngineError) -> StartFailureKind {
        classify(&error, false).kind
    }

    #[test]
    fn failures_are_sorted_by_what_the_user_can_do() {
        assert_eq!(
            kind(EngineError::Cancelled("x".into())),
            StartFailureKind::Cancelled
        );
        assert_eq!(
            kind(EngineError::Timeout(format!("{TIMED_OUT} waiting"))),
            StartFailureKind::TimedOut
        );
        assert_eq!(
            kind(EngineError::StartupFailed(
                StartupReason::NoUsiOk {
                    waited: Duration::from_secs(30)
                }
                .into()
            )),
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

    /// 答えはしたが名乗らなかったエンジンは、評価関数の失敗（`ExitedEarly`）に見せない
    #[test]
    fn an_engine_without_a_name_is_not_a_usable_usi_engine() {
        assert_eq!(
            kind(EngineError::StartupFailed(StartupReason::NoIdName.into())),
            StartFailureKind::NotUsi
        );
        // 綴りでは見ない。文に同じ綴りがあっても起こせなかった失敗のまま
        assert_eq!(
            kind(EngineError::StartupFailed(NO_ID_NAME.into())),
            StartFailureKind::SpawnFailed
        );
    }

    /// 隔離を見るのは出力が終わった失敗だけ。他の種類を隔離に塗り替えない
    #[test]
    fn quarantine_only_explains_a_communication_failure() {
        assert_eq!(
            classify(&EngineError::CommunicationFailed("ended".into()), true).kind,
            StartFailureKind::Quarantined
        );
        assert_eq!(
            classify(&EngineError::StartupFailed("denied".into()), true).kind,
            StartFailureKind::SpawnFailed
        );
        assert_eq!(
            classify(&EngineError::Cancelled("x".into()), true).kind,
            StartFailureKind::Cancelled
        );
    }

    /// 理由に載る文言は長さと制御文字を落としてある
    #[test]
    fn the_message_is_bounded_and_has_no_control_characters() {
        let failure = classify(
            &EngineError::CommunicationFailed(
                format!("x\n\u{1b}[31m{}", "y".repeat(10_000)).into(),
            ),
            false,
        );
        assert!(failure.message.chars().count() <= MAX_FAILURE_MESSAGE + 1);
        assert!(!failure.message.chars().any(char::is_control));
    }

    /// 起動の失敗の種類が、**宣言の綴りをそのまま camelCase にした形**で線に出ること。
    ///
    /// **写しとの突き合わせは TS 側にある**（`src/__tests__/startFailureKindWire.test.ts`）。
    /// あちらは宣言の綴りを camelCase にして union を引くので、その写像が本物の serde と
    /// 一致していることをここで保証する。`#[serde(rename = "…")]` を1つ付ければ線の綴りだけが
    /// 変わり、写しを引く側は宣言の綴りを引き続けて緑で通る。
    ///
    /// **見本は宣言と数で突き合わせる。** 見本の並びに足し忘れた種類は、ここでは見えないまま
    /// 通ってしまう（`match` は網羅を強いるが、並びへの追加は強いない）。
    #[test]
    fn every_start_failure_kind_goes_on_the_wire_as_camel_case() {
        use StartFailureKind::*;
        let samples = [
            SpawnFailed,
            Quarantined,
            NotUsi,
            ExitedEarly,
            EvalTypeMismatch,
            TimedOut,
            InvalidValue,
            Cancelled,
            Other,
        ];
        let name = |kind: &StartFailureKind| match kind {
            SpawnFailed => "SpawnFailed",
            Quarantined => "Quarantined",
            NotUsi => "NotUsi",
            ExitedEarly => "ExitedEarly",
            EvalTypeMismatch => "EvalTypeMismatch",
            TimedOut => "TimedOut",
            InvalidValue => "InvalidValue",
            Cancelled => "Cancelled",
            Other => "Other",
        };

        let source = include_str!("types.rs");
        let body = source
            .split_once("pub enum StartFailureKind {")
            .expect("StartFailureKind の宣言が見つからない")
            .1;
        let declared: Vec<&str> = body
            .lines()
            .take_while(|line| *line != "}")
            .map(|line| line.trim().trim_end_matches(','))
            .filter(|token| token.starts_with(char::is_uppercase) && !token.contains(' '))
            .collect();
        assert!(declared.len() > 4, "宣言を拾えていない: {declared:?}");
        assert_eq!(
            declared.len(),
            samples.len(),
            "見本に無い種類がある。見本と `name` に足すこと: {declared:?}"
        );

        for kind in &samples {
            let declared_name = name(kind);
            assert!(
                declared.contains(&declared_name),
                "{declared_name} が宣言に無い"
            );
            let wire = serde_json::to_string(kind).expect("直列化できる");
            let mut chars = declared_name.chars();
            let camel = chars
                .next()
                .map(|first| first.to_lowercase().collect::<String>() + chars.as_str())
                .unwrap_or_default();
            assert_eq!(
                wire,
                format!("\"{camel}\""),
                "{declared_name} は線に `{camel}` として出ない。写しを引く側\
                 （src/__tests__/startFailureKindWire.test.ts）が宣言の綴りを引き続けて素通りする"
            );
        }
    }

    /// 無いパスは隔離ではない（読めないときは隔離でない側に倒す）
    #[tokio::test]
    async fn a_missing_file_is_not_reported_as_quarantined() {
        let failure = describe(
            &EngineError::CommunicationFailed("ended".into()),
            "/nonexistent/engine",
            None,
        )
        .await;
        assert_eq!(failure.kind, StartFailureKind::ExitedEarly);
    }

    /// 評価関数の型が合わずに終わった（実機の行）ものは `EvalTypeMismatch`。それ以外の終わり方は
    /// `ExitedEarly` のまま
    #[test]
    fn a_file_mismatch_on_the_eval_is_its_own_kind() {
        let ended = |last: &str| {
            EngineError::CommunicationFailed(FailureDetail {
                reason: "ended".to_string(),
                last_output: Some(last.to_string()),
            })
        };
        assert_eq!(
            kind(ended("Error! : failed to read nn.bin : FileMissMatch")),
            StartFailureKind::EvalTypeMismatch
        );
        assert_eq!(
            kind(ended("Error! : failed to read nn.bin : FileOpenError")),
            StartFailureKind::ExitedEarly
        );
    }

    /// 型が合わずに終わった回は、選んだ評価関数（ファイルでもフォルダでも）の型を添える
    #[tokio::test]
    async fn a_mismatch_carries_the_type_of_the_chosen_eval() {
        let dir = test_support::dir::temp_dir("start-failure-eval-type");
        let arch = "Features=HalfKA2(Friend)[131949->1024x2],Network=x";
        let mut bytes = vec![0u8; 8];
        bytes.extend_from_slice(&(arch.len() as u32).to_le_bytes());
        bytes.extend_from_slice(arch.as_bytes());
        std::fs::write(dir.join("nn.bin"), bytes).expect("書けない");
        let error = EngineError::CommunicationFailed(FailureDetail {
            reason: "ended".to_string(),
            last_output: Some("Error! : failed to read nn.bin : FileMissMatch".to_string()),
        });

        let file = dir.join("nn.bin").to_string_lossy().into_owned();
        let folder = dir.to_string_lossy().into_owned();
        for eval in [file.as_str(), folder.as_str()] {
            let failure = describe(&error, "/nonexistent/engine", Some(eval)).await;
            assert_eq!(failure.kind, StartFailureKind::EvalTypeMismatch);
            assert_eq!(
                failure.eval_type.as_deref(),
                Some("HalfKA2 1024x2"),
                "{eval}"
            );
        }
        // 選んだのが nn.bin 以外でも、エンジンが名指した nn.bin の型を出す（エンジンはフォルダを受ける）
        std::fs::write(dir.join("old.bin"), b"not an eval").expect("書けない");
        let old = dir.join("old.bin").to_string_lossy().into_owned();
        let failure = describe(&error, "/nonexistent/engine", Some(old.as_str())).await;
        assert_eq!(failure.eval_type.as_deref(), Some("HalfKA2 1024x2"));

        // 他の種類には読みに行かない
        let other = describe(
            &EngineError::CommunicationFailed("ended".into()),
            "/nonexistent/engine",
            Some(file.as_str()),
        )
        .await;
        assert_eq!(other.eval_type, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 直近の出力は欄からそのまま取る。**エンジンの行の `)` まで削らない**
    #[test]
    fn the_engine_output_keeps_its_own_closing_parenthesis() {
        let error = EngineError::CommunicationFailed(FailureDetail {
            reason: "gone".to_string(),
            last_output: Some("failed to load nn.bin (code 2)".to_string()),
        });

        let failure = classify(&error, false);
        assert_eq!(
            failure.last_output.as_deref(),
            Some("failed to load nn.bin (code 2)")
        );
        // 文は繋いだ綴りのまま（線に出る文は変えない）
        assert_eq!(
            failure.message,
            "Communication failed: gone (last output: failed to load nn.bin (code 2))"
        );
    }
}
