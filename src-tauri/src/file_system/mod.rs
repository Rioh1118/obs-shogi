mod error;
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

#[cfg(test)]
mod tests {
    /// `#[command]` の本体と、そこに現れる識別子を機械的に見るための最小の切り出し。
    /// 構文解析はしない。`#[command]` から次の `#[command]` またはファイル末尾までを1つとして扱う
    fn commands(source: &str) -> Vec<(&str, &str)> {
        let mut found = Vec::new();
        for chunk in source.split("#[command]").skip(1) {
            let name = chunk
                .split("pub fn ")
                .nth(1)
                .and_then(|rest| {
                    rest.split(|c: char| !c.is_alphanumeric() && c != '_')
                        .next()
                })
                .unwrap_or("");
            found.push((name, chunk));
        }
        found
    }

    /// パスを受け取るコマンドは、必ず root 配下かを確かめる。
    ///
    /// 関門を「各コマンドが自分で呼ぶ」形にしてあるので、**呼び忘れが静的には見えない**。
    /// 実際に `mv.rs` の4つが `AppHandle` すら受け取らないまま、root 外の
    /// ディレクトリを改名・移動できる状態で残っていた。
    ///
    /// 除外するものが出たら、ここに理由と一緒に名前を並べること。
    #[test]
    fn every_path_taking_command_checks_the_root() {
        // ツリーの取得は root_dir そのものを引数で受ける。設定値との突き合わせは
        // 別の話（呼び出し側が渡す値が設定値かどうか）なので、ここでは除く
        const EXEMPT: [&str; 1] = ["get_file_tree"];

        let sources = [
            ("operations.rs", include_str!("operations.rs")),
            ("mv.rs", include_str!("mv.rs")),
            ("tree.rs", include_str!("tree.rs")),
        ];

        let missing: Vec<String> = sources
            .iter()
            .flat_map(|(file, source)| {
                commands(source)
                    .into_iter()
                    .filter_map(move |(name, body)| {
                        if EXEMPT.contains(&name) || body.contains("validate_under_root") {
                            return None;
                        }
                        Some(format!("{file}: {name}"))
                    })
            })
            .collect();

        assert!(
            missing.is_empty(),
            "root 配下かを確かめていないコマンドがある。webview 側から任意のパスを渡せる:\n{}",
            missing.join("\n")
        );
    }
}
