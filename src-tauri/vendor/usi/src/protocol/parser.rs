use itertools::Itertools;
use std::str::SplitWhitespace;
use std::time::Duration;

use super::{
    BestMoveParams, CheckmateParams, EngineCommand, IdParams, InfoParams, OptionKind, OptionParams,
    ScoreKind,
};
use crate::error::Error;

pub struct EngineCommandParser<'a> {
    iter: SplitWhitespace<'a>,
}

impl<'a> EngineCommandParser<'a> {
    pub fn new(cmd: &str) -> EngineCommandParser {
        EngineCommandParser {
            iter: cmd.split_whitespace(),
        }
    }

    pub fn parse(mut self) -> Result<EngineCommand, Error> {
        let command = self.iter.next();
        if command.is_none() {
            return Err(Error::IllegalSyntax);
        }

        let command = command.unwrap();
        Ok(match command {
            "bestmove" => self.parse_bestmove()?,
            "checkmate" => self.parse_checkmate()?,
            "id" => self.parse_id()?,
            "info" => self.parse_info()?,
            "option" => self.parse_option()?,
            "readyok" => EngineCommand::ReadyOk,
            "usiok" => EngineCommand::UsiOk,
            _ => EngineCommand::Unknown,
        })
    }

    fn parse_bestmove(mut self) -> Result<EngineCommand, Error> {
        match (self.iter.next(), self.iter.next(), self.iter.next()) {
            (Some("resign"), None, None) => Ok(EngineCommand::BestMove(BestMoveParams::Resign)),
            (Some("win"), None, None) => Ok(EngineCommand::BestMove(BestMoveParams::Win)),
            (Some(m), None, None) => Ok(EngineCommand::BestMove(BestMoveParams::MakeMove(
                m.to_string(),
                None,
            ))),
            (Some(m), Some("ponder"), Some(pm)) => Ok(EngineCommand::BestMove(
                BestMoveParams::MakeMove(m.to_string(), Some(pm.to_string())),
            )),
            _ => Err(Error::IllegalSyntax),
        }
    }

    fn parse_checkmate(mut self) -> Result<EngineCommand, Error> {
        match self.iter.next() {
            Some("notimplemented") => Ok(EngineCommand::Checkmate(CheckmateParams::NoMate)),
            Some("timeout") => Ok(EngineCommand::Checkmate(CheckmateParams::Timeout)),
            Some("nomate") => Ok(EngineCommand::Checkmate(CheckmateParams::NoMate)),
            Some(s) => {
                let mut moves = vec![s.to_string()];
                self.iter.for_each(|s| {
                    moves.push(s.to_string());
                });
                Ok(EngineCommand::Checkmate(CheckmateParams::Mate(moves)))
            }
            _ => Err(Error::IllegalSyntax),
        }
    }

    fn parse_id(mut self) -> Result<EngineCommand, Error> {
        match self.iter.next() {
            Some("name") => Ok(EngineCommand::Id(IdParams::Name(self.iter.join(" ")))),
            Some("author") => Ok(EngineCommand::Id(IdParams::Author(self.iter.join(" ")))),
            _ => Err(Error::IllegalSyntax),
        }
    }

