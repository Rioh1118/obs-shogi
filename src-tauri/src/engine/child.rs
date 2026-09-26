//! エンジンの子プロセスと、その標準入出力の持ち主。
//!
//! **stdin・stdout・stderr・プロセスをそれぞれ別の持ち主にする。** 1つの構造体を
//! 1つのロックの下に置くと、stdin への書き込みが詰まったときに同じロックを待つ
//! kill が返らない。ここでは kill はチャンネルで待ち手のタスクへ頼むだけで、
//! stdin のロックを**待たない**。
//!
//! 書く口（`ChildWriter`）と読む口（`read_stdout`）は**1回きり**しか渡さない。
//! 2本目の書き手ができると、書き込みの列（`protocol::run_writer`）が守っている
//! 「投入順＝ワイヤ上の順」を迂回できる。
//!
//! 行の解析は `usi` crate の `EngineCommand::parse` に任せる。任せないのは読み方で、
//! 解けない行・UTF-8 でない行・長すぎる行があっても**読み取りを止めない**
//! （止めると以後の出力が全部消え、エンジンが生きたまま「出力が終わった」に見える）。

use std::collections::VecDeque;
use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{oneshot, watch, Mutex};
use usi::EngineCommand;

const LOGT: &str = "obs_shogi::engine::child";

/// 1行として受け取る上限（バイト）。**メモリを守るためだけ**の値。
///
/// 改行を出さないストリーム（取り違えたバイナリ、ログを垂れ流す実行ファイル）で
/// 読み込みが際限なく伸びないように切る。長い詰みの読み筋は数 KB なので、
/// 正常なエンジンの行がここに届くことはない。
pub const MAX_LINE: usize = 1024 * 1024;

/// 落とすよう頼んでから、プロセスが畳まれるのを見届けるまでの上限。
///
/// SIGKILL は普通ミリ秒で効く。これを超えたら、OS がすぐには畳めない状態
/// （応答しないボリュームの上で止まっている、など）とみなして待つのをやめる。
/// やめても待ち手は終わりを待ち続けるので、後から畳まれれば回収される。
pub const KILL_TIMEOUT: Duration = Duration::from_secs(2);

/// 直近の出力として持つ行数。起動や実行の失敗の理由に添える材料。
///
/// 理由に載せるのは数行だが、stdout と stderr を着いた順に1つに持つので、失敗の後に
/// stdout の `info` が続くと stderr の行は古い側へ追いやられる。stderr の行はこの数の行が
/// 後から着くまで残り、理由を組む側（`protocol.rs` の `summarize_recent`）は、いちばん
/// 新しい1行の次に stderr の行を選ぶ
const RECENT_LINES: usize = 32;

/// 直近の出力として持つ1行の長さ（文字）。理由に添えるだけなので短く切る
const RECENT_LINE_CHARS: usize = 512;

/// どちらの出力から来た行か
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Stdout,
    Stderr,
}

/// stdout から読んだ1件。
#[derive(Debug)]
pub enum ReadEvent {
    /// 1行。`parsed` が `None` になるのは、`usi` crate が知っている語なのに形が
    /// 崩れている（数値が溢れた、など）ときと、`MAX_LINE` を超えて切ったとき。
    /// 知らない語で始まる行は `Some(EngineCommand::Unknown)` で来る。**読み取りは続く。**
    Line {
        raw: String,
        parsed: Option<EngineCommand>,
    },
    /// stdout が閉じた。以後は何も来ない
    Eof,
}

/// プロセスがどう終わったか
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    Status(ExitStatus),
    /// 終了を待つこと自体に失敗した（OS がプロセスを見失った）
    Unknown,
}

/// `kill_and_wait` の結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[must_use = "落とせたか・残ったかを記録しないと、残ったことを知る手掛かりが無くなる"]
pub enum KillOutcome {
    /// 頼んで、終わるのを見届けた
    Ended(Exit),
    /// 既に頼んであり、まだ終わりを見ていない（先の呼び手が待っている最中か、
    /// `TimedOut` で諦めた後）。終わった後の呼び出しは `AlreadyExited` になる
    AlreadyRequested,
    /// 頼む前に終わっていた
    AlreadyExited,
    /// 上限内に終わらなかった。**残っている**
    TimedOut,
    /// 終わりを見届ける待ち手が消えた。残っているかは判らない
    WatcherGone,
}

