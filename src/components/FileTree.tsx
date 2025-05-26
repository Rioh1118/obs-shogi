import type { FileTreeNode } from "@/types/file-tree";
import { v5 as uuidv5 } from "uuid";
import RootNode from "./RootNode";
import "./FileTree.scss";

const NAMESPACE = "1b671a64-40d5-491e-99b0-da01ffd0a487";
const generateId = (path: string) => uuidv5(path, NAMESPACE);

function FileTree() {
  const rootNode: FileTreeNode = {
    id: generateId("/shogi-projects"),
    name: "shogi-projects",
    path: "/shogi-projects",
    isDir: true,
    isOpen: true,
    isRoot: true,
    meta: {
      iconType: "folder",
    },
    children: [
      {
        id: generateId("/shogi-projects/矢倉"),
        name: "矢倉",
        path: "/shogi-projects/矢倉",
        isDir: true,
        isOpen: false,
        meta: { iconType: "folder" },
        children: [
          {
            id: generateId("/shogi-projects/矢倉/相矢倉"),
            name: "相矢倉",
            path: "/shogi-projects/矢倉/相矢倉",
            isDir: true,
            isOpen: false,
            meta: { iconType: "folder" },
            children: [
              {
                id: generateId("/shogi-projects/矢倉/相矢倉/対振り飛車.kif"),
                name: "対振り飛車.kif",
                path: "/shogi-projects/矢倉/相矢倉/対振り飛車.kif",
                isDir: false,
                isOpen: false,
                meta: {
                  fileType: "kif",
                  iconType: "kif-file",
                },
              },
            ],
          },
        ],
      },
      {
        id: generateId("/shogi-projects/居飛車"),
        name: "居飛車",
        path: "/shogi-projects/居飛車",
        isDir: true,
        isOpen: true,
        meta: { iconType: "folder" },
        children: [
          {
            id: generateId("/shogi-projects/居飛車/角換わり"),
            name: "角換わり",
            path: "/shogi-projects/居飛車/角換わり",
            isDir: true,
            isOpen: false,
            meta: { iconType: "folder" },
          },
          {
            id: generateId("/shogi-projects/居飛車/横歩取り.ki2"),
            name: "横歩取り.ki2",
            path: "/shogi-projects/居飛車/横歩取り.ki2",
            isDir: false,
            isOpen: false,
            meta: {
              fileType: "ki2",
              iconType: "kif-file",
            },
          },
        ],
      },
      {
        id: generateId("/shogi-projects/戦法研究.md"),
        name: "戦法研究.md",
        path: "/shogi-projects/戦法研究.md",
        isDir: false,
        isOpen: false,
        meta: {
          fileType: "other",
          iconType: "document",
        },
      },
      {
        id: generateId("/shogi-projects/.gitignore"),
        name: ".gitignore",
        path: "/shogi-projects/.gitignore",
        isDir: false,
        isOpen: false,
        meta: {
          fileType: "other",
          iconType: "document",
        },
      },
    ],
  };

  return (
    <div className="file-tree">
      <RootNode node={rootNode} />
    </div>
  );
}

export default FileTree;
