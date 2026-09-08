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
import Button from "@/shared/ui/Button/Button";
import { describeFsError } from "@/entities/file-tree";
import {
  canCreateEnginesDir,
  enginesDirUsable,
  type EnginesDir,
} from "@/entities/engine/lib/enginesDir";
import { SField, SInput, SSection } from "../kit";
import type { CreateAiFolderResult, SetupGuideProfile } from "./types";
import SettingsBadge from "../kit/SettingsBadge";
import type { StepState } from "./steps/StepShell";
import { Step1SelectRoot } from "./steps/Step1SelectRoot";
import { Step2CreateEngines } from "./steps/Step2CreateEngines";
import { Step3PlaceEngines } from "./steps/Step3PlaceEngines";
import { Step4PlaceAssets } from "./steps/Step4PlaceAssets";
import { StructureOverview } from "./steps/StructureOverview";
import { FolderConcept } from "./steps/FolderConcept";
import "./SetupGuide.scss";

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

/** カードに出す状態の名前。網羅の理由は `EnginesDir` の doc */
const ENGINES_DIR_LABEL: Record<EnginesDir, string> = {
  unknown: "—",
  missing: "なし",
  dir: "あり",
  other: "フォルダでない",
};

const ENGINES_DIR_TONE: Record<EnginesDir, "ok" | "warn" | "todo"> = {
  unknown: "todo",
  missing: "warn",
  dir: "ok",
  other: "warn",
};

