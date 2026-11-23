import Button from "@/shared/ui/Button/Button";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { KIFU_FORMAT_OPTIONS } from "@/entities/kifu/model/kifu";
import "./WelcomeScreen.scss";

// 形式の一覧を写さない。写すと、形式を1つ足したときに増えるのが
// 作るフォームだけになり、この画面だけが古い顔ぶれを出し続ける
const FORMATS = KIFU_FORMAT_OPTIONS.map((option) => `.${option.value}`);

/**
 * 棋譜を開いていないときの画面。
 *
 * 置くのは作る側の入口だけ。開くのはツリーの操作なので、こちらは持たない。
 */
function WelcomeScreen() {
  const { openModal } = useURLParams();

  return (
    <div className="welcome-screen">
      <div className="welcome-screen__content">
        {/* 名前はタイトルバーにあるので、読み上げない */}
        <img className="welcome-screen__mark" src="/icon.svg" alt="" width={594} height={691} />
        <h2 className="welcome-screen__title">棋譜を選択するか、作成してください</h2>
        <p className="welcome-screen__description">
          左のファイルツリーから棋譜を選択すると、
          <br /> こちらに盤が出ます
        </p>

        {/* 保存先を渡さない。ここからは `dir=` が決まらないので、
            組むタブの保存先の欄が受け持つ */}
        <Button
          className="welcome-screen__create"
          tone="primary"
          size="lg"
          onClick={() => openModal("create-file")}
        >
          棋譜を作成
        </Button>

        <p className="welcome-screen__formats">
          {FORMATS.map((format) => (
            <span key={format}>{format}</span>
          ))}
        </p>
      </div>
    </div>
  );
}

export default WelcomeScreen;
