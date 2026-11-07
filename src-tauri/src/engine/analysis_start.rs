//! 検討に使うエンジンを起こし、その回の申告から送る設定を決めて `usinewgame` まで通す手順。
//!
//! どのプロセスが検討のものか（起動の世代、取り消し、`engine_id` への載せ替え）は知らない
//! （`analyzer` の `Startup`）。ここは渡された取り消しの欄を見て、起こす・送る・落とすだけを持つ。

use std::sync::Arc;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use super::binding::{self, BindingInput, EvalTarget};
use super::protocol::USI_OK_TIMEOUT;
use super::registry::{EngineProcess, EngineRegistry, SPAWN_TIMEOUT};
use super::setup;
use super::types::*;

const LOGT: &str = "obs_shogi::engine::analysis_start";

/// 解析の起動で渡すもの。**USI の名前は含まない**——どの名前で送るかは `binding::bind` が
/// その回の申告から決める
#[derive(Debug, Clone, Default)]
pub struct StartInput {
    /// 利用者の値（プリセットの `options`）
    pub values: Vec<SetOptionValue>,
    /// 選んだ評価関数（絶対パス。ファイルでもフォルダでもよい）
    pub eval_path: Option<String>,
    pub book: Option<BookChoice>,
}

/// 起こし、**その回の申告から**送る設定を決め（`binding::bind`）、送って `usinewgame` まで通す。
/// 失敗したら起こしたプロセスを落とす。cwd は実行ファイルのフォルダ（`spawn_cancellable` の
/// 作業フォルダに `None` を渡す）——相対パスを cwd 基準で解くエンジンがあり、AI フォルダを cwd に
/// すると同じ設定が AI フォルダごとに違うファイルを指す
pub async fn start(
    registry: &EngineRegistry,
    engine_path: &str,
    input: &StartInput,
    cancel: &CancellationToken,
) -> Result<(Arc<EngineProcess>, Vec<StartWarning>), EngineError> {
    // **評価関数を見るのは起こす前。** ディスクを見る待ちは取り消しと上限の外に出さない——
    // 起こした後で待つと、応答しないボリュームで握手を済ませたプロセスが残る
    let eval = match &input.eval_path {
        Some(path) => Some(tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(cancelled_start()),
            target = eval_target(path) => target,
        }),
        None => None,
    };
    let process = registry
        .spawn_cancellable(engine_path, None, SPAWN_TIMEOUT, USI_OK_TIMEOUT, cancel)
        .await?;
    let protocol = process.protocol();

    // 選んだ定跡の名前が選択肢に無いときだけ、パスを受けるかをこのプロセスに確かめる
    // （保存した結果を使うと、同じパスに別の版を置いたときに食い違う）
    let book_path_support = match binding::book_path_check_name(
        &process.info.options,
        input.book.as_ref(),
    ) {
        Some(name) => {
            let checked = tokio::select! {
                biased;
                _ = cancel.cancelled() => Err(cancelled_start()),
                checked = setup::check_book_path_support(&protocol, &name, BOOK_PATH_CHECK_LIMIT) => checked,
            };
            match checked {
                Ok(BookPathSupport::NoAnswer) => {
                    log::warn!(
                        target: LOGT,
                        "start_engine: {} did not answer whether `{name}` accepts a path in {BOOK_PATH_CHECK_LIMIT:?}",
                        process.info.name
                    );
                    BookPathSupport::NoAnswer
                }
                Ok(support) => support,
                Err(e) => {
                    registry.shutdown(&process.id).await;
                    return Err(e);
                }
            }
        }
        None => BookPathSupport::Unchecked,
    };

    let binding_input = BindingInput {
        values: input.values.clone(),
        eval,
        book: input.book.clone(),
        fixed: analysis_fixed_values(),
        book_path_support,
    };
    let bound = binding::bind(&process.info.options, &binding_input);
    let mut warnings = bound.warnings;

    // `biased`: 取り消しと失敗が同時に揃ったら取り消しを採る
    let prepared = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(cancelled_start()),
        prepared = setup::checked_prepare(&protocol, &bound.options, None, None) => prepared,
    };
    // 定跡をパスで送った回は、`readyok` までの `info string` で読めたかを確かめる
    // （`binding::book_load_warning`）。「断らなかった」だけでは、黙って捨てたエンジンを通してしまう
    if let (Ok(texts), Some(sent)) = (&prepared, &bound.book_path_sent) {
        warnings.extend(binding::book_load_warning(texts, sent));
    }
    for warning in &warnings {
        log::info!(target: LOGT, "start_engine: not sent as saved: {warning:?}");
    }
    let prepared = match prepared {
        Ok(_) => protocol.new_game().await,
        Err(e) => Err(e),
    };
    if let Err(e) = prepared {
        registry.shutdown(&process.id).await;
        return Err(e);
    }
    Ok((process, warnings))
}

/// ディスクを見に行く上限。応答しないボリュームで起動ごと止めない
const EVAL_STAT_TIMEOUT: Duration = Duration::from_secs(2);

/// 評価関数のパスがフォルダかファイルか。**読めなければファイル扱い**——そのまま送れば、無いパスは
/// エンジンが読み込みの失敗として返す。フォルダ扱いにすると、ファイルを受けるエンジンに
/// 「フォルダを選んでいる」（`EvalNeedsFile`）という事実と違う警告が出る
async fn eval_target(path: &str) -> EvalTarget {
    match tokio::time::timeout(EVAL_STAT_TIMEOUT, tokio::fs::metadata(path)).await {
        Ok(Ok(meta)) if meta.is_dir() => EvalTarget::Dir(path.to_string()),
        _ => EvalTarget::File(path.to_string()),
    }
}

/// 定跡をパスで受けるかを確かめる（`setup::check_book_path_support`）ときに、2回目の `usiok` を待つ上限。
/// 来なければ `NoAnswer` として定跡を切り、`BookPathCheckTimedOut` で知らせる（別の定跡で動くより安全）
const BOOK_PATH_CHECK_LIMIT: Duration = Duration::from_secs(5);

/// 解析の方針として送る値（申告にある名前だけが送られる）: 検討モードを入れ、先読みを切る
pub fn analysis_fixed_values() -> Vec<SetOptionValue> {
    [("ConsiderationMode", "true"), ("USI_Ponder", "false")]
        .into_iter()
        .map(|(name, value)| SetOptionValue {
            name: name.to_string(),
            value: value.to_string(),
        })
        .collect()
}

/// 値だけで断れる入力を、起こす前に断る。利用者の値に加えて、**評価関数と定跡のパスも**
/// （`setoption` の値として送るので、改行や長さの制約は同じ）
pub fn validate_input(input: &StartInput) -> Result<(), EngineError> {
    let mut all = input.values.clone();
    let path = |name: &str, value: &str| SetOptionValue {
        name: name.to_string(),
        value: value.to_string(),
    };
    if let Some(eval) = &input.eval_path {
        all.push(path("(evaluation)", eval));
    }
    if let Some(book) = &input.book {
        all.push(path("(book)", &book.path));
    }
    setup::validate_options(&all)
}

/// 起動が取り消されたこと（`shutdown` か、より新しい起動が来た）
pub fn cancelled_start() -> EngineError {
    EngineError::Cancelled("the engine start was cancelled".to_string())
}
