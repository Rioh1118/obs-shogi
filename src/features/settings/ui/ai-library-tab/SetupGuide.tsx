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
  canListEnginesDir,
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

type HeroButton = { label: string; onClick: () => void };

type NextAction = {
  tone: "ok" | "warn" | "todo";
  icon: React.ReactNode;
  title: string;
  desc: string;
  primary?: HeroButton;
  secondary?: HeroButton;
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
  scanError: string | null;
  enginesDir: EnginesDir;
  /**
   * 索引を読めているか。読めていないときと0件を分ける。
   *
   * 数だけを渡すと、読めていないときも「エンジン 0 件」と断言する。
   */
  indexed: boolean;
  enginesDirPath: string;
  enginesCount: number;
  engineNames: string[];
  profiles: SetupGuideProfile[];
  warnings: string[];
  isScanning: boolean;
  onSelectRoot: () => void;
  onRescan: () => void;
  onCreateEnginesDir: () => void;
  onOpenAiRoot: () => void;
  onOpenEnginesDir: () => void;
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
  value: string;
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
            評価関数 {evalOk ? "あり" : "不足"}
          </SettingsBadge>
          <SettingsBadge tone={bookOk ? "accent" : "muted"} shape="pill">
            定跡 {bookOk ? "あり" : "未設定"}
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
  scanError,
  enginesDir,
  indexed,
  enginesDirPath,
  enginesCount,
  engineNames,
  profiles,
  warnings,
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
  // 名前を直せば通る失敗の文言。打った文字列は残す
  const [createError, setCreateError] = useState<string | null>(null);
  const aiNameRef = useRef<HTMLInputElement | null>(null);

  const handleCreateFolder = async () => {
    // state では間に合わない。Enter のキーリピートはレンダより速く、同じ名前で並走すると
    // 作れたのに「すでにあります」が出る
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

      // 宛先を失ったとき。打った名前も赤字も動かさない。旧ルートの結果は通知が伝える
      if (result === "stale") return;

      if (result) {
        // 打った名前は消さない。消すと、直すのではなく打ち直しになる
        setCreateError(describeFsError(result.code));
        aiNameRef.current?.focus();
        return;
      }

      // `await` の前で消すと、宛先を失ったときに赤字だけが消える
      setCreateError(null);
      setAiNameDraft("");
    } finally {
      inFlightRef.current = false;
      setIsCreatingFolder(false);
    }
  };

  const canOperate = !!aiRootPath;
  const scanReady = scanStatus === "ok";

  /**
   * AI フォルダを作れるか。カードのヒント、入力欄、「現在の状態」の木の3か所が読む。
   *
   * 条件を散らすと、木が作成を指示するのに入力欄が無い、という食い違いが出る。
   *
   * TODO(#475): エンジンを置く前に AI フォルダだけ作りたい人を `enginesCount > 0` が止めている
   */
  const canCreateProfile = canOperate && indexed && enginesCount > 0;

  const step1: StepState = canOperate ? "done" : "active";
  const enginesDirReady = canListEnginesDir(enginesDir);

  // フォルダでないものが在る間と読めていない間は塞ぐ。作成が通る保証が無く、すべきことは hero が言う
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

  /**
   * hero の主動作と副動作を決める。
   *
   * アプリの外での作業を指示する段には、読み直しのボタンを必ず置く。無いと、作業を終えて戻った人に
   * 古い画面が出て、消えたパスへの「開く」しか押せない。
   */
  const nextAction = useMemo<NextAction>(() => {
    if (!aiRootPath) {
      return {
        tone: "todo",
        icon: <FolderOpen size={18} />,
        title: "AI ライブラリのフォルダを選択してください",
        desc: "エンジン・評価関数・定跡をまとめる専用フォルダを1つ選択するところから始まります。",
        primary: { label: "フォルダを選択…", onClick: onSelectRoot },
      };
    }
    if (scanStatus === "loading") {
      return {
        tone: "todo",
        icon: <RefreshCw size={18} />,
        title: "フォルダを確認しています",
        desc: "エンジンや AI フォルダの有無を読み取っています。",
      };
    }
    if (scanStatus === "error") {
      return {
        tone: "warn",
        icon: <AlertTriangle size={18} />,
        title: "フォルダを確認できませんでした",
        desc: scanError ?? "もう一度読み込んでください。",
        primary: { label: "もう一度読み込む", onClick: onRescan },
        // 開くボタンは出さない。選択、作成、走査、AI フォルダの作成の失敗が来るので、開く先を
        // 読めているとは限らない
        secondary: { label: "選択…", onClick: onSelectRoot },
      };
    }
    // 状態を名前で並べず `canListEnginesDir` で受ける。並べると、`EnginesDir` に状態が増えたときに
    // 読めていないまま下の「エンジンを置いてください」へ落ちる
    if (!canListEnginesDir(enginesDir)) {
      if (enginesDir === "other") {
        return {
          tone: "warn",
          icon: <Wrench size={18} />,
          title: "engines がフォルダではありません",
          desc: "同じ名前のファイル（またはリンク）があります。削除するか、フォルダに置き換えてください。",
          primary: { label: "engines/ を開く", onClick: onOpenEnginesDir },
          secondary: { label: "もう一度読み込む", onClick: onRescan },
        };
      }
      if (canCreateEnginesDir(enginesDir)) {
        return {
          tone: "warn",
          icon: <Wrench size={18} />,
          title: "engines/ フォルダを作成してください",
          desc: "エンジン実行ファイルをまとめる engines/ フォルダをボタンひとつで作成できます。",
          primary: { label: "engines/ を作成", onClick: onCreateEnginesDir },
          secondary: { label: "AI ライブラリを開く", onClick: onOpenAiRoot },
        };
      }
      return {
        tone: "todo",
        icon: <RefreshCw size={18} />,
        title: "フォルダの状態を読めていません",
        desc: "もう一度読み込むと、いま何が在るかを読み直します。",
        primary: { label: "もう一度読み込む", onClick: onRescan },
        secondary: { label: "選択…", onClick: onSelectRoot },
      };
    }
    if (enginesCount === 0) {
      return {
        tone: "warn",
        icon: <Bot size={18} />,
        title: "エンジン実行ファイルを置いてください",
        desc: "engines/ の場所を表示します。その中に YaneuraOu などの実行ファイルを置いてから、もう一度読み込んでください。",
        primary: { label: "engines/ を開く", onClick: onOpenEnginesDir },
        secondary: { label: "もう一度読み込む", onClick: onRescan },
      };
    }
    if (profiles.length === 0) {
      return {
        tone: "todo",
        icon: <Sparkles size={18} />,
        title: "AI フォルダを作成してください",
        desc: "AI 名のフォルダを作成と、eval/ と book/ が自動で用意されます。",
        primary: { label: "AI 名の入力へ", onClick: () => aiNameRef.current?.focus() },
      };
    }
    const missingEval = profiles.find((p) => !p.hasEvalDir || p.evalCount === 0);
    if (missingEval) {
      return {
        tone: "warn",
        icon: <Database size={18} />,
        title: `「${missingEval.name}」に評価関数を置いてください`,
        desc: `AI ライブラリの場所を表示します。その中の ${missingEval.name}/eval/ に nn.bin などを置いてから、もう一度読み込んでください。`,
        primary: { label: "AI ライブラリを開く", onClick: onOpenAiRoot },
        secondary: { label: "もう一度読み込む", onClick: onRescan },
      };
    }
    return {
      tone: "ok",
      icon: <CheckCircle2 size={18} />,
      title: "セットアップの土台は完成しています",
      desc: "エンジンと評価関数が見つかっています。プリセット作成に進めます。",
      primary: { label: "もう一度読み込む", onClick: onRescan },
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
      <div className="setupGuide__hero" data-tone={nextAction.tone}>
        <div className="setupGuide__heroIcon">{nextAction.icon}</div>
        <div className="setupGuide__heroBody">
          <div className="setupGuide__heroTag">次にやること</div>
          <div className="setupGuide__heroTitle">{nextAction.title}</div>
          <div className="setupGuide__heroDesc">{nextAction.desc}</div>
        </div>
        <div className="setupGuide__heroActions">
          {nextAction.primary && (
            <Button tone="accent" size="sm" onClick={nextAction.primary.onClick}>
              {nextAction.primary.label}
            </Button>
          )}
          {nextAction.secondary && (
            <Button size="sm" onClick={nextAction.secondary.onClick}>
              {nextAction.secondary.label}
            </Button>
          )}
        </div>
      </div>

      <div className="setupGuide__statusGrid">
        <StatusCard
          label="AI ライブラリ"
          value={aiRootPath ? "設定済み" : "未設定"}
          hint={shortRoot || undefined}
          icon={<FolderOpen size={13} />}
          state={aiRootPath ? "ok" : "todo"}
        />
        <StatusCard
          label="engines フォルダ"
          value={ENGINES_DIR_LABEL[enginesDir]}
          hint={enginesDirPath}
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
                ? `評価関数あり ${profiles.filter((p) => p.hasEvalDir && p.evalCount > 0).length} 件`
                : canCreateProfile
                  ? "下のフォームから作成できます"
                  : "エンジンを置いた後に作成できます"
          }
          icon={<Database size={13} />}
          state={!indexed ? "todo" : profiles.length > 0 ? "ok" : "warn"}
        />
      </div>

      <SSection title="フォルダ構成" description="この構造でファイルを置くと自動検出されます。">
        <FolderConcept />
      </SSection>

      <SSection title="現在の状態" description="読み込んだ結果をリアルタイムで反映しています。">
        <StructureOverview
          aiRootPath={aiRootPath}
          enginesDir={enginesDir}
          canCreateProfile={canCreateProfile}
          engineNames={engineNames}
          profiles={profiles}
        />
      </SSection>

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

      {canCreateProfile && (
        <SSection
          title="AI フォルダを追加"
          description="AI 名を入力すると eval/ と book/ をまとめて作成します。"
        >
          <SField label="AI 名" description="例: Suisho / 研究用A">
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
                  placeholder="AI 名を入力"
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
            {/* 中身と同時に DOM へ入れると VoiceOver が live region の変化として読まないので常設する */}
            <p className="setupGuide__createError" role="alert">
              {createError ?? ""}
            </p>
          </SField>
        </SSection>
      )}

      {scanReady && profiles.length > 0 && (
        <SSection title="検出されたAI" description="読み込んだ結果です。">
          <div className="setupGuide__profileList">
            {profiles.map((p) => (
              <ProfileItem key={p.path} profile={p} />
            ))}
          </div>
        </SSection>
      )}

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
