import type { EngineStartFailureKind } from "@/entities/engine";

/**
 * 起動中のまま、この時間が過ぎたら「時間が掛かっている」帯を出す（`EngineFailureBridge`）。
 *
 * **`readyok` の待ちに上限は無い**（DNN 系の初回の読み込みに上限を置けない。`startAnalysisEngine`）。
 * 帯が無いと、`readyok` を返さないエンジンを選んだ回に起動中のまま何も出ず、
 * 止める口もどこにも無い。30秒は、NNUE 系の評価関数の読み込み（数秒〜十数秒）を越え、
 * 人が「反応が無い」と判断する前に出る長さ
 */
export const SLOW_START_MS = 30_000;

/** 帯1枚ぶんの段・本文・「もう一度起動」を出すか */
export type EngineStartFailureNotice = {
  tier: "warning" | "danger";
  body: string;
  retry: boolean;
};

/** 原因が設定にしか無い種類の結び。設定を直した回だけ自動で起動し直す（`provider.tsx`） */
const FIX_SETTINGS = "設定を直せば自動でもう一度起動します。";

/**
 * 原因が設定の外にもありうる種類の結び。**直した場所で起動し直す経路が違う**——
 * 設定を直した回は自動で起動し直すが、ファイルや権限・ドライブを直した回は設定が変わらないので
 * 自動では起動しない。押す場所を書いておかないと、直し終えた利用者が行き止まりに座る
 */
const TWO_WAYS =
  "設定を直したときは自動で、ファイルや権限・ドライブを直したときは「もう一度起動」で起動し直します。";

/**
 * 起動の失敗の種類ごとに、帯の段・本文・「もう一度起動」を出すかを決めた表。
 * **判断の出典はここ1つ。** 他の doc は種類を列挙せず、ここを指す。
 *
 * **`Record` で全種類を書かせる。** 種類が増えたのに書き足し忘れると tsc が落ちる。
 * Rust の種類が TS の union に届いていることは `startFailureKindWire.test.ts` が見る。
 *
 * **段と「もう一度起動」は別の軸で決める。**
 * - 段（ADR-0004）: 同じ操作をもう一度で直る見込みがあれば `warning`、利用者が何かを直す
 *   必要があれば `danger`（`quarantined` は macOS の許可が要るので `danger`）
 * - 「もう一度起動」: **押す意味が残る種類に出す。** 原因が設定の外にもありうる種類
 *   （実行権限・置いたファイル・ドライブ・macOS の許可）は、そこを直しても設定が変わらず
 *   自動では起動しないので、押す口が要る。出さないのは、**値そのものが原因で設定を直す以外に
 *   道が無い** `invalidValue` だけ（押しても必ず同じ結果になる。ADR-0004 の F-9）
 */
export const ENGINE_START_FAILURE_NOTICES: Record<
  EngineStartFailureKind,
  EngineStartFailureNotice
> = {
  spawnFailed: {
    tier: "danger",
    body:
      "エンジンの実行ファイルを開けませんでした。設定の「エンジン管理」で、選んでいるプリセットの" +
      "エンジンの場所と、そのファイルに実行の権限があるかを確かめてください。" +
      TWO_WAYS,
    retry: true,
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
      TWO_WAYS,
    retry: true,
  },
  exitedEarly: {
    tier: "danger",
    body:
      "エンジンが準備の途中で終了しました。設定の「エンジン管理」で、エンジンと評価関数の場所と、" +
      "エンジンに必要なファイルが揃っているかを確かめてください。" +
      TWO_WAYS,
    retry: true,
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
  // 利用者が「起動をやめる」を押した回（`cancelStart`）。フロントが別の設定へ移って止めた回は
  // 世代が古いので帯まで届かない（`provider.tsx` の `seqRef`）
  cancelled: {
    tier: "warning",
    body: "エンジンの起動をやめました。もう一度起動するか、設定を開いてプリセットを選び直してください。",
    retry: true,
  },
  other: {
    tier: "danger",
    body:
      "解析はできません。設定の「エンジン管理」で、選んでいるプリセットの" +
      "エンジンと評価関数の場所を確かめてください。" +
      TWO_WAYS +
      "それでも起動しないときは、アプリを再起動してください。",
    retry: true,
  },
  unknown: {
    tier: "danger",
    body:
      "解析はできません。設定の「エンジン管理」で、選んでいるプリセットの" +
      "エンジンと評価関数の場所を確かめてください。" +
      TWO_WAYS +
      "それでも起動しないときは、アプリを再起動してください。",
    retry: true,
  },
};
