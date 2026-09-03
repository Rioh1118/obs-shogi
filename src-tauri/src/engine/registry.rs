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
use crate::engine::types::{EngineError, EngineInfo, TIMED_OUT};
use crate::engine::utils::{shown, with_cause, MAX_SUMMARY_LEN};

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
///
/// **超えた後の子プロセスはどの台帳にも居ない。** 唯一の参照は
/// `dispose_late_spawn` のタスクで、`shutdown_all` はそれを見つけられない → #381。
pub const SPAWN_TIMEOUT: Duration = Duration::from_secs(10);

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
    /// このプロセスへ送る口。**`Arc` を複製して返す**——`EngineProcess` を
    /// 握ったままにすると台帳から外せなくなる。
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
    /// **子プロセスは既に走っている。** ここに載ってから `processes` への
    /// 登録まで `USI_OK_TIMEOUT` の窓があり、その間ここに居ないと
    /// 終了時の掃除から見えない（起動を待たずにアプリを閉じると孤児になる）。
    ///
    /// **窓はここより手前から開いている。** 載せるのは `spawn_blocking` が
    /// 解けた後で、子プロセスが走り出すのはその中。そこから載るまでの区間と、
    /// `SPAWN_TIMEOUT` を超えて `dispose_late_spawn` へ渡した後は、
    /// **どちらの台帳にも居ない** → #368 / #381。
    starting: RwLock<Vec<Arc<UsiProtocol>>>,
}

impl EngineRegistry {
    /// 空の台帳。**アプリに1つ**（`AppState` が持ち、対局と解析で共有する）。
    ///
    /// **重複排除ではない。** `spawn` はパスを見ずに毎回新しいプロセスを起こす
    /// ので、同じ実行ファイルで解析と対局を同時に走らせれば2本立つ。
    /// `get` で既存のプロセスを引き当てられる前提で書かないこと。
    ///
    /// 1つにするのは**終了時の掃除の宛先を1つに保つ**ため。分けると
    /// `lib.rs` の終了フックが両方を呼ばなければならず、片方を呼び忘れた
    /// ぶんのプロセスはアプリを閉じても残る。
    pub fn new() -> Self {
        Self::default()
    }

    /// 実行ファイルを起動し、`usiok` まで済ませて台帳に載せる。
    ///
    /// `engine_path` は絶対パスに解決できる既存ファイルであることを要求する。
    /// `/bin/sh` のような任意バイナリを起動させる経路を塞ぐ最低限のガード。
    ///
    /// `spawn_timeout` はプロセスが立ち上がるまで、`info_timeout` はそこから
    /// `usiok` まで。**順に使う**ので、締切で縮めるなら引き算すること——
    /// 対局は全体の締切（`START_TIMEOUT`）を持つので、段ごとの上限をそのまま
    /// 渡すと**締切の外で待つ時間**ができる。
    pub async fn spawn(
        &self,
        engine_path: &str,
        work_dir: Option<&str>,
        spawn_timeout: Duration,
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
            // **`work_dir` も解決する。** 素通しにすると、`Command::current_dir` は
            // 存在しないディレクトリを渡されたときにだけ失敗し、それ以外——
            // 途中に `..` を挟んだ経路、シンボリックリンクの先——は黙って通る。
            // 子プロセスの cwd は、相対パスで書かれた設定（`EvalDir` など）が
            // 解決される基点になるので、どこを指しているかを解決してから渡す
            let work_dir = match dir_for_task {
                Some(dir) => {
                    let resolved = std::fs::canonicalize(&dir).map_err(|e| {
                        EngineError::StartupFailed(format!(
                            "work_dir is not a valid existing path: {e}"
                        ))
                    })?;
                    if !resolved.is_dir() {
                        return Err(EngineError::StartupFailed(
                            "work_dir must point to an existing directory".to_string(),
                        ));
                    }
                    resolved.to_string_lossy().to_string()
                }
                None => resolved
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| ".".to_string()),
            };

