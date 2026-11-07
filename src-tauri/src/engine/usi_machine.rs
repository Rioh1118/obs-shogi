//! 1本のエンジンプロセスとの USI のやりとりの状態と判定（ADR-0016 決定1）。**時計も IO も持たない。**
//!
//! 入力は、受けた行（`on_line`）、出力の終わり（`on_output_end`）、書き込みの詰まり（`on_write_stalled`）と、
//! 手順が頼むこと（`identify` から `kill` まで）。してほしいことは `Effect` として出た順に溜め、
//! 持ち主（`protocol` の `UsiProtocol`）が `take_effects` で取り出して順に行う。
//! 状態と入力の全部の組は `docs/state-transitions/engine.md` の「1本のプロセスの USI の状態」の表で、記号（Q0〜Q5、L1〜L9、W1、R1〜R11）は
//! そこに揃える。
//!
//! 待つ上限は持たない（決定2）。待つ者が諦めても状態は変わらず、答えは札（`Ticket`）に宛てて出す。
//! 諦めた者の札に宛てた答えは、持ち主が黙って捨てる。

mod declared;

use usi::{
    BestMoveParams, CheckmateParams, EngineCommand, GameOverKind, GuiCommand, IdParams, InfoParams,
    ThinkParams,
};

use crate::engine::types::{EngineEnd, EngineError, EngineInfo, SetOptionValue, StartupReason};
use declared::DeclaredOptions;

/// こちらが落とした後に送ろうとしたときの文言
pub const GONE: &str = "engine process has been shut down";
/// 出力が終わったプロセスへ送ろうとしたときの文言
pub const CLOSED: &str = "engine output has ended; the process cannot be reached";
/// 書き込みが詰まったプロセスへ送ろうとしたときの文言。
/// **`CLOSED` と分ける。** あちらは読み取りが終わった状態で、こちらは
/// 出力は続いているのに stdin を読まなくなった状態。原因も直し方も違う
pub const STALLED: &str = "the engine stopped reading stdin; the process cannot be reached";

/// 探索が走っている間、次の探索を断る文言。手順「探索」は、これを返す前に前の探索の終わりを待つ
const SEARCH_NOT_ENDED: &str = "the previous search on this engine has not ended";

/// 探索1本が受ける行。生の USI の形のまま渡す（畳み方は呼び手が `apply_info_params` で決める）
#[derive(Debug)]
pub enum SearchLine {
    Info(Vec<InfoParams>),
    Checkmate(CheckmateParams),
    /// 最後の行。この後その探索には何も流さない。手を読むのは対局だけ（検討は手を使わない）
    BestMove(BestMoveParams),
}

/// 答えを待つ者の札。待つ手順が1つ頼むごとに1枚出す
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Ticket(u64);

/// 探索1本の番号。`Search` が持ち、止める・先読みを本番にする・捨てるの頼みに添える。
/// 走っている探索と番号が違えば、その探索は既に終わっている
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SearchId(u64);

/// 頼みへの答えが、その場で決まったか、札で待つか。持ち主は札を、答えを受け取る `oneshot` に替えて持つ（`W`）
#[derive(Debug)]
pub enum Asked<T, W = Ticket> {
    Done(T),
    Waiting(W),
}

/// 状態機械がしてほしいこと。**出た順に行う**（不変条件1）
#[derive(Debug)]
pub enum Effect {
    /// 書き込みの列へ入れる
    Write(GuiCommand),
    /// 名乗りの札への答え
    Named(Ticket, Result<EngineInfo, EngineError>),
    /// 準備の札への答え。`readyok` までの `info string` の文
    Prepared(Ticket, Result<Vec<String>, EngineError>),
    /// 値の確認の札への答え。`usiok` までの `info string` の文
    Checked(Ticket, Result<Vec<String>, EngineError>),
    /// 止めの札への答え。`Ok` は `bestmove` で答えた
    Stopped(Ticket, Result<(), EngineError>),
    /// 探索へ流す行
    ToSearch(SearchId, SearchLine),
    /// その探索にはもう何も流さない
    SearchEnded(SearchId),
    /// プロセスを落とす
    Kill,
    /// 記録に残す1行（捨てた行など）
    Note(String),
}

/// `readyok` を待つ準備1つと、その間に受けた `info string` の文
#[derive(Debug)]
struct Preparing {
    ticket: Ticket,
    texts: Vec<String>,
}

/// 値の確認が済んだら戻る先
#[derive(Debug)]
enum Back {
    Unready(Vec<Preparing>),
    Idle,
}

/// 名乗り。**準備や探索の状態とは別に進む。** 名乗らずに準備するエンジン（`usi` に答えない台本）も
/// 準備でき、名乗りを頼まれたときに `usi` を書く
#[derive(Debug)]
enum Naming {
    /// 名乗り前。`id` と `option` 行を集める
    Collecting {
        waiting: Vec<Ticket>,
        name: Option<String>,
        author: String,
        declared: DeclaredOptions,
    },
    /// 名乗りの答え。2回目以降の名乗りはこれを返す
    Named(EngineInfo),
}

/// 状態。記号は `docs/state-transitions/engine.md` の表。Q0 と Q1 は、準備前（`Unready`）のうち
/// 名乗りが済んでいないか（`Naming::Collecting`）で分ける
#[derive(Debug)]
enum State {
    /// Q0 と Q1。`readyok` がまだ
    Unready { waiting: Vec<Preparing> },
    /// Q2 待機
    Idle,
    /// Q2c 値の確認中（`usiok` を待つ）
    Checking {
        ticket: Ticket,
        name: String,
        texts: Vec<String>,
        back: Back,
    },
    /// Q3（`ponder` が偽）と Q3p（真）。探索1本が走っている
    Searching { search: SearchId, ponder: bool },
    /// Q4 止め待ち。`stop` を書いたが `bestmove` がまだ。止めを待つ札が無くてもここに居る
    Stopping {
        search: SearchId,
        waiting: Vec<Ticket>,
    },
    /// Q5 閉じた。吸収状態
    Closed(EngineEnd),
}

/// 1本のプロセスとの USI の状態機械
#[derive(Debug)]
pub struct UsiMachine {
    state: State,
    naming: Naming,
    /// こちらが `quit` を書いた。以後の出力の終わりは `EngineEnd::Requested`
    quit_sent: bool,
    /// 札と探索の番号の元
    issued: u64,
    effects: Vec<Effect>,
}

impl Default for UsiMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl UsiMachine {
    /// 起こした直後（Q0: 準備前で名乗り前）。`usi` を書く前の出力の `option` 行も拾う
    pub fn new() -> Self {
        let mut declared = DeclaredOptions::default();
        declared.begin();
        Self {
            state: State::Unready {
                waiting: Vec::new(),
            },
            naming: Naming::Collecting {
                waiting: Vec::new(),
                name: None,
                author: String::new(),
                declared,
            },
            quit_sent: false,
            issued: 0,
            effects: Vec::new(),
        }
    }

    /// 溜まったしてほしいことを、出た順に取り出す
    pub fn take_effects(&mut self) -> Vec<Effect> {
        std::mem::take(&mut self.effects)
    }

    /// 閉じていれば、その理由
    pub fn end(&self) -> Option<EngineEnd> {
        match self.state {
            State::Closed(end) => Some(end),
            _ => None,
        }
    }

    /// 探索が走っているか、止めの答えを待っているか（Q3、Q3p、Q4）
    pub fn is_searching(&self) -> bool {
        matches!(self.state, State::Searching { .. } | State::Stopping { .. })
    }

    /// 届かない理由。閉じる前に呼ばれたら（探索の行が途切れた回など）、いまの印で選ぶ
    pub fn cannot_reach(&self) -> EngineError {
        let end = match self.end() {
            Some(end) => end,
            None if self.quit_sent => EngineEnd::Requested,
            None => EngineEnd::Exited,
        };
        closed_error(end)
    }

