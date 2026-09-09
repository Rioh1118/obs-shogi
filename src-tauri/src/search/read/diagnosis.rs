//! 読めなかった理由を、利用者に出す一文へ組む。
//!
//! **クレートが名指ししたものを消さない。** 固定の文言に潰すと、
//! どのファイルのどこが悪いのかを知る手段が無くなる。
//!
//! **どれも Tauri を要らない形に切ってある**（`AppHandle` を取らない）ので、
//! テストから直に呼べる。ただし**呼ばれていることまでは見ていない**
//! ——emit の側を落としても、ここのテストは緑のまま。

use shogi_kifu_converter_obsshogi::error::ParseError;

use crate::search::message::for_screen;
use crate::search::read::outcome::KifuReadError;

/// クレートの理由を、そのまま利用者に出せる文言にする。
///
/// **形式ごとの案内を持つのはここだけ。** 総当たりを掛けない JKF は
/// [`read_path_inner`] から直に、掛ける3形式は候補を選んだあとの
/// [`describe`] から呼ばれる。どちらの経路でも同じ案内が出る。
///
/// [`KifuReadError::ParseFailed`] の doc が定めた「何が読めなかったかと
/// 次に何をすればよいか」を満たすのはこの関数の仕事。クレートの文言は
/// **行番号と読めなかった行の本文**を持っていて役に立つので捨てないが、
/// `KIF Error: 0: at line 2, in this move cannot be read` は `nom` の語彙で、
/// 利用者の言葉ではない。前に1文を置いて、何をすればよいかを言う。
///
/// **案内を先に、クレートの引用を後ろに置く。** どの腕も組み上がりを
/// [`parse_failed`] がもう一度刈るので、引用の後ろに置いた案内は
/// 引用が長いときに丸ごと落ちる。腕ごとに「いまは短いから大丈夫」と
/// 論証しない —— クレートが引用の仕方を変えた日に破れる。
///
/// **埋め込む前に [`for_screen`] を通す。** クレートの文言は
/// 「読めなかった位置から行末まで」を引用するので、改行の無いファイルでは
/// ファイルの中身がまるごと1本の `String` になる。
/// 刈るのを [`parse_failed`] まで遅らせると、刈る対象が先に出来上がる
/// （ここで刈ると `describe` の戻り値は 4 MiB → 440 バイト）。
///
/// **クレートが持っている引用文そのものは消せない。** `ParseError::Kif` は
/// `Kif(String)` で、引用はパース時に確定して保持されている（4 MiB の1行ファイルで
/// 内部の `String` が 4,194,343 バイト）。**確保のピークを頭打ちにしているのは
/// `SIZE_LIMIT` のほう。**
pub(crate) fn unreadable_record(e: ParseError) -> String {
    let by_crate = for_screen(&e);
    match e {
        // `parse_jkf_file` は `read_to_string` するので、UTF-8 でない `.jkf` は
        // 必ずここに来る。**総当たりを掛ける3形式はここに来ない** —
        // クレートがバイト列から文字コードを決め、決められなければ
        // `Decode` を返す
        ParseError::Io(io) if io.kind() == std::io::ErrorKind::InvalidData => {
            "UTF-8 として読めませんでした。Shift_JIS で保存されている可能性があります。\
             UTF-8 で保存し直してください"
                .to_owned()
        }
        ParseError::Io(io) => cannot_open_reason(&io),
        ParseError::Csa(_) | ParseError::CsaConvert(_) => format!(
            "CSA として読めません。V2.2 のヘッダと手番行（+ か -）があるか\
             確かめてください（{by_crate}）"
        ),
        ParseError::Serde(_) => format!(
            "JKF（JSON）として壊れています。元のアプリで書き出し直してください\
             （{by_crate}）"
        ),
        ParseError::Kif(_) | ParseError::Ki2(_) => format!(
            "棋譜として読めない行があります。その行を直すか、\
             拡張子が中身と合っているか確かめてください:\n{by_crate}"
        ),
        // 文字コードの話。総当たりを掛ける3形式（KIF / KI2 / CSA）は
        // [`describe`] が先に扱うので、ここに来るのは JKF だけ
        ParseError::Decode | ParseError::FileExtension => format!(
            "文字として読めませんでした。棋譜ではないファイルに棋譜の拡張子が\
             付いていないか確かめてください（{by_crate}）"
        ),
        // 局面に合わない手。手合割の名前がクレートの表に無い、書き写しを誤った、
        // 駒がいない升から動かした、など。文字コードとは関係が無い。
        // **クレートの本文は何手目・どの升を名指しするので捨てない**
        ParseError::Normalize(_) => format!(
            "書かれている手が局面に合いません。手合割の名前がこのアプリの知っている\
             ものか、その手数のところで指し手が書き写せているか確かめてください\
             （{by_crate}）"
        ),
    }
}