/// 子プロセス1本。
///
/// **Drop するとプロセスも落ちる**（待ち手が kill の頼みの口が閉じたことで気付き、
/// unix で子がまだ生きていればプロセスグループごと落とす）。**stdin も閉じる**
/// （`kill_and_wait` と同じ。グループへ送らない回の孫を止める手段は stdin の EOF しか無く、
/// 書き込みの口 `ChildWriter` を誰かが握っていると閉じない）。落とし損ねてもパニックはしない。
pub struct EngineChild {
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    writer: StdMutex<Option<ChildWriter>>,
    stdout: StdMutex<Option<ChildStdout>>,
    kill: StdMutex<Option<oneshot::Sender<()>>>,
    diagnostics: ChildDiagnostics,
}

/// 子プロセスの様子を見るだけの取っ手。**落とす口を持たない。**
///
/// 読み取りの後始末など、プロセスより長く生きうるタスクにはこちらを渡す。
/// `EngineChild` そのものを渡すと、そのタスクが生きている間 Drop が起きず、
/// 「捨てればプロセスも落ちる」が効かなくなる。
#[derive(Clone)]
pub struct ChildDiagnostics {
    exit: watch::Receiver<Option<Exit>>,
    stderr_done: watch::Receiver<bool>,
    recent: Arc<StdMutex<VecDeque<(Source, String)>>>,
}

/// stdin に書く口。**`EngineChild::take_writer` から1回だけ取れる。**
pub struct ChildWriter {
    stdin: Arc<Mutex<Option<ChildStdin>>>,
}

/// 子プロセスを起こす。**tokio のランタイムの中で呼ぶこと**（`spawn_blocking` の中でもよい）。
///
/// 引数は渡さない。cwd は `work_dir`。子は自分のプロセスグループの頭になる
/// （落とすときに孫まで届けるため）。
pub fn spawn(program: &Path, work_dir: &Path) -> std::io::Result<EngineChild> {
    let mut command = tokio::process::Command::new(program);
    command
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn()?;

    let pid = child.id();
    let stdin = Arc::new(Mutex::new(child.stdin.take()));
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let recent = Arc::new(StdMutex::new(VecDeque::with_capacity(RECENT_LINES)));
    let (stderr_done_tx, stderr_done_rx) = watch::channel(false);
    match stderr {
        Some(stderr) => {
            let recent = Arc::clone(&recent);
            tokio::spawn(async move {
                read_stderr(BufReader::new(stderr), recent).await;
                let _ = stderr_done_tx.send(true);
            });
        }
        None => {
            let _ = stderr_done_tx.send(true);
        }
    }

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let (exit_tx, exit_rx) = watch::channel(None);
    tokio::spawn(async move {
        // 頼みが来たか、頼みの口が落ちた（`EngineChild` の Drop）ら落とす
        let waited = tokio::select! {
            waited = child.wait() => waited,
            _ = kill_rx => {
                signal_group(pid);
                if let Err(e) = child.start_kill() {
                    log::warn!(target: LOGT, "kill: could not signal the process: {e}");
                }
                child.wait().await
            }
        };
        let exit = match waited {
            Ok(status) => Exit::Status(status),
            Err(e) => {
                log::warn!(target: LOGT, "wait: failed: {e}");
                Exit::Unknown
            }
        };
        let _ = exit_tx.send(Some(exit));
    });

    Ok(EngineChild {
        writer: StdMutex::new(Some(ChildWriter {
            stdin: Arc::clone(&stdin),
        })),
        stdin,
        stdout: StdMutex::new(stdout),
        kill: StdMutex::new(Some(kill_tx)),
        diagnostics: ChildDiagnostics {
            exit: exit_rx,
            stderr_done: stderr_done_rx,
            recent,
        },
    })
}

