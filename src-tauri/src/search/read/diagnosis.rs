//! 読めなかった理由を、利用者に出す一文へ組む。
//!
//! **クレートが名指ししたものを消さない。** 固定の文言に潰すと、
//! どのファイルのどこが悪いのかを知る手段が無くなる。

use shogi_kifu_converter_obsshogi::error::ParseError;

use crate::search::read::outcome::KifuReadError;

/// 利用者に出す文言の上限。
///
/// クレートのエラーは**読めなかった位置から行末までを引用する**ので、
/// 改行を含まない大きなファイル（`.kif` に改名した zip など）では
/// ファイルの中身がそのまま文言になる。これが `IndexWarnPayload` に載り、
/// webview の state に200件まで溜まる。
pub(crate) const MESSAGE_LIMIT: usize = 300;

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
/// **埋め込む前に [`capped`] を通す。** クレートの文言は
/// 「読めなかった位置から行末まで」を引用するので、改行の無いファイルでは
/// ファイルの中身がまるごと1本の `String` になる。
/// 刈るのを [`parse_failed`] まで遅らせると、刈る対象が先に出来上がる。
pub(crate) fn unreadable_record(e: ParseError) -> String {
    let by_crate = capped(&e);
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
            "JKF（JSON）として壊れています（{by_crate}）。\
             元のアプリで書き出し直してください"
        ),
        ParseError::Kif(_) | ParseError::Ki2(_) => format!(
            "棋譜として読めない行があります。その行を直すか、\
             拡張子が中身と合っているか確かめてください:\n{by_crate}"
        ),
        // 文字コードの話。総当たりを掛ける3形式（KIF / KI2 / CSA）は
        // [`describe`] が先に扱うので、ここに来るのは JKF だけ
        ParseError::Decode | ParseError::FileExtension => format!(
            "{by_crate}: 文字として読めませんでした。\
             棋譜ではないファイルに棋譜の拡張子が付いていないか確かめてください"
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

/// クレートの文言を、埋め込む前に [`MESSAGE_LIMIT`] 文字で刈る。
///
/// **刈るのを最後まで遅らせると、刈る対象が先に出来上がる。**
/// `ParseError` の `Display` は読めなかった位置から行末までを引用するので、
/// 埋め込みで作る `format!` の結果がファイルの大きさになる。
/// ここで刈ると `describe` の戻り値は 4 MiB → 440 バイトになる。
///
/// **クレートが持っている引用文そのものは消せない。**
/// `ParseError::Kif` は `Kif(String)` で、引用はパース時に確定して保持されている
/// （4 MiB の1行ファイルで内部の `String` が 4,194,343 バイト）。
/// **確保のピークを頭打ちにしているのは [`SIZE_LIMIT`] のほう。**
pub(crate) fn capped(e: &dyn std::fmt::Display) -> String {
    use std::fmt::Write as _;
    let mut sink = Capped::default();
    let _ = write!(sink, "{e}");
    sink.finish()
}

/// 読めなかった理由を、利用者に出せる形にして包む。
///
/// **[`KifuReadError::ParseFailed`] を作る口はここだけ。** 長さと制御文字を落とすのを
/// 各所でやると必ず漏れる。[`KifuReadError::NothingToIndex`] の `warn` は
/// **数だけを埋める定型文**なので刈る対象が無く、ここを通らず直に組む。
/// **クレート由来の文言を混ぜるなら、ここか [`capped`] を通すこと。**
///
/// **上限は組みながら掛ける。** `to_string()` を先に呼ぶと、
/// クレートが引用する「読めなかった位置から行末まで」が丸ごと確保される。
/// クレートの文言を文中に埋める側（[`unreadable_record`] / [`describe`]）も
/// 同じ理由で [`capped`] を通す。ここだけで刈ると、刈る対象が先に出来上がる。
///
/// # 失うものを言う
///
/// **読めなかったファイルは局面が1件も索引に入らない。** 理由だけを出すと、
/// 利用者は「読めない行が1つある」と受け取って、100手ぶんの局面が
/// 丸ごと検索から消えていることに気付かない（そのあと検索して出てこなければ
/// 「その局面は指されていない」と読む）。
///
/// 同じ `EVT_INDEX_WARN` に載る他の2つ（[`warn_if_moves_were_dropped`] と
/// `BuildWarn` の `Display`）はどちらも失うものを言っているので、
/// ここだけ黙っていると画面の中で基準が2つになる。
///
/// **この一文は上限の外で足す。** 中に入れるとクレートの文言が長いときに
/// 刈られて消える。消えてよい部分ではない。
pub(crate) fn parse_failed(e: impl std::fmt::Display) -> KifuReadError {
    use std::fmt::Write as _;

    let mut sink = Capped::default();
    // `Display` は `Ok` しか返さないが、`Capped` は上限で `Err` を返して
    // 書き手を止める。どちらも文言としては完成しているので結果は見ない
    let _ = write!(sink, "{e}");
    let mut message = sink.finish();
    message.push_str("。このファイルの局面は検索に出ません");
    KifuReadError::ParseFailed(message)
}

/// [`MESSAGE_LIMIT`] 文字まで書き取る受け皿。**超えたぶんは組み立てない。**
///
/// 上限に達したら `Err` を返して書き手を止めるので、
/// **`Display` の実装が引用しようとしている残りは `String` にならない。**
#[derive(Default)]
pub(crate) struct Capped {
    out: String,
    taken: usize,
    truncated: bool,
}

impl Capped {
    pub(crate) fn finish(mut self) -> String {
        if self.truncated {
            self.out.push('…');
        }
        self.out
    }
}

impl std::fmt::Write for Capped {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        for c in s.chars() {
            if self.taken >= MESSAGE_LIMIT {
                self.truncated = true;
                // 書き手を止める。`Display` の実装は途中で抜けても
                // ここまでに書かれたものを壊さない
                return Err(std::fmt::Error);
            }
            // 制御文字は画面に出しても意味が無く、生の NUL やエスケープが混ざる
            self.out
                .push(if c == '\n' || !c.is_control() { c } else { ' ' });
            self.taken += 1;
        }
        Ok(())
    }
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
