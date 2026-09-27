//! 評価関数・定跡の流し先を、**その回のエンジンの申告**から決める段。純関数。
//!
//! 判定表は `docs/state-transitions/option-binding.md`。**実行ファイル名は見ない**——同じ名前を
//! 持つ別のエンジン、名前を変えたエンジンで食い違う。見るのは申告された `option` の名前と型だけ。
//!
//! 画面（TS）は USI の名前を組まない。選んだ評価関数・定跡のパスと利用者の値を渡すだけで、
//! どの名前で送るかはここが決める。**解析か対局かは知らない**——呼び手の方針（解析の固定値）は
//! 入力の `fixed` で受ける。

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::engine::types::{
    BookChoice, EngineOption, EngineOptionType, SetOptionValue, StartWarning,
};

/// 選んだ評価関数。ファイルかフォルダかは呼び手がディスクを見て決める（この段はディスクを見ない）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvalTarget {
    File(String),
    Dir(String),
}

/// 束縛の入力
#[derive(Debug, Clone, Default)]
pub struct BindingInput {
    /// 利用者の値（プリセットの `options`）
    pub values: Vec<SetOptionValue>,
    pub eval: Option<EvalTarget>,
    pub book: Option<BookChoice>,
    /// 呼び手の方針として決めた値（解析の `ConsiderationMode=true` など）。**申告にある名前だけ送る**
    pub fixed: Vec<SetOptionValue>,
}

/// 送る `setoption` の並びと、送らなかった・変えて送った設定
#[derive(Debug, Clone, Default)]
pub struct Bound {
    pub options: Vec<SetOptionValue>,
    pub warnings: Vec<StartWarning>,
}

/// 評価関数をファイルで受ける名前か、フォルダで受ける名前か
enum EvalShape {
    File,
    Dir,
}

/// 評価関数を受ける名前（判定表の E1〜E4）。**上から最初に当たったもの**
fn eval_option(declared: &[EngineOption]) -> Option<(&str, EvalShape)> {
    let is_dnn_model = |name: &str| {
        name.strip_prefix("DNN_Model")
            .is_some_and(|rest| rest.chars().all(|c| c.is_ascii_digit()))
    };
    if let Some(o) = declared.iter().find(|o| is_dnn_model(&o.name)) {
        return Some((&o.name, EvalShape::File));
    }
    for (name, shape) in [
        ("EvalFile", EvalShape::File),
        ("EvalDir", EvalShape::Dir),
        ("Eval_Dir", EvalShape::Dir),
    ] {
        if let Some(o) = declared.iter().find(|o| o.name == name) {
            return Some((&o.name, shape));
        }
    }
    None
}

