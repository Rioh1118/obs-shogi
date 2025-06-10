use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, RwLock};
use tokio::time::{timeout, Duration};

use super::converter::UsiConverter;
use super::types::*;

/// USIエンジンとの通信を管理
#[derive(Debug)]
pub struct UsiCommunication {
    process: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    converter: UsiConverter,
    status: Arc<RwLock<EngineStatus>>,
    event_sender: Option<mpsc::UnboundedSender<EngineEvent>>,
}

impl UsiCommunication {
    /// 新しい通信インスタンスを作成
    pub fn new() -> Self {
        Self {
            process: None,
            stdin: None,
            stdout: None,
            converter: UsiConverter::new(),
            status: Arc::new(RwLock::new(EngineStatus::Stopped)),
            event_sender: None,
        }
    }

    /// イベント送信チャンネルを設定
    pub fn set_event_sender(&mut self, sender: mpsc::UnboundedSender<EngineEvent>) {
        self.event_sender = Some(sender);
    }

    /// エンジンを起動
    pub async fn start_engine(&mut self, engine_path: &str) -> Result<(), String> {
        if self.process.is_some() {
            return Err("Engine is already running".to_string());
        }

        self.set_status(EngineStatus::Starting).await;

        // エンジンプロセスを起動（tokio::process::Commandを使用）
        let mut child = Command::new(engine_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start engine: {}", e))?;

        // stdin/stdoutを取得
        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

        self.process = Some(child);
        self.stdin = Some(stdin);
        self.stdout = Some(BufReader::new(stdout));

        // 出力読み取りタスクを開始
        self.start_output_reader().await;

        // USIプロトコル初期化
        self.send_command("usi").await?;

        Ok(())
    }

    /// エンジンを停止
    pub async fn stop_engine(&mut self) -> Result<(), String> {
        if let Some(mut process) = self.process.take() {
            // quitコマンドを送信
            let _ = self.send_command("quit").await;

            // プロセス終了を待機（タイムアウト付き）
            match timeout(Duration::from_secs(5), process.wait()).await {
                Ok(_) => {
                    self.stdin = None;
                    self.stdout = None;
                    self.set_status(EngineStatus::Stopped).await;
                    Ok(())
                }
                Err(_) => {
                    // 強制終了
                    let _ = process.kill().await;
                    self.stdin = None;
                    self.stdout = None;
                    self.set_status(EngineStatus::Stopped).await;
                    Err("Engine did not stop gracefully, killed forcefully".to_string())
                }
            }
        } else {
            Err("Engine is not running".to_string())
        }
    }

    /// コマンドを送信
    pub async fn send_command(&mut self, command: &str) -> Result<(), String> {
        if let Some(stdin) = &mut self.stdin {
            let command_line = format!("{}\n", command);
            stdin
                .write_all(command_line.as_bytes())
                .await
                .map_err(|e| format!("Failed to send command: {}", e))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
            Ok(())
        } else {
            Err("Engine is not running".to_string())
        }
    }

    /// オプションを設定
    pub async fn set_option(&mut self, name: &str, value: Option<&str>) -> Result<(), String> {
        let command = if let Some(val) = value {
            format!("setoption name {} value {}", name, val)
        } else {
            format!("setoption name {}", name)
        };
        self.send_command(&command).await
    }

    /// 解析を開始
    pub async fn start_analysis(&mut self, request: &StartAnalysisRequest) -> Result<(), String> {
        // 局面を設定
        self.send_command(&format!("position sfen {}", request.position))
            .await?;

        // 解析コマンドを構築
        let mut go_command = "go".to_string();

        if request.infinite {
            go_command.push_str(" infinite");
        } else {
            if let Some(time_limit) = request.time_limit {
                go_command.push_str(&format!(" movetime {}", time_limit));
            }
            if let Some(depth_limit) = request.depth_limit {
                go_command.push_str(&format!(" depth {}", depth_limit));
            }
        }

        self.send_command(&go_command).await?;
        self.set_status(EngineStatus::Analyzing).await;

        Ok(())
    }

    /// 解析を停止
    pub async fn stop_analysis(&mut self) -> Result<(), String> {
        self.send_command("stop").await?;
        self.set_status(EngineStatus::Ready).await;
        Ok(())
    }

    /// 出力読み取りタスクを開始
    async fn start_output_reader(&mut self) {
        if let Some(stdout) = self.stdout.take() {
            let status = Arc::clone(&self.status);
            let event_sender = self.event_sender.clone();
            let converter = self.converter.clone();

            tokio::spawn(async move {
                Self::output_reader_task(stdout, status, event_sender, converter).await;
            });
        }
    }

    /// 出力読み取りタスク（バックグラウンド実行）
    async fn output_reader_task(
        mut stdout: BufReader<ChildStdout>,
        status: Arc<RwLock<EngineStatus>>,
        event_sender: Option<mpsc::UnboundedSender<EngineEvent>>,
        converter: UsiConverter,
    ) {
        let mut line = String::new();

        loop {
            line.clear();
            match stdout.read_line(&mut line).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    // レスポンスを解析してイベントを送信
                    if let Some(event) = Self::parse_response(trimmed, &converter, &status).await {
                        if let Some(sender) = &event_sender {
                            let _ = sender.send(event);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Error reading from engine: {}", e);
                    break;
                }
            }
        }
    }

    /// エンジンからのレスポンスを解析
    async fn parse_response(
        line: &str,
        converter: &UsiConverter,
        status: &Arc<RwLock<EngineStatus>>,
    ) -> Option<EngineEvent> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            return None;
        }