/// プロセスグループの全員へ SIGKILL を送る。`#!` のラッパーから起こしたエンジンは
/// 孫なので、子（シェル）だけを落とすと stdin・stdout を継いだまま孤児として残る
#[cfg(unix)]
fn signal_group(pid: Option<u32>) {
    let group = pid
        .and_then(|pid| i32::try_from(pid).ok())
        .and_then(rustix::process::Pid::from_raw);
    let Some(group) = group else {
        return;
    };
    if let Err(e) = rustix::process::kill_process_group(group, rustix::process::Signal::KILL) {
        log::debug!(target: LOGT, "kill: could not signal the process group: {e}");
    }
}

#[cfg(not(unix))]
fn signal_group(_pid: Option<u32>) {}

impl EngineChild {
    /// stdin に書く口を取る。**1回きり**（2回目は `None`）
    pub fn take_writer(&self) -> Option<ChildWriter> {
        lock(&self.writer).take()
    }

    /// stdout を読み始める。**1回きり**（2回目は `false`）。
    ///
    /// `hook` は読み取りのタスクから1行ごとに呼ばれ、最後に1度だけ `Eof` を受ける。
    /// `false` を返すとそこで読むのをやめる（`Eof` は来ない）。
    pub fn read_stdout<F>(&self, hook: F) -> bool
    where
        F: FnMut(ReadEvent) -> bool + Send + 'static,
    {
        let Some(stdout) = lock(&self.stdout).take() else {
            return false;
        };
        tokio::spawn(read_stdout(
            BufReader::new(stdout),
            Arc::clone(&self.diagnostics.recent),
            hook,
        ));
        true
    }

    /// 落とし、終わるのを `limit` まで見届ける。2度目以降は頼み直さない。
    ///
    /// 落とすのは待ち手のタスクに頼むだけで、stdin のロックを**待たない**。
    /// 書き込みが詰まっていても落とせる。`quit` は書かない（行儀よく終わらせたい呼び手は
    /// 先に `quit` を送る）。
    pub async fn kill_and_wait(&self, limit: Duration) -> KillOutcome {
        self.close_stdin();
        if self.diagnostics.exit_now().is_some() {
            return KillOutcome::AlreadyExited;
        }
        let Some(tx) = lock(&self.kill).take() else {
            return KillOutcome::AlreadyRequested;
        };
        // 受け手が居ないのは、待ち手が終了を見届けて抜けた後だけ
        if tx.send(()).is_err() {
            return KillOutcome::AlreadyExited;
        }

        match self.diagnostics.wait_exit(limit).await {
            Waited::Ended(exit) => KillOutcome::Ended(exit),
            Waited::WatcherGone => KillOutcome::WatcherGone,
            Waited::TimedOut => KillOutcome::TimedOut,
        }
    }

    /// stdin を閉じる。書き込みがロックを握っているとき（詰まっているとき）は、
    /// 空くのを待つタスクに任せて返る。**閉じないまま残さない**——子が先に終わっていた回
    /// （`AlreadyExited`。グループへのシグナルは送らない）と非 unix では、`#!` のラッパーの
    /// 孫を止める手段が stdin の EOF しか無い
    ///
    /// ランタイムの外（ランタイムを畳んだ後の Drop）では空くのを待てない。そのときは
    /// 書き込みの口（`ChildWriter`）が全部捨てられた時点で閉じる
    fn close_stdin(&self) {
        if let Ok(mut stdin) = self.stdin.try_lock() {
            stdin.take();
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let stdin = Arc::clone(&self.stdin);
        runtime.spawn(async move {
            stdin.lock().await.take();
        });
    }

    /// 様子を見るだけの取っ手（落とす口を持たない）
    pub fn diagnostics(&self) -> ChildDiagnostics {
        self.diagnostics.clone()
    }
}

impl Drop for EngineChild {
    fn drop(&mut self) {
        // 落とすのは欄の `kill` が落ちたのを待ち手が見て行う。ここで足すのは stdin だけ
        self.close_stdin();
    }
}

/// `ChildDiagnostics::wait_exit` の結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waited {
    Ended(Exit),
    TimedOut,
    /// 終わりを見届ける待ち手が消えた
    WatcherGone,
}

impl ChildDiagnostics {
    /// 今の時点の終わり方。終わっていなければ `None`
    pub fn exit_now(&self) -> Option<Exit> {
        *self.exit.borrow()
    }

