//! 名乗りの間に溜める `option` 行の宣言（表の (Q0, L2)）。

use crate::engine::logging::{shown, MAX_SUMMARY_LEN};
use crate::engine::option_line::{parse_option_line, MAX_DECLARED_BYTES, MAX_OPTIONS};
use crate::engine::types::EngineOption;

/// 読み取りが解いた `option` 行と、解けなかった行の記録。
///
/// **開いている間だけ溜める**（`begin` から、`usiok` の行を見た `close` か `finish` まで）。
/// 閉じた後の `option` 行（`usiok` の後も吐き続けるエンジン）は誰も取り出さないので、溜めずに捨てる
#[derive(Debug, Default)]
pub(super) struct DeclaredOptions {
    open: bool,
    pub(super) options: Vec<EngineOption>,
    /// 溜めた行の合計（バイト）。足すと `MAX_DECLARED_BYTES` を超える行は捨てる
    /// （その後の短い行は入りうる）
    bytes: usize,
    /// 解けなかった行の数。上限なしで数える
    rejected: usize,
    /// 解けなかった最初の行と理由。エンジンが書いた文字列を含むので、理由ごと `shown` を通す
    first_rejected: Option<String>,
    /// 定義の数（`MAX_OPTIONS`）か合計の大きさ（`MAX_DECLARED_BYTES`）を超えて捨てた行の数
    beyond_limit: usize,
    /// `combo` の選択肢の上限を超えて捨てた数
    dropped_vars: usize,
}

impl DeclaredOptions {
    pub(super) fn begin(&mut self) {
        *self = Self {
            open: true,
            ..Self::default()
        };
    }

    /// 生の1行を渡す。`option` 行を溜め、`usiok` の行で閉じる
    /// （後に続く `option` 行は `usi` への応答ではない）。判定はパーサの入口と同じで、
    /// 語の区切りにタブも含む
    pub(super) fn note(&mut self, raw: &str) {
        match raw.split_whitespace().next() {
            Some("option") => self.record(raw),
            Some("usiok") => self.close(),
            _ => {}
        }
    }

    /// 以後の行を溜めない。溜めたものは `finish` で取り出すまで残す
    fn close(&mut self) {
        self.open = false;
    }

    /// 溜めたものを取り出して閉じる
    pub(super) fn finish(&mut self) -> Self {
        std::mem::take(self)
    }

    fn record(&mut self, raw: &str) {
        if !self.open {
            return;
        }
        if self.options.len() >= MAX_OPTIONS || self.bytes + raw.len() > MAX_DECLARED_BYTES {
            self.beyond_limit += 1;
            return;
        }
        match parse_option_line(raw) {
            Ok(parsed) => {
                self.bytes += raw.len();
                self.dropped_vars += parsed.dropped_vars;
                self.options.push(parsed.option);
            }
            Err(e) => {
                if self.first_rejected.is_none() {
                    let reason = shown(&format!("{e}: {raw}"), MAX_SUMMARY_LEN * 2);
                    self.first_rejected = Some(reason);
                }
                self.rejected += 1;
            }
        }
    }

    /// 捨てたものがあれば、記録に残す1行を返す。**利用者の画面には、捨てた定義が黙って欠ける**ので、
    /// 開発者が気付ける手掛かりはここしか無い
    pub(super) fn problems(&self) -> Option<String> {
        if self.rejected == 0 && self.beyond_limit == 0 && self.dropped_vars == 0 {
            return None;
        }
        Some(format!(
            "usi: dropped option lines: {} unreadable, {} beyond the limits, {} combo values; first: {}",
            self.rejected,
            self.beyond_limit,
            self.dropped_vars,
            self.first_rejected.as_deref().unwrap_or("")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 閉じた後の `option` 行は溜めない（`usiok` の後も吐き続けるエンジン）
    #[test]
    fn declared_options_are_kept_only_while_open() {
        let mut declared = DeclaredOptions::default();
        declared.record("option name Before type check default true");
        declared.begin();
        declared.record("option name During type check default true");
        let taken = declared.finish();
        declared.record("option name After type check default true");

        let names: Vec<_> = taken.options.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, ["During"]);
        assert!(declared.options.is_empty(), "閉じた後も溜めている");
    }

    /// `usiok` の行で閉じた後は溜めない。溜めたものは `finish` まで残る。
    /// タブ区切りの `option` 行も拾う
    #[test]
    fn declared_options_stop_at_usiok() {
        let mut declared = DeclaredOptions::default();
        declared.begin();
        declared.note("id name X");
        declared.note("option\tname During type check default true");
        declared.note("usiok");
        declared.note("option name After type check default true");
        let names: Vec<_> = declared
            .finish()
            .options
            .into_iter()
            .map(|o| o.name)
            .collect();
        assert_eq!(names, ["During"]);
    }

    /// 予算に入らない長い行を捨てても、その後の短い行は入る
    #[test]
    fn a_line_beyond_the_byte_budget_is_dropped_but_later_short_ones_are_kept() {
        let mut declared = DeclaredOptions::default();
        declared.begin();
        declared.bytes = MAX_DECLARED_BYTES - 100;
        declared.record(&format!(
            "option name Long type string default {}",
            "a".repeat(200)
        ));
        declared.record("option name Short type check default true");
        assert_eq!(declared.beyond_limit, 1);
        let names: Vec<_> = declared.options.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, ["Short"]);
    }

    /// 上限を超えた行も、解けなかった行も数える。解けなかった行は上限なしで数える
    #[test]
    fn declared_options_count_what_they_drop() {
        let mut declared = DeclaredOptions::default();
        declared.begin();
        for i in 0..MAX_OPTIONS + 1 {
            declared.record(&format!("option name O{i} type check default true"));
        }
        for _ in 0..MAX_OPTIONS + 1 {
            declared.record("option name X type slider");
        }
        assert_eq!(declared.options.len(), MAX_OPTIONS);
        // 上限に達した後は、解けない行も上限の側で数える
        assert_eq!(declared.beyond_limit, MAX_OPTIONS + 2);

        let mut unreadable = DeclaredOptions::default();
        unreadable.begin();
        for _ in 0..MAX_OPTIONS + 1 {
            unreadable.record("option name X type slider");
        }
        assert_eq!(unreadable.rejected, MAX_OPTIONS + 1);
    }

    /// 解けなかった理由は、エンジンが書いた語ごと長さと制御文字を落として持つ
    #[test]
    fn a_rejected_line_is_kept_short_and_without_control_characters() {
        let mut declared = DeclaredOptions::default();
        declared.begin();
        declared.record(&format!(
            "option name X type \u{1b}]{}",
            "z".repeat(100_000)
        ));
        let first = declared.first_rejected.expect("理由が残っていない");
        assert!(
            first.chars().count() <= MAX_SUMMARY_LEN * 2 + 1,
            "{}",
            first.len()
        );
        assert!(!first.chars().any(char::is_control), "{first:?}");
    }
}
