use std::fmt;
use std::time::Duration;

/// Represents parameters of "gameover" command.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum GameOverKind {
    Win,
    Lose,
    Draw,
}

impl fmt::Display for GameOverKind {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match *self {
            GameOverKind::Win => write!(f, "win"),
            GameOverKind::Lose => write!(f, "lose"),
            GameOverKind::Draw => write!(f, "draw"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum MateParam {
    Timeout(Duration),
    Infinite,
}

/// Represents parameters of "go" command.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
pub struct ThinkParams {
    ponder: bool,
    btime: Option<Duration>,
    wtime: Option<Duration>,
    byoyomi: Option<Duration>,
    binc: Option<Duration>,
    winc: Option<Duration>,
    movetime: Option<Duration>,
    depth: Option<u32>,
    nodes: Option<u64>,
    infinite: bool,
    mate: Option<MateParam>,
}

impl ThinkParams {
    pub fn new() -> Self {
        ThinkParams::default()
    }

    #[must_use]
    pub fn ponder(mut self) -> Self {
        self.ponder = true;
        self
    }

    #[must_use]
    pub fn btime(mut self, t: Duration) -> Self {
        self.btime = Some(t);
        self
    }

    #[must_use]
    pub fn wtime(mut self, t: Duration) -> Self {
        self.wtime = Some(t);
        self
    }

    #[must_use]
    pub fn byoyomi(mut self, t: Duration) -> Self {
        self.byoyomi = Some(t);
        self
    }

    #[must_use]
    pub fn binc(mut self, t: Duration) -> Self {
        self.binc = Some(t);
        self
    }

    #[must_use]
    pub fn winc(mut self, t: Duration) -> Self {
        self.winc = Some(t);
        self
    }

    #[must_use]
    pub fn movetime(mut self, t: Duration) -> Self {
        self.movetime = Some(t);
        self
    }

    #[must_use]
    pub fn depth(mut self, d: u32) -> Self {
        self.depth = Some(d);
        self
    }

    #[must_use]
    pub fn nodes(mut self, n: u64) -> Self {
        self.nodes = Some(n);
        self
    }

    #[must_use]
    pub fn infinite(mut self) -> Self {
        self.infinite = true;
        self
    }

    #[must_use]
    pub fn mate(mut self, t: MateParam) -> Self {
        self.mate = Some(t);
        self
    }
}

impl fmt::Display for ThinkParams {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        if self.ponder {
            write!(f, " ponder")?;
        }
        if let Some(t) = self.btime {
            write!(f, " btime {}", to_ms(t))?;
        }
        if let Some(t) = self.wtime {
            write!(f, " wtime {}", to_ms(t))?;
        }
        if let Some(t) = self.byoyomi {
            write!(f, " byoyomi {}", to_ms(t))?;
        }
        if let Some(t) = self.binc {
            write!(f, " binc {}", to_ms(t))?;
        }
        if let Some(t) = self.winc {
            write!(f, " winc {}", to_ms(t))?;
        }
        if let Some(t) = self.movetime {
            write!(f, " movetime {}", to_ms(t))?;
        }
        if let Some(d) = self.depth {
            write!(f, " depth {}", d)?;
        }
        if let Some(n) = self.nodes {
            write!(f, " nodes {}", n)?;
        }
        if self.infinite {
            write!(f, " infinite")?;
        }
        if let Some(mate_opts) = &self.mate {
            match *mate_opts {
                MateParam::Timeout(t) => write!(f, " mate {}", to_ms(t))?,
                MateParam::Infinite => write!(f, " mate infinite")?,
            }
        }

        Ok(())
    }
}

/// Represents a USI command sent from the GUI.
///
/// # Examples
///
/// ```
/// use std::time::Duration;
/// use usi::{GuiCommand, ThinkParams};
///
/// let params = ThinkParams::new().btime(Duration::from_secs(1)).wtime(Duration::from_secs(2));
/// let cmd = GuiCommand::Go(params);
///
/// assert_eq!("go btime 1000 wtime 2000", cmd.to_string());
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum GuiCommand {
    GameOver(GameOverKind),
    Go(ThinkParams),
    IsReady,
    Ponderhit,
    Position(String),
    SetOption(String, Option<String>),
    Stop,
    Usi,
    UsiNewGame,
    Quit,
}

impl fmt::Display for GuiCommand {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match *self {
            GuiCommand::GameOver(ref r) => write!(f, "gameover {}", r),
            GuiCommand::Go(ref opt) => write!(f, "go{}", opt),
            GuiCommand::IsReady => write!(f, "isready"),
            GuiCommand::Ponderhit => write!(f, "ponderhit"),
            GuiCommand::Position(ref s) => write!(f, "position sfen {}", s),
            GuiCommand::SetOption(ref n, None) => write!(f, "setoption name {}", n),
            GuiCommand::SetOption(ref n, Some(ref v)) => {
                write!(f, "setoption name {} value {}", n, v)
            }
            GuiCommand::Stop => write!(f, "stop"),
            GuiCommand::Usi => write!(f, "usi"),
            GuiCommand::UsiNewGame => write!(f, "usinewgame"),
            GuiCommand::Quit => write!(f, "quit"),
        }
    }
}

fn to_ms(t: Duration) -> u64 {
    1000 * t.as_secs() + (t.subsec_nanos() as u64) / 1_000_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_string() {
        let cases = [
            ("gameover win", GuiCommand::GameOver(GameOverKind::Win)),
            ("gameover draw", GuiCommand::GameOver(GameOverKind::Draw)),
            ("gameover lose", GuiCommand::GameOver(GameOverKind::Lose)),
            (
                "go btime 60000 wtime 50000 byoyomi 10000",
                GuiCommand::Go(
                    ThinkParams::new()
                        .btime(Duration::from_secs(60))
                        .wtime(Duration::from_secs(50))
                        .byoyomi(Duration::from_secs(10)),
                ),
            ),
            (
                "go btime 40000 wtime 50000 binc 10000 winc 10000",
                GuiCommand::Go(
                    ThinkParams::new()
                        .btime(Duration::from_secs(40))
                        .wtime(Duration::from_secs(50))
                        .binc(Duration::from_secs(10))
                        .winc(Duration::from_secs(10)),
                ),
            ),
            (
                "go movetime 5000",
                GuiCommand::Go(ThinkParams::new().movetime(Duration::from_secs(5))),
            ),
            ("go depth 18", GuiCommand::Go(ThinkParams::new().depth(18))),
            (
                "go nodes 123456",
                GuiCommand::Go(ThinkParams::new().nodes(123_456)),
            ),
            ("go infinite", GuiCommand::Go(ThinkParams::new().infinite())),
            (
                "go mate 60000",
                GuiCommand::Go(
                    ThinkParams::new().mate(MateParam::Timeout(Duration::from_secs(60))),
                ),
            ),
            (
                "go mate infinite",
                GuiCommand::Go(ThinkParams::new().mate(MateParam::Infinite)),
            ),
            ("go ponder", GuiCommand::Go(ThinkParams::new().ponder())),
            ("isready", GuiCommand::IsReady),
            ("ponderhit", GuiCommand::Ponderhit),
            (
                "position sfen lnsgkgsn1/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
                GuiCommand::Position(
                    "lnsgkgsn1/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL \
                     w - 1"
                        .to_string(),
                ),
            ),
            (
                "setoption name foo",
                GuiCommand::SetOption("foo".to_string(), None),
            ),
            (
                "setoption name foo value bar",
                GuiCommand::SetOption("foo".to_string(), Some("bar".to_string())),
            ),
            ("stop", GuiCommand::Stop),
            ("usi", GuiCommand::Usi),
            ("usinewgame", GuiCommand::UsiNewGame),
            ("quit", GuiCommand::Quit),
        ];

        for c in &cases {
            assert_eq!(c.0, c.1.to_string());
        }
    }
}
