import type { RequestId } from "../api/ids";
import type {
  Action,
  FilePathById,
  MergeFilesInput,
  SearchSession,
  SearchState,
} from "./types";

export const initialState: SearchState = {
  index: {
    state: "Empty",
    dirtyCount: 0,
    indexedFiles: 0,
    totalFiles: 0,
    currentPath: null,
  },
  warns: [],
  filePathById: {},

  isOpeningProject: false,
  lastOpenedRootDir: null,
  lastOpenResult: null,
  openError: null,

  isSearching: false,
  currentRequestId: null,
  sessions: {},
};

function ensureSession(
  sessions: Record<number, SearchSession>,
  requestId: RequestId,
): Record<number, SearchSession> {
  if (sessions[requestId]) return sessions;
  return {
    ...sessions,
    [requestId]: {
      requestId,
      stale: false,
      isDone: false,
      error: null,
      hits: [],
      startedAt: Date.now(),
      endedAt: null,
    },
  };
}

function mergeFiles(base: FilePathById, files: MergeFilesInput): FilePathById {
  if (!files.length) return base;

  let changed = false;
  const next: FilePathById = { ...base };

  for (const f of files) {
    const prev = next[f.file_id];
    if (prev !== f.abs_path) {
      next[f.file_id] = f.abs_path;
      changed = true;
    }
  }

  return changed ? next : base;
}

export function reducer(state: SearchState, action: Action): SearchState {
  switch (action.type) {
    // ===== index events =====
    case "index_state": {
      const p = action.payload;
      return {
        ...state,
        index: {
          ...state.index,
          state: p.state,
          dirtyCount: p.dirty_count,
          indexedFiles: p.indexed_files,
          totalFiles: p.total_files,
        },
      };
    }

    case "index_progress": {
      const p = action.payload;
      return {
        ...state,
        index: {
          ...state.index,
          currentPath: p.current_path,
        },
      };
    }

    case "index_warn":
      return {
        ...state,
        warns: [...state.warns.slice(-199), action.payload],
      };

    case "clear_warns":
      return { ...state, warns: [] };

    // ===== open project lifecycle =====
    case "open_start":
      return {
        ...state,
        isOpeningProject: true,
        lastOpenedRootDir: action.payload.rootDir,
        openError: null,
        lastOpenResult: null,
        filePathById: {},
        isSearching: false,
        currentRequestId: null,
        sessions: {},
      };

    case "open_ok":
      return {
        ...state,
        isOpeningProject: false,
        lastOpenedRootDir: action.payload.rootDir,
        lastOpenResult: action.payload.out,
        openError: null,
      };

    case "open_error":
      return {
        ...state,
        isOpeningProject: false,
        openError: action.payload.message,
      };

    // ===== search events =====
    case "search_begin": {
      const p = action.payload;
      const sessions = ensureSession(state.sessions, p.request_id);
      const s = sessions[p.request_id]!;
      return {
        ...state,
        isSearching: true,
        currentRequestId: p.request_id,
        sessions: {
          ...sessions,
          [p.request_id]: {
            ...s,
            stale: p.stale,
            isDone: false,
            error: null,
            startedAt: s.startedAt || Date.now(),
            endedAt: null,
          },
        },
      };
    }

    case "search_chunk": {
      const p = action.payload;
      const sessions = ensureSession(state.sessions, p.request_id);
      const s = sessions[p.request_id]!;
      return {
        ...state,
        currentRequestId: state.currentRequestId ?? p.request_id,
        filePathById: mergeFiles(state.filePathById, p.files),
        sessions: {
          ...sessions,
          [p.request_id]: {
            ...s,
            hits: [...s.hits, ...p.chunk],
          },
        },
      };
    }

    case "search_end": {
      const p = action.payload;
      const sessions = ensureSession(state.sessions, p.request_id);
      const s = sessions[p.request_id]!;
      const isCurrent = state.currentRequestId === p.request_id;

      return {
        ...state,
        isSearching: isCurrent ? false : state.isSearching,
        sessions: {
          ...sessions,
          [p.request_id]: {
            ...s,
            isDone: true,
            endedAt: Date.now(),
          },
        },
      };
    }

    case "search_error": {
      const p = action.payload;
      const sessions = ensureSession(state.sessions, p.request_id);
      const s = sessions[p.request_id]!;
      const isCurrent = state.currentRequestId === p.request_id;

      return {
        ...state,
        isSearching: isCurrent ? false : state.isSearching,
        sessions: {
          ...sessions,
          [p.request_id]: {
            ...s,
            error: p.message,
            isDone: true,
            endedAt: Date.now(),
          },
        },
      };
    }

    case "clear_search": {
      const rid = action.payload?.requestId;
      if (rid == null) {
        return {
          ...state,
          isSearching: false,
          currentRequestId: null,
          sessions: {},
        };
      }

      const next = { ...state.sessions };
      delete next[rid];

      const currentRequestId =
        state.currentRequestId === rid ? null : state.currentRequestId;

      return {
        ...state,
        isSearching: currentRequestId ? state.isSearching : false,
        currentRequestId,
        sessions: next,
      };
    }

    default:
      return state;
  }
}
