//! 起動の失敗を、利用者が取れる行動の種類（`StartFailureKind`）に分ける段。
//!
//! **画面の文言は種類から組む**ので、解析の起動（`start_analysis_engine`）の分類はここに置く。
//! 対局の起動は文字列で返し、締切で削った `usiok` の待ちを時間切れとして読み直す
//! （`game/session.rs` の `usiok_refusal`）。ここはその前提を持たない——`NO_USIOK` を
//! `NotUsi` とするのは、呼び手が `USI_OK_TIMEOUT` を満額渡したときだけ正しい。

use std::path::PathBuf;
use std::time::Duration;

use crate::engine::launchable::{self, Inspection, Launchability};
use crate::engine::protocol::{NO_ID_NAME, NO_USIOK};
use crate::engine::types::{EngineError, StartFailure, StartFailureKind};
use crate::engine::utils::shown;

/// `StartFailure::message` に載せる長さ（文字）。エンジンの出力を含むので切る
const MAX_FAILURE_MESSAGE: usize = 512;

/// 隔離の印を読みに行く上限。応答しないボリュームでは読み取りが返らないので、
/// 超えたら「隔離ではない」側に倒す（分類が変わるだけで、失敗であることは変わらない）
const QUARANTINE_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

/// 失敗を分類する。出力が終わった失敗のときだけ、macOS が止めた実行ファイルかを見に行く
/// （許可されていない実行ファイルは、起動した直後に OS に止められて同じ形で終わる）。
pub async fn describe(error: &EngineError, engine_path: &str) -> StartFailure {
    let quarantined = matches!(error, EngineError::CommunicationFailed(_))
        && is_quarantined(PathBuf::from(engine_path)).await;
    classify(error, quarantined)
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
        // **綴りは変種の中の先頭で見る。** 部分一致にすると、OS の文言やパスに同じ綴りを
        // 持ち込まれたときに分類が動く
        EngineError::StartupFailed(why)
            if why.starts_with(NO_USIOK) || why.starts_with(NO_ID_NAME) =>
        {
            StartFailureKind::NotUsi
        }
        EngineError::StartupFailed(_) => StartFailureKind::SpawnFailed,
        EngineError::CommunicationFailed(_) if quarantined => StartFailureKind::Quarantined,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::types::TIMED_OUT;

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

    /// 答えはしたが名乗らなかったエンジンは、評価関数の失敗（`ExitedEarly`）に見せない
    #[test]
    fn an_engine_without_a_name_is_not_a_usable_usi_engine() {
        assert_eq!(
            kind(EngineError::StartupFailed(NO_ID_NAME.to_string())),
            StartFailureKind::NotUsi
        );
        // 綴りは先頭だけで見る。途中にあっても起こせなかった失敗のまま
        assert_eq!(
            kind(EngineError::StartupFailed(format!("spawn: {NO_ID_NAME}"))),
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
            &EngineError::CommunicationFailed(format!("x\n\u{1b}[31m{}", "y".repeat(10_000))),
            false,
        );
        assert!(failure.message.chars().count() <= MAX_FAILURE_MESSAGE + 1);
        assert!(!failure.message.chars().any(char::is_control));
    }

    /// 無いパスは隔離ではない（読めないときは隔離でない側に倒す）
    #[tokio::test]
    async fn a_missing_file_is_not_reported_as_quarantined() {
        let failure = describe(
            &EngineError::CommunicationFailed("ended".into()),
            "/nonexistent/engine",
        )
        .await;
        assert_eq!(failure.kind, StartFailureKind::ExitedEarly);
    }
}
