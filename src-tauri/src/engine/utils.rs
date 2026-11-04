//! 解析と対局が同じ形で使う2つの部品。`info` 行を読み筋へ畳むことと、ログに載せる文字列を作ること。
//!
//! どちらも `analyzer` と `game` の両方から呼ぶので、`tests/layering.rs` の段で両方より下のここに置く。

use std::time::{Duration, Instant};
use usi::{GuiCommand, InfoParams, ScoreKind};

use crate::engine::types::{AnalysisCandidate, AnalysisResult, Evaluation, EvaluationKind};

/// `info` 行を解析結果へ畳み込む。
///
/// 解析と対局で同じ形の読み筋を出す。**2箇所で別々に組み立てない。**
/// 片方だけ直すと、同じエンジンの同じ出力が画面の場所によって違って見える。
///
/// `multipv` の無い行は rank 1 に入る。畳んだ後、`candidates` を rank の昇順に並べる。
pub fn apply_info_params(info_params: &[InfoParams], result: &mut AnalysisResult) {
    let rank = extract_rank(info_params);

    for info in info_params {
        match info {
            InfoParams::MultiPv(_) => {}
            InfoParams::Depth(depth, _seldepth) => {
                let c = get_or_create_candidate(result, rank);
                c.depth = Some(*depth as u32);
            }
            InfoParams::Nodes(nodes) => {
                let c = get_or_create_candidate(result, rank);
                c.nodes = Some(*nodes as u64);
            }
            InfoParams::Time(time) => {
                let c = get_or_create_candidate(result, rank);
                c.time_ms = Some(time.as_millis() as u64);
            }
            InfoParams::Pv(moves) => {
                let c = get_or_create_candidate(result, rank);
                c.pv_line = moves.clone();
                c.first_move = moves.first().cloned();
            }
            InfoParams::Score(value, kind) => {
                let eval = map_score_to_evaluation(*value, kind);
                let c = get_or_create_candidate(result, rank);
                c.evaluation = Some(eval);
            }
            _ => {}
        }
    }
    result.candidates.sort_by_key(|c| c.rank);
}

/// `rank` の読み筋が最後に受けた深さを返す。その読み筋が無いか、深さを受けていなければ `None`
pub fn depth_of_rank(result: &AnalysisResult, rank: u32) -> Option<u32> {
    result
        .candidates
        .iter()
        .find(|c| c.rank == rank)
        .and_then(|c| c.depth)
}

/// `multipv` の番号を返す。無ければ 1
fn extract_rank(info_params: &[InfoParams]) -> u32 {
    for info in info_params {
        if let InfoParams::MultiPv(r) = info {
            return *r as u32;
        }
    }
    1
}

/// `rank` の読み筋を返す。無ければ空の読み筋を末尾に足して返す
fn get_or_create_candidate(result: &mut AnalysisResult, rank: u32) -> &mut AnalysisCandidate {
    if let Some(idx) = result.candidates.iter().position(|c| c.rank == rank) {
        return &mut result.candidates[idx];
    }

    result.candidates.push(AnalysisCandidate {
        rank,
        first_move: None,
        pv_line: Vec::new(),
        evaluation: None,
        depth: None,
        nodes: None,
        time_ms: None,
    });

    let last = result.candidates.len() - 1;
    &mut result.candidates[last]
}

/// `score` の値と種類を評価値にする。上界・下界の印は捨てる
fn map_score_to_evaluation(value: i32, kind: &ScoreKind) -> Evaluation {
    match kind {
        ScoreKind::CpExact | ScoreKind::CpLowerbound | ScoreKind::CpUpperbound => Evaluation {
            value,
            kind: EvaluationKind::Centipawn,
        },

        ScoreKind::MateExact | ScoreKind::MateLowerbound | ScoreKind::MateUpperbound => {
            Evaluation {
                value,
                kind: EvaluationKind::MateInMoves(value),
            }
        }

        ScoreKind::MateSignOnly => {
            // `usi` 0.6.2 は `mate +` を 1、`mate -` を -1 で渡す。0 は来ないが、来たら `+` に倒す
            let plus = value >= 0;
            Evaluation {
                value: if plus { 1 } else { -1 },
                kind: EvaluationKind::MateUnknown(plus),
            }
        }
    }
}

