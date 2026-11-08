# evals/baselines/

`npm run ds:eval` の結果のうち、比較の基準にしたいものを写して置く場所。

- 実行結果は `evals/results/<timestamp>/` に出る（git 管理外）。基準にする回の `aggregate-result.json` を `evals/baselines/<YYYY-MM-DD>-<短い説明>.json` として写す。
- 画面の基準画像（ds:shot）はここではなく `tests/__screenshots__/` にある。
