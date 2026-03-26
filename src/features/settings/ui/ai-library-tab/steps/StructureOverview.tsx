import type { SetupGuideProfile } from "../SetupGuide";

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
  const padding = indent === 0 ? 0 : (indent - 1) * 18 + (indent > 0 ? 4 : 0);

  return (
    <div className="structureOverview__node" data-state={state} style={{ paddingLeft: padding }}>
      <span className="structureOverview__connector">{connector}</span>
      <span className="structureOverview__label">{label}</span>
      {note && <span className="structureOverview__note">{note}</span>}
    </div>
  );
}

type Props = {
  aiRootPath: string | null;
  enginesDirExists: boolean;
  engineNames: string[];
  profiles: SetupGuideProfile[];
};

export function StructureOverview({ aiRootPath, enginesDirExists, engineNames, profiles }: Props) {
  const rootLabel = aiRootPath
    ? (aiRootPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "ai_root")
    : "ai_root";

  return (
    <div className="structureOverview">
      {/* ai_root */}
      <TreeNode
        label={`📂 ${rootLabel}/`}
        note={aiRootPath ? undefined : "← まず選ぶ"}
        state={aiRootPath ? "ok" : "placeholder"}
        indent={0}
      />

      {/* engines/ */}
      <TreeNode
        label="📂 engines/"
        note={!aiRootPath ? undefined : !enginesDirExists ? "← 作成が必要" : undefined}
        state={!aiRootPath ? "placeholder" : enginesDirExists ? "ok" : "missing"}
        indent={1}
        isLast={profiles.length === 0}
      />

      {/* engine files */}
      {enginesDirExists &&
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

      {/* AI profiles */}
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
                  isLast={false}
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
              label="📂 ＜AI名＞/"
              note="← AIフォルダを作成"
              state="placeholder"
              indent={1}
              isLast
            />
          )}
    </div>
  );
}