    /// 終わるのを `limit` まで待つ
    pub async fn wait_exit(&self, limit: Duration) -> Waited {
        let mut exit = self.exit.clone();
        let waited = tokio::time::timeout(limit, exit.wait_for(|e| e.is_some()))
            .await
            .map(|watched| watched.map(|exit| *exit));
        match waited {
            Ok(Ok(Some(exit))) => Waited::Ended(exit),
            Ok(Ok(None)) | Ok(Err(_)) => Waited::WatcherGone,
            Err(_) => Waited::TimedOut,
        }
    }

    /// stderr を読み切るのを `limit` まで待つ。**stdout の EOF と stderr の EOF は
    /// 別々に着く**ので、stdout が閉じた直後に直近の出力を読むと、stderr の最後の行
    /// （共有ライブラリや評価関数の失敗）がまだ入っていないことがある
    pub async fn settle_output(&self, limit: Duration) {
        let mut done = self.stderr_done.clone();
        let waited = tokio::time::timeout(limit, done.wait_for(|done| *done))
            .await
            .map(|watched| watched.map(|_| ()));
        match waited {
            // 読み切った。送り手が消えたのも、読み手のタスクが抜けた後
            Ok(Ok(())) | Ok(Err(_)) => {}
            // stderr を孫が握って開けたままにしている、など。読めた分で進む
            Err(_) => log::debug!(target: LOGT, "settle: stderr did not close within {limit:?}"),
        }
    }

    /// 直近の出力（stdout と stderr を着いた順に）。起動や実行の失敗の理由に添える
    pub fn recent_lines(&self) -> Vec<(Source, String)> {
        lock(&self.recent).iter().cloned().collect()
    }
}

impl ChildWriter {
    /// 1行を書く。改行はこちらで足す。
    ///
    /// 落とした後（stdin を閉じた後）は `NotConnected` を返す。相手が読み口を閉じた
    /// `BrokenPipe` とは原因が違うので分ける
    pub async fn write_line(&self, line: &str) -> std::io::Result<()> {
        let mut guard = self.stdin.lock().await;
        let Some(stdin) = guard.as_mut() else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotConnected,
                "stdin has been closed",
            ));
        };
        stdin.write_all(line.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await
    }
}

/// どのロックも、中で行うのは1回の差し替え（`take`）か `push` / `pop` だけで、
/// 途中で panic しても半端な値を残さない。毒されていても中身をそのまま使う
fn lock<T>(mutex: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn remember(recent: &StdMutex<VecDeque<(Source, String)>>, source: Source, text: &str) {
    let mut recent = lock(recent);
    if recent.len() == RECENT_LINES {
        recent.pop_front();
    }
    recent.push_back((source, text.chars().take(RECENT_LINE_CHARS).collect()));
}

async fn read_stdout<R, F>(
    mut reader: R,
    recent: Arc<StdMutex<VecDeque<(Source, String)>>>,
    mut hook: F,
) where
    R: AsyncBufRead + Unpin,
    F: FnMut(ReadEvent) -> bool,
{
    loop {
        match read_bounded_line(&mut reader, MAX_LINE).await {
            Ok(Some(line)) => {
                let text = String::from_utf8_lossy(&line.bytes);
                let text = text.trim_end_matches(['\r', '\n']);
                if text.trim().is_empty() {
                    continue;
                }
                remember(&recent, Source::Stdout, text);
                let parsed = if line.truncated {
                    None
                } else {
                    EngineCommand::parse(text).ok()
                };
                if !hook(ReadEvent::Line {
                    raw: text.to_string(),
                    parsed,
                }) {
                    return;
                }
            }
            // 読み取り自体の失敗は、以後も読めないので終わりとして扱う
            Ok(None) | Err(_) => {
                hook(ReadEvent::Eof);
                return;
            }
        }
    }
}

async fn read_stderr<R>(mut reader: R, recent: Arc<StdMutex<VecDeque<(Source, String)>>>)
where
    R: AsyncBufRead + Unpin,
{
    while let Ok(Some(line)) = read_bounded_line(&mut reader, MAX_LINE).await {
        let text = String::from_utf8_lossy(&line.bytes);
        let text = text.trim_end_matches(['\r', '\n']);
        if !text.trim().is_empty() {
            remember(&recent, Source::Stderr, text);
        }
    }
}

struct BoundedLine {
    bytes: Vec<u8>,
    /// `max` を超えた分を捨てた
    truncated: bool,
}

/// 改行まで読む。返す中身に改行は含めない。`max` を超えた分は**読みながら捨てる**
/// （読み切ってから切ると、改行の無いストリームで確保が際限なく伸びる）。
/// `max` が縛るのは中身だけで、改行は数えない。EOF で読めた分が無ければ `None`
async fn read_bounded_line<R>(reader: &mut R, max: usize) -> std::io::Result<Option<BoundedLine>>
where
    R: AsyncBufRead + Unpin,
{
    let mut bytes = Vec::new();
    let mut truncated = false;
    let mut read_any = false;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(read_any.then_some(BoundedLine { bytes, truncated }));
        }
        read_any = true;
        let (content, found_newline) = match available.iter().position(|b| *b == b'\n') {
            Some(i) => (&available[..i], true),
            None => (available, false),
        };
        let room = max.saturating_sub(bytes.len());
        if content.len() > room {
            truncated = true;
        }
        bytes.extend_from_slice(&content[..content.len().min(room)]);
        let used = content.len() + usize::from(found_newline);
        reader.consume(used);
        if found_newline {
            return Ok(Some(BoundedLine { bytes, truncated }));
        }
    }
}

