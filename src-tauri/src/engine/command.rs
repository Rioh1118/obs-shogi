use serde::Serialize;
use tauri::State;
use tokio::sync::{mpsc, Mutex};

use crate::engine::analysis::UsiAnalysisEngine;
use crate::engine::types::{AnalysisResult, EngineInfo, EngineSettings};

// シンプルなエンジン管理用の状態
pub struct EngineState {
    engine: Mutex<Option<UsiAnalysisEngine>>,
    analysis_receiver: Mutex<Option<mpsc::UnboundedReceiver<AnalysisResult>>>,
}

impl EngineState {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(None),
            analysis_receiver: Mutex::new(None),
        }
    }
}

#[derive(Serialize)]
pub struct InitializeEngineResponse {
    pub engine_info: EngineInfo,
    pub success: bool,
}

#[derive(Serialize)]
pub struct AnalysisStatus {
    pub is_analyzing: bool,
    pub message: Option<String>,
}

// ===== エンジン初期化・設定関連のコマンド =====

#[tauri::command]
pub async fn initialize_engine_with_options(
    engine_path: String,
    work_dir: String,
    engine_state: State<'_, EngineState>,
) -> Result<InitializeEngineResponse, String> {
    println!("🚀 [TAURI] initialize_engine_with_options called");
    println!("   engine_path: {}", engine_path);
    println!("   work_dir: {}", work_dir);
    // 既存のエンジンがあれば停止
    {
        let mut engine_opt = engine_state.engine.lock().await;
        println!("🔍 [TAURI] Checking existing engine...");
        if let Some(mut engine) = engine_opt.take() {
            println!("⚠️  [TAURI] Found existing engine, stopping analysis...");
            let _ = engine.stop_analysis().await; // エラーは無視
            println!("✅ [TAURI] Existing engine stopped");
        }
    }

    println!("🔧 [TAURI] Creating new engine...");
    // 新しいエンジンを初期化
    let (engine, engine_info) = UsiAnalysisEngine::new_with_options(&engine_path, &work_dir)
        .await
        .map_err(|e| {
            println!("❌ [TAURI] Engine creation failed: {}", e);
            e.to_string()
        })?;

    println!("✅ [TAURI] Engine created successfully");
    println!("   Engine name: {}", engine_info.name);
    println!("   Engine author: {}", engine_info.author);
    println!("   Options count: {}", engine_info.options.len());

    // エンジンを保存
    {
        let mut engine_opt = engine_state.engine.lock().await;
        *engine_opt = Some(engine);
    }

    println!("🎉 [TAURI] initialize_engine_with_options completed successfully");
    Ok(InitializeEngineResponse {
        engine_info,
        success: true,
    })
}

