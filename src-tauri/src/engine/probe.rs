//! エンジンを起こして申告（`id` と `option` 行）だけを取り、すぐ落とす段。
//!
//! プリセット編集の画面が、そのエンジンの設定欄を作るために使う。**送る側はここを使わない**——
//! 起動のたびにその回の申告を見る（`binding::bind`）。ここで取った定義は画面に出すためだけのもの。
//!
//! 取得は同時に1本。新しい取得が来たら前の取得を取り消す（起こしている途中のプロセスも落ちる）。

use std::sync::Arc;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::engine::binding;
use crate::engine::protocol::USI_OK_TIMEOUT;
use crate::engine::registry::{EngineRegistry, SPAWN_TIMEOUT};
use crate::engine::start_failure;
use crate::engine::types::{EngineError, ProbeOutcome, SetOptionValue, StartFailure, UsiOptionDef};

const LOGT: &str = "obs_shogi::engine::probe";

/// 画面が取得を撃つたびに上げる番号。**古い番号の取得は何もせずに断る**——Tauri の async コマンドは
/// 別々のタスクで走るので、後から撃った取得が先にロックを取ることがある
pub type ProbeToken = u64;

#[derive(Default)]
struct InFlight {
    latest: ProbeToken,
    cancel: Option<CancellationToken>,
}

pub struct EngineProber {
    registry: Arc<EngineRegistry>,
    in_flight: Mutex<InFlight>,
}

impl EngineProber {
    pub fn new(registry: Arc<EngineRegistry>) -> Self {
        Self {
            registry,
            in_flight: Mutex::new(InFlight::default()),
        }
    }

    /// `probe_steps` の失敗を、起動の失敗と同じ種類に分けて返す（画面は起動と同じ文言を使える）
    pub async fn probe(
        &self,
        engine_path: &str,
        token: ProbeToken,
        fixed: &[SetOptionValue],
    ) -> Result<ProbeOutcome, StartFailure> {
        match self.probe_steps(engine_path, token, fixed).await {
            Ok(outcome) => Ok(outcome),
            Err(e) => {
                let failure = start_failure::describe(&e, engine_path).await;
                log::info!(target: LOGT, "probe: failed ({:?}): {e}", failure.kind);
                Err(failure)
            }
        }
    }

    /// `engine_path` を起こして申告を取り、落とす。cwd は実行ファイルのフォルダ（解析の起動と同じ）。
    ///
    /// `fixed` は起動で呼び手が決める値（解析なら `analysis_fixed_values`）。その名前は
    /// `reserved` に入る
    async fn probe_steps(
        &self,
        engine_path: &str,
        token: ProbeToken,
        fixed: &[SetOptionValue],
    ) -> Result<ProbeOutcome, EngineError> {
        let cancel = {
            let mut in_flight = self.in_flight.lock().await;
            if token < in_flight.latest {
                return Err(superseded());
            }
            in_flight.latest = token;
            if let Some(previous) = in_flight.cancel.take() {
                previous.cancel();
            }
            let cancel = CancellationToken::new();
            in_flight.cancel = Some(cancel.clone());
            cancel
        };

        let spawned = self
            .registry
            .spawn_cancellable(engine_path, None, SPAWN_TIMEOUT, USI_OK_TIMEOUT, &cancel)
            .await;
        {
            let mut in_flight = self.in_flight.lock().await;
            if in_flight.latest == token {
                in_flight.cancel = None;
            }
        }
        let process = spawned?;
        // **申告を写してから落とす。** 落とすのを待つ間に次の取得が来ても、この結果は返す
        // （捨てるかは画面が `token` で決める）
        let info = process.info.clone();
        self.registry.shutdown(&process.id).await;
        log::info!(
            target: LOGT,
            "probe: {} option(s) from {}",
            info.options.len(),
            info.name
        );

        Ok(ProbeOutcome {
            token,
            engine_path: engine_path.to_string(),
            reserved: binding::reserved_names(&info.options, fixed),
            definitions: info.options.iter().map(UsiOptionDef::from).collect(),
            name: info.name,
            author: info.author,
        })
    }
}