/// 行の読み方を、プロセスを起こさずにバイト列で確かめる。**unix に限らない**
/// （実プロセスのテストは `#!/bin/sh` の台本を使うので、unix でしか走らない）。
///
/// 読み口の容量を小さく取り、1行が `fill_buf` の何回かに分かれて届く形にする。
#[cfg(test)]
mod reading_tests {
    use super::*;

    /// `bytes` を、1回の `fill_buf` で `capacity` バイトずつ届く読み口にする
    fn reader(bytes: &'static [u8], capacity: usize) -> BufReader<&'static [u8]> {
        BufReader::with_capacity(capacity, bytes)
    }

    async fn lines(bytes: &'static [u8], capacity: usize, max: usize) -> Vec<(Vec<u8>, bool)> {
        let mut reader = reader(bytes, capacity);
        let mut found = Vec::new();
        while let Some(line) = read_bounded_line(&mut reader, max)
            .await
            .expect("バイト列は読み切れる")
        {
            found.push((line.bytes, line.truncated));
        }
        found
    }

    /// 中身がちょうど `max` の行は切らない。改行は数えない
    #[tokio::test]
    async fn a_line_of_exactly_max_bytes_is_not_cut() {
        assert_eq!(
            lines(b"abcd\nnext\n", 3, 4).await,
            [(b"abcd".to_vec(), false), (b"next".to_vec(), false)]
        );
    }

    /// 超えた分は捨て、次の行へ混ぜない。切るのはバイトの位置なので、多バイト文字の
    /// 途中でも切る（文字にするときに置き換え文字になる → `read_stdout`）
    #[tokio::test]
    async fn the_rest_of_a_cut_line_does_not_leak_into_the_next() {
        assert_eq!(
            lines(b"abcdef\nxy\n", 3, 4).await,
            [(b"abcd".to_vec(), true), (b"xy".to_vec(), false)]
        );
        assert_eq!(
            lines("あい\n".as_bytes(), 2, 4).await,
            [(vec![0xE3, 0x81, 0x82, 0xE3], true)]
        );
    }

    /// 1バイトずつ届いても行が割れない。改行の無い末尾も1行として返す
    #[tokio::test]
    async fn a_line_split_across_reads_and_a_last_line_without_a_newline() {
        assert_eq!(
            lines(b"ab\n\ncd", 1, 16).await,
            [
                (b"ab".to_vec(), false),
                (Vec::new(), false),
                (b"cd".to_vec(), false)
            ]
        );
        assert!(lines(b"", 1, 16).await.is_empty());
    }

    /// stdout から読んだ件を、`Eof` まで集める
    async fn events(bytes: &'static [u8], capacity: usize) -> Vec<ReadEvent> {
        let recent = Arc::new(StdMutex::new(VecDeque::new()));
        let mut found = Vec::new();
        read_stdout(reader(bytes, capacity), recent, |event| {
            found.push(event);
            true
        })
        .await;
        found
    }

    /// `\r\n` の行は `\r` を落として解く。UTF-8 でない行は置き換え文字にして渡し、
    /// 読み取りを続ける。空行は捨てる
    #[tokio::test]
    async fn the_reader_goes_on_whatever_the_line_looks_like() {
        let found = events(b"id name T\r\n\r\n\xff\xfe\nusiok\r\n", 2).await;
        let raws: Vec<Option<&str>> = found
            .iter()
            .map(|event| match event {
                ReadEvent::Line { raw, .. } => Some(raw.as_str()),
                ReadEvent::Eof => None,
            })
            .collect();
        assert_eq!(
            raws,
            [
                Some("id name T"),
                Some("\u{fffd}\u{fffd}"),
                Some("usiok"),
                None
            ]
        );
        assert!(matches!(
            found[2],
            ReadEvent::Line {
                parsed: Some(EngineCommand::UsiOk),
                ..
            }
        ));
    }
}

/// 実プロセスのテストが台本を置いて起こす口。`child` と `protocol` のテストが共有する。
#[cfg(all(test, unix))]
pub(crate) mod script {
    use super::{spawn, EngineChild};
    use rustix::io::Errno;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use std::time::Duration;

