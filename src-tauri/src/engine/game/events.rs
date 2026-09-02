//! 対局の出来事をどこへ流すか。
//!
//! **`Runner` を `tauri::AppHandle` に依存させない。** 具象に依存すると、
//! 対局の状態機械を回すのに Tauri のランタイムが要る。宛先を差し替えられないと
//! `emit` は黙って捨てるだけになり、`Over` を出したか、`TurnChanged` に何を
//! 載せたかを**確かめる手段が無い**——状態遷移表の `G2` 行のセルは、
//! そこを観測できないと埋められない。
//!
//! 向きは、上（`commands`）が下（`game`）の決めた口に合わせる。

use super::types::GameEvent;

/// 対局の出来事の宛先。
///
/// **`game` が持つ口で、`tauri` を知らない。** 実装（`TauriEvents`）は
/// 上の段（`commands::game`）に置く——下が上を知らない、を保つため。
pub trait GameEventSink: Send + Sync + 'static {
    /// 1件流す。**失敗しても対局を止めない。**
    ///
    /// 届かないことは対局の進行と関係が無い（フロントが落ちていても
    /// エンジンは指し続ける）。失敗の扱いは実装側が決める。
    fn emit(&self, event: GameEvent);
}

/// どこへも流さない宛先。
///
/// テストの既定。`Option<Sink>` にしないのは、`None` の分岐が
/// 呼び出し側に出るのを避けるため（出ると「宛先が無いこともある」を
/// 進行のコードが知ることになる）。
pub struct DiscardEvents;

impl GameEventSink for DiscardEvents {
    fn emit(&self, _event: GameEvent) {}
}

/// 流れた出来事を溜める宛先。
///
/// これが無いと、対局が何を出したかを確かめられない。
///
/// **`DiscardEvents` と同じく `cfg` で切らない。** 切ると
/// `src-tauri/tests/` の結合テストから使えず、継ぎ目がユニットテストの中だけに
/// 閉じる。宛先を trait にしたのは状態遷移表のセルを埋めるためなので、
/// 埋める場所を狭めない。
#[derive(Default)]
pub struct RecordedEvents {
    events: std::sync::Mutex<Vec<GameEvent>>,
}

impl RecordedEvents {
    pub fn take(&self) -> Vec<GameEvent> {
        std::mem::take(&mut self.events.lock().expect("宛先の記録が毒されている"))
    }
}

impl GameEventSink for RecordedEvents {
    fn emit(&self, event: GameEvent) {
        self.events
            .lock()
            .expect("宛先の記録が毒されている")
            .push(event);
    }
}