        match parts[0] {
            "id" => {
                // エンジン情報
                if parts.len() >= 3 && parts[1] == "name" {
                    let name = parts[2..].join(" ");
                    let info = EngineInfo {
                        name,
                        author: None,
                        version: None,
                        options: Vec::new(),
                    };
                    Some(converter.create_engine_info_event(info))
                } else {
                    None
                }
            }
            "usiok" => {
                // USI初期化完了
                *status.write().await = EngineStatus::Ready;
                Some(converter.create_status_event(EngineStatus::Ready))
            }
            "readyok" => {
                // 準備完了
                *status.write().await = EngineStatus::Ready;
                Some(converter.create_status_event(EngineStatus::Ready))
            }
            "info" => {
                // 解析情報
                Self::parse_info_line(&parts[1..], converter).await
            }
            "bestmove" => {
                // 最善手（解析終了）
                *status.write().await = EngineStatus::Ready;
                Some(converter.create_status_event(EngineStatus::Ready))
            }
            _ => None,
        }
    }

    /// info行を解析
    async fn parse_info_line(parts: &[&str], converter: &UsiConverter) -> Option<EngineEvent> {
        use std::time::Duration;
        use usi::{InfoParams, ScoreKind};

        if parts.is_empty() {
            return None;
        }

        let mut i = 0;
        let mut info_params = Vec::new();

        while i < parts.len() {
            match parts[i] {
                "depth" => {
                    if i + 1 < parts.len() {
                        if let Ok(depth) = parts[i + 1].parse::<i32>() {
                            info_params.push(InfoParams::Depth(depth, None));
                        }
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "nodes" => {
                    if i + 1 < parts.len() {
                        if let Ok(nodes) = parts[i + 1].parse::<i32>() {
                            info_params.push(InfoParams::Nodes(nodes));
                        }
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "nps" => {
                    if i + 1 < parts.len() {
                        if let Ok(nps) = parts[i + 1].parse::<i32>() {
                            info_params.push(InfoParams::Nps(nps));
                        }
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "time" => {
                    if i + 1 < parts.len() {
                        if let Ok(time_ms) = parts[i + 1].parse::<u64>() {
                            info_params.push(InfoParams::Time(Duration::from_millis(time_ms)));
                        }
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "score" => {
                    if i + 2 < parts.len() {
                        match parts[i + 1] {
                            "cp" => {
                                if let Ok(cp) = parts[i + 2].parse::<i32>() {
                                    info_params.push(InfoParams::Score(cp, ScoreKind::CpExact));
                                }
                                i += 3;
                            }
                            "mate" => {
                                if let Ok(mate) = parts[i + 2].parse::<i32>() {
                                    info_params.push(InfoParams::Score(mate, ScoreKind::MateExact));
                                }
                                i += 3;
                            }
                            _ => i += 1,
                        }
                    } else {
                        i += 1;
                    }
                }
                "pv" => {
                    let pv_moves: Vec<String> =
                        parts[i + 1..].iter().map(|s| s.to_string()).collect();
                    if !pv_moves.is_empty() {
                        info_params.push(InfoParams::Pv(pv_moves));
                    }
                    break; // pvは行の最後まで
                }
                _ => i += 1,
            }
        }

        if !info_params.is_empty() {
            if let Ok(analysis_result) = converter.convert_multi_info_to_analysis(info_params) {
                Some(converter.create_analysis_event(analysis_result))
            } else {
                None
            }
        } else {
            None
        }
    }

    /// ステータスを設定
    async fn set_status(&self, status: EngineStatus) {
        *self.status.write().await = status.clone();
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(self.converter.create_status_event(status));
        }
    }

    /// 現在のステータスを取得
    pub async fn get_status(&self) -> EngineStatus {
        self.status.read().await.clone()
    }

    /// エンジンが実行中かチェック
    pub fn is_running(&self) -> bool {
        self.process.is_some()
    }
}

impl Drop for UsiCommunication {
    fn drop(&mut self) {
        // プロセスが残っている場合は強制終了
        if let Some(mut process) = self.process.take() {
            let _ = process.start_kill();
        }
    }
}
