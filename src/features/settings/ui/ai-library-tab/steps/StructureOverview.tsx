import { canListEnginesDir, type EnginesDir } from "@/entities/engine/lib/enginesDir";

import type { SetupGuideProfile } from "../types";

type NodeState = "ok" | "missing" | "empty" | "placeholder";

type TreeNodeProps = {
  label: string;
  note?: string;
  state: NodeState;
  indent?: number;
  isLast?: boolean;
};

function TreeNode({ label, note, state, indent = 0, isLast = false }: TreeNodeProps) {
  const connector = indent === 0 ? "" : isLast ? "└─ " : "├─ ";
  const padding = indent === 0 ? 0 : (indent - 1) * 18 + 4;

  return (
    <div className="structureOverview__node" data-state={state} style={{ paddingLeft: padding }}>
      <span className="structureOverview__connector">{connector}</span>
      <span className="structureOverview__label">{label}</span>
      {note && <span className="structureOverview__note">{note}</span>}
    </div>
  );
}

/**
 * 木に添える一言と色。網羅の理由は `EnginesDir` の doc。
 * ルートが未選択なら索引も無いので、`enginesDir` は必ず `unknown` になる
 */
const ENGINES_DIR_NOTE: Record<EnginesDir, string | undefined> = {
  unknown: undefined,
  missing: "← 作成が必要",
  dir: undefined,
  other: "← フォルダではない",
};

const ENGINES_DIR_STATE: Record<EnginesDir, NodeState> = {
  unknown: "placeholder",
  missing: "missing",
  dir: "ok",
  other: "missing",
};

type Props = {
  aiRootPath: string | null;
  enginesDir: EnginesDir;
  /** AI フォルダを作れるか。条件は `SetupGuide` が決める。ここで組むと入力欄が無いときにも作成を指示する */
  canCreateProfile: boolean;
  engineNames: string[];
  profiles: SetupGuideProfile[];
};

export function StructureOverview({
  aiRootPath,
  enginesDir,
  canCreateProfile,
  engineNames,
  profiles,
}: Props) {
  const rootLabel = aiRootPath
    ? (aiRootPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "ai_root")
    : "ai_root";

  return (
    <div className="structureOverview">
      <TreeNode
        label={`📂 ${rootLabel}/`}
        note={aiRootPath ? undefined : "← まず選択"}
        state={aiRootPath ? "ok" : "placeholder"}
      />

      <TreeNode
        label="📂 engines/"
        note={ENGINES_DIR_NOTE[enginesDir]}
        state={ENGINES_DIR_STATE[enginesDir]}
        indent={1}
        isLast={profiles.length === 0}
      />

      {canListEnginesDir(enginesDir) &&
        (engineNames.length > 0 ? (
          engineNames.map((name, i) => (
            <TreeNode
              key={name}
              label={`🔧 ${name}`}
              state="ok"
              indent={2}
              isLast={i === engineNames.length - 1}
            />
          ))
        ) : (
          <TreeNode label="（実行ファイルを置いてください）" state="missing" indent={2} isLast />
        ))}

      {profiles.length > 0
        ? profiles.map((p, pi) => {
            const isLastProfile = pi === profiles.length - 1;
            const evalOk = p.hasEvalDir && p.evalCount > 0;
            const bookOk = p.hasBookDir && p.bookCount > 0;
            return (
              <div key={p.path}>
                <TreeNode
                  label={`📂 ${p.name}/`}
                  state="ok"
                  indent={1}
                  isLast={isLastProfile && !evalOk && !bookOk}
                />
                <TreeNode
                  label="📂 eval/"
                  note={evalOk ? undefined : "← nn.bin を置く"}
                  state={evalOk ? "ok" : "missing"}
                  indent={2}
                />
                <TreeNode
                  label="📂 book/"
                  note={bookOk ? undefined : "← .db を置く（任意）"}
                  state={bookOk ? "ok" : "empty"}
                  indent={2}
                  isLast={isLastProfile}
                />
              </div>
            );
          })
        : aiRootPath && (
            <TreeNode
              label="📂 ＜AI 名＞/"
              note={canCreateProfile ? "← AI フォルダを作成" : undefined}
              state="placeholder"
              indent={1}
              isLast
            />
          )}
    </div>
  );
}
