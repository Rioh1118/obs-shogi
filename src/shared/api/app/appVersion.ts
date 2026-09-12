import { getVersion } from "@tauri-apps/api/app";

/**
 * いま走っているアプリの版。
 *
 * **`tauri.conf.json` の `version` が出どころ。** リポジトリに置いてある値は
 * 開発用の据え置きで、配布物にはタグから打ち直した値が入る（`docs/RELEASE.md`）。
 * 開発ビルドで実際の公開版より小さく見えるのはそのため。
 */
export async function getAppVersion(): Promise<string> {
  return getVersion();
}
