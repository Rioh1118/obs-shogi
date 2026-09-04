use shogi_core::PartialPosition;
use shogi_kifu_converter_obsshogi::{
    error::ConvertError,
    jkf::{Initial, JsonKifuFormat, Preset},
};

pub type Jkf = JsonKifuFormat;

/// JKF から開始局面を作る
///
/// 盤の組み立ては **`shogi_kifu_converter_obsshogi` に任せる**。手合割の盤面は
/// あちらが表で持っており（`src/shogi_core/from.rs` — shogi_core へ変換する
/// コードを置いたモジュールで、`shogi_core` クレートのファイルではない）、
/// パーサはそれに合う盤面を `{preset, data: None}` へ畳んで返す。
/// つまり手合割の棋譜はここへ `data` 無しで届くので、`data` のある形だけを
/// 自前で組むと**手合割の棋譜が丸ごと索引から漏れる**。
///
/// 盤の添字も持駒の並びも、こちらと converter で二重に書けば黙ってずれる。
/// ずれると同じ棋譜から違う `PositionKey` が出て、検索が当たらなくなるだけで
/// エラーは出ない。書く場所を1つにしておく。
///
/// **`data` があればそちらを採る。** converter の `TryFrom` は `preset` を先に見て
/// `data` を読まないので、`{preset: HIRATE, data: 詰将棋の盤面}` を渡すと平手が返る。
/// KIF / KI2 / CSA のパーサは盤面があれば必ず `PresetOther` を付けるのでこの形は
/// 作らないが、`.jkf` は外部の JSON をそのまま信じている。盤面が書いてあるのに
/// 平手として索引に入れると、**その局面で検索しても当たらず、平手の検索結果に紛れる**。
///
/// **TS 側（tsshogi）は逆に `preset` を採り `data` を捨てる。** つまりこの形の `.jkf`
/// では、索引が指す局面と画面に出る局面が食い違う。どちらへ揃えるかは #330。
///
/// # Errors
///
/// [`ConvertError::InitialBoardNoDataWithPresetOTHER`] だけ。`preset` が `OTHER`
/// なのに `data` が無い JKF で起きる。
///
/// **盤の座標も持駒の枚数もここでは検査されない。** 座標は `data.board` の型が
/// `[[Piece; 9]; 9]` なので serde が先に弾く。持駒の枚数は `Hand::added` が
/// 黙って受けるので、**歩30枚の JKF はそのまま索引に入る**。
///
/// ここで失敗した棋譜の局面は検索に出てこない。索引の項目自体がどう残るかは
/// `read_to_jkf` の `# Errors` を見ること（呼び口で違う・#333）。
pub fn initial_partial_position(jkf: &Jkf) -> Result<PartialPosition, ConvertError> {
    let Some(initial) = &jkf.initial else {
        return Ok(PartialPosition::startpos());
    };

    let initial = match initial.data {
        Some(_) => &Initial {
            preset: Preset::PresetOther,
            data: initial.data,
        },
        None => initial,
    };

    PartialPosition::try_from(initial)
}

#[cfg(test)]
mod tests {
    use super::*;
    use shogi_kifu_converter_obsshogi::parser::{parse_jkf_str, parse_kif_str};
    use test_support::kifu::{one_move_kif, HANDICAPS};

    fn handicap_jkf(name: &str) -> Jkf {
        parse_kif_str(&one_move_kif(name)).expect("読めること")
    }

    /// 手合割の棋譜が索引に入る。
    ///
    /// パーサは手合割の盤面を `{preset, data: None}` に畳む（`normalize_initial`）。
    /// **手合割の棋譜はここへ `data` 無しで届くのが通常**で、例外ではない。
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

    /// 盤面が書いてあれば、`preset` が何であれ盤面を採る。
    ///
    /// converter の `TryFrom` は `preset` を先に見て `data` を読まない。
    /// `.jkf` は外部の JSON をそのまま信じているので、`{preset: HIRATE, data: 別盤面}`
    /// が届きうる。平手として索引に入れると、その局面で検索しても当たらず、
    /// 平手の検索結果に紛れる。
    #[test]
    fn a_board_wins_over_a_preset_that_disagrees_with_it() {
        // 玉2枚だけの盤面を preset HIRATE で名乗る JKF
        let json = r#"{"header":{},"initial":{"preset":"HIRATE","data":{"color":0,
          "board":[[{},{},{},{},{},{},{},{},{}],[{},{},{},{},{},{},{},{},{}],
                   [{},{},{},{},{},{},{},{},{}],[{},{},{},{},{},{},{},{},{}],
                   [{"color":1,"kind":"OU"},{},{},{},{"color":0,"kind":"OU"},{},{},{},{}],
                   [{},{},{},{},{},{},{},{},{}],[{},{},{},{},{},{},{},{},{}],
                   [{},{},{},{},{},{},{},{},{}],[{},{},{},{},{},{},{},{},{}]],
          "hands":[{"FU":0,"KY":0,"KE":0,"GI":0,"KI":0,"KA":0,"HI":0},
                   {"FU":0,"KY":0,"KE":0,"GI":0,"KI":0,"KA":0,"HI":0}]}},"moves":[{}]}"#;
        let jkf = parse_jkf_str(json).expect("読めること");

        let sfen = initial_partial_position(&jkf)
            .expect("開始局面")
            .to_sfen_owned();
        let hirate = initial_partial_position(&handicap_jkf("平手"))
            .expect("平手")
            .to_sfen_owned();

        assert_ne!(sfen, hirate, "盤面を捨てて平手にしている");
        // 玉2枚だけの盤面。JKF の board は board[筋-1][段-1] なので
        // 5一に後手玉、5五に先手玉が入る
        assert_eq!(sfen, "4k4/9/9/9/4K4/9/9/9/9 b - 1", "盤面が違う");
    }
}
