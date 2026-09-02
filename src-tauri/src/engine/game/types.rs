//! 対局 API の境界に出る型。
//!
//! **USI の語彙をここに出さない。** `readyok` / `usiok` / `position` 文字列 /
//! `go` のパラメータはこの層の内側で完結する。外に出るのは
//! 「いま誰の手番か」「どの手が決まったか」「時計がどうなっているか」だけ。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::engine::types::AnalysisResult;

/// 対局セッションを指す値。
pub type GameId = String;

/// 手番。SFEN の 2 番目のフィールド（`b` / `w`）と対応する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Black,
    White,
}

impl Side {
    pub fn opponent(self) -> Side {
        match self {
            Side::Black => Side::White,
            Side::White => Side::Black,
        }
    }

    /// 配列の添字。`[T; 2]` を先後で引くために使う
    pub fn index(self) -> usize {
        match self {
            Side::Black => 0,
            Side::White => 1,
        }
    }

    pub fn from_sfen_token(token: &str) -> Option<Side> {
        match token {
            "b" => Some(Side::Black),
            "w" => Some(Side::White),
            _ => None,
        }
    }
}

/// 対局者。
///
/// **人とエンジンを1つの型にまとめてある。** 分岐させると、進行側が
/// 「相手が人かエンジンか」を至る所で見ることになり、
/// 人対人・人対エンジン・エンジン対エンジンを同じ経路で回せなくなる。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlayerSpec {
    Human {
        name: String,
    },
    Engine {
        name: String,
        engine_path: String,
        /// 省略時は実行ファイルの置き場
        work_dir: Option<String>,
        /// `setoption` で送る値。型は持たない（→ `research/shogihome/05-usi-engine.md`）
        #[serde(default)]
        options: HashMap<String, String>,
        /// 相手の手番の間も読ませるか
        #[serde(default)]
        ponder: bool,
    },
}

impl PlayerSpec {
    pub fn name(&self) -> &str {
        match self {
            PlayerSpec::Human { name } | PlayerSpec::Engine { name, .. } => name,
        }
    }

    pub fn is_engine(&self) -> bool {
        matches!(self, PlayerSpec::Engine { .. })
    }
}

/// 片側の持ち時間。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeLimit {
    /// 持ち時間
    pub main_ms: u64,
    /// 1手ごとに与え直される秒読み
    pub byoyomi_ms: u64,
    /// 着手できたときに持ち時間へ加算する量（フィッシャー）
    pub increment_ms: u64,
}

impl TimeLimit {
    /// 通したい組み合わせは4つ。
    ///
    /// - 切れ負け: `main > 0`、秒読みも加算も 0
    /// - 秒読み: `byoyomi > 0`。`main` は 0 でもよい（0 なら 30 秒将棋など）
    /// - フィッシャー: `increment > 0`。`main` は 0 でもよい
    /// - 秒読み付きの持ち時間: `main > 0 && byoyomi > 0`
    ///
    /// 弾くのは2つだけ。
    pub fn validate(&self) -> Result<(), String> {
        // 秒読みとフィッシャーを両方送ると、どちらを優先するかがエンジンごとに割れる。
        // GUI 側で決め打つと「設定した通りに指さない」という形で出るので、入口で断る。
        if self.byoyomi_ms > 0 && self.increment_ms > 0 {
            return Err("byoyomi and increment cannot be used together".to_string());
        }
        // 3つとも 0 は「持ち時間が無い」であって、初手で必ず時間切れになる
        if self.main_ms == 0 && self.byoyomi_ms == 0 && self.increment_ms == 0 {
            return Err("time limit must set at least one of main/byoyomi/increment".to_string());
        }
        Ok(())
    }
}

/// 1局ぶんの設定。
///
/// 連続対局・並列対局はこの型に足さない。足すなら
/// `SingleGameSettings` → `LinearGameSettings` と重ねる
/// （→ `research/shogihome/02-game.md` 2節）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSettings {
    pub black: PlayerSpec,
    pub white: PlayerSpec,
    pub black_time: TimeLimit,
    pub white_time: TimeLimit,
    /// 根の局面の SFEN。`position sfen <これ> moves ...` の形で送る。
    /// **`startpos` は受け付けない**（`usi` crate が `position sfen` を前置するため）
    pub start_sfen: String,
    /// 根から対局開始局面までに既に指されている手。途中局面から始めるときに使う
    #[serde(default)]
    pub initial_moves: Vec<String>,
    /// エンジンの時間切れを GUI 側で成立させるか。
    ///
    /// 既定で成立させないのは、**この打ち切りが当たるのはたいてい GUI 側の
    /// 取りこぼしだから**（→ `research/shogihome/02-game.md` の
    /// `enableEngineTimeout` も既定 false）。人間の時間切れは常に成立する。
    #[serde(default)]
    pub enforce_engine_timeout: bool,
}

