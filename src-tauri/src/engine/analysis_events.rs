//! 検討の出来事をどこへ流すか。宛先の trait（`AnalysisEventSink`）と、流す出来事の列。
//!
//! trait を決めるのは下の段で、実装（`TauriAnalysisEvents`）は上の `commands::analysis` が持つ。
//! `bridge` が `tauri` を知らずに済むのはこのため（`game::events` の `GameEventSink` と同じ形）。

use crate::engine::types::{AnalysisUpdate, EngineAnswered, EngineExited, EngineUnresponsive};

/// 解析の側からフロントへ流す出来事
#[derive(Debug, Clone)]
pub enum AnalysisEvent {
    /// 途中経過
    Update(AnalysisUpdate),
    /// 頼んでいないのにエンジンが探索を終えた。`stop` の答えはここに来ない
    Complete(AnalysisUpdate),
    /// こちらが落としていないのにプロセスが終わった
    EngineExited(EngineExited),
    /// 指示が通らなくなった
    EngineUnresponsive(EngineUnresponsive),
    /// `stop` に遅れて答えがあった
    EngineAnswered(EngineAnswered),
}

/// 解析の出来事の宛先。実装は上の段（`commands::analysis`）に置く。下が `tauri` を知らない、を
/// 保つため（`GameEventSink` と同じ形）。
///
/// 実装が守る契約:
///
/// - `emit` は tokio のタスクから同期で呼ばれる。**待たずに返ること。** 止まると、同じワーカに
///   載っている解析の進行が止まる
/// - 宛先のロックを放してから呼ばれる（`EngineBridge::emit_to`）
/// - 失敗しても解析を止めない。扱いは実装側が決める
pub trait AnalysisEventSink: Send + Sync + 'static {
    /// 1件流す
    fn emit(&self, event: AnalysisEvent);
}

/// どこへも流さない宛先。`EngineBridge` の既定（`Option` にすると、宛先が無いことを
/// 進行のコードが知ることになる）
#[derive(Debug)]
pub struct DiscardAnalysisEvents;

impl AnalysisEventSink for DiscardAnalysisEvents {
    fn emit(&self, _event: AnalysisEvent) {}
}
