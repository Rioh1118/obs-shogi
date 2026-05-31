//! 局面検索ベンチマーク
//!
//! 実行: cd src-tauri && cargo test --release --test search_bench -- --nocapture
//!
//! ~/Desktop/temp をルートとして、以下を計測する:
//!   1. FS 走査 (scan_kifu_files)
//!   2. 全ファイル JKF パース
//!   3. フルビルド (index_builder)
//!   4. Segment 構築 + バケット分割
//!   5. 検索 (search_occurrences_by_key)
//!   6. Compaction (k-way merge)
//!   7. キャッシュ encode/decode (zstd 込み)
//!   8. メモリ使用量推定
//!   9. 差分検知 (diff_snapshot)

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use app_lib::search::{
    file_table::FileTable,
    fs_scan::{diff_snapshot, scan_kifu_files, snapshot_from_records, ScanOptions},
    index_builder::{bucketize_entries, build_index_for_jkf, BuildPolicy},
    index_store::{IndexSnapshot, IndexState, NodeTables},
    kifu_reader::read_to_jkf,
    position_key::{key_from_partial_position, PositionKey},
    segment::{Segment, SegmentArc},
    sfen_position::partial_position_from_sfen,
    types::{FileEntry, Occurrence},
};

const ROOT: &str = env!("HOME");

fn root_dir() -> PathBuf {
    PathBuf::from(ROOT).join("Desktop/temp")
}

// ============================================================
// Helpers
// ============================================================

struct BuildResult {
    file_table: FileTable,
    node_tables: NodeTables,
    buckets: [Vec<SegmentArc>; 256],
    total_entries: usize,
    total_nodes: usize,
    file_count: usize,
    per_file_stats: Vec<FileStats>,
}

struct FileStats {
    path: String,
    nodes: usize,
    entries: usize,
    parse_us: u128,
    build_us: u128,
    size_bytes: u64,
}

fn do_full_build(records: &[app_lib::search::fs_scan::FileRecord]) -> BuildResult {
    let mut ft = FileTable::default();
    let mut nts = NodeTables::default();
    let mut buckets: [Vec<SegmentArc>; 256] = std::array::from_fn(|_| Vec::new());

    let mut total_entries = 0usize;
    let mut total_nodes = 0usize;
    let mut per_file: Vec<FileStats> = Vec::new();

    for (i, rec) in records.iter().enumerate() {
        let file_id = (i as u32) + 1;
        let gen = 1u32;

        let t_parse = Instant::now();
        let jkf = match read_to_jkf(rec) {
            Ok(j) => j,
            Err(e) => {
                eprintln!("  SKIP {}: {e}", rec.path.display());
                continue;
            }
        };
        let parse_us = t_parse.elapsed().as_micros();

        let t_build = Instant::now();
        let built = match build_index_for_jkf(file_id, gen, &jkf, BuildPolicy::Loose) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("  BUILD ERR {}: {e}", rec.path.display());
                continue;
            }
        };
        let n_entries = built.entries.len();
        let n_nodes = built.node_table.nodes.len();

        let by_bucket = bucketize_entries(built.entries);
        let build_us = t_build.elapsed().as_micros();

        ft.upsert(FileEntry {
            file_id,
            path: rec.path.to_string_lossy().to_string(),
            deleted: false,
            gen,
        });
        nts.upsert(file_id, built.node_table);

        for (b, v) in by_bucket.into_iter().enumerate() {
            if !v.is_empty() {
                buckets[b].push(Arc::new(Segment::new_sorted(v)));
            }
        }

        total_entries += n_entries;
        total_nodes += n_nodes;

        per_file.push(FileStats {
            path: rec.path.to_string_lossy().to_string(),
            nodes: n_nodes,
            entries: n_entries,
            parse_us,
            build_us,
            size_bytes: rec.size,
        });
    }

    BuildResult {
        file_table: ft,
        node_tables: nts,
        buckets,
        total_entries,
        total_nodes,
        file_count: per_file.len(),
        per_file_stats: per_file,
    }
}

