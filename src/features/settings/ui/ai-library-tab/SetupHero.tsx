import Button from "@/shared/ui/Button/Button";
import { canCreateEnginesDir, canListEnginesDir } from "@/entities/ai-library/lib/enginesDir";
import type { AiLibraryContents } from "@/features/settings/lib/aiLibraryContents";
import type { ScanState } from "@/features/settings/lib/aiRootScan";
import type { AiLibraryActions } from "@/features/settings/model/useAiLibrary";

type HeroButton = { label: string; onClick: () => void };

type NextAction = {
  title: string;
  desc: string;
  primary?: HeroButton;
  secondary?: HeroButton;
};

type Props = {
  hasRoot: boolean;
  scan: ScanState;
  contents: AiLibraryContents;
  actions: AiLibraryActions;
  onFocusAiName: () => void;
};

/**
 * 次にやることと、主と副のボタンを決める。
 *
 * アプリの外での作業を指示する段階には、読み直しのボタンを必ず置く。無いと、作業を終えて戻った人に
 * 古い画面が出て、消えたパスへの「開く」しか押せない。
 */
function nextActionOf({ hasRoot, scan, contents, actions, onFocusAiName }: Props): NextAction {
  const { enginesDir, engineNames, profiles } = contents;

  if (!hasRoot) {
    return {
      title: "AI ライブラリのフォルダを選択してください",
      desc: "エンジン・評価関数・定跡をまとめる専用フォルダを1つ選択するところから始まります。",
      primary: { label: "フォルダを選択…", onClick: actions.selectRoot },
    };
  }
  if (scan.status === "loading") {
    return {
      title: "フォルダを確認しています",
      desc: "エンジンや AI フォルダの有無を読み取っています。",
    };
  }
  if (scan.status === "error") {
    return {
      title: "フォルダを確認できませんでした",
      desc: scan.error,
      primary: { label: "もう一度読み込む", onClick: actions.rescan },
      // 開くボタンは出さない。選択、作成、走査、AI フォルダの作成の失敗が来るので、開く先を
      // 読めているとは限らない
      secondary: { label: "選択…", onClick: actions.selectRoot },
    };
  }
  // 状態を名前で並べず `canListEnginesDir` で受ける。並べると、`EnginesDir` に状態が増えたときに
  // 読めていないまま下の「エンジンを置いてください」へ落ちる
  if (!canListEnginesDir(enginesDir)) {
    if (enginesDir === "other") {
      return {
        title: "engines がフォルダではありません",
        desc: "同じ名前のファイル（またはリンク）があります。削除するか、フォルダに置き換えてください。",
        primary: { label: "engines/ を開く", onClick: actions.openEnginesDir },
        secondary: { label: "もう一度読み込む", onClick: actions.rescan },
      };
    }
    if (canCreateEnginesDir(enginesDir)) {
      return {
        title: "engines/ フォルダを作成してください",
        desc: "エンジン実行ファイルをまとめる engines/ フォルダをボタンひとつで作成できます。",
        primary: { label: "engines/ を作成", onClick: actions.createEnginesDir },
        secondary: { label: "AI ライブラリを開く", onClick: actions.openAiRoot },
      };
    }
    return {
      title: "フォルダの状態を読めていません",
      desc: "もう一度読み込むと、いま何が在るかを読み直します。",
      primary: { label: "もう一度読み込む", onClick: actions.rescan },
      secondary: { label: "選択…", onClick: actions.selectRoot },
    };
  }
  if (engineNames.length === 0) {
    return {
      title: "エンジン実行ファイルを置いてください",
      desc: "engines/ の場所を表示します。その中に YaneuraOu などの実行ファイルを置いてから、もう一度読み込んでください。",
      primary: { label: "engines/ を開く", onClick: actions.openEnginesDir },
      secondary: { label: "もう一度読み込む", onClick: actions.rescan },
    };
  }
  if (profiles.length === 0) {
    return {
      title: "AI フォルダを作成してください",
      desc: "AI 名のフォルダを作成すると、eval/ と book/ が自動で用意されます。",
      primary: { label: "AI 名の入力へ", onClick: onFocusAiName },
    };
  }
  const missingEval = profiles.find((p) => !p.hasEval);
  if (missingEval) {
    return {
      title: `「${missingEval.name}」に評価関数を置いてください`,
      desc: `AI ライブラリの場所を表示します。その中の ${missingEval.name}/eval/ に nn.bin などを置いてから、もう一度読み込んでください。`,
      primary: { label: "AI ライブラリを開く", onClick: actions.openAiRoot },
      secondary: { label: "もう一度読み込む", onClick: actions.rescan },
    };
  }
  return {
    title: "セットアップの土台は完成しています",
    desc: "エンジンと評価関数が見つかっています。プリセット作成に進めます。",
    primary: { label: "もう一度読み込む", onClick: actions.rescan },
  };
}

export function SetupHero(props: Props) {
  const { title, desc, primary, secondary } = nextActionOf(props);

  return (
    <div className="setupGuide__hero">
      <div className="setupGuide__heroBody">
        <p className="setupGuide__heroTitle">{title}</p>
        <p className="setupGuide__heroDesc">{desc}</p>
      </div>
      <div className="setupGuide__heroActions">
        {primary && (
          <Button tone="accent" size="sm" onClick={primary.onClick}>
            {primary.label}
          </Button>
        )}
        {secondary && (
          <Button size="sm" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        )}
      </div>
    </div>
  );
}