    // --- 読み取り（L1〜L9）と書き込み（W1） ---

    /// 受けた1行。`parsed` は `usi` crate が解いた形で、解けなければ `None`（L9）。
    /// `option` 行（L2）は解けたかに関わらず生の行から解く
    pub fn on_line(&mut self, raw: &str, parsed: Option<EngineCommand>) {
        if let Naming::Collecting { declared, .. } = &mut self.naming {
            declared.note(raw);
        }
        let Some(command) = parsed else { return };
        match command {
            EngineCommand::Id(id) => self.on_id(id),
            EngineCommand::UsiOk => self.on_usiok(),
            EngineCommand::ReadyOk => self.on_readyok(),
            EngineCommand::Info(params) => self.on_info(params),
            EngineCommand::Checkmate(params) => self.on_checkmate(params),
            EngineCommand::BestMove(params) => self.on_bestmove(params),
            _ => {}
        }
    }

    /// L8 出力の終わり。こちらが `quit` を書いた後なら `Requested`、そうでなければ `Exited`
    pub fn on_output_end(&mut self) {
        let end = if self.quit_sent {
            EngineEnd::Requested
        } else {
            EngineEnd::Exited
        };
        self.close(end);
    }

    /// W1 書き込みが上限まで終わらなかった。以後このプロセスへは書かない
    pub fn on_write_stalled(&mut self) {
        self.close(EngineEnd::Stalled);
    }

    fn on_id(&mut self, id: IdParams) {
        if let Naming::Collecting { name, author, .. } = &mut self.naming {
            match id {
                IdParams::Name(n) => *name = Some(n),
                IdParams::Author(a) => *author = a,
            }
        }
    }

    /// `usiok` は、名乗りの集めと値の確認の両方に答える（どちらも `usi` への答え）
    fn on_usiok(&mut self) {
        self.finish_naming();
        if matches!(self.state, State::Checking { .. }) {
            let State::Checking {
                ticket,
                texts,
                back,
                ..
            } = std::mem::replace(&mut self.state, State::Idle)
            else {
                return;
            };
            self.effects.push(Effect::Checked(ticket, Ok(texts)));
            self.state = back.into_state();
        }
    }

    /// 集めた名と宣言で名乗りを済ませ、待つ者に答える。名が無ければ `NO_ID_NAME` で断り、集め直す
    fn finish_naming(&mut self) {
        let Naming::Collecting {
            waiting,
            name,
            author,
            declared,
        } = &mut self.naming
        else {
            return;
        };
        let waiting = std::mem::take(waiting);
        let Some(name) = name.take().filter(|n| !n.is_empty()) else {
            author.clear();
            declared.begin();
            for ticket in waiting {
                self.effects.push(Effect::Named(
                    ticket,
                    Err(EngineError::StartupFailed(StartupReason::NoIdName.into())),
                ));
            }
            return;
        };
        let declared = declared.finish();
        if let Some(problems) = declared.problems() {
            self.effects.push(Effect::Note(problems));
        }
        let info = EngineInfo {
            name,
            author: std::mem::take(author),
            options: declared.options,
        };
        for ticket in waiting {
            self.effects.push(Effect::Named(ticket, Ok(info.clone())));
        }
        self.naming = Naming::Named(info);
    }

    /// `isready` を書いていなければ（準備の札が無ければ）、待機へは移らない
    fn on_readyok(&mut self) {
        if let State::Unready { waiting } = &mut self.state {
            if waiting.is_empty() {
                return;
            }
            for Preparing { ticket, texts } in std::mem::take(waiting) {
                self.effects.push(Effect::Prepared(ticket, Ok(texts)));
            }
            self.state = State::Idle;
        }
    }

    fn on_info(&mut self, params: Vec<InfoParams>) {
        match &mut self.state {
            State::Unready { waiting } => {
                let texts: Vec<String> = info_strings(params).collect();
                for preparing in waiting {
                    preparing.texts.extend(texts.iter().cloned());
                }
            }
            State::Checking { texts, .. } => texts.extend(info_strings(params)),
            State::Searching { search, .. } => {
                let search = *search;
                self.effects
                    .push(Effect::ToSearch(search, SearchLine::Info(params)));
            }
            _ => {}
        }
    }

    fn on_checkmate(&mut self, params: CheckmateParams) {
        if let State::Searching { search, .. } = self.state {
            self.effects
                .push(Effect::ToSearch(search, SearchLine::Checkmate(params)));
        }
    }

    fn on_bestmove(&mut self, params: BestMoveParams) {
        match &mut self.state {
            State::Searching { search, .. } => {
                let search = *search;
                self.effects
                    .push(Effect::ToSearch(search, SearchLine::BestMove(params)));
                self.effects.push(Effect::SearchEnded(search));
                self.state = State::Idle;
            }
            State::Stopping { waiting, .. } => {
                for ticket in std::mem::take(waiting) {
                    self.effects.push(Effect::Stopped(ticket, Ok(())));
                }
                self.state = State::Idle;
            }
            // 頼んでいない `bestmove`。捨てて記録する（前の探索のものを次の探索へ流さない。不変条件2）
            State::Idle => self.effects.push(Effect::Note(
                "usi: dropped a bestmove that no search asked for".to_string(),
            )),
            _ => {}
        }
    }

    // --- 頼まれたこと（R1〜R11） ---

    /// R1 名乗り。名乗り済みなら覚えた答えを返す。名乗りの待ちが既にあれば `usi` を書き直さず、同じ答えを待つ。
    ///
    /// 探索中・止め待ちは `usi` を書けない（不変条件3）ので断る。値の確認中は、確認の `usi` への答えを待つ
    pub fn identify(&mut self) -> Result<Asked<EngineInfo>, EngineError> {
        if let State::Closed(end) = self.state {
            // 名乗る前に閉じたなら、名乗りの待ちが受けたはずの断りと同じにする
            // （読み取りが手順より先に終わりを見る回と、手順が待つ間に終わる回で文言を分けない）
            return Err(match &self.naming {
                Naming::Collecting { .. } => unnamed_closed(end),
                Naming::Named(_) => closed_error(end),
            });
        }
        let writable = matches!(self.state, State::Unready { .. } | State::Idle);
        let asked = matches!(self.state, State::Checking { .. });
        let ticket = Ticket(self.issued + 1);
        match &mut self.naming {
            Naming::Named(info) => return Ok(Asked::Done(info.clone())),
            Naming::Collecting { waiting, .. } => {
                if waiting.is_empty() && !asked {
                    if !writable {
                        return Err(refuse("asking the engine its name", &self.state));
                    }
                    self.effects.push(Effect::Write(GuiCommand::Usi));
                }
                waiting.push(ticket);
            }
        }
        self.issued += 1;
        Ok(Asked::Waiting(ticket))
    }

    /// R2 準備。`setoption` を並べた順に書き、`isready` を**必ず**書いて `readyok` を待つ（→ Q1）。
    ///
    /// 値の確認の答えを待っている（Q2c）ときは、その確認を諦めたものとして断りを返してから進む。
    /// 確認の上限を過ぎた呼び手は、答えを待たずに準備へ進む（`setup::check_book_path_support` の `NoAnswer`）
    pub fn prepare(&mut self, options: &[SetOptionValue]) -> Result<Ticket, EngineError> {
        let mut waiting = match std::mem::replace(&mut self.state, State::Idle) {
            State::Unready { waiting } => waiting,
            State::Idle => Vec::new(),
            State::Checking {
                ticket, name, back, ..
            } => {
                self.effects.push(Effect::Checked(
                    ticket,
                    Err(EngineError::Cancelled(format!(
                        "the check of `{name}` was given up for preparing the engine"
                    ))),
                ));
                match back {
                    Back::Unready(waiting) => waiting,
                    Back::Idle => Vec::new(),
                }
            }
            other => {
                let refused = refuse("preparing the engine", &other);
                self.state = other;
                return Err(refused);
            }
        };
        for SetOptionValue { name, value } in options {
            self.effects.push(Effect::Write(GuiCommand::SetOption(
                name.clone(),
                Some(value.clone()),
            )));
        }
        self.effects.push(Effect::Write(GuiCommand::IsReady));
        let ticket = self.issue_ticket();
        waiting.push(Preparing {
            ticket,
            texts: Vec::new(),
        });
        self.state = State::Unready { waiting };
        Ok(ticket)
    }

