import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";

import { engineInitializer } from "@/services/engine/EngineInitializer";
import type { EngineInfo } from "@/commands/engine/types";
import type { EngineConfig, EnginePhase } from "@/types/engine";
import { DEFAULT_OPTIONS } from "@/commands/engine/constants";
import { deepEqualConfig, isConfigured } from "@/utils/engineConfig";
import { useAppConfig } from "./AppConfigContext";

import type { EngineValidation } from "@/types/ai_validation";
import {
  checkEngineSetup,
  scanAiRoot,
  type AiRootIndex,
  type EngineSetupCheck,
} from "@/commands/ai_library";
import { buildIssuesFromCheck, toDraft } from "@/utils/aiLibrary";

const defaultDesiredConfig: EngineConfig = {
  aiRoot: null,
  selectedAiName: null,
  selectedEngineRel: null,
  evalDirName: "eval",
  bookDirName: "book",
  bookFileName: "user_book1.db",
  options: DEFAULT_OPTIONS,
};

type AsyncStatus = "idle" | "loading" | "checking" | "ok" | "error";

type AsyncState<T> = {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
};

interface EngineState {
  phase: EnginePhase;
  desiredConfig: EngineConfig;
  activeConfig: EngineConfig | null;

  engineInfo: EngineInfo | null;
  needsRestart: boolean;
  error: string | null;

  index: AsyncState<AiRootIndex>;
  setupCheck: AsyncState<EngineSetupCheck>;
}

type EngineAction =
  | { type: "set_desired_config"; payload: Partial<EngineConfig> }
  | { type: "merge_options"; payload: Record<string, string> }
  | { type: "initialize_start" }
  | {
      type: "initialize_success";
      payload: { engineInfo: EngineInfo; activeConfig: EngineConfig };
    }
  | { type: "initialize_error"; payload: string }
  | { type: "shutdown" }
  | { type: "clear_error" }
  | { type: "scan_idle" }
  | { type: "scan_start" }
  | { type: "scan_success"; payload: AiRootIndex }
  | { type: "scan_error"; payload: string }
  | { type: "check_start" }
  | { type: "check_success"; payload: EngineSetupCheck }
  | { type: "check_error"; payload: string };

const initialState: EngineState = {
  phase: "unconfigured",
  desiredConfig: defaultDesiredConfig,
  activeConfig: null,

  engineInfo: null,
  needsRestart: false,
  error: null,

  index: { status: "idle", data: null, error: null },
  setupCheck: { status: "idle", data: null, error: null },
};

function computeNeedsRestart(
  phase: EnginePhase,
  desired: EngineConfig,
  active: EngineConfig | null,
): boolean {
  if (phase !== "ready") return false;
  if (!active) return false;
  return !deepEqualConfig(desired, active);
}

function computeBasePhase(
  currentPhase: EnginePhase,
  desired: EngineConfig,
): EnginePhase {
  // runtime phase は維持
  if (currentPhase === "initializing" || currentPhase === "ready") {
    return currentPhase;
  }
  if (currentPhase === "error") {
    // error は clearError か config 変更で脱出（ここでは維持でもよいが、簡単のため更新可能にする）
    // → config 変更したら再試行しやすい
  }
  return isConfigured(desired) ? "configured" : "unconfigured";
}

function engineReducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case "set_desired_config": {
      const desiredConfig: EngineConfig = {
        ...state.desiredConfig,
        ...action.payload,
      };
      const phase = computeBasePhase(state.phase, desiredConfig);
      const needsRestart = computeNeedsRestart(
        phase,
        desiredConfig,
        state.activeConfig,
      );
      return { ...state, desiredConfig, phase, needsRestart, error: null };
    }

    case "merge_options": {
      const desiredConfig: EngineConfig = {
        ...state.desiredConfig,
        options: { ...state.desiredConfig.options, ...action.payload },
      };
      const phase = computeBasePhase(state.phase, desiredConfig);
      const needsRestart = computeNeedsRestart(
        phase,
        desiredConfig,
        state.activeConfig,
      );
      return { ...state, desiredConfig, phase, needsRestart, error: null };
    }

    case "initialize_start":
      return { ...state, phase: "initializing", error: null };

    case "initialize_success": {
      const { engineInfo, activeConfig } = action.payload;
      const needsRestart = computeNeedsRestart(
        "ready",
        state.desiredConfig,
        activeConfig,
      );
      return {
        ...state,
        phase: "ready",
        engineInfo,
        activeConfig,
        needsRestart,
        error: null,
      };
    }

    case "initialize_error":
      return {
        ...state,
        phase: "error",
        engineInfo: null,
        activeConfig: null,
        needsRestart: false,
        error: action.payload,
      };

    case "shutdown": {
      const phase: EnginePhase = isConfigured(state.desiredConfig)
        ? "configured"
        : "unconfigured";
      return {
        ...state,
        phase,
        engineInfo: null,
        activeConfig: null,
        needsRestart: false,
        error: null,
      };
    }

    case "clear_error": {
      const phase: EnginePhase = isConfigured(state.desiredConfig)
        ? "configured"
        : "unconfigured";
      return { ...state, phase, error: null };
    }

    case "scan_idle":
      return { ...state, index: { status: "idle", data: null, error: null } };

    case "scan_start":
      return {
        ...state,
        index: { status: "loading", data: null, error: null },
      };

    case "scan_success":
      return {
        ...state,
        index: { status: "ok", data: action.payload, error: null },
      };

    case "scan_error":
      return {
        ...state,
        index: { status: "error", data: null, error: action.payload },
      };

    case "check_start":
      return {
        ...state,
        setupCheck: {
          status: "checking",
          data: state.setupCheck.data,
          error: null,
        },
      };

    case "check_success":
      return {
        ...state,
        setupCheck: { status: "ok", data: action.payload, error: null },
      };

    case "check_error":
      return {
        ...state,
        setupCheck: { status: "error", data: null, error: action.payload },
      };

    default:
      return state;
  }
}

type EngineContextType = {
  state: EngineState;

  // derived
  isReady: boolean;
  isConfigured: boolean;
  setupOk: boolean;
  resolvedPaths: EngineSetupCheck["resolved"];
  aiRootIndex: AiRootIndex | null;
  engineSetupCheck: EngineSetupCheck | null;
  validation: EngineValidation;

  // operations
  refreshAiRootIndex: () => Promise<void>;
  recheckSetup: () => Promise<void>;

  setAiRoot: (root: string | null) => void;
  setSelectedAiName: (name: string | null) => void;
  setSelectedEngineRel: (rel: string | null) => void;
  setEvalDirName: (dir: string) => void;
  setBookDirName: (dir: string) => void;
  setBookFileName: (file: string) => void;
  mergeOptions: (partial: Record<string, string>) => void;

  initialize: () => Promise<boolean>;
  shutdown: () => Promise<void>;
  restart: () => Promise<boolean>;
  clearError: () => void;
};

const EngineContext = createContext<EngineContextType | null>(null);

