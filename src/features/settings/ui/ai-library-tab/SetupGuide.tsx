import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  Database,
  FolderOpen,
  Info,
  RefreshCw,
  Sparkles,
  Wrench,
} from "lucide-react";

import { copyText } from "@/shared/api/clipboard/copyText";
import { SButton, SField, SInput, SSection } from "../kit";
import SettingsBadge, { type SettingsBadgeTone } from "../kit/SettingsBadge";
import "./SetupGuide.scss";

type ScanStatus = "idle" | "loading" | "ok" | "error";

export type SetupGuideProfile = {
  name: string;
  path: string;
  hasEvalDir: boolean;
  hasBookDir: boolean;
  evalCount: number;
  bookCount: number;
};

type Props = {
  aiRootPath: string | null;
  scanStatus: ScanStatus;
  scanError?: string | null;

  enginesDirExists: boolean;
  enginesDirPath?: string;
  enginesCount: number;

  profiles: SetupGuideProfile[];

  warnings?: string[];

  onChooseAiRoot: () => void;
  onRescan: () => void;

  onCreateEnginesDir?: () => Promise<void> | void;
  onOpenAiRoot?: () => void;
  onOpenEnginesDir?: () => void;

  onCreateAiFolder?: (aiName: string) => Promise<void> | void;
};

type NextAction = {
  tone: "ok" | "warn" | "todo";
  title: string;
  desc: string;
  icon: ReactNode;

  primaryLabel?: string;
  onPrimary?: () => void;
  primaryLoading?: boolean;

  secondaryLabel?: string;
  onSecondary?: () => void;
};

function cleanText(s: string) {
  return (s ?? "").trim();
}

function basename(p: string) {
  const s = (p ?? "").replace(/\\/g, "/");
  return s.split("/").filter(Boolean).pop() ?? p ?? "";
}

function treeTemplate(rootLabel: string, aiName: string) {
  return `\
${rootLabel}
├─ engines/                ← engine ファイルを入れる
│   └─ YaneuraOu-XXXX
└─ ${aiName}/
   ├─ eval/                ← 評価関数を入れる
   │   └─ nn.bin
   └─ book/                ← 定跡ファイルを入れる（任意）
       └─ book.db
`;
}

function toneForState(kind: "ok" | "warn" | "todo"): SettingsBadgeTone {
  if (kind === "ok") return "accent";
  if (kind === "warn") return "warn";
  return "muted";
}

function StatusCard({
  title,
  value,
  state,
  hint,
  icon,
}: {
  title: string;
  value: ReactNode;
  state: "ok" | "warn" | "todo";
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="setupGuide__statusCard" data-state={state}>
      <div className="setupGuide__statusTop">
        <div className="setupGuide__statusTitleWrap">
          {icon && <div className="setupGuide__statusIcon">{icon}</div>}
          <div className="setupGuide__statusTitle">{title}</div>
        </div>

        <SettingsBadge tone={toneForState(state)}>
          {state === "ok" ? "OK" : state === "warn" ? "要確認" : "未着手"}
        </SettingsBadge>
      </div>

      <div className="setupGuide__statusValue">{value}</div>
      {hint && <div className="setupGuide__statusHint">{hint}</div>}
    </div>
  );
}