    /// R3 値の確認。`setoption` と `usi` を書いて `usiok` を待つ（→ Q2c）。宣言は作り直さない
    pub fn check_value(&mut self, name: &str, value: &str) -> Result<Ticket, EngineError> {
        let back = match std::mem::replace(&mut self.state, State::Idle) {
            State::Unready { waiting } => Back::Unready(waiting),
            State::Idle => Back::Idle,
            other => {
                let refused = refuse("checking a value", &other);
                self.state = other;
                return Err(refused);
            }
        };
        self.effects.push(Effect::Write(GuiCommand::SetOption(
            name.to_string(),
            Some(value.to_string()),
        )));
        self.effects.push(Effect::Write(GuiCommand::Usi));
        let ticket = self.issue_ticket();
        self.state = State::Checking {
            ticket,
            name: name.to_string(),
            texts: Vec::new(),
            back,
        };
        Ok(ticket)
    }

    /// R4 新しい対局。待機（Q2）でだけ `usinewgame` を書く。`readyok` の前は積まずに断る（ADR-0016 決定3）
    pub fn new_game(&mut self) -> Result<(), EngineError> {
        self.write_when_idle(GuiCommand::UsiNewGame, "starting a new game")
    }

    /// R9 終局。待機（Q2）でだけ `gameover` を書く。探索中の `gameover` は USI が認めない（不変条件3）
    pub fn game_over(&mut self, kind: GameOverKind) -> Result<(), EngineError> {
        self.write_when_idle(GuiCommand::GameOver(kind), "ending the game")
    }

    /// R5 探索。待機（Q2）でだけ `position` と `go` を書く（→ Q3 か Q3p）。`readyok` の前は積まずに断る（決定3）
    pub fn search(
        &mut self,
        position: String,
        params: ThinkParams,
    ) -> Result<SearchId, EngineError> {
        if !matches!(self.state, State::Idle) {
            return Err(match &self.state {
                State::Searching { .. } | State::Stopping { .. } => {
                    EngineError::InvalidState(SEARCH_NOT_ENDED.to_string())
                }
                other => refuse("starting a search", other),
            });
        }
        let ponder = is_ponder(&params);
        self.effects
            .push(Effect::Write(GuiCommand::Position(position)));
        self.effects.push(Effect::Write(GuiCommand::Go(params)));
        let search = SearchId(self.issue());
        self.state = State::Searching { search, ponder };
        Ok(search)
    }

    /// R6 先読みを本番にする。その探索が先読み中（Q3p）のときだけ `ponderhit` を書く（→ Q3）
    pub fn ponderhit(&mut self, id: SearchId) -> Result<(), EngineError> {
        match &mut self.state {
            State::Searching { search, ponder } if *search == id && *ponder => {
                *ponder = false;
                self.effects.push(Effect::Write(GuiCommand::Ponderhit));
                Ok(())
            }
            State::Closed(end) => Err(closed_error(*end)),
            _ => Err(EngineError::InvalidState(
                "ponderhit is only for a ponder search that has not answered".to_string(),
            )),
        }
    }

    /// R7 止める。走っている探索なら `stop` を書いて答えを待つ（→ Q4）。止め待ちなら同じ答えを待つ。
    ///
    /// **走っていない探索は「答えた」。** 探索は `bestmove` か閉じることでしか終わらないので、
    /// 閉じていなければ、その探索は既に `bestmove` で答えている
    pub fn stop(&mut self, id: SearchId) -> Result<Asked<()>, EngineError> {
        match self.state {
            State::Searching { search, .. } if search == id => {
                let ticket = self.issue_ticket();
                self.effects.push(Effect::Write(GuiCommand::Stop));
                self.effects.push(Effect::SearchEnded(id));
                self.state = State::Stopping {
                    search: id,
                    waiting: vec![ticket],
                };
                Ok(Asked::Waiting(ticket))
            }
            State::Stopping { search, .. } if search == id => {
                let ticket = self.issue_ticket();
                if let State::Stopping { waiting, .. } = &mut self.state {
                    waiting.push(ticket);
                }
                Ok(Asked::Waiting(ticket))
            }
            State::Closed(end) => Err(closed_error(end)),
            _ => Ok(Asked::Done(())),
        }
    }

    /// R8 探索を止めずに捨てた。走っていれば `stop` だけを書く（→ Q4）。待つ者は居ない
    pub fn drop_search(&mut self, id: SearchId) {
        if let State::Searching { search, .. } = self.state {
            if search == id {
                self.effects.push(Effect::Write(GuiCommand::Stop));
                self.effects.push(Effect::SearchEnded(id));
                self.state = State::Stopping {
                    search: id,
                    waiting: Vec::new(),
                };
            }
        }
    }

    /// R10 `quit`。印を立ててから書く。以後の出力の終わりは `Requested`
    pub fn quit(&mut self) {
        if matches!(self.state, State::Closed(_)) {
            return;
        }
        self.quit_sent = true;
        self.effects.push(Effect::Write(GuiCommand::Quit));
    }

    /// R11 kill。閉じて（理由は `Requested`）、待っている札に全部答えてから、落とす指示を出す。
    /// 閉じた後も落とす指示は出す（2回目は空振りする）
    pub fn kill(&mut self) {
        self.close(EngineEnd::Requested);
        self.effects.push(Effect::Kill);
    }

    // --- 閉じる ---

    /// Q5 へ入る。待っている札に全部答え、走っている探索を閉じる。
    ///
    /// **`Requested` は他の理由より強い。** 閉じた後でも、こちらが落とせば理由は `Requested` へ上がる。
    /// 詰まったプロセスを利用者が後から終了させたとき、見せるべきは自分の操作の結果のほう
    fn close(&mut self, end: EngineEnd) {
        if let Naming::Collecting { waiting, .. } = &mut self.naming {
            for ticket in std::mem::take(waiting) {
                self.effects
                    .push(Effect::Named(ticket, Err(unnamed_closed(end))));
            }
        }
        let previous = std::mem::replace(&mut self.state, State::Closed(end));
        match previous {
            State::Closed(was) => {
                if end != EngineEnd::Requested {
                    self.state = State::Closed(was);
                }
            }
            State::Unready { waiting } => self.answer_unready(waiting, end),
            State::Idle => {}
            State::Checking {
                ticket, name, back, ..
            } => {
                let refused = match end {
                    EngineEnd::Exited => EngineError::CommunicationFailed(
                        format!("engine output ended while checking the value of `{name}`").into(),
                    ),
                    EngineEnd::Requested => EngineError::Cancelled(format!(
                        "the engine was stopped while checking the value of `{name}`"
                    )),
                    EngineEnd::Stalled => closed_error(end),
                };
                self.effects.push(Effect::Checked(ticket, Err(refused)));
                if let Back::Unready(waiting) = back {
                    self.answer_unready(waiting, end);
                }
            }
            State::Searching { search, .. } => self.effects.push(Effect::SearchEnded(search)),
            State::Stopping { waiting, .. } => {
                for ticket in waiting {
                    self.effects
                        .push(Effect::Stopped(ticket, Err(closed_error(end))));
                }
            }
        }
    }

