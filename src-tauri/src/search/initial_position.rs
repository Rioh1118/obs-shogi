use thiserror::Error;

use shogi_core::PartialPosition;
use shogi_kifu_converter_obsshogi::{error::ConvertError, jkf::JsonKifuFormat};

pub type Jkf = JsonKifuFormat;

#[derive(Debug, Error)]
pub enum InitialPosError {
    #[error("cannot build the initial position: {0}")]
    Unbuildable(#[from] ConvertError),
}

/// JKF から開始局面を作る
///
/// 盤の組み立ては**クレートに任せる**。手合割の盤面はクレートが表で持っており
/// （`handicap.rs`）、パーサはそれに合う盤面を `{preset, data: None}` へ畳んで返す。
/// つまり手合割の棋譜はここへ `data` 無しで届くので、`data` のある形だけを
/// 自前で組むと**手合割の棋譜が丸ごと索引から漏れる**。
///
/// 盤の添字も持駒の並びも、こちらとクレートで二重に書けば黙ってずれる。
/// ずれると同じ棋譜から違う `PositionKey` が出て、検索が当たらなくなるだけで
/// エラーは出ない。書く場所を1つにしておく。
pub fn initial_partial_position(jkf: &Jkf) -> Result<PartialPosition, InitialPosError> {
    match &jkf.initial {
        None => Ok(PartialPosition::startpos()),
        Some(initial) => Ok(PartialPosition::try_from(initial)?),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shogi_kifu_converter_obsshogi::parser::parse_kif_str;

    const HANDICAPS: [&str; 15] = [
        "香落ち",
        "右香落ち",
        "角落ち",
        "飛車落ち",
        "飛香落ち",
        "二枚落ち",
        "三枚落ち",
        "四枚落ち",
        "五枚落ち",
        "左五枚落ち",
        "六枚落ち",
        "右七枚落ち",
        "左七枚落ち",
        "八枚落ち",
        "十枚落ち",
    ];

    /// 手合割つきは上手（後手）から指す。平手だけ先手からなので初手を分ける
    fn handicap_jkf(name: &str) -> Jkf {
        let first = if name == "平手" {
            "７六歩(77)"
        } else {
            "３四歩(33)"
        };
        parse_kif_str(&format!(
            "手合割：{name}\n\
             手数----指手---------消費時間--\n   \
             1 {first}   ( 0:01/00:00:01)\n"
        ))
        .expect("読めること")
    }

    /// 手合割の棋譜が索引に入る。
    ///
    /// パーサは手合割の盤面を `{preset, data: None}` に畳む（`normalize_initial`）。
    /// **手合割の棋譜はここへ `data` 無しで届くのが通常**で、例外ではない。
    /// 盤面を自前で組み直さず、クレートの表に任せる理由がこれ。
    #[test]
    fn every_handicap_yields_an_initial_position() {
        for name in HANDICAPS {
            let jkf = handicap_jkf(name);
            initial_partial_position(&jkf).unwrap_or_else(|e| panic!("{name}: {e}"));
        }
    }

    /// 手合割ごとに違う開始局面になる。
    ///
    /// 表を引き違えて全部が平手になっても、上のテストは通ってしまう。
    /// `PositionKey` は開始局面から作るので、**取り違えると別の棋譜が
    /// 同じ局面として索引に入る**。
    #[test]
    fn each_handicap_is_a_distinct_position() {
        let mut seen = std::collections::HashSet::new();
        for name in HANDICAPS {
            let pos = initial_partial_position(&handicap_jkf(name)).expect(name);
            assert!(
                seen.insert(pos.to_sfen_owned()),
                "{name} が他と同じ局面になった"
            );
        }
        let hirate = initial_partial_position(&handicap_jkf("平手")).expect("平手");
        assert!(
            !seen.contains(&hirate.to_sfen_owned()),
            "手合割が平手と同じ局面になった"
        );
    }
}