function ProfileItem({ profile }: { profile: SetupGuideProfile }) {
  const evalReady = profile.hasEvalDir && profile.evalCount > 0;
  const bookReady = profile.hasBookDir && profile.bookCount > 0;

  return (
    <div className="setupGuide__profileItem">
      <div className="setupGuide__profileHead">
        <div className="setupGuide__profileName">{profile.name}</div>

        <div className="setupGuide__profileBadges">
          <SettingsBadge tone={evalReady ? "accent" : "warn"}>
            eval {evalReady ? "あり" : "不足"}
          </SettingsBadge>

          <SettingsBadge tone={bookReady ? "accent" : "muted"}>
            book {bookReady ? "あり" : "未設定"}
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
  profiles,
  warnings = [],
  onChooseAiRoot,
  onRescan,
  onCreateEnginesDir,
  onOpenAiRoot,
  onOpenEnginesDir,
  onCreateAiFolder,
}: Props) {
  const [aiNameDraft, setAiNameDraft] = useState("");
  const [isCreatingAiFolder, setIsCreatingAiFolder] = useState(false);
  const [isCreatingEnginesDir, setIsCreatingEnginesDir] = useState(false);

  const aiNameInputRef = useRef<HTMLInputElement | null>(null);

  const safeAiName = cleanText(aiNameDraft) || "MyAI";
  const rootLabel = aiRootPath ? basename(aiRootPath) : "AIの置き場フォルダ";
  const helpTree = treeTemplate(rootLabel, safeAiName);

  const profilesWithEval = useMemo(
    () => profiles.filter((p) => p.hasEvalDir && p.evalCount > 0).length,
    [profiles],
  );

  const profilesWithBook = useMemo(
    () => profiles.filter((p) => p.hasBookDir && p.bookCount > 0).length,
    [profiles],
  );

  const firstProfileMissingEval = useMemo(
    () => profiles.find((p) => !p.hasEvalDir || p.evalCount === 0) ?? null,
    [profiles],
  );

  const handleCreateAiFolder = async () => {
    if (!onCreateAiFolder) return;

    const name = cleanText(aiNameDraft);
    if (!name) {
      aiNameInputRef.current?.focus();
      return;
    }

    try {
      setIsCreatingAiFolder(true);
      await onCreateAiFolder(name);
      setAiNameDraft("");
    } finally {
      setIsCreatingAiFolder(false);
    }
  };

  const handleCreateEnginesDir = async () => {
    if (!onCreateEnginesDir) return;

    try {
      setIsCreatingEnginesDir(true);
      await onCreateEnginesDir();
    } finally {
      setIsCreatingEnginesDir(false);
    }
  };

  const nextAction = useMemo<NextAction>(() => {
    if (!aiRootPath) {
      return {
        tone: "todo",
        title: "まず AI の置き場フォルダを選んでください",
        desc: "このフォルダの中に、engine・評価関数・定跡をまとめて管理します。迷ったら Documents 配下に新しく作れば大丈夫です。",
        primaryLabel: "AIの置き場フォルダを選ぶ",
        onPrimary: onChooseAiRoot,
        primaryLoading: false,
        icon: <FolderOpen size={18} />,
      };
    }

    if (scanStatus === "loading") {
      return {
        tone: "todo",
        title: "AI の置き場フォルダを確認しています",
        desc: "engine や AI フォルダの有無を読み取っています。",
        primaryLabel: "スキャン中…",
        primaryLoading: true,
        icon: <RefreshCw size={18} />,
      };
    }

    if (scanStatus === "error") {
      return {
        tone: "warn",
        title: "フォルダの状態を確認できませんでした",
        desc: "選んだ場所は保存されています。まずは再スキャンして状態を読み直してください。",
        primaryLabel: "再スキャン",
        onPrimary: onRescan,
        primaryLoading: false,
        secondaryLabel: onOpenAiRoot ? "AIの置き場フォルダを開く" : undefined,
        onSecondary: onOpenAiRoot,
        icon: <AlertTriangle size={18} />,
      };
    }

    if (!enginesDirExists) {
      return {
        tone: "warn",
        title: "次は engine 用のフォルダを作りましょう",
        desc: "engine ファイルは AIの置き場フォルダの中の engines/ にまとめます。",
        primaryLabel: onCreateEnginesDir
          ? "engines/ を作成"
          : "AIの置き場フォルダを開く",
        onPrimary: onCreateEnginesDir
          ? () => {
              void handleCreateEnginesDir();
            }
          : onOpenAiRoot,
        primaryLoading: isCreatingEnginesDir,
        secondaryLabel:
          onOpenAiRoot && onCreateEnginesDir
            ? "AIの置き場フォルダを開く"
            : undefined,
        onSecondary:
          onOpenAiRoot && onCreateEnginesDir ? onOpenAiRoot : undefined,
        icon: <Wrench size={18} />,
      };
    }

    if (enginesCount === 0) {
      return {
        tone: "warn",
        title: "次は engine ファイルを入れてください",
        desc: "ダウンロードした YaneuraOu の実行ファイルを engines/ に入れてください。入れたあと再スキャンします。",
        primaryLabel: onOpenEnginesDir ? "engines/ を開く" : "再スキャン",
        onPrimary: onOpenEnginesDir ?? onRescan,
        primaryLoading: false,
        secondaryLabel: "再スキャン",
        onSecondary: onRescan,
        icon: <Bot size={18} />,
      };
    }

    if (profiles.length === 0) {
      return {
        tone: "todo",
        title: "AI フォルダを 1つ作りましょう",
        desc: onCreateAiFolder
          ? "AI名を入れると、その AI 用の eval/ と book/ をまとめて作れます。"
          : "AI名を考えて構造を確認できます。AIフォルダ自動作成は次の段階でつなぐと体験が完成します。",
        primaryLabel: "AI名の入力へ進む",
        onPrimary: () => aiNameInputRef.current?.focus(),
        primaryLoading: false,
        secondaryLabel: onOpenAiRoot ? "AIの置き場フォルダを開く" : undefined,
        onSecondary: onOpenAiRoot,
        icon: <Sparkles size={18} />,
      };
    }

    if (firstProfileMissingEval) {
      return {
        tone: "warn",
        title: `「${firstProfileMissingEval.name}」に評価関数を入れてください`,
        desc: "eval フォルダに nn.bin を入れると、この AI をプリセットで使える形に近づきます。",
        primaryLabel: onOpenAiRoot ? "AIの置き場フォルダを開く" : "再スキャン",
        onPrimary: onOpenAiRoot ?? onRescan,
        primaryLoading: false,
        secondaryLabel: "再スキャン",
        onSecondary: onRescan,
        icon: <Database size={18} />,
      };
    }

    return {
      tone: "ok",
      title: "セットアップの土台はできています",
      desc: "engine と評価関数が見つかっています。このままプリセット作成・調整に進めます。",
      primaryLabel: "再スキャン",
      onPrimary: onRescan,
      primaryLoading: false,
      secondaryLabel: onOpenAiRoot ? "AIの置き場フォルダを開く" : undefined,
      onSecondary: onOpenAiRoot,
      icon: <CheckCircle2 size={18} />,
    };
  }, [
    aiRootPath,
    enginesCount,
    enginesDirExists,
    firstProfileMissingEval,
    isCreatingEnginesDir,
    onChooseAiRoot,
    onCreateAiFolder,
    onCreateEnginesDir,
    onOpenAiRoot,
    onOpenEnginesDir,
    onRescan,
    profiles.length,
    scanStatus,
  ]);

  return (
    <div className="setupGuide">
      <SSection
        title="セットアップ"
        description="今の状態を見ながら、次にやることだけ順番に進めます。"
        actions={
          <SButton
            variant="ghost"
            size="sm"
            onClick={() => void copyText(helpTree)}
          >
            <Copy size={16} style={{ marginRight: 6 }} />
            構造をコピー
          </SButton>
        }
      >
        <div className="setupGuide__hero" data-tone={nextAction.tone}>
          <div className="setupGuide__heroIcon">{nextAction.icon}</div>

          <div className="setupGuide__heroBody">
            <div className="setupGuide__heroTop">
              <SettingsBadge tone="accent">次にやること</SettingsBadge>
            </div>
            <div className="setupGuide__heroTitle">{nextAction.title}</div>
            <div className="setupGuide__heroDesc">{nextAction.desc}</div>
          </div>

          <div className="setupGuide__heroActions">
            {nextAction.primaryLabel && (
              <SButton
                variant="primary"
                onClick={nextAction.onPrimary}
                isLoading={nextAction.primaryLoading}
                disabled={!nextAction.onPrimary}
              >
                {nextAction.primaryLabel}
              </SButton>
            )}

            {nextAction.secondaryLabel && nextAction.onSecondary && (
              <SButton variant="ghost" onClick={nextAction.onSecondary}>
                {nextAction.secondaryLabel}
              </SButton>
            )}
          </div>
        </div>

        <div className="setupGuide__statusGrid">
          <StatusCard
            title="AIの置き場フォルダ"
            value={aiRootPath ? "設定済み" : "未設定"}
            state={aiRootPath ? "ok" : "todo"}
            hint={aiRootPath ? aiRootPath : "まずは1つ選びます"}
            icon={<FolderOpen size={16} />}
          />

          <StatusCard
            title="engines フォルダ"
            value={enginesDirExists ? "あります" : "まだありません"}
            state={!aiRootPath ? "todo" : enginesDirExists ? "ok" : "warn"}
            hint={enginesDirPath || "engine 用フォルダ"}
            icon={<Wrench size={16} />}
          />

          <StatusCard
            title="engine"
            value={`${enginesCount} 件`}
            state={!aiRootPath ? "todo" : enginesCount > 0 ? "ok" : "warn"}
            hint={
              enginesCount > 0
                ? "YaneuraOu 系が見つかりました"
                : "engines/ に置くと検出されます"
            }
            icon={<Bot size={16} />}
          />

          <StatusCard
            title="AIフォルダ"
            value={`${profiles.length} 件`}
            state={!aiRootPath ? "todo" : profiles.length > 0 ? "ok" : "warn"}
            hint={
              profiles.length > 0
                ? `evalあり ${profilesWithEval} 件 / bookあり ${profilesWithBook} 件`
                : onCreateAiFolder
                  ? "AI名を入れて作成できます"
                  : "AI名を考えて構造を確認できます"
            }
            icon={<Database size={16} />}
          />
        </div>

        {scanStatus === "error" && scanError && (
          <div className="setupGuide__alert" role="alert">
            <AlertTriangle size={16} />
            <span>{scanError}</span>
          </div>
        )}

        {warnings.length > 0 && scanStatus === "ok" && (
          <div className="setupGuide__warnings">
            <div className="setupGuide__warningsTitle">
              <AlertTriangle size={16} />
              <span>補足</span>
            </div>

            <div className="setupGuide__warningsList">
              {warnings.map((w, i) => (
                <div key={i} className="setupGuide__warningItem">
                  {w}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="setupGuide__columns">
          <div className="setupGuide__main">
            <SSection
              title="AIを追加"
              description={
                onCreateAiFolder
                  ? "AI名を入れると、その AI 用の eval/ と book/ をまとめて作る前提で進められます。"
                  : "いまは AI名とフォルダ構造を確認する段階です。自動作成 API をつなぐと、そのまま体験になります。"
              }
            >
              <div className="setupGuide__stack">
                <SField
                  label="AI名"
                  description="例: Suisho / YaneuraOu-NNUE / 研究用A"
                  hint="まずは分かりやすい名前でOKです。"
                >
                  <SInput
                    ref={aiNameInputRef}
                    value={aiNameDraft}
                    onChange={(e) => setAiNameDraft(e.target.value)}
                    placeholder={
                      aiRootPath
                        ? "AI名を入力"
                        : "先に AI の置き場フォルダを選びます"
                    }
                    disabled={!aiRootPath}
                  />
                </SField>

                <div className="setupGuide__row">
                  <SButton
                    variant="primary"
                    onClick={() => void handleCreateAiFolder()}
                    disabled={!aiRootPath || !onCreateAiFolder}
                    isLoading={isCreatingAiFolder}
                  >
                    このAIフォルダを作る
                  </SButton>

                  {onOpenAiRoot && (
                    <SButton
                      variant="ghost"
                      onClick={onOpenAiRoot}
                      disabled={!aiRootPath}
                    >
                      AIの置き場フォルダを開く
                    </SButton>
                  )}
                </div>

                {!onCreateAiFolder && (
                  <div className="setupGuide__note">
                    <Info size={14} />
                    <span>
                      いまは構造の確認までです。AIフォルダ自動作成 API
                      をつなぐと、 ここから直接 eval/ と book/
                      を作れるようになります。
                    </span>
                  </div>
                )}

                <div className="setupGuide__subTitle">作成される構造</div>
                <pre
                  className="setupGuide__tree"
                  aria-label="作成予定のフォルダ構造"
                >
                  {helpTree}
                </pre>
              </div>
            </SSection>

            <SSection
              title="このアプリでの置き方"
              description="自由入力より、迷いにくさと再現しやすさを優先しています。"
            >
              <div className="setupGuide__principles">
                <div className="setupGuide__principle">
                  <div className="setupGuide__principleTitle">
                    1. 置き場を1つにまとめる
                  </div>
                  <div className="setupGuide__principleDesc">
                    engine・評価関数・定跡を
                    AIの置き場フォルダの中にまとめます。
                  </div>
                </div>

                <div className="setupGuide__principle">
                  <div className="setupGuide__principleTitle">
                    2. AIごとにフォルダを分ける
                  </div>
                  <div className="setupGuide__principleDesc">
                    AI名ごとに eval/ と book/
                    を分けると、あとで見返しても迷いにくくなります。
                  </div>
                </div>

                <div className="setupGuide__principle">
                  <div className="setupGuide__principleTitle">
                    3. 候補から選ぶ
                  </div>
                  <div className="setupGuide__principleDesc">
                    できるだけ場所を手入力せず、見つかった候補から選べる状態を目指します。
                  </div>
                </div>
              </div>

              <div className="setupGuide__note">
                <Info size={14} />
                <span>
                  迷ったら「AIの置き場フォルダを選ぶ」→「engines/ を作る」→
                  「engine
                  を入れる」→「AIフォルダを作る」の順で進めれば大丈夫です。
                </span>
              </div>
            </SSection>
          </div>

          <div className="setupGuide__side">
            <SSection
              title="見つかったAI"
              description="現在の AI フォルダの状態です。"
            >
              {profiles.length === 0 ? (
                <div className="setupGuide__empty">
                  まだ AI フォルダはありません。
                  {onCreateAiFolder
                    ? "上の「AIを追加」から始められます。"
                    : "AIフォルダ自動作成をつなぐと、ここから直接始められます。"}
                </div>
              ) : (
                <div className="setupGuide__profileList">
                  {profiles.map((p) => (
                    <ProfileItem key={p.path} profile={p} />
                  ))}
                </div>
              )}
            </SSection>
          </div>
        </div>
      </SSection>
    </div>
  );
}
