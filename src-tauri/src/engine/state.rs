use super::types::*;
use std::sync::Mutex;
use usi::UsiEngineHandler;

/// エンジン管理の内部状態
#[derive(Debug)]
pub struct EngineState {
    handler: Option<UsiEngineHandler>,
    info: Option<EngineInfo>,
    status: EngineStatus,
    current_position: Option<String>,
    is_analyzing: bool,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            handler: None,
            info: None,
            status: EngineStatus::Stopped,
            current_position: None,
            is_analyzing: false,
        }
    }
}

/// エンジン状態管理器
pub struct EngineStateManager {
    state: Mutex<EngineState>,
}

impl EngineStateManager {
    /// 新しい状態管理器を作成
    pub fn new() -> Self {
        Self {
            state: Mutex::new(EngineState::default()),
        }
    }

    /// 現在の状態を取得
    pub fn get_status(&self) -> EngineStatus {
        self.state.lock().unwrap().status.clone()
    }

    /// エンジンが動作中かチェック
    pub fn is_running(&self) -> bool {
        let state = self.state.lock().unwrap();
        matches!(state.status, EngineStatus::Ready | EngineStatus::Analyzing)
    }

    /// 解析中かチェック
    pub fn is_analyzing(&self) -> bool {
        self.state.lock().unwrap().is_analyzing
    }

    /// エンジン情報を取得
    pub fn get_engine_info(&self) -> Option<EngineInfo> {
        self.state.lock().unwrap().info.clone()
    }

    /// 現在の局面を取得
    pub fn get_current_position(&self) -> Option<String> {
        self.state.lock().unwrap().current_position.clone()
    }

    /// 状態を変更（原子的操作）
    pub fn update_status(&self, new_status: EngineStatus) {
        self.state.lock().unwrap().status = new_status;
    }

    /// エンジンハンドラーを設定
    pub fn set_handler(&self, handler: UsiEngineHandler) {
        let mut state = self.state.lock().unwrap();
        state.handler = Some(handler);
        state.status = EngineStatus::Ready;
    }

    /// エンジンハンドラーを取得（所有権移動）
    pub fn take_handler(&self) -> Option<UsiEngineHandler> {
        let mut state = self.state.lock().unwrap();
        let handler = state.handler.take();
        if handler.is_some() {
            state.status = EngineStatus::Stopped;
            state.info = None;
            state.current_position = None;
            state.is_analyzing = false;
        }
        handler
    }

    /// エンジン情報を設定
    pub fn set_engine_info(&self, info: EngineInfo) {
        self.state.lock().unwrap().info = Some(info);
    }

    /// エンジン情報を更新（部分更新）
    pub fn update_engine_info<F>(&self, updater: F) -> Option<EngineInfo>
    where
        F: FnOnce(&mut EngineInfo),
    {
        let mut state = self.state.lock().unwrap();
        if let Some(ref mut info) = state.info {
            updater(info);
            Some(info.clone())
        } else {
            None
        }
    }

    /// 局面を設定
    pub fn set_position(&self, sfen: String) {
        self.state.lock().unwrap().current_position = Some(sfen);
    }

    /// 解析状態を変更
    pub fn set_analyzing(&self, analyzing: bool) {
        let mut state = self.state.lock().unwrap();
        state.is_analyzing = analyzing;
        state.status = if analyzing {
            EngineStatus::Analyzing
        } else {
            EngineStatus::Ready
        };
    }

    /// ハンドラーを借用して操作実行
    pub fn with_handler<F, R>(&self, operation: F) -> Option<R>
    where
        F: FnOnce(&mut UsiEngineHandler) -> R,
    {
        let mut state = self.state.lock().unwrap();
        state.handler.as_mut().map(operation)
    }

    /// 状態を読み取り専用で借用して操作実行
    pub fn with_state_read<F, R>(&self, operation: F) -> R
    where
        F: FnOnce(&EngineState) -> R,
    {
        let state = self.state.lock().unwrap();
        operation(&state)
    }
}

impl Default for EngineStateManager {
    fn default() -> Self {
        Self::new()
    }
}
