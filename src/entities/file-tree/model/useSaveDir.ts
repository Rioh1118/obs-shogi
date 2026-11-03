import { useMemo, useState } from "react";
import { collectDirs, type DirOption } from "../lib/collectDirs";
import { useFileTree } from "./useFileTree";

/** 保存先の欄に要るもの */
type SaveDir = {
  /** ツリーを平らにしたフォルダの一覧。ツリーが無ければ空 */
  dirOptions: DirOption[];
  /** 選んでいるフォルダの絶対パス。ツリーが無ければ空文字 */
  selectedDir: string;
  setSelectedDir: (dir: string) => void;
};

/**
 * 棋譜を作る面の、保存先の欄の値を返す。
 *
 * 作る面は入口が2つあり、ようこそ画面から開くと保存先が来ない。欄を持たずに空のまま送ると
 * Rust 側が `invalid_path` を返し、保存先を一度も選んでいないのに「その場所は扱えません」と
 * 言われる。来なかったときの既定はツリーの根。
 *
 * **選んでいる値が一覧から外れたら根へ戻す。** `Select` は選択肢に無い値をプレースホルダで
 * 描くので、値だけ残すと、欄が「選択してください」と言っているのに消えたパスへ書きに行く。
 *
 * @param initialDir ツリーから開いたときのフォルダ。来なければ根を選ぶ
 */
export function useSaveDir(initialDir?: string): SaveDir {
  const { fileTree } = useFileTree();

  const rootPath = fileTree?.path ?? "";
  const dirOptions = useMemo(
    () => (fileTree ? collectDirs(fileTree, rootPath) : []),
    [fileTree, rootPath],
  );
  const [selectedDir, setSelectedDir] = useState(initialDir || rootPath);

  // ツリーの根が入れ替わったら保存先を根へ戻す。ただし前の根が空（ツリーを読み終わる前）
  // なら、選んでいる値は呼び手から来た `initialDir` なので残す —— 根が無いあいだは一覧も
  // 空で、利用者は何も選べない。読み終わったツリーに無ければ、下の枝が根へ戻す
  const [prevRoot, setPrevRoot] = useState(rootPath);
  if (rootPath !== prevRoot) {
    setPrevRoot(rootPath);
    setSelectedDir(prevRoot === "" && selectedDir ? selectedDir : rootPath);
  }

  // 選んでいたフォルダだけが消えたときも根へ戻す。
  // 一覧が空のあいだは触らない。ツリーが未読のときも `dirOptions` は空で、
  // ここで戻すと呼び手から来た `initialDir` を読み込みの途中で根へ潰す
  if (selectedDir && dirOptions.length > 0 && !dirOptions.some((o) => o.value === selectedDir)) {
    setSelectedDir(rootPath);
  }

  return { dirOptions, selectedDir, setSelectedDir };
}
