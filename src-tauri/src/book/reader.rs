use crate::book::error::BookError;
use crate::book::sfen::BookKey;
use crate::book::types::BookFormat;
use crate::book::types::BookMove;
use std::path::PathBuf;

/// 形式ごとの定跡の読み手。
///
/// 開いたあとに必要なのは「この局面の候補手」だけなので、形式差
/// （テキスト / 固定長バイナリ / on-the-fly）はこの裏に閉じる。
///
/// 収録局面数はここに置かない。開くときに1度決まる値で、開いたあとの
/// 問い合わせではないから。実装ごとに「毎回数えるのか、開くときに数えるのか」を
/// 判断させると、数え方の違いが trait の外から見えなくなる。
/// 数えるのは [`open_reader`] の中（blocking プールの中）で、結果は
/// [`OpenedBook::position_count`] に載せる。
///
/// 実装が守ること:
///
/// - **失敗を空の結果に丸めない。** 読めなかったときは `Io`、書式が壊れている
///   ときは `InvalidContent` を返す。空の `Vec` は「未収録」だけを意味する。
///   外付けドライブを抜かれた定跡が「全局面が定跡に無い」に見えると、利用者は
///   定跡が死んだことに気づけない
/// - **壊れた内容で panic しない。** 途中で切れたファイルは固定長レコードの
///   境界を跨ぐので、範囲検査をして `InvalidContent` を返す。panic すると
///   コマンド境界では `Unknown` にしかならず、フロントは「壊れている」という
///   復帰導線を出せない
/// - io の失敗は [`BookError::from_io`] でパスを添えて返す
pub(crate) trait BookReader: Send + Sync {
    /// 局面の候補手を、定跡に書かれている順で返す。
    ///
    /// 未収録の局面は空の `Vec` であって、エラーではない。
    fn lookup(&self, key: &BookKey) -> Result<Vec<BookMove>, BookError>;
}

/// 開いた定跡ひとつぶんの材料。
///
/// 確定させる場所は2つに分かれる。`format` は `open` モジュールがパスを解決する
/// ときに決め、[`open_reader`] は受け取るだけ（決め直すと symlink をもう一度
/// たどることになる）。`position_count` は [`open_reader`] が数える。
///
/// どちらも reader ではなくここに持つのは、**`BookState::register` に
/// 問い合わせさせないため。** register は async ランタイム上で走るので、
/// ヘッダを読んで答える実装が入った瞬間に IO が async ワーカで走る。
/// 数えるのは blocking プールの中で1度だけ。
pub(crate) struct OpenedBook {
    pub(crate) path: PathBuf,
    pub(crate) format: BookFormat,
    pub(crate) position_count: Option<u64>,
    /// 読めずに捨てた欄の数。数えられない形式は `None`
    pub(crate) dropped_fields: Option<u64>,
    pub(crate) reader: Box<dyn BookReader>,
}