#[tauri::command]
pub async fn apply_engine_settings(
    settings: EngineSettings,
    engine_state: State<'_, EngineState>,
) -> Result<(), String> {
    let mut engine_opt = engine_state.engine.lock().await;

    if let Some(engine) = engine_opt.as_mut() {
        engine
            .apply_settings(&settings)
            .await
            .map_err(|e| e.to_string())?;
        engine.ensure_ready().await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Engine not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_engine_ready_status(engine_state: State<'_, EngineState>) -> Result<bool, String> {
    let engine_opt = engine_state.engine.lock().await;
    Ok(engine_opt.is_some())
}

// ===== 解析関連のコマンド =====

#[tauri::command]
pub async fn start_infinite_analysis(
    position: String,
    engine_state: State<'_, EngineState>,
) -> Result<(), String> {
    println!("🎯 [TAURI] start_infinite_analysis called");
    println!("   position: {}", position);

    let mut engine_opt = engine_state.engine.lock().await;
    println!("🔍 [TAURI] Engine lock acquired");

    if let Some(engine) = engine_opt.as_mut() {
        println!("✅ [TAURI] Engine found, proceeding with analysis");
        // 解析結果用のチャンネルを作成
        println!("📡 [TAURI] Creating analysis result channel...");
        let (tx, rx) = mpsc::unbounded_channel();
        println!("✅ [TAURI] Channel created successfully");

        // チャンネルを保存（フロントエンドで結果を受信するため）
        {
            println!("💾 [TAURI] Storing receiver in engine state...");
            let mut receiver_opt = engine_state.analysis_receiver.lock().await;
            *receiver_opt = Some(rx);
            println!("✅ [TAURI] Receiver stored successfully");
        }

        // 解析開始
        println!("🚀 [TAURI] Starting infinite analysis...");
        match engine.start_infinite_analysis(&position, tx).await {
            Ok(()) => {
                println!("🎉 [TAURI] Analysis started successfully");
                Ok(())
            }
            Err(e) => {
                println!("❌ [TAURI] Analysis start failed: {}", e);
                println!("❌ [TAURI] Error details: {:?}", e);
                Err(e.to_string())
            }
        }
    } else {
        println!("❌ [TAURI] Engine not initialized");
        Err("Engine not initialized".to_string())
    }
}

#[tauri::command]
pub async fn stop_analysis(engine_state: State<'_, EngineState>) -> Result<(), String> {
    let mut engine_opt = engine_state.engine.lock().await;

    if let Some(engine) = engine_opt.as_mut() {
        engine.stop_analysis().await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Engine not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_analysis_status(
    engine_state: State<'_, EngineState>,
) -> Result<AnalysisStatus, String> {
    let engine_opt = engine_state.engine.lock().await;

    match engine_opt.as_ref() {
        Some(_engine) => {
            // TODO: 実際の解析状態を取得する方法があれば実装
            // 今は簡単な実装
            Ok(AnalysisStatus {
                is_analyzing: true, // 仮の値
                message: Some("Analysis running".to_string()),
            })
        }
        None => Ok(AnalysisStatus {
            is_analyzing: false,
            message: Some("Engine not initialized".to_string()),
        }),
    }
}

// ===== 解析結果取得のコマンド =====

#[tauri::command]
pub async fn get_latest_analysis_result(
    engine_state: State<'_, EngineState>,
) -> Result<Option<AnalysisResult>, String> {
    let mut receiver_opt = engine_state.analysis_receiver.lock().await;

    if let Some(receiver) = receiver_opt.as_mut() {
        // 非ブロッキングで最新の結果を取得
        match receiver.try_recv() {
            Ok(result) => Ok(Some(result)),
            Err(mpsc::error::TryRecvError::Empty) => Ok(None),
            Err(mpsc::error::TryRecvError::Disconnected) => {
                // チャンネルが閉じられた
                *receiver_opt = None;
                Ok(None)
            }
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn get_all_pending_analysis_results(
    engine_state: State<'_, EngineState>,
) -> Result<Vec<AnalysisResult>, String> {
    let mut receiver_opt = engine_state.analysis_receiver.lock().await;
    let mut results = Vec::new();

    if let Some(receiver) = receiver_opt.as_mut() {
        // 溜まっている全ての結果を取得
        while let Ok(result) = receiver.try_recv() {
            results.push(result);
        }
    }

    Ok(results)
}

// ===== エンジン管理のコマンド =====

#[tauri::command]
pub async fn shutdown_engine(engine_state: State<'_, EngineState>) -> Result<(), String> {
    println!("🛑 [TAURI] shutdown_engine called");

    // エンジンのシャットダウン
    {
        let mut engine_opt = engine_state.engine.lock().await;
        if let Some(mut engine) = engine_opt.take() {
            println!("🔄 [TAURI] Calling engine shutdown...");

            // 重要：UsiAnalysisEngineのshutdownメソッドを呼び出す
            match engine.shutdown().await {
                Ok(()) => {
                    println!("✅ [TAURI] Engine shutdown successful");
                }
                Err(e) => {
                    println!("⚠️  [TAURI] Engine shutdown error: {}", e);
                    // エラーでも続行（エンジンプロセスが既に死んでいる場合など）
                }
            }
        } else {
            println!("ℹ️  [TAURI] No engine to shutdown");
        }
    }

    // チャンネルもクリア
    {
        let mut receiver_opt = engine_state.analysis_receiver.lock().await;
        *receiver_opt = None;
        println!("📡 [TAURI] Analysis receiver cleared");
    }

    println!("✅ [TAURI] shutdown_engine completed");
    Ok(())
}

// ===== デバッグ・ユーティリティコマンド =====

#[tauri::command]
pub async fn send_raw_command(
    command: String,
    engine_state: State<'_, EngineState>,
) -> Result<(), String> {
    let mut engine_opt = engine_state.engine.lock().await;

    if let Some(_engine) = engine_opt.as_mut() {
        // 生のUSIコマンドを送信する場合
        // UsiEngineHandlerに直接アクセスする方法があれば実装
        // 今は簡単なエラーを返す
        Err("Raw command sending not implemented yet".to_string())
    } else {
        Err("Engine not initialized".to_string())
    }
}
