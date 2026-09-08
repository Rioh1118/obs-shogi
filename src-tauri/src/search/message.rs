//! 画面に出す文言を、組みながら刈る。
//!
//! **`search/` の中では刈る規約はこれ1つ。** 文言に値を埋める段は複数ある。
//! 棋譜を読む段と局面の綴りを読む段は**埋める値に長さの上限が無い**（棋譜クレートは
//! 行末まで引用し、綴りは空白区切りの1トークン）。索引を組む段と検索の段が埋めるのは
//! いまのところ有界な値だけだが、そちらも同じ口を通す —— **段ごとに上限を決めると、
//! 新しく埋める場所が増えたときに規約の外へ落ちる。**
//!
//! **通っていることを見るのは型**（[`ScreenMessage`]）。画面へ流す payload の欄を
//! その型にしてあるので、刈っていない `String` は載せられない。
//! 一覧を手で並べる走査だと、口が1つ増えた日にその口だけ見えなくなる。
//!
//! **`engine/` は別に持っている**（`engine::utils::shown`）。あちらは上限を引数で受け、
//! 制御文字を U+FFFD に潰し、改行も残さない。寄せられないのは `tests/layering.rs` の
//! 規則3（`engine/` は crate の他の枝を `use` しない）があるためで、
//! **2つ在るのは当面の既定状態**。挙動の差もそれぞれ理由がある（あちらはログの行を
//! 守る、こちらは棋譜の引用を読める形で残す）ので、片方に揃えるときは
//! 規則3から先に動かすこと。

use serde::Serialize;

/// `for_screen` を1回通る文言の上限。**案内も引用も同じ枠を食い合う**
/// （[`ScreenMessageSink`] は書かれた文字を区別せずに数える）ので、
/// 案内を長くしたぶんだけ引用の取り分が減る。
///
/// **上限の外に出るのは2つだけ。** [`ScreenMessage::followed_by`] が足す一文と、
/// 刈った印の省略記号1文字。`thiserror` の `#[error]` が前置する定型文も外だが、
/// その値をもう一度この口へ通す経路では結局この枠に入る。
///
/// **埋まる値のほうには上限が無い。** 棋譜クレートのエラーは読めなかった位置から
/// 行末までを引用するので、改行を含まない大きなファイル（`.kif` に改名した zip など）
/// ではファイルの中身がそのまま値になる。局面の綴りは空白区切りの1トークンなので、
/// これも長さが決まらない。
///
/// **出た先で刈られることは期待できない。** 出口は3つ——`IndexWarnPayload` と
/// `SearchErrorPayload` の欄、そして `open_project` の `Err`。**どれも型が
/// [`ScreenMessage`] を要求する**ので、刈っていない `String` は載せられない。
/// 画面側がどう描くかはそれぞれの doc が持つ。
pub(crate) const SCREEN_MESSAGE_LIMIT: usize = 300;

/// 画面へ出す形にする。[`SCREEN_MESSAGE_LIMIT`] 文字で刈り、**制御文字を空白に落とす。**
///
/// **すでに [`ScreenMessage`] になっている値を渡さない。** `followed_by` が上限の外で
/// 足した一文は、もう一度通すと真っ先に落ちる。`Display` 経由で渡せてしまうので
/// コンパイラは止めない（`#[error("{0}")]` が `Display` を要るので外せない）。
/// 合成した `String`（`unreadable_record` / `describe` の戻り値）を通すのは別で、
/// そちらは組んだ1本を刈るだけ。
///
/// **落とすほうも契約。** 生の NUL やエスケープを消すのはここだけで、
/// 呼び手（`SfenParseError` の doc）はそれを前提に「刈れば済むか / 済まないか」を
/// 決めている。改行は通す（[`ScreenMessageSink`] の本文に理由）。
///
/// **落ちるのは `Cc` だけ**（`char::is_control` の範囲）。U+2028 / U+2029 も
/// 双方向制御（U+202A–U+202E / U+2066–U+2069）も BOM も通る。`engine::utils::shown` が
/// 同じ判断について「産地が増えたら見直すこと」と書いていて、**こちらは既にその条件に
/// 当たっている**（棋譜ファイルと利用者の JSON が流れ込む）。#459。
///
/// **刈るのを組み上げた後まで遅らせない。** 遅らせると、刈る対象が先に
/// `String` として出来上がる。[`ScreenMessageSink`] は上限で書き手を止めるので、
/// ここで作るぶんは上限までしか確保されない。
///
/// **相手が既に `String` として持っているものは消せない。** 短くなるのは
/// ここで作る1本だけで、確保のピークは相手が決める。
pub(crate) fn for_screen(e: &dyn std::fmt::Display) -> ScreenMessage {
    use std::fmt::Write as _;
    let mut sink = ScreenMessageSink::default();
    let _ = write!(sink, "{e}");
    ScreenMessage(sink.finish())
}

/// 画面へ出してよい文言。**`for_screen` を通ったものしか作れない。**
///
/// `EVT_INDEX_WARN` / `EVT_SEARCH_ERROR` の欄をこの型にしてあるので、
/// **刈っていない `String` は載せられない**（載せようとするとコンパイルが通らない）。
/// 走査で「刈る口を通っているか」を見る必要が無いのはこのため。
///
/// **型が `pub` なのは payload の欄に出るから**（`pub` でない型を `pub` な欄に置くと
/// コンパイラが警告する）。**それ以外は閉じてある** — モジュールが `pub(crate)` なので
/// crate の外から名前で辿れず、欄は非公開、作る口の `for_screen` も `pub(crate)`。
///
/// **`Serialize` だけを derive する。** `Deserialize` を持つと、綴りから直に作る道が
/// 開いて門を回避できる。この2つの payload は emit 専用で、読み戻す呼び手はいない。
///
/// 足したいことがあるなら `followed_by` を通す。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ScreenMessage(String);

