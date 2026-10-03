//! エンジンのオプションの**画面の名前**（日本語）と分類。純関数。
//!
//! やねうら王を標準にする（利用者の決定）。名前は「思考エンジンオプション」の説明に合わせた。
//! 辞書に無い名前は `None` で、画面はエンジンの綴りのまま出す。**送る側は使わない**——表示だけの辞書。
//!
//! 辞書を Rust に置くのは、画面（TS）が USI の名前を綴らない決まりのため（`src/__tests__/usiNamesStayInRust.test.ts`）。
//! 取得の結果（`ProbeOutcome::definitions`）に名前と分類を添えて渡す。

use crate::engine::types::{OptionGroup, UsiOptionDef};

/// （エンジンの名前, 画面の名前, 分類）
const LABELS: &[(&str, &str, Option<OptionGroup>)] = &[
    ("Threads", "スレッド数", None),
    ("USI_Hash", "ハッシュ（MB）", None),
    ("MultiPV", "候補手の数", None),
    ("NumaPolicy", "CPU のスレッド割り当て", None),
    ("USI_Ponder", "相手の手番でも考える", None),
    ("Stochastic_Ponder", "確率的ポンダー", None),
    ("DepthLimit", "探索の深さの上限", None),
    ("NodesLimit", "探索ノード数の上限", None),
    ("DebugLogFile", "デバッグログの書き出し先", None),
    ("DrawValueBlack", "引き分けの評価値（先手）", None),
    ("DrawValueWhite", "引き分けの評価値（後手）", None),
    ("MaxMovesToDraw", "引き分けにする手数", None),
    ("EnteringKingRule", "入玉ルール", None),
    ("GenerateAllLegalMoves", "すべての合法手を生成する", None),
    ("PvInterval", "読み筋を出す間隔（ms）", None),
    ("ConsiderationMode", "検討モード", None),
    ("OutputFailLHPV", "fail low/high の読み筋も出す", None),
    ("FV_SCALE", "評価値のスケール（NNUE）", None),
    ("EvalDir", "評価関数のフォルダ", None),
    ("EvalFile", "評価関数のファイル", None),
    ("ResignValue", "投了する評価値", Some(OptionGroup::Match)),
    ("NetworkDelay", "通信の遅延（ms）", Some(OptionGroup::Match)),
    (
        "NetworkDelay2",
        "秒読みの最大遅延（ms）",
        Some(OptionGroup::Match),
    ),
    (
        "MinimumThinkingTime",
        "最小思考時間（ms）",
        Some(OptionGroup::Match),
    ),
    ("SlowMover", "序盤重視率（%）", Some(OptionGroup::Match)),
    (
        "RoundUpToFullSecond",
        "秒のぎりぎりまで考える",
        Some(OptionGroup::Match),
    ),
    ("USI_OwnBook", "定跡を使う", Some(OptionGroup::Book)),
    ("BookFile", "定跡ファイル", Some(OptionGroup::Book)),
    ("BookDir", "定跡のフォルダ", Some(OptionGroup::Book)),
    ("BookMoves", "定跡を使う手数", Some(OptionGroup::Book)),
    (
        "BookIgnoreRate",
        "定跡を無視する確率（%）",
        Some(OptionGroup::Book),
    ),
    (
        "BookOnTheFly",
        "定跡をメモリに読み込まない",
        Some(OptionGroup::Book),
    ),
    (
        "BookEvalDiff",
        "定跡手の評価値の許容差",
        Some(OptionGroup::Book),
    ),
    (
        "BookEvalBlackLimit",
        "定跡手の評価値の下限（先手）",
        Some(OptionGroup::Book),
    ),
    (
        "BookEvalWhiteLimit",
        "定跡手の評価値の下限（後手）",
        Some(OptionGroup::Book),
    ),
    (
        "BookDepthLimit",
        "定跡手の深さの下限",
        Some(OptionGroup::Book),
    ),
    (
        "NarrowBook",
        "実現確率の低い定跡手を除く",
        Some(OptionGroup::Book),
    ),
    (
        "ConsiderBookMoveCount",
        "採択回数に比例して定跡手を選ぶ",
        Some(OptionGroup::Book),
    ),
    (
        "BookPvMoves",
        "定跡の読み筋の表示手数",
        Some(OptionGroup::Book),
    ),
    (
        "IgnoreBookPly",
        "定跡の手数の情報を無視する",
        Some(OptionGroup::Book),
    ),
    (
        "FlippedBook",
        "先後を反転した局面も定跡で引く",
        Some(OptionGroup::Book),
    ),
];

/// 定義に画面の名前と分類を添える。辞書に無い名前はそのまま（`label` も `group` も `None`）
pub fn describe(mut def: UsiOptionDef) -> UsiOptionDef {
    if let Some((_, label, group)) = LABELS.iter().find(|(name, _, _)| *name == def.name) {
        def.label = Some((*label).to_string());
        def.group = *group;
    }
    def
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::option_line::parse_option_line;
    use crate::engine::types::UsiOptionKind;

    const V900: &str = include_str!("../../tests/fixtures/usi/yaneuraou-v900.usi.txt");

    fn def(name: &str) -> UsiOptionDef {
        UsiOptionDef {
            name: name.to_string(),
            kind: UsiOptionKind::Button,
            label: None,
            group: None,
        }
    }

    /// 標準（やねうら王 V9.00）の申告は全部、日本語の名前を持つ。版を上げて名前が増えたら、ここが落ちて辞書に足す
    #[test]
    fn every_option_the_standard_engine_declares_has_a_label() {
        let missing: Vec<String> = V900
            .lines()
            .filter_map(|line| parse_option_line(line).ok())
            .map(|parsed| describe(UsiOptionDef::from(&parsed.option)))
            .filter(|d| d.label.is_none())
            .map(|d| d.name)
            .collect();
        assert!(missing.is_empty(), "辞書に無い: {missing:?}");
    }

    #[test]
    fn a_name_not_in_the_dictionary_keeps_no_label() {
        let described = describe(def("EvalShareMode"));
        assert_eq!(described.label, None);
        assert_eq!(described.group, None);
    }

    /// 定跡の項目は、定跡を使わないときに画面が隠す（分類が要る）
    #[test]
    fn book_settings_are_grouped_as_book() {
        for name in [
            "BookMoves",
            "NarrowBook",
            "FlippedBook",
            "ConsiderBookMoveCount",
        ] {
            assert_eq!(describe(def(name)).group, Some(OptionGroup::Book), "{name}");
        }
        assert_eq!(describe(def("Threads")).group, None);
    }

    #[test]
    fn each_name_appears_once() {
        let mut names: Vec<&str> = LABELS.iter().map(|(n, _, _)| *n).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(before, names.len(), "辞書に同じ名前が2回ある");
    }
}
