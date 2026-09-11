import Title from "@/shared/ui/Title";
import Button from "@/shared/ui/Button/Button";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { KIFU_FORMAT_OPTIONS } from "@/entities/kifu/model/kifu";
import { FolderOpen, FileText } from "lucide-react";
import "./WelcomeScreen.scss";

// **形式の一覧を写さない。** 写すと、形式を1つ足したときに増えるのが
// 作るフォームだけになり、この面だけが古い顔ぶれを出し続ける
const FORMATS = KIFU_FORMAT_OPTIONS.map((option) => `.${option.value}`);

/**
 * 棋譜を開いていないときの面
 *
 * **押せるものを1つ置く。** 棋譜が1本も無いワークスペースを開くと、この面は
 * 「ツリーから選べ」としか言わないのに、ツリーには選べるものが無い。
 * 作る側の入口をここに置かないと、`＋ファイル` を見つけるまで先へ進めない。
 *
 * 置くのは1つだけ。開くのはツリーの操作なので、こちらは作る側だけを持つ。
 */
function WelcomeScreen() {
  const { openModal } = useURLParams();

  return (
    <div className="welcome-screen">
      <div className="welcome-screen__content">
        <Title />
        <div className="welcome-screen__message">
          <div className="welcome-screen__icon">
            <FolderOpen size={48} />
          </div>
          <h2 className="welcome-screen__title">棋譜を選ぶか、作ってください</h2>
          <p className="welcome-screen__description">
            左のファイルツリーから棋譜を選ぶと、
            <br /> こちらに盤が出ます
          </p>

          <div className="welcome-screen__actions">
            {/* **保存先を渡さない。** ここからは `dir=` が決まらないので、
                組む面の保存先の欄が受け持つ */}
            <Button tone="primary" onClick={() => openModal("create-file")}>
              棋譜を作る
            </Button>
          </div>

          <div className="welcome-screen__formats">
            {FORMATS.map((format) => (
              <div key={format} className="welcome-screen__format-item">
                <FileText size={16} />
                <span>{format}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WelcomeScreen;
