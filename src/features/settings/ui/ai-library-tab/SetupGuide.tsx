import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  FolderOpen,
  RefreshCw,
  Sparkles,
  Wrench,
} from "lucide-react";
import { SButton, SField, SInput, SSection } from "../kit";
import SettingsBadge from "../kit/SettingsBadge";
import type { StepState } from "./steps/StepShell";
import { Step1SelectRoot } from "./steps/Step1SelectRoot";
import { Step2CreateEngines } from "./steps/Step2CreateEngines";
import { Step3PlaceEngines } from "./steps/Step3PlaceEngines";
import { Step4PlaceAssets } from "./steps/Step4PlaceAssets";
import { StructureOverview } from "./steps/StructureOverview";
import { FolderConcept } from "./steps/FolderConcept";
import "./SetupGuide.scss";

export type SetupGuideProfile = {
  name: string;
  path: string;
  hasEvalDir: boolean;
  hasBookDir: boolean;
  evalCount: number;
  bookCount: number;
};

type NextAction = {
  tone: "ok" | "warn" | "todo";
  icon: React.ReactNode;
  title: string;
  desc: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryLoading?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

type Props = {
  aiRootPath: string | null;
  scanStatus: "idle" | "loading" | "ok" | "error";
  scanError?: string | null;
  enginesDirExists: boolean;
  enginesDirPath?: string;
  enginesCount: number;
  engineNames: string[];
  profiles: SetupGuideProfile[];
  warnings?: string[];
  isScanning: boolean;
  onSelectRoot: () => void;
  onRescan: () => void;
  onCreateEnginesDir: () => void;
  onOpenAiRoot: () => void;
  onOpenEnginesDir: () => void;
  onCreateAiFolder: (aiName: string) => Promise<void>;
};

function StatusCard({
  label,
  value,
  hint,
  icon,
  state,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  state: "ok" | "warn" | "todo";
}) {
  return (
    <div className="setupGuide__statusCard" data-state={state}>
      <div className="setupGuide__statusCardTop">
        {icon}
        <span className="setupGuide__statusCardLabel">{label}</span>
      </div>
      <div className="setupGuide__statusCardValue">{value}</div>
      {hint && <div className="setupGuide__statusCardHint">{hint}</div>}
    </div>
  );
}

function ProfileItem({ profile }: { profile: SetupGuideProfile }) {
  const evalOk = profile.hasEvalDir && profile.evalCount > 0;
  const bookOk = profile.hasBookDir && profile.bookCount > 0;
  return (
    <div className="setupGuide__profileItem">
      <div className="setupGuide__profileHead">
        <span className="setupGuide__profileName">{profile.name}</span>
        <div className="setupGuide__profileBadges">
          <SettingsBadge tone={evalOk ? "accent" : "warn"} shape="pill">
            eval {evalOk ? "あり" : "不足"}
          </SettingsBadge>
          <SettingsBadge tone={bookOk ? "accent" : "muted"} shape="pill">
            book {bookOk ? "あり" : "未設定"}
          </SettingsBadge>
        </div>
      </div>
      <div className="setupGuide__profilePath">{profile.path}</div>
    </div>
  );
}

export default function SetupGuide({
  aiRootPath,
  scanStatus,
  scanError = null,
  enginesDirExists,
  enginesDirPath,
  enginesCount,
  engineNames,
  profiles,
  warnings = [],
  isScanning,
  onSelectRoot,
  onRescan,
  onCreateEnginesDir,
  onOpenAiRoot,
  onOpenEnginesDir,
  onCreateAiFolder,
}: Props) {
  const [aiNameDraft, setAiNameDraft] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const aiNameRef = useRef<HTMLInputElement | null>(null);

  const handleCreateFolder = async () => {
    const name = aiNameDraft.trim();
    if (!name) {
      aiNameRef.current?.focus();
      return;
    }
    try {
      setIsCreatingFolder(true);
      await onCreateAiFolder(name);
      setAiNameDraft("");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // ── step states ────────────────────────────────────────────────────────

  const canOperate = !!aiRootPath;
  const scanReady = scanStatus === "ok";

  const step1: StepState = canOperate ? "done" : "active";
  const step2: StepState = !canOperate ? "locked" : enginesDirExists ? "done" : "active";
  const step3: StepState = !enginesDirExists
    ? "locked"
    : enginesCount > 0
      ? "done"
      : scanReady
        ? "warn"
        : "active";
  const step4: StepState = !enginesDirExists
    ? "locked"
    : profiles.length > 0
      ? "done"
      : scanReady
        ? "warn"
        : "locked";

  const shortRoot =
    aiRootPath && aiRootPath.length > 32 ? "…" + aiRootPath.slice(-31) : (aiRootPath ?? "");

  // ── next action (hero) ─────────────────────────────────────────────────

  const nextAction = useMemo<NextAction>(() => {
    if (!aiRootPath) {
      return {
        tone: "todo",
        icon: <FolderOpen size={18} />,
        title: "AIの置き場フォルダを選んでください",
        desc: "エンジン・評価関数・定跡をまとめる専用フォルダを1つ選ぶところから始まります。",
        primaryLabel: "フォルダを選択…",
        onPrimary: onSelectRoot,
      };
    }
    if (scanStatus === "loading") {
      return {
        tone: "todo",
        icon: <RefreshCw size={18} />,
        title: "フォルダを確認しています",
        desc: "エンジンや AI フォルダの有無を読み取っています。",
        primaryLoading: true,
      };
    }
    if (scanStatus === "error") {
      return {
        tone: "warn",
        icon: <AlertTriangle size={18} />,
        title: "フォルダを確認できませんでした",
        desc: scanError ?? "再スキャンして状態を読み直してください。",
        primaryLabel: "再スキャン",
        onPrimary: onRescan,
        secondaryLabel: "フォルダを開く",
        onSecondary: onOpenAiRoot,
      };
    }
    if (!enginesDirExists) {
      return {
        tone: "warn",
        icon: <Wrench size={18} />,
        title: "engines/ フォルダを作りましょう",
        desc: "エンジン実行ファイルをまとめる engines/ フォルダをボタンひとつで作成できます。",
        primaryLabel: "engines/ を作成",
        onPrimary: onCreateEnginesDir,
        secondaryLabel: "フォルダを開く",
        onSecondary: onOpenAiRoot,
      };
    }
    if (enginesCount === 0) {
      return {
        tone: "warn",
        icon: <Bot size={18} />,
        title: "エンジン実行ファイルを置いてください",
        desc: "YaneuraOu などの実行ファイルを engines/ に置いて、スキャンします。",
        primaryLabel: "engines/ を開く",
        onPrimary: onOpenEnginesDir,
        secondaryLabel: "スキャン",
        onSecondary: onRescan,
      };
    }
    if (profiles.length === 0) {
      return {
        tone: "todo",
        icon: <Sparkles size={18} />,
        title: "AI フォルダを作りましょう",
        desc: "AI名のフォルダを作ると、eval/ と book/ が自動で用意されます。",
        primaryLabel: "AI名の入力へ",
        onPrimary: () => aiNameRef.current?.focus(),
      };
    }
    const missingEval = profiles.find((p) => !p.hasEvalDir || p.evalCount === 0);
    if (missingEval) {
      return {
        tone: "warn",
        icon: <Database size={18} />,
        title: `「${missingEval.name}」に評価関数を置いてください`,
        desc: `${missingEval.name}/eval/ に nn.bin などを配置してからスキャンします。`,
        primaryLabel: "フォルダを開く",
        onPrimary: onOpenAiRoot,
        secondaryLabel: "スキャン",
        onSecondary: onRescan,
      };
    }
    return {
      tone: "ok",
      icon: <CheckCircle2 size={18} />,
      title: "セットアップの土台は完成しています",
      desc: "エンジンと評価関数が見つかっています。プリセット作成に進めます。",
      primaryLabel: "再スキャン",
      onPrimary: onRescan,
    };
  }, [
    aiRootPath,
    scanStatus,
    scanError,
    enginesDirExists,
    enginesCount,
    profiles,
    onSelectRoot,
    onRescan,
    onCreateEnginesDir,
    onOpenAiRoot,
    onOpenEnginesDir,
  ]);

  return (
    <div className="setupGuide">
      {/* Hero: 次にやること */}
      <div className="setupGuide__hero" data-tone={nextAction.tone}>
        <div className="setupGuide__heroIcon">{nextAction.icon}</div>
        <div className="setupGuide__heroBody">
          <div className="setupGuide__heroTag">次にやること</div>
          <div className="setupGuide__heroTitle">{nextAction.title}</div>
          <div className="setupGuide__heroDesc">{nextAction.desc}</div>
        </div>
        <div className="setupGuide__heroActions">
          {nextAction.primaryLabel && (
            <SButton
              variant="primary"
              size="sm"
              onClick={nextAction.onPrimary}
              disabled={!nextAction.onPrimary}
              isLoading={nextAction.primaryLoading}
            >
              {nextAction.primaryLabel}
            </SButton>
          )}
          {nextAction.secondaryLabel && nextAction.onSecondary && (
            <SButton variant="ghost" size="sm" onClick={nextAction.onSecondary}>
              {nextAction.secondaryLabel}
            </SButton>
          )}
        </div>
      </div>

      {/* Status grid */}
      <div className="setupGuide__statusGrid">
        <StatusCard
          label="置き場フォルダ"
          value={aiRootPath ? "設定済み" : "未設定"}
          hint={shortRoot || undefined}
          icon={<FolderOpen size={13} />}
          state={aiRootPath ? "ok" : "todo"}
        />
        <StatusCard
          label="engines フォルダ"
          value={enginesDirExists ? "あり" : "なし"}
          hint={enginesDirPath}
          icon={<Wrench size={13} />}
          state={!canOperate ? "todo" : enginesDirExists ? "ok" : "warn"}
        />
        <StatusCard
          label="エンジン"
          value={`${enginesCount} 件`}
          hint={enginesCount > 0 ? "検出済み" : "engines/ に置いてください"}
          icon={<Bot size={13} />}
          state={!canOperate ? "todo" : enginesCount > 0 ? "ok" : "warn"}
        />
        <StatusCard
          label="AI フォルダ"
          value={`${profiles.length} 件`}
          hint={
            profiles.length > 0
              ? `eval あり ${profiles.filter((p) => p.hasEvalDir && p.evalCount > 0).length} 件`
              : "下のフォームから作成できます"
          }
          icon={<Database size={13} />}
          state={!canOperate ? "todo" : profiles.length > 0 ? "ok" : "warn"}
        />
      </div>

      {/* What we're building — roles + concrete example */}
      <SSection title="フォルダ構成" description="この構造でファイルを置くと自動検出されます。">
        <FolderConcept />
      </SSection>

      {/* Current state — dynamic scan result */}
      <SSection title="現在の状態" description="スキャン結果をリアルタイムで反映しています。">
        <StructureOverview
          aiRootPath={aiRootPath}
          enginesDirExists={enginesDirExists}
          engineNames={engineNames}
          profiles={profiles}
        />
      </SSection>

      {/* Wizard steps with contextual trees */}
      <SSection title="セットアップ手順" description="手順ごとに操作できます。">
        <div className="aiLibraryTab__steps">
          <Step1SelectRoot state={step1} aiRoot={aiRootPath ?? ""} onSelect={onSelectRoot} />
          <Step2CreateEngines
            state={step2}
            isScanning={isScanning}
            onCreateEnginesDir={onCreateEnginesDir}
          />
          <Step3PlaceEngines
            state={step3}
            enginesCount={enginesCount}
            isScanning={isScanning}
            scanReady={scanReady}
            onOpenEnginesDir={onOpenEnginesDir}
            onScan={onRescan}
          />
          <Step4PlaceAssets
            state={step4}
            profilesCount={profiles.length}
            isScanning={isScanning}
            onScan={onRescan}
          />
        </div>
      </SSection>

      {/* AI folder creation */}
      {canOperate && enginesCount > 0 && (
        <SSection
          title="AIフォルダを追加"
          description="AI名を入れると eval/ と book/ をまとめて作成します。"
        >
          <SField label="AI名" description="例: Suisho / 研究用A">
            <div className="setupGuide__createRow">
              <div className="setupGuide__createInputWrap">
                <SInput
                  ref={aiNameRef}
                  value={aiNameDraft}
                  onChange={(e) => setAiNameDraft(e.target.value)}
                  placeholder="AI名を入力"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateFolder();
                  }}
                />
              </div>
              <SButton
                variant="subtle"
                size="sm"
                onClick={() => void handleCreateFolder()}
                isLoading={isCreatingFolder}
                disabled={!aiNameDraft.trim()}
              >
                <Sparkles size={14} style={{ marginRight: 6 }} />
                作成
              </SButton>
            </div>
          </SField>
        </SSection>
      )}

      {/* Detected AI profiles */}
      {scanReady && profiles.length > 0 && (
        <SSection title="検出されたAI" description="スキャン結果です。">
          <div className="setupGuide__profileList">
            {profiles.map((p) => (
              <ProfileItem key={p.path} profile={p} />
            ))}
          </div>
        </SSection>
      )}

      {/* Warnings */}
      {scanReady && warnings.length > 0 && (
        <div className="setupGuide__warnings" role="status">
          <div className="setupGuide__warningsTitle">
            <AlertTriangle size={13} />
            検出された問題
          </div>
          {warnings.map((w, i) => (
            <div key={i} className="setupGuide__warningItem">
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
