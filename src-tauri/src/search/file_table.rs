use super::types::{FileEntry, FileId, Gen};

/// SoA-backed file metadata. `is_occ_alive` は検索ホットパスなので O(1) 配列
/// アクセスにする。`file_id` はフルビルドで 1 から密に振られるので、そのまま
/// Vec index として使う (slot 0 は未使用)。
#[derive(Debug, Clone, Default)]
pub struct FileTable {
    gens: Vec<Gen>,
    deleted: Vec<bool>,
    paths: Vec<Option<String>>,
}

impl FileTable {
    fn ensure(&mut self, file_id: FileId) {
        let i = file_id as usize;
        if self.gens.len() <= i {
            self.gens.resize(i + 1, 0);
            self.deleted.resize(i + 1, false);
            self.paths.resize(i + 1, None);
        }
    }

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

    pub fn get_path(&self, file_id: FileId) -> Option<&str> {
        let i = file_id as usize;
        self.paths.get(i)?.as_deref()
    }

    pub fn upsert(&mut self, entry: FileEntry) {
        self.ensure(entry.file_id);
        let i = entry.file_id as usize;
        self.gens[i] = entry.gen;
        self.deleted[i] = entry.deleted;
        self.paths[i] = Some(entry.path);
    }

    pub fn tombstone(&mut self, file_id: FileId) {
        let i = file_id as usize;
        if i < self.gens.len() && self.paths[i].is_some() {
            self.deleted[i] = true;
            self.gens[i] = self.gens[i].wrapping_add(1);
        }
    }

    #[inline]
    pub fn is_occ_alive(&self, file_id: FileId, occ_gen: Gen) -> bool {
        let i = file_id as usize;
        i < self.gens.len()
            && self.paths[i].is_some()
            && !self.deleted[i]
            && self.gens[i] == occ_gen
    }

    pub fn len(&self) -> usize {
        self.paths.iter().filter(|p| p.is_some()).count()
    }

    pub fn is_empty(&self) -> bool {
        !self.paths.iter().any(|p| p.is_some())
    }

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
