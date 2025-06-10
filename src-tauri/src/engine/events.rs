use super::error::EngineResult;
use super::types::*;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

/// フロントエンドイベント発行器
pub struct EventEmitter<R: Runtime> {
    app_handle: AppHandle<R>,
}

impl<R: Runtime> EventEmitter<R> {
    /// 新しいイベント発行器を作成
    pub fn new(app_handle: AppHandle<R>) -> Self {
        Self { app_handle }
    }

    /// AppHandleを取得（必要に応じて）
    pub fn app_handle(&self) -> &AppHandle<R> {
        &self.app_handle
    }

    /// エンジン状態変更を通知
    pub async fn emit_status_change(&self, status: EngineStatus) -> EngineResult<()> {
        self.app_handle
            .emit("engine-event", EngineEvent::StatusChanged { status })?;
        Ok(())
    }

    /// エンジン情報を通知
    pub async fn emit_engine_info(&self, info: &EngineInfo) -> EngineResult<()> {
        self.app_handle.emit(
            "engine-event",
            EngineEvent::EngineInfo { info: info.clone() },
        )?;
        Ok(())
    }

    /// 解析結果更新を通知
    pub async fn emit_analysis_update(&self, result: AnalysisResult) -> EngineResult<()> {
        self.app_handle
            .emit("engine-event", EngineEvent::AnalysisUpdate { result })?;
        Ok(())
    }

    /// オプション変更を通知
    pub async fn emit_option_changed(&self, name: &str, value: Option<&str>) -> EngineResult<()> {
        self.app_handle.emit(
            "engine-event",
            EngineEvent::OptionChanged {
                name: name.to_string(),
                value: value.map(|v| v.to_string()),
            },
        )?;
        Ok(())
    }

    /// エラーを通知
    pub async fn emit_error(&self, message: &str) -> EngineResult<()> {
        self.app_handle.emit(
            "engine-event",
            EngineEvent::Error {
                message: message.to_string(),
            },
        )?;
        Ok(())
    }

    /// 同期版エラー通知（エラーを無視）
    pub fn emit_error_sync(&self, message: &str) {
        let _ = self.app_handle.emit(
            "engine-event",
            EngineEvent::Error {
                message: message.to_string(),
            },
        );
    }

    /// 同期版状態変更通知（エラーを無視）
    pub fn emit_status_change_sync(&self, status: EngineStatus) {
        let _ = self
            .app_handle
            .emit("engine-event", EngineEvent::StatusChanged { status });
    }

    /// 汎用イベント通知
    pub async fn emit_event(&self, event: EngineEvent) -> EngineResult<()> {
        self.app_handle.emit("engine-event", event)?;
        Ok(())
    }

    /// バッチでイベントを通知（失敗したものはログ出力）
    pub async fn emit_events(&self, events: Vec<EngineEvent>) {
        for event in events {
            if let Err(e) = self.emit_event(event).await {
                eprintln!("Failed to emit event: {}", e);
            }
        }
    }
}

/// 共有可能なイベント発行器（Arcでラップ）
pub type SharedEventEmitter<R> = Arc<EventEmitter<R>>;

/// SharedEventEmitterを作成するヘルパー
impl<R: Runtime> EventEmitter<R> {
    pub fn into_shared(self) -> SharedEventEmitter<R> {
        Arc::new(self)
    }

    pub fn shared(app_handle: AppHandle<R>) -> SharedEventEmitter<R> {
        Arc::new(Self::new(app_handle))
    }
}

/// イベント発行のヘルパートレイト
#[allow(async_fn_in_trait)]
pub trait EventEmitterExt<R: Runtime> {
    fn events(&self) -> &EventEmitter<R>;

    /// 安全にエラーを通知（非同期）
    async fn notify_error(&self, message: &str) {
        if let Err(e) = self.events().emit_error(message).await {
            eprintln!("Failed to emit error event: {}", e);
        }
    }

    /// 安全に状態変更を通知（非同期）
    async fn notify_status_change(&self, status: EngineStatus) {
        if let Err(e) = self.events().emit_status_change(status).await {
            eprintln!("Failed to emit status change: {}", e);
        }
    }

    /// 安全にエンジン情報を通知（非同期）
    async fn notify_engine_info(&self, info: &EngineInfo) {
        if let Err(e) = self.events().emit_engine_info(info).await {
            eprintln!("Failed to emit engine info: {}", e);
        }
    }

    /// 安全に解析結果を通知（非同期）
    async fn notify_analysis_update(&self, result: AnalysisResult) {
        if let Err(e) = self.events().emit_analysis_update(result).await {
            eprintln!("Failed to emit analysis update: {}", e);
        }
    }
}

/// 非同期タスクでのイベント通知用ヘルパー
pub struct AsyncEventNotifier<R: Runtime> {
    emitter: SharedEventEmitter<R>,
}

impl<R: Runtime> AsyncEventNotifier<R> {
    pub fn new(emitter: SharedEventEmitter<R>) -> Self {
        Self { emitter }
    }

    /// エラーを非同期タスクで通知
    pub fn spawn_error_notification(&self, message: String) {
        let emitter = Arc::clone(&self.emitter);
        tokio::spawn(async move {
            emitter.emit_error_sync(&message);
        });
    }

    /// 状態変更を非同期タスクで通知
    pub fn spawn_status_notification(&self, status: EngineStatus) {
        let emitter = Arc::clone(&self.emitter);
        tokio::spawn(async move {
            emitter.emit_status_change_sync(status);
        });
    }

    /// 解析結果を非同期タスクで通知
    pub fn spawn_analysis_notification(&self, result: AnalysisResult) {
        let emitter = Arc::clone(&self.emitter);
        tokio::spawn(async move {
            if let Err(e) = emitter.emit_analysis_update(result).await {
                eprintln!("Failed to emit analysis update: {}", e);
            }
        });
    }
}
