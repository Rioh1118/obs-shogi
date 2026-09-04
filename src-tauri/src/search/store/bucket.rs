//! 索引を桶で分ける。**桶の数と、桶に分けた形の持ち主。**
//!
//! 局面の鍵は全部で 2^128 通りあるので、引くときに一列に並べると二分探索が
//! 長くなる。鍵の上位8ビットで先に振り分けておくと、探す範囲が 1/256 になる。
//!
//! **数を決めているのは [`PositionKey::bucket`] の戻りの型。** どちらか片方を
//! 動かすと、ディスクに書いた索引が読めなくなる。

use crate::search::position::position_key::PositionKey;
use crate::search::store::node_table::NodeTableArc;
use crate::search::types::{FileEntry, Occurrence};

/// 桶の数。
///
/// **`u8` が取りうる値の数**。[`PositionKey::bucket`] が `u8` を返すので、
/// これ以外の数にはならない。
pub const BUCKET_COUNT: usize = u8::MAX as usize + 1;

/// 局面の鍵を桶で分けたもの。**索引に入れる形。**
pub type BucketEntries = [Vec<(PositionKey, Occurrence)>; BUCKET_COUNT];

/// 桶で分けた `SegmentArc`。**索引が引くときに持っている形。**
pub type BucketSegments = [Vec<crate::search::store::segment::SegmentArc>; BUCKET_COUNT];

/// 1ファイルぶんを索引へ入れる単位。
///
/// `FileEntry` を伴うのは、入れると同時に世代を進めるため
/// （`Gen` が上がらないと前の世代のセグメントが残る）。
pub type FileBucketEntries = (FileEntry, NodeTableArc, BucketEntries);

/// 空の桶を作る。
pub fn empty_buckets() -> BucketEntries {
    std::array::from_fn(|_| Vec::new())
}

/// 1ファイル分の entries を桶に振り分け、`(z0, z1)` で stable sort する。
///
/// 同一ファイル内では `file_id` は一定、`node_id` も push 順 = 既にソート済みなので
/// tie-break は不要（stable sort で挿入順が保たれる）。
pub fn bucketize_entries(entries: Vec<(PositionKey, Occurrence)>) -> BucketEntries {
    let mut buckets = empty_buckets();

    for e in entries {
        buckets[e.0.bucket() as usize].push(e);
    }

    for b in &mut buckets {
        b.sort_by_key(|(k, _)| (k.z0, k.z1));
    }

    buckets
}
