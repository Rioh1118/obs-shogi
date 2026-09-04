//! 棋譜のバイト列を文字列にする。
//!
//! **この判断の持ち主はここだけ。** 拡張子は文字コードを名乗らないので、
//! 棋譜を読む経路は必ずどこかで「このバイト列を何として読むか」を決める。
//! その判断が2箇所にあると、同じファイルについて**索引と画面が違う文字列を見る**。
//!
//! 読む経路は2つある。
//!
//! | 経路 | 入口 | 使い道 |
//! | --- | --- | --- |
//! | 画面に開く | `workspace::record` の `read_text_portable` | webview に渡して `tsshogi` が読む |
//! | 索引を組む | `search::read::kifu_reader` の `read_portable` | Rust 側のクレートが読む |
//!
//! 索引側は**読めるまでパーサに掛ける**という強い手を持っている（どの復号なら
//! 棋譜として通るかで決められる）。画面側にパーサは無いので、そこまでは真似できない。
//! だから揃えられるのは**候補と順序**まで。ここが両者の唯一の持ち主になる。

use encoding_rs::{Encoding, EUC_JP, ISO_2022_JP, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};

/// 棋譜として試す文字コード。**上から順に試す。**
///
/// # なぜ EUC-JP が Shift_JIS より先か
///
/// **EUC-JP のほうが受ける範囲が狭いから。** 順を逆にすると、
/// EUC-JP の棋譜が Shift_JIS として**誤り無く**復号できてしまい、
/// 半角カナの羅列になったまま「読めた」ことになる（EUC-JP は 0xA1〜0xFE を、
/// Shift_JIS はそのうち 0xA1〜0xDF を半角カナに割り当てるため）。
///
/// 逆向きは起きにくい。Shift_JIS の第1バイトでよく出る 0x81〜0x9F は
/// EUC-JP の第1バイトとして不正なので、Shift_JIS の棋譜は EUC-JP の復号で
/// 誤りが出て落ちる。**狭いほうを先に試す**のはこの非対称のため。
///
/// UTF-16 を最後に置くのは、BOM が無ければ[`declared`](declared_encoding)が
/// 名乗らず、それでいてほとんどのバイト列が誤り無く復号できてしまうから。
/// 先に置くと何でも UTF-16 になる。
pub const KIFU_ENCODINGS: [&Encoding; 6] =
    [UTF_8, EUC_JP, SHIFT_JIS, ISO_2022_JP, UTF_16LE, UTF_16BE];

/// バイト列が名乗っている文字コード。分からなければ `None`。
///
/// **推測しない。そのバイト列にしか現れない印だけを見る。**
///
/// | 印 | 文字コード |
/// | --- | --- |
/// | BOM | UTF-8 / UTF-16LE / UTF-16BE |
/// | エスケープ `ESC $ B` | ISO-2022-JP |
///
/// # NUL の数や偏りで UTF-16 を当てにいかないこと
///
/// 素直に見えるが、どれも棋譜の中身の統計に依存していて反例がある。
///
/// | 規則 | 反例 |
/// | --- | --- |
/// | NUL が多いほうの番地でバイト順を決める | NUL が1バイト混じった Shift_JIS が UTF-16 になる |
/// | NUL が全体の 1/4 以上なら UTF-16 | 全角の多い KI2 が UTF-16 と認められない |
/// | 反対側の番地の NUL が 1/8 未満なら UTF-16 | `一` `　` は低位バイトが `0x00` なので反対側に NUL を置く。一段目へ指す KI2 が落ちる |
///
/// 当てられなくても**読めなくなるわけではない**（[`KIFU_ENCODINGS`] を順に試す）。
/// 効くのは読めなかったときの文言と、印がある側を優先することだけ。
/// 当てにいって嘘の文字コード名を出す側の害のほうが大きい。
pub fn declared_encoding(bytes: &[u8]) -> Option<&'static Encoding> {
    // BOM の並びは手で書かない。`encoding_rs` が同じ表を持っており、
    // 写すと片方だけ動かしたときに黙って食い違う
    if let Some((encoding, _)) = Encoding::for_bom(bytes) {
        return Some(encoding);
    }
    // 見るのは `ESC $ B`（JIS X 0208 へ切り替える）だけ。
    // `ESC ( B` / `ESC ( J` は ASCII へ戻す指示で、**ASCII のファイルにも現れうる**ので
    // ISO-2022-JP である証拠にならない。
    //
    // 7bit かどうかはここでは見ない。ISO-2022-JP は定義上 7bit なので、
    // 0x80 以上があれば**そのファイルが壊れている**（途中で切れた、別の文字コードが
    // 混ざった）。それは読めなかったときの案内の側の話になる。
    if bytes.windows(3).any(|w| w == b"\x1b$B") {
        return Some(ISO_2022_JP);
    }
    None
}

/// 誤り無く復号できた結果と、そのときの文字コード
pub struct Decoded {
    pub text: String,
    pub encoding: &'static Encoding,
}

