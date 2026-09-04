//! 局面を索引で引くための鍵。
//!
//! 手法は Zobrist ハッシュ。局面を「手番」「盤上の各駒」「各駒種の持駒枚数」に
//! ばらし、項ごとに決まった乱数を XOR で畳む。XOR は自分自身が逆演算なので、
//! **同じ項をもう一度 XOR すれば消える**。これが1手ぶんの差分更新を成り立たせる。
//!
//! **項を引くのは `zobrist.rs` の仕事。** こちらは畳むだけで、表の添字を知らない。
//!
//! 作り方は2つある。盤を丸ごと舐める [`key_from_partial_position`] と、
//! 1手ぶんだけ動かす [`advance_key`]。**両者は必ず同じ値を出さなければならない。**

use shogi_core::{Color, Move, PartialPosition, PieceKind, Square};

use super::zobrist::{self, ZobristValue};

/// 索引が局面を指すための鍵。**128ビットを `u64` 二本に割って持つ。**
///
/// `z` は Zobrist の z。`z0` が上位側で、[`bucket`](Self::bucket) はここから取る。
///
/// # なぜ二本に割るか
///
/// 索引の本体（`store/segment.rs` の `Segment`）が列ごとに `Vec<u64>` を持つ。
/// 二分探索が舐めるのは `z0` / `z1` の列だけなので、`u128` 一本では列に割れない。
///
/// # なぜ128ビット要るか
///
/// **衝突しても誰も気付かない。** 検索は鍵で引いた結果をそのまま hit にしていて、
/// 局面を作り直して照合する経路が無い（`search/query_service.rs`）。
/// 鍵がぶつかれば**別の局面の棋譜が黙って検索結果に混ざる**。
/// 幅を削るなら、先に照合を足すこと。
///
/// # 並び
///
/// **`z0` → `z1` の辞書順。** `derive` した `Ord` がその規約の唯一の持ち主で、
/// 索引を並べる側（`store/bucket.rs`）と探す側（`store/segment.rs` の二分探索）と
/// 束ねる側（`store/compaction.rs`）が全部これを通る。
///
/// **食い違うと二分探索が黙って外す** — 検索が0件になるか別の局面を返すかで、
/// エラーも警告も出ない。欄の宣言順を変えると並びが変わるので、
/// ディスクの索引が読めなくなる。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PositionKey {
    pub z0: u64,
    pub z1: u64,
}

impl PositionKey {
    /// XOR の単位元。何も畳んでいない状態で、ここから項を足していく。
    pub const ZERO: Self = Self { z0: 0, z1: 0 };

    /// この鍵が入る桶。
    ///
    /// `z0` の上位8ビットをそのまま使う。ハッシュの一部を索引の物理的な配置に
    /// 流用しているので、**戻りの型が桶の数を決めている**
    /// （`store/bucket.rs` の `BUCKET_COUNT`）。片方だけ動かすと索引が読めなくなる。
    #[inline]
    pub fn bucket(self) -> u8 {
        (self.z0 >> 56) as u8
    }

    /// 項を1つ畳む。**足すのも消すのも同じ操作。**
    #[inline]
    fn xor_assign(&mut self, rhs: ZobristValue) {
        self.z0 ^= rhs.z0;
        self.z1 ^= rhs.z1;
    }
}

/// 局面を丸ごと舐めて鍵を作る。
///
/// **読むのは手番・盤・持駒だけ。手数は入らない。** 手数の違う同じ局面は同じ鍵になる
/// — 索引が「この局面が現れる場所」を集めるものなので、それでよい。
///
/// 1手進めるだけなら [`advance_key`] の方が速い。こちらは初期局面と、
/// 差分が諦めたときの受け皿。
pub fn key_from_partial_position(pos: &PartialPosition) -> PositionKey {
    let mut key = PositionKey::ZERO;

    key.xor_assign(zobrist::side(pos.side_to_move()));

    for sq in Square::all() {
        if let Some(piece) = pos.piece_at(sq) {
            key.xor_assign(zobrist::piece_on_square(piece, sq));
        }
    }

    for color in [Color::Black, Color::White] {
        let hand = pos.hand_of_a_player(color);
        // **7種すべてを引く。0枚も1つの項。** 引かずに飛ばすと「0枚」と
        // 「表に無い」が同じ値になり、`advance_key` が 0 枚から1枚へ動かした
        // 差分と食い違う
        for kind in zobrist::hand_kinds() {
            let count = hand.count(*kind).unwrap_or(0) as usize;
            if let Some(v) = zobrist::hand_count(color, *kind, count) {
                key.xor_assign(v);
            }
        }
    }

    key
}