/// 終局の理由。
///
/// **将棋のルールで決まるものを Rust は判定しない。** 詰み・千日手・持将棋・
/// 最大手数はフロントが判定して `Rule` として渡す。Rust が自分で決めるのは
/// 投了・入玉宣言・時間切れ・エンジンの異常・利用者の中断の5つ。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameOverReason {
    /// `bestmove resign`、または人間の投了
    Resign,
    /// `bestmove win`（入玉宣言）
    DeclareWin,
    Timeout,
    /// エンジンが応答しない、落ちた、コマンドを送れない
    EngineFailure,
    /// フロントが将棋のルールで終局と判定した
    Rule,
    /// 利用者が対局を中断した
    Aborted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResult {
    /// 勝者。引き分けなら `None`
    pub winner: Option<Side>,
    pub reason: GameOverReason,
    /// 棋譜や画面に残す説明。`Rule` のときの文言はフロントが持つ
    pub detail: Option<String>,
}

/// 片側の時計。**止まっている値**で、動いている側の表示には使わない。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockView {
    /// 持ち時間の残り
    pub main_ms: u64,
    /// 秒読みの設定値。1手ごとに与え直されるので、手番の頭では常にこの値
    pub byoyomi_ms: u64,
}

/// 動いている側と、その表示が 0 になる時刻。
///
/// **減っていく値ではなく、尽きる時刻を渡す。** 減る値を渡すと、滑らかに
/// 見せたい側がそれを自分で減らすことになり、「持ち時間を使い切ってから
/// 秒読みが減り始める」という規則が両側に生える。時刻なら
/// `deadline - now` のクランプだけで済み、規則は Rust に1つだけ残る。
///
/// 時刻は壁時計（UNIX epoch のミリ秒）。**時間切れの判定には使わない**
/// （そちらは単調時計で測る）。壁時計が飛んでも狂うのは表示だけで、
/// 次の更新で入れ直る。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningClock {
    pub side: Side,
    /// 持ち時間の表示が 0 になる時刻
    pub main_zero_at: u64,
    /// 秒読みの表示が 0 になる時刻。持ち時間が残っている間は
    /// `main_zero_at + byoyomi_ms` なので、`byoyomi_ms` でクランプすれば満額に見える
    pub byoyomi_zero_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClocksView {
    pub black: ClockView,
    pub white: ClockView,
    /// 両方止まっているなら `None`（裁定待ちと終局後）
    pub running: Option<RunningClock>,
}

/// 対局がいまどの段にいるか。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GamePhaseView {
    /// `side` の着手を待っている。時計が動いている
    Thinking {
        side: Side,
    },
    /// 手が決まり、**フロントの裁定を待っている。時計は止まっている。**
    /// `continue_game` か `end_by_rule` が呼ばれるまで対局は進まない
    AwaitingRuling {
        last_mover: Side,
        usi_move: String,
    },
    Over {
        result: GameResult,
    },
}

/// 対局がいまどうなっているか。`get_game_state` の戻り値。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSnapshot {
    pub game_id: GameId,
    pub black_name: String,
    pub white_name: String,
    pub phase: GamePhaseView,
    /// Rust が持っている指し手列。**権威はフロントの棋譜側**で、
    /// これは `continue_game` が毎手上書きする写し。食い違いの検出に使う
    pub moves: Vec<String>,
    pub clocks: ClocksView,
}