    fn answer_unready(&mut self, waiting: Vec<Preparing>, end: EngineEnd) {
        for Preparing { ticket, .. } in waiting {
            let refused = match end {
                EngineEnd::Exited => EngineError::CommunicationFailed(
                    "engine exited before it became ready".to_string().into(),
                ),
                EngineEnd::Requested => EngineError::Cancelled(
                    "the engine was stopped before it became ready".to_string(),
                ),
                EngineEnd::Stalled => closed_error(end),
            };
            self.effects.push(Effect::Prepared(ticket, Err(refused)));
        }
    }

    // --- 小物 ---

    fn write_when_idle(&mut self, command: GuiCommand, what: &str) -> Result<(), EngineError> {
        if !matches!(self.state, State::Idle) {
            return Err(refuse(what, &self.state));
        }
        self.effects.push(Effect::Write(command));
        Ok(())
    }

    fn issue(&mut self) -> u64 {
        self.issued += 1;
        self.issued
    }

    fn issue_ticket(&mut self) -> Ticket {
        Ticket(self.issue())
    }
}

impl Back {
    fn into_state(self) -> State {
        match self {
            Back::Unready(waiting) => State::Unready { waiting },
            Back::Idle => State::Idle,
        }
    }
}

/// 届かない理由の文言。**理由ごとに分ける**（`Requested` / `Exited` / `Stalled`）。
/// 利用者に見せる説明も次の手も違うので、1つの文に潰さない
fn closed_error(end: EngineEnd) -> EngineError {
    let text = match end {
        EngineEnd::Requested => GONE,
        EngineEnd::Exited => CLOSED,
        EngineEnd::Stalled => STALLED,
    };
    EngineError::CommunicationFailed(text.to_string().into())
}

fn ended_before_usiok() -> EngineError {
    EngineError::CommunicationFailed("engine output ended before `usiok`".into())
}

/// 名乗りの待ちが閉じたときの断り。**`usiok` の前に終わったことと、こちらが止めたことを分ける**
/// （前者は起動の失敗で、後者は取り消し。`start_failure::classify` が種類を分ける）
fn unnamed_closed(end: EngineEnd) -> EngineError {
    match end {
        EngineEnd::Exited => ended_before_usiok(),
        EngineEnd::Requested => {
            EngineError::Cancelled("the engine was stopped before it said usiok".to_string())
        }
        EngineEnd::Stalled => closed_error(end),
    }
}

/// いまの状態では受けない頼みを断る。閉じていれば届かない理由で、そうでなければ何を待っているかで
fn refuse(what: &str, state: &State) -> EngineError {
    let why = match state {
        State::Closed(end) => return closed_error(*end),
        State::Unready { .. } => "the engine has not returned readyok",
        State::Idle => "the engine is idle",
        State::Checking { .. } => "the engine is checking a value",
        State::Searching { .. } => "the engine is searching",
        State::Stopping { .. } => "the engine has not answered stop",
    };
    EngineError::InvalidState(format!("refusing {what}: {why}"))
}

/// 先読みの探索か。`ThinkParams` の欄は非公開なので、線に出る形で見る。
///
/// `usi` 0.6.2 の `Display` は、`ponder` を立てたときだけ ` ponder` を**先頭に**書く
/// （`ponder_is_told_by_the_first_word` が固定する）
fn is_ponder(params: &ThinkParams) -> bool {
    params.to_string().starts_with(" ponder")
}

fn info_strings(params: Vec<InfoParams>) -> impl Iterator<Item = String> {
    params.into_iter().filter_map(|p| match p {
        InfoParams::Text(text) => Some(text),
        _ => None,
    })
}

/// 表（`docs/state-transitions/engine.md` の「1本のプロセスの USI の状態」）の全セルを、列ごとに1本で固定する。
///
/// どの列も、8つの状態（Q0〜Q5）を `at` で作ってから1つの入力を当て、出たこと（`shapes`）と着いた状態（`q`）を
/// 行ごとに突き合わせる。**状態を作る手順は入力の列を通す**（欄を直に組まない）ので、表に無い状態は作れない
#[cfg(test)]
mod tests {
    use super::*;

    /// 表の行（Q0〜Q5）
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Row {
        Q0,
        Q1,
        Q2,
        Q2c,
        Q3,
        Q3p,
        Q4,
        Q5,
    }

    const ALL: [Row; 8] = [
        Row::Q0,
        Row::Q1,
        Row::Q2,
        Row::Q2c,
        Row::Q3,
        Row::Q3p,
        Row::Q4,
        Row::Q5,
    ];

    fn q(m: &UsiMachine) -> Row {
        match &m.state {
            State::Unready { .. } if matches!(m.naming, Naming::Collecting { .. }) => Row::Q0,
            State::Unready { .. } => Row::Q1,
            State::Idle => Row::Q2,
            State::Checking { .. } => Row::Q2c,
            State::Searching { ponder: false, .. } => Row::Q3,
            State::Searching { ponder: true, .. } => Row::Q3p,
            State::Stopping { .. } => Row::Q4,
            State::Closed(_) => Row::Q5,
        }
    }

    /// その状態に着いた機械と、走っている探索の番号（Q3、Q3p、Q4 だけ）
    struct At {
        m: UsiMachine,
        search: Option<SearchId>,
    }

    impl At {
        /// 探索の頼みに添える番号。走っている探索が無い状態では、どの探索とも違う番号
        fn search_id(&self) -> SearchId {
            self.search.unwrap_or(SearchId(u64::MAX))
        }
    }

    fn feed(m: &mut UsiMachine, raw: &str) {
        m.on_line(raw, EngineCommand::parse(raw).ok());
    }

    /// 名乗りの待ちを1つ持つ Q0
    fn unnamed() -> UsiMachine {
        let mut m = UsiMachine::new();
        assert!(matches!(m.identify(), Ok(Asked::Waiting(_))));
        m.take_effects();
        m
    }

    /// 名乗り済みで、準備の待ちを持たない Q1
    fn named() -> UsiMachine {
        let mut m = unnamed();
        feed(&mut m, "id name E");
        feed(&mut m, "usiok");
        m
    }

    fn at(row: Row) -> At {
        let mut search = None;
        let m = match row {
            Row::Q0 => unnamed(),
            Row::Q1 => {
                let mut m = named();
                m.prepare(&[]).expect("Q1 で準備できる");
                m
            }
            Row::Q2 | Row::Q3 | Row::Q3p | Row::Q4 | Row::Q5 => {
                let mut m = named();
                m.prepare(&[]).expect("Q1 で準備できる");
                feed(&mut m, "readyok");
                match row {
                    Row::Q3 | Row::Q4 => {
                        search = Some(
                            m.search("startpos".to_string(), ThinkParams::new().infinite())
                                .expect("Q2 で探索できる"),
                        );
                    }
                    Row::Q3p => {
                        search = Some(
                            m.search(
                                "startpos".to_string(),
                                ThinkParams::new().ponder().infinite(),
                            )
                            .expect("Q2 で先読みできる"),
                        );
                    }
                    Row::Q5 => m.on_output_end(),
                    _ => {}
                }
                if row == Row::Q4 {
                    let id = search.expect("探索がある");
                    assert!(matches!(m.stop(id), Ok(Asked::Waiting(_))));
                }
                m
            }
            Row::Q2c => {
                let mut m = named();
                m.check_value("BookFile", "x").expect("Q1 で確かめられる");
                m
            }
        };
        let mut at = At { m, search };
        assert_eq!(q(&at.m), row, "作った状態が違う");
        at.m.take_effects();
        at
    }

