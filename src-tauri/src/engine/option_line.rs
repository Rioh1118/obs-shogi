//! USI の `option` 行を、エンジンのオプションの定義（`EngineOption`）に写す。
//!
//! **定義を作る口はここ1つ。** `usi` crate の解析（`OptionParams`）は使わない。
//! あちらは次の形を取り違える（どれも手元のやねうら王・zermelo の `usi` 応答にある形か、
//! その変種）:
//! - `combo` の `var` を1語ずつ積み、`var` という語そのものも選択肢に混ぜる
//! - `string` / `filename` の既定値を最初の1語で切る
//! - `default` の後が空の行（`option name EvalFile type string default `）の既定値を `None` にする。
//!   `default <empty>` と書いた行とで結果が割れる
//! - 名前に空白を含む行、型の綴りが大文字の行を解けない
//!
//! `EngineOptionType::Spin` の欄が `i32` なので、入らない値（`NodesLimit` の上限
//! `9223372036854775807` など）は `None` にする。

use crate::engine::types::{EngineOption, EngineOptionType};

/// 1本のエンジンから受け取る `option` の定義の数の上限。実機は数十（やねうら王 39）。
/// 取り違えたバイナリが `option` 行を吐き続けても、定義が際限なく伸びないように切る
pub const MAX_OPTIONS: usize = 512;

/// 1本のエンジンから受け取る定義の行の合計の上限（バイト）。数（`MAX_OPTIONS`）と
/// 1つの値の長さだけでは、長い行を上限の数だけ吐かれると桁で大きくなる
pub const MAX_DECLARED_BYTES: usize = 1024 * 1024;

/// 名前・1つの値の長さの上限（バイト）。これを超える行は解かない
pub const MAX_OPTION_VALUE: usize = 4 * 1024;

/// 1つの `combo` が持てる選択肢の数。これを超えた分は捨て、数を返す（`ParsedOption`）
pub const MAX_COMBO_VARS: usize = 256;

/// 型の綴り（小文字）。`type` の次の語がこのどれかなら、その `type` が型の欄
const TYPES: [&str; 6] = ["check", "spin", "combo", "button", "string", "filename"];

/// 型の綴りとして持つ語の長さ（文字）。エンジンが書いた語を理由に載せるので切る
const MAX_KIND_CHARS: usize = 32;

/// 解けなかった理由
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OptionLineError {
    /// `option` で始まっていない
    NotAnOptionLine,
    /// `option` の次が `name` でないか、名前が空（`name` の直後が型の欄の `type`、
    /// または `name` の後に何も無い）
    MissingName,
    /// `type` の語が無いか、`type` の次に語が無い
    MissingType,
    /// `type` の次の語が型の綴りでない。語はエンジンが書いたものなので、長さを切って持つ
    UnknownType(String),
    /// 名前か値が `MAX_OPTION_VALUE` を超える
    ValueTooLong,
}

impl std::fmt::Display for OptionLineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAnOptionLine => write!(f, "not an option line"),
            Self::MissingName => write!(f, "no name"),
            Self::MissingType => write!(f, "no `type`"),
            Self::UnknownType(kind) => write!(f, "unknown type `{kind}`"),
            Self::ValueTooLong => {
                write!(f, "a name or value is longer than {MAX_OPTION_VALUE} bytes")
            }
        }
    }
}

/// 解いた1行
#[derive(Debug, Clone)]
pub struct ParsedOption {
    pub option: EngineOption,
    /// `MAX_COMBO_VARS` を超えて捨てた選択肢の数
    pub dropped_vars: usize,
}

/// `spin` / `combo` / `check` / `button` の欄の区切りになる語。値の途中にこの語が1語として
/// 現れる場合は区切りと読む（USI の書式が値の中の空白を区切れないため）。
/// `string` / `filename` はこれらの欄を持たないので、既定値を区切らない（`raw_default`）
const KEYWORDS: [&str; 4] = ["default", "min", "max", "var"];