/// 宛先へ流せなかったことを記録する最短間隔。
///
/// **1つに寄せる。** 解析と対局で別々に持つと、片方を動かしたときに
/// もう片方が古いまま残る。同じ判断（emit の失敗は洪水になるので絞る）なので、
/// 両方が使える段に置く。
pub const EMIT_WARN_INTERVAL: Duration = Duration::from_secs(5);

/// ログ・断り文句・棋譜に残る値に載せてよい写しを返す。制御文字を潰し、`max` 文字で切る。
///
/// 潰した結果はそのまま外へ出る。終局の説明（`GameResult::detail`）は、これを通した値が
/// `over` のイベントとスナップショットに載るので、改行を含む文言を渡すと利用者の目に置換文字が見える。
/// その断りは `endGameByRule` の TSDoc に書いてある。見えるのは、切った印と潰した制御文字の2つだけ。
/// 全角空白や結合文字まで潰すと、化けた理由を調べる手掛かりがどこにも残らない。
///
/// 潰すのは制御文字だけ。改行を通すと、その後ろに好きなログ行を作れる。
/// 潰した後は1文字あたり最大4バイト（UTF-8）で収まる。
///
/// `search/` は別の規約を持つ（`search::message::for_screen`）。あちらは改行を通し
/// （棋譜の引用を読める形で残すため）、上限を固定で持つ。同じ判断ではないので、片方だけ読んで
/// 揃えないこと。実装を1本に寄せるには `tests/layering.rs` の規則3（`engine/` は crate の
/// 他の枝を `use` しない）から動かすことになる。
///
/// `is_control()` が真になるのは `Cc` だけで、U+2028 / U+2029（行区切り）も、双方向制御
/// （U+202A–U+202E / U+2066–U+2069）も、BOM も通す。通すのは意図で、根拠は上と同じく、
/// 棋譜と画面に出る値なので化けた理由を調べる手掛かりを消さないため。ログの行を偽造する力は無い
/// （`tail` も `grep` も U+2028 で分割しない）。産地が増えたら見直すこと。いまの `detail` の
/// 出どころは自分のフロントだけで、棋譜ファイル由来の文字列が流れ込む経路ができたら判断が変わる。
///
/// **通した値を `{:?}` で書かないこと。** `{:?}` は制御文字のほかに `Cf`（BOM）/ `Cn`（未割り当て）も
/// `\u{XXXX}` へ展開するので、1文字が10バイトに膨らんで上の見積もりが外れる。潰してあるので `{}` で足りる。
///
/// 文字数で切る。バイト数で切ると多バイト文字の途中で割れる。
pub fn shown(text: &str, max: usize) -> String {
    let mut out: String = text
        .chars()
        .take(max)
        .map(|c| if c.is_control() { '\u{fffd}' } else { c })
        .collect();
    if text.chars().nth(max).is_some() {
        out.push('…');
    }
    out
}

