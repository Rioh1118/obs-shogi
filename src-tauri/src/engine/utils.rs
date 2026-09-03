use std::time::{Duration, Instant};
use usi::{GuiCommand, InfoParams, ScoreKind};

use crate::engine::types::{AnalysisCandidate, AnalysisResult, Evaluation, EvaluationKind};

/// `info` 行を解析結果へ畳み込む。
///
/// 解析と対局で同じ形の読み筋を出す。**2箇所で別々に組み立てない。**
/// 片方だけ直すと、同じエンジンの同じ出力が画面の場所によって違って見える。
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

pub fn get_depth_of_rank(result: &AnalysisResult, rank: u32) -> Option<u32> {
    result
        .candidates
        .iter()
        .find(|c| c.rank == rank)
        .and_then(|c| c.depth)
}

pub fn extract_rank(info_params: &[InfoParams]) -> u32 {
    for info in info_params {
        if let InfoParams::MultiPv(r) = info {
            return *r as u32;
        }
    }
    1
}

pub fn get_or_create_candidate(result: &mut AnalysisResult, rank: u32) -> &mut AnalysisCandidate {
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

pub fn map_score_to_evaluation(value: i32, kind: &ScoreKind) -> Evaluation {
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
            // usi crate 側の value が +1/-1 か 0/+0 かは実装依存になりがちなので、
            // 「0以上を+扱い」に寄せておくのが安全
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

/// ログ・断り文句・**棋譜に残る値**に載せてよい写し。
/// **制御文字を潰し、長さを切る。**
///
/// **潰した結果はそのまま外へ出る。** 終局の説明（`GameResult::detail`）は
/// これを通した値が `Over` イベントとスナップショットに載るので、
/// 改行を含む文言を渡すと利用者の目に置換文字が見える。
/// その断りは `endGameByRule` の TSDoc に書いてある。
/// **見えるのはここに書いた2つ（切った印と制御文字）だけ**——
/// 全角空白や結合文字まで潰すと、化けた理由を調べる手掛かりがどこにも残らない。
///
/// **潰すのは制御文字だけ。** 改行を通すと、その後ろに好きなログ行を作れる。
/// 潰した後は1文字あたり最大4バイト（UTF-8）で収まる。
///
/// **通した値を `{:?}` で書かないこと。** `{:?}` は制御文字のほかに
/// `Cf`（BOM）/ `Cn`（未割り当て）も `\u{XXXX}` へ展開するので、
/// 1文字が10バイトに膨らんで上の見積もりが外れる。
/// 潰してあるので `{}` で足りる。
///
/// **文字数で切る。** バイト数で切ると多バイト文字の途中で割れる。
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

/// ログの1行に載せる要約の上限（文字数）。
///
/// **`setoption` の名前は webview から来る。** `MAX_WIRE_FIELD`（8KB）までは
/// 通るので、素で載せると `write: failed cmd=…` の1行が8KBになる。
/// 利用者がエンジンのパスを直そうとして「開始」を繰り返すと、
/// **直そうとしている当のエラーの説明が消える**。
///
/// **掃き出しは32行まとめて出る**（`readyok` が来ないまま終わったとき）。
/// 1回の掃き出しがログの予算（`LOG_FILE_BUDGET`）の1/10を超えないところで取る。
/// 式は `engine::protocol` の `flushing_the_queue_cannot_rotate_the_log`。
///
/// 実在する option 名（`USI_Hash` / `EvalDir` / `Threads`）はこの1/4も使わない。
pub const MAX_SUMMARY_LEN: usize = 64;

/// ログファイル1本ぶんの予算。**`KeepOne` なので、一周すると前の記録は消える。**
///
/// **これを根拠に決めた値が3つある。** 断りの行をどれだけ出してよいか
/// （`engine::commands::game` の `MAX_TRACKED_GAMES`）、終局の説明の長さ
/// （`engine::game::session` の `MAX_DETAIL_LEN`）、ログの1行に載せる要約の長さ
/// （`MAX_SUMMARY_LEN`）。3つとも式で縛ってあるので、ここを動かすと落ちる。
///
/// **残る2つはここから来ていない。** `GameId` の `MAX_ID_BYTES` は
/// 「本物の UUID が収まる」、`MAX_USI_MOVE_LEN` は「一番長い指し手が収まる」が
/// 根拠。緩めても予算とは関係が無く、別の性質（静的写像の鍵の大きさ、
/// 指し手の形）が壊れる。
///
/// **数字を離れた場所へ写さない。** 写すと、ここを動かしたときに
/// 逆算した側がまとめて静かに嘘になる。指すときはこの名前で指すこと。
pub const LOG_FILE_BUDGET: u128 = 200_000;

/// 同じ種類の1行を、`interval` に1度だけ通す枠。
///
/// **新しく作った枠の先頭は通る。** 呼び出し側の絞りはこれを前提に組んである
/// （枠が無い＝その種類の1行がまだ出ていない、なので通す）。
///
/// **例外は起動直後だけ。** `Instant` は単調時計でブートより前へ遡れないので、
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

pub fn cmd_summary(cmd: &GuiCommand) -> String {
    match cmd {
        GuiCommand::Position(_) => "Position(<redacted>)".to_string(),
        GuiCommand::Go(_) => "Go(...)".to_string(),
        // **名前は webview から来る。** `MAX_WIRE_FIELD`（8KB）までは通るので、
        // 素で載せると1行8KBの `warn` になる。積み置きの掃き出しでは32行まとめて出る
        GuiCommand::SetOption(name, _v) => {
            format!("SetOption({})", shown(name, MAX_SUMMARY_LEN))
        }
        GuiCommand::Usi => "Usi".to_string(),
        GuiCommand::IsReady => "IsReady".to_string(),
        GuiCommand::UsiNewGame => "UsiNewGame".to_string(),
        GuiCommand::Quit => "Quit".to_string(),
        other => format!("{other:?}"), // それ以外はDebugでOK
    }
}
