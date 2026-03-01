use std::io::Write;

use crate::error::Error;
use crate::GuiCommand;

/// `GuiCommandWriter<W>` converts `GuiCommand`s and writes strings into the writer.
///
/// # Examples
///
/// ```
/// use usi::{GuiCommand, GuiCommandWriter};
///
/// let mut buf: Vec<u8> = Vec::new();
/// let mut writer = GuiCommandWriter::new(&mut buf);
/// writer.send(&GuiCommand::Usi).unwrap();
/// writer.send(&GuiCommand::IsReady).unwrap();
/// writer.send(&GuiCommand::SetOption("key".to_string(), Some("val".to_string()))).unwrap();
/// assert_eq!("usi\nisready\nsetoption name key value val\n", std::str::from_utf8(&buf).unwrap());
///```
///
#[derive(Debug)]
pub struct GuiCommandWriter<W: Write> {
    writer: W,
}

impl<W: Write> GuiCommandWriter<W> {
    pub fn new(writer: W) -> Self {
        GuiCommandWriter { writer }
    }

    pub fn send(&mut self, command: &GuiCommand) -> Result<(), Error> {
        let s = format!("{}\n", command);
        self.writer.write_all(s.as_bytes())?;
        self.writer.flush()?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let mut buf: Vec<u8> = Vec::new();
        let mut writer = GuiCommandWriter::new(&mut buf);
        writer
            .send(&GuiCommand::Usi)
            .expect("failed to write to the buffer");
        writer
            .send(&GuiCommand::IsReady)
            .expect("failed to write to the buffer");
        writer
            .send(&GuiCommand::SetOption(
                "key".to_string(),
                Some("val".to_string()),
            ))
            .expect("failed to write to the buffer");
        assert_eq!(
            "usi\nisready\nsetoption name key value val\n",
            std::str::from_utf8(&buf).unwrap()
        );
    }
}
