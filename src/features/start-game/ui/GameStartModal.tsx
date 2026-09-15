import { useCallback, useMemo, useState } from "react";

import { useAppConfig } from "@/entities/app-config";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { isPresetConfigured } from "@/entities/engine-presets/model/types";
import { collectDirs, FsErrorView, useFileTree, type FsError } from "@/entities/file-tree";
import { useGameSession, type GameSettings } from "@/entities/game-session";
import { KIFU_FORMAT_OPTIONS, kifuFileName, type KifuFormat } from "@/entities/kifu/model/kifu";
import { useURLParams } from "@/shared/lib/router/useURLParams";

import Button from "@/shared/ui/Button/Button";
import ButtonGroup from "@/shared/ui/Form/ButtonGroup";
import Form from "@/shared/ui/Form/Form";
import FormField from "@/shared/ui/Form/FormField";
import Select from "@/shared/ui/Form/Select";
import TextInput from "@/shared/ui/Form/TextInput";
import Modal from "@/shared/ui/Modal";

import { PONDER_DISABLED, playerSpecOf, type SeatChoice } from "../lib/playerSpec";
import {
  DEFAULT_TIME_CONTROL,
  isPlayableTimeControl,
  toTimeLimit,
  type TimeControl,
  type TimeControlKind,
} from "../lib/timeLimit";
import "./GameStartModal.scss";

/**
 * 平手の開始局面。
 *
 * **`startpos` は渡せない**（Rust が `position sfen` を前置するので壊れた行になる）。
 * 盤で組んだ局面から始める口はまだ無い（→ `docs/spec/screens/play-view.md`）。
 */
const HIRATE_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const HUMAN_VALUE = "human";

const TIME_KIND_OPTIONS: { value: TimeControlKind; label: string }[] = [
  { value: "sudden", label: "切れ負け" },
  { value: "byoyomi", label: "秒読み" },
  { value: "fischer", label: "フィッシャー" },
];

/**
 * 対局を始める面。
 *
 * **棋譜を1枚作ってから対局を走らせる。** 対局を始めるのは棋譜を作る作業なので、
 * 起点はツリーとようこそ画面で、本体はここ（`create-file` と同じ形）。
 *
 * **欄の宛先は2つに割れる。** 対局者・持ち時間・開始局面は Rust へ、
 * ファイルの欄はワークスペースへ。持将棋の規則と最大手数はフロントが持つが、
 * 選ばせる口はまだ無い（`features/game-ruling` が既定値を使う）。
 */
export default function GameStartModal() {
  const { params } = useURLParams();

  // **開いているときだけ中身を作る。** 常駐している層なので、ここで割らないと
  // 閉じている間も対局とプリセットとツリーを購読することになる。
  // 割った副産物として、**開くたびに state が新品になる**（初期化の effect が要らない）
  const isOpen = params.modal === "game-start";
  if (!isOpen) return null;

  return <GameStartForm dir={params.dir ?? null} />;
}