/// `option` 行を1本解く。
///
/// - 語の区切りは `char::is_whitespace` の連なり（タブや全角空白も含む）
/// - 名前は `name` の次から、型の欄の `type`（次の語が型の綴りであるもの）の直前まで。
///   空白入りの名前・`type` を含む名前も解ける（語の間は1つの空白で繋ぐ）
/// - `string` / `filename` の既定値は、`default` の後ろから行末までをそのまま取る
///   （末尾の空白だけは落とす。行末の `\r` や、書き手の見えない空白を値にしない）。
///   後ろが空か `<empty>` なら空文字、`default` が無ければ `None`
/// - 他の型の値は、次の区切りの語（`default` / `min` / `max` / `var`）の直前まで
/// - 型の綴りは大文字小文字を区別しない
pub fn parse_option_line(line: &str) -> Result<ParsedOption, OptionLineError> {
    let words = tokens(line);
    let word = |i: usize| words.get(i).map(|(_, w)| *w);
    if word(0) != Some("option") {
        return Err(OptionLineError::NotAnOptionLine);
    }
    if word(1) != Some("name") {
        return Err(OptionLineError::MissingName);
    }

    // 型の欄の `type` は、次の語が型の綴りであるもの。名前に `type` を含む行があるので、
    // 最初の `type` を型の欄と決めつけない
    let type_at = (3..words.len()).find(|&i| {
        word(i) == Some("type")
            && word(i + 1).is_some_and(|k| TYPES.contains(&k.to_ascii_lowercase().as_str()))
    });
    let Some(type_at) = type_at else {
        let is_kind =
            |i: usize| word(i).is_some_and(|k| TYPES.contains(&k.to_ascii_lowercase().as_str()));
        // `name` の直後が型の欄なら、型は正しく名前が空（`option name type spin`）
        if word(2) == Some("type") && is_kind(3) {
            return Err(OptionLineError::MissingName);
        }
        return Err(match (2..words.len()).find(|&i| word(i) == Some("type")) {
            Some(i) => match word(i + 1) {
                Some(kind) => {
                    OptionLineError::UnknownType(kind.chars().take(MAX_KIND_CHARS).collect())
                }
                None => OptionLineError::MissingType,
            },
            None if words.len() > 2 => OptionLineError::MissingType,
            None => OptionLineError::MissingName,
        });
    };
    let name = join_words(&words[2..type_at]);
    if name.len() > MAX_OPTION_VALUE {
        return Err(OptionLineError::ValueTooLong);
    }
    let kind = word(type_at + 1)
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let rest = &words[type_at + 2..];

    let (option_type, dropped_vars) = match kind.as_str() {
        "string" => (
            EngineOptionType::String {
                default: raw_default(line, rest)?,
            },
            0,
        ),
        "filename" => (
            EngineOptionType::Filename {
                default: raw_default(line, rest)?,
            },
            0,
        ),
        _ => {
            let fields = Fields::read(rest)?;
            let option_type = match kind.as_str() {
                "check" => EngineOptionType::Check {
                    default: fields.default.as_deref().and_then(parse_bool),
                },
                "spin" => EngineOptionType::Spin {
                    default: fields.default.as_deref().and_then(parse_i32),
                    min: fields.min.as_deref().and_then(parse_i32),
                    max: fields.max.as_deref().and_then(parse_i32),
                },
                "combo" => EngineOptionType::Combo {
                    default: fields.default.clone(),
                    vars: fields.vars.clone(),
                },
                // 残りは `TYPES` の `button` だけ（`type_at` の探し方がそれ以外を通さない）
                _ => EngineOptionType::Button {
                    default: fields.default.clone(),
                },
            };
            (option_type, fields.dropped_vars)
        }
    };

    let default_value = match &option_type {
        EngineOptionType::Check { default } => default.map(|b| b.to_string()),
        EngineOptionType::Spin { default, .. } => default.map(|n| n.to_string()),
        EngineOptionType::Combo { default, .. }
        | EngineOptionType::Button { default }
        | EngineOptionType::String { default }
        | EngineOptionType::Filename { default } => default.clone(),
    };

    Ok(ParsedOption {
        option: EngineOption {
            name,
            option_type,
            default_value,
            current_value: None,
        },
        dropped_vars,
    })
}

/// 空白の連なりで区切った語と、その語の元の行の中での位置（バイト）
fn tokens(line: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut start = None;
    for (i, c) in line.char_indices() {
        match (c.is_whitespace(), start) {
            (true, Some(s)) => {
                out.push((s, &line[s..i]));
                start = None;
            }
            (false, None) => start = Some(i),
            _ => {}
        }
    }
    if let Some(s) = start {
        out.push((s, &line[s..]));
    }
    out
}

fn join_words(words: &[(usize, &str)]) -> String {
    words.iter().map(|(_, w)| *w).collect::<Vec<_>>().join(" ")
}

