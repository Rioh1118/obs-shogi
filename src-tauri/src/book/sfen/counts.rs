//! 盤と持駒に現れた駒を数え、**将棋に存在しない局面を弾く。**
//!
//! 壊れた局面を素通しすると、引いた結果が「定跡に載っていない」と
//! 見分けられなくなる（`lookup` は未収録も空を返す）。だから鍵にする前に数える。
//!
//! 数の上限は成駒を含めた合計で見る。玉だけは「片側に2枚以上」を別に見る ——
//! 玉が2枚ある局面は他のどの駒とも意味が違う。

/// 持駒の枚数を、検査を通さずに作れないようにするための囲い。
///
/// 内側のモジュールに入れるのは、タプル構造体のフィールドが**同じモジュールからは
/// 見える**ため。`normalize_hands` も `PieceCounts::add_many` も `sfen` の直下に
/// あるので、ここに置かないと `HandCount(raw)` と書けてしまい、型は何も止めない。
pub(super) mod hand_count {
    /// 持駒トークン1つぶんの枚数。
    ///
    /// [`HandCount::parse`] 以外から作れない。数え上げてから検査する形に
    /// 書き換えるとコンパイルが通らない。通ってしまうと、`"4294967295P"` の1回で
    /// 数え上げのループが 42.9 億回まわり、`to_book_key` を同期に呼んでいる
    /// async ワーカが埋まる。
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(in crate::book::sfen) struct HandCount(u32);

    impl HandCount {
        /// 1トークンの枚数は、最も多い歩でも18枚。桁あふれもここへ落とす。
        ///
        /// 先頭ゼロは拒否する。`parse` が無視するので、受け付けると同じ持駒を
        /// 好きなだけ長く書けてしまい、局面の文字列の長さに上限が無くなる。
        ///
        /// 枚数 `1` の明示（`1P`）は受け付ける。書き出す側は省くのが普通だが
        /// SFEN として正当で、読み手（tsshogi など）も受理する。長さは1駒あたり
        /// 2字で頭打ちなので、上限の根拠は崩れない。
        pub(in crate::book::sfen) fn parse(digits: &str) -> Result<Self, String> {
            if digits.len() > 1 && digits.starts_with('0') {
                return Err(format!("持駒の枚数に先頭ゼロがある（{digits}）"));
            }

            let count = if digits.is_empty() {
                1
            } else {
                digits.parse::<u32>().unwrap_or(u32::MAX)
            };

            if count == 0 || count > 18 {
                return Err(format!("持駒の枚数が範囲外（{digits}）"));
            }

            Ok(Self(count))
        }

        pub(in crate::book::sfen) fn get(self) -> u32 {
            self.0
        }
    }
}

use hand_count::HandCount;

/// 駒種と、40枚の駒箱に入っている数。玉は先後1枚ずつ。
///
/// 盤上と持駒を通して数え、この数を超えたら綴りが壊れていると判断する。
const PIECE_LIMITS: [(char, u32); 8] = [
    ('P', 18),
    ('L', 4),
    ('N', 4),
    ('S', 4),
    ('G', 4),
    ('B', 2),
    ('R', 2),
    ('K', 2),
];

/// 持駒になりうる駒を、キーに書く順で並べたもの。玉は持駒にならない。
///
/// 同じ持駒が別の綴りで来ると別のキーになるので、この順に畳んで書き直す。
///
/// **この並びは外部仕様に従属する。** ファイル上を二分探索する reader は、
/// ファイルに書かれた綴りとキーを直接比較するため、並びが定跡ファイルの
/// 持駒順とバイト単位で一致していなければ全ての lookup が空を返す。
///
/// 並びは USI の SFEN のもの。この repo が既に依存している `shogi_core` が
/// 同じ順で書き出すことを `the_key_matches_what_a_usi_implementation_writes`
/// が固定している。
// TODO(#291): 実物の定跡を fixture に置くとき、やねうら王が USI 標準どおりに
// 書いていることまで確かめる（並び自体はここで閉じている）。
pub(super) const HAND_PIECES: [char; 7] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

/// 駒種ごとの枚数。盤上と持駒を通して数える。
#[derive(Default)]
pub(super) struct PieceCounts {
    /// [先手, 後手] × PIECE_LIMITS
    by_side: [[u32; PIECE_LIMITS.len()]; 2],
}

impl PieceCounts {
    /// 大文字なら先手、小文字なら後手として1枚数える。成駒は元の駒種で数える。
    pub(super) fn add(&mut self, piece: char) -> Result<(), String> {
        let index = PIECE_LIMITS
            .iter()
            .position(|(kind, _)| *kind == piece.to_ascii_uppercase())
            .ok_or_else(|| format!("駒でない文字 {piece} がある"))?;

        let side = usize::from(piece.is_ascii_lowercase());
        self.by_side[side][index] += 1;
        Ok(())
    }

    pub(super) fn add_many(&mut self, piece: char, count: HandCount) -> Result<(), String> {
        for _ in 0..count.get() {
            self.add(piece)?;
        }
        Ok(())
    }

    /// 駒箱に入っている数を超えていないか見る。
    ///
    /// 超えている局面は将棋に存在しないので、どの定跡にも載っていない。
    /// 素通しすると、壊れた入力が「定跡に載っていない」と見分けが付かなくなる。
    pub(super) fn validate(&self) -> Result<(), String> {
        for (index, (kind, limit)) in PIECE_LIMITS.iter().enumerate() {
            let total = self.by_side[0][index] + self.by_side[1][index];
            if total > *limit {
                return Err(format!("{kind} が{total}枚ある（多くても{limit}枚）"));
            }

            // 玉だけは先後それぞれ1枚。合計2枚の検査では 0 対 2 を弾けない。
            if *kind == 'K' && (self.by_side[0][index] > 1 || self.by_side[1][index] > 1) {
                return Err("同じ側に玉が2枚以上ある".to_string());
            }
        }

        Ok(())
    }
}
