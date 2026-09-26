import type { EngineFailureKind } from "@/entities/engine";

/**
 * 起動の失敗の種類ごとに、帯の段・本文・「もう一度起動」を出すかを決めた表。
 *
 * **`Record` で全種類を書かせる。** 種類が増えたのに書き足し忘れると tsc が落ちる。
 * 落ちないと、新しい種類は汎用の文言に落ち、利用者に次の一手が届かない。
 *
 * **「もう一度起動」は、同じ設定のままで直る見込みがある種類にだけ出す**（ADR-0004 の F-9）。
 * 原因が設定にある種類に出すと、押しても同じ結果になり、利用者は押し続ける。
 * 出すのは、原因がアプリの外にあって利用者がそこを直せる種類（macOS の許可、
 * 応答しなかったドライブ）と、途中で止められただけの種類。
 */
export type EngineFailureNotice = {
  tier: "warning" | "danger";
  body: string;
  retry: boolean;
};

/** 設定に原因がある種類の結び。設定を直した回だけ自動で起動し直す（`provider.tsx`） */
const FIX_SETTINGS = "設定を直せば自動でもう一度起動します。";

export const ENGINE_FAILURE_NOTICES: Record<EngineFailureKind, EngineFailureNotice> = {
  spawnFailed: {
    tier: "danger",
    body:
      "エンジンの実行ファイルを開けませんでした。設定の「エンジン管理」で、選んでいるプリセットの" +
      "エンジンの場所と、そのファイルに実行の権限があるかを確かめてください。" +
      FIX_SETTINGS,
    retry: false,
  },
  quarantined: {
    tier: "danger",
    body:
      "macOS がこのエンジンを開くのを止めています。システム設定の「プライバシーとセキュリティ」で" +
      "このエンジンを許可してから、「もう一度起動」を押してください。",
    retry: true,
  },
  notUsi: {
    tier: "danger",
    body:
      "選んだファイルは将棋エンジン（USI）として応答しませんでした。設定の「エンジン管理」で、" +
      "選んでいるプリセットのエンジンの場所を確かめてください。" +
      FIX_SETTINGS,
    retry: false,
  },
  exitedEarly: {
    tier: "danger",
    body:
      "エンジンが準備の途中で終了しました。設定の「エンジン管理」で、評価関数の場所と、" +
      "エンジンに必要なファイルが揃っているかを確かめてください。" +
      FIX_SETTINGS,
    retry: false,
  },
  timedOut: {
    tier: "warning",
    body:
      "エンジンが時間内に起動しませんでした。エンジンを置いたドライブ（外付け・ネットワーク上）が" +
      "応答しているかを確かめて、もう一度起動してください。",
    retry: true,
  },
  invalidValue: {
    tier: "danger",
    body:
      "選んでいるプリセットの設定値に、エンジンへ送れない文字（改行など）か長すぎる値が含まれています。" +
      "設定の「エンジン管理」でプリセットを直してください。" +
      FIX_SETTINGS,
    retry: false,
  },
  cancelled: {
    tier: "warning",
    body: "エンジンの起動が途中で止められました。もう一度起動してください。",
    retry: true,
  },
  other: {
    tier: "danger",
    body:
      "解析はできません。設定の「エンジン管理」で、選んでいるプリセットの" +
      "エンジンと評価関数の場所を確かめてください。" +
      FIX_SETTINGS +
      "設定が正しいのに起動しないときは、アプリを再起動してください。",
    retry: false,
  },
  unknown: {
    tier: "danger",
    body:
      "解析はできません。設定の「エンジン管理」で、選んでいるプリセットの" +
      "エンジンと評価関数の場所を確かめてください。" +
      FIX_SETTINGS +
      "設定が正しいのに起動しないときは、アプリを再起動してください。",
    retry: false,
  },
};