    /// 出たことを、比べられる短い文にする。札と番号は落とす（順と数は並びで見る）
    fn shapes(m: &mut UsiMachine) -> Vec<String> {
        m.take_effects()
            .iter()
            .map(|effect| match effect {
                Effect::Write(command) => format!("write {command}"),
                Effect::Named(_, Ok(info)) => format!("named {}", info.name),
                Effect::Named(_, Err(e)) => format!("named {}", kind(e)),
                Effect::Prepared(_, Ok(texts)) => format!("prepared {texts:?}"),
                Effect::Prepared(_, Err(e)) => format!("prepared {}", kind(e)),
                Effect::Checked(_, Ok(texts)) => format!("checked {texts:?}"),
                Effect::Checked(_, Err(e)) => format!("checked {}", kind(e)),
                Effect::Stopped(_, Ok(())) => "stopped".to_string(),
                Effect::Stopped(_, Err(e)) => format!("stopped {}", kind(e)),
                Effect::ToSearch(_, SearchLine::Info(_)) => "search info".to_string(),
                Effect::ToSearch(_, SearchLine::Checkmate(_)) => "search checkmate".to_string(),
                Effect::ToSearch(_, SearchLine::BestMove(_)) => "search bestmove".to_string(),
                Effect::SearchEnded(_) => "search ended".to_string(),
                Effect::Kill => "kill".to_string(),
                Effect::Note(_) => "note".to_string(),
            })
            .collect()
    }

    /// 失敗の種類。届かない理由は文言で3つに分ける（`GONE` / `CLOSED` / `STALLED`）
    fn kind(e: &EngineError) -> String {
        match e {
            EngineError::CommunicationFailed(detail) if detail.reason == GONE => "gone".into(),
            EngineError::CommunicationFailed(detail) if detail.reason == CLOSED => "closed".into(),
            EngineError::CommunicationFailed(detail) if detail.reason == STALLED => {
                "stalled".into()
            }
            EngineError::CommunicationFailed(_) => "communication".into(),
            EngineError::StartupFailed(detail) if detail.reason == StartupReason::NoIdName => {
                "no-id-name".into()
            }
            EngineError::StartupFailed(_) => "startup".into(),
            EngineError::InvalidState(_) => "invalid".into(),
            EngineError::Cancelled(_) => "cancelled".into(),
            EngineError::Timeout(_) => "timeout".into(),
            EngineError::NotInitialized(_) => "not-initialized".into(),
        }
    }

    fn err_kind<T>(result: Result<T, EngineError>) -> String {
        match result {
            Ok(_) => "ok".to_string(),
            Err(e) => kind(&e),
        }
    }

    /// 行を1つ当てて、出たことと着いた状態を返す
    fn after_line(row: Row, raw: &str) -> (Vec<String>, Row) {
        let mut at = at(row);
        feed(&mut at.m, raw);
        (shapes(&mut at.m), q(&at.m))
    }

    fn none() -> Vec<String> {
        Vec::new()
    }

    fn says(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    /// L1 `id`: 集めるのは名乗り前（Q0）だけ。集めた名と作者は `usiok` で名乗りの答えになる
    #[test]
    fn an_id_line_is_collected_only_before_usiok() {
        for row in ALL {
            assert_eq!(after_line(row, "id name Other"), (none(), row), "{row:?}");
        }
        let mut m = unnamed();
        feed(&mut m, "id name Named");
        feed(&mut m, "id author Someone");
        feed(&mut m, "usiok");
        let Some(Effect::Named(_, Ok(info))) = m.take_effects().into_iter().next() else {
            panic!("名乗りの答えが出ていない");
        };
        assert_eq!(
            (info.name.as_str(), info.author.as_str()),
            ("Named", "Someone")
        );
    }

    /// L2 `option`: 宣言に溜めるのは名乗り前（Q0）だけ。値の確認の `usi` への答え（Q2c）でも作り直さない
    #[test]
    fn an_option_line_is_declared_only_before_usiok() {
        let option = "option name Late type check default true";
        for row in ALL {
            assert_eq!(after_line(row, option), (none(), row), "{row:?}");
        }
        let mut before = unnamed();
        feed(&mut before, "option name Early type check default true");
        feed(
            &mut before,
            "option name Spaced Name type string default a b",
        );
        feed(&mut before, "id name E");
        feed(&mut before, "usiok");
        let Some(Effect::Named(_, Ok(info))) = before.take_effects().into_iter().next() else {
            panic!("名乗りの答えが出ていない");
        };
        let names: Vec<_> = info.options.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, ["Early", "Spaced Name"]);

        let mut checking = at(Row::Q2c);
        feed(&mut checking.m, option);
        feed(&mut checking.m, "usiok");
        let Ok(Asked::Done(info)) = checking.m.identify() else {
            panic!("名乗り済みなのに覚えた答えを返さない");
        };
        assert!(info.options.is_empty(), "確認の答えで宣言を作り直している");
    }

    /// L3 `usiok`: 名乗り前なら名乗りの答え（名が無ければ `NO_ID_NAME` で断り、Q0 のまま）。
    /// 値の確認中なら確認の答えで、元の状態へ戻る
    #[test]
    fn usiok_answers_the_one_who_asked() {
        for row in ALL {
            let expected = match row {
                // `at` の Q0 は名を受けていない
                Row::Q0 => (says(&["named no-id-name"]), Row::Q0),
                Row::Q2c => (says(&["checked []"]), Row::Q1),
                _ => (none(), row),
            };
            assert_eq!(after_line(row, "usiok"), expected, "{row:?}");
        }
        let mut m = unnamed();
        feed(&mut m, "id name E");
        feed(&mut m, "usiok");
        assert_eq!((shapes(&mut m), q(&m)), (says(&["named E"]), Row::Q1));

        // 待機から確かめたら、待機へ戻る
        let mut idle = at(Row::Q2);
        idle.m
            .check_value("BookFile", "x")
            .expect("Q2 で確かめられる");
        idle.m.take_effects();
        feed(&mut idle.m, "usiok");
        assert_eq!(
            (shapes(&mut idle.m), q(&idle.m)),
            (says(&["checked []"]), Row::Q2)
        );
    }

    /// L4 `readyok`: 準備前（Q1）でだけ、準備の答えで待機へ
    #[test]
    fn readyok_answers_only_a_prepare() {
        for row in ALL {
            let expected = match row {
                Row::Q1 => (says(&["prepared []"]), Row::Q2),
                _ => (none(), row),
            };
            assert_eq!(after_line(row, "readyok"), expected, "{row:?}");
        }
    }

    /// L5 `info`: 探索中（Q3、Q3p）はその探索へ流す。準備と値の確認の間は `info string` を控えに足す。
    /// 止め待ち（Q4）では捨てる（止めた探索の行）
    #[test]
    fn an_info_line_goes_to_whoever_is_waiting_for_it() {
        let info = "info string hello";
        for row in ALL {
            let expected = match row {
                Row::Q3 | Row::Q3p => (says(&["search info"]), row),
                _ => (none(), row),
            };
            assert_eq!(after_line(row, info), expected, "{row:?}");
        }
        let mut preparing = at(Row::Q1);
        feed(&mut preparing.m, info);
        feed(&mut preparing.m, "readyok");
        assert_eq!(shapes(&mut preparing.m), says(&["prepared [\"hello\"]"]));

        let mut checking = at(Row::Q2c);
        feed(&mut checking.m, info);
        feed(&mut checking.m, "usiok");
        assert_eq!(shapes(&mut checking.m), says(&["checked [\"hello\"]"]));
    }

    /// L6 `checkmate`: 探索中（Q3、Q3p）だけその探索へ流す。`bestmove` ではないので探索は続く
    #[test]
    fn a_checkmate_line_goes_only_to_a_running_search() {
        for row in ALL {
            let expected = match row {
                Row::Q3 | Row::Q3p => (says(&["search checkmate"]), row),
                _ => (none(), row),
            };
            assert_eq!(after_line(row, "checkmate nomate"), expected, "{row:?}");
        }
    }

    /// L7 `bestmove`: 探索中なら最後の行として流して閉じ、止め待ちなら止めの答え。どちらも待機へ。
    /// 待機中の `bestmove` は頼んでいないので捨てて記録する
    #[test]
    fn a_bestmove_ends_only_the_search_it_belongs_to() {
        for row in ALL {
            let expected = match row {
                Row::Q2 => (says(&["note"]), Row::Q2),
                Row::Q3 | Row::Q3p => (says(&["search bestmove", "search ended"]), Row::Q2),
                Row::Q4 => (says(&["stopped"]), Row::Q2),
                _ => (none(), row),
            };
            assert_eq!(after_line(row, "bestmove 7g7f"), expected, "{row:?}");
        }
    }

