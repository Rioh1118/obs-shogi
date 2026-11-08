//! ログに載せる文字列の部品（伏字と切り詰め、原因の連鎖、送るコマンドの要約）と、ログの間引きと予算。
//!
//! 1行の要約の上限 `MAX_SUMMARY_LEN` はここが持ち、`LOG_FILE_BUDGET` と式で縛る。ほかの上限は
//! 呼び手が持ち、`shown` へ渡す。`protocol`、`registry`、`setup` のような下のレイヤからも呼ぶので、
//! `tests/layering.rs` のレイヤで他のレイヤを使わない位置に置く。

use std::time::{Duration, Instant};
use usi::GuiCommand;

/// 宛先へ流せなかったことを記録する最短間隔。
///
/// **1つに寄せる。** 解析と対局で別々に持つと、片方を動かしたときに
/// もう片方が古いまま残る。同じ判断（emit の失敗は洪水になるので絞る）なので、
/// 両方が使えるレイヤに置く。
pub const EMIT_WARN_INTERVAL: Duration = Duration::from_secs(5);

/// ログ・断り文句・棋譜に残る値に載せてよい写しを返す。制御文字を潰し、`max` 文字で切る。
///
/// 潰した結果はそのまま外へ出る。終局の説明（`GameResult::detail`）は、これを通した値が
/// `over` のイベントとスナップショットに載るので、改行を含む文言を渡すと利用者の目に置換文字が見える。
/// その断りは `endGameByRule` の TSDoc に書いてある。見えるのは、切ったことを示す記号と潰した制御文字の2つだけ。
/// 全角空白や結合文字まで潰すと、化けた理由を調べる手掛かりがどこにも残らない。
///
/// 潰すのは制御文字だけ。改行を通すと、その後ろに好きなログ行を作れる。
/// 潰した後は1文字あたり最大4バイト（UTF-8）で収まる。
///
/// `search/` は別の規約を持つ（`search::message::for_screen`）。あちらは改行を通し
/// （棋譜の引用を読める形で残すため）、上限を固定で持つ。同じ判断ではないので、片方だけ読んで
/// 揃えないこと。実装を1本に寄せるには `tests/layering.rs` の規則3（`engine/` は crate の
/// 他のモジュールを `use` しない）から動かすことになる。
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

/// ログの1行に載せる要約の上限（文字数）。
///
/// `setoption` の名前は webview から来て、`MAX_WIRE_FIELD`（8KB）までは通る。素で載せると
/// `write: failed cmd=…` の1行が8KBになる。利用者がエンジンのパスを直そうとして「開始」を
/// 繰り返すと、ログが一周して、直そうとしている当のエラーの説明が消える。
///
/// エンジンの名乗り（`id name`）も同じ上限で切る（`engine::registry` の `spawn_ok_line`）。
/// そちらも名乗り（`usi_machine.rs` の `finish_naming`）が長さを見ずに保持する。
///
/// **この上限を `LOG_FILE_BUDGET` と並べて表明しているテストが赤くなったら、どれも一次で乗っている。**
/// 「関係の無いラチェット」と読まないこと。縛っている式の数はここに書かない（式が増えるたびに
/// この行だけが古くなる）。測るのは1行ぶん（起動と停止）で、上限の不等式なので、縮める側は止まらない。
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

/// 同じ種類の1行を、`interval` に1度だけ通す throttle
///
/// **新しく作った throttle は先頭を通す。** 呼び出し側の絞りはこれを前提に組んである
/// （throttle が無い＝その種類の1行がまだ出ていない、なので通す）。
///
/// 例外は起動直後だけ。`Instant` は単調時計でブートより前へ遡れないので、
/// 起動から `interval` 未満に作った throttle は先頭を通さない。その間は
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

    /// 通してよければ真を返し、throttle を閉じる
    #[inline]
    pub fn allow(&mut self) -> bool {
        if self.last.elapsed() >= self.interval {
            self.last = Instant::now();
            true
        } else {
            false
        }
    }

    /// throttle が開いているか（次の `allow` が必ず通るか）。
    ///
    /// **開いた throttle は何も覚えていない。** 捨てても失われる情報が無いので、
    /// 上限のある写像から落とす判断に使える。
    #[inline]
    pub fn is_open(&self) -> bool {
        self.last.elapsed() >= self.interval
    }
}

/// ログに載せる、送るコマンドの要約を返す。局面、探索の引数、`setoption` の値は載せない
pub fn cmd_summary(cmd: &GuiCommand) -> String {
    match cmd {
        GuiCommand::Position(_) => "Position(<redacted>)".to_string(),
        GuiCommand::Go(_) => "Go(...)".to_string(),
        // 名前は webview から来るので `MAX_SUMMARY_LEN` で切る
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
