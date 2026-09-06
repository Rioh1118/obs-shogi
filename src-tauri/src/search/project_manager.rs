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
use crate::search::read::fs_scan::{
    diff_snapshot, scan_kifu_files, snapshot_from_records, FileRecord, ScanOptions, ScanSnapshot,
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
    /// いま据わっているプロジェクトの代。**索引の代と同じ値。**
    ///
    /// `IndexStore` の代は索引だけを守る。帳簿（`root_dir` / `scan` /
    /// `path_to_id` / `next_file_id`）と watcher が代を持たないと、
    /// **索引は新しいプロジェクトのもの・帳簿は前のもの**という組が作れる
    /// ——全件構築は最後の関門を通った後に帳簿を据えるので、その間に
    /// 2回目の `open` が入るとそうなる。そのあとの差分適用は
    /// 「索引の代」を拾うので関門を素通りし、**前のプロジェクトの `file_id` で
    /// 新しい索引に墓標を打つ**。`run_rescan_diff_apply` の doc が
    /// 「守らないと起きる」と書いている当のもの。
    ///
    /// 0 は「まだ何も据わっていない」。代は 1 から増える（`IndexStore::take_epoch`）。
    epoch: u64,

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

    /// 構築し終えた帳簿を据える。**自分の代のものだけ。**
    ///
    /// `epoch` は `IndexStore::restart` / `install_restored` が返した値。
    /// **据えられたかを返す**——据えなかったら、呼び手も watcher の起動と
    /// checkpoint を飛ばすこと。据えないのに続けると、新しいプロジェクトの
    /// 根を前のプロジェクトの watcher が見張る。
    pub async fn install_after_full_build(
        &self,
        epoch: u64,
        root_dir: PathBuf,
        scan: ScanSnapshot,
        path_to_id: HashMap<String, FileId>,
        next_file_id: FileId,
    ) -> bool {
        let mut g = self.inner.lock().await;
        // **古い代は据えない。** 代は増えるだけなので、自分より新しいものが
        // 既に据わっていれば、この構築はもう誰のものでもない
        if epoch < g.epoch {
            log::info!("[project] 据え直された後の構築なので帳簿を据えない（epoch={epoch}）");
            return false;
        }
        g.epoch = epoch;
        g.root_dir = Some(root_dir);
        g.scan = scan;
        g.path_to_id = path_to_id;
        g.next_file_id = next_file_id;
        true
    }

    /// ファイル監視と、静穏をまとめる debounce ループを起こす。
    ///
    /// **代を持ち回る。** watcher を作るのに時間が要り、その間に据え直されうる。
    /// 代を見ないと、**古い呼び手が新しい watcher を破棄して自分のものを据える**
    /// ——新しいワークスペースの変更が二度と拾われなくなり、画面は黙る。
    ///
    /// 据え直されていたら何もしない。`Ok` を返すのは、呼び手にとって
    /// 「起こせなかった」ではなく「起こす相手がもう居ない」だから。
    pub async fn start_watcher_and_debounce(
        self: Arc<Self>,
        app: AppHandle,
        store: Arc<IndexStore>,
        quiet: Duration,
        epoch: u64,
    ) -> Result<(), String> {
        // 既存タスク停止＆watcher破棄
        let root = {
            let mut g = self.inner.lock().await;
            // **壊す手前で見る。** ここを飛ばすと、据え直された後の呼び手が
            // 新しいプロジェクトの watcher を落として帰る
            if epoch != g.epoch {
                return Ok(());
            }
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
            // 作っている間に据え直されていたら、据えずに落とす
            if epoch != g.epoch {
                return Ok(());
            }
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
        // 据え直されていたら、起こしたループを自分で畳む。据えると
        // 新しいプロジェクトの debounce を落とす
        if epoch != g.epoch {
            handle.abort();
            return Ok(());
        }
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
        // **代は帳簿から読む。** 索引から拾うと、帳簿と索引が別のプロジェクトの
        // 組でも関門を素通りする——前のプロジェクトの `path_to_id` の `file_id` で
        // 新しい索引に墓標を打つことになる。帳簿から読めば、以後の
        // `update_if_epoch` が「帳簿と索引が同じ代」を式で確かめることになる
        let epoch = self.inner.lock().await.epoch;
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

        let next_scan = snapshot_from_records(&root, records.clone());
        let diff = diff_snapshot(&prev_scan, &next_scan);
        let snap = store.snapshot();

        let dirty_count = (diff.added.len() + diff.modified.len() + diff.removed.len()) as u32;
        if dirty_count == 0 {
            // 変化なし：scanだけ更新して終了。**代が変わっていたら書かない**
            let mut g = self.inner.lock().await;
            if epoch != g.epoch {
                return;
            }
            g.scan = next_scan;
            return;
        }

        // state=Updating（クエリは stale=true になる）
        if !commit(&|s: &IndexSnapshot| s.with_state(StoreIndexState::Updating)) {
            return;
        }
        let _ = app.emit(
            EVT_INDEX_STATE,
            IndexStatePayload {
                state: IndexState::Updating,
                dirty_count,
                indexed_files: 0,
                total_files: next_scan.by_path.len() as u32,
            },
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
            IndexStatePayload {
                state: IndexState::Ready,
                dirty_count: 0,
                indexed_files: 0,
                total_files: next_scan.by_path.len() as u32,
            },
        );

        // プロジェクト状態をコミット。**索引と同じ関門を通す**
        // ——ここを飛ばすと、索引は書けなかったのに帳簿だけが進む
        let mut g = self.inner.lock().await;
        if epoch != g.epoch {
            log::warn!("[rescan] 据え直されたので帳簿の書き戻しをやめる");
            return;
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ledger() -> ProjectManager {
        ProjectManager::new()
    }

    /// **据え直された後の構築が、帳簿を奪い返さないこと。**
    ///
    /// 全件構築は索引の最後の関門を通った後に帳簿を据える。その間に2回目の
    /// `open` が入ると、索引は新しいプロジェクトのもの・帳簿は前のものになる。
    /// そのあとの差分適用は帳簿から代を読むので、**帳簿が古いままだと
    /// 前のプロジェクトの `file_id` で新しい索引に墓標を打つ**。
    #[tokio::test]
    async fn a_build_from_a_previous_project_does_not_take_the_ledger_back() {
        let pm = ledger();

        assert!(
            pm.install_after_full_build(
                2,
                PathBuf::from("/b"),
                ScanSnapshot::default(),
                HashMap::new(),
                1
            )
            .await,
            "新しい代の構築を据えていない"
        );
        assert!(
            !pm.install_after_full_build(
                1,
                PathBuf::from("/a"),
                ScanSnapshot::default(),
                HashMap::new(),
                1
            )
            .await,
            "据え直された後の構築が帳簿を奪い返した"
        );

        let g = pm.inner.lock().await;
        assert_eq!(g.epoch, 2, "帳簿の代が古い方へ戻っている");
        assert_eq!(
            g.root_dir.as_deref(),
            Some(Path::new("/b")),
            "帳簿の根が前のプロジェクトのものになっている"
        );
    }

    /// **同じ代なら据え直せること。**
    ///
    /// 復元 → 差分適用 のように、同じプロジェクトが2度据えることがある。
    /// ここを弾くと、復元した索引に差分が二度と当たらなくなる。
    #[tokio::test]
    async fn the_same_project_can_install_twice() {
        let pm = ledger();
        assert!(
            pm.install_after_full_build(
                3,
                PathBuf::from("/a"),
                ScanSnapshot::default(),
                HashMap::new(),
                1
            )
            .await
        );
        assert!(
            pm.install_after_full_build(
                3,
                PathBuf::from("/a"),
                ScanSnapshot::default(),
                HashMap::new(),
                9
            )
            .await,
            "同じ代の据え直しを弾いている"
        );
        assert_eq!(pm.inner.lock().await.next_file_id, 9);
    }
}