/// 外来のエラーを、原因の連鎖ごと1本の文字列にする。
///
/// `usi` crate の `Error` は `thiserror` で組んであり、`Display` はバリアントごとの定型文しか
/// 出さない。`EngineIo` は「IO error occurred when communicating with the engine」で、
/// 中の `std::io::Error` を丸ごと捨てる。
///
/// 実行権限の無いファイルを選ぶと（zip から展開したエンジンで最も起きる形）、`canonicalize` も
/// `is_file` も通って `Command::spawn` が EACCES で落ちるのに、利用者に返るのもログに残るのも
/// その定型文だけになる。「権限が無い」「アーキテクチャが違う」の区別が付かず、何を直せばいいかが導けない。
///
/// **返り値は制御文字を潰していない。** 潰さずに済むのは、いまここへ渡している型に限った話で、
/// `usi::Error` と `io::Error` の連鎖はどちらも `Display` が短く、外来の文字列を含まない。
/// webview 由来の文字列を運ぶ型（`setoption` の名前を抱えた `StartupFailed` など）を渡すなら、
/// 返り値を `shown` に通すこと。素で `log::error!` へ流すと1行8KB になり、
/// `MAX_SUMMARY_LEN` が名指しで避けている状態になる。
pub fn with_cause(error: &dyn std::error::Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

#[cfg(test)]
mod tests {

    /// 制御文字を潰し、文字の途中で割らないこと。
    #[test]
    fn a_shown_copy_is_bounded_and_readable() {
        assert_eq!(shown("7g7f", 8), "7g7f");
        assert!(!shown("a\nb", 8).contains('\n'), "改行を通している");

        // 多バイト文字の途中で割らない
        let trimmed = shown("あいうえお", 3);
        assert!(
            trimmed.starts_with("あいう"),
            "文字の途中で割っている: {trimmed}"
        );
        assert!(trimmed.ends_with('…'), "切ったことが分からない: {trimmed}");
    }

    use super::*;

    /// 原因の連鎖が残ること。
    ///
    /// `usi::Error` の `Display` はバリアントごとの定型文しか出さず、
    /// 中の `io::Error` を丸ごと捨てる。捨てたままだと、実行権限の無い
    /// エンジンを選んだ利用者に返るのも、対局中に stdin が壊れたときに
    /// 棋譜へ残るのも「IO error occurred …」の1文だけになる。
    #[test]
    fn a_cause_survives_being_turned_into_text() {
        // EACCES。zip から展開したエンジンで最も起きる形
        let error = usi::Error::EngineIo(std::io::Error::from_raw_os_error(13));
        let text = with_cause(&error);

        assert!(
            text.contains("os error") || text.contains("Permission denied"),
            "OS が言った理由が消えている: {text}"
        );
        assert!(
            text.len() > error.to_string().len(),
            "連鎖が付いていない: {text}"
        );
    }

    fn info(line: &str) -> Vec<InfoParams> {
        match usi::EngineCommand::parse(line).expect("解ける") {
            usi::EngineCommand::Info(params) => params,
            other => panic!("info ではない: {other:?}"),
        }
    }

    /// `info` 行を MultiPV の番号ごとに畳み、番号の昇順に並べる。
    /// `multipv` の無い行は1本目に入り、行に無い欄は前の値を残す
    #[test]
    fn info_lines_fold_into_candidates_by_rank() {
        let mut result = AnalysisResult::default();
        apply_info_params(
            &info("info multipv 2 depth 12 nodes 3456 time 1500 score mate -3 pv 2g2f 8c8d"),
            &mut result,
        );
        apply_info_params(
            &info("info depth 10 nodes 1234 time 980 score cp 85 pv 7g7f 3c3d 2g2f"),
            &mut result,
        );
        apply_info_params(&info("info depth 11"), &mut result);

        let ranks: Vec<u32> = result.candidates.iter().map(|c| c.rank).collect();
        assert_eq!(ranks, [1, 2]);

        let first = &result.candidates[0];
        assert_eq!(first.depth, Some(11));
        assert_eq!(first.nodes, Some(1234));
        assert_eq!(first.time_ms, Some(980));
        assert_eq!(first.pv_line, ["7g7f", "3c3d", "2g2f"]);
        assert_eq!(first.first_move.as_deref(), Some("7g7f"));
        assert!(matches!(
            first.evaluation,
            Some(Evaluation {
                value: 85,
                kind: EvaluationKind::Centipawn
            })
        ));

        let second = &result.candidates[1];
        assert_eq!(second.depth, Some(12));
        assert!(matches!(
            second.evaluation,
            Some(Evaluation {
                value: -3,
                kind: EvaluationKind::MateInMoves(-3)
            })
        ));

        assert_eq!(depth_of_rank(&result, 1), Some(11));
        assert_eq!(depth_of_rank(&result, 2), Some(12));
        assert_eq!(depth_of_rank(&result, 3), None);
    }

    /// 手数の分からない詰みは符号だけを持つ
    #[test]
    fn a_mate_without_a_distance_keeps_only_its_sign() {
        let mut result = AnalysisResult::default();
        apply_info_params(&info("info score mate - pv 8h2b+"), &mut result);
        assert!(matches!(
            result.candidates[0].evaluation,
            Some(Evaluation {
                value: -1,
                kind: EvaluationKind::MateUnknown(false)
            })
        ));
    }

    /// ログの要約に局面と、webview から来た長い名前を素で載せない
    #[test]
    fn a_command_summary_hides_the_position_and_bounds_the_name() {
        let sfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
        let position = cmd_summary(&GuiCommand::Position(sfen.to_string()));
        assert!(
            !position.contains("lnsgkgsnl"),
            "局面が載っている: {position}"
        );

        let name = "N".repeat(MAX_SUMMARY_LEN * 4);
        let summary = cmd_summary(&GuiCommand::SetOption(name, Some("1".to_string())));
        assert!(
            summary.chars().count() <= MAX_SUMMARY_LEN + "SetOption(…)".chars().count(),
            "名前を切っていない: {} 文字",
            summary.chars().count()
        );
    }

    /// 閉じた枠は `reset` で閉じたまま数え直し、`set_interval` で間隔だけが変わる。
    /// 間隔は起動直後の例外（型の doc）に当たらない長さにする
    #[test]
    fn a_throttle_closes_on_reset_and_takes_a_new_interval() {
        let mut throttle = LogThrottle::new(Duration::from_secs(60));
        assert!(throttle.is_open());
        throttle.reset();
        assert!(!throttle.is_open(), "reset の後も空いている");
        assert!(!throttle.allow());

        throttle.set_interval(Duration::ZERO);
        assert!(throttle.allow(), "間隔を差し替えても通らない");
    }
}

/// ログの1行に載せる要約の上限（文字数）。
///
/// `setoption` の名前は webview から来て、`MAX_WIRE_FIELD`（8KB）までは通る。素で載せると
/// `write: failed cmd=…` の1行が8KBになる。利用者がエンジンのパスを直そうとして「開始」を
/// 繰り返すと、ログが一周して、直そうとしている当のエラーの説明が消える。
///
/// エンジンの名乗り（`id name`）も同じ上限で切る（`engine::registry` の `spawn_ok_line`）。
/// そちらも `collect_engine_info` が長さを見ずに保持する。
///
/// **この上限を `LOG_FILE_BUDGET` と並べて表明しているテストが赤くなったら、どれも一次で乗っている。**
/// 「関係の無いラチェット」と読まないこと。縛っている式の数はここに書かない（式が増えるたびに
/// この行だけが古くなる）。測り方は経路ごとに違う（掃き出しは `PENDING_LIMIT` 件ぶん、起動と停止は
/// 1行ぶん）。どちらも上限の不等式なので、縮める側は止まらない。
///
/// 実在する option 名（`USI_Hash` / `EvalDir` / `Threads`）はこの1/4も使わないが、縮める根拠には
/// ならない。実在するエンジンの名乗り（`YaneuraOu NNUE 7.0.0 64ZEN2`）が収まる幅でもある。
/// 縮めるならそちらを測ること。
pub const MAX_SUMMARY_LEN: usize = 64;

/// ログファイル1本ぶんの予算（バイト。`lib.rs` の `max_file_size`）。`KeepOne` なので、一周すると前の記録は消える。
///
/// これを根拠に決めた値が3つある。3つとも式で縛ってあるので、ここを動かすと落ちる。
///
/// - 断りの行をどれだけ出してよいか（`engine::commands::game` の `MAX_TRACKED_GAMES`）
/// - 終局の説明の長さ（`engine::game::session` の `MAX_DETAIL_LEN`）
/// - ログの1行に載せる要約の長さ（`MAX_SUMMARY_LEN`）
///
/// 根拠は別だが、予算にも乗っている値が2つある。
///
/// - `GameId` の `MAX_ID_BYTES`（根拠は「本物の UUID が収まる」）。断りの1行は同じ ID を2回載せるので、
///   `the_log_keeps_a_minimum_of_history_under_rejections` の式に一次で乗る。動かすときは、`Display` が
///   上限まで埋まることを留める等式（`a_game_id_in_text_is_bounded_and_has_no_control_characters`）も見る
/// - `engine::registry` の `MAX_PATH_IN_LOG_LEN`（根拠は「実運用のパスが読める」）。上は
///   `the_registry_lines_cannot_rotate_the_log_or_forge_a_line` が止める
///
/// どちらが赤くなっても「関係の無いラチェット」と読まないこと。
///
/// `MAX_USI_MOVE_BYTES` はここから来ていない。根拠は「一番長い指し手が収まる」で、断り文句は
/// この上限を通った後の値しか載せない。
///
/// **数字を離れた場所へ写さない。** 写すと、ここを動かしたときに逆算した側がまとめて静かに嘘になる。
/// 指すときはこの名前で指すこと。
pub const LOG_FILE_BUDGET: u128 = 200_000;

/// 同じ種類の1行を、`interval` に1度だけ通す枠
///
/// **新しく作った枠の先頭は通る。** 呼び出し側の絞りはこれを前提に組んである
/// （枠が無い＝その種類の1行がまだ出ていない、なので通す）。
///
/// 例外は起動直後だけ。`Instant` は単調時計でブートより前へ遡れないので、
/// 起動から `interval` 未満に作った枠は先頭が通らない。その間は
/// `is_open` も偽を返すので、上限のある写像から落とされもしない。
#[derive(Debug, Clone)]
pub struct LogThrottle {
    interval: Duration,
    last: Instant,
}

impl LogThrottle {
    /// 先頭が通る状態で作る（起動直後の例外は型の doc）
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: Instant::now()
                .checked_sub(interval)
                .unwrap_or_else(Instant::now),
        }
    }

    /// 通してよければ真を返し、枠を閉じる
    #[inline]
    pub fn allow(&mut self) -> bool {
        if self.last.elapsed() >= self.interval {
            self.last = Instant::now();
            true
        } else {
            false
        }
    }

    /// 枠が空いているか（次の `allow` が必ず通るか）。
    ///
    /// **空いた枠は何も覚えていない。** 捨てても失われる情報が無いので、
    /// 上限のある写像から落とす判断に使える。
    #[inline]
    pub fn is_open(&self) -> bool {
        self.last.elapsed() >= self.interval
    }

    /// 通さずに枠を閉じる。**通したことにしたくないが、間隔は数えたいとき**に使う
    #[inline]
    pub fn reset(&mut self) {
        self.last = Instant::now();
    }

    /// 間隔を差し替える。**閉じている枠はそのまま**（`last` を動かさない）
    #[inline]
    pub fn set_interval(&mut self, interval: Duration) {
        self.interval = interval;
    }
}