fn parent_of(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn file_name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn set(name: &str, value: impl Into<String>) -> SetOptionValue {
    SetOptionValue {
        name: name.to_string(),
        value: value.into(),
    }
}

/// 評価関数の束縛（E1〜E5）。**選んでいなくても、受ける名前があれば警告**——エンジンは自分の
/// 既定（cwd からの相対）で探し、見つからなくても動くことがある
fn bind_eval(
    declared: &[EngineOption],
    eval: Option<&EvalTarget>,
    out: &mut Vec<SetOptionValue>,
    warnings: &mut Vec<StartWarning>,
) {
    let Some(eval) = eval else {
        if let Some((name, _)) = eval_option(declared) {
            warnings.push(StartWarning::EvalNotChosen {
                name: name.to_string(),
            });
        }
        return;
    };
    match (eval_option(declared), eval) {
        (None, _) => warnings.push(StartWarning::EvalNotSupported),
        (Some((name, EvalShape::File)), EvalTarget::File(path)) => out.push(set(name, path)),
        (Some((name, EvalShape::File)), EvalTarget::Dir(_)) => {
            warnings.push(StartWarning::EvalNeedsFile {
                name: name.to_string(),
            })
        }
        (Some((name, EvalShape::Dir)), EvalTarget::File(path)) => {
            out.push(set(name, parent_of(path)))
        }
        (Some((name, EvalShape::Dir)), EvalTarget::Dir(path)) => out.push(set(name, path)),
    }
}

/// 定跡を使うかを切り替える名前（判定表の B4）
fn own_book_option(declared: &[EngineOption]) -> Option<&str> {
    ["USI_OwnBook", "OwnBook"]
        .into_iter()
        .find(|name| declared.iter().any(|o| o.name == *name))
}

/// 定跡を切る（「使わない」と、送れなかった定跡）。切る口が無ければ警告
fn switch_book_off(
    declared: &[EngineOption],
    book_file: Option<&EngineOption>,
    out: &mut Vec<SetOptionValue>,
    warnings: &mut Vec<StartWarning>,
) {
    let mut switched = false;
    if let Some(name) = own_book_option(declared) {
        out.push(set(name, "false"));
        switched = true;
    }
    // 申告どおりの綴りで送る（`BookFile` と `Book_File` のどちらでも）
    if let Some(o) = book_file {
        if let EngineOptionType::Combo { vars, .. } = &o.option_type {
            if let Some(no_book) = vars.iter().find(|v| *v == "no_book") {
                out.push(set(&o.name, no_book.clone()));
                switched = true;
            }
        }
    }
    // 定跡を受ける名前はあるのに切る口が無い: エンジンは自分の既定の定跡で指しうる
    if !switched && book_file.is_some() {
        warnings.push(StartWarning::BookCannotBeDisabled);
    }
}

/// 定跡の束縛（B1〜B4 と「使わない」）。**送れなかった定跡は切る**——`USI_OwnBook=true` だけを
/// 送ると、エンジンは自分の既定の定跡（cwd からの `book/standard_book.db` など）で指す
fn bind_book(
    declared: &[EngineOption],
    book: Option<&BookChoice>,
    out: &mut Vec<SetOptionValue>,
    warnings: &mut Vec<StartWarning>,
) {
    let find = |name: &str| declared.iter().find(|o| o.name == name);
    let book_file = find("BookFile").or_else(|| find("Book_File"));

    let Some(book) = book.filter(|b| b.use_in_analysis) else {
        switch_book_off(declared, book_file, out, warnings);
        return;
    };

    let has_book_dir = find("BookDir").is_some();
    let sent = match book_file.map(|o| (o.name.as_str(), &o.option_type)) {
        // B1: 名前しか受けない。選択肢にある名前ならその綴りで送る（まず大小も一致するもの、
        // 無ければ大小を無視して）。無ければ送らない——絶対パスを送ると、選択肢に無い値として
        // 捨てて別の定跡に落ちるエンジンがある
        Some((name, EngineOptionType::Combo { vars, .. })) if has_book_dir => {
            let file = file_name_of(&book.path);
            let var = vars
                .iter()
                .find(|v| **v == file)
                .or_else(|| vars.iter().find(|v| v.eq_ignore_ascii_case(&file)));
            match var {
                Some(var) => {
                    out.push(set("BookDir", parent_of(&book.path)));
                    out.push(set(name, var.clone()));
                    true
                }
                None => {
                    warnings.push(StartWarning::BookNameNotInVars { file });
                    false
                }
            }
        }
        // B2: パスを受ける
        Some((name, EngineOptionType::String { .. } | EngineOptionType::Filename { .. })) => {
            out.push(set(name, book.path.clone()));
            true
        }
        // B3: B1・B2 に当たらない（`BookDir` の無い combo も）
        _ => {
            warnings.push(StartWarning::BookNotSupported);
            false
        }
    };
    if sent {
        if let Some(name) = own_book_option(declared) {
            out.push(set(name, "true"));
        }
    } else {
        switch_book_off(declared, book_file, out, warnings);
    }
}

/// **評価関数・定跡・固定値が持つ名前**（申告にあるものだけ、申告の順）。利用者の値としては送らない。
///
/// 評価関数を受ける名前（E1〜E4 で当たった1つ）と定跡を受ける名前（`BookFile` / `Book_File` /
/// `BookDir` / 切る口）は、**その回に送るかに依らず**持つ——評価関数・定跡を選んでいない回に
/// 利用者の値が通ると、欄で選んでいない評価関数・定跡でエンジンが動く。一覧は取得の結果
/// （`ProbeOutcome::reserved`）で画面にも渡る
pub fn reserved_names(declared: &[EngineOption], fixed: &[SetOptionValue]) -> Vec<String> {
    let eval = eval_option(declared).map(|(name, _)| name);
    declared
        .iter()
        .map(|o| o.name.as_str())
        .filter(|name| {
            Some(*name) == eval
                || ["BookFile", "Book_File", "BookDir", "USI_OwnBook", "OwnBook"].contains(name)
                || fixed.iter().any(|f| f.name == *name)
        })
        .map(str::to_string)
        .collect()
}

/// 利用者の値1件を、申告の型に合わせて送る形にする。送らないなら `None`（警告を積む）。
/// **起動は断らない**——型の合わない値を送るとエンジンが落ちる（`spin` に整数以外）ので送らない
fn user_value(
    option: &EngineOption,
    value: &str,
    warnings: &mut Vec<StartWarning>,
) -> Option<String> {
    let name = &option.name;
    let invalid = |warnings: &mut Vec<StartWarning>| {
        warnings.push(StartWarning::InvalidType {
            name: name.clone(),
            value: value.to_string(),
        });
        None
    };
    match &option.option_type {
        // `True` のような大小の揺れは受ける（手で編集したファイルで起きる）
        EngineOptionType::Check { .. } => match value.to_ascii_lowercase().as_str() {
            v @ ("true" | "false") => Some(v.to_string()),
            _ => invalid(warnings),
        },
        EngineOptionType::Spin { min, max, .. } => {
            let Ok(parsed) = value.trim().parse::<i64>() else {
                return invalid(warnings);
            };
            let lo = min.map_or(i64::MIN, i64::from);
            let hi = max.map_or(i64::MAX, i64::from);
            let clamped = parsed.clamp(lo.min(hi), hi.max(lo));
            if clamped != parsed {
                warnings.push(StartWarning::Clamped {
                    name: name.clone(),
                    value: clamped.to_string(),
                });
            }
            Some(clamped.to_string())
        }
        EngineOptionType::Combo { vars, .. } => {
            if vars.iter().any(|v| v == value) {
                Some(value.to_string())
            } else {
                warnings.push(StartWarning::NotInVars {
                    name: name.clone(),
                    value: value.to_string(),
                });
                None
            }
        }
        // 押すだけの口で、値を持たない
        EngineOptionType::Button { .. } => None,
        EngineOptionType::String { .. } | EngineOptionType::Filename { .. } => {
            Some(value.to_string())
        }
    }
}

/// 送る `setoption` を決める。判定表は `docs/state-transitions/option-binding.md`。
///
/// 順は「利用者の値（**申告の順**）→ 評価関数 → 定跡 → 固定値」。評価関数・定跡・固定値と
/// 同じ名前の利用者の値は送らない（そちらが勝つ）。評価関数・定跡を受ける名前の利用者の値は、
/// それらを送らなかった回も送らない（`reserved_names`）
pub fn bind(declared: &[EngineOption], input: &BindingInput) -> Bound {
    let mut warnings = Vec::new();
    let mut bound = Vec::new();
    bind_eval(declared, input.eval.as_ref(), &mut bound, &mut warnings);
    bind_book(declared, input.book.as_ref(), &mut bound, &mut warnings);
    for fixed in &input.fixed {
        if declared.iter().any(|o| o.name == fixed.name) {
            bound.push(fixed.clone());
        }
    }

    let reserved = reserved_names(declared, &input.fixed);
    let taken: HashSet<&str> = reserved.iter().map(String::as_str).collect();
    let values: HashMap<&str, &str> = input
        .values
        .iter()
        .map(|v| (v.name.as_str(), v.value.as_str()))
        .collect();

    let mut options = Vec::new();
    for option in declared {
        let Some(value) = values.get(option.name.as_str()) else {
            continue;
        };
        if taken.contains(option.name.as_str()) {
            warnings.push(StartWarning::OverriddenByBinding {
                name: option.name.clone(),
            });
            continue;
        }
        if let Some(value) = user_value(option, value, &mut warnings) {
            options.push(set(&option.name, value));
        }
    }
    let declared_names: HashSet<&str> = declared.iter().map(|o| o.name.as_str()).collect();
    for value in &input.values {
        if !declared_names.contains(value.name.as_str()) {
            warnings.push(StartWarning::NotDeclared {
                name: value.name.clone(),
            });
        }
    }

    options.extend(bound);
    Bound { options, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::option_line::parse_option_line;

    const V830: &str = include_str!("../../tests/fixtures/usi/yaneuraou-v830.usi.txt");
    const V900: &str = include_str!("../../tests/fixtures/usi/yaneuraou-v900.usi.txt");
    const ZERMELO: &str = include_str!("../../tests/fixtures/usi/zermelo.usi.txt");

    /// 申告を行から解く（`EngineOption` を組める口は `option_line` だけ。`tests/layering.rs`）
    fn declared(text: &str) -> Vec<EngineOption> {
        text.lines()
            .filter_map(|line| parse_option_line(line).ok())
            .map(|parsed| parsed.option)
            .collect()
    }

    fn one(line: &str) -> EngineOption {
        parse_option_line(line).expect("option 行").option
    }

    fn value(name: &str, value: &str) -> SetOptionValue {
        set(name, value)
    }

    fn sent(bound: &Bound) -> Vec<(String, String)> {
        bound
            .options
            .iter()
            .map(|o| (o.name.clone(), o.value.clone()))
            .collect()
    }

    fn lookup<'a>(bound: &'a Bound, name: &str) -> Option<&'a str> {
        bound
            .options
            .iter()
            .find(|o| o.name == name)
            .map(|o| o.value.as_str())
    }

    fn book(path: &str, use_in_analysis: bool) -> Option<BookChoice> {
        Some(BookChoice {
            path: path.to_string(),
            use_in_analysis,
        })
    }

    fn file(path: &str) -> Option<EvalTarget> {
        Some(EvalTarget::File(path.to_string()))
    }

    fn analysis_fixed() -> Vec<SetOptionValue> {
        vec![
            value("ConsiderationMode", "true"),
            value("USI_Ponder", "false"),
        ]
    }

    /// E3: やねうら王は評価関数をフォルダで受ける。ファイルを選んでいればその親、フォルダならそのまま
    #[test]
    fn yaneuraou_takes_the_eval_folder() {
        for (eval, expected) in [
            (file("/ai/suisho/eval/nn.bin"), "/ai/suisho/eval"),
            (
                Some(EvalTarget::Dir("/ai/suisho/eval".to_string())),
                "/ai/suisho/eval",
            ),
        ] {
            let input = BindingInput {
                eval,
                ..Default::default()
            };
            let bound = bind(&declared(V900), &input);
            assert_eq!(lookup(&bound, "EvalDir"), Some(expected));
            assert_eq!(lookup(&bound, "EvalFile"), None);
        }
    }

    /// E4: `Eval_Dir` も同じくフォルダ
    #[test]
    fn eval_dir_with_an_underscore_takes_the_folder() {
        let decl = vec![one("option name Eval_Dir type string default eval")];
        let input = BindingInput {
            eval: file("/e/nn.bin"),
            ..Default::default()
        };
        assert_eq!(
            sent(&bind(&decl, &input)),
            [("Eval_Dir".to_string(), "/e".to_string())]
        );
    }

    /// E2: zermelo は評価関数をファイルで受ける（`EvalDir` を申告しない）
    #[test]
    fn zermelo_takes_the_eval_file() {
        let input = BindingInput {
            eval: file("/ai/zermelo/eval/model.bin"),
            ..Default::default()
        };
        let bound = bind(&declared(ZERMELO), &input);
        assert_eq!(
            lookup(&bound, "EvalFile"),
            Some("/ai/zermelo/eval/model.bin")
        );
        assert_eq!(lookup(&bound, "EvalDir"), None);
    }

    /// E1 が E2 より先。`DNN_Model1` のような番号つきも E1
    #[test]
    fn a_dnn_model_wins_over_eval_file() {
        let decl = vec![
            one("option name EvalFile type string default x"),
            one("option name DNN_Model1 type string default model.onnx"),
        ];
        let input = BindingInput {
            eval: file("/m.onnx"),
            ..Default::default()
        };
        assert_eq!(
            sent(&bind(&decl, &input)),
            [("DNN_Model1".to_string(), "/m.onnx".to_string())]
        );
    }

    /// E1/E2 にフォルダは送らない。E5（受ける名前が無い）も送らない。どちらも警告
    #[test]
    fn an_eval_that_cannot_be_sent_is_a_warning() {
        let input = BindingInput {
            eval: Some(EvalTarget::Dir("/ai/zermelo/eval".to_string())),
            ..Default::default()
        };
        let bound = bind(&declared(ZERMELO), &input);
        assert_eq!(lookup(&bound, "EvalFile"), None);
        assert!(bound.warnings.contains(&StartWarning::EvalNeedsFile {
            name: "EvalFile".to_string()
        }));

        let bound = bind(
            &[one("option name Threads type spin default 1 min 1 max 8")],
            &BindingInput {
                eval: file("/nn.bin"),
                ..Default::default()
            },
        );
        assert_eq!(bound.warnings, [StartWarning::EvalNotSupported]);
    }

    /// 評価関数を受ける名前があるのに選んでいなければ警告（エンジンは自分の既定で探す）
    #[test]
    fn an_eval_not_chosen_is_a_warning_when_the_engine_takes_one() {
        let bound = bind(&declared(V900), &BindingInput::default());
        assert!(bound.warnings.contains(&StartWarning::EvalNotChosen {
            name: "EvalDir".to_string()
        }));
        let bound = bind(
            &[one("option name Threads type spin default 1 min 1 max 8")],
            &BindingInput::default(),
        );
        assert!(bound.warnings.is_empty(), "{:?}", bound.warnings);
    }

    /// B1: やねうら王の定跡は名前で受ける。選択肢にある名前は BookDir と名前で送る
    #[test]
    fn a_book_name_in_the_vars_goes_by_name() {
        let input = BindingInput {
            book: book("/ai/suisho/book/Standard_Book.db", true),
            ..Default::default()
        };
        let bound = bind(&declared(V900), &input);
        assert_eq!(lookup(&bound, "BookDir"), Some("/ai/suisho/book"));
        // 大小を無視して当て、送るのは選択肢の綴り
        assert_eq!(lookup(&bound, "BookFile"), Some("standard_book.db"));
        assert_eq!(lookup(&bound, "USI_OwnBook"), Some("true"));
    }

    /// B1: 大小まで一致する選択肢があればそちらを採る（大小を区別するファイルシステムで別のファイルを読ませない）
    #[test]
    fn an_exact_book_name_wins_over_a_case_insensitive_one() {
        let decl = vec![
            one("option name BookDir type string default book"),
            one("option name BookFile type combo default a.db var a.db var Book.db var book.db"),
        ];
        let input = BindingInput {
            book: book("/b/book.db", true),
            ..Default::default()
        };
        assert_eq!(lookup(&bind(&decl, &input), "BookFile"), Some("book.db"));
    }

    /// B1: 選択肢に無い名前は送らず、**定跡を切る**——`USI_OwnBook=true` だけを送ると、
    /// エンジンは自分の既定の定跡（`standard_book.db`）で指す
    #[test]
    fn a_book_name_outside_the_vars_is_not_sent_and_the_book_is_switched_off() {
        let input = BindingInput {
            book: book("/ai/suisho/book/my_book.db", true),
            ..Default::default()
        };
        let bound = bind(&declared(V900), &input);
        assert_eq!(lookup(&bound, "BookDir"), None);
        assert_eq!(lookup(&bound, "USI_OwnBook"), Some("false"));
        assert_eq!(lookup(&bound, "BookFile"), Some("no_book"));
        assert!(bound.warnings.contains(&StartWarning::BookNameNotInVars {
            file: "my_book.db".to_string()
        }));
    }

    /// B2: パスを受けるエンジンにはそのまま（`Book_File` / `filename` 型も）。B3: 受ける名前が
    /// 無ければ警告し、切る口があれば切る
    #[test]
    fn a_book_path_goes_to_a_path_option_or_is_switched_off() {
        for line in [
            "option name BookFile type string default book.db",
            "option name Book_File type filename default book.db",
        ] {
            let decl = vec![one(line)];
            let name = decl[0].name.clone();
            let input = BindingInput {
                book: book("/books/b.db", true),
                ..Default::default()
            };
            assert_eq!(
                sent(&bind(&decl, &input)),
                [(name, "/books/b.db".to_string())]
            );
        }

        let decl = vec![one("option name OwnBook type check default true")];
        let input = BindingInput {
            book: book("/books/b.db", true),
            ..Default::default()
        };
        let bound = bind(&decl, &input);
        assert!(bound.warnings.contains(&StartWarning::BookNotSupported));
        assert_eq!(lookup(&bound, "OwnBook"), Some("false"));
    }

    /// 定跡を解析で使わない: 切る口（`USI_OwnBook`）を切り、`no_book` があればそれを送る
    #[test]
    fn a_book_not_used_in_analysis_is_switched_off() {
        for choice in [book("/ai/b/standard_book.db", false), None] {
            let input = BindingInput {
                book: choice,
                ..Default::default()
            };
            let bound = bind(&declared(V900), &input);
            assert_eq!(lookup(&bound, "USI_OwnBook"), Some("false"));
            assert_eq!(lookup(&bound, "BookFile"), Some("no_book"));
            assert_eq!(lookup(&bound, "BookDir"), None);
        }
    }

    /// 切るときも申告どおりの綴りで送る。切る口が無ければ警告
    #[test]
    fn switching_off_uses_the_declared_name_or_warns() {
        let decl = vec![one(
            "option name Book_File type combo default a var a var no_book",
        )];
        let bound = bind(&decl, &BindingInput::default());
        assert_eq!(
            sent(&bound),
            [("Book_File".to_string(), "no_book".to_string())]
        );

        let decl = vec![one("option name BookFile type string default book.db")];
        let bound = bind(&decl, &BindingInput::default());
        assert!(bound.options.is_empty());
        assert_eq!(bound.warnings, [StartWarning::BookCannotBeDisabled]);
    }

    /// 固定値（呼び手の方針）は申告にあるときだけ
    #[test]
    fn fixed_values_are_sent_only_when_declared() {
        let input = BindingInput {
            fixed: analysis_fixed(),
            ..Default::default()
        };
        let bound = bind(&declared(V830), &input);
        assert_eq!(lookup(&bound, "ConsiderationMode"), Some("true"));
        assert_eq!(lookup(&bound, "USI_Ponder"), Some("false"));

        let bound = bind(&declared(ZERMELO), &input);
        assert_eq!(lookup(&bound, "ConsiderationMode"), None);
        assert_eq!(lookup(&bound, "USI_Ponder"), Some("false"));
    }

    /// 束縛と固定値は利用者の値に勝つ。定跡を受ける名前の利用者の値は、定跡を送らない回も送らない
    #[test]
    fn bindings_win_over_user_values() {
        let input = BindingInput {
            values: vec![
                value("USI_Ponder", "true"),
                value("EvalDir", "/stale"),
                value("BookFile", "yaneura_book1.db"),
                // 定跡を切る回は束縛しない名前。それでも定跡の選択で決めるので送らない
                value("BookDir", "/stale/book"),
            ],
            eval: file("/ai/e/nn.bin"),
            book: None,
            fixed: analysis_fixed(),
        };
        let bound = bind(&declared(V900), &input);
        assert_eq!(lookup(&bound, "USI_Ponder"), Some("false"));
        assert_eq!(lookup(&bound, "EvalDir"), Some("/ai/e"));
        assert_eq!(lookup(&bound, "BookFile"), Some("no_book"));
        assert_eq!(
            lookup(&bound, "BookDir"),
            None,
            "定跡を切る回に利用者の BookDir を送っている"
        );
        for name in ["EvalDir", "BookFile"] {
            assert_eq!(
                bound.options.iter().filter(|o| o.name == name).count(),
                1,
                "{name} を2回送っている"
            );
        }
        assert!(bound.warnings.contains(&StartWarning::OverriddenByBinding {
            name: "USI_Ponder".to_string()
        }));
    }

    /// 申告に無い名前は送らない。範囲外は丸め、選択肢の外は送らない。どれも警告
    #[test]
    fn user_values_are_fitted_to_the_declaration() {
        let decl = vec![
            one("option name Threads type spin default 1 min 1 max 8"),
            one("option name Mode type combo default a var a var b"),
        ];
        let input = BindingInput {
            values: vec![
                value("Threads", "64"),
                value("Mode", "c"),
                value("Unknown", "1"),
            ],
            ..Default::default()
        };
        let bound = bind(&decl, &input);
        assert_eq!(sent(&bound), [("Threads".to_string(), "8".to_string())]);
        assert!(bound.warnings.contains(&StartWarning::Clamped {
            name: "Threads".to_string(),
            value: "8".to_string()
        }));
        assert!(bound.warnings.contains(&StartWarning::NotInVars {
            name: "Mode".to_string(),
            value: "c".to_string()
        }));
        assert!(bound.warnings.contains(&StartWarning::NotDeclared {
            name: "Unknown".to_string()
        }));
    }

    /// 型の合わない値は**送らずに警告**（送るとエンジンが落ちる。起動は断らない）。
    /// `check` の大小の揺れは受ける
    #[test]
    fn a_value_of_the_wrong_type_is_not_sent() {
        let decl = vec![
            one("option name USI_Hash type spin default 256 min 1 max 1024"),
            one("option name Flag type check default false"),
            one("option name Other type check default false"),
        ];
        let input = BindingInput {
            values: vec![
                value("USI_Hash", "lots"),
                value("Flag", "yes"),
                value("Other", "True"),
            ],
            ..Default::default()
        };
        let bound = bind(&decl, &input);
        assert_eq!(sent(&bound), [("Other".to_string(), "true".to_string())]);
        for (name, bad) in [("USI_Hash", "lots"), ("Flag", "yes")] {
            assert!(bound.warnings.contains(&StartWarning::InvalidType {
                name: name.to_string(),
                value: bad.to_string()
            }));
        }
    }

    /// 押すだけの口（`button`）は利用者の値があっても送らない
    #[test]
    fn a_button_is_never_sent() {
        let decl = vec![one("option name Clear Hash type button")];
        let input = BindingInput {
            values: vec![value("Clear Hash", "1")],
            ..Default::default()
        };
        assert!(bind(&decl, &input).options.is_empty());
    }

    /// 順は「利用者の値（申告の順）→ 評価関数 → 定跡 → 固定値」。利用者の並べ方には依らない
    #[test]
    fn the_order_is_declaration_then_bindings_then_fixed() {
        let input = BindingInput {
            values: vec![value("MultiPV", "3"), value("Threads", "4")],
            eval: file("/ai/e/nn.bin"),
            book: book("/ai/b/standard_book.db", true),
            fixed: analysis_fixed(),
        };
        let bound = bind(&declared(V900), &input);
        let names: Vec<&str> = bound.options.iter().map(|o| o.name.as_str()).collect();
        let at = |n: &str| names.iter().position(|x| *x == n).expect(n);
        assert!(
            at("Threads") < at("MultiPV"),
            "申告の順になっていない: {names:?}"
        );
        assert!(at("MultiPV") < at("EvalDir"));
        assert!(at("EvalDir") < at("BookDir"));
        assert!(at("BookFile") < at("ConsiderationMode"));
    }

    /// 警告の種類が**宣言の綴りを camelCase にした形**で線に出ること。写しとの突き合わせは TS 側
    /// （`src/__tests__/startFailureKindWire.test.ts`）が宣言の綴りから引くので、その写像が本物の
    /// serde と一致していることをここで保証する。見本は宣言と数で突き合わせる
    #[test]
    fn every_start_warning_goes_on_the_wire_as_camel_case() {
        let n = || "x".to_string();
        let samples = [
            ("NotDeclared", StartWarning::NotDeclared { name: n() }),
            (
                "OverriddenByBinding",
                StartWarning::OverriddenByBinding { name: n() },
            ),
            (
                "Clamped",
                StartWarning::Clamped {
                    name: n(),
                    value: n(),
                },
            ),
            (
                "NotInVars",
                StartWarning::NotInVars {
                    name: n(),
                    value: n(),
                },
            ),
            ("EvalNotSupported", StartWarning::EvalNotSupported),
            ("EvalNeedsFile", StartWarning::EvalNeedsFile { name: n() }),
            ("BookNotSupported", StartWarning::BookNotSupported),
            (
                "BookNameNotInVars",
                StartWarning::BookNameNotInVars { file: n() },
            ),
            ("EvalNotChosen", StartWarning::EvalNotChosen { name: n() }),
            ("BookCannotBeDisabled", StartWarning::BookCannotBeDisabled),
            (
                "InvalidType",
                StartWarning::InvalidType {
                    name: n(),
                    value: n(),
                },
            ),
        ];
        let source = include_str!("types.rs");
        let body = source
            .split_once("pub enum StartWarning {")
            .expect("宣言が無い")
            .1;
        let declared: Vec<&str> = body
            .lines()
            .take_while(|line| *line != "}")
            .map(str::trim)
            .filter(|line| line.starts_with(char::is_uppercase))
            .filter_map(|line| line.split([' ', ',', '{']).next())
            .collect();
        assert_eq!(
            declared.len(),
            samples.len(),
            "見本に無い種類がある: {declared:?}"
        );
        for (name, warning) in &samples {
            assert!(declared.contains(name), "{name} が宣言に無い");
            let wire = serde_json::to_value(warning).expect("直列化できる");
            let mut chars = name.chars();
            let camel = chars
                .next()
                .map(|c| c.to_lowercase().collect::<String>() + chars.as_str())
                .unwrap_or_default();
            assert_eq!(wire["kind"], camel, "{name} の線の綴りが違う");
        }
    }

    /// 評価関数・定跡・固定値の名前を、申告にあるものだけ申告の順で挙げる。利用者が触る
    /// 一般の名前（`Threads`）は入らない
    #[test]
    fn reserved_names_are_what_the_fields_own() {
        let fixed = [
            value("ConsiderationMode", "true"),
            value("USI_Ponder", "false"),
        ];
        let reserved = reserved_names(&declared(V900), &fixed);

        for name in [
            "EvalDir",
            "BookDir",
            "BookFile",
            "USI_OwnBook",
            "ConsiderationMode",
        ] {
            assert!(
                reserved.iter().any(|r| r == name),
                "{name} が無い: {reserved:?}"
            );
        }
        assert!(!reserved.iter().any(|r| r == "Threads"), "{reserved:?}");
        let zermelo = reserved_names(&declared(ZERMELO), &[]);
        assert!(zermelo.iter().any(|r| r == "EvalFile"), "{zermelo:?}");
    }

    /// 評価関数を選んでいない回も、評価関数を受ける名前の利用者の値は送らない——
    /// 欄で選んでいない評価関数でエンジンが動く
    #[test]
    fn an_eval_value_is_not_sent_even_without_an_eval() {
        let bound = bind(
            &declared(ZERMELO),
            &BindingInput {
                values: vec![value("EvalFile", "/elsewhere/model.bin")],
                ..BindingInput::default()
            },
        );

        assert_eq!(lookup(&bound, "EvalFile"), None);
        assert!(bound.warnings.contains(&StartWarning::OverriddenByBinding {
            name: "EvalFile".to_string()
        }));
    }
}
