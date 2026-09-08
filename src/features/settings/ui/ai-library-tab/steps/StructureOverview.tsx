import { enginesDirUsable, type EnginesDir } from "@/entities/engine/lib/enginesDir";

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
  const padding = indent === 0 ? 0 : (indent - 1) * 18 + (indent > 0 ? 4 : 0);

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
  /** `engines` が何として在るか。4つに割れている理由は `EnginesDir` の doc */
  enginesDir: EnginesDir;
  /**
   * いま AI フォルダを作れるか。**この木は「作れ」と指示する側なので、要る。**
   *
   * 出す条件を自分で組むと、入力欄が描かれない回にも指示が出る——
   * 読めていない回（観測していないことを断言する）と、エンジンが0件の回
   * （同じ画面のカードは「エンジンを置いた後に作成できます」と逆を言う）。
   * どちらも探しても作成口は無い。判断は `SetupGuide` が1度だけ組む
   */
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
        note={ENGINES_DIR_NOTE[enginesDir]}
        state={ENGINES_DIR_STATE[enginesDir]}
        indent={1}
        isLast={profiles.length === 0}
      />

      {/* engine files */}
      {enginesDirUsable(enginesDir) &&
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
              note={canCreateProfile ? "← AIフォルダを作成" : undefined}
              state="placeholder"
              indent={1}
              isLast
            />
          )}
    </div>
  );
}
