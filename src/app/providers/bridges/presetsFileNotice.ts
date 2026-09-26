import type { PresetsLoadNotice, SaveFailure } from "@/entities/engine-presets/model/types";
import type { NotifyTier } from "@/shared/lib/notification/types";
import { getBaseName } from "@/shared/lib/path";

/** 帯の動作。`reload` は読み直す、`settings` は設定のエンジン管理を開く */
export type PresetsNoticeAction = "reload" | "settings";

/**
 * 通知1枚ぶん（読み込みで起きたこと・保存を断られたこと・読み込めなかったことの共通の形）。
 * `presentation` が `toast` のものは自分で消える（動作を持てない）。帯（`banner`）は動作を
 * 1つ持つ——帯はヘッダを覆うので、閉じる以外にやることが無い帯は出せない
 */
export type PresetsFileNoticeView =
  | { presentation: "toast"; tier: Exclude<NotifyTier, "silent">; title: string; body: string }
  | {
      presentation: "banner";
      tier: Exclude<NotifyTier, "silent">;
      title: string;
      body: string;
      action: PresetsNoticeAction;
    };

/** 書けない状態で開いた種類の結び */
const OPENED_READ_ONLY = "変更できない状態で開いています。";
/** 直すのがアプリの外（フォルダの権限）の種類の結び */
const CHECK_FOLDER = "設定のフォルダに書き込めるかを確かめて、「読み直す」を押してください。";

type LoadNoticeBuilders = {
  [K in PresetsLoadNotice["kind"]]: (
    notice: Extract<PresetsLoadNotice, { kind: K }>,
  ) => PresetsFileNoticeView;
};

/**
 * 読み込みで起きたことの見せ方。**全種類を書かせる**（種類が Rust から届いていることは
 * `presetsWire.test.ts` が見る）。
 *
 * 段（ADR-0004）: 何もしなくてよいものは `info`。**このまま使うと変更が保存されず、直すのが
 * アプリの中か利用者のフォルダの権限**の種類は `danger`。**新しい版は `warning`**——書けない状態で
 * 開くが、直す手段はアプリの更新で、フォルダや設定に問題があるわけではない。
 *
 * **Rust が返す理由の文字列（`reason`）は出さない**（利用者の言葉ではない）。ファイル名は出す——
 * 残したファイルを利用者が探して戻せるように
 */
const LOAD_NOTICE_BUILDERS: LoadNoticeBuilders = {
  migrated: ({ backup }) => ({
    presentation: "toast",
    tier: "info",
    title: "プリセットの保存形式を更新しました",
    body: `元のファイルは ${getBaseName(backup)} として残してあります。`,
  }),
  backupFailed: () => ({
    presentation: "banner",
    tier: "danger",
    title: "プリセットを新しい形式に移せませんでした",
    body: "元のファイルを残せなかったため、" + OPENED_READ_ONLY + CHECK_FOLDER,
    action: "reload",
  }),
  migrationFailed: () => ({
    presentation: "banner",
    tier: "danger",
    title: "プリセットを新しい形式に移せませんでした",
    body: "新しい形式で書き戻せなかったため、" + OPENED_READ_ONLY + CHECK_FOLDER,
    action: "reload",
  }),
  recovered: ({ destination }) => ({
    presentation: "banner",
    tier: "warning",
    title: "プリセットのファイルを読めませんでした",
    body:
      `読めなかったファイルは ${getBaseName(destination)} として同じフォルダに残し、` +
      "既定のプリセットから始めています。",
    action: "settings",
  }),
  notRecovered: () => ({
    presentation: "banner",
    tier: "danger",
    title: "プリセットのファイルを読めませんでした",
    body: "読めなかったファイルを移せなかったため、" + OPENED_READ_ONLY + CHECK_FOLDER,
    action: "reload",
  }),
  newerVersion: () => ({
    presentation: "banner",
    tier: "warning",
    title: "新しい版のアプリで保存されたプリセットです",
    body: "この版では変更できません。アプリを更新すると変更できるようになります。",
    action: "settings",
  }),
  unreadable: () => ({
    presentation: "banner",
    tier: "danger",
    title: "プリセットのファイルを読めませんでした",
    body:
      "ファイルを開けなかったため、" +
      OPENED_READ_ONLY +
      "ファイルの権限を確かめて、「読み直す」を押してください。",
    action: "reload",
  }),
};

/** 知らない種類（Rust にだけ足された種類）の受け皿。表を引けずに落ちるより、汎用の文言を出す */
const UNKNOWN_LOAD_NOTICE: PresetsFileNoticeView = {
  presentation: "banner",
  tier: "warning",
  title: "プリセットのファイルで問題が起きました",
  body: "「読み直す」を押して、状態を確かめてください。",
  action: "reload",
};

export function presetsLoadNoticeView(notice: PresetsLoadNotice): PresetsFileNoticeView {
  const build = LOAD_NOTICE_BUILDERS[notice.kind] as
    | ((notice: PresetsLoadNotice) => PresetsFileNoticeView)
    | undefined;
  return build ? build(notice) : UNKNOWN_LOAD_NOTICE;
}

/**
 * 保存を断られたことの見せ方。**どの種類でも変更は保存していない**（悲観更新）ことを本文で言う
 */
export const PRESETS_SAVE_NOTICES: Record<SaveFailure["kind"], PresetsFileNoticeView> = {
  conflict: {
    presentation: "banner",
    tier: "warning",
    title: "プリセットが別の場所で変更されました",
    body:
      "変更は保存していません。「読み直す」で最新の内容を読み込んでから、もう一度変更してください" +
      "（編集中の入力は、読み直すと元に戻ります）。",
    action: "reload",
  },
  readOnly: {
    presentation: "banner",
    tier: "danger",
    title: "プリセットを保存できません",
    body: "変更は保存していません。プリセットのファイルを変更できない状態です。「読み直す」で状態を確かめてください。",
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

/** 読み込みそのもの（`load_presets` の呼び出し）が失敗したときの見せ方 */
export const PRESETS_LOAD_FAILED: PresetsFileNoticeView = {
  presentation: "banner",
  tier: "danger",
  title: "プリセットを読み込めませんでした",
  body: "解析に使うプリセットが読めていません。「読み直す」を押してください。",
  action: "reload",
};
