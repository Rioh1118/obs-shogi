use crate::search::types::{FileEntry, FileId, Gen};

/// `file_id` → その棋譜がどこにあり、生きているか。
///
/// **`is_occ_alive` は検索のたびにヒットの数だけ呼ばれる**ので、
/// `file_id` をそのまま添字にした配列で O(1) にする。
/// `file_id` は 1 から密に振られる（slot 0 は未使用）。
///
/// 列に倒して持つのは `store/segment.rs` と同じ理由で、
/// 生死の判定が触るのは `gens` と `deleted` の2列だけだから。
#[derive(Debug, Clone, Default)]
pub struct FileTable {
    /// 作り直すたびに上がる。**古い出現を落とすのはこれ**
    gens: Vec<Gen>,
    /// 消された棋譜。**`tombstone` が立てるほか、キャッシュから読み戻した項目にも
    /// 立っている**（`deleted` は blob にそのまま書かれる）。
    /// `tombstone` は同時に世代も上げるので、その経路なら世代だけで落ちる。
    /// **世代を上げずに `deleted` が真になる形は復元にしか無く、そこはこの列が落とす**
    deleted: Vec<bool>,
    /// `None` は「その `file_id` に棋譜が無い」——未使用の slot 0 と、欠番
    paths: Vec<Option<String>>,
}

impl FileTable {
    /// `file_id` を添字にできるまで3列を伸ばす。**縮まない。**
    fn ensure(&mut self, file_id: FileId) {
        let i = file_id as usize;
        if self.gens.len() <= i {
            self.gens.resize(i + 1, 0);
            self.deleted.resize(i + 1, false);
            self.paths.resize(i + 1, None);
        }
    }

    /// その棋譜の項目。**消された棋譜も返る**（`deleted` が真の項目として）。
    ///
    /// `path` を複製するので、パスだけ要るなら [`Self::get_path`]。
    pub fn get(&self, file_id: FileId) -> Option<FileEntry> {
        let i = file_id as usize;
        let path = self.paths.get(i)?.as_ref()?;
        Some(FileEntry {
            file_id,
            path: path.clone(),
            deleted: self.deleted[i],
            gen: self.gens[i],
        })
    }

    /// その棋譜のパス。複製しない。**消された棋譜のパスも返る。**
    pub fn get_path(&self, file_id: FileId) -> Option<&str> {
        let i = file_id as usize;
        self.paths.get(i)?.as_deref()
    }

    /// 入れる。同じ `file_id` があれば3列とも上書きする。
    ///
    /// **`deleted` も上書きする**ので、生きた項目を入れ直せば墓標は消える。
    pub fn upsert(&mut self, entry: FileEntry) {
        self.ensure(entry.file_id);
        let i = entry.file_id as usize;
        self.gens[i] = entry.gen;
        self.deleted[i] = entry.deleted;
        self.paths[i] = Some(entry.path);
    }

    /// 消えたことにする。**項目は残す。**
    ///
    /// `deleted` を立て、**同時に世代を上げる**。世代を上げるのは、
    /// 桶に残っている出現をその場で消さずに落とすため
    /// （実際に桶から消えるのは畳むとき。`store/compaction.rs`）。
    ///
    /// 無い `file_id` には何もしない。
    pub fn tombstone(&mut self, file_id: FileId) {
        let i = file_id as usize;
        if i < self.gens.len() && self.paths[i].is_some() {
            self.deleted[i] = true;
            self.gens[i] = self.gens[i].wrapping_add(1);
        }
    }

    #[inline]
    /// その出現がいま生きているか。**検索が結果に出してよいか。**
    ///
    /// 4つの条件が別のものを落とす。
    ///
    /// | 条件 | 落とすもの |
    /// | --- | --- |
    /// | 範囲内 | 化けた `file_id`（`store/segment.rs` の列から直接来る） |
    /// | `paths` が `Some` | 欠番の `file_id` |
    /// | `deleted` が偽 | 復元で読み戻した消済みの棋譜 |
    /// | 世代が一致 | 作り直された棋譜の、古い出現 |
    pub fn is_occ_alive(&self, file_id: FileId, occ_gen: Gen) -> bool {
        let i = file_id as usize;
        i < self.gens.len()
            && self.paths[i].is_some()
            && !self.deleted[i]
            && self.gens[i] == occ_gen
    }

    /// 登録されている棋譜の数。**消された棋譜も数える。**
    ///
    /// 毎回全走査する。画面に出す総数（`search/commands.rs`）が呼ぶ。
    pub fn len(&self) -> usize {
        self.paths.iter().filter(|p| p.is_some()).count()
    }

    /// 1件も登録されていないか。**全件構築を始めてよいかの判定に使う**
    /// （`search/build.rs`）。
    pub fn is_empty(&self) -> bool {
        !self.paths.iter().any(|p| p.is_some())
    }