/// `string` / `filename` の既定値。`default` の語の後ろの空白を1つだけ落とし、
/// 行末までをそのまま取る（値の中の連続した空白やタブを潰さない。末尾の空白は落とす）
fn raw_default(line: &str, rest: &[(usize, &str)]) -> Result<Option<String>, OptionLineError> {
    let Some((at, word)) = rest.iter().find(|(_, w)| *w == "default") else {
        return Ok(None);
    };
    let after = &line[at + word.len()..];
    let mut chars = after.chars();
    let value = match chars.next() {
        Some(c) if c.is_whitespace() => chars.as_str(),
        _ => after,
    };
    let value = value.trim_end();
    if value.len() > MAX_OPTION_VALUE {
        return Err(OptionLineError::ValueTooLong);
    }
    Ok(Some(unescape_empty(value.to_string())))
}

/// `type` の後ろの欄（`string` / `filename` 以外）
#[derive(Default)]
struct Fields {
    default: Option<String>,
    min: Option<String>,
    max: Option<String>,
    vars: Vec<String>,
    dropped_vars: usize,
}

impl Fields {
    fn read(words: &[(usize, &str)]) -> Result<Self, OptionLineError> {
        let mut fields = Fields::default();
        let mut i = 0;
        while i < words.len() {
            let key = words[i].1;
            let start = i + 1;
            let mut end = start;
            while end < words.len() && !KEYWORDS.contains(&words[end].1) {
                end += 1;
            }
            let value = join_words(&words[start..end]);
            if value.len() > MAX_OPTION_VALUE {
                return Err(OptionLineError::ValueTooLong);
            }
            match key {
                "default" => fields.default = Some(unescape_empty(value)),
                "min" => fields.min = Some(value),
                "max" => fields.max = Some(value),
                "var" if fields.vars.len() < MAX_COMBO_VARS => fields.vars.push(value),
                "var" => fields.dropped_vars += 1,
                // 知らない語から始まる欄は捨てる
                _ => {}
            }
            i = end;
        }
        Ok(fields)
    }
}

