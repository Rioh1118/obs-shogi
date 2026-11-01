import { openSinglePath } from "./openSinglePath";

/** ファイルを1つ選ばせる。取り消したら `null`。絞り込みはしない（何を読むかは呼び手が決める） */
export async function pickFile(title: string): Promise<string | null> {
  return openSinglePath({ directory: false, title });
}
