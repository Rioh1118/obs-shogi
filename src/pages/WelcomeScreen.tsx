import Title from "../shared/ui/Title";
import { FolderOpen, FileText } from "lucide-react";
import "./WelcomeScreen.scss";

function WelcomeScreen() {
  return (
    <div className="welcome-screen">
      <div className="welcome-screen__content">
        <Title />
        <div className="welcome-screen__message">
          <div className="welcome-screen__icon">
            <FolderOpen size={48} />
          </div>
          <h2 className="weelcome-screen__title">ファイルを選択してください</h2>
          <p className="welcome-screen__description">
            左のファイルツリーから棋譜ファイルを選択すると、
            <br /> こちらに盤面が表示されます
          </p>
          <div className="welcome-screen__formats">
            <div className="welcome-screen__format-item">
              <FileText size={16} />
              <span>.kif</span>
            </div>
            <div className="welcome-screen__format-item">
              <FileText size={16} />
              <span>.ki2</span>
            </div>
            <div className="welcome-screen__format-item">
              <FileText size={16} />
              <span>.csa</span>
            </div>
            <div className="welcome-screen__format-item">
              <FileText size={16} />
              <span>.jkf</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WelcomeScreen;
