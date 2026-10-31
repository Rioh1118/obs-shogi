import { useEffect, useRef, useState } from "react";
import type { EngineStatus } from "@/entities/analysis";

/** 状態ごとの語と印。**経過時間を添えるのは読んでいる間と読み終えた後だけ** */
const STATUS_VIEW: Record<EngineStatus, { word: string; mark: string; timer: boolean }> = {
  "no-engine": { word: "エンジンなし", mark: "idle", timer: false },
  starting: { word: "起動中…", mark: "idle", timer: false },
  "standing-by": { word: "待機中", mark: "idle", timer: false },
  analyzing: { word: "検討中", mark: "analyzing", timer: true },
  finished: { word: "検討完了", mark: "idle", timer: true },
  unresponsive: { word: "応答なし", mark: "warning", timer: false },
  exited: { word: "エンジン終了", mark: "danger", timer: false },
  failed: { word: "起動失敗", mark: "danger", timer: false },
  cancelled: { word: "起動を中止しました", mark: "danger", timer: false },
};

const formatElapsed = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/**
 * 操作列の左。**状態を語で言い、読んでいる間は局面を読み始めてからの実時間を添える。**
 * 局面が変わると 0 に戻り、読み終えたら止まった時点の値で止まる。
 */
export function EngineStatusLabel({
  status,
  currentSfen,
}: {
  status: EngineStatus;
  currentSfen: string | null;
}) {
  const view = STATUS_VIEW[status];
  const searching = status === "analyzing";
  const showsTimer = view.timer;
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const lastSfenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!searching) {
      startedAtRef.current = null;
      // 時計を出さない状態に入ったら値を捨てる。捨てないと、同じ局面で読み直してすぐ終わった回は
      // `検討中` を1描画も通らないので、前に読んだ時間が `検討完了` に出る。`検討完了` の値は残す
      if (!showsTimer) setElapsed(0);
      return;
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
      setElapsed(0);
    }
    const timer = setInterval(() => {
      if (startedAtRef.current === null) return;
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [searching, showsTimer]);

  useEffect(() => {
    if (currentSfen === lastSfenRef.current) return;
    lastSfenRef.current = currentSfen;
    if (searching) startedAtRef.current = Date.now();
    setElapsed(0);
  }, [currentSfen, searching]);

  return (
    <div className="analysis-controls__status">
      <span className={`analysis-controls__dot analysis-controls__dot--${view.mark}`}></span>
      <span className="analysis-controls__status-text">{view.word}</span>
      {view.timer && <span className="analysis-controls__timer">{formatElapsed(elapsed)}</span>}
    </div>
  );
}