            log::info!(target: LOGT, "{}", spawn_start_line(&engine_path));

            let handler = UsiEngineHandler::spawn(&engine_path, &work_dir).map_err(|e| {
                let why = with_cause(&e);
                log::error!(target: LOGT, "spawn: failed: {why}");
                EngineError::StartupFailed(format!("Failed to spawn engine: {why}"))
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
        let mut started = started;
        let (engine_path, work_dir, handler) =
            match tokio::time::timeout(spawn_timeout, &mut started).await {
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
                    // **待ち手を捨てない。** 捨てると、遅れて起き上がった
                    // `UsiEngineHandler` をランタイムが drop する。`usi` crate の
                    // `Drop` は `kill().unwrap()` を呼び、既に死んだプロセスへの
                    // 書き込みは EPIPE で失敗するので**パニックする**——
                    // このコードベースが `Option` + `mem::forget` で避けている唯一の形
                    // （→ `UsiProtocol::kill_engine`）。
                    // 起き上がるのを別のタスクで待って、同じ手順で畳む
                    tokio::spawn(dispose_late_spawn(started));
                    return Err(EngineError::Timeout(format!(
                        "{TIMED_OUT} before the process started; check the path and the volume"
                    )));
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

        log::info!(target: LOGT, "{}", spawn_ok_line(&id, &process.info.name));
        Ok(process)
    }
}

/// 起動できたことを記録する1行。
///
/// **名乗りはエンジンが決める。** `collect_engine_info` は `id name` の行を
/// 長さも中身も見ずに保持するので、素で載せると長い行を返す実行ファイル
/// ひとつでログの予算（`LOG_FILE_BUDGET`）を一周させられる。
///
/// **切るのは載せるときだけ。** `EngineInfo::name` は画面にも出るので、
/// 入口で切ると利用者が見る名前が変わる。
fn spawn_ok_line(id: &EngineId, name: &str) -> String {
    format!("spawn: ok id={id} name='{}'", shown(name, MAX_SUMMARY_LEN))
}

/// ログに載せるパスの上限。**文字数**（`shown` の第2引数）。
///
/// **`MAX_SUMMARY_LEN` では足りない。** 実運用のパスは要約の上限を普通に超えるので、
/// そちらで切ると毎回 `…` で終わって、どの実行ファイルを起こしたのかが読めない。
///
/// **長さは元から頭打ち。** `canonicalize` を通った値なので PATH_MAX で止まり、
/// これ1行で予算を一周させることはできない。**潰したいのは制御文字のほう**——
/// `canonicalize` も `is_file` も改行を含むファイル名を通すので、素で載せると
/// `eng\n2026-09-03 ERROR ...` という名前の実行ファイル1つで**偽のログ行を作れる**。
///
/// **上は予算の式が止める**（`the_registry_lines_cannot_rotate_the_log_or_forge_a_line`）。
/// 下は同じテストが「実運用の長さのパスが `…` で終わらないこと」で押さえる
/// ——縮めると、この doc が名指しで避けた状態（毎回 `…` で終わって
/// どの実行ファイルを起こしたのか読めない）にそのまま戻る。
const MAX_PATH_IN_LOG_LEN: usize = 256;

/// 起動を始めたことを記録する1行。**成功しても失敗してもここを通る。**
fn spawn_start_line(path: &str) -> String {
    format!("spawn: start path='{}'", shown(path, MAX_PATH_IN_LOG_LEN))
}

/// 上限を超えた後に起き上がったプロセスを畳むことを記録する1行。
fn disposing_line(path: &str) -> String {
    format!(
        "spawn: disposing a late engine path='{}'",
        shown(path, MAX_PATH_IN_LOG_LEN)
    )
}

/// 上限を超えた後に起き上がったプロセスを畳む。
///
/// **`Drop` に任せない。** `usi` crate の `UsiEngineHandler::Drop` は
/// `kill().unwrap()` を呼び、`kill` は先に `quit` を書く。既に死んだプロセスへの
/// 書き込みは EPIPE で失敗するのでパニックする（`UsiProtocol` が
/// `Option` + `mem::forget` を持っているのと同じ理由）。
///
/// 落とせたかは見ない。目的は「死んでいること」で、既に死んでいれば
/// `quit` の書き込みが失敗するだけ。
async fn dispose_late_spawn(
    started: tokio::task::JoinHandle<Result<(String, String, UsiEngineHandler), EngineError>>,
) {
    let Ok(Ok((path, _, mut handler))) = started.await else {
        return;
    };
    log::warn!(target: LOGT, "{}", disposing_line(&path));

    // `kill` も同期の書き込みを含むので専用スレッドへ出す
    let _ = tokio::task::spawn_blocking(move || {
        let _ = handler.kill();
        std::mem::forget(handler);
    })
    .await;
}

impl EngineRegistry {
    /// 台帳から1本引く。**`starting` は見ない**（握手が済むまでは載らない）。
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

    /// 台帳に載っているプロセスの ID。
    ///
    /// **`starting`（`usiok` を待っている最中）は含めない。** `GameManager::ids` は
    /// 同じ「途中の集合を含めるか」を逆に決めているので、揃っていると読まないこと——
    /// あちらは「閉じ忘れを拾う」ための口で、こちらは「いま握手が済んでいるプロセス」。
    ///
    /// 起動の途中で終了フックが走ったときにどう拾うかは `starting` の doc。
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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::engine::utils::LOG_FILE_BUDGET;

    /// 台帳が書く3つの1行が、外から来た文字列でログを壊せないこと。
    ///
    /// **産地が2つある。** `id name` はエンジンが名乗った値、`path` は
    /// webview が選んだ値。どちらも台帳は長さも中身も見ずに保持する。
    ///
    /// 見るのは3つ。**予算を一周させられないこと**（素で載せると1行で診断の
    /// 履歴が全部飛ぶ）、**改行を通さないこと**（`canonicalize` も `is_file` も
    /// 改行を含むファイル名を通すので、素で載せると偽のログ行を1本作れる）、
    /// **実運用の長さのパスが `…` で終わらないこと**（＝上限の下側。
    /// 縮めると、どの実行ファイルを起こしたのかが読めなくなる）。
    #[test]
    fn the_registry_lines_cannot_rotate_the_log_or_forge_a_line() {
        /// 1行が予算のうち占めてよい割合の逆数
        const SHARE: u128 = 50;

        // **入口に上限が無いので、それだけで予算を使い切る値を渡す。**
        // 上限の倍で試すと、切っていなくても予算に収まってしまい何も測れない。
        // 潰されず（制御文字ではない）、UTF-8 でいちばん重い4バイト文字
        let heavy = "\u{10ffff}".repeat(LOG_FILE_BUDGET as usize / 4);
        let id = Uuid::new_v4().to_string();

        for (line, floor) in [
            (spawn_ok_line(&id, &heavy), MAX_SUMMARY_LEN),
            (spawn_start_line(&heavy), MAX_PATH_IN_LOG_LEN),
            (disposing_line(&heavy), MAX_PATH_IN_LOG_LEN),
        ] {
            assert!(
                line.chars().filter(|c| c.len_utf8() == 4).count() >= floor,
                "最悪の文字が潰されている。詰める文字を選び直すこと: {line:.40}"
            );
            assert!(
                line.len() as u128 * SHARE <= LOG_FILE_BUDGET,
                "台帳の1行が予算の1/{SHARE} を超える（{} バイト）",
                line.len()
            );
        }

        // **実運用の長さのパスが `…` で終わらないこと。** 上限を縮めると、
        // 定数の doc が名指しで避けた状態（どの実行ファイルを起こしたのか
        // 読めない）に戻る。
        //
        // 代表的な深さは**固定で持つ**——走っているマシンの実行ファイルだけに
        // すると、浅い場所へビルドしたときに下限が下がる。実行ファイルは
        // 取れれば併せて見る
        let representative =
            "/Users/someone/Library/Application Support/obs-shogi/engines/YaneuraOu/YaneuraOu"
                .to_string();
        for real in [
            Some(representative),
            std::env::current_exe()
                .ok()
                .map(|p| p.to_string_lossy().into_owned()),
        ]
        .into_iter()
        .flatten()
        {
            assert!(
                !spawn_start_line(&real).ends_with("…'"),
                "実運用の長さのパスが切れている: {real}"
            );
        }

        // **短い値で改行を見る。** 重い値の後ろに付けると、切り詰めで
        // 改行ごと落ちて「通していない」が空振りする
        let forged = "/x/eng\n2026-09-03 ERROR forged line";
        for line in [
            spawn_ok_line(&id, forged),
            spawn_start_line(forged),
            disposing_line(forged),
        ] {
            assert!(
                !line.contains('\n'),
                "改行をそのまま通している。この後ろに好きなログ行を作れる: {line:?}"
            );
        }
    }

    /// 起こせなかった理由が、OS の言葉まで残ること。
    ///
    /// **`usi::Error` の `Display` はバリアントごとの定型文しか出さない。**
    /// `EngineIo` は中の `std::io::Error` を丸ごと捨てるので、素で文字列にすると
    /// 利用者に返るのもログに残るのも
    /// 「IO error occurred when communicating with the engine」だけになる。
    ///
    /// 実行権限の無いファイルは、zip から展開したエンジンで最も起きる形。
    /// `canonicalize` も `is_file` も通るので入口の関門は素通りし、
    /// **何を直せばいいかが断り文句から導けない**まま
    /// 「エンジンのパスが違う」の一覧（F-27）に落ちる。
    #[cfg(unix)]
    #[tokio::test]
    async fn a_spawn_failure_keeps_the_reason_the_os_gave() {
        use std::os::unix::fs::PermissionsExt;

        let dir = crate::test_support::temp_dir("engine-not-executable");
        let path = dir.join("engine");
        std::fs::write(&path, b"#!/bin/sh\nexit 0\n").expect("置けている");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).expect("権限");

        let quick = Duration::from_millis(500);
        let error = EngineRegistry::new()
            .spawn(path.to_str().expect("パス"), None, quick, quick)
            .await
            .expect_err("実行権限の無いファイルを起こしている");

        let text = format!("{error}");
        assert!(
            text.contains("os error") || text.contains("Permission denied"),
            "OS が言った理由が消えている: {text}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `engine_path` が**実在するファイル**であることを要求すること。
    ///
    /// **`start_game` を root の関門から免除する理由がこの関門。**
    /// `root_guard.rs` の `EXEMPT` は「起こしてよいかは `EngineRegistry::spawn` の
    /// canonicalize + is_file が見る」と書いているので、ここが抜けると
    /// **免除の根拠ごと消える**——`engine_path` はフロントから来る任意の文字列で、
    /// これが `start_game` と OS の間にある唯一の判定。
    #[tokio::test]
    async fn spawn_refuses_anything_that_is_not_an_existing_file() {
        let registry = EngineRegistry::new();
        let quick = Duration::from_millis(200);

        // ディレクトリ
        let error = registry
            .spawn(env!("CARGO_MANIFEST_DIR"), None, quick, quick)
            .await
            .expect_err("ディレクトリを実行ファイルとして起こしている");
        assert!(
            format!("{error}").contains("existing file"),
            "断る理由が変わっている: {error}"
        );

        // 存在しないパス
        registry
            .spawn("/nonexistent/engine", None, quick, quick)
            .await
            .expect_err("存在しないパスを起こしている");

        // `work_dir` も見る。子プロセスの cwd は相対パスの解決の基点になる
        let error = registry
            .spawn(
                concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml"),
                Some("/nonexistent/dir"),
                quick,
                quick,
            )
            .await
            .expect_err("存在しない work_dir を通している");
        assert!(
            format!("{error}").contains("work_dir"),
            "断る理由が変わっている: {error}"
        );
    }
}
