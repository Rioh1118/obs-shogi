/**
 * このスライスの公開面。名前を明示して列挙する。
 *
 * `export *` にすると、モジュールにシンボルを1つ足しただけで公開面が黙って広がる。
 * `src/__tests__/sliceBarrels.test.ts` は「barrel が公開しているものを外から
 * 直に読まない」を強制するので、公開面が広がるほど内部の関数にもその規則が掛かる。
 *
 * ここに並べるのは**スライスの外に呼び手があるものだけ**。増やすときは呼び手と一緒に足す。
 */
export type { FsError } from "./api/error";
export {
  asFsError,
  describeFsError,
  fsErrorTier,
  isNameInputError,
  isOperationAlreadyCommitted,
  isResolvedByConflictDialog,
} from "./api/error";
export { collectDirs } from "./lib/collectDirs";
export { commitName, type CommitOutcome } from "./lib/commitName";
export { isProjectRoot } from "./lib/isProjectRoot";
export type {
  FileTreeNode,
  FileTreeFailure,
  FileConflictRequest,
  FileConflictState,
} from "./model/types";
export { useFileTree } from "./model/useFileTree";
export { FileTreeProvider } from "./model/provider";
export { default as FsErrorView } from "./ui/FsErrorView";
export { readText } from "./api/service";