    fn parse_info(self) -> Result<EngineCommand, Error> {
        let mut iter = self.iter.peekable();
        let mut entries = Vec::new();

        while let Some(kind) = iter.next() {
            match kind {
                "depth" => {
                    let depth: i32 = iter
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or(Error::IllegalSyntax)?;

                    let mut sel_depth = None;
                    if let Some(&peek_kind) = iter.peek() {
                        if peek_kind == "seldepth" {
                            iter.next();

                            sel_depth = Some(
                                iter.next()
                                    .and_then(|s| s.parse().ok())
                                    .ok_or(Error::IllegalSyntax)?,
                            );
                        }
                    }

                    entries.push(InfoParams::Depth(depth, sel_depth));
                }
                "time" => {
                    let ms: u64 = iter
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or(Error::IllegalSyntax)?;
                    entries.push(InfoParams::Time(Duration::from_millis(ms)));
                }
                "multipv" => {
                    let multipv: i32 = iter
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or(Error::IllegalSyntax)?;
                    entries.push(InfoParams::MultiPv(multipv));
                }
                "nodes" => {
                    let nodes: i32 = iter
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or(Error::IllegalSyntax)?;
                    entries.push(InfoParams::Nodes(nodes));
                }
                "pv" => {
                    let pvs = iter.map(|v| v.to_string()).collect::<Vec<_>>();
                    entries.push(InfoParams::Pv(pvs));
                    // "pv" or "str" must be the final item.
                    break;
                }
                "score" => match (iter.next(), iter.next()) {
                    (Some("cp"), Some(cp)) => {
                        let cp: i32 = cp.parse()?;

                        if let Some(&peek_kind) = iter.peek() {
                            match peek_kind {
                                "lowerbound" => {
                                    iter.next();
                                    entries.push(InfoParams::Score(cp, ScoreKind::CpLowerbound));
                                }
                                "upperbound" => {
                                    iter.next();
                                    entries.push(InfoParams::Score(cp, ScoreKind::CpUpperbound));
                                }
                                _ => {
                                    entries.push(InfoParams::Score(cp, ScoreKind::CpExact));
                                }
                            }
                        }
                    }
                    (Some("mate"), Some("+")) => {
                        entries.push(InfoParams::Score(1, ScoreKind::MateSignOnly))
                    }
                    (Some("mate"), Some("-")) => {
                        entries.push(InfoParams::Score(-1, ScoreKind::MateSignOnly))
                    }
                    (Some("mate"), Some(ply)) => {
                        let ply: i32 = ply.parse()?;

                        if let Some(&peek_kind) = iter.peek() {
                            match peek_kind {
                                "lowerbound" => {
                                    iter.next();
                                    entries.push(InfoParams::Score(ply, ScoreKind::MateLowerbound));
                                }
                                "upperbound" => {
                                    iter.next();
                                    entries.push(InfoParams::Score(ply, ScoreKind::MateUpperbound));
                                }
                                _ => {
                                    entries.push(InfoParams::Score(ply, ScoreKind::MateExact));
                                }
                            }
                        }
                    }
                    _ => return Err(Error::IllegalSyntax),
                },
                "currmove" => {
                    let currmove = iter.next().ok_or(Error::IllegalSyntax)?;
                    entries.push(InfoParams::CurrMove(currmove.to_string()));
                }
                "hashfull" => {
                    let hashfull: i32 = iter
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or(Error::IllegalSyntax)?;
                    entries.push(InfoParams::HashFull(hashfull));
                }
                "nps" => {
                    let nps: i32 = iter
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or(Error::IllegalSyntax)?;
                    entries.push(InfoParams::Nps(nps));
                }
                "string" => {
                    entries.push(InfoParams::Text(iter.join(" ")));
                    // "pv" or "str" must be the final item.
                    break;
                }
                _ => return Err(Error::IllegalSyntax),
            }
        }

        Ok(EngineCommand::Info(entries))
    }

    fn parse_option(mut self) -> Result<EngineCommand, Error> {
        let opt_name = match (self.iter.next(), self.iter.next(), self.iter.next()) {
            (Some("name"), Some(opt_name), Some("type")) => opt_name,
            _ => return Err(Error::IllegalSyntax),
        };

        let opt_type = match self.iter.next() {
            Some("check") => {
                let default = self
                    .iter
                    .find(|v| *v != "default")
                    .and_then(|s| s.parse().ok());

                OptionKind::Check { default }
            }
            Some("spin") => {
                let mut default = None;
                let mut min = None;
                let mut max = None;

                while let Some(kind) = self.iter.next() {
                    match kind {
                        "default" => default = self.iter.next().and_then(|s| s.parse().ok()),
                        "min" => min = self.iter.next().and_then(|s| s.parse().ok()),
                        "max" => max = self.iter.next().and_then(|s| s.parse().ok()),
                        _ => {}
                    }
                }

                OptionKind::Spin { default, min, max }
            }
            Some("combo") => {
                let mut default = None;
                let mut vars = Vec::new();

                while let Some(kind) = self.iter.next() {
                    match kind {
                        "default" => default = self.iter.next().map(parse_default),
                        "var" => {
                            self.iter.for_each(|v| {
                                vars.push(v.to_string());
                            });
                            break;
                        }
                        _ => {}
                    }
                }

                OptionKind::Combo { default, vars }
            }
            Some("button") => {
                let default = self.iter.find(|v| *v != "default").map(parse_default);

                OptionKind::Button { default }
            }
            Some("string") => {
                let default = self.iter.find(|v| *v != "default").map(parse_default);

                OptionKind::String { default }
            }
            Some("filename") => {
                let default = self.iter.find(|v| *v != "default").map(parse_default);

                OptionKind::Filename { default }
            }
            _ => return Err(Error::IllegalSyntax),
        };

        Ok(EngineCommand::Option(OptionParams {
            name: opt_name.to_string(),
            value: opt_type,
        }))
    }
}

fn parse_default(s: &str) -> String {
    if s == "<empty>" {
        String::new()
    } else {
        s.to_string()
    }
}
