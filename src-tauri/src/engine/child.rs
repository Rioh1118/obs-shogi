//! エンジンの子プロセスと、その標準入出力の持ち主。
//!
//! **stdin・stdout・stderr・プロセスをそれぞれ別の持ち主にする。** 1つの構造体を
//! 1つのロックの下に置くと、stdin への書き込みが詰まったときに同じロックを取る
//! kill が返らない（#353）。ここでは kill はチャンネルで待ち手のタスクへ頼むだけで、
//! どのロックも取らない。
//!
//! 行の解析は `usi` crate の `EngineCommand::parse` に任せる。任せないのは読み方で、
//! 解けない行・UTF-8 でない行・長すぎる行があっても**読み取りを止めない**
//! （止めると以後の出力が全部消え、エンジンが生きたまま「出力が終わった」に見える）。

use std::collections::VecDeque;
use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex as StdMutex};

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{oneshot, watch, Mutex};
use usi::EngineCommand;

/// 1行として受け取る上限（バイト）。**メモリを守るためだけ**の値。
///
/// 改行を出さないストリーム（取り違えたバイナリ、ログを垂れ流す実行ファイル）で
/// 読み込みが際限なく伸びないように切る。長い詰みの読み筋は数 KB なので、
/// 正常なエンジンの行がここに届くことはない。
pub const MAX_LINE: usize = 1024 * 1024;

/// 直近の出力として持つ行数。起動に失敗したときの理由に添える材料
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
    /// 1行。`parsed` は解けなかったとき `None`（`usi` crate が知らない形、
    /// 数値が溢れた、`MAX_LINE` を超えて切った）。**読み取りは続く。**
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

/// `kill` を頼んだ結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[must_use = "落とせたかどうかを読まないと、残ったことを知る手掛かりが無くなる"]
pub enum KillRequest {
    /// 待ち手へ頼んだ
    Sent,
    /// 既に頼んであった。2度目以降
    AlreadySent,
    /// 頼む前に終わっていた
    AlreadyExited,
}

/// 子プロセス1本。
///
/// **Drop するとプロセスも落ちる**（待ち手が kill の頼みの口が閉じたことで気付く）。
/// 落とし損ねてもパニックはしない。
pub struct EngineChild {
    pid: Option<u32>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    stdout: StdMutex<Option<ChildStdout>>,
    kill: StdMutex<Option<oneshot::Sender<()>>>,
    exit: watch::Receiver<Option<Exit>>,
    recent: Arc<StdMutex<VecDeque<(Source, String)>>>,
}

/// 子プロセスを起こす。**tokio のランタイムの中で呼ぶこと**（`spawn_blocking` の中でもよい）。
///
/// 引数は渡さない。cwd は `work_dir`。
pub fn spawn(program: &Path, work_dir: &Path) -> std::io::Result<EngineChild> {
    let mut child = tokio::process::Command::new(program)
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let recent = Arc::new(StdMutex::new(VecDeque::with_capacity(RECENT_LINES)));
    if let Some(stderr) = stderr {
        tokio::spawn(read_stderr(BufReader::new(stderr), Arc::clone(&recent)));
    }

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let (exit_tx, exit_rx) = watch::channel(None);
    tokio::spawn(async move {
        // 頼みが来たか、頼みの口が落ちた（`EngineChild` の Drop）ら落とす
        let waited = tokio::select! {
            waited = child.wait() => waited,
            _ = kill_rx => {
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
        pid,
        stdin: Arc::new(Mutex::new(stdin)),
        stdout: StdMutex::new(stdout),
        kill: StdMutex::new(Some(kill_tx)),
        exit: exit_rx,
        recent,
    })
}

const LOGT: &str = "obs_shogi::engine::child";

impl EngineChild {
    /// OS のプロセス番号。起動直後に終わっていると無いことがある
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// stdin の口。書き込みの列（`protocol::run_writer`）が持つ。
    ///
    /// `None` になっているのは落とした後。
    pub fn stdin(&self) -> Arc<Mutex<Option<ChildStdin>>> {
        Arc::clone(&self.stdin)
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
            Arc::clone(&self.recent),
            hook,
        ));
        true
    }

    /// 落とすよう待ち手に頼む。**待たない。** 終わったかは `exit` で見る。
    ///
    /// stdin も閉じる。ただし書き込みが詰まって stdin のロックが取れないときは
    /// 閉じずに進む——落とせばパイプはどのみち閉じる。
    pub fn kill(&self) -> KillRequest {
        if let Ok(mut stdin) = self.stdin.try_lock() {
            stdin.take();
        }
        if self.exit.borrow().is_some() {
            return KillRequest::AlreadyExited;
        }
        match lock(&self.kill).take() {
            Some(tx) => {
                // 受け手が居ないのは、待ち手が終了を見届けて抜けた後だけ
                if tx.send(()).is_err() {
                    KillRequest::AlreadyExited
                } else {
                    KillRequest::Sent
                }
            }
            None => KillRequest::AlreadySent,
        }
    }

    /// 終わり方。終わるまでは `None`
    pub fn exit(&self) -> watch::Receiver<Option<Exit>> {
        self.exit.clone()
    }

    /// 直近の出力（stdout と stderr を着いた順に）。起動に失敗したときの理由に添える
    pub fn recent_lines(&self) -> Vec<(Source, String)> {
        lock(&self.recent).iter().cloned().collect()
    }
}

