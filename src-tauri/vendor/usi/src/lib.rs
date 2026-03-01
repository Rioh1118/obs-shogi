//! A module for working with USI protocol in a type-safe way.
//!
//! USI protocol defines commands sent from either GUIs or engines.
//! Detail about USI protocol can be found at <http://www.geocities.jp/shogidokoro/usi.html>.
//!
//! # Data types representing commands defined in USI protocol.
//!
//! `GuiCommand` and `EngineCommand` represents input/output commands defined in the protocol.
//!
//! # Examples
//!
//! ```
//! use std::time::Duration;
//! use usi::{GuiCommand, ThinkParams, EngineCommand, BestMoveParams};
//!
//! // GuiCommand can be converted into the USI compliant string.
//! let params = ThinkParams::new().btime(Duration::from_secs(1)).wtime(Duration::from_secs(2));
//! let cmd = GuiCommand::Go(params);
//! assert_eq!("go btime 1000 wtime 2000", cmd.to_string());
//!
//! // EngineCommand can be parsed from the command string sent from the USI engine.
//! let cmd = EngineCommand::parse("bestmove 7g7f ponder 8c8d").unwrap();
//! match cmd {
//!     EngineCommand::BestMove(BestMoveParams::MakeMove(ref m, Some(ref pm))) => {
//!         assert_eq!("7g7f", *m);
//!         assert_eq!("8c8d", *pm);
//!     },
//!     _ => unreachable!(),
//! }
//! ```
//!
//! # Working with a USI engine process
//!
//! `UsiEngineHandler` can be used to spawn the USI engine process.
//! You can send `GuiCommand`s and receive `EngineCommand`.
//!
//! # Examples
//! ```no_run
//! use usi::{BestMoveParams, Error, EngineCommand, GuiCommand, UsiEngineHandler};
//!
//! let mut handler = UsiEngineHandler::spawn("/path/to/usi_engine", "/path/to/working_dir").unwrap();
//!
//! // Get the USI engine information.
//! let info = handler.get_info().unwrap();
//! assert_eq!("engine name", info.name());
//!
//! // Set options.
//! handler.send_command(&GuiCommand::SetOption("USI_Ponder".to_string(), Some("true".to_string()))).unwrap();
//! handler.prepare().unwrap();
//! handler.send_command(&GuiCommand::UsiNewGame).unwrap();
//!
//! // Start listening to the engine output.
//! // You can pass the closure which will be called
//! //   everytime new command is received from the engine.
//! handler.listen(move |output| -> Result<(), Error> {
//!     match output.response() {
//!         Some(EngineCommand::BestMove(BestMoveParams::MakeMove(
//!                      ref best_move_sfen,
//!                      ref ponder_move,
//!                 ))) => {
//!                     assert_eq!("5g5f", best_move_sfen);
//!                 }
//!         _ => {}
//!     }
//!     Ok(())
//! }).unwrap();
//! handler.send_command(&GuiCommand::Usi).unwrap();
//! ```
mod error;
mod process;
mod protocol;

pub use self::error::*;
pub use self::process::*;
pub use self::protocol::*;
