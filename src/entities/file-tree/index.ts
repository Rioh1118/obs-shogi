/**
 * このスライスの公開面。**名前を明示列挙する。**
 *
 * `export *` にすると、モジュールにシンボルを1つ足しただけで公開面が黙って広がる。
 * `src/__tests__/sliceBarrels.test.ts` は「barrel が公開しているものを外から
 * 直に読まない」を強制するので、公開面が広がるほど内部用のヘルパにまで
 * その規則が掛かり、内側で自由に動かせなくなる。
 *
 * ここに並ぶのは**スライスの外に呼び出し元があるものだけ**。
 * 増やすときは、外から使う場所と一緒に足すこと。
 */
export type { FsError, FsErrorCode } from "./api/error";
export {
  describeFsError,
  fsErrorTier,
  isOperationAlreadyCommitted,
  isResolvedByConflictDialog,
} from "./api/error";
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