export const EngineProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(engineReducer, initialState);

  const stateRef = useRef(state);
  stateRef.current = state;

  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  // initialize/shutdown の世代管理
  const initSeqRef = useRef(0);

  // AppConfig -> desiredConfig.aiRoot 同期
  const { config } = useAppConfig();
  const aiRootFromConfig = config?.ai_root ?? null;

  useEffect(() => {
    const cur = state.desiredConfig.aiRoot ?? null;
    const next = aiRootFromConfig ?? null;
    if (cur === next) return;

    dispatch({
      type: "set_desired_config",
      payload: { aiRoot: next, selectedAiName: null, selectedEngineRel: null },
    });
  }, [aiRootFromConfig, state.desiredConfig.aiRoot]);

  // scan ai_root
  const refreshAiRootIndex = useCallback(async () => {
    const aiRoot = stateRef.current.desiredConfig.aiRoot;
    if (!aiRoot) {
      dispatch({ type: "scan_idle" });
      return;
    }
    dispatch({ type: "scan_start" });
    try {
      const idx = await scanAiRoot(aiRoot);
      if (!aliveRef.current) return;
      dispatch({ type: "scan_success", payload: idx });
    } catch (e) {
      if (!aliveRef.current) return;
      dispatch({
        type: "scan_error",
        payload: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    refreshAiRootIndex().catch(() => {});
  }, [state.desiredConfig.aiRoot, refreshAiRootIndex]);

  // setup check（debounce）
  const debounceTimerRef = useRef<number | null>(null);

  const recheckSetup = useCallback(async () => {
    const desired = stateRef.current.desiredConfig;
    const draft = toDraft(desired);

    dispatch({ type: "check_start" });
    try {
      const check = await checkEngineSetup(draft);
      if (!aliveRef.current) return;
      dispatch({ type: "check_success", payload: check });
    } catch (e) {
      if (!aliveRef.current) return;
      dispatch({
        type: "check_error",
        payload: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = window.setTimeout(() => {
      recheckSetup().catch(() => {});
    }, 250);

    return () => {
      if (debounceTimerRef.current)
        window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    };
  }, [
    state.desiredConfig.aiRoot,
    state.desiredConfig.selectedAiName,
    state.desiredConfig.selectedEngineRel,
    state.desiredConfig.evalDirName,
    state.desiredConfig.bookDirName,
    state.desiredConfig.bookFileName,
    recheckSetup,
  ]);

  // derived
  const isReady = state.phase === "ready";
  const isConfiguredFlag = isConfigured(state.desiredConfig);

  const aiRootIndex = state.index.data;
  const engineSetupCheck = state.setupCheck.data;
  const resolvedPaths = engineSetupCheck?.resolved ?? null;
  const setupOk = !!engineSetupCheck?.ok && !!engineSetupCheck?.resolved;

  const validation: EngineValidation = useMemo(() => {
    // 未設定
    if (!isConfiguredFlag) {
      return {
        status: "ng",
        issues: [{ code: "NOT_CONFIGURED", message: "未設定です" }],
      };
    }

    // チェック中
    if (state.setupCheck.status === "checking") {
      return { status: "checking", issues: [] };
    }

    // チェック自体がエラー
    if (state.setupCheck.status === "error") {
      return {
        status: "ng",
        issues: [
          {
            code: "VALIDATION_ERROR",
            message: state.setupCheck.error ?? "setup check error",
          },
        ],
      };
    }

    // 結果から issues 生成
    if (state.setupCheck.data) {
      return buildIssuesFromCheck(state.setupCheck.data);
    }

    return { status: "idle", issues: [] };
  }, [
    isConfiguredFlag,
    state.setupCheck.status,
    state.setupCheck.data,
    state.setupCheck.error,
  ]);

  // config 操作
  const setAiRoot = useCallback((root: string | null) => {
    dispatch({ type: "set_desired_config", payload: { aiRoot: root } });
  }, []);

  const setSelectedAiName = useCallback((name: string | null) => {
    dispatch({ type: "set_desired_config", payload: { selectedAiName: name } });
  }, []);

  const setSelectedEngineRel = useCallback((rel: string | null) => {
    dispatch({
      type: "set_desired_config",
      payload: { selectedEngineRel: rel },
    });
  }, []);

  const setEvalDirName = useCallback((dir: string) => {
    dispatch({ type: "set_desired_config", payload: { evalDirName: dir } });
  }, []);

  const setBookDirName = useCallback((dir: string) => {
    dispatch({ type: "set_desired_config", payload: { bookDirName: dir } });
  }, []);

  const setBookFileName = useCallback((file: string) => {
    dispatch({ type: "set_desired_config", payload: { bookFileName: file } });
  }, []);

  const mergeOptions = useCallback((partial: Record<string, string>) => {
    dispatch({ type: "merge_options", payload: partial });
  }, []);

  // lifecycle
  const initialize = useCallback(async (): Promise<boolean> => {
    const mySeq = ++initSeqRef.current;

    const s = stateRef.current;
    if (s.phase === "initializing") return false;

    const check = s.setupCheck.data;
    const resolved = check?.resolved ?? null;
    if (!check || !check.ok || !resolved) return false;

    dispatch({ type: "initialize_start" });

    try {
      const info = await engineInitializer.initialize({
        enginePath: resolved.engine_path,
        workDir: resolved.work_dir,
        evalDir: resolved.eval_dir,
        bookDir: resolved.book_dir,
        bookFile: resolved.book_path,
        options: s.desiredConfig.options,
      });

      // shutdown/再初期化/アンマウント後なら無視
      if (!aliveRef.current || initSeqRef.current !== mySeq) return false;

      const activeSnapshot: EngineConfig =
        typeof structuredClone === "function"
          ? structuredClone(s.desiredConfig)
          : JSON.parse(JSON.stringify(s.desiredConfig));

      dispatch({
        type: "initialize_success",
        payload: { engineInfo: info, activeConfig: activeSnapshot },
      });

      return true;
    } catch (e) {
      if (!aliveRef.current || initSeqRef.current !== mySeq) return false;

      const msg = e instanceof Error ? e.message : String(e);
      dispatch({
        type: "initialize_error",
        payload: `Engine initialization failed: ${msg}`,
      });
      return false;
    }
  }, []);

  const shutdown = useCallback(async (): Promise<void> => {
    // ★ in-flight initialize を無効化
    initSeqRef.current++;

    try {
      await engineInitializer.shutdown();
    } catch {
      // 継続優先
    } finally {
      if (aliveRef.current) dispatch({ type: "shutdown" });
    }
  }, []);

  const restart = useCallback(async (): Promise<boolean> => {
    await shutdown();
    return await initialize();
  }, [shutdown, initialize]);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  // Provider が unmount されたら必ず shutdown（AppLayout から消せる）
  useEffect(() => {
    return () => {
      shutdown().catch(() => {});
    };
  }, [shutdown]);

  // 自動ライフサイクル（AppLayout から完全に排除）
  useEffect(() => {
    // エラーは自動リトライしない（無限ループ防止）
    if (state.phase === "error") return;

    // setup NG → 動いていたら止める
    if (!setupOk) {
      if (state.phase === "ready" || state.phase === "initializing") {
        shutdown().catch(() => {});
      }
      return;
    }

    // ready → needsRestart なら再起動
    if (state.phase === "ready") {
      if (state.needsRestart) restart().catch(() => {});
      return;
    }

    // configured → initialize
    if (state.phase !== "initializing") {
      initialize().catch(() => {});
    }
  }, [setupOk, state.phase, state.needsRestart, initialize, restart, shutdown]);

  const value = useMemo<EngineContextType>(
    () => ({
      state,
      isReady,
      isConfigured: isConfiguredFlag,
      setupOk,
      resolvedPaths,
      aiRootIndex,
      engineSetupCheck,
      validation,

      refreshAiRootIndex,
      recheckSetup,

      setAiRoot,
      setSelectedAiName,
      setSelectedEngineRel,
      setEvalDirName,
      setBookDirName,
      setBookFileName,
      mergeOptions,

      initialize,
      shutdown,
      restart,
      clearError,
    }),
    [
      state,
      isReady,
      isConfiguredFlag,
      setupOk,
      resolvedPaths,
      aiRootIndex,
      engineSetupCheck,
      validation,
      refreshAiRootIndex,
      recheckSetup,
      setAiRoot,
      setSelectedAiName,
      setSelectedEngineRel,
      setEvalDirName,
      setBookDirName,
      setBookFileName,
      mergeOptions,
      initialize,
      shutdown,
      restart,
      clearError,
    ],
  );

  return (
    <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
  );
};

export const useEngine = () => {
  const context = useContext(EngineContext);
  if (!context) throw new Error("useEngine must be used within EngineProvider");
  return context;
};

export default EngineProvider;
