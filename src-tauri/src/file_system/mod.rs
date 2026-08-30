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

// 書き出したものを読み手（`search::kifu_reader`）に通すテストのため。
// 書き手と読み手を別々に見ていると、このアプリが作ったファイルを
// このアプリが読めない組み合わせを誰も見ない
#[cfg(test)]
pub(crate) use operations::spell_for_extension_for_test;

pub use mv::{mv_directory, mv_kifu_file, rename_directory, rename_kifu_file};

pub use tree::get_file_tree;
pub use types::FileTreeNode;