    /// 書き込み中として断られたときに起こし直す回数。1回あたり `BUSY_WAIT` 待つ
    const BUSY_RETRIES: usize = 100;
    const BUSY_WAIT: Duration = Duration::from_millis(10);

    /// `#!/bin/sh` の台本を `dir` に置いて起こす。
    ///
    /// **`ExecutableFileBusy`（ETXTBSY）なら起こし直す。** テストは並列に走る。台本を
    /// 書いている間に別のテストが fork すると、書き込み用の fd がその子へ exec までの間だけ
    /// 継がれ、その隙に台本を exec すると「書き込み中のファイル」として OS に断られる。
    /// 窓は他人の fork から exec までなので、待てば閉じる
    pub(crate) async fn spawn_script(dir: &Path, body: &str) -> EngineChild {
        let path = dir.join("engine.sh");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("書けない");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("権限を変えられない");
        for _ in 0..BUSY_RETRIES {
            match spawn(&path, dir) {
                // `ErrorKind::ExecutableFileBusy` は MSRV より新しいので errno で見る
                Err(e) if Errno::from_io_error(&e) == Some(Errno::TXTBSY) => {
                    tokio::time::sleep(BUSY_WAIT).await;
                }
                spawned => return spawned.expect("起こせる"),
            }
        }
        panic!("台本が書き込み中のまま起こせない: {}", path.display());
    }