/// 1手ぶん進めた鍵を作る。**盤を舐め直さない。**
///
/// 鍵は XOR の積なので、変わった項だけ XOR し直せば
/// [`key_from_partial_position`] と同じ値になる。1手で変わるのは高々5つ。
///
/// | 指し手 | 変わる項 |
/// | --- | --- |
/// | `Normal` | 動いた駒を `from` から落とす / 置いた駒を `to` に入れる / 取った駒を `to` から落とす + 取った側の持駒を1つ増やす / 手番 |
/// | `Drop` | 打った駒を `to` に入れる / 打った側の持駒を1つ減らす / 手番 |
///
/// **`pos` は指す前の局面。** `make_move` を呼ぶ前に渡すこと。
///
/// # 読めない形は `None` を返す
///
/// `from` に駒がいない、成れない駒を成る、持駒が0枚なのに打つ、といった
/// `make_move` が `None` を返す形では、こちらも `None` を返して**呼び手を
/// フル計算へ落とす**。黙って違う鍵を作ると、**索引に入る値が静かに壊れる** —
/// 検索が当たらなくなるだけで、エラーも警告も出ない。
pub fn advance_key(key: PositionKey, pos: &PartialPosition, mv: Move) -> Option<PositionKey> {
    let mut key = key;

    // 手番。古い色を落として新しい色を入れる
    let mover = pos.side_to_move();
    key.xor_assign(zobrist::side(mover));
    key.xor_assign(zobrist::side(mover.flip()));

    match mv {
        Move::Normal { from, to, promote } => {
            let piece = pos.piece_at(from)?;
            if piece.color() != mover {
                return None;
            }
            let placed = if promote { piece.promote()? } else { piece };

            // 取った駒があれば、盤から落として持駒を1つ進める
            if let Some(taken) = pos.piece_at(to) {
                if taken.color() == mover {
                    return None;
                }
                key.xor_assign(zobrist::piece_on_square(taken, to));

                // 成駒は成る前の駒として持駒に入る（`make_move` と同じ）
                let kind = taken.piece_kind();
                let obtained = kind.unpromote().unwrap_or(kind);
                key.xor_assign(hand_step(pos, mover, obtained, 1)?);
            }

            key.xor_assign(zobrist::piece_on_square(piece, from));
            key.xor_assign(zobrist::piece_on_square(placed, to));
        }
        Move::Drop { piece, to } => {
            if piece.color() != mover {
                return None;
            }
            // 成駒は打てない（`make_move` が弾く）
            if piece.unpromote().is_some() {
                return None;
            }
            if pos.piece_at(to).is_some() {
                return None;
            }
            key.xor_assign(hand_step(pos, mover, piece.piece_kind(), -1)?);
            key.xor_assign(zobrist::piece_on_square(piece, to));
        }
    }

    Some(key)
}

