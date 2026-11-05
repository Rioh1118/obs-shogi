// 公開はモジュールの単位で決める。載せたモジュールの名前は、テストが読むものも barrel を通す
// （`src/__tests__/sliceBarrels.test.ts` が深い import を止める）。`model/reducer` はテストの初期値にしか使わないので公開しない
export { EnginePresetsProvider } from "./model/provider";
export { useEnginePresets } from "./model/useEnginePresets";
export { bookInUse, isPresetConfigured } from "./model/types";
export type {
  AnalysisDefaults,
  EnginePreset,
  EnginePresetsContextType,
  EnginePresetsState,
  PresetId,
  PresetsLoadNotice,
  SaveFailure,
  UsiOptionMap,
} from "./model/types";
export { MULTIPV_MAX, MULTIPV_MIN, MULTIPV_OPTION, QUICK_MULTIPV } from "./model/multiPv";
export { fitSpin, fitValues, parseSpinValue } from "./lib/fitValues";
export type { ClampedValue, DroppedValue, FittedValues } from "./lib/fitValues";
export { hasCurrentDefinitions, probePathOf, storedDefinitions, withDefinitions } from "./lib/withDefinitions";