// ============================================================
// Tests
// ============================================================

#[test]
fn bench_01_fs_scan() {
    let root = root_dir();
    if !root.exists() {
        eprintln!("SKIP: {} does not exist", root.display());
        return;
    }

    println!("\n========== 1. FS SCAN ==========");
    println!("root: {}", root.display());

    let opts = ScanOptions::default();

    // 3回計測
    let mut times = Vec::new();
    let mut records = Vec::new();
    for _ in 0..3 {
        let t = Instant::now();
        records = scan_kifu_files(&root, &opts).unwrap();
        times.push(t.elapsed());
    }

    println!("files found: {}", records.len());
    let total_bytes: u64 = records.iter().map(|r| r.size).sum();
    println!("total size: {:.2} MB", total_bytes as f64 / 1024.0 / 1024.0);

    for (i, d) in times.iter().enumerate() {
        println!("  run {}: {:.3} ms", i + 1, d.as_secs_f64() * 1000.0);
    }
    let avg = times.iter().map(|d| d.as_secs_f64()).sum::<f64>() / times.len() as f64;
    println!("  avg: {:.3} ms", avg * 1000.0);
}

#[test]
fn bench_02_parse_all() {
    let root = root_dir();
    if !root.exists() {
        return;
    }

    println!("\n========== 2. JKF PARSE (all files) ==========");

    let records = scan_kifu_files(&root, &ScanOptions::default()).unwrap();
    let mut ok_count = 0u32;
    let mut err_count = 0u32;
    let mut total_nodes = 0usize;

    let t = Instant::now();
    for rec in &records {
        match read_to_jkf(rec) {
            Ok(jkf) => {
                ok_count += 1;
                total_nodes += jkf.moves.len();
            }
            Err(_) => {
                err_count += 1;
            }
        }
    }
    let elapsed = t.elapsed();

    println!("parsed OK: {ok_count}, ERR: {err_count}");
    println!("total JKF nodes (moves array len): {total_nodes}");
    println!("elapsed: {:.3} ms", elapsed.as_secs_f64() * 1000.0);
    if ok_count > 0 {
        println!(
            "avg per file: {:.3} ms",
            elapsed.as_secs_f64() * 1000.0 / ok_count as f64
        );
    }

    // bug_mega.kif 単体
    if let Some(mega) = records.iter().find(|r| {
        r.path
            .file_name()
            .map(|n| n.to_string_lossy().contains("bug_mega"))
            .unwrap_or(false)
    }) {
        let t2 = Instant::now();
        let jkf = read_to_jkf(mega).unwrap();
        let d2 = t2.elapsed();
        println!(
            "\nbug_mega.kif: size={:.1} KB, moves={}, parse={:.3} ms",
            mega.size as f64 / 1024.0,
            jkf.moves.len(),
            d2.as_secs_f64() * 1000.0
        );
    }
}

