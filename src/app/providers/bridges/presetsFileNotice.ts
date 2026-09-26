import type { PresetsNotice, SaveFailure } from "@/entities/engine-presets/model/types";
import type { NotifyTier } from "@/shared/lib/notification/types";

/** 帯の動作。`reload` は読み直す、`settings` は設定のエンジン管理を開く */
export type PresetsNoticeAction = "reload" | "settings";

/**
 * 1枚ぶん。`presentation` が `toast` のものは自分で消える（動作を持てない）。
 * 帯（`banner`）は動作を1つ持つ——帯はヘッダを覆うので、閉じる以外にやることが無い帯は出せない
 */
export type PresetsNoticeView =
  | { presentation: "toast"; tier: Exclude<NotifyTier, "silent">; title: string; body: string }
  | {
      presentation: "banner";
      tier: Exclude<NotifyTier, "silent">;
      title: string;
      body: string;
      action: PresetsNoticeAction;
    };

/** 書けない状態で開いた種類の結び。直すのはアプリの外（フォルダの権限）なので、読み直す口を出す */
const OPENED_READ_ONLY = "変更できない状態で開いています。";
const CHECK_FOLDER = "設定のフォルダに書き込めるかを確かめて、「読み直す」を押してください。";

/**
 * 読み込みで起きたことの見せ方。**`Record` で全種類を書かせる**
 * （種類が Rust から届いていることは `presetsWire.test.ts` が見る）。
 *
 * 段（ADR-0004）: 何もしなくてよいものは `info`、読み直すか別の操作が要るものは
 * `warning` / `danger`。**書けない状態で開いた種類は `danger`**——このまま使うと変更が保存されない
 */
export const PRESETS_LOAD_NOTICES: Record<PresetsNotice["kind"], PresetsNoticeView> = {
  migrated: {
    presentation: "toast",
    tier: "info",
    title: "プリセットの保存形式を更新しました",
    body: "元のファイルは残してあります。",
  },
  backupFailed: {
    presentation: "banner",
    tier: "danger",
    title: "プリセットを新しい形式に移せませんでした",
    body: "元のファイルを残せなかったため、" + OPENED_READ_ONLY + CHECK_FOLDER,
    action: "reload",
  },
  migrationFailed: {
    presentation: "banner",
    tier: "danger",
    title: "プリセットを新しい形式に移せませんでした",
    body: "新しい形式で書き戻せなかったため、" + OPENED_READ_ONLY + CHECK_FOLDER,
    action: "reload",
  },
  recovered: {
    presentation: "banner",
    tier: "warning",
    title: "プリセットのファイルを読めませんでした",
    body: "読めなかったファイルは別の名前で残し、空の状態から始めています。",
    action: "settings",
  },
  notRecovered: {
    presentation: "banner",
    tier: "danger",
    title: "プリセットのファイルを読めませんでした",
    body: "読めなかったファイルを移せなかったため、" + OPENED_READ_ONLY + CHECK_FOLDER,
    action: "reload",
  },
  newerVersion: {
    presentation: "banner",
    tier: "warning",
    title: "新しい版のアプリで保存されたプリセットです",
    body: "この版では変更できません。アプリを更新すると変更できるようになります。",
    action: "settings",
  },
  unreadable: {
    presentation: "banner",
    tier: "danger",
    title: "プリセットのファイルを読めませんでした",
    body:
      "ファイルを開けなかったため、" +
      OPENED_READ_ONLY +
      "ファイルの権限を確かめて、「読み直す」を押してください。",
    action: "reload",
  },
};

/** 保存を断られたことの見せ方。**どの種類でも変更は保存していない**（悲観更新）ことを本文で言う */
export const PRESETS_SAVE_NOTICES: Record<SaveFailure["kind"], PresetsNoticeView> = {
  conflict: {
    presentation: "banner",
    tier: "warning",
    title: "プリセットが別の場所で変更されました",
    body: "変更は保存していません。「読み直す」で最新の内容を読み込んでから、もう一度変更してください。",
    action: "reload",
  },
  readOnly: {
    presentation: "banner",
    tier: "danger",
    title: "プリセットを保存できません",
    body: "変更は保存していません。" + OPENED_READ_ONLY + CHECK_FOLDER,
    action: "reload",
  },
  io: {
    presentation: "banner",
    tier: "warning",
    title: "プリセットを保存できませんでした",
    body: "変更は保存していません。設定のフォルダに書き込めるかを確かめて、もう一度保存してください。",
    action: "settings",
  },
  invalid: {
    presentation: "banner",
    tier: "danger",
    title: "プリセットを保存できませんでした",
    body: "変更は保存していません。保存できない値が含まれています。プリセットを見直してください。",
    action: "settings",
  },
  unknown: {
    presentation: "banner",
    tier: "warning",
    title: "プリセットを保存できませんでした",
    body: "変更は保存していません。もう一度保存してください。",
    action: "settings",
  },
};
