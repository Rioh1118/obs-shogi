import { useCallback, useMemo, useState } from "react";

import { useAppConfig } from "@/entities/app-config";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { isPresetConfigured } from "@/entities/engine-presets/model/types";
import {
  collectDirs,
  FsErrorView,
  isResolvedByConflictDialog,
  useFileTree,
  type FsError,
} from "@/entities/file-tree";
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

import { playerSpecOf, type SeatChoice } from "../lib/playerSpec";
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

  const { createNewFile, fileTree } = useFileTree();
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

  const settings = useMemo((): GameSettings | null => {
    const aiRoot = config?.ai_root ?? null;
    const blackSpec = playerSpecOf(black, blackName, presetsState.presets, aiRoot, false);
    const whiteSpec = playerSpecOf(white, whiteName, presetsState.presets, aiRoot, false);
    if (blackSpec === null || whiteSpec === null) return null;

    const limit = toTimeLimit(time);
    return {
      black: blackSpec,
      white: whiteSpec,
      blackTime: limit,
      whiteTime: limit,
      startSfen: HIRATE_SFEN,
    };
  }, [black, white, blackName, whiteName, presetsState.presets, config?.ai_root, time]);

  /**
   * **対局は1局だけ。** 走っているうちに押しても進行の側が黙って断るので、
   * 断られることが分かっている状態では押させない（理由は下に出す）。
   */
  const held = view.kind !== "idle";

  const canSubmit =
    !isBusy &&
    !held &&
    fullFileName !== "" &&
    effectiveDir !== "" &&
    settings !== null &&
    isPlayableTimeControl(time);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit || settings === null) return;

      setSubmitError(null);
      setIsBusy(true);
      const created = await createNewFile(effectiveDir, {
        fileName: fullFileName,
        format,
        gameInfo: { black: settings.black.name, white: settings.white.name },
        initialPosition: { preset: "HIRATE" },
      });
      setIsBusy(false);

      if (!created.success) {
        // 衝突は別名を選ぶ対話が引き取る。ここで描くと対話の背後に二重に出る
        if (!isResolvedByConflictDialog(created.error.code)) setSubmitError(created.error);
        return;
      }

      // **押した人が結果を待っている操作なので、ここだけはタブを移す。**
      // 進行も断りも対局タブが描くので、この面はもう要らない
      closeModal();
      updateParams({ dock: "play" }, { replace: true });

      // **待たない。** `start_game` は評価関数の読み込みを待つので数十秒かかりうる。
      // 待ちも失敗も対局タブが出す（`starting` / `failed`）
      void start({ settings, kifuPath: created.data });
    },
    [
      canSubmit,
      settings,
      createNewFile,
      effectiveDir,
      fullFileName,
      format,
      closeModal,
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
      onClose={closeModal}
      label="対局を始める"
      theme="dark"
      variant="dialog"
      size="md"
      scroll="none"
    >
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
            value={String(time.mainMinutes)}
            onChange={(event) => setTime({ ...time, mainMinutes: Number(event.target.value) })}
          />
          {time.kind === "byoyomi" && (
            <TextInput
              label="秒読み（秒）"
              id="game-start-byoyomi"
              value={String(time.byoyomiSeconds)}
              onChange={(event) => setTime({ ...time, byoyomiSeconds: Number(event.target.value) })}
            />
          )}
          {time.kind === "fischer" && (
            <TextInput
              label="加算（秒）"
              id="game-start-increment"
              value={String(time.incrementSeconds)}
              onChange={(event) =>
                setTime({ ...time, incrementSeconds: Number(event.target.value) })
              }
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
          {dirOptions.length === 0 && (
            <p className="game-start__hint">
              保存先がありません。先にワークスペースを開いてください
            </p>
          )}
        </FormField>

        {/* **押せない理由を出す。** 「押せない」だけだと、何を直せばよいか分からない */}
        {held && (
          <FormField>
            <p className="game-start__hint" role="alert">
              すでに対局があります。対局タブで「閉じる」を押してから始めてください。
            </p>
          </FormField>
        )}

        {settings === null && (
          <FormField>
            <p className="game-start__hint" role="alert">
              選んだエンジンの設定が揃っていません。設定の「エンジン管理」で
              実行ファイルと評価関数を指定してください。
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
    </Modal>
  );
}