    /// L8 出力の終わり: どの状態からも閉じ（`Exited`）、待っている札に答える。閉じた後は理由を変えない
    #[test]
    fn the_end_of_the_output_answers_everyone_waiting() {
        for row in ALL {
            let mut at = at(row);
            at.m.on_output_end();
            let expected = match row {
                Row::Q0 => says(&["named communication"]),
                Row::Q1 => says(&["prepared communication"]),
                Row::Q2 | Row::Q5 => none(),
                Row::Q2c => says(&["checked communication"]),
                Row::Q3 | Row::Q3p => says(&["search ended"]),
                Row::Q4 => says(&["stopped closed"]),
            };
            assert_eq!(shapes(&mut at.m), expected, "{row:?}");
            assert_eq!(at.m.end(), Some(EngineEnd::Exited), "{row:?}");
        }
    }

    /// L9 解けない行: どの状態でも何もしない（間引いて記録するのは持ち主。時計が要る）
    #[test]
    fn an_unreadable_line_changes_nothing() {
        for row in ALL {
            let mut at = at(row);
            at.m.on_line("info score cp 99999999999999999999", None);
            assert_eq!((shapes(&mut at.m), q(&at.m)), (none(), row), "{row:?}");
        }
    }

    /// W1 書き込みの詰まり: 閉じ（`Stalled`）、待っている札に「詰まった」で答える。閉じた後は理由を変えない
    #[test]
    fn a_stalled_write_closes_with_its_own_reason() {
        for row in ALL {
            let mut at = at(row);
            at.m.on_write_stalled();
            let expected = match row {
                Row::Q0 => says(&["named stalled"]),
                Row::Q1 => says(&["prepared stalled"]),
                Row::Q2 | Row::Q5 => none(),
                Row::Q2c => says(&["checked stalled"]),
                Row::Q3 | Row::Q3p => says(&["search ended"]),
                Row::Q4 => says(&["stopped stalled"]),
            };
            assert_eq!(shapes(&mut at.m), expected, "{row:?}");
            let end = if row == Row::Q5 {
                EngineEnd::Exited
            } else {
                EngineEnd::Stalled
            };
            assert_eq!(at.m.end(), Some(end), "{row:?}");
        }
    }

    /// R1 名乗り: 名乗り前は `usi` を書いて待つ（待ちが既にあれば書かずに同じ答えを待つ）。
    /// 名乗り済みなら覚えた答え。閉じていれば断る
    #[test]
    fn identify_writes_usi_once_and_then_remembers() {
        for row in ALL {
            let mut at = at(row);
            let asked = at.m.identify();
            let answer = match asked {
                Ok(Asked::Done(info)) => format!("done {}", info.name),
                Ok(Asked::Waiting(_)) => "waiting".to_string(),
                Err(e) => kind(&e),
            };
            let expected = match row {
                // `at` の Q0 は既に `usi` を書いて待っている
                Row::Q0 => ("waiting".to_string(), none()),
                Row::Q5 => ("closed".to_string(), none()),
                _ => ("done E".to_string(), none()),
            };
            assert_eq!((answer, shapes(&mut at.m)), expected, "{row:?}");
            assert_eq!(q(&at.m), row, "{row:?}");
        }

        let mut m = UsiMachine::new();
        let Ok(Asked::Waiting(first)) = m.identify() else {
            panic!("待たない");
        };
        assert_eq!(shapes(&mut m), says(&["write usi"]));
        let Ok(Asked::Waiting(second)) = m.identify() else {
            panic!("待たない");
        };
        assert_ne!(first, second);
        feed(&mut m, "id name E");
        feed(&mut m, "usiok");
        let answered: Vec<Ticket> = m
            .take_effects()
            .into_iter()
            .filter_map(|e| match e {
                Effect::Named(ticket, Ok(_)) => Some(ticket),
                _ => None,
            })
            .collect();
        assert_eq!(
            answered,
            [first, second],
            "待っていた2つに同じ答えが行かない"
        );
    }

    /// 名乗る前に閉じたら、後から頼んだ名乗りも、待っていた名乗りと同じ断りを受ける（閉じた理由の3つとも）。
    /// 種類が分かれると、起動の取り消しが手順に先回りしたときに起動の失敗として見える（`start_failure::classify`）
    #[test]
    fn identify_after_an_early_exit_says_it_ended_before_usiok() {
        let inputs: [fn(&mut UsiMachine); 3] = [
            UsiMachine::on_output_end,
            UsiMachine::on_write_stalled,
            UsiMachine::kill,
        ];
        for close in inputs {
            let mut m = UsiMachine::new();
            m.identify().expect("待てる");
            m.take_effects();
            close(&mut m);
            let waited = m
                .take_effects()
                .into_iter()
                .find_map(|effect| match effect {
                    Effect::Named(_, answer) => Some(err_kind(answer)),
                    _ => None,
                })
                .expect("待っていた名乗りに答えていない");
            let later = err_kind(m.identify());
            assert_eq!(later, waited, "{:?} の後", m.end());
        }

        let mut m = UsiMachine::new();
        m.on_output_end();
        let Err(EngineError::CommunicationFailed(detail)) = m.identify() else {
            panic!("断らない");
        };
        assert_eq!(detail.reason, "engine output ended before `usiok`");
    }

    /// R2 準備: 名乗り済みで探索していなければ、`setoption` を並べ `isready` を書いて Q1 へ。
    /// 値の確認中なら、確認を諦めたと答えてから進む。それ以外は断る
    #[test]
    fn prepare_always_writes_isready() {
        let options = [SetOptionValue {
            name: "USI_Hash".to_string(),
            value: "256".to_string(),
        }];
        let writes = ["write setoption name USI_Hash value 256", "write isready"];
        for row in ALL {
            let mut at = at(row);
            let asked = err_kind(at.m.prepare(&options));
            let expected = match row {
                // 名乗りは待たない（名乗らずに準備する台本がある）。名乗り前のまま準備を待つ
                Row::Q0 => ("ok".to_string(), says(&writes), Row::Q0),
                Row::Q1 | Row::Q2 => ("ok".to_string(), says(&writes), Row::Q1),
                Row::Q2c => (
                    "ok".to_string(),
                    says(&["checked cancelled", writes[0], writes[1]]),
                    Row::Q1,
                ),
                Row::Q5 => ("closed".to_string(), none(), Row::Q5),
                _ => ("invalid".to_string(), none(), row),
            };
            assert_eq!((asked, shapes(&mut at.m), q(&at.m)), expected, "{row:?}");
        }
        // 先の準備が答えを待っていても、`readyok` で両方に答える
        let mut twice = at(Row::Q1);
        twice.m.prepare(&[]).expect("準備できる");
        feed(&mut twice.m, "readyok");
        assert_eq!(
            shapes(&mut twice.m),
            says(&["write isready", "prepared []", "prepared []"])
        );
    }

    /// R3 値の確認: 準備前か待機なら `setoption` と `usi` を書いて Q2c へ。それ以外は断る
    #[test]
    fn check_value_is_asked_only_before_a_search() {
        let writes = ["write setoption name BookFile value x", "write usi"];
        for row in ALL {
            let mut at = at(row);
            let asked = err_kind(at.m.check_value("BookFile", "x"));
            let expected = match row {
                Row::Q0 | Row::Q1 | Row::Q2 => ("ok".to_string(), says(&writes), Row::Q2c),
                Row::Q5 => ("closed".to_string(), none(), Row::Q5),
                _ => ("invalid".to_string(), none(), row),
            };
            assert_eq!((asked, shapes(&mut at.m), q(&at.m)), expected, "{row:?}");
        }
    }