#[test]
fn bench_03_full_build() {
    let root = root_dir();
    if !root.exists() {
        return;
    }

    println!("\n========== 3. FULL BUILD (single-thread) ==========");

    let records = scan_kifu_files(&root, &ScanOptions::default()).unwrap();
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    println!("available parallelism: {cpus} cores");
    println!("files: {}", records.len());

    let t = Instant::now();
    let result = do_full_build(&records);
    let elapsed = t.elapsed();

    println!("indexed files: {}", result.file_count);
    println!("total nodes: {}", result.total_nodes);
    println!("total index entries: {}", result.total_entries);
    println!(
        "elapsed: {:.3} ms ({:.3} s)",
        elapsed.as_secs_f64() * 1000.0,
        elapsed.as_secs_f64()
    );
    if result.file_count > 0 {
        println!(
            "avg per file: {:.3} ms",
            elapsed.as_secs_f64() * 1000.0 / result.file_count as f64
        );
    }

    // top 5 slowest (parse)
    let mut sorted = result.per_file_stats.iter().collect::<Vec<_>>();
    sorted.sort_by(|a, b| (b.parse_us + b.build_us).cmp(&(a.parse_us + a.build_us)));
    println!("\ntop 5 slowest files (parse+build):");
    for s in sorted.iter().take(5) {
        let name = Path::new(&s.path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();
        println!(
            "  {name}: parse={:.3}ms build={:.3}ms nodes={} entries={} size={:.1}KB",
            s.parse_us as f64 / 1000.0,
            s.build_us as f64 / 1000.0,
            s.nodes,
            s.entries,
            s.size_bytes as f64 / 1024.0,
        );
    }

    // bucket distribution
    let mut bucket_sizes: Vec<usize> = result
        .buckets
        .iter()
        .map(|segs| segs.iter().map(|s| s.len()).sum())
        .collect();
    bucket_sizes.sort();
    let min = bucket_sizes.first().unwrap_or(&0);
    let max = bucket_sizes.last().unwrap_or(&0);
    let median = bucket_sizes.get(128).unwrap_or(&0);
    let total_segs: usize = result.buckets.iter().map(|s| s.len()).sum();
    println!(
        "\nbucket distribution: min={min} median={median} max={max} total_segments={total_segs}"
    );
}

#[test]
fn bench_04_search() {
    let root = root_dir();
    if !root.exists() {
        return;
    }

    println!("\n========== 4. SEARCH ==========");

    let records = scan_kifu_files(&root, &ScanOptions::default()).unwrap();
    let result = do_full_build(&records);

    let snap = IndexSnapshot {
        state: IndexState::Ready,
        file_table: Arc::new(result.file_table),
        node_tables: Arc::new(result.node_tables),
        buckets: result.buckets,
    };

    // 検索対象: 平手初期局面
    let startpos_sfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
    let pos = partial_position_from_sfen(startpos_sfen).unwrap();
    let key = key_from_partial_position(&pos);

    println!(
        "query: startpos (z0={:016x} z1={:016x} bucket={})",
        key.z0,
        key.z1,
        key.bucket()
    );

    // warm up
    let _ = snap.search_occurrences_by_key(key);

    // 1000 回
    let iterations = 1000;
    let t = Instant::now();
    let mut hits = Vec::new();
    for _ in 0..iterations {
        hits = snap.search_occurrences_by_key(key);
    }
    let elapsed = t.elapsed();

    println!("hits: {}", hits.len());
    println!(
        "{iterations} iterations: {:.3} ms total, {:.3} μs/query",
        elapsed.as_secs_f64() * 1000.0,
        elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64,
    );

    // ヒットなし検索（空の局面）
    let empty_key = PositionKey { z0: 0, z1: 0 };
    let t2 = Instant::now();
    for _ in 0..iterations {
        let _ = snap.search_occurrences_by_key(empty_key);
    }
    let d2 = t2.elapsed();
    println!(
        "miss query: {:.3} μs/query",
        d2.as_secs_f64() * 1_000_000.0 / iterations as f64,
    );

    // セグメント数の影響
    let bucket_idx = key.bucket() as usize;
    let segs = &snap.buckets[bucket_idx];
    let total_in_bucket: usize = segs.iter().map(|s| s.len()).sum();
    println!(
        "target bucket[{}]: segments={} total_entries={}",
        bucket_idx,
        segs.len(),
        total_in_bucket,
    );
}

#[test]
fn bench_05_memory_estimate() {
    let root = root_dir();
    if !root.exists() {
        return;
    }

    println!("\n========== 5. MEMORY ESTIMATE ==========");

    let records = scan_kifu_files(&root, &ScanOptions::default()).unwrap();
    let result = do_full_build(&records);

    // Segment entries: (PositionKey=16B, Occurrence=12B) = 28 bytes/entry
    let segment_bytes = result.total_entries * 28;

    // NodeTable: NodeCursor=10B, ForkPtr=8B (rough)
    let node_bytes_est = result.total_nodes * 10; // rough

    // FileTable: ~100B per entry (path string + entry)
    let ft_bytes_est = result.file_count * 100;

    println!("entries: {}", result.total_entries);
    println!("nodes: {}", result.total_nodes);
    println!("files: {}", result.file_count);
    println!();
    println!(
        "segment data:   {:.2} MB ({} entries × 28B)",
        segment_bytes as f64 / 1024.0 / 1024.0,
        result.total_entries
    );
    println!(
        "node tables:    {:.2} MB (est.)",
        node_bytes_est as f64 / 1024.0 / 1024.0
    );
    println!(
        "file table:     {:.2} MB (est.)",
        ft_bytes_est as f64 / 1024.0 / 1024.0
    );
    let total_est = segment_bytes + node_bytes_est + ft_bytes_est;
    println!(
        "total (est.):   {:.2} MB",
        total_est as f64 / 1024.0 / 1024.0
    );

    // 10万ファイル外挿
    let scale = 100_000.0 / result.file_count as f64;
    println!("\n--- extrapolation to 100k files ---");
    println!("entries: ~{:.0}", result.total_entries as f64 * scale);
    println!(
        "segment data: ~{:.0} MB",
        segment_bytes as f64 * scale / 1024.0 / 1024.0
    );
    println!(
        "total (est.): ~{:.0} MB",
        total_est as f64 * scale / 1024.0 / 1024.0
    );
}

#[test]
fn bench_06_compaction() {
    let root = root_dir();
    if !root.exists() {
        return;
    }

    println!("\n========== 6. COMPACTION ==========");

    let records = scan_kifu_files(&root, &ScanOptions::default()).unwrap();
    let result = do_full_build(&records);

    // compaction 前のセグメント数
    let total_segs_before: usize = result.buckets.iter().map(|s| s.len()).sum();
    let total_entries_before: usize = result
        .buckets
        .iter()
        .map(|segs| segs.iter().map(|s| s.len()).sum::<usize>())
        .sum();

    println!("before: {total_segs_before} segments, {total_entries_before} entries");

    let snap = IndexSnapshot {
        state: IndexState::Ready,
        file_table: Arc::new(result.file_table),
        node_tables: Arc::new(result.node_tables),
        buckets: result.buckets,
    };

    // compaction (same logic as index_cache::compact_all_buckets, inlined here)
    let t = Instant::now();
    let mut compacted_entries = 0usize;
    let mut compacted_buckets: [Vec<SegmentArc>; 256] = std::array::from_fn(|_| Vec::new());
    for (b, segs) in snap.buckets.iter().enumerate() {
        if segs.is_empty() {
            continue;
        }
        // Merge all segments into one sorted vec
        let mut merged: Vec<(PositionKey, Occurrence)> = Vec::new();
        for seg in segs {
            for e in seg.entries() {
                if snap.file_table.is_occ_alive(e.1.file_id, e.1.gen) {
                    merged.push(*e);
                }
            }
        }
        merged.sort_by(|(k1, o1), (k2, o2)| {
            (k1.z0, k1.z1, o1.file_id, o1.node_id).cmp(&(k2.z0, k2.z1, o2.file_id, o2.node_id))
        });
        compacted_entries += merged.len();
        if !merged.is_empty() {
            compacted_buckets[b].push(Arc::new(Segment::new_sorted(merged)));
        }
    }
    let elapsed = t.elapsed();

    let total_segs_after: usize = compacted_buckets.iter().map(|s| s.len()).sum();
    println!("after:  {total_segs_after} segments, {compacted_entries} entries (alive)");
    println!("elapsed: {:.3} ms", elapsed.as_secs_f64() * 1000.0);

    // compacted 後の検索速度
    let compacted_snap = IndexSnapshot {
        state: IndexState::Ready,
        file_table: snap.file_table.clone(),
        node_tables: snap.node_tables.clone(),
        buckets: compacted_buckets,
    };

    let startpos_sfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
    let pos = partial_position_from_sfen(startpos_sfen).unwrap();
    let key = key_from_partial_position(&pos);

    let _ = compacted_snap.search_occurrences_by_key(key);
    let iterations = 1000;
    let t2 = Instant::now();
    for _ in 0..iterations {
        let _ = compacted_snap.search_occurrences_by_key(key);
    }
    let d2 = t2.elapsed();
    println!(
        "search after compaction: {:.3} μs/query ({iterations} iters)",
        d2.as_secs_f64() * 1_000_000.0 / iterations as f64,
    );
}

#[test]
fn bench_07_diff_snapshot() {
    let root = root_dir();
    if !root.exists() {
        return;
    }

    println!("\n========== 7. DIFF SNAPSHOT ==========");

    let records = scan_kifu_files(&root, &ScanOptions::default()).unwrap();
    let snap = snapshot_from_records(&root, records.clone());

    // 同一スナップショット (変化なし)
    let t = Instant::now();
    let diff = diff_snapshot(&snap, &snap);
    let d = t.elapsed();
    println!(
        "same snapshot diff: added={} modified={} removed={} elapsed={:.3} ms",
        diff.added.len(),
        diff.modified.len(),
        diff.removed.len(),
        d.as_secs_f64() * 1000.0,
    );

    // 10ファイル除去したスナップショット
    let mut reduced = snap.clone();
    let keys: Vec<String> = reduced.by_path.keys().take(10).cloned().collect();
    for k in &keys {
        reduced.by_path.remove(k);
    }
    let t2 = Instant::now();
    let diff2 = diff_snapshot(&snap, &reduced);
    let d2 = t2.elapsed();
    println!(
        "10 files removed:  added={} modified={} removed={} elapsed={:.3} ms",
        diff2.added.len(),
        diff2.modified.len(),
        diff2.removed.len(),
        d2.as_secs_f64() * 1000.0,
    );

    // mtime 変更（10ファイル modify）
    let mut modified_snap = snap.clone();
    let mod_keys: Vec<String> = modified_snap.by_path.keys().take(10).cloned().collect();
    for k in &mod_keys {
        if let Some(r) = modified_snap.by_path.get_mut(k) {
            r.mtime_ms += 1000;
        }
    }
    let t3 = Instant::now();
    let diff3 = diff_snapshot(&snap, &modified_snap);
    let d3 = t3.elapsed();
    println!(
        "10 files modified: added={} modified={} removed={} elapsed={:.3} ms",
        diff3.added.len(),
        diff3.modified.len(),
        diff3.removed.len(),
        d3.as_secs_f64() * 1000.0,
    );
}

#[test]
fn bench_08_encode_decode_size() {
    let root = root_dir();
    if !root.exists() {
        return;
    }

    println!("\n========== 8. CACHE ENCODE/DECODE SIZE ==========");

    let records = scan_kifu_files(&root, &ScanOptions::default()).unwrap();
    let result = do_full_build(&records);

    // Compact all entries per bucket (simulating save_checkpoint logic)
    let mut all_entries: Vec<(PositionKey, Occurrence)> = Vec::new();
    for segs in &result.buckets {
        for seg in segs {
            for e in seg.entries() {
                all_entries.push(*e);
            }
        }
    }

    // Raw binary size estimate (no zstd)
    let entry_bytes = all_entries.len() * (16 + 12); // PositionKey + Occurrence
    println!(
        "raw entry data: {:.2} MB",
        entry_bytes as f64 / 1024.0 / 1024.0
    );

    // zstd compress
    let mut raw = Vec::new();
    for (k, o) in &all_entries {
        raw.extend_from_slice(&k.z0.to_le_bytes());
        raw.extend_from_slice(&k.z1.to_le_bytes());
        raw.extend_from_slice(&o.file_id.to_le_bytes());
        raw.extend_from_slice(&o.gen.to_le_bytes());
        raw.extend_from_slice(&o.node_id.to_le_bytes());
    }

    let t_compress = Instant::now();
    let compressed = zstd::stream::encode_all(raw.as_slice(), 1).unwrap();
    let d_compress = t_compress.elapsed();

    let t_decompress = Instant::now();
    let _decompressed = zstd::stream::decode_all(compressed.as_slice()).unwrap();
    let d_decompress = t_decompress.elapsed();

    println!(
        "zstd level=1: {:.2} MB → {:.2} MB (ratio {:.1}x)",
        raw.len() as f64 / 1024.0 / 1024.0,
        compressed.len() as f64 / 1024.0 / 1024.0,
        raw.len() as f64 / compressed.len() as f64,
    );
    println!(
        "compress: {:.3} ms, decompress: {:.3} ms",
        d_compress.as_secs_f64() * 1000.0,
        d_decompress.as_secs_f64() * 1000.0,
    );
}

#[test]
fn bench_09_bug_mega_detail() {
    let root = root_dir();
    if !root.exists() {
        return;
    }

    println!("\n========== 9. bug_mega.kif DETAIL ==========");

    let records = scan_kifu_files(&root, &ScanOptions::default()).unwrap();
    let mega = records.iter().find(|r| {
        r.path
            .file_name()
            .map(|n| n.to_string_lossy().contains("bug_mega"))
            .unwrap_or(false)
    });

    let Some(mega) = mega else {
        println!("bug_mega.kif not found");
        return;
    };

    println!("path: {}", mega.path.display());
    println!("size: {:.1} KB", mega.size as f64 / 1024.0);

    // I/O
    let t_io = Instant::now();
    let _bytes = std::fs::read(&mega.path).unwrap();
    let d_io = t_io.elapsed();
    println!("raw I/O read: {:.3} ms", d_io.as_secs_f64() * 1000.0);

    // parse
    let t_parse = Instant::now();
    let jkf = read_to_jkf(mega).unwrap();
    let d_parse = t_parse.elapsed();
    println!(
        "parse: {:.3} ms (moves.len={})",
        d_parse.as_secs_f64() * 1000.0,
        jkf.moves.len()
    );

    // count forks
    fn count_forks(moves: &[shogi_kifu_converter_obsshogi::jkf::MoveFormat]) -> usize {
        let mut c = 0;
        for m in moves {
            if let Some(forks) = &m.forks {
                for f in forks {
                    c += 1;
                    c += count_forks(f);
                }
            }
        }
        c
    }
    let forks = count_forks(&jkf.moves);
    println!("fork branches: {forks}");

    // build
    let t_build = Instant::now();
    let built = build_index_for_jkf(1, 1, &jkf, BuildPolicy::Loose).unwrap();
    let d_build = t_build.elapsed();
    println!(
        "build: {:.3} ms (entries={} nodes={} warns={})",
        d_build.as_secs_f64() * 1000.0,
        built.entries.len(),
        built.node_table.nodes.len(),
        built.warns.len(),
    );

    // bucketize
    let t_bucket = Instant::now();
    let _by_bucket = bucketize_entries(built.entries);
    let d_bucket = t_bucket.elapsed();
    println!("bucketize: {:.3} ms", d_bucket.as_secs_f64() * 1000.0);

    println!(
        "\ntotal (I/O + parse + build + bucket): {:.3} ms",
        (d_io + d_parse + d_build + d_bucket).as_secs_f64() * 1000.0,
    );
}

#[test]
fn bench_10_summary() {
    let root = root_dir();
    if !root.exists() {
        eprintln!("SKIP: {} does not exist", root.display());
        return;
    }

    println!("\n╔══════════════════════════════════════════════════════╗");
    println!("║           SEARCH BENCHMARK SUMMARY                  ║");
    println!("╚══════════════════════════════════════════════════════╝\n");

    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    let opts = ScanOptions::default();

    // scan
    let t = Instant::now();
    let records = scan_kifu_files(&root, &opts).unwrap();
    let d_scan = t.elapsed();

    // full build
    let t = Instant::now();
    let result = do_full_build(&records);
    let d_build = t.elapsed();

    // search (startpos)
    let snap = IndexSnapshot {
        state: IndexState::Ready,
        file_table: Arc::new(result.file_table),
        node_tables: Arc::new(result.node_tables),
        buckets: result.buckets,
    };

    let startpos_sfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
    let pos = partial_position_from_sfen(startpos_sfen).unwrap();
    let key = key_from_partial_position(&pos);

    let _ = snap.search_occurrences_by_key(key);
    let iterations = 10000;
    let t = Instant::now();
    let mut hits = Vec::new();
    for _ in 0..iterations {
        hits = snap.search_occurrences_by_key(key);
    }
    let d_search = t.elapsed();

    let total_bytes: u64 = records.iter().map(|r| r.size).sum();
    let entry_mem = result.total_entries * 28;
    let node_mem = result.total_nodes * 10;

    println!("Environment:");
    println!("  cores:           {cpus}");
    println!("  root:            {}", root.display());
    println!("  files:           {}", records.len());
    println!(
        "  total file size: {:.2} MB",
        total_bytes as f64 / 1024.0 / 1024.0
    );
    println!();
    println!("Index stats:");
    println!("  indexed files:   {}", result.file_count);
    println!("  total nodes:     {}", result.total_nodes);
    println!("  total entries:   {}", result.total_entries);
    println!(
        "  avg nodes/file:  {:.1}",
        result.total_nodes as f64 / result.file_count.max(1) as f64
    );
    println!();
    println!("Timings:");
    println!("  FS scan:         {:.3} ms", d_scan.as_secs_f64() * 1000.0);
    println!(
        "  full build:      {:.3} ms ({:.3} s) [single-thread]",
        d_build.as_secs_f64() * 1000.0,
        d_build.as_secs_f64()
    );
    println!(
        "  search (start):  {:.3} μs/query ({} hits, {iterations} iters)",
        d_search.as_secs_f64() * 1_000_000.0 / iterations as f64,
        hits.len()
    );
    println!();
    println!("Memory (estimated):");
    println!(
        "  segments:        {:.2} MB",
        entry_mem as f64 / 1024.0 / 1024.0
    );
    println!(
        "  node tables:     {:.2} MB",
        node_mem as f64 / 1024.0 / 1024.0
    );
    println!(
        "  total:           {:.2} MB",
        (entry_mem + node_mem) as f64 / 1024.0 / 1024.0
    );

    // Extrapolation
    let scale_100k = 100_000.0 / result.file_count.max(1) as f64;
    println!();
    println!("Extrapolation (100k files, 100 nodes/file):");
    println!(
        "  entries:         ~{:.0}M",
        result.total_entries as f64 * scale_100k / 1_000_000.0
    );
    println!(
        "  memory:          ~{:.0} MB",
        (entry_mem + node_mem) as f64 * scale_100k / 1024.0 / 1024.0
    );
    println!(
        "  full build:      ~{:.1} s (single-thread est.)",
        d_build.as_secs_f64() * scale_100k
    );
    println!(
        "  full build:      ~{:.1} s ({cpus}-core parallel est.)",
        d_build.as_secs_f64() * scale_100k / cpus as f64
    );
    println!(
        "  search:          ~{:.3} μs/query (O(log N), scales sublinearly)",
        d_search.as_secs_f64() * 1_000_000.0 / iterations as f64
    );
}