/// フロントへ流す対局の出来事。`game-event` で emit する。
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GameEvent {
    /// 手番が変わり、時計が動き出した
    TurnChanged {
        game_id: GameId,
        side: Side,
        clocks: ClocksView,
    },
    /// 手番側の読み筋。人間の手番と先読み中は出ない
    SearchInfo {
        game_id: GameId,
        side: Side,
        result: AnalysisResult,
    },
    /// 手が決まった。**ここで対局は止まる。**
    ///
    /// フロントがこの手の合法性と、指した後の局面が終局かどうか
    /// （詰み・千日手・持将棋・最大手数）を判定し、
    /// `continue_game` か `end_by_rule` を呼ぶまで次の手番は始まらない。
    MoveDecided {
        game_id: GameId,
        side: Side,
        usi_move: String,
        elapsed_ms: u64,
        clocks: ClocksView,
    },
    /// 時計の更新だけ
    ClockUpdated { game_id: GameId, clocks: ClocksView },
    Over {
        game_id: GameId,
        result: GameResult,
        clocks: ClocksView,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 境界に出る JSON の形を固定する。
    ///
    /// **`rename_all` は enum のバリアント名にしか効かない。** 中のフィールドは
    /// `rename_all_fields` を足すまで snake_case のまま出ていた
    /// （`engine_path` / `game_id` / `usi_move`）。型を書き写した TS 側が
    /// 静かに `undefined` を読むだけなので、コンパイルでは気付けない。
    #[test]
    fn the_wire_shape_is_camel_case_all_the_way_down() {
        let settings = GameSettings {
            black: PlayerSpec::Human {
                name: "me".to_string(),
            },
            white: PlayerSpec::Engine {
                name: "engine".to_string(),
                engine_path: "/path".to_string(),
                work_dir: None,
                options: HashMap::new(),
                ponder: true,
            },
            black_time: TimeLimit {
                main_ms: 1,
                byoyomi_ms: 0,
                increment_ms: 0,
            },
            white_time: TimeLimit {
                main_ms: 1,
                byoyomi_ms: 0,
                increment_ms: 0,
            },
            start_sfen: "sfen b - 1".to_string(),
            initial_moves: Vec::new(),
            enforce_engine_timeout: false,
        };
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains(r#""kind":"engine""#), "{json}");
        assert!(json.contains(r#""enginePath":"/path""#), "{json}");
        assert!(json.contains(r#""workDir":null"#), "{json}");
        assert!(json.contains(r#""blackTime""#), "{json}");
        assert!(json.contains(r#""enforceEngineTimeout""#), "{json}");
        assert!(!json.contains('_'), "snake_case が残っている: {json}");

        let event = GameEvent::MoveDecided {
            game_id: "g".to_string(),
            side: Side::Black,
            usi_move: "7g7f".to_string(),
            elapsed_ms: 5,
            clocks: ClocksView {
                black: ClockView {
                    main_ms: 1,
                    byoyomi_ms: 0,
                },
                white: ClockView {
                    main_ms: 1,
                    byoyomi_ms: 0,
                },
                running: Some(RunningClock {
                    side: Side::Black,
                    main_zero_at: 1_700_000_000_000,
                    byoyomi_zero_at: 1_700_000_000_000,
                }),
            },
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains(r#""type":"moveDecided""#), "{json}");
        assert!(json.contains(r#""gameId":"g""#), "{json}");
        assert!(json.contains(r#""usiMove":"7g7f""#), "{json}");
        assert!(json.contains(r#""elapsedMs":5"#), "{json}");
        assert!(json.contains(r#""byoyomiMs""#), "{json}");
        assert!(json.contains(r#""mainZeroAt""#), "{json}");
        assert!(json.contains(r#""byoyomiZeroAt""#), "{json}");
        assert!(!json.contains('_'), "snake_case が残っている: {json}");

        let phase = GamePhaseView::AwaitingRuling {
            last_mover: Side::White,
            usi_move: "7g7f".to_string(),
        };
        let json = serde_json::to_string(&phase).unwrap();
        assert!(json.contains(r#""phase":"awaitingRuling""#), "{json}");
        assert!(json.contains(r#""lastMover":"white""#), "{json}");
        assert!(!json.contains('_'), "snake_case が残っている: {json}");

        let result = GameResult {
            winner: Some(Side::Black),
            reason: GameOverReason::DeclareWin,
            detail: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert_eq!(
            json,
            r#"{"winner":"black","reason":"declareWin","detail":null}"#
        );
    }

    /// フロントから届く形をそのまま読めること。
    /// 省略できる項目（`workDir` / `options` / `ponder` / `initialMoves` /
    /// `enforceEngineTimeout`）を落としても通る
    #[test]
    fn settings_parse_with_every_optional_field_omitted() {
        let json = r#"{
            "black": { "kind": "human", "name": "me" },
            "white": { "kind": "engine", "name": "e", "enginePath": "/p" },
            "blackTime": { "mainMs": 600000, "byoyomiMs": 0, "incrementMs": 0 },
            "whiteTime": { "mainMs": 600000, "byoyomiMs": 0, "incrementMs": 0 },
            "startSfen": "sfen b - 1"
        }"#;
        let settings: GameSettings = serde_json::from_str(json).unwrap();
        assert!(settings.initial_moves.is_empty());
        assert!(!settings.enforce_engine_timeout);
        match settings.white {
            PlayerSpec::Engine {
                ponder, work_dir, ..
            } => {
                assert!(!ponder);
                assert_eq!(work_dir, None);
            }
            _ => panic!("engine として読めていない"),
        }
    }
}
