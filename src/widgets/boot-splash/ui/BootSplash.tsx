import "./BootSplash.scss";

/**
 * 起動画面の絵。**`index.html` が同じ絵を静的に持っている**（`.boot-static`）。
 *
 * あちらは React が着く前の1枚で、この部品が最初のレンダで置き換える。
 * 2つの絵が食い違わないことは `src/__tests__/bootStaticSplash.test.ts` が見る。
 */
function BootSplash() {
  return (
    <div className="loading loading__container" role="status" aria-live="polite">
      <div className="loading__content">
        {/*
          **`public/` から URL で読む。** `index.html` の静的な1枚も同じ絵を出すので、
          `src/assets/` に置いてハッシュ付きの URL を得る形にすると、
          あちらから同じファイルを指す手段が無くなる
        */}
        <img className="loading__icon" src="/icon.svg" alt="ObsShogi" width={88} height={102} />

        <p className="loading__text">
          <span className="loading__label">Loading</span>
          <span className="loading__dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>

        <span className="loading__srOnly">Loading</span>
      </div>
    </div>
  );
}

export default BootSplash;
