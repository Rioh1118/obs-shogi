import type { UpdaterStatus } from "../model/types";

/**
 * 段ごとに、手で確認を始められるか。
 *
 * 取得を始めてから再起動までは provider の `runCheck` が確認を断る。押せるボタンを残すと、
 * 押しても結果が返らず、前の答えが画面に残る。取得か適用に失敗すると `error` へ移り、また
 * 確認できる。表で書くのは、段が増えたときに tsc で止めるため。
 */
const ACCEPTS_MANUAL_CHECK: Record<UpdaterStatus["phase"], boolean> = {
  idle: true,
  checking: false,
  available: true,
  downloading: false,
  installing: false,
  ready: false,
  error: true,
};

export function acceptsManualCheck(status: UpdaterStatus): boolean {
  return ACCEPTS_MANUAL_CHECK[status.phase];
}
