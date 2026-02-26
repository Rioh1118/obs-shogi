use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};
use tokio::{sync::Mutex, task, time};

use crate::search::{
    fs_scan::{
        diff_snapshot, scan_kifu_files, snapshot_from_records, FileRecord, ScanOptions,
        ScanSnapshot,
    },
    index_builder::{bucketize_entries, build_index_for_jkf, BuildPolicy},
    index_store::{IndexState as StoreIndexState, IndexStore},
    kifu_reader::read_to_jkf,
    node_table::NodeTable,
    types::{
        FileEntry, FileId, IndexState, IndexStatePayload, IndexWarnPayload, Occurrence,
        EVT_INDEX_STATE, EVT_INDEX_WARN,
    },
};

#[derive(Debug, Default)]
struct Inner {
    root_dir: Option<PathBuf>,
    scan: ScanSnapshot,

    path_to_id: HashMap<String, FileId>,
    next_file_id: FileId,

    watcher: Option<RecommendedWatcher>,
    debounce_task: Option<task::JoinHandle<()>>,
}

#[derive(Debug, Default)]
pub struct ProjectManager {
    inner: Mutex<Inner>,
}

impl ProjectManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
        }
    }

    pub async fn install_after_full_build(
        &self,
        root_dir: PathBuf,
        scan: ScanSnapshot,
        path_to_id: HashMap<String, FileId>,
        next_file_id: FileId,
    ) {
        let mut g = self.inner.lock().await;
        g.root_dir = Some(root_dir);
        g.scan = scan;
        g.path_to_id = path_to_id;
        g.next_file_id = next_file_id;
    }

    pub async fn start_watcher_and_debounce(
        self: Arc<Self>,
        app: AppHandle,
        store: Arc<IndexStore>,
        quiet: Duration,
    ) -> Result<(), String> {
        // 既存タスク停止＆watcher破棄
        let root = {
            let mut g = self.inner.lock().await;
            if let Some(h) = g.debounce_task.take() {
                h.abort();
            }
            g.watcher.take();

            g.root_dir.clone().ok_or("project root_dir is not set")?
        };

        // notify → tokio へ橋渡し
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<PathBuf>();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                for p in ev.paths {
                    let _ = tx.send(p);
                }
            }
        })
        .map_err(|e| e.to_string())?;

        watcher
            .watch(Path::new(&root), RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        // watcher を保持（drop したら止まる）
        {
            let mut g = self.inner.lock().await;
            g.watcher = Some(watcher);
        }

        // Debounce loop
        let pm = self.clone();
        let handle = task::spawn(async move {
            let mut dirty_paths: HashSet<PathBuf> = HashSet::new();

            // 適当な遠い sleep を置いて、イベント受信で reset する
            let sleep = time::sleep(Duration::from_secs(3600));
            tokio::pin!(sleep);

            loop {
                tokio::select! {
                    p = rx.recv() => {
                        let Some(p) = p else { break; };
                        dirty_paths.insert(p);
                        // 静穏時間を延長
                        sleep.as_mut().reset(time::Instant::now() + quiet);
                    }
                    _ = &mut sleep => {
                        if dirty_paths.is_empty() {
                            // 何もなければまた遠い sleep
                            sleep.as_mut().reset(time::Instant::now() + Duration::from_secs(3600));
                            continue;
                        }

                        // “dirty集合のスナップショットを切る”
                        dirty_paths.clear();

                        // Step2: 差分更新（フル再スキャン→diff→適用）
                        pm.run_rescan_diff_apply(app.clone(), store.clone()).await;

                        // 次のイベントを待つ
                        sleep.as_mut().reset(time::Instant::now() + Duration::from_secs(3600));
                    }
                }
            }
        });

        let mut g = self.inner.lock().await;
        g.debounce_task = Some(handle);

        Ok(())
    }

    /// Step2本体：scan -> diff -> apply
    pub async fn run_rescan_diff_apply(&self, app: AppHandle, store: Arc<IndexStore>) {
        // プロジェクト情報を “cloneして” 取り出す（ロックを await に跨がない）
        let (root, prev_scan, mut path_to_id, mut next_file_id) = {
            let g = self.inner.lock().await;
            let Some(root) = g.root_dir.clone() else {
                return;
            };
            (root, g.scan.clone(), g.path_to_id.clone(), g.next_file_id)
        };

        // 再スキャン（雑にフルスキャンでOK：notify取りこぼしも補正できる）
        let records = match scan_kifu_files(&root, &ScanOptions::default()) {
            Ok(v) => v,
            Err(e) => {
                let _ = app.emit(
                    EVT_INDEX_WARN,
                    IndexWarnPayload {
                        path: root.to_string_lossy().to_string(),
                        message: format!("scan failed: {e}"),
                    },
                );
                return;
            }
        };

        let next_scan = snapshot_from_records(&root, records.clone());
        let diff = diff_snapshot(&prev_scan, &next_scan);
        let snap = store.snapshot();

        let dirty_count = (diff.added.len() + diff.modified.len() + diff.removed.len()) as u32;
        if dirty_count == 0 {
            // 変化なし：scanだけ更新して終了
            let mut g = self.inner.lock().await;
            g.scan = next_scan;
            return;
        }

        // state=Updating（クエリは stale=true になる）
        store.set_state(StoreIndexState::Updating);
        let _ = app.emit(
            EVT_INDEX_STATE,
            IndexStatePayload {
                state: IndexState::Updating,
                dirty_count,
                indexed_files: 0,
                total_files: next_scan.by_path.len() as u32,
            },
        );

        // removed → tombstone
        for path_key in &diff.removed {
            if let Some(file_id) = path_to_id.remove(path_key) {
                store.tombstone_file(file_id);
            }
        }

        // modified → 同じfile_idでgen++して再インデックス
        for rec in &diff.modified {
            let path_key = crate::search::fs_scan::path_key(&rec.path);
            let file_id = match path_to_id.get(&path_key).copied() {
                Some(id) => id,
                None => {
                    // マップに無いなら added 相当として扱う
                    let id = next_file_id;
                    next_file_id = next_file_id.wrapping_add(1);
                    path_to_id.insert(path_key.clone(), id);
                    id
                }
            };

            let old_gen = snap.file_table.get(file_id).map(|e| e.gen).unwrap_or(0);

            let new_gen = old_gen.wrapping_add(1).max(1);

            self.reindex_one_file(&app, &store, rec, file_id, new_gen)
                .await;
        }

        // added → 新規file_id, gen=1
        for rec in &diff.added {
            let path_key = crate::search::fs_scan::path_key(&rec.path);
            let file_id = next_file_id;
            next_file_id = next_file_id.wrapping_add(1);
            path_to_id.insert(path_key.clone(), file_id);

            self.reindex_one_file(&app, &store, rec, file_id, 1).await;
        }

        // Updating → Ready
        store.set_state(StoreIndexState::Ready);
        let _ = app.emit(
            EVT_INDEX_STATE,
            IndexStatePayload {
                state: IndexState::Ready,
                dirty_count: 0,
                indexed_files: 0,
                total_files: next_scan.by_path.len() as u32,
            },
        );

        // プロジェクト状態をコミット
        let mut g = self.inner.lock().await;
        g.scan = next_scan;
        g.path_to_id = path_to_id;
        g.next_file_id = next_file_id;
    }

    async fn reindex_one_file(
        &self,
        app: &AppHandle,
        store: &Arc<IndexStore>,
        rec: &FileRecord,
        file_id: FileId,
        gen: u32,
    ) {
        type BucketEntries = [Vec<(crate::search::position_key::PositionKey, Occurrence)>; 256];

        let path_str = rec.path.to_string_lossy().to_string();
        let rec_cloned = rec.clone();

        let built = task::spawn_blocking(
            move || -> Result<(BucketEntries, Arc<NodeTable>, Vec<String>), String> {
                let jkf = read_to_jkf(&rec_cloned).map_err(|e| e.to_string())?;
                let b = build_index_for_jkf(file_id, gen, &jkf, BuildPolicy::Loose)
                    .map_err(|e| e.to_string())?;

                let by_bucket: BucketEntries = bucketize_entries(b.entries);

                let warns = b
                    .warns
                    .into_iter()
                    .map(|w| format!("{:?}: {}", w.cursor, w.message))
                    .collect::<Vec<_>>();

                Ok((by_bucket, b.node_table, warns))
            },
        )
        .await;

        let (by_bucket, node_table, warns) = match built {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                let empty: BucketEntries = std::array::from_fn(|_| Vec::new());

                store.insert_file_segments(
                    FileEntry {
                        file_id,
                        path: path_str.clone(),
                        deleted: false,
                        gen,
                    },
                    Arc::new(NodeTable::empty()),
                    empty,
                );

                let _ = app.emit(
                    EVT_INDEX_WARN,
                    IndexWarnPayload {
                        path: path_str,
                        message: e,
                    },
                );
                return;
            }
            Err(e) => {
                let _ = app.emit(
                    EVT_INDEX_WARN,
                    IndexWarnPayload {
                        path: path_str,
                        message: format!("spawn_blocking join error: {e}"),
                    },
                );
                return;
            }
        };

        for w in warns {
            let _ = app.emit(
                EVT_INDEX_WARN,
                IndexWarnPayload {
                    path: path_str.clone(),
                    message: w,
                },
            );
        }

        store.insert_file_segments(
            FileEntry {
                file_id,
                path: path_str,
                deleted: false,
                gen,
            },
            node_table,
            by_bucket,
        );
    }
}
