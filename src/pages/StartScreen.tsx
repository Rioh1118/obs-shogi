import Title from "@/shared/ui/Title";
import ChooseWorkspaceButton from "@/features/choose-workspace/ui/ChooseWorkspaceButton";
import "./StartScreen.scss";

type Props = {
  message: string;
  /** 失敗を伝える文か。読み上げに割り込ませる */
  isError?: boolean;
  onChosen: () => void;
};

/** 作業画面に入る前の画面。名前と1文、ワークスペースを選ぶボタンだけを置く */
export default function StartScreen({ message, isError = false, onChosen }: Props) {
  return (
    <div className="start-screen">
      <div className="start-screen__content">
        {/* 名前は下の文字が言うので、読み上げない */}
        <img className="start-screen__mark" src="/icon.svg" alt="" width={594} height={691} />
        <Title />
        <p className="start-screen__message" role={isError ? "alert" : undefined}>
          {message}
        </p>
        <ChooseWorkspaceButton onChosen={onChosen} />
      </div>
    </div>
  );
}