    /// `file_id` の昇順に全項目。**消された棋譜も返る。**
    ///
    /// キャッシュに書き出す側（`cache/format.rs`）が使う。
    pub fn iter_all(&self) -> impl Iterator<Item = (FileId, FileEntry)> + '_ {
        self.paths.iter().enumerate().filter_map(move |(i, path)| {
            let path = path.as_ref()?;
            let file_id = i as FileId;
            Some((
                file_id,
                FileEntry {
                    file_id,
                    path: path.clone(),
                    deleted: self.deleted[i],
                    gen: self.gens[i],
                },
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(file_id: FileId, deleted: bool, r#gen: Gen) -> FileEntry {
        FileEntry {
            file_id,
            path: format!("{file_id}.kif"),
            deleted,
            r#gen,
        }
    }

    /// **墓標を立てると、そこまでの出現が全部落ちる。**
    ///
    /// 落としているのは世代の側。`tombstone` が世代を上げるので、
    /// 桶に残った古い出現は世代が合わなくなる。
    #[test]
    fn a_tombstone_kills_every_occurrence_recorded_so_far() {
        let mut ft = FileTable::default();
        ft.upsert(entry(1, false, 1));
        assert!(ft.is_occ_alive(1, 1));

        ft.tombstone(1);

        assert!(!ft.is_occ_alive(1, 1), "古い出現が生きている");
        assert!(ft.get(1).is_some(), "項目まで消してしまっている");
        assert_eq!(ft.get(1).expect("消えた").r#gen, 2, "世代が上がっていない");
    }

    /// **作り直された棋譜の、古い出現は落ちる。**
    ///
    /// 落としているのは世代の側だけ —— `deleted` は偽のまま。
    /// 墓標を経由しないので、`deleted` を見ない変異では止まらない。
    #[test]
    fn an_occurrence_from_an_older_generation_is_dropped() {
        let mut ft = FileTable::default();
        ft.upsert(entry(1, false, 1));

        // 作り直し。世代だけ上がる
        ft.upsert(entry(1, false, 2));

        assert!(!ft.is_occ_alive(1, 1), "古い世代の出現が生きている");
        assert!(ft.is_occ_alive(1, 2), "いまの世代の出現が落ちている");
    }

    /// **復元で読み戻した消済みの棋譜は、`deleted` だけが落とす。**
    ///
    /// キャッシュは `deleted` と世代をそのまま blob に書く。読み戻した表には
    /// `tombstone` を通っていない `deleted = true` の項目が入るので、
    /// **世代の一致する出現が来ても止めるのはこの列**。
    ///
    /// 題材の世代を項目と揃えるのが要。ずらすと世代の側で落ちて、
    /// `deleted` を見ない変異が生き残る。
    #[test]
    fn a_restored_tombstone_is_caught_by_the_deleted_column_alone() {
        let mut ft = FileTable::default();
        ft.upsert(entry(1, true, 2));

        assert!(
            !ft.is_occ_alive(1, 2),
            "世代が合う出現を、消済みの棋譜に対して生かしている"
        );
    }

    /// **入れ直すと墓標は消える。**
    #[test]
    fn upserting_a_live_entry_clears_the_tombstone() {
        let mut ft = FileTable::default();
        ft.upsert(entry(1, false, 1));
        ft.tombstone(1);

        ft.upsert(entry(1, false, 2));

        assert!(ft.is_occ_alive(1, 2), "入れ直しても生き返らない");
    }

    /// **欠番と範囲外は落ちる。**
    #[test]
    fn a_missing_or_out_of_range_file_id_is_never_alive() {
        let mut ft = FileTable::default();
        ft.upsert(entry(3, false, 1));

        // 欠番は**範囲内**で踏む。file 3 を入れたので 0..=3 まで列が伸びており、
        // 0 / 1 / 2 は範囲内で `paths` が `None`。世代も 0 で揃えて、
        // 世代の一致だけでは落ちない形にする
        assert!(!ft.is_occ_alive(0, 0), "未使用の slot 0 が生きている");
        assert!(!ft.is_occ_alive(1, 0), "欠番が生きている");
        assert!(!ft.is_occ_alive(2, 0), "欠番が生きている");
        assert!(!ft.is_occ_alive(9, 0), "範囲外が生きている");
    }

    /// **数と空の判定は、消された棋譜も数える。**
    #[test]
    fn a_tombstoned_file_still_counts() {
        let mut ft = FileTable::default();
        assert!(ft.is_empty());

        ft.upsert(entry(1, false, 1));
        ft.tombstone(1);

        assert_eq!(ft.len(), 1, "消された棋譜を数えていない");
        assert!(!ft.is_empty(), "消された棋譜だけの表を空と言っている");
    }
}
