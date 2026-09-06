use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};
use tokio::{sync::Mutex, task, time};

use crate::search::index::file_build::build_file_index;
use crate::search::read::diagnosis::unreadable_places;
use crate::search::read::fs_scan::{
    carry_over_unreadable, diff_snapshot, scan_kifu_files, snapshot_from_records, FileRecord,
    ScanOptions, ScanSnapshot,
};
use crate::search::store::bucket::{empty_buckets, BucketEntries, FileBucketEntries};
use crate::search::store::index_store::IndexStore;
use crate::search::store::node_table::NodeTable;
use crate::search::store::snapshot::{IndexSnapshot, IndexState as StoreIndexState};
use crate::search::types::{
    FileEntry, FileId, IndexProgressPayload, IndexState, IndexStatePayload, IndexWarnPayload,
    EVT_INDEX_PROGRESS, EVT_INDEX_STATE, EVT_INDEX_WARN,
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
    /// 走査し直して差分を索引に取り込む。
    ///
    /// **2回目の `open` が来ても、このタスクは止まらない。** 前の `root_dir` と
    /// 前の `scan` を持ったまま、**差し替わった索引に書く**ことになる。
    /// だから索引への書き込みは全部 `update_if_epoch` を通し、
    /// 代が変わっていたら書かずに抜ける。
    ///
    /// 守らないと、前のプロジェクトの `file_id` で墓標を立てて
    /// **別の棋譜のヒットが黙って消える**し、構築中の索引を `Ready` に上げて
    /// **半分しか入っていない結果が「最新」として画面に並ぶ**。
    pub async fn run_rescan_diff_apply(&self, app: AppHandle, store: Arc<IndexStore>) {
        // 走り出したときの代。以後の書き込みはこれを持ち回る
        let epoch = store.snapshot().epoch;
        let commit = |f: &dyn Fn(&IndexSnapshot) -> IndexSnapshot| -> bool {
            if store.update_if_epoch(epoch, f) {
                return true;
            }
            log::warn!("[rescan] 索引が別の代に差し替わったので、差分の取り込みをやめる");
            false
        };
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

        // **読めなかった場所の下は、前回の走査から引き継ぐ。** 引き継がないと
        // そのファイルは削除として索引から消える（読めないのと消えたのは
        // 見分けが付かない）。捨てるだけでも足りない——次回の基準からも落ちるので、
        // 二度と差分に現れなくなる（`carry_over_unreadable` の doc）
        // 完全だったかは `files` を取り出す前に決める。取り出した後は
        // 判断の元が手元に無く、写した式だけが残る（`Scanned::is_partial` の doc）
        let partial = records.is_partial();
        let unreadable = records.unreadable;
        let unknown_gaps = records.unknown_gaps;
        let mut next_scan = snapshot_from_records(&root, records.files);
        let carried = carry_over_unreadable(&prev_scan, &mut next_scan, &unreadable);
        let mut diff = diff_snapshot(&prev_scan, &next_scan);

        if partial {
            let _ = app.emit(
                EVT_INDEX_WARN,
                IndexWarnPayload {
                    path: unreadable.first().cloned().unwrap_or_default(),
                    message: unreadable_places(unreadable.len(), unknown_gaps),
                },
            );
        }
        if unknown_gaps {
            // **どこが読めなかったか分からない。** 範囲を絞れないので、この回は
            // 削除を1件も当てない。基準にも前回のものを戻す——戻さないと
            // 次の走査で差分に出せず、二度と削除できなくなる
            for key in &diff.removed {
                if let Some(prev) = prev_scan.by_path.get(key) {
                    next_scan.by_path.insert(key.clone(), prev.clone());
                }
            }
            diff.removed.clear();
        }
        log::debug!(
            "[rescan] 読めない場所の下から {} 件を引き継いだ",
            carried.len()
        );
        let snap = store.snapshot();

        let dirty_count = (diff.added.len() + diff.modified.len() + diff.removed.len()) as u32;
        if dirty_count == 0 {
            // 変化なし：scanだけ更新して終了
            let mut g = self.inner.lock().await;
            g.scan = next_scan;
            return;
        }

        // state=Updating（クエリは stale=true になる）
        if !commit(&|s: &IndexSnapshot| s.with_state(StoreIndexState::Updating)) {
            return;
        }
        let _ = app.emit(
            EVT_INDEX_STATE,
            IndexStatePayload::of(IndexState::Updating, next_scan.by_path.len() as u32)
                .dirty(dirty_count),
        );

        let mut done_dirty: u32 = 0;

        // removed → tombstone (cheap, fire immediately)
        for path_key in &diff.removed {
            if let Some(file_id) = path_to_id.remove(path_key) {
                if !commit(&|s: &IndexSnapshot| s.with_tombstone(file_id)) {
                    return;
                }
            }
            done_dirty += 1;
            let _ = app.emit(
                EVT_INDEX_PROGRESS,
                IndexProgressPayload {
                    current_path: path_key.clone(),
                    done_files: done_dirty,
                    total_files: dirty_count,
                },
            );
        }

        // modified + added → 並列ビルドして 1 回の insert_many にまとめる
        struct PendingBuild {
            rec: FileRecord,
            file_id: FileId,
            new_gen: u32,
        }
        let mut pending: Vec<PendingBuild> = Vec::new();

        for rec in &diff.modified {
            let path_key = crate::search::read::fs_scan::path_key(&rec.path);
            let file_id = match path_to_id.get(&path_key).copied() {
                Some(id) => id,
                None => {
                    let id = next_file_id;
                    next_file_id = next_file_id.wrapping_add(1);
                    path_to_id.insert(path_key.clone(), id);
                    id
                }
            };
            let old_gen = snap.file_table.get(file_id).map(|e| e.r#gen).unwrap_or(0);
            let new_gen = old_gen.wrapping_add(1).max(1);
            pending.push(PendingBuild {
                rec: rec.clone(),
                file_id,
                new_gen,
            });
        }

        for rec in &diff.added {
            let path_key = crate::search::read::fs_scan::path_key(&rec.path);
            let file_id = next_file_id;
            next_file_id = next_file_id.wrapping_add(1);
            path_to_id.insert(path_key.clone(), file_id);
            pending.push(PendingBuild {
                rec: rec.clone(),
                file_id,
                new_gen: 1,
            });
        }

        let mut batch: Vec<FileBucketEntries> = Vec::with_capacity(pending.len());
        for pb in pending {
            let path_str = pb.rec.path.to_string_lossy().to_string();
            match self
                .build_one_file(&app, &pb.rec, pb.file_id, pb.new_gen)
                .await
            {
                Some(item) => batch.push(item),
                None => {
                    // build error: still record a tombstone-ish entry so file_table
                    // gets updated and stale segments from the old gen are excluded.
                    let empty: BucketEntries = empty_buckets();
                    batch.push((
                        FileEntry {
                            file_id: pb.file_id,
                            path: path_str.clone(),
                            deleted: false,
                            r#gen: pb.new_gen,
                        },
                        Arc::new(NodeTable::empty()),
                        empty,
                    ));
                }
            }
            done_dirty += 1;
            let _ = app.emit(
                EVT_INDEX_PROGRESS,
                IndexProgressPayload {
                    current_path: path_str,
                    done_files: done_dirty,
                    total_files: dirty_count,
                },
            );
        }

        if !batch.is_empty() && !commit(&|s: &IndexSnapshot| s.with_files(batch.clone())) {
            return;
        }

        if !commit(&|s: &IndexSnapshot| s.with_state(StoreIndexState::Ready)) {
            return;
        }
        let _ = app.emit(
            EVT_INDEX_STATE,
            IndexStatePayload::of(IndexState::Ready, next_scan.by_path.len() as u32),
        );

        // プロジェクト状態をコミット
        let mut g = self.inner.lock().await;
        g.scan = next_scan;
        g.path_to_id = path_to_id;
        g.next_file_id = next_file_id;
    }

    /// 1ファイル分の構築を `spawn_blocking` で行い、`store` に直接書かずに
    /// `FileBucketEntries` を返す。呼び手が束ねて `with_files` を1回呼ぶ用。
    async fn build_one_file(
        &self,
        app: &AppHandle,
        rec: &FileRecord,
        file_id: FileId,
        new_gen: u32,
    ) -> Option<FileBucketEntries> {
        let path_str = rec.path.to_string_lossy().to_string();
        let rec_cloned = rec.clone();

        let built = task::spawn_blocking(
            move || -> Result<(BucketEntries, Arc<NodeTable>, Vec<String>), String> {
                let built = build_file_index(&rec_cloned, file_id, new_gen)?;
                Ok((built.by_bucket, built.node_table, built.warns))
            },
        )
        .await;

        let (by_bucket, node_table, warns) = match built {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                let _ = app.emit(
                    EVT_INDEX_WARN,
                    IndexWarnPayload {
                        path: path_str,
                        message: e,
                    },
                );
                return None;
            }
            Err(e) => {
                let _ = app.emit(
                    EVT_INDEX_WARN,
                    IndexWarnPayload {
                        path: path_str,
                        message: format!("spawn_blocking join error: {e}"),
                    },
                );
                return None;
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

        Some((
            FileEntry {
                file_id,
                path: path_str,
                deleted: false,
                r#gen: new_gen,
            },
            node_table,
            by_bucket,
        ))
    }
}