/// 読めなかった理由を、利用者に出せる形にして包む。
///
/// **[`KifuReadError::ParseFailed`] を作る口はここだけ。** 長さと制御文字を落とすのを
/// 各所でやると必ず漏れる。`ReadOutcome::NothingToIndex` の `warns` は失敗ではないので
/// ここを通らないが、刈る口は同じ——`read_path_inner` が組んだところで [`for_screen`] に通す。
/// **クレート由来の文言を混ぜるなら、どちらかを通すこと。**
///
/// **ここへは組み上がった `String` を渡してよい。** クレートの文言を文中に埋める側
/// （[`unreadable_record`] / [`describe`]）が先に [`for_screen`] を通しているので、
/// この段に届く時点で確保はもう 300 文字級に落ちている。
/// **その順序を崩さないこと** —— 埋める側で刈らずにここまで持ってくると、
/// 刈る対象がファイルの大きさで先に出来上がる。
///
/// # 失うものを言う
///
/// **読めなかったファイルは局面が1件も索引に入らない。** 理由だけを出すと、
/// 利用者は「読めない行が1つある」と受け取って、100手ぶんの局面が
/// 丸ごと検索から消えていることに気付かない（そのあと検索して出てこなければ
/// 「その局面は指されていない」と読む）。
///
/// **基準は `IndexWarnPayload::message` の doc が持つ。** この口もそれに従う。
/// 同じイベントに載る文言は他にもあり、揃っていないと画面の中で基準が2つになる。
///
/// **この一文は上限の外で足す。** 中に入れるとクレートの文言が長いときに
/// 刈られて消える。消えてよい部分ではない。
pub(crate) fn parse_failed(e: impl std::fmt::Display) -> KifuReadError {
    KifuReadError::ParseFailed(for_screen(&e).followed_by("。このファイルの局面は検索に出ません"))
}

/// ファイルそのものを開けなかった／読めなかったことを [`KifuReadError`] にする。
///
/// **`os error 13` から権限を疑える利用者はいない。** この経路の文言も
/// 索引の警告としてそのまま画面に出るので、他と同じく次の行動まで言う。
///
/// **[`unreadable_record`] とは別物。** あちらは「開けたが棋譜ではない」。
/// 名前が近いと呼び違えるが、`ParseError::Io` の腕では**型が合ってしまう**ので
/// コンパイラは止めない。
pub(crate) fn cannot_open(e: std::io::Error) -> KifuReadError {
    parse_failed(cannot_open_reason(&e))
}

/// [`cannot_open`] の文言だけ。`ParseError::Io` を包み直すときに使う。
pub(crate) fn cannot_open_reason(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => {
            "ファイルを開く権限がありません。権限を確かめるか、この場所を索引から外してください"
                .to_owned()
        }
        std::io::ErrorKind::NotFound => "索引を作っている間にファイルが無くなりました".to_owned(),
        // `ErrorKind` の Debug は内部の識別子なので出さない
        _ => {
            "ファイルを読めませんでした。ディスクやネットワークの接続を確かめてください".to_owned()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 画面に出る文言に内部の語彙が混じらないこと。
    ///
    /// **`io::Error` の `Display` は内部の綴り**（`Permission denied (os error 13)`）。
    /// 素で流すと、利用者は自分に関係のある文字列だと読んで検索する。
    #[test]
    fn no_open_failure_message_carries_internal_words() {
        use std::io::ErrorKind;
        for kind in [
            ErrorKind::PermissionDenied,
            ErrorKind::NotFound,
            ErrorKind::Other,
        ] {
            let m = cannot_open_reason(&std::io::Error::new(kind, "os error 13"));
            for internal in ["os error", "ErrorKind", "Err", "read_dir"] {
                assert!(
                    !m.contains(internal),
                    "内部の識別子が画面に出る（{internal}）: {m}"
                );
            }
            assert!(!m.is_empty(), "文言が無い（{kind:?}）");
        }
        // **直せるものだけ「ください」と言う。** 索引を組んでいる間に消えた
        // ファイルには利用者のすることが無いので、案内を足すと直せないものを
        // 直しに行かせる
        for kind in [ErrorKind::PermissionDenied, ErrorKind::Other] {
            let m = cannot_open_reason(&std::io::Error::new(kind, "os error 13"));
            assert!(m.contains("ください"), "次に何をすればよいかが無い: {m}");
        }
    }
}