type Props = {
  aiRootPath: string | null;
  scanStatus: "idle" | "loading" | "ok" | "error";
  scanError?: string | null;
  /** `engines` が何として在るか。4つに割れている理由は `EnginesDir` の doc */
  enginesDir: EnginesDir;
  /**
   * 索引を読めているか。**「読めていない」と「0 件」を分けるために要る。**
   *
   * 数だけを渡すと、読めていない回も `0` になって「エンジン 0 件（要注意）」と
   * 観測していないことを断言する。`engines` のカードだけ `—` にしても、
   * 隣が数を言い切るとそちらが上書きして読まれる
   */
  indexed: boolean;
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
  /** 答えの3つは `CreateAiFolderResult` が持つ */
  onCreateAiFolder: (aiName: string) => Promise<CreateAiFolderResult>;
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
  enginesDir,
  indexed,
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
  const inFlightRef = useRef(false);
  // 名前を直せば通る失敗。**欄のそばに出し、打った文字列は残す**
  const [createError, setCreateError] = useState<string | null>(null);
  const aiNameRef = useRef<HTMLInputElement | null>(null);

  const handleCreateFolder = async () => {
    // **`useState` では取りこぼす。** Enter のキーリピートはレンダより速いので、
    // 同じ名前で並走して「作れたのに『すでにあります』が出る」になる
    if (inFlightRef.current) return;

    const name = aiNameDraft.trim();
    if (!name) {
      aiNameRef.current?.focus();
      return;
    }

    inFlightRef.current = true;
    setIsCreatingFolder(true);
    try {
      const result = await onCreateAiFolder(name);

      // 宛先を失った回。**打った名前も欄の赤字も動かさない**——
      // 直すべき理由（前の失敗の赤字）だけを消すと、直すべき文字列だけが残る。
      // 旧ルートで何が起きたかは通知が伝える
      if (result === "stale") return;

      if (result) {
        // 打った名前は消さない。消すと、直すのではなく打ち直しになる
        setCreateError(describeFsError(result.code));
        aiNameRef.current?.focus();
        return;
      }

      // **赤字を消すのはここ。** `await` の前で消すと、上の枝（宛先を失った回）が
      // 「前の失敗の赤字を消しただけ」で返る
      setCreateError(null);
      setAiNameDraft("");
    } finally {
      inFlightRef.current = false;
      setIsCreatingFolder(false);
    }
  };

  // ── step states ────────────────────────────────────────────────────────

  const canOperate = !!aiRootPath;
  const scanReady = scanStatus === "ok";

  /**
   * いま AI フォルダを作れるか。**1度だけ組んで3箇所が引く。**
   *
   * 引く先はカードのヒント・入力欄・「現在の状態」の木。条件を手書きで散らすと、
   * 木が「作成しろ」と指示するのに入力欄が描かれない、という食い違いが出る
   * （実際に2度出した。1度目は読めていない回、2度目はエンジンが0件の回）。
   *
   * **`enginesCount > 0` を条件にするのが正しいかは未決**（#475）——
   * エンジンを置く前に AI フォルダだけ作りたい人を止めている
   */
  const canCreateProfile = canOperate && indexed && enginesCount > 0;

  const step1: StepState = canOperate ? "done" : "active";
  const enginesDirReady = enginesDirUsable(enginesDir);

  // フォルダでないものが居る間と、何が在るか読めていない間は塞ぐ。
  // どちらもこの段の操作（作成）が通る保証が無い——何をすべきかは hero が言う
  const step2: StepState = !canOperate
    ? "locked"
    : enginesDirReady
      ? "done"
      : canCreateEnginesDir(enginesDir)
        ? "active"
        : "locked";
  const step3: StepState = !enginesDirReady
    ? "locked"
    : enginesCount > 0
      ? "done"
      : scanReady
        ? "warn"
        : "active";
  const step4: StepState = !enginesDirReady
    ? "locked"
    : profiles.length > 0
      ? "done"
      : scanReady
        ? "warn"
        : "locked";

  const shortRoot =
    aiRootPath && aiRootPath.length > 32 ? "…" + aiRootPath.slice(-31) : (aiRootPath ?? "");

  // ── next action (hero) ─────────────────────────────────────────────────

  /**
   * hero の主動作と副動作。
   *
   * **アプリの外での作業を指示する段には、終わったことを伝える口（スキャン）を必ず置く。**
   * 無いと、作業を終えて戻った利用者に古い画面が出て、押せるのは実在しなくなったパスへの
   * 「開く」だけになる——正しい作業の直後に失敗の通知が出る。
   */
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
        // **ここで「開く」を勧めない。** この段には4つの失敗が来る（選択・作成・
        // スキャン・プロファイル作成）ので、開く先が読めているとは限らない。
        // 読み直し（主）と選び直し（副）だけを出す
        secondaryLabel: "選択…",
        onSecondary: onSelectRoot,
      };
    }
    // **読めていない側の枝を、フォルダとして在る以外の全部で受ける。**
    // 3つを名前で並べると、`EnginesDir` に状態が増えた日（#469）に
    // その状態が下の「エンジンを置いてください」へ落ちる——engines が
    // どうなっているか誰も読めていないのに、次の段の指示が出る
    if (!enginesDirUsable(enginesDir)) {
      if (enginesDir === "other") {
        return {
          tone: "warn",
          icon: <Wrench size={18} />,
          title: "engines がフォルダではありません",
          desc: "同じ名前のファイル（またはリンク）があります。外すか、フォルダに置き換えてください。",
          primaryLabel: "engines/ を開く",
          onPrimary: onOpenEnginesDir,
          secondaryLabel: "スキャン",
          onSecondary: onRescan,
        };
      }
      if (canCreateEnginesDir(enginesDir)) {
        return {
          tone: "warn",
          icon: <Wrench size={18} />,
          title: "engines/ フォルダを作りましょう",
          desc: "エンジン実行ファイルをまとめる engines/ フォルダをボタンひとつで作成できます。",
          primaryLabel: "engines/ を作成",
          onPrimary: onCreateEnginesDir,
          secondaryLabel: "AI ルートを開く",
          onSecondary: onOpenAiRoot,
        };
      }
      return {
        tone: "todo",
        icon: <RefreshCw size={18} />,
        title: "フォルダの状態を読めていません",
        desc: "スキャンし直すと、いま何が在るかを読み直します。",
        primaryLabel: "再スキャン",
        onPrimary: onRescan,
        secondaryLabel: "選択…",
        onSecondary: onSelectRoot,
      };
    }
    if (enginesCount === 0) {
      return {
        tone: "warn",
        icon: <Bot size={18} />,
        title: "エンジン実行ファイルを置いてください",
        desc: "engines/ の場所を表示します。その中に YaneuraOu などの実行ファイルを置いてからスキャンしてください。",
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
        desc: `AI ルートの場所を表示します。その中の ${missingEval.name}/eval/ に nn.bin などを置いてからスキャンしてください。`,
        primaryLabel: "AI ルートを開く",
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
    enginesDir,
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
            <Button
              tone="primary"
              size="sm"
              onClick={nextAction.onPrimary}
              disabled={!nextAction.onPrimary}
              isLoading={nextAction.primaryLoading}
            >
              {nextAction.primaryLabel}
            </Button>
          )}
          {nextAction.secondaryLabel && nextAction.onSecondary && (
            <Button size="sm" onClick={nextAction.onSecondary}>
              {nextAction.secondaryLabel}
            </Button>
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
          value={ENGINES_DIR_LABEL[enginesDir]}
          hint={enginesDir === "unknown" ? undefined : enginesDirPath}
          icon={<Wrench size={13} />}
          state={ENGINES_DIR_TONE[enginesDir]}
        />
        <StatusCard
          label="エンジン"
          value={indexed ? `${enginesCount} 件` : "—"}
          hint={!indexed ? undefined : enginesCount > 0 ? "検出済み" : "engines/ に置いてください"}
          icon={<Bot size={13} />}
          state={!indexed ? "todo" : enginesCount > 0 ? "ok" : "warn"}
        />
        <StatusCard
          label="AI フォルダ"
          value={indexed ? `${profiles.length} 件` : "—"}
          hint={
            !indexed
              ? undefined
              : profiles.length > 0
                ? `eval あり ${profiles.filter((p) => p.hasEvalDir && p.evalCount > 0).length} 件`
                : canCreateProfile
                  ? "下のフォームから作成できます"
                  : "エンジンを置いた後に作成できます"
          }
          icon={<Database size={13} />}
          state={!indexed ? "todo" : profiles.length > 0 ? "ok" : "warn"}
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
          enginesDir={enginesDir}
          canCreateProfile={canCreateProfile}
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
      {canCreateProfile && (
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
                  invalid={!!createError}
                  onChange={(e) => {
                    setAiNameDraft(e.target.value);
                    setCreateError(null);
                  }}
                  placeholder="AI名を入力"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateFolder();
                  }}
                />
              </div>
              <Button
                size="sm"
                onClick={() => void handleCreateFolder()}
                isLoading={isCreatingFolder}
                disabled={!aiNameDraft.trim()}
              >
                <Sparkles size={14} style={{ marginRight: 6 }} />
                作成
              </Button>
            </div>
            {/* 領域は常設する。中身と同時に DOM へ入れると、VoiceOver が
                live region の変化として読まない */}
            <p className="setupGuide__createError" role="alert">
              {createError ?? ""}
            </p>
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
