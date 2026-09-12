/**
 * 更新の状態。**段は `docs/state-transitions/updater.md` が持つ。**
 *
 * **`installing` と `ready` を分けるのは、ディスク上のアプリが入れ替わったかが
 * この2つで違うから。** plugin は取得が終わった時点で完了の合図を送り、
 * 署名の検証も入替もその後に走る。合図で `ready` を立てると、まだ何も
 * 入れ替わっていないのに「準備ができました」と「再起動して適用」が出る。
 */
export type UpdaterStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  /** 新しい版があると分かっている。まだ何も取得していない */
  | { phase: "available"; version: string }
  /** 取得中。`progress` は 0–100 */
  | { phase: "downloading"; progress: number }
  /** 取得は終わった。**署名の検証と入替の最中。** 取り消せない */
  | { phase: "installing" }
  /** 入替が終わった。走っているプロセスだけが古い */
  | { phase: "ready" }
  | { phase: "error"; failure: UpdaterFailure };

/**
 * 何に失敗したか。**`stage` が文言を決める。**
 *
 * 例外の文字列から原因を当てない。plugin は取得も検証も入替も同じ
 * `String` で返すので、綴りで場合分けすると plugin の版が上がった日に黙って外れる。
 * **どこまで進んでいたかは、こちらが数えていれば分かる。**
 */
export type UpdaterFailure = {
  /**
   * `download` … 取得の最中。ディスク上のアプリは無傷。
   * `install` … 取得は終わっていた。**検証か入替のどちらかで、区別は付かない。**
   *   入替の途中だった場合、アプリの実体は失われていることがある
   */
  stage: "download" | "install";
  /** plugin が返した文字列。**見出しにしない。** 原因を探すときの手掛かり */
  detail: string;
};

/**
 * 告知をどこまで見せたかの記憶。`updater.json`（Rust 側の `settings` crate）。
 *
 * **「後で」はここに来ない。** あちらはその起動の間だけ黙らせるもの。
 */
export type UpdaterState = {
  /** 告知を出さないと決めた版 */
  skippedVersion: string | null;
  /** 最後に**確認が通った**時刻（UNIX ミリ秒）。失敗した確認では動かない */
  lastCheckedMs: number | null;
};

/**
 * 手で押した確認の結果。**この画面の中だけで完結する。**
 *
 * 更新が見つかってもカードは設定モーダルの下に隠れる（重なりの順は
 * `docs/spec/design-language.md`）ので、見つかったことは設定の中で言う。
 * 取得と適用はカードが持つ——2箇所に置くと進捗も失敗も二重になる。
 */
export type ManualCheckResult =
  | { kind: "upToDate" }
  /** 新しい版があり、告知も出る */
  | { kind: "found"; version: string }
  /** 新しい版はあるが、その版は飛ばす設定になっている */
  | { kind: "foundButSkipped"; version: string }
  | { kind: "failed" };

export type UpdaterContextType = {
  status: UpdaterStatus;
  /** `updater.json` を読めるまでは `null` */
  persisted: UpdaterState | null;
  /** 手で押した確認の結果。押すまでは `null` */
  manualCheck: ManualCheckResult | null;
  /** 確認が走っている最中か。自動・手動のどちらでも立つ */
  isChecking: boolean;

  /** 取得して適用する。`available` のときだけ動く */
  downloadAndInstall: () => Promise<void>;
  /** 新しい版で開き直す */
  restart: () => Promise<void>;
  /** カードを閉じる。**この起動の間だけ。** 次の起動ではまた出る */
  dismiss: () => void;
  /** いま告知している版を、以後出さないようにする */
  skipCurrentVersion: () => Promise<void>;
  /** 飛ばす設定をやめる */
  unskip: () => Promise<void>;
  /** 手で確認する */
  checkNow: () => Promise<void>;
};