/// USI は空の既定値を `<empty>` と書くことを勧めている
fn unescape_empty(value: String) -> String {
    if value == "<empty>" {
        String::new()
    } else {
        value
    }
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn parse_i32(value: &str) -> Option<i32> {
    value.parse::<i32>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const V830: &str = include_str!("../../tests/fixtures/usi/yaneuraou-v830.usi.txt");
    const V900: &str = include_str!("../../tests/fixtures/usi/yaneuraou-v900.usi.txt");
    const ZERMELO: &str = include_str!("../../tests/fixtures/usi/zermelo.usi.txt");

    fn parse(line: &str) -> EngineOption {
        parse_option_line(line)
            .unwrap_or_else(|e| panic!("{e}: {line}"))
            .option
    }

    fn options(usi: &str) -> Vec<EngineOption> {
        usi.lines()
            .filter(|line| line.starts_with("option"))
            .map(parse)
            .collect()
    }

    fn find<'a>(options: &'a [EngineOption], name: &str) -> &'a EngineOption {
        options
            .iter()
            .find(|o| o.name == name)
            .unwrap_or_else(|| panic!("{name} が無い"))
    }

    /// 実機の応答の option 行を1本も落とさずに解ける
    #[test]
    fn every_option_line_of_real_engines_parses() {
        assert_eq!(options(V830).len(), 38);
        assert_eq!(options(V900).len(), 39);
        assert_eq!(options(ZERMELO).len(), 15);
    }

    /// `combo` の選択肢に `var` という語を混ぜない
    #[test]
    fn combo_vars_are_the_values_between_var_words() {
        let options = options(V900);
        let EngineOptionType::Combo { default, vars } = &find(&options, "BookFile").option_type
        else {
            panic!("combo として読めていない");
        };
        assert_eq!(default.as_deref(), Some("standard_book.db"));
        assert_eq!(vars.len(), 10);
        assert_eq!(vars.first().map(String::as_str), Some("no_book"));
        assert!(vars.iter().all(|v| v != "var"), "{vars:?}");
    }

    /// `default` の後が空の行（実機にある）と `<empty>` は、どちらも空文字。
    /// `default` の語が無い行は `None`（既定値を宣言していない）
    #[test]
    fn an_empty_default_is_an_empty_string_and_a_missing_one_is_none() {
        let zermelo = options(ZERMELO);
        assert_eq!(
            find(&zermelo, "EvalFile").default_value.as_deref(),
            Some("")
        );
        let v830 = options(V830);
        assert_eq!(
            find(&v830, "WriteDebugLog").default_value.as_deref(),
            Some("")
        );
        let v900 = options(V900);
        assert_eq!(
            find(&v900, "DebugLogFile").default_value.as_deref(),
            Some("")
        );
        assert_eq!(parse("option name X type string").default_value, None);
        assert_eq!(parse("option name X type filename").default_value, None);
    }

    /// i32 に入らない数は `None`。入る側の値は残る
    #[test]
    fn a_number_beyond_i32_is_none_and_the_rest_is_kept() {
        let options = options(V900);
        let EngineOptionType::Spin { default, min, max } = find(&options, "NodesLimit").option_type
        else {
            panic!("spin として読めていない");
        };
        assert_eq!((default, min, max), (Some(0), Some(0), None));
    }

    /// `string` / `filename` の既定値は行末までそのまま。区切りの語も連続した空白も潰さない
    #[test]
    fn string_defaults_are_taken_verbatim() {
        assert_eq!(
            parse("option name X type string default a min b")
                .default_value
                .as_deref(),
            Some("a min b")
        );
        assert_eq!(
            parse("option name EvalDir type filename default C:\\a  b\tc")
                .default_value
                .as_deref(),
            Some("C:\\a  b\tc")
        );
    }

    /// 名前の空白を繋ぐ。名前に `type` を含む行、タブ区切りの行も解ける
    #[test]
    fn names_keep_their_spaces_and_may_contain_type() {
        assert_eq!(
            parse("option name Book Path type string default a").name,
            "Book Path"
        );
        assert_eq!(parse("option name type type string").name, "type");
        assert_eq!(
            parse("option name My type Setting type spin default 1").name,
            "My type Setting"
        );
        let tabbed = parse("option\tname Tab\ttype check default true");
        assert_eq!(tabbed.name, "Tab");
        assert_eq!(tabbed.default_value.as_deref(), Some("true"));
    }

    #[test]
    fn check_and_type_spelling() {
        let option = parse("option name USI_Ponder type Check default TRUE");
        assert!(matches!(
            option.option_type,
            EngineOptionType::Check {
                default: Some(true)
            }
        ));
        let button = parse("option name Clear type button");
        assert!(matches!(
            button.option_type,
            EngineOptionType::Button { default: None }
        ));
    }

    #[test]
    fn broken_lines_are_rejected_with_the_reason() {
        let error = |line: &str| parse_option_line(line).unwrap_err();
        assert_eq!(error("id name X"), OptionLineError::NotAnOptionLine);
        assert_eq!(error("option type spin"), OptionLineError::MissingName);
        assert_eq!(error("option name"), OptionLineError::MissingName);
        // 型の綴りは正しく、名前が空。「知らない型」と言わない
        assert_eq!(
            error("option name type spin default 1"),
            OptionLineError::MissingName
        );
        assert_eq!(
            error("option name Threads spin"),
            OptionLineError::MissingType
        );
        assert_eq!(
            error("option name X type slider default 1"),
            OptionLineError::UnknownType("slider".to_string())
        );
        let long_value = format!(
            "option name X type string default {}",
            "a".repeat(MAX_OPTION_VALUE + 1)
        );
        assert_eq!(error(&long_value), OptionLineError::ValueTooLong);
        let long_name = format!(
            "option name {} type check",
            "a".repeat(MAX_OPTION_VALUE + 1)
        );
        assert_eq!(error(&long_name), OptionLineError::ValueTooLong);
    }

    /// 知らない型の語はエンジンが書いたものなので、長さを切って持つ
    #[test]
    fn an_unknown_type_word_is_cut() {
        let line = format!("option name X type {}", "z".repeat(10_000));
        let OptionLineError::UnknownType(kind) = parse_option_line(&line).unwrap_err() else {
            panic!("知らない型として断っていない");
        };
        assert_eq!(kind.chars().count(), MAX_KIND_CHARS);
    }

    #[test]
    fn combo_vars_are_capped_and_the_dropped_ones_counted() {
        let line = format!(
            "option name X type combo default a {}",
            (0..MAX_COMBO_VARS + 10)
                .map(|i| format!("var v{i}"))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let parsed = parse_option_line(&line).expect("解ける");
        let EngineOptionType::Combo { vars, .. } = parsed.option.option_type else {
            panic!("combo として読めていない");
        };
        assert_eq!(vars.len(), MAX_COMBO_VARS);
        assert_eq!(parsed.dropped_vars, 10);
    }
}
