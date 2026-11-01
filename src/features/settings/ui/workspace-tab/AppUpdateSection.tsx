import { useEffect, useState } from "react";

import SSection from "../kit/SSection";
import Button from "@/shared/ui/Button/Button";
import MiniStat from "./MiniStat";

import { acceptsManualCheck, useUpdater } from "@/entities/updater";
import type { ManualCheckResult } from "@/entities/updater";
import { getAppVersion } from "@/shared/api/app/appVersion";

/**
 * 手で押した確認の結果の文。
 *
 * 見つかっても取得のボタンを置かない。更新のカードは設定モーダルの下に出る（重なりの順は
 * `docs/spec/design-language.md`）ので、ここに置くと進捗と失敗の出る面が2つになる。
 * 失敗に「もう一度」を出さない。すぐ上の「更新を確認」と同じ動作のボタンが2つ並ぶ。
 */
function manualCheckText(result: ManualCheckResult): string {
  switch (result.kind) {
    case "upToDate":
      return "最新版を使っています";
    case "found":
      return `新しいバージョン v${result.version} が公開されています。この画面を閉じると案内が出ます。`;
    case "foundButSkipped":
      return `新しいバージョン v${result.version} がありますが、この版は飛ばす設定になっています。`;
    case "failed":
      return "更新を確認できませんでした。通信を確認して、もう一度お試しください。";
  }
}

/**
 * 最後に確認できた時刻の文。
 *
 * 一度も確認できていないときも空欄にしない。起動時の確認の失敗は画面に出さない（理由は
 * `entities/updater` の provider の `runCheck`）ので、時刻が古いまま止まっていることが、
 * 失敗し続けていることの手掛かりになる。
 */
function lastCheckedText(ms: number | null): string {
  if (ms === null) return "まだ確認できていません";
  return new Date(ms).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ワークスペースタブの「更新」の節。確認だけを行い、取得と適用は更新のカードへ渡す */
export default function AppUpdateSection() {
  const { status, persisted, manualCheck, isChecking, checkNow, unskip } = useUpdater();

  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getAppVersion()
      .then((v) => {
        if (alive) setAppVersion(v);
      })
      // 版が取れないのは webview から `getVersion` を呼べないときだけで、利用者にできることが
      // 無い。出さずに「—」のままにする
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SSection
      title="更新"
      description="アプリ本体の更新を確認します。起動のたびに一度だけ自動で確認します。"
      actions={
        <Button
          size="sm"
          onClick={() => void checkNow()}
          disabled={isChecking || !acceptsManualCheck(status)}
        >
          更新を確認
        </Button>
      }
    >
      <div className="wsTab__miniGrid">
        <MiniStat label="現在のバージョン">{appVersion ?? "—"}</MiniStat>
        <MiniStat label="最後に確認できた" plain>
          {lastCheckedText(persisted?.lastCheckedMs ?? null)}
        </MiniStat>
      </div>

      {manualCheck && (
        <div className="wsTab__updateResult" role="status">
          {manualCheckText(manualCheck)}
        </div>
      )}

      {/*
        確認の結果と別に常に出す。更新が来ない理由が、確認の故障か飛ばす設定かを見分けるため
      */}
      {persisted?.skippedVersion && (
        <div className="wsTab__updateSkipped">
          <div className="wsTab__updateSkippedText">
            v{persisted.skippedVersion} を飛ばす設定になっています
          </div>
          <Button size="sm" onClick={() => void unskip()}>
            解除
          </Button>
        </div>
      )}
    </SSection>
  );
}
