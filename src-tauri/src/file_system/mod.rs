// `ai_library` が名前の失敗を利用者向けの一文へ直すのに `FsErrorCode` が要る。
// あちらの戻り値は `String` なので code が落ちる → TODO(#231)
pub(crate) mod error;
mod mv;
mod operations;
mod tree;
mod types;
pub(crate) mod utils;

pub use operations::{
    create_directory, create_kifu_file, delete_directory, delete_file, import_kifu_file, read_file,
    save_kifu_file,
};
pub(crate) use operations::{is_initial_gote, patch_gote_start};

pub use mv::{mv_directory, mv_kifu_file, rename_directory, rename_kifu_file};

pub use tree::get_file_tree;
pub use types::FileTreeNode;
