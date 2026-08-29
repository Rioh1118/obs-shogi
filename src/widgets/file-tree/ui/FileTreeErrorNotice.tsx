import Button from "@/shared/ui/Button/Button";
import FsErrorView from "@/entities/file-tree/ui/FsErrorView";
import { fsErrorTier, type FsError } from "@/entities/file-tree/api/error";

interface Props {
  error: FsError;
  onRetry: () => void;
  onDismiss?: () => void;
  isRetrying?: boolean;
  /**
   * 読み直しでは直らない失敗のときに出す逃げ道。
   * 何をすれば直るかは失敗ごとに違うので、動作ごと受け取る（ADR-0004）。
   */
  fallback?: { label: string; run: () => void };
}

/**
 * ファイル操作とツリー取得の失敗を、復帰路つきで出す。
 *
 * 出すボタンは段が決める。読み直しても直らない失敗に再読み込みを出すと、
 * 押しても何も変わらないので利用者は押し続ける。
 *
 * 復帰路は読み直しの1本だけ。失敗した操作の内容は state に残らないので
 * （`already_exists` のみ `conflict` として保持される）、同じ操作はやり直せない。
 */
export default function FileTreeErrorNotice({
  error,
  onRetry,
  onDismiss,
  isRetrying,
  fallback,
}: Props) {
  const tier = fsErrorTier(error.code);

  return (
    <FsErrorView
      error={error}
      actions={
        <>
          {onDismiss && (
            <Button onClick={onDismiss} disabled={isRetrying}>
              閉じる
            </Button>
          )}
          {tier !== "warning" && fallback && (
            <Button tone="primary" onClick={fallback.run}>
              {fallback.label}
            </Button>
          )}
          {tier === "warning" && (
            <Button tone="primary" onClick={onRetry} disabled={isRetrying}>
              {isRetrying ? "読み込み中..." : "再読み込み"}
            </Button>
          )}
        </>
      }
    />
  );
}
