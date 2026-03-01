use std::io::BufRead;
use std::time::Instant;

use crate::error::Error;
use crate::EngineCommand;

/// A struct to represent each output produced from a USI engine process.
#[derive(Debug)]
pub struct EngineOutput {
    response: Option<EngineCommand>,
    raw_str: String,
    timestamp: Instant,
}

impl EngineOutput {
    pub fn response(&self) -> &Option<EngineCommand> {
        &self.response
    }

    pub fn raw_str(&self) -> &str {
        &self.raw_str
    }

    pub fn timestamp(&self) -> &Instant {
        &self.timestamp
    }
}

/// `EngineCommandReader<R>` produces a structured output from a reader.
///
/// # Examples
///
/// ```
/// use usi::{BestMoveParams, EngineCommand, EngineCommandReader};
///
/// let buf = "usiok\nreadyok\n";
/// let mut reader = EngineCommandReader::new(buf.as_bytes());
/// assert_eq!(Some(EngineCommand::UsiOk), *reader.next_command().unwrap().response());
/// assert_eq!(Some(EngineCommand::ReadyOk), *reader.next_command().unwrap().response());
///```
///
#[derive(Debug)]
pub struct EngineCommandReader<R: BufRead> {
    receive: R,
}

impl<R: BufRead> EngineCommandReader<R> {
    pub fn new(receive: R) -> Self {
        EngineCommandReader { receive }
    }

    pub fn next_command(&mut self) -> Result<EngineOutput, Error> {
        let mut buf = String::new();

        loop {
            let bytes_read = self.receive.read_line(&mut buf)?;
            if bytes_read == 0 {
                return Ok(EngineOutput {
                    response: None,
                    raw_str: buf,
                    timestamp: Instant::now(),
                });
            }

            if !buf.trim().is_empty() {
                break;
            }
            buf.clear();
        }

        let res = EngineCommand::parse(&buf)?;
        Ok(EngineOutput {
            response: Some(res),
            raw_str: buf,
            timestamp: Instant::now(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BestMoveParams;

    #[test]
    fn it_works() {
        let buf = "\nusiok\n\n     readyok\n  bestmove 5e5f\n";

        let mut reader = EngineCommandReader::new(buf.as_bytes());

        let output = reader.next_command().expect("failed to read the output");

        if !matches!(*output.response(), Some(EngineCommand::UsiOk)) {
            unreachable!("unexpected {:?}", output.response());
        }
        assert_eq!("usiok\n", output.raw_str());

        let output = reader.next_command().expect("failed to read the output");
        if !matches!(*output.response(), Some(EngineCommand::ReadyOk)) {
            unreachable!("unexpected {:?}", output.response());
        }
        assert_eq!("     readyok\n", output.raw_str());

        let output = reader.next_command().expect("failed to read the output");
        if !matches!(
            *output.response(),
            Some(EngineCommand::BestMove(BestMoveParams::MakeMove(_, None)))
        ) {
            unreachable!("unexpected {:?}", output.response());
        }
        assert_eq!("  bestmove 5e5f\n", output.raw_str());
    }
}