fn superseded() -> EngineError {
    EngineError::Cancelled("a newer probe was already requested".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::types::StartFailureKind;

    /// 保存する定義の形は**ファイルに残る**。綴りが動けば、保存済みのプリセットが読めなくなる
    #[test]
    fn a_stored_definition_keeps_its_spelling() {
        use crate::engine::types::UsiOptionKind;
        let def = |kind| UsiOptionDef {
            name: "X".to_string(),
            kind,
        };
        let cases = [
            (
                def(UsiOptionKind::Spin {
                    default: Some(1),
                    min: Some(0),
                    max: Some(8),
                }),
                r#"{"name":"X","type":"spin","default":1,"min":0,"max":8}"#,
            ),
            (
                def(UsiOptionKind::Check {
                    default: Some(true),
                }),
                r#"{"name":"X","type":"check","default":true}"#,
            ),
            (
                def(UsiOptionKind::Combo {
                    default: None,
                    vars: vec!["a".to_string()],
                }),
                r#"{"name":"X","type":"combo","default":null,"vars":["a"]}"#,
            ),
            (
                def(UsiOptionKind::String { default: None }),
                r#"{"name":"X","type":"string","default":null}"#,
            ),
            (
                def(UsiOptionKind::Filename { default: None }),
                r#"{"name":"X","type":"filename","default":null}"#,
            ),
            (
                def(UsiOptionKind::Button),
                r#"{"name":"X","type":"button"}"#,
            ),
        ];
        for (value, wire) in cases {
            assert_eq!(serde_json::to_string(&value).expect("書ける"), wire);
        }
    }

    #[cfg(unix)]
    mod real_process {
        use super::*;
        use crate::engine::registry::script::place_script as place;

        /// `EvalFile` と `ConsiderationMode` を申告し、起きたら印を置く台本
        const DECLARES: &str = r#"touch started
while read line; do
  case "$line" in
    usi) printf 'id name Probed\nid author Someone\noption name Threads type spin default 4 min 1 max 512\noption name EvalFile type string default nn.bin\noption name ConsiderationMode type check default false\nusiok\n' ;;
    quit) exit 0 ;;
  esac
done"#;

        /// 起きたら印を置き、`usi` に答えない台本
        const SILENT: &str = r#"touch silent-started
while read line; do :; done"#;

        fn fixed() -> Vec<SetOptionValue> {
            vec![SetOptionValue {
                name: "ConsiderationMode".to_string(),
                value: "true".to_string(),
            }]
        }

        fn path_of(path: &std::path::Path) -> &str {
            path.to_str().expect("パス")
        }

        /// 申告の順で定義を返し、評価関数と固定値の名前を `reserved` に挙げ、**起こしたプロセスを残さない**
        #[tokio::test]
        async fn a_probe_returns_the_declaration_and_leaves_nothing_running() {
            let dir = test_support::dir::temp_dir("probe-ok");
            let path = place(&dir, "declares.sh", DECLARES).await;
            let registry = Arc::new(EngineRegistry::new());
            let prober = EngineProber::new(Arc::clone(&registry));

            let outcome = prober
                .probe(path_of(&path), 1, &fixed())
                .await
                .expect("取れる");

            assert_eq!(outcome.token, 1);
            assert_eq!(outcome.engine_path, path_of(&path));
            assert_eq!(
                (outcome.name.as_str(), outcome.author.as_str()),
                ("Probed", "Someone")
            );
            let names: Vec<&str> = outcome
                .definitions
                .iter()
                .map(|d| d.name.as_str())
                .collect();
            assert_eq!(names, ["Threads", "EvalFile", "ConsiderationMode"]);
            assert_eq!(outcome.reserved, ["EvalFile", "ConsiderationMode"]);
            assert!(
                registry.ids().await.is_empty(),
                "取った後もプロセスが残っている"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 既に受けた番号より古い取得は、**起こさずに**断る
        #[tokio::test]
        async fn an_older_probe_is_refused_without_starting() {
            let dir = test_support::dir::temp_dir("probe-stale");
            let path = place(&dir, "declares.sh", DECLARES).await;
            let registry = Arc::new(EngineRegistry::new());
            let prober = EngineProber::new(Arc::clone(&registry));

            prober.probe(path_of(&path), 5, &[]).await.expect("取れる");
            let _ = std::fs::remove_file(dir.join("started"));

            let stale = prober.probe(path_of(&path), 3, &[]).await;
            assert!(
                matches!(&stale, Err(f) if f.kind == StartFailureKind::Cancelled),
                "{stale:?}"
            );
            assert!(!dir.join("started").exists(), "古い取得が起こしている");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 次の取得が来たら、答えを待っている前の取得は取り消されてプロセスも落ちる
        #[tokio::test]
        async fn a_newer_probe_cancels_the_one_in_flight() {
            let dir = test_support::dir::temp_dir("probe-replace");
            let silent = place(&dir, "silent.sh", SILENT).await;
            let declares = place(&dir, "declares.sh", DECLARES).await;
            let registry = Arc::new(EngineRegistry::new());
            let prober = Arc::new(EngineProber::new(Arc::clone(&registry)));

            let first = {
                let prober = Arc::clone(&prober);
                let silent = silent.clone();
                tokio::spawn(async move { prober.probe(path_of(&silent), 1, &[]).await })
            };
            // 前の取得が起こし終えて `usiok` を待つところまで進める
            for _ in 0..500 {
                if dir.join("silent-started").exists() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            assert!(dir.join("silent-started").exists(), "前の取得が起きない");

            prober
                .probe(path_of(&declares), 2, &[])
                .await
                .expect("新しい取得は通る");
            let first = first.await.expect("タスク");
            assert!(
                matches!(&first, Err(f) if f.kind == StartFailureKind::Cancelled),
                "{first:?}"
            );
            assert!(registry.ids().await.is_empty(), "プロセスが残っている");
            let _ = std::fs::remove_dir_all(&dir);
        }

        /// 起こせなければ、起動の失敗と同じ種類で返す
        #[tokio::test]
        async fn a_missing_engine_is_a_spawn_failure() {
            let prober = EngineProber::new(Arc::new(EngineRegistry::new()));
            let failed = prober.probe("/nonexistent/engine", 1, &[]).await;
            assert!(
                matches!(&failed, Err(f) if f.kind == StartFailureKind::SpawnFailed),
                "{failed:?}"
            );
        }
    }
}
