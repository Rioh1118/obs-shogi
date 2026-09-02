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

/// プロセスが起き上がるまでに待つ上限。
///
/// **`usiok` を待つ上限（`info_timeout`）とは別。** こちらはパスの解決と
/// `fork`/`exec` だけで、応答しないネットワークボリューム上の `engine_path` に
/// 対する `canonicalize` は割り込み不能でブロックする。
///
/// 包まないと `start_game` の future が返らず、フロントの `invoke` は永久に
/// 解決しない（押しても何も起きず、ログにも何も出ない）。
///
/// 超えてもブロッキングのスレッドは残る。`timeout` は `spawn_blocking` を
/// 取り消せないので、そのぶんワーカが1本減ったままになる → #353 と同じ形。
const SPAWN_TIMEOUT: Duration = Duration::from_secs(10);

/// `quit` を送ってからプロセスを落とすまでの猶予。
///
/// USI は `quit` で自発的に終わることを求めるが、終わらないエンジンは実在する。
/// 待ち切らずに `kill` する側に倒してあるのは、**閉じられないほうが害が大きい**ため。
const QUIT_GRACE: Duration = Duration::from_millis(300);

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

    /// 起動したが、まだ `usiok` を取り切っていないもの。
    ///
    /// **子プロセスは既に走っている。** `spawn` から `processes` への登録まで
    /// `USI_OK_TIMEOUT`（30秒）の窓があり、その間ここに居ないと
    /// 終了時の掃除から見えない（起動を待たずにアプリを閉じると孤児になる）。
    starting: RwLock<Vec<Arc<UsiProtocol>>>,
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
        // **同期の口をまとめて専用スレッドへ出す。** `canonicalize` も
        // `is_file` も `UsiEngineHandler::spawn`（`Command::spawn`）も同期の
        // システムコールで、`.await` を1つも挟まない。async のタスクの中で
        // 直に呼ぶと `poll` が返らず、同じスレッドに載っている他の対局の
        // `run_loop` / `tick_loop` / `run_writer` が進まない
        // （`protocol.rs` が `kill` と書き込みを逃がしているのと同じ理由）。
        //
        // ネットワークボリューム上のエンジンや、`fork` が重い状況で効く。
        // 対局はこれを2本ぶん直列に通る。
        let path_for_task = engine_path.to_string();
        let dir_for_task = work_dir.map(|d| d.to_string());
        let started = tokio::task::spawn_blocking(move || {
            let resolved = std::fs::canonicalize(&path_for_task).map_err(|e| {
                EngineError::StartupFailed(format!("engine_path is not a valid existing path: {e}"))
            })?;
            if !resolved.is_file() {
                return Err(EngineError::StartupFailed(
                    "engine_path must point to an existing file".to_string(),
                ));
            }

            let engine_path = resolved.to_string_lossy().to_string();
            let work_dir = match dir_for_task {
                Some(dir) => dir,
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
            Ok((engine_path, work_dir, handler))
        });

        // **上限を掛ける。** `spawn_blocking` は上限を効かせるための前提で、
        // 上限そのものではない（`protocol.rs` の `KILL_TIMEOUT` と対）。
        // 応答しないネットワークボリューム上の `engine_path` に対する
        // `canonicalize` は割り込み不能でブロックするので、包まないと
        // `start_game` の future が返らず、フロントの `invoke` は永久に解決しない。
        //
        // 超えてもブロッキングのスレッドは残る（`timeout` は取り消せない）。
        // そのぶんワーカが1本減ったままになる → #353 と同じ形。
        let (engine_path, work_dir, handler) = match tokio::time::timeout(SPAWN_TIMEOUT, started)
            .await
        {
            Ok(Ok(Ok(started))) => started,
            Ok(Ok(Err(e))) => return Err(e),
            // 専用スレッドが落ちた。プロセスは起きていない
            Ok(Err(e)) => {
                return Err(EngineError::StartupFailed(format!(
                    "failed to run the spawn task: {e}"
                )))
            }
            Err(_) => {
                log::error!(target: LOGT, "spawn: timed out before the process started");
                return Err(EngineError::Timeout(
                    "the engine did not start in time; check the path and the volume".to_string(),
                ));
            }
        };

        let protocol = Arc::new(UsiProtocol::new(handler));

        // **起動中の置き場へ先に載せる。** `usiok` を待つ間に終了されると、
        // ここに居ないプロセスは掃除から見えず孤児になる
        self.starting.write().await.push(Arc::clone(&protocol));

        // `usiok` を取り切るまでは本台帳に載せない。載せてから失敗すると、
        // 誰も参照していないプロセスが残る。
        let info = match protocol.get_engine_info(info_timeout).await {
            Ok(info) => info,
            Err(e) => {
                self.forget_starting(&protocol).await;
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

        // **本台帳へ載せてから起動中の置き場を外す。** 逆にすると、
        // その間このプロセスはどちらの置き場にも居ない。並行する `shutdown_all` が
        // 素通りして孤児になる。両方に居る側は二度落とすだけで、
        // `kill_engine` は handler を `take` するので2回目は空振りする
        self.processes
            .write()
            .await
            .insert(id.clone(), Arc::clone(&process));
        self.forget_starting(&process.protocol).await;

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

    /// 台帳と**起動中の置き場**の両方を落とす。
    ///
    /// 起動中のぶんを忘れると、`usiok` を待っている最中に終了されたプロセスが
    /// 孤児として残る。対局の開始は数十秒かかるので、待ち切れずに閉じるのは普通の操作。
    pub async fn shutdown_all(&self) {
        let starting: Vec<Arc<UsiProtocol>> = self.starting.write().await.drain(..).collect();
        for protocol in starting {
            log::info!(target: LOGT, "shutdown: killing an engine that was still starting");
            protocol.kill_engine().await;
        }

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

    /// 起動中の置き場から外す。**成否に関わらず通す。**
    async fn forget_starting(&self, protocol: &Arc<UsiProtocol>) {
        self.starting
            .write()
            .await
            .retain(|p| !Arc::ptr_eq(p, protocol));
    }

    pub async fn ids(&self) -> Vec<EngineId> {
        self.processes.read().await.keys().cloned().collect()
    }

    /// 落とす。**返らない経路を作らない。**
    ///
    /// `quit` の上限は書き込みの列の中、`kill` の上限は `kill_engine` の中。
    /// `quit` が超えても `kill` へ進むので、プロセスが残るのは
    /// **`kill` の上限を超えたときだけ**。待ち続けるよりましだという判断。
    async fn terminate(process: &EngineProcess) {
        log::info!(target: LOGT, "shutdown: id={}", process.id);
        let protocol = process.protocol();

        // 戻り値は見ない。既に死んでいれば書けなくて当然で、
        // 目的は「死んでいること」。失敗の記録は `run_writer` が残す
        protocol.quit().await;

        tokio::time::sleep(QUIT_GRACE).await;

        protocol.kill_engine().await;
    }
}