/// 1行を書く。改行はこちらで足す。
///
/// 落とした後（stdin を閉じた後）は `NotConnected` を返す。相手が読み口を閉じた
/// `BrokenPipe` とは原因が違うので分ける
pub async fn write_line(stdin: &Mutex<Option<ChildStdin>>, line: &str) -> std::io::Result<()> {
    let mut guard = stdin.lock().await;
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

fn lock<T>(mutex: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    // 中身は `Option` の差し替えだけなので、毒されても値は壊れていない
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

/// 改行まで読む。`max` を超えた分は**読みながら捨てる**（読み切ってから切ると、
/// 改行の無いストリームで確保が際限なく伸びる）。EOF で読めた分が無ければ `None`
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
        let (chunk, found_newline) = match available.iter().position(|b| *b == b'\n') {
            Some(i) => (&available[..=i], true),
            None => (available, false),
        };
        let room = max.saturating_sub(bytes.len());
        if chunk.len() > room {
            truncated = true;
        }
        bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
        let used = chunk.len();
        reader.consume(used);
        if found_newline {
            return Ok(Some(BoundedLine { bytes, truncated }));
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::time::Duration;
    use test_support::dir::temp_dir;
    use tokio::sync::mpsc;

    /// `#!/bin/sh` の台本を実行ファイルとして置く
    fn script(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("engine.sh");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("書けない");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("権限を変えられない");
        path
    }

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
        let mut exit = child.exit();
        let settled = tokio::time::timeout(Duration::from_secs(10), exit.wait_for(|e| e.is_some()))
            .await
            .expect("上限内に終わらない")
            .expect("待ち手が消えた");
        settled.expect("終わっている")
    }

    fn parsed(events: &[ReadEvent]) -> Vec<Option<EngineCommand>> {
        events
            .iter()
            .filter_map(|e| match e {
                ReadEvent::Line { parsed, .. } => Some(parsed.clone()),
                ReadEvent::Eof => None,
            })
            .collect()
    }

    /// 解けない行・UTF-8 でない行・空行があっても読み続ける。
    /// `usi` crate の `listen` は、数値の溢れや UTF-8 でない行でそこから先を全部捨てる
    #[tokio::test]
    async fn reading_goes_on_past_lines_it_cannot_parse() {
        let dir = temp_dir("child-lines");
        let path = script(
            &dir,
            r#"printf 'id name T\n\n\377\376 garbage\ninfo nodes 99999999999999999999\nusiok\n'"#,
        );
        let child = spawn(&path, &dir).expect("起こせる");

        let events = read_all(&child).await;
        let commands = parsed(&events);

        assert_eq!(commands.len(), 4, "空行は捨て、残り4行は届く: {events:?}");
        assert!(matches!(commands[0], Some(EngineCommand::Id(_))));
        // UTF-8 でない行は置き換え文字にして渡す（`usi` crate は知らない語を `Unknown` と解く）
        assert_eq!(commands[1], Some(EngineCommand::Unknown));
        assert_eq!(commands[2], None, "数値が溢れた行も読み取りを止めない");
        assert_eq!(commands[3], Some(EngineCommand::UsiOk));
        assert!(matches!(events.last(), Some(ReadEvent::Eof)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 改行の無い長い出力は切って、解かずに渡す。その後の行は読める
    #[tokio::test]
    async fn an_overlong_line_is_cut_and_not_parsed() {
        let dir = temp_dir("child-long");
        let path = script(
            &dir,
            &format!(
                "head -c {} /dev/zero | tr '\\000' 'a'; printf '\\nusiok\\n'",
                MAX_LINE * 2
            ),
        );
        let child = spawn(&path, &dir).expect("起こせる");

        let events = read_all(&child).await;
        let ReadEvent::Line { raw, parsed } = &events[0] else {
            panic!("最初の行が来ていない: {:?}", events.first());
        };
        assert_eq!(raw.len(), MAX_LINE, "上限で切っていない");
        assert!(parsed.is_none(), "切った行を解いている");
        assert_eq!(parsed_of(&events[1]), Some(EngineCommand::UsiOk));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn parsed_of(event: &ReadEvent) -> Option<EngineCommand> {
        match event {
            ReadEvent::Line { parsed, .. } => parsed.clone(),
            ReadEvent::Eof => None,
        }
    }

    /// stderr は直近の出力として残り、終わり方も取れる
    #[tokio::test]
    async fn stderr_and_the_exit_status_are_kept() {
        let dir = temp_dir("child-stderr");
        let path = script(&dir, "echo 'dyld: Library not loaded' >&2; exit 3");
        let child = spawn(&path, &dir).expect("起こせる");

        let Exit::Status(status) = exited(&child).await else {
            panic!("終わり方が取れていない");
        };
        assert_eq!(status.code(), Some(3));
        // 待ち手と stderr の読み手は別のタスクなので、行が着くまで少し待つ
        for _ in 0..100 {
            if !child.recent_lines().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            child.recent_lines(),
            [(Source::Stderr, "dyld: Library not loaded".to_string())]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// stdout を閉じても stderr を開いたまま走り続ける子で、`Eof` が届く
    #[tokio::test]
    async fn eof_arrives_when_stdout_closes_even_if_stderr_stays_open() {
        let dir = temp_dir("child-stdout-closed");
        let path = script(&dir, "exec 1>&-; sleep 30");
        let child = spawn(&path, &dir).expect("起こせる");

        let events = read_all(&child).await;
        assert!(matches!(events.as_slice(), [ReadEvent::Eof]), "{events:?}");
        assert_eq!(child.kill(), KillRequest::Sent);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 書いた行が届き、`kill` で落ち、2度目の `kill` は頼み直さない
    #[tokio::test]
    async fn a_written_line_arrives_and_kill_ends_the_process() {
        let dir = temp_dir("child-echo");
        let path = script(&dir, "exec cat");
        let child = spawn(&path, &dir).expect("起こせる");
        let (tx, mut rx) = mpsc::unbounded_channel();
        assert!(child.read_stdout(move |event| tx.send(event).is_ok()));
        assert!(!child.read_stdout(|_| true), "2度読み始めている");

        write_line(&child.stdin(), "usiok").await.expect("書ける");
        let echoed = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("届かない")
            .expect("読み手が消えた");
        assert_eq!(parsed_of(&echoed), Some(EngineCommand::UsiOk));

        assert_eq!(child.kill(), KillRequest::Sent);
        assert!(matches!(exited(&child).await, Exit::Status(_)));
        assert_ne!(child.kill(), KillRequest::Sent, "2度頼んでいる");
        assert!(
            write_line(&child.stdin(), "isready").await.is_err(),
            "落とした後も書けている"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 書き込みが詰まって stdin のロックが取られていても、kill は返り、プロセスは落ちる
    #[tokio::test]
    async fn kill_is_not_blocked_by_a_stuck_write() {
        let dir = temp_dir("child-stuck");
        // stdin を一切読まない
        let path = script(&dir, "exec sleep 30");
        let child = spawn(&path, &dir).expect("起こせる");

        let stdin = child.stdin();
        let big = "x".repeat(4 * 1024 * 1024);
        let stuck = tokio::spawn(async move { write_line(&stdin, &big).await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!stuck.is_finished(), "詰まっていない（パイプが大きすぎる）");

        assert_eq!(child.kill(), KillRequest::Sent);
        assert!(matches!(exited(&child).await, Exit::Status(_)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `EngineChild` を捨てるとプロセスも落ちる。パニックしない
    #[tokio::test]
    async fn dropping_the_child_ends_the_process() {
        let dir = temp_dir("child-drop");
        let path = script(&dir, "exec sleep 30");
        let child = spawn(&path, &dir).expect("起こせる");
        let mut exit = child.exit();
        drop(child);

        tokio::time::timeout(Duration::from_secs(10), exit.wait_for(|e| e.is_some()))
            .await
            .expect("捨てても落ちていない")
            .expect("待ち手が消えた");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