/// 棋譜のバイト列を、**誤りの出ない文字コード**で復号する。
///
/// 印（BOM / エスケープ）があればそれを使い、無ければ [`KIFU_ENCODINGS`] を
/// 順に試して最初に誤り無く読めたものを採る。どれでも誤りが出れば `None`。
///
/// # `None` を「読めない」で終わらせてよい経路とそうでない経路がある
///
/// 画面に開く側はここで止めてよい。**止めずに化けた文字列を返すと、
/// `tsshogi` のインポータが `Error` ではなく0手の棋譜を返す**ので、
/// 利用者には「開いたが中身が無い」としか見えない。
///
/// 索引側はここで止まらない。誤りを落とす復号を最後に試し、
/// **棋譜として通るかどうか**で決める（`search::read::kifu_reader`）。
/// そちらのほうが読める範囲は広いが、広いぶんは
/// **画面で開けない棋譜が索引に入る**ことを意味するので、増やすときは
/// 画面側も一緒に見ること。
pub fn decode_kifu(bytes: &[u8]) -> Option<Decoded> {
    let ordered = declared_encoding(bytes)
        .into_iter()
        .chain(KIFU_ENCODINGS.iter().copied());

    for enc in ordered {
        let (text, _, had_errors) = enc.decode(bytes);
        if !had_errors {
            return Some(Decoded {
                text: text.into_owned(),
                encoding: enc,
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 棋譜1つを、各文字コードのバイト列にする
    fn encoded(text: &str, enc: &'static Encoding) -> Vec<u8> {
        enc.encode(text).0.into_owned()
    }

    /// **狭いほうを先に試す**ので、EUC-JP の棋譜が Shift_JIS に取られない。
    ///
    /// 順を逆にすると、EUC-JP の本文が Shift_JIS として誤り無く復号でき、
    /// 半角カナの羅列（`ｻｳﾅﾄﾂﾀﾏｺ` のような）になったまま「読めた」ことになる。
    /// 化けた文字列は `tsshogi` のインポータが**エラーにせず0手の棋譜**にするので、
    /// 利用者には「開いたが中身が無い」としか見えない。
    ///
    /// 逆向き（Shift_JIS が EUC-JP に取られる）が起きないことも同じ題材で見る。
    /// ここが崩れると、いま読めている Shift_JIS の棋譜が全部化ける。
    #[test]
    fn a_narrower_encoding_is_tried_first_so_neither_steals_the_other() {
        // **題材が曖昧でないと、順を入れ替えても通ってしまう。**
        // `山田太郎` は EUC-JP で全バイトが 0xA1〜0xDF に入るので、
        // Shift_JIS が半角カナとして誤り無く読み切る。`田中一郎` のような
        // 0xE0 以上を含む語を混ぜると Shift_JIS 側が落ちて、順序が効かなくなる
        let kifu = "V2.2\nN+山田太郎\nPI\n+\n+7776FU\n%TORYO\n";
        assert!(
            !SHIFT_JIS.decode(&encoded(kifu, EUC_JP)).2,
            "題材が曖昧でない。Shift_JIS が落ちるなら順序は試されていない"
        );

        for enc in [EUC_JP, SHIFT_JIS] {
            let bytes = encoded(kifu, enc);
            let decoded =
                decode_kifu(&bytes).unwrap_or_else(|| panic!("{} の棋譜が読めない", enc.name()));

            assert_eq!(
                decoded.text,
                kifu,
                "{} の棋譜が化けた（{} として読まれた）",
                enc.name(),
                decoded.encoding.name()
            );
        }
    }

    /// 印があれば、順序より印を採る。
    ///
    /// ISO-2022-JP は 7bit なので UTF-8 の復号が誤り無く通る。順に試すだけだと
    /// **UTF-8 が先に勝って、エスケープが本文に残ったまま**索引に入る。
    #[test]
    fn a_declared_encoding_wins_over_the_order() {
        let kifu = "先手：山田太郎\n手合割：平手\n";
        let bytes = encoded(kifu, ISO_2022_JP);

        let decoded = decode_kifu(&bytes).expect("ISO-2022-JP の棋譜が読めない");
        assert_eq!(decoded.encoding, ISO_2022_JP, "印を採っていない");
        assert_eq!(decoded.text, kifu, "本文が復元できていない");
    }

    /// どの候補でも誤りが出れば `None`。**化けた文字列を返さない。**
    ///
    /// 返してしまうと、画面側は「読めた」として webview に渡し、
    /// `tsshogi` が0手の棋譜にして、利用者にはエラーも出ない。
    #[test]
    fn bytes_that_decode_cleanly_as_nothing_are_refused() {
        // どの候補でも誤りが出る並び。UTF-8 として不正で、
        // EUC-JP / Shift_JIS の第1バイトとしても続きが揃わない
        let bytes = [0x81, 0xFF, 0xFE, 0x81, 0xFF];

        assert!(
            decode_kifu(&bytes).is_none(),
            "化けた文字列を「読めた」として返した"
        );
    }
}
