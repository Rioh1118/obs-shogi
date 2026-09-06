use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};
use tokio::{sync::Mutex, task, time};

use crate::search::announce::{
    announce_progress, announce_state, build_failure, warn_scan_failed, warn_unreadable,
    IndexAnnouncement, IndexProgress, IndexSurvival, RescanOutcome,
};
use crate::search::index::file_build::build_file_index;
use crate::search::read::fs_scan::{
    carry_over_unreadable, diff_snapshot, scan_kifu_files, snapshot_from_records, FileRecord,
    ScanError, ScanOptions, ScanSnapshot,
};
use crate::search::store::bucket::{empty_buckets, BucketEntries, FileBucketEntries};
use crate::search::store::index_store::IndexStore;
use crate::search::store::node_table::NodeTable;
use crate::search::store::snapshot::{IndexSnapshot, IndexState as StoreIndexState};
use crate::search::types::{
    FileEntry, FileId, IndexProgressPayload, IndexWarnPayload, EVT_INDEX_PROGRESS, EVT_INDEX_WARN,
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
                        // **結末を捨てない。** 捨てると、読めない場所がまだあるのに
                        // 緑の「準備完了」が出る（旗を知っているのは結末だけ）
                        let outcome = pm.run_rescan_diff_apply(app.clone(), store.clone()).await;
                        // **自分の代を渡す。** いま store に載っている代を読み直すと、
                        // 据え直された直後でも必ず一致するので照合が素通りし、
                        // **他人の索引の件数**を自分の結末として出す
                        announce_state(&app, &store, epoch, IndexAnnouncement::Rescanned(outcome));

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
    pub async fn run_rescan_diff_apply(
        &self,
        app: AppHandle,
        store: Arc<IndexStore>,
    ) -> RescanOutcome {
        // **代は帳簿から読む。** 索引から拾うと、帳簿と索引が別のプロジェクトの
        // 組でも関門を素通りする——前のプロジェクトの `path_to_id` の `file_id` で
        // 新しい索引に墓標を打つことになる。帳簿から読めば、以後の
        // `update_if_epoch` が「帳簿と索引が同じ代」を式で確かめることになる
        // **代と帳簿の中身を1回のロックで取る。** 別々に取ると、その間に
        // `install_after_full_build` が挟まって「代は N・根は N+1」という組になる。
        // 壊れはしないが、新しいワークスペースの全走査が丸ごと空振りする
        let (epoch, root, prev_scan, mut path_to_id, mut next_file_id) = {
            let g = self.inner.lock().await;
            let Some(root) = g.root_dir.clone() else {
                // 据え直しの最中。この走査はもう誰のものでもない
                return RescanOutcome::Superseded;
            };
            (
                g.epoch,
                root,
                g.scan.clone(),
                g.path_to_id.clone(),
                g.next_file_id,
            )
        };
        let commit = |f: &dyn Fn(&IndexSnapshot) -> IndexSnapshot| -> bool {
            if store.update_if_epoch(epoch, f) {
                return true;
            }
            log::warn!("[rescan] 索引が別の代に差し替わったので、差分の取り込みをやめる");
            false
        };

        // 再スキャン（雑にフルスキャンでOK：notify取りこぼしも補正できる）。
        // **`spawn_blocking` へ逃がす。** ファイル1件ごとに `metadata` の syscall を
        // 回すので、大きなワークスペースでは秒の単位で tokio のワーカーを1本握る。
        // ここは debounce のタスクの中なので、逃がさないと watcher の
        // イベント処理まで止まる
        let scan_root = root.clone();
        let joined = tauri::async_runtime::spawn_blocking(move || {
            scan_kifu_files(&scan_root, &ScanOptions::default())
        })
        .await;
        let scanned = match joined
            .unwrap_or_else(|e| Err(ScanError::Io(std::io::Error::other(e.to_string()))))
        {
            Ok(v) => v,
            Err(e) => {
                // **索引は残っている。** 当たっていないのは差分だけ
                warn_scan_failed(&app, &store, epoch, &root, &e, IndexSurvival::Kept);
                return RescanOutcome::ScanFailed;
            }
        };

        // **読めなかった場所の下は、前回の走査から引き継ぐ。** 引き継がないと
        // そのファイルは削除として索引から消える（読めないのと消えたのは
        // 見分けが付かない）。捨てるだけでも足りない——次回の基準からも落ちるので、
        // 二度と差分に現れなくなる（`carry_over_unreadable` の doc）
        // 完全だったかは `files` を取り出す前に決める。取り出した後は
        // 判断の元が手元に無く、写した式だけが残る（`Scanned::is_partial` の doc）
        let partial = scanned.is_partial();
        let unreadable = scanned.unreadable;
        let unknown_gaps = scanned.unknown_gaps;
        let mut next_scan = snapshot_from_records(&root, scanned.files);
        let carried = carry_over_unreadable(&prev_scan, &mut next_scan, &unreadable);
        let mut diff = diff_snapshot(&prev_scan, &next_scan);

        // **引き継げた件数で言い分ける。** 「読めない場所があったか」ではない
        // ——前回の走査に無かった場所（新しく作られたフォルダ）は引き継げないので、
        // 「前回の索引のまま残ります」と言うとその棋譜は検索に出ないのに残ると読める
        warn_unreadable(
            &app,
            &store,
            epoch,
            &unreadable,
            unknown_gaps,
            &carried,
            IndexSurvival::Kept,
        );
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
            // **索引の代も見る。** この腕は `update_if_epoch` を1度も通らないので、
            // 帳簿だけ見ると素通りする——全件構築の間は「索引は新しい代・帳簿は
            // 前の代」なので、前のワークスペースの watcher が
            // **作りかけの索引に「準備完了」を出す**
            if store.snapshot().epoch != epoch {
                return RescanOutcome::Superseded;
            }
            // 変化なし：scanだけ更新して終了。**代が変わっていたら書かない**
            let mut g = self.inner.lock().await;
            if epoch != g.epoch {
                return RescanOutcome::Superseded;
            }
            g.scan = next_scan;
            return RescanOutcome::Committed {
                partially_unreadable: partial,
            };
        }

        // state=Updating（クエリは stale=true になる）
        if !commit(&|s: &IndexSnapshot| s.with_state(StoreIndexState::Updating)) {
            return RescanOutcome::Superseded;
        }
        announce_progress(
            &app,
            &store,
            epoch,
            IndexProgress::Updating {
                total: next_scan.by_path.len() as u32,
                dirty: dirty_count,
                partially_unreadable: partial,
            },
        );

        let mut done_dirty: u32 = 0;

        // **墓標は1回で立てる。** 理由は `IndexSnapshot::with_tombstones` の doc
        let gone: Vec<FileId> = diff
            .removed
            .iter()
            .filter_map(|path_key| path_to_id.remove(path_key))
            .collect();
        if !gone.is_empty() && !commit(&|s: &IndexSnapshot| s.with_tombstones(&gone)) {
            return RescanOutcome::Superseded;
        }

        // **進捗は間引く。** 理由と間隔は `crate::search::announce::EMIT_INTERVAL` の doc
        let mut last_emit = std::time::Instant::now();
        for path_key in &diff.removed {
            done_dirty += 1;
            if last_emit.elapsed() < crate::search::announce::EMIT_INTERVAL {
                continue;
            }
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                EVT_INDEX_PROGRESS,
                IndexProgressPayload {
                    current_path: path_key.clone(),
                    done_files: done_dirty,
                    total_files: dirty_count,
                },
            );
        }
        // **最後の1回は必ず出す。** 間引きの谷で終わると、進捗が途中の数字のまま止まる
        if !diff.removed.is_empty() {
            let _ = app.emit(
                EVT_INDEX_PROGRESS,
                IndexProgressPayload {
                    current_path: String::new(),
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
            // 削除の側と同じく間引く。フォルダを1つ移すと、移した先は全部
            // `added` になるので件数は同じ桁になる（`crate::search::announce::EMIT_INTERVAL`）
            if last_emit.elapsed() >= crate::search::announce::EMIT_INTERVAL {
                last_emit = std::time::Instant::now();
                let _ = app.emit(
                    EVT_INDEX_PROGRESS,
                    IndexProgressPayload {
                        current_path: path_str,
                        done_files: done_dirty,
                        total_files: dirty_count,
                    },
                );
            }
        }

        // **`commit` ヘルパを通さない。** あれは `&dyn Fn` を取るので閉包が
        // `batch` を消費できず、`clone()` を強いる。閉包に消費させておくと、
        // 束縛を `FnMut` に緩める変更をコンパイラがその場で落とす——`FileBucketEntries` は
        // `[Vec<_>; 256]` を持つので、**書き込みロックの中で**ファイル数 × 256本の
        // `Vec` を確保し直すことになる（`snapshot_cell` の doc どおり、その長さが
        // そのまま検索の読みの待ちになる）
        let wrote = batch.is_empty() || store.update_if_epoch(epoch, move |s| s.with_files(batch));
        if !wrote {
            log::warn!("[rescan] 索引が別の代に差し替わったので、差分の取り込みをやめる");
            return RescanOutcome::Superseded;
        }

        if !commit(&|s: &IndexSnapshot| s.with_state(StoreIndexState::Ready)) {
            return RescanOutcome::Superseded;
        }

        // プロジェクト状態をコミット。**索引と同じ関門を通す**
        // ——ここを飛ばすと、索引は書けなかったのに帳簿だけが進む
        let mut g = self.inner.lock().await;
        if epoch != g.epoch {
            log::warn!("[rescan] 据え直されたので帳簿の書き戻しをやめる");
            return RescanOutcome::Superseded;
        }
        g.scan = next_scan;
        g.path_to_id = path_to_id;
        g.next_file_id = next_file_id;
        RescanOutcome::Committed {
            partially_unreadable: partial,
        }
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
                let _ = app.emit(EVT_INDEX_WARN, IndexWarnPayload::file(path_str, e));
                return None;
            }
            Err(e) => {
                // **理由はログへ。** 画面には内部の綴りを出さない
                log::warn!("[rescan] 索引を組む仕事が落ちた（{path_str}）: {e}");
                let _ = app.emit(
                    EVT_INDEX_WARN,
                    IndexWarnPayload::file(path_str, build_failure()),
                );
                return None;
            }
        };

        for w in warns {
            let _ = app.emit(EVT_INDEX_WARN, IndexWarnPayload::file(path_str.clone(), w));
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
