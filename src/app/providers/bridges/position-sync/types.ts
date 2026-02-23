export interface PositionSyncContextType {
  currentSfen: string | null;

  syncedSfen: string | null;

  syncPosition: () => Promise<void>;

  isPositionSynced: boolean;
  syncError: string | null;
}
