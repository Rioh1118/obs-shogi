//! 起動済みのエンジンプロセスを ID で引ける台帳。
//!
//! 対局は先手・後手で別々のプロセスを同時に持つ。解析もそのうちの1つとして扱う。
//! プロセスを起動する経路をこのファイルの `spawn` 1本に絞ってあるのは、
//! 実行ファイルの検査を通らない起動経路を後から足せないようにするため。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;
use usi::UsiEngineHandler;
use uuid::Uuid;

use crate::engine::protocol::UsiProtocol;
use crate::engine::types::{EngineError, EngineInfo};

const LOGT: &str = "obs_shogi::engine::registry";

/// `quit` を送ってからプロセスを落とすまでの猶予。
///
/// USI は `quit` で自発的に終わることを求めるが、終わらないエンジンは実在する。
/// 待ち切らずに `kill` する側に倒してあるのは、**閉じられないほうが害が大きい**ため。
const QUIT_GRACE: Duration = Duration::from_millis(300);

/// `kill` に置く上限。
///
/// `kill` は書き込みの列を通らない（`handler` を `take` して直接落とす）ので、
/// ここに上限が要る。`quit` のほうは `send_command` の中で上限が掛かっている
/// （`protocol.rs` の `WRITE_TIMEOUT`）。
///
/// **この上限が効くのは、`kill` が `spawn_blocking` の中にあるから。**
/// async のタスクの中で同期 write を直に呼ぶと `poll` が返らず、
/// `timeout` は発火する機会そのものを持たない。
///
/// 超えるとプロセスが残る。回収する仕掛けは無い → #353
const KILL_TIMEOUT: Duration = Duration::from_secs(2);

/// 台帳の中でプロセスを指す値。
pub type EngineId = String;

/// 起動済みのエンジンプロセス1つ分。
///
/// 「まだ起動していない」状態を持たない。値が作れた時点で `usi` / `usiok` まで
/// 済んでいるので、使う側に `Option<protocol>` の分岐が出ない。
pub struct EngineProcess {
    pub id: EngineId,
    /// `canonicalize` を通した後の絶対パス。呼び出し側が渡した文字列ではない
    pub engine_path: String,
    pub work_dir: String,
    pub info: EngineInfo,
    protocol: Arc<UsiProtocol>,
}

impl EngineProcess {
    pub fn protocol(&self) -> Arc<UsiProtocol> {
        Arc::clone(&self.protocol)
    }
}

impl std::fmt::Debug for EngineProcess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EngineProcess")
            .field("id", &self.id)
            .field("engine_path", &self.engine_path)
            .field("name", &self.info.name)
            .finish_non_exhaustive()
    }
}

#[derive(Default)]
pub struct EngineRegistry {
    processes: RwLock<HashMap<EngineId, Arc<EngineProcess>>>,
}

impl EngineRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 実行ファイルを起動し、`usiok` まで済ませて台帳に載せる。
    ///
    /// `engine_path` は絶対パスに解決できる既存ファイルであることを要求する。
    /// `/bin/sh` のような任意バイナリを起動させる経路を塞ぐ最低限のガード。
    pub async fn spawn(
        &self,
        engine_path: &str,
        work_dir: Option<&str>,
        info_timeout: Duration,
    ) -> Result<Arc<EngineProcess>, EngineError> {
        let resolved = std::fs::canonicalize(engine_path).map_err(|e| {
            EngineError::StartupFailed(format!("engine_path is not a valid existing path: {e}"))
        })?;
        if !resolved.is_file() {
            return Err(EngineError::StartupFailed(
                "engine_path must point to an existing file".to_string(),
            ));
        }

        let engine_path = resolved.to_string_lossy().to_string();
        let work_dir = match work_dir {
            Some(dir) => dir.to_string(),
            None => resolved
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string()),
        };

        log::info!(target: LOGT, "spawn: start path='{}'", engine_path);

        let handler = UsiEngineHandler::spawn(&engine_path, &work_dir).map_err(|e| {
            log::error!(target: LOGT, "spawn: failed: {}", e);
            EngineError::StartupFailed(format!("Failed to spawn engine: {}", e))
        })?;

        let protocol = Arc::new(UsiProtocol::new(handler));

        // `usiok` を取り切るまでは台帳に載せない。載せてから失敗すると、
        // 誰も参照していないプロセスが残る。
        let info = match protocol.get_engine_info(info_timeout).await {
            Ok(info) => info,
            Err(e) => {
                protocol.kill_engine().await;
                return Err(e);
            }
        };

        let id = Uuid::new_v4().to_string();
        let process = Arc::new(EngineProcess {
            id: id.clone(),
            engine_path,
            work_dir,
            info,
            protocol,
        });

        self.processes
            .write()
            .await
            .insert(id.clone(), Arc::clone(&process));

        log::info!(
            target: LOGT,
            "spawn: ok id={} name='{}'",
            id,
            process.info.name
        );
        Ok(process)
    }

    pub async fn get(&self, id: &str) -> Option<Arc<EngineProcess>> {
        self.processes.read().await.get(id).cloned()
    }

    /// 台帳から外して落とす。**知らない ID を渡しても成功扱いにする。**
    /// 呼び出し側は「落ちている」ことだけを要求しており、その要求は満たせている。
    pub async fn shutdown(&self, id: &str) {
        let process = self.processes.write().await.remove(id);
        let Some(process) = process else {
            log::debug!(target: LOGT, "shutdown: unknown id={}", id);
            return;
        };
        Self::terminate(&process).await;
    }

    pub async fn shutdown_all(&self) {
        let processes: Vec<Arc<EngineProcess>> = self
            .processes
            .write()
            .await
            .drain()
            .map(|(_, p)| p)
            .collect();
        for process in processes {
            Self::terminate(&process).await;
        }
    }

    pub async fn ids(&self) -> Vec<EngineId> {
        self.processes.read().await.keys().cloned().collect()
    }

    /// 落とす。**返らない経路を作らない。**
    ///
    /// `quit` の上限は `send_command` の中、`kill` の上限はここ。
    /// どちらを超えてもプロセスが残るが、それは呼び出し側が待ち続けるより
    /// ましだという判断。
    async fn terminate(process: &EngineProcess) {
        log::info!(target: LOGT, "shutdown: id={}", process.id);
        let protocol = process.protocol();

        // 戻り値は見ない。既に死んでいれば書けなくて当然で、
        // 目的は「死んでいること」。失敗の記録は `run_writer` が残す
        protocol.quit().await;

        tokio::time::sleep(QUIT_GRACE).await;

        if tokio::time::timeout(KILL_TIMEOUT, protocol.kill_engine())
            .await
            .is_err()
        {
            log::error!(
                target: LOGT,
                "shutdown: kill timed out id={} — the process is left running",
                process.id
            );
        }
    }
}