    /// 台本が書いた pid を読む。並列で走るテストの負荷で台本の起動が遅れても待てるだけ取る
    pub(crate) async fn read_pid(path: &Path) -> String {
        for _ in 0..1000 {
            if let Ok(pid) = std::fs::read_to_string(path) {
                if !pid.trim().is_empty() {
                    return pid.trim().to_string();
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("台本が pid を書かない: {}", path.display());
    }

    /// その pid のプロセスが生きているか（`kill -0`）
    pub(crate) fn is_alive(pid: &str) -> bool {
        std::process::Command::new("kill")
            .args(["-0", pid])
            .status()
            .is_ok_and(|s| s.success())
    }

    /// その pid のプロセスが `limit` のうちに終わるか
    pub(crate) async fn ends_within(pid: &str, limit: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + limit;
        while is_alive(pid) {
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        true
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::script::{ends_within, is_alive, read_pid, spawn_script};
    use super::*;
    use test_support::dir::temp_dir;
    use tokio::sync::mpsc;

    /// stdout の全件を集める。`Eof` まで
    async fn read_all(child: &EngineChild) -> Vec<ReadEvent> {
        let (tx, mut rx) = mpsc::unbounded_channel();
        assert!(child.read_stdout(move |event| tx.send(event).is_ok()));
        let mut events = Vec::new();
        while let Some(event) = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("上限内に終わらない")
        {
            let eof = matches!(event, ReadEvent::Eof);
            events.push(event);
            if eof {
                break;
            }
        }
        events
    }

    async fn exited(child: &EngineChild) -> Exit {
        match child.diagnostics().wait_exit(Duration::from_secs(10)).await {
            Waited::Ended(exit) => exit,
            other => panic!("終わっていない: {other:?}"),
        }
    }

    fn parsed_of(event: &ReadEvent) -> Option<EngineCommand> {
        match event {
            ReadEvent::Line { parsed, .. } => parsed.clone(),
            ReadEvent::Eof => None,
        }
    }

    /// 解けない行・UTF-8 でない行・空行があっても読み続ける。
    /// `usi` crate の `listen` は、`score` の数値の溢れ（`IllegalNumberFormat`）と
    /// UTF-8 でない行（読み取りの `InvalidData`）で、そこから先を全部捨てる
    #[tokio::test]
    async fn reading_goes_on_past_lines_it_cannot_parse() {
        let dir = temp_dir("child-lines");
        let child = spawn_script(
            &dir,
            r#"printf 'id name T\n\n\377\376 garbage\ninfo score cp 99999999999999999999\nusiok\n'"#,
        ).await;

        let events = read_all(&child).await;
        let commands: Vec<_> = events
            .iter()
            .filter(|e| !matches!(e, ReadEvent::Eof))
            .map(parsed_of)
            .collect();

        assert_eq!(commands.len(), 4, "空行は捨て、残り4行は届く: {events:?}");
        assert!(matches!(commands[0], Some(EngineCommand::Id(_))));
        // UTF-8 でない行は置き換え文字にして渡す（知らない語なので `Unknown`）
        assert_eq!(commands[1], Some(EngineCommand::Unknown));
        assert_eq!(
            commands[2], None,
            "`score` の数値が溢れた行は解けないが届く"
        );
        assert_eq!(commands[3], Some(EngineCommand::UsiOk));
        assert!(matches!(events.last(), Some(ReadEvent::Eof)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 改行の無い長い出力は切って、解かずに渡す。その後の行は読める
    #[tokio::test]
    async fn an_overlong_line_is_cut_and_not_parsed() {
        let dir = temp_dir("child-long");
        let child = spawn_script(
            &dir,
            &format!(
                "head -c {} /dev/zero | tr '\\000' 'a'; printf '\\nusiok\\n'",
                MAX_LINE * 2
            ),
        )
        .await;

        let events = read_all(&child).await;
        let ReadEvent::Line { raw, parsed } = &events[0] else {
            panic!("最初の行が来ていない: {:?}", events.first());
        };
        assert_eq!(raw.len(), MAX_LINE, "上限で切っていない");
        assert!(parsed.is_none(), "切った行を解いている");
        assert_eq!(parsed_of(&events[1]), Some(EngineCommand::UsiOk));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// stderr は直近の出力として残り、終わり方も取れる
    #[tokio::test]
    async fn stderr_and_the_exit_status_are_kept() {
        let dir = temp_dir("child-stderr");
        let child = spawn_script(&dir, "echo 'dyld: Library not loaded' >&2; exit 3").await;

        let Exit::Status(status) = exited(&child).await else {
            panic!("終わり方が取れていない");
        };
        assert_eq!(status.code(), Some(3));
        child
            .diagnostics()
            .settle_output(Duration::from_secs(10))
            .await;
        assert_eq!(
            child.diagnostics().recent_lines(),
            [(Source::Stderr, "dyld: Library not loaded".to_string())]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// stdout が先に閉じ、stderr が遅れて書かれても、`settle_output` の後には読めている
    #[tokio::test]
    async fn settling_waits_for_stderr_that_arrives_after_stdout_closes() {
        let dir = temp_dir("child-late-stderr");
        let child = spawn_script(&dir, "exec 1>&-; sleep 0.3; echo 'late' >&2").await;

        let events = read_all(&child).await;
        assert!(matches!(events.as_slice(), [ReadEvent::Eof]), "{events:?}");
        child
            .diagnostics()
            .settle_output(Duration::from_secs(10))
            .await;
        assert_eq!(
            child.diagnostics().recent_lines(),
            [(Source::Stderr, "late".to_string())]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// stdout を閉じても stderr を開いたまま走り続ける子で、`Eof` が届く
    #[tokio::test]
    async fn eof_arrives_when_stdout_closes_even_if_stderr_stays_open() {
        let dir = temp_dir("child-stdout-closed");
        let child = spawn_script(&dir, "exec 1>&-; exec sleep 30").await;

        let events = read_all(&child).await;
        assert!(matches!(events.as_slice(), [ReadEvent::Eof]), "{events:?}");
        assert!(matches!(
            child.kill_and_wait(KILL_TIMEOUT).await,
            KillOutcome::Ended(_)
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 書いた行が届き、落とすと終わりを見届け、2度目は頼み直さない。書く口は1回きり
    #[tokio::test]
    async fn a_written_line_arrives_and_kill_ends_the_process() {
        let dir = temp_dir("child-echo");
        let child = spawn_script(&dir, "exec cat").await;
        let (tx, mut rx) = mpsc::unbounded_channel();
        assert!(child.read_stdout(move |event| tx.send(event).is_ok()));
        assert!(!child.read_stdout(|_| true), "2度読み始めている");
        let writer = child.take_writer().expect("書く口が取れる");
        assert!(child.take_writer().is_none(), "書く口を2本渡している");

        writer.write_line("usiok").await.expect("書ける");
        let echoed = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("届かない")
            .expect("読み手が消えた");
        assert_eq!(parsed_of(&echoed), Some(EngineCommand::UsiOk));

        assert!(matches!(
            child.kill_and_wait(KILL_TIMEOUT).await,
            KillOutcome::Ended(_)
        ));
        assert_eq!(
            child.kill_and_wait(KILL_TIMEOUT).await,
            KillOutcome::AlreadyExited,
            "終わった後の2度目が頼み直している"
        );
        let error = writer
            .write_line("isready")
            .await
            .expect_err("落とした後も書けている");
        assert_eq!(error.kind(), std::io::ErrorKind::NotConnected);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 書き込みが詰まって stdin のロックが取られていても、kill は返り、プロセスは落ちる。
    ///
    /// **`KILL_TIMEOUT` の2倍で打ち切る。** 打ち切らないと、kill が stdin のロックを待つ形に
    /// 戻ったとき、台本の `sleep` が終わるまで30秒止まってから `AlreadyExited` で落ち、
    /// 何を待っていたのかが出ない
    #[tokio::test]
    async fn kill_is_not_blocked_by_a_stuck_write() {
        let dir = temp_dir("child-stuck");
        // stdin を一切読まない
        let child = spawn_script(&dir, "exec sleep 30").await;

        let writer = child.take_writer().expect("書く口が取れる");
        let big = "x".repeat(4 * 1024 * 1024);
        let stuck = tokio::spawn(async move { writer.write_line(&big).await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!stuck.is_finished(), "詰まっていない（パイプが大きすぎる）");

        let killed = tokio::time::timeout(KILL_TIMEOUT * 2, child.kill_and_wait(KILL_TIMEOUT))
            .await
            .expect("書き込みが詰まったまま kill が返らない");
        assert!(matches!(killed, KillOutcome::Ended(_)), "{killed:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `#!` のラッパーから起こした孫プロセスも落ちる（プロセスグループごと落とす）
    #[tokio::test]
    async fn killing_a_wrapper_also_ends_its_children() {
        let dir = temp_dir("child-grandchild");
        let pid_file = dir.join("grandchild.pid");
        let child = spawn_script(
            &dir,
            &format!("sleep 30 & echo $! > '{}'; wait", pid_file.display()),
        )
        .await;
        let grandchild = read_pid(&pid_file).await;
        assert!(is_alive(&grandchild), "孫が起きていない");

        assert!(matches!(
            child.kill_and_wait(KILL_TIMEOUT).await,
            KillOutcome::Ended(_)
        ));
        assert!(
            ends_within(&grandchild, Duration::from_secs(10)).await,
            "孫が孤児として残っている"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `EngineChild` を捨てるとプロセスも落ちる。パニックしない
    #[tokio::test]
    async fn dropping_the_child_ends_the_process() {
        let dir = temp_dir("child-drop");
        let child = spawn_script(&dir, "exec sleep 30").await;
        let diagnostics = child.diagnostics();
        drop(child);

        assert!(
            matches!(
                diagnostics.wait_exit(Duration::from_secs(10)).await,
                Waited::Ended(_)
            ),
            "捨てても落ちていない"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