    /// R4 新しい対局: 待機（Q2）でだけ `usinewgame` を書く。`readyok` の前は積まずに断る（ADR-0016 決定3）
    #[test]
    fn new_game_is_written_only_when_idle() {
        for row in ALL {
            let mut at = at(row);
            let asked = err_kind(at.m.new_game());
            let expected = match row {
                Row::Q2 => ("ok".to_string(), says(&["write usinewgame"])),
                Row::Q5 => ("closed".to_string(), none()),
                _ => ("invalid".to_string(), none()),
            };
            assert_eq!((asked, shapes(&mut at.m)), expected, "{row:?}");
            assert_eq!(q(&at.m), row, "{row:?}");
        }
    }

    /// R5 探索: 待機（Q2）でだけ `position` と `go` を書く。`go ponder` なら Q3p。
    /// `readyok` の前は積まずに断る（決定3）。探索中と止め待ちの2本目も断る
    #[test]
    fn a_search_starts_only_when_idle() {
        for row in ALL {
            let mut at = at(row);
            let asked =
                at.m.search("startpos".to_string(), ThinkParams::new().infinite());
            let refused = match &asked {
                Err(EngineError::InvalidState(text)) if text == SEARCH_NOT_ENDED => {
                    "not-ended".to_string()
                }
                _ => err_kind(asked),
            };
            let expected = match row {
                Row::Q2 => (
                    "ok".to_string(),
                    says(&["write position sfen startpos", "write go infinite"]),
                    Row::Q3,
                ),
                Row::Q3 | Row::Q3p | Row::Q4 => ("not-ended".to_string(), none(), row),
                Row::Q5 => ("closed".to_string(), none(), Row::Q5),
                _ => ("invalid".to_string(), none(), row),
            };
            assert_eq!((refused, shapes(&mut at.m), q(&at.m)), expected, "{row:?}");
        }
        let mut idle = at(Row::Q2);
        idle.m
            .search(
                "startpos".to_string(),
                ThinkParams::new().ponder().infinite(),
            )
            .expect("探索できる");
        assert_eq!(q(&idle.m), Row::Q3p);
    }

    /// R6 `ponderhit`: その探索が先読み中（Q3p）のときだけ書いて Q3 へ。違う探索の番号は断る
    #[test]
    fn ponderhit_is_only_for_the_ponder_search_that_is_running() {
        for row in ALL {
            let mut at = at(row);
            let id = at.search_id();
            let asked = err_kind(at.m.ponderhit(id));
            let expected = match row {
                Row::Q3p => ("ok".to_string(), says(&["write ponderhit"]), Row::Q3),
                Row::Q5 => ("closed".to_string(), none(), Row::Q5),
                _ => ("invalid".to_string(), none(), row),
            };
            assert_eq!((asked, shapes(&mut at.m), q(&at.m)), expected, "{row:?}");
        }
        let mut stale = at(Row::Q3p);
        assert!(
            stale.m.ponderhit(SearchId(u64::MAX)).is_err(),
            "別の探索の番号で書いている"
        );
    }

    /// R7 止める: 走っている探索なら `stop` を書いて Q4 で答えを待つ。止め待ちなら書かずに同じ答えを待つ。
    /// 走っていない探索は `bestmove` で答え済み。閉じていれば届かない
    #[test]
    fn a_stop_waits_only_for_the_search_it_names() {
        for row in ALL {
            let mut at = at(row);
            let id = at.search_id();
            let asked = match at.m.stop(id) {
                Ok(Asked::Done(())) => "answered".to_string(),
                Ok(Asked::Waiting(_)) => "waiting".to_string(),
                Err(e) => kind(&e),
            };
            let expected = match row {
                Row::Q3 | Row::Q3p => (
                    "waiting".to_string(),
                    says(&["write stop", "search ended"]),
                    Row::Q4,
                ),
                Row::Q4 => ("waiting".to_string(), none(), Row::Q4),
                Row::Q5 => ("closed".to_string(), none(), Row::Q5),
                _ => ("answered".to_string(), none(), row),
            };
            assert_eq!((asked, shapes(&mut at.m), q(&at.m)), expected, "{row:?}");
        }
        // 2つの止めの札に、1つの `bestmove` で答える
        let mut stopping = at(Row::Q4);
        let id = stopping.search_id();
        assert!(matches!(stopping.m.stop(id), Ok(Asked::Waiting(_))));
        feed(&mut stopping.m, "bestmove 7g7f");
        assert_eq!(shapes(&mut stopping.m), says(&["stopped", "stopped"]));

        // 前の探索の番号では止めない（走っているのは別の探索）
        let mut next = at(Row::Q3);
        assert!(matches!(
            next.m.stop(SearchId(u64::MAX)),
            Ok(Asked::Done(()))
        ));
        assert_eq!((shapes(&mut next.m), q(&next.m)), (none(), Row::Q3));
    }

    /// R8 捨てる: 走っている探索なら `stop` だけを書き、待つ者の居ない Q4 へ。それ以外は何もしない
    #[test]
    fn a_dropped_search_writes_stop_and_waits_for_nobody() {
        for row in ALL {
            let mut at = at(row);
            let id = at.search_id();
            at.m.drop_search(id);
            let expected = match row {
                Row::Q3 | Row::Q3p => (says(&["write stop", "search ended"]), Row::Q4),
                _ => (none(), row),
            };
            assert_eq!((shapes(&mut at.m), q(&at.m)), expected, "{row:?}");
        }
        // 捨てた探索の `bestmove` は誰にも流さずに待機へ戻る。来るまで次の探索を断る
        let mut dropped = at(Row::Q3);
        let id = dropped.search_id();
        dropped.m.drop_search(id);
        dropped.m.take_effects();
        assert!(dropped
            .m
            .search("startpos".to_string(), ThinkParams::new())
            .is_err());
        feed(&mut dropped.m, "bestmove 7g7f");
        assert_eq!((shapes(&mut dropped.m), q(&dropped.m)), (none(), Row::Q2));
    }

    /// R9 終局: 待機（Q2）でだけ `gameover` を書く。探索中・止め待ちの `gameover` は USI 違反
    #[test]
    fn game_over_is_written_only_when_idle() {
        for row in ALL {
            let mut at = at(row);
            let asked = err_kind(at.m.game_over(GameOverKind::Win));
            let expected = match row {
                Row::Q2 => ("ok".to_string(), says(&["write gameover win"])),
                Row::Q5 => ("closed".to_string(), none()),
                _ => ("invalid".to_string(), none()),
            };
            assert_eq!((asked, shapes(&mut at.m)), expected, "{row:?}");
            assert_eq!(q(&at.m), row, "{row:?}");
        }
    }

    /// R10 `quit`: 閉じていなければ印を立てて書く。以後の出力の終わりは `Requested`
    #[test]
    fn quit_marks_the_end_as_ours() {
        for row in ALL {
            let mut at = at(row);
            at.m.quit();
            let expected = match row {
                Row::Q5 => none(),
                _ => says(&["write quit"]),
            };
            assert_eq!((shapes(&mut at.m), q(&at.m)), (expected, row), "{row:?}");
            at.m.on_output_end();
            let end = if row == Row::Q5 {
                EngineEnd::Exited
            } else {
                EngineEnd::Requested
            };
            assert_eq!(at.m.end(), Some(end), "{row:?}");
        }
    }

    /// R11 kill: どの状態からも閉じ（`Requested`）、待っている札に答えてから落とす指示を出す。
    /// 閉じた後でも理由は `Requested` へ上がり、落とす指示はまた出す
    #[test]
    fn a_kill_answers_everyone_and_then_kills() {
        for row in ALL {
            let mut at = at(row);
            at.m.kill();
            let expected = match row {
                Row::Q0 => says(&["named cancelled", "kill"]),
                Row::Q1 => says(&["prepared cancelled", "kill"]),
                Row::Q2 | Row::Q5 => says(&["kill"]),
                Row::Q2c => says(&["checked cancelled", "kill"]),
                Row::Q3 | Row::Q3p => says(&["search ended", "kill"]),
                Row::Q4 => says(&["stopped gone", "kill"]),
            };
            assert_eq!(shapes(&mut at.m), expected, "{row:?}");
            assert_eq!(at.m.end(), Some(EngineEnd::Requested), "{row:?}");
        }
    }