/// 持駒の枚数が1つ動いたぶんの差分。**古い枚数を落として新しい枚数を入れる。**
///
/// 枚数そのものを鍵に持っているので、増減は「2つの項の入れ替え」になる。
#[inline]
fn hand_step(
    pos: &PartialPosition,
    color: Color,
    kind: PieceKind,
    delta: i8,
) -> Option<ZobristValue> {
    let before = pos.hand_of_a_player(color).count(kind)? as i16;

    // `shogi_core` の `Hand::added` は `wrapping_add` なので **255 の次は 0**。
    // 頭打ちで数えるこちらは 255 も 256 も同じ枠に落として差分を打ち消すので、
    // フル計算が `0` を採るのに差分は「変わらない」と答えて**鍵が食い違う**。
    // 枚数を検査する経路が無く（`jkf::Hand` の欄は `u8` なので `.jkf` が
    // `"KA":255` を名乗れる）、盤から来る値ではないので折り返しは実際に届く。
    // 諦めてフル計算に落とす — 呼び手はそのために `None` を見ている
    if before >= i16::from(u8::MAX) && delta > 0 {
        return None;
    }

    let after = before + i16::from(delta);
    if after < 0 {
        return None;
    }

    // 枠に落とすのは `hand_count` の中。ここで数え直さないので
    // フル計算とずれようがない。持駒に出ない駒種はそちらが `None` を返す
    let old = zobrist::hand_count(color, kind, before as usize)?;
    let new = zobrist::hand_count(color, kind, after as usize)?;
    Some(old.xor(new))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::position::position_apply::{apply_node_action, ApplyStatus, NodeAction};
    use shogi_kifu_converter_obsshogi::jkf::JsonKifuFormat;

    /// 棋譜を1本歩いて、差分とフル計算が**全ノードで一致する**ことを見る。
    ///
    /// 一致しないと、同じ棋譜から別の `PositionKey` が出る。索引の値が
    /// 静かに変わるだけなので、**検索が当たらなくなること以外に症状が無い**。
    fn walk_and_compare(label: &str, jkf: &JsonKifuFormat) -> usize {
        let mut pos = crate::search::position::initial_position::initial_partial_position(jkf)
            .unwrap_or_else(|e| panic!("{label}: 初期局面が作れない: {e}"));
        let mut key = key_from_partial_position(&pos);
        assert_eq!(key, key_from_partial_position(&pos), "{label}: 初期局面");

        let mut checked = 0usize;
        for (i, node) in jkf.moves.iter().enumerate().skip(1) {
            let Some(m) = node.move_ else {
                // special / None のノードは局面を動かさない
                continue;
            };
            let before = pos.clone();
            let action = NodeAction::Move(m);
            let Ok(ApplyStatus::Applied) = apply_node_action(&mut pos, action) else {
                break;
            };

            let mv = crate::search::position::position_apply::jkf_move_to_core_move(m)
                .unwrap_or_else(|e| panic!("{label}: {i}手目を core の手にできない: {e}"));
            let stepped = advance_key(key, &before, mv)
                .unwrap_or_else(|| panic!("{label}: {i}手目で差分が None を返した"));
            let full = key_from_partial_position(&pos);
            assert_eq!(stepped, full, "{label}: {i}手目で差分とフル計算がずれた");

            key = full;
            checked += 1;
        }
        checked
    }

    fn parse(text: &str) -> JsonKifuFormat {
        shogi_kifu_converter_obsshogi::parser::parse_kif_str(text).expect("題材の KIF が読めること")
    }

    /// 並びが `z0` → `z1` の辞書順である。
    ///
    /// **欄の宣言順がそのまま規約になっている**（`Ord` を derive しているため）。
    /// 入れ替えても他のテストは全部通る — 並べる側も探す側も同じ `Ord` を通るので、
    /// **両方が同時に反転して食い違わない**。
    ///
    /// 壊れるのはディスク側。`cache/index_cache.rs` の版番号は並びの規約に
    /// 紐付いていないので、順を変えた版が古いキャッシュを読んでも版検査は通る。
    /// **そこから先は `decode_all` の並びの検査が受ける**（項目が2つ以上ある桶なら
    /// 最初の逆転で `Err` になり、全件作り直しへ落ちる）。
    #[test]
    fn keys_order_by_z0_then_z1() {
        assert!(
            PositionKey { z0: 0, z1: 1 } < PositionKey { z0: 1, z1: 0 },
            "並びが (z0, z1) の辞書順でなくなった"
        );
        assert!(
            PositionKey { z0: 1, z1: 0 } < PositionKey { z0: 1, z1: 1 },
            "z0 が同じときに z1 で決まっていない"
        );
    }

    /// 決まった局面から、決まった鍵が出る。
    ///
    /// **この値はディスクの索引に書かれている。** 乱数表の種・作る順・添字の付け方・
    /// 持駒の枚数を枠へ落とす位置、どれが動いてもここが落ちる。落ちたときに
    /// 「テストの期待値が古い」と読んで書き換えると、**既にある索引が全部
    /// 別の局面を指すようになる**。書き換える前に、索引を作り直す算段を付けること。
    ///
    /// 平手と駒落ちを両方見るのは、盤だけの局面と持駒のある局面で
    /// 通る項が違うため。
    #[test]
    fn the_same_position_always_yields_the_same_key() {
        use test_support::kifu::one_move_kif;

        let hirate = key_from_partial_position(&PartialPosition::startpos());
        assert_eq!(
            (hirate.z0, hirate.z1),
            (0x32cc_4ccb_2c51_c541, 0x2049_872a_80d5_a95c),
            "平手の鍵が変わった"
        );

        let jkf = parse(&one_move_kif("二枚落ち"));
        let pos = crate::search::position::initial_position::initial_partial_position(&jkf)
            .expect("二枚落ちの初期局面が作れること");
        let nimai = key_from_partial_position(&pos);
        assert_eq!(
            (nimai.z0, nimai.z1),
            (0x3a35_afbb_1668_d8c5, 0x7958_2b7f_482f_4368),
            "二枚落ちの鍵が変わった"
        );
    }

    /// **一手ごとに**、決まった鍵が出る。
    ///
    /// 初期局面だけでは指し手の解釈を見ていない。JKF の手を `shogi_core` の手に
    /// する所（`position_apply::jkf_move_to_core_move`）が変わっても
    /// [`walk_and_compare`] は気付かない — 差分もフル計算も同じ変換を通るので、
    /// 誤っていれば両方が同じだけ誤る。**ここが唯一その外から見ている。**
    ///
    /// **最終局面だけでは足りない。** 3手目の成りは4手目に取られて消えるので、
    /// 成りを落としても7手目の局面は変わらない（`CAPTURE_PROMOTE_DROP_KIF` の doc）。
    #[test]
    fn every_move_always_yields_the_same_key() {
        let jkf = parse(test_support::kifu::CAPTURE_PROMOTE_DROP_KIF);
        let mut pos = crate::search::position::initial_position::initial_partial_position(&jkf)
            .expect("初期局面が作れること");

        let mut got = Vec::new();
        for node in jkf.moves.iter().skip(1) {
            let Some(m) = node.move_ else { continue };
            assert!(
                matches!(
                    apply_node_action(&mut pos, NodeAction::Move(m)),
                    Ok(ApplyStatus::Applied)
                ),
                "題材の手が指せない"
            );
            let k = key_from_partial_position(&pos);
            got.push((k.z0, k.z1));
        }

        assert_eq!(
            got,
            vec![
                (0x81f2_c215_dfa8_bc3a, 0xb8e1_e9ad_d6d2_6bb6),
                (0xe8c1_5903_ae81_863f, 0xc4d9_1aef_f082_e37d),
                (0x2eb1_41bd_f539_edb1, 0xa18f_3693_2163_8807),
                (0x08de_5e93_3e18_287d, 0xd6ee_1167_d628_2ff5),
                (0x78e4_52ce_7190_eebd, 0x8f2a_c1a6_2969_421b),
                (0xde97_7d5f_c8aa_5418, 0xc862_55cd_ab0a_db48),
                (0x4021_f0c9_0565_a4c0, 0xec7c_1f2d_d737_26b8),
            ],
            "手ごとの鍵が変わった"
        );
    }

    /// 手合割15種すべてで一致する。
    ///
    /// **初期局面が違えば持駒も盤も違う。** 平手だけで測ると、
    /// 落とした駒のぶんの項がずれても気付けない。
    #[test]
    fn every_handicap_steps_the_same_as_a_full_recompute() {
        use test_support::kifu::{one_move_kif, HANDICAPS};

        for h in HANDICAPS.iter().chain(std::iter::once(&"平手")) {
            let jkf = parse(&one_move_kif(h));
            assert!(walk_and_compare(h, &jkf) > 0, "{h}: 1手も見ていない");
        }
    }

    /// 1手で変わりうる項を全部通す。
    ///
    /// **取る / 成る / 打つ / 成駒を取る**は、それぞれ差分の別の腕を通る。
    /// どれかを落とすと、その形の棋譜だけが静かに別の鍵になる。
    #[test]
    fn capture_promotion_and_drop_all_step_the_same() {
        let jkf = parse(test_support::kifu::CAPTURE_PROMOTE_DROP_KIF);
        let n = walk_and_compare("capture-promote-drop", &jkf);
        assert!(n >= 5, "題材が短すぎる: {n}手しか見ていない");
    }

    /// 持駒が `u8` の上限にいるとき、差分は答えずにフル計算へ譲る。
    ///
    /// `shogi_core` の `Hand::added` は `wrapping_add` なので **255 の次は 0**。
    /// 頭打ちで数える差分は 255 も 256 も同じ枠に落として打ち消すので、
    /// 答えると**フル計算と違う鍵**になる。枚数を検査する経路は無く、
    /// `jkf::Hand` の欄は `u8` なので `.jkf` が `"KA":255` を名乗れる。
    ///
    /// **`walk_and_compare` では届かない。** あちらは KIF を読んで歩くので、
    /// 持駒が 255 枚になる局面を作れない。ここは `hand_step` を直に見る。
    #[test]
    fn a_hand_at_the_byte_limit_falls_back_to_a_full_recompute() {
        use shogi_core::{Color, Hand, PartialPosition, PieceKind};

        let mut pos = PartialPosition::startpos();

        // 上限の1つ下までは差分が答える。境界がずれたらここが落ちる
        let mut hand = Hand::default();
        for _ in 0..u8::MAX - 1 {
            hand = hand.added(PieceKind::Bishop).expect("持てること");
        }
        *pos.hand_of_a_player_mut(Color::Black) = hand;
        assert!(
            hand_step(&pos, Color::Black, PieceKind::Bishop, 1).is_some(),
            "上限の1つ下で差分が諦めた"
        );

        // 上限では諦める。答えると `wrapping_add` で 0 に戻る側とずれる
        let hand = hand.added(PieceKind::Bishop).expect("持てること");
        *pos.hand_of_a_player_mut(Color::Black) = hand;
        assert_eq!(
            hand.count(PieceKind::Bishop),
            Some(u8::MAX),
            "題材が上限に届いていない"
        );
        assert!(
            hand_step(&pos, Color::Black, PieceKind::Bishop, 1).is_none(),
            "上限で差分が答えてしまった"
        );

        // 減る側は折り返さないので、上限にいても答えてよい
        assert!(
            hand_step(&pos, Color::Black, PieceKind::Bishop, -1).is_some(),
            "減る側まで諦めた"
        );
    }
}
