use std::collections::HashMap;

use super::types::{FileEntry, FileId, Gen};

#[derive(Debug, Clone, Default)]
pub struct FileTable {
    by_id: HashMap<FileId, FileEntry>,
}

impl FileTable {
    pub fn get(&self, file_id: FileId) -> Option<&FileEntry> {
        self.by_id.get(&file_id)
    }

    pub fn upsert(&mut self, entry: FileEntry) {
        self.by_id.insert(entry.file_id, entry);
    }

    pub fn tombstone(&mut self, file_id: FileId) {
        if let Some(e) = self.by_id.get_mut(&file_id) {
            e.deleted = true;
            e.gen = e.gen.wrapping_add(1);
        }
    }

    pub fn is_occ_alive(&self, file_id: FileId, occ_gen: Gen) -> bool {
        match self.by_id.get(&file_id) {
            Some(e) => !e.deleted && e.gen == occ_gen,
            None => false,
        }
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }
}
