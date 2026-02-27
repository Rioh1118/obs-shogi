import { copyText } from "@/shared/api/clipboard/copyText";
import { AlertTriangle, CheckCircle, Copy, Info } from "lucide-react";
import { SButton, SSection } from "../kit";

function treeTemplate(aiRootLabel = "AIルート（ai_root）") {
  return `\
${aiRootLabel}
├─ engines/                ← エンジン本体（実行ファイル）
│   ├─ YaneuraOu-XXXX
│   └─ ...
├─ <AI名>/
│   ├─ eval/               ← 評価関数（例: nn.bin）
│   │   └─ nn.bin
│   └─ book/               ← 定跡DB（例: .db）
│       └─ book.db
└─ README.txt（任意：導入メモ）
`;
}

function StepItem({
  title,
  desc,
  state,
}: {
  title: string;
  desc?: string;
  state: "todo" | "done" | "warn";
}) {
  const Icon =
    state === "done" ? CheckCircle : state === "warn" ? AlertTriangle : Info;
  return (
    <div className="aiLibraryTab__step" data-state={state}>
      <div className="aiLibraryTab__stepIcon" aria-hidden="true">
        <Icon size={16} />
      </div>
      <div className="aiLibraryTab__stepBody">
        <div className="aiLibraryTab__stepTitle">{title}</div>
        {desc && <div className="aiLibraryTab__stepDesc">{desc}</div>}
      </div>
    </div>
  );
}

type Props = {
  canOperate: boolean;
  enginesDirOk: boolean;
  enginesCount: number;
  profilesCount: number;
  scanReady: boolean;
  warnings: string[];
};

export default function SetupGuide({
  canOperate,
  enginesDirOk,
  enginesCount,
  profilesCount,
  scanReady,
  warnings,
}: Props) {
  const helpTree = treeTemplate(`Users/TaroYamada/test_shogi_engine/`);

  const stepPick: "todo" | "done" = canOperate ? "done" : "todo";
  const stepLayout: "todo" | "done" | "warn" = !canOperate
    ? "todo"
    : enginesDirOk
      ? "done"
      : "warn";
  const stepEngine: "todo" | "done" | "warn" = !canOperate
    ? "todo"
    : enginesCount > 0
      ? "done"
      : "warn";
  const stepAssets: "todo" | "done" | "warn" = !canOperate
    ? "todo"
    : profilesCount > 0
      ? "done"
      : "warn";

  return (
    <div className="aiLibraryTab__guideCol">
      <SSection
        title="セットアップガイド"
        description="エンジン関連ファイルのファイル構造"
        actions={
          <SButton variant="ghost" size="sm" onClick={() => copyText(helpTree)}>
            <Copy size={16} style={{ marginRight: 6 }} />
            ツリーをコピー
          </SButton>
        }
      >
        <div className="aiLibraryTab__guide">
          <div className="aiLibraryTab__steps">
            <StepItem
              title="1) ai_root を選択する"
              desc="AI関連のファイルをまとめる専用フォルダを1つ作って固定するのがおすすめ。"
              state={stepPick}
            />
            <StepItem
              title="2) engines/ を作成する"
              desc="まずはエンジン置き場（engines/）を作ります。"
              state={stepLayout}
            />
            <StepItem
              title="3) engines/ にエンジン実行ファイルを置く"
              desc="ダウンロードした実行ファイルを engines/ にドラッグ&ドロップ。"
              state={stepEngine}
            />
            <StepItem
              title="4) <AI名>/eval と <AI名>/book に置く"
              desc="評価関数（nn.bin）や定跡DB（.db）を AI名フォルダ配下へ。"
              state={stepAssets}
            />
          </div>

          <pre className="aiLibraryTab__tree" aria-label="AIルート構成">
            {helpTree}
          </pre>

          <div className="aiLibraryTab__note">
            <Info size={14} style={{ marginRight: 6 }} />
            迷ったら「engines/ を作成」→「engines/
            を開く」→配置→「再スキャン」。
          </div>

          {scanReady && warnings.length > 0 && (
            <div className="aiLibraryTab__warnings" role="status">
              <div className="aiLibraryTab__warningsTitle">
                <AlertTriangle size={16} style={{ marginRight: 6 }} />
                注意
              </div>
              {warnings.map((w, i) => (
                <div key={i} className="aiLibraryTab__warningItem">
                  {w}
                </div>
              ))}
            </div>
          )}
        </div>
      </SSection>

      <SSection
        title="運用のコツ"
        description="研究用途の混乱を防ぐためのおすすめ。"
      >
        <ul className="aiLibraryTab__tips">
          <li>ai_root は “AIの置き場” として固定（頻繁に変えない）</li>
          <li>
            AI名（フォルダ名）をプリセットの「AI名」と揃えると迷子になりにくい
          </li>
          <li>ファイル追加後は「再スキャン」だけで反映</li>
        </ul>
      </SSection>
    </div>
  );
}