    /// 名乗りは準備と別に進む。名乗らずに準備したエンジンも探索でき、後から名乗りを頼めば
    /// 待機中なら `usi` を書く。探索中は書けないので断り、値の確認中は確認の `usiok` で答える
    #[test]
    fn naming_runs_beside_the_preparation() {
        let mut m = UsiMachine::new();
        m.prepare(&[]).expect("名乗らずに準備できる");
        feed(&mut m, "readyok");
        assert_eq!(q(&m), Row::Q2);
        m.take_effects();

        let Ok(Asked::Waiting(_)) = m.identify() else {
            panic!("待機中の名乗りが `usi` を書かない");
        };
        assert_eq!(shapes(&mut m), says(&["write usi"]));
        feed(&mut m, "id name Late");
        feed(&mut m, "usiok");
        assert_eq!(shapes(&mut m), says(&["named Late"]));
        assert_eq!(q(&m), Row::Q2, "名乗りで準備の状態が動いた");

        let mut searching = UsiMachine::new();
        searching.prepare(&[]).expect("準備できる");
        feed(&mut searching, "readyok");
        searching
            .search("startpos".to_string(), ThinkParams::new().infinite())
            .expect("探索できる");
        searching.take_effects();
        assert_eq!(err_kind(searching.identify()), "invalid");
        assert_eq!(shapes(&mut searching), none(), "探索中に `usi` を書いた");

        let mut checking = UsiMachine::new();
        checking.check_value("BookFile", "x").expect("確かめられる");
        checking.take_effects();
        let Ok(Asked::Waiting(_)) = checking.identify() else {
            panic!("確認中の名乗りが待たない");
        };
        assert_eq!(shapes(&mut checking), none(), "確認の `usi` に重ねて書いた");
        feed(&mut checking, "id name E");
        feed(&mut checking, "usiok");
        assert_eq!(shapes(&mut checking), says(&["named E", "checked []"]));
    }

    /// `isready` を書いていない（準備の札が無い）`readyok` では待機へ移らない
    #[test]
    fn a_readyok_nobody_asked_for_changes_nothing() {
        let mut m = named();
        m.take_effects();
        feed(&mut m, "readyok");
        assert_eq!((shapes(&mut m), q(&m)), (none(), Row::Q1));
    }

    /// 入力の名前と、その入力を当てる関数
    type Input = (&'static str, fn(&mut UsiMachine));

    /// 不変条件5: 閉じた後はどの入力でも閉じたまま。理由が変わるのは `Requested` へ上がるときだけ
    #[test]
    fn closed_absorbs_every_later_input() {
        for end in [EngineEnd::Exited, EngineEnd::Stalled, EngineEnd::Requested] {
            let inputs: [Input; 18] = [
                ("id", |m| feed(m, "id name X")),
                ("usiok", |m| feed(m, "usiok")),
                ("readyok", |m| feed(m, "readyok")),
                ("info", |m| feed(m, "info depth 1")),
                ("bestmove", |m| feed(m, "bestmove 7g7f")),
                ("end", UsiMachine::on_output_end),
                ("stalled", UsiMachine::on_write_stalled),
                ("identify", |m| drop(m.identify())),
                ("prepare", |m| drop(m.prepare(&[]))),
                ("check", |m| drop(m.check_value("a", "b"))),
                ("new game", |m| drop(m.new_game())),
                ("search", |m| {
                    drop(m.search("startpos".to_string(), ThinkParams::new()))
                }),
                ("ponderhit", |m| drop(m.ponderhit(SearchId(1)))),
                ("stop", |m| drop(m.stop(SearchId(1)))),
                ("drop", |m| m.drop_search(SearchId(1))),
                ("game over", |m| drop(m.game_over(GameOverKind::Draw))),
                ("quit", UsiMachine::quit),
                ("kill", UsiMachine::kill),
            ];
            for (name, input) in inputs {
                let mut m = UsiMachine::new();
                m.close(end);
                m.take_effects();
                input(&mut m);
                let writes: Vec<String> = shapes(&mut m)
                    .into_iter()
                    .filter(|s| s.starts_with("write"))
                    .collect();
                assert!(
                    writes.is_empty(),
                    "{end:?} の後に {name} で書いた: {writes:?}"
                );
                let expected = if name == "kill" {
                    EngineEnd::Requested
                } else {
                    end
                };
                assert_eq!(m.end(), Some(expected), "{end:?} の後の {name}");
            }
        }
    }

    /// 不変条件3: 探索中・先読み中・止め待ちに書くのは `stop`、`ponderhit`、`quit` だけ
    #[test]
    fn nothing_but_stop_ponderhit_and_quit_is_written_during_a_search() {
        let requests: [fn(&mut At); 9] = [
            |at| drop(at.m.identify()),
            |at| drop(at.m.prepare(&[])),
            |at| drop(at.m.check_value("a", "b")),
            |at| drop(at.m.new_game()),
            |at| drop(at.m.search("startpos".to_string(), ThinkParams::new())),
            |at| drop(at.m.ponderhit(at.search_id())),
            |at| drop(at.m.stop(at.search_id())),
            |at| at.m.drop_search(at.search_id()),
            |at| drop(at.m.game_over(GameOverKind::Lose)),
        ];
        for row in [Row::Q3, Row::Q3p, Row::Q4] {
            for request in requests {
                let mut at = at(row);
                request(&mut at);
                for shape in shapes(&mut at.m) {
                    assert!(
                        !shape.starts_with("write")
                            || ["write stop", "write ponderhit", "write quit"]
                                .contains(&shape.as_str()),
                        "{row:?} で {shape} を書いた"
                    );
                }
            }
        }
    }

    /// 届かない理由を3つとも別の文言にする。`Requested` は他の理由より強い
    #[test]
    fn who_stopped_the_engine_is_not_flattened_into_one_message() {
        assert_eq!(kind(&closed_error(EngineEnd::Requested)), "gone");
        assert_eq!(kind(&closed_error(EngineEnd::Exited)), "closed");
        assert_eq!(kind(&closed_error(EngineEnd::Stalled)), "stalled");

        // 詰まったプロセスを後から落としたら、見せるのは落としたほう
        let mut m = UsiMachine::new();
        m.on_write_stalled();
        m.kill();
        assert_eq!(kind(&m.cannot_reach()), "gone");
        // 落とした後に出力が終わっても、落としたまま
        m.on_output_end();
        assert_eq!(m.end(), Some(EngineEnd::Requested));
    }

    /// 先読みかどうかを線に出る形の最初の語で見てよいこと（`usi` 0.6.2 の `ThinkParams` の `Display`）
    #[test]
    fn ponder_is_told_by_the_first_word() {
        let ponder = [
            ThinkParams::new().ponder(),
            ThinkParams::new().ponder().infinite(),
            ThinkParams::new()
                .ponder()
                .btime(std::time::Duration::from_secs(1))
                .wtime(std::time::Duration::from_secs(1))
                .byoyomi(std::time::Duration::from_secs(1)),
        ];
        for params in ponder {
            assert!(is_ponder(&params), "{params}");
        }
        let plain = [
            ThinkParams::new(),
            ThinkParams::new().infinite(),
            ThinkParams::new().byoyomi(std::time::Duration::from_secs(1)),
            ThinkParams::new().mate(usi::MateParam::Infinite),
        ];
        for params in plain {
            assert!(!is_ponder(&params), "{params}");
        }
    }
}