/// ログに載せる、送るコマンドの要約を返す。局面、探索の引数、`setoption` の値は載せない
pub fn cmd_summary(cmd: &GuiCommand) -> String {
    match cmd {
        GuiCommand::Position(_) => "Position(<redacted>)".to_string(),
        GuiCommand::Go(_) => "Go(...)".to_string(),
        // 名前は webview から来るので `MAX_SUMMARY_LEN` で切る。積み置きの掃き出しでは
        // `PENDING_LIMIT` 件まとめて出る
        GuiCommand::SetOption(name, _v) => {
            format!("SetOption({})", shown(name, MAX_SUMMARY_LEN))
        }
        GuiCommand::Usi => "Usi".to_string(),
        GuiCommand::IsReady => "IsReady".to_string(),
        GuiCommand::UsiNewGame => "UsiNewGame".to_string(),
        GuiCommand::Quit => "Quit".to_string(),
        // **`_ =>` を置かない。** 外来の文字列を運ぶ腕が `usi` に増えたとき、
        // catch-all があるとコンパイルが通ったまま生の値がログへ出る。
        // 書き切っておけば、上げた人が1つずつ数え直すことになる
        GuiCommand::GameOver(kind) => format!("GameOver({kind:?})"),
        GuiCommand::Ponderhit => "Ponderhit".to_string(),
        GuiCommand::Stop => "Stop".to_string(),
    }
}