impl ScreenMessage {
    /// 刈った文言の**後ろ**に一文を足す。
    ///
    /// **上限の外で足す。** 中に入れると、刈る対象が長いときにこちらが消える。
    /// 消してよい部分ではない（`parse_failed` の doc がその基準を持つ）。
    ///
    /// **足せるのは定型文だけ**（`&'static str`）。実行時に組んだ値を許すと、
    /// 刈っていない綴りが後ろから入って上限が意味を失う。
    pub(crate) fn followed_by(mut self, tail: &'static str) -> Self {
        self.0.push_str(tail);
        self
    }
}

impl std::fmt::Display for ScreenMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// [`SCREEN_MESSAGE_LIMIT`] 文字まで書き取る受け皿。**超えたぶんは組み立てない。**
///
/// 上限に達したら `Err` を返して書き手を止めるので、
/// **`Display` の実装が引用しようとしている残りは `String` にならない。**
/// この `Err` は失敗ではなく上限に達した合図なので、`write!` の戻り値は見なくてよい。
///
/// **この型はこのモジュールの外へ出さない。** 取り出しは `finish` を通す一本道で、
/// 刈った印を付けるのはそこだけ。外へ出すと、印の付かない取り出し方が書ける
#[derive(Default)]
struct ScreenMessageSink {
    out: String,
    taken: usize,
    truncated: bool,
}

impl ScreenMessageSink {
    /// 書き取ったものを文言として取り出す。
    ///
    /// **刈ったときだけ末尾に省略記号を1文字足す。** 付けないと、読み手には
    /// 「これで全部」と「途中で切った」の区別が付かない。
    /// 戻り値は最大 [`SCREEN_MESSAGE_LIMIT`] + 1 文字。
    fn finish(mut self) -> String {
        if self.truncated {
            self.out.push('…');
        }
        self.out
    }
}

impl std::fmt::Write for ScreenMessageSink {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        for c in s.chars() {
            if self.taken >= SCREEN_MESSAGE_LIMIT {
                self.truncated = true;
                // 書き手を止める。`Display` の実装は途中で抜けても
                // ここまでに書かれたものを壊さない
                return Err(std::fmt::Error);
            }
            // 制御文字は空白にする。画面に出しても意味が無く、生の NUL や
            // エスケープが混ざる。
            //
            // **改行だけは通す。** `is_control` は改行も制御文字と数えるが、
            // 読めなかった行の引用は `:\n` で繋いで読ませる（`unreadable_record` と
            // `describe` の計3箇所）。組み上がった文言は `parse_failed` が
            // もう一度ここへ通すので、潰すと3箇所とも1行になる。
            // **守っているのは文字列であって画面の見た目ではない** —
            // 描画側に `white-space` の指定は無く、改行はブラウザが空白へ畳む
            self.out
                .push(if c == '\n' || !c.is_control() { c } else { ' ' });
            self.taken += 1;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write as _;

    /// 文言の受け皿そのものの境界。
    ///
    /// 通し経路のテストは「出てきた文言が短いこと」しか見ないので、
    /// **上限ちょうどで1文字余計に落とす / 1文字余計に通す**を区別できない。
    /// `write_str` が複数回に分かれる呼ばれ方も、通し経路では起きないことがある。
    #[test]
    fn the_message_sink_stops_exactly_at_the_limit() {
        // 上限ちょうどは省略記号を付けない
        let mut sink = ScreenMessageSink::default();
        write!(sink, "{}", "あ".repeat(SCREEN_MESSAGE_LIMIT)).expect("上限ちょうどで止められた");
        let out = sink.finish();
        assert_eq!(out.chars().count(), SCREEN_MESSAGE_LIMIT);
        assert!(!out.ends_with('…'), "上限ちょうどで省略している");

        // 1文字超えたら省略記号が付き、本文は上限で止まる
        let mut sink = ScreenMessageSink::default();
        let _ = write!(sink, "{}", "あ".repeat(SCREEN_MESSAGE_LIMIT + 1));
        let out = sink.finish();
        assert_eq!(out.chars().count(), SCREEN_MESSAGE_LIMIT + 1);
        assert!(out.ends_with('…'), "省略記号が無い");

        // **書き込みが分かれても、通算で数える。**
        // 1回ぶんで数えていると、`format!` の引数の切れ目で上限が甘くなる
        let mut sink = ScreenMessageSink::default();
        for _ in 0..10 {
            let _ = write!(sink, "{}", "い".repeat(SCREEN_MESSAGE_LIMIT));
        }
        assert_eq!(sink.finish().chars().count(), SCREEN_MESSAGE_LIMIT + 1);

        // 制御文字は空白に置き換える。生の NUL やエスケープが画面に出ない
        let mut sink = ScreenMessageSink::default();
        write!(sink, "a\0b\x1bc\nd").expect("書けること");
        assert_eq!(sink.finish(), "a b c\nd");
    }
}