function GameStartForm({ dir }: { dir: string | null }) {
  const { closeModal, updateParams } = useURLParams();

  const { createNewFile, fileTree, selectNodeByAbsPath } = useFileTree();
  const { state: presetsState } = useEnginePresets();
  const { config } = useAppConfig();
  const { view, start } = useGameSession();

  const [black, setBlack] = useState<SeatChoice>({ kind: "human" });
  const [white, setWhite] = useState<SeatChoice>({ kind: "human" });
  const [blackName, setBlackName] = useState("先手");
  const [whiteName, setWhiteName] = useState("後手");
  const [time, setTime] = useState<TimeControl>(DEFAULT_TIME_CONTROL);
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<KifuFormat>("kif");
  const [selectedDir, setSelectedDir] = useState(dir ?? "");
  const [isBusy, setIsBusy] = useState(false);
  const [submitError, setSubmitError] = useState<FsError | null>(null);
  /** 棋譜は作れたのに、盤へ載せられなかったときの一言 */
  const [openFailure, setOpenFailure] = useState<string | null>(null);

  const rootPath = fileTree?.path ?? "";
  // ようこそ画面から開くと `dir=` が来ない。**欄が無いまま行き止まらないよう、根へ落とす**
  const effectiveDir = selectedDir === "" ? rootPath : selectedDir;
  const dirOptions = useMemo(
    () => (fileTree ? collectDirs(fileTree, fileTree.path) : []),
    [fileTree],
  );

  /** 座れるエンジン。**揃っていないプリセットは出さない**（選べても始まらない） */
  const seatOptions = useMemo(() => {
    const engines = presetsState.presets
      .filter(isPresetConfigured)
      .map((preset) => ({ value: preset.id, label: preset.label }));
    return [{ value: HUMAN_VALUE, label: "人" }, ...engines];
  }, [presetsState.presets]);

  const fullFileName = useMemo(() => kifuFileName(fileName, format), [fileName, format]);

  const aiRoot = config?.ai_root ?? null;

  const settings = useMemo((): GameSettings | null => {
    const blackSpec = playerSpecOf(black, blackName, presetsState.presets, aiRoot, PONDER_DISABLED);
    const whiteSpec = playerSpecOf(white, whiteName, presetsState.presets, aiRoot, PONDER_DISABLED);
    if (blackSpec === null || whiteSpec === null) return null;

    const limit = toTimeLimit(time);
    return {
      black: blackSpec,
      white: whiteSpec,
      blackTime: limit,
      whiteTime: limit,
      startSfen: HIRATE_SFEN,
    };
  }, [black, white, blackName, whiteName, presetsState.presets, aiRoot, time]);

  /**
   * **対局は1局だけ。** 走っているうちに押しても進行の側が黙って断るので、
   * 断られることが分かっている状態では押させない（理由は下に出す）。
   *
   * **始め損ねた対局（`failed`）は数えない。** 進行の側もそれだけは断らない
   * ——Rust は起動に失敗した対局を台帳に載せないので、閉じる相手が居ない。
   * ここで沈めると、設定を直してもこの面からやり直せなくなる。
   */
  const held = view.kind !== "idle" && view.kind !== "failed";

  /**
   * 出来事の購読が張れていない。**始めても進まない。**
   *
   * 進行の側は黙って戻るだけなので、ここで止めないと**棋譜だけが1枚できる**。
   */
  const eventsUnavailable = view.kind === "idle" ? view.eventsUnavailable : null;

  /**
   * 押せない理由。**条件と1対1で並べる。**
   *
   * 「押せない」だけを見せると何を直せばよいか分からず、理由が条件から離れていると
   * 片方だけ直したときに**当たっていない案内**が残る（設定が済んでいるのに
   * 「エンジン管理で指定してください」と出す形）。
   */
  const blockers: string[] = [];
  if (held) {
    blockers.push("すでに対局があります。対局タブで「閉じる」を押してから始めてください。");
  }
  if (eventsUnavailable !== null) {
    blockers.push(`対局の進行を受け取れません。アプリを再起動してください（${eventsUnavailable}）`);
  }
  if (dirOptions.length === 0) {
    blockers.push("保存先がありません。先にワークスペースを開いてください。");
  }
  if (aiRoot === null && (black.kind === "engine" || white.kind === "engine")) {
    blockers.push(
      "AIライブラリの場所が設定されていません。設定の「AIライブラリ」で選んでください。",
    );
  }
  if (!isPlayableTimeControl(time)) {
    blockers.push("持ち時間を半角数字で入れてください（0 だけでは始められません）。");
  }

  const canSubmit =
    !isBusy &&
    !held &&
    eventsUnavailable === null &&
    fullFileName !== "" &&
    effectiveDir !== "" &&
    settings !== null &&
    isPlayableTimeControl(time);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit || settings === null) return;

      setSubmitError(null);
      setOpenFailure(null);
      setIsBusy(true);
      const created = await createNewFile(effectiveDir, {
        fileName: fullFileName,
        format,
        gameInfo: { black: settings.black.name, white: settings.white.name },
        initialPosition: { preset: "HIRATE" },
      });
      setIsBusy(false);

      if (!created.success) {
        // **衝突は対局では対話へ渡さない。** 渡すと別名で棋譜だけが作られて対話が閉じ、
        // 対局は始まらない（対話は「衝突が片付いたか」しか見ず、作った先を返さない）。
        // 名前を直して押し直せるよう、欄の下に出す
        setSubmitError(created.error);
        return;
      }

      // **作った棋譜を盤へ載せてから始める。** 載せないと、対局の手を積む先が
      // 前の棋譜のままになる（ようこそ画面から始めた場合は盤が空で、
      // ドックごと存在しないので進行も断りも出る場所が無い）
      if (!selectNodeByAbsPath(created.data, { forceReopen: true })) {
        setOpenFailure("作った棋譜がツリーに見つかりませんでした。開き直してから始めてください。");
        return;
      }

      // **遷移は1回にする。** `updateParams` はその描画で捕まえた `searchParams` から
      // 組み直すので、`closeModal()` の直後に呼ぶと**閉じる前の写し**から組んで
      // `modal=game-start` を書き戻す —— 対局は走り出すのにフォームが覆いかぶさったまま残る。
      //
      // **押した人が結果を待っている操作なので、ここだけはタブを移す。**
      // 進行も断りも対局タブが描く
      updateParams(
        {
          modal: undefined,
          dir: undefined,
          tab: undefined,
          sfen: undefined,
          returnTo: undefined,
          dock: "play",
        },
        { replace: true },
      );

      // **待たない。** `start_game` は評価関数の読み込みを待つので数十秒かかりうる。
      // 待ちも失敗も対局タブが出す（`starting` / `failed`）
      void start({ settings, kifuPath: created.data });
    },
    [
      canSubmit,
      settings,
      createNewFile,
      selectNodeByAbsPath,
      effectiveDir,
      fullFileName,
      format,
      updateParams,
      start,
    ],
  );

  const seatField = (
    side: "black" | "white",
    choice: SeatChoice,
    setChoice: (next: SeatChoice) => void,
    name: string,
    setName: (next: string) => void,
  ) => (
    <FormField horizontal>
      <Select
        label={side === "black" ? "▲先手" : "△後手"}
        id={`game-start-${side}`}
        options={seatOptions}
        value={choice.kind === "human" ? HUMAN_VALUE : choice.presetId}
        onChange={(value) =>
          setChoice(value === HUMAN_VALUE ? { kind: "human" } : { kind: "engine", presetId: value })
        }
      />
      {/*
        **エンジンの席に名前の欄を出さない。** 棋譜と画面に出るのはプリセットの見出しで、
        エンジンが名乗る `id name` は使わない（長い名乗りで `start_game` が落ちるため）
      */}
      {choice.kind === "human" && (
        <TextInput
          label="名前"
          id={`game-start-${side}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      )}
    </FormField>
  );

  return (
    <Modal
      /**
       * **作成中は閉じない。** 閉じる口は4つ（Esc・覆い・✕・「やめる」）あり、
       * 沈めてあるのは「やめる」だけ。棋譜を作っている最中に Esc を押すと、
       * この面は消えるのに送信は最後まで走り、**やめたつもりの人の前で対局が始まる**
       * （`CreateFileModal` の `requestClose` と同じ理由）。
       */
      onClose={() => {
        if (!isBusy) closeModal();
      }}
      label="対局を始める"
      theme="dark"
      variant="dialog"
      size="md"
      scroll="none"
    >
      {/*
        **スクロールを受け持つ箱を1枚置く。** `scroll="none"` のカードは
        `overflow: hidden` なので、入り切らない中身は**切られてスクロールでも届かない**。
        押せなくなるのは下端の「対局を始める」——窓を縮めただけで始められなくなる。
        姉妹の面（`SfenKifuCreateModal`）も同じ形で根を持っている
      */}
      <div className="game-start">
        <Form handleSubmit={handleSubmit}>
          <FormField>
            <h2 className="form__heading-secondary">対局を始める</h2>
          </FormField>

          {seatField("black", black, setBlack, blackName, setBlackName)}
          {seatField("white", white, setWhite, whiteName, setWhiteName)}

          <FormField horizontal>
            <Select
              label="持ち時間の形"
              id="game-start-time-kind"
              options={TIME_KIND_OPTIONS}
              value={time.kind}
              onChange={(kind) => setTime({ ...time, kind })}
            />
            <TextInput
              label="持ち時間（分）"
              id="game-start-main"
              value={time.mainMinutes}
              onChange={(event) => setTime({ ...time, mainMinutes: event.target.value })}
            />
            {time.kind === "byoyomi" && (
              <TextInput
                label="秒読み（秒）"
                id="game-start-byoyomi"
                value={time.byoyomiSeconds}
                onChange={(event) => setTime({ ...time, byoyomiSeconds: event.target.value })}
              />
            )}
            {time.kind === "fischer" && (
              <TextInput
                label="加算（秒）"
                id="game-start-increment"
                value={time.incrementSeconds}
                onChange={(event) => setTime({ ...time, incrementSeconds: event.target.value })}
              />
            )}
          </FormField>

          <FormField horizontal>
            <TextInput
              label="ファイル名"
              id="game-start-file"
              placeholder="2026-09-15 練習"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              required
            />
            <Select
              label="形式"
              id="game-start-format"
              options={KIFU_FORMAT_OPTIONS}
              value={format}
              onChange={setFormat}
            />
          </FormField>

          <FormField>
            <Select
              label="保存先フォルダ"
              id="game-start-dir"
              options={dirOptions}
              value={effectiveDir}
              onChange={setSelectedDir}
            />
          </FormField>

          {/*
          **押せない理由は1箇所にまとめる。** 別々に置くと、同時に立ったときに
          性質の違う行が区切りなく積まれて、どれが止めているのか読み分けられない
        */}
          {blockers.length > 0 && (
            <FormField>
              <ul className="game-start__blockers" role="alert">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </FormField>
          )}

          {openFailure !== null && (
            <FormField>
              <p className="game-start__hint" role="alert">
                {openFailure}
              </p>
            </FormField>
          )}

          {submitError && (
            <FormField>
              <FsErrorView error={submitError} />
            </FormField>
          )}

          {/* フォームは差し替えない。失敗して戻ったときに入力欄が消えると、
            キーボードの利用者は自分がどこに居るか分からなくなる */}
          <ButtonGroup>
            <Button type="submit" tone="primary" isLoading={isBusy} disabled={!canSubmit}>
              {isBusy ? "作成中..." : "対局を始める"}
            </Button>
            <Button type="button" onClick={() => closeModal()} disabled={isBusy}>
              やめる
            </Button>
          </ButtonGroup>
        </Form>
      </div>
    </Modal>
  );
}
