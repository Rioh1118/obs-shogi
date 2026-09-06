//! メモリの上に置く。**テスト用。**

use std::collections::HashMap;
use std::sync::Mutex;

use super::{BlobStore, StoreError};

/// 置いたものをそのまま持つ。
///
/// **失敗を仕込める。** ディスクの失敗はテストから起こせないので、
/// [`Self::failing`] で「置けない」置き場を作れる。
#[derive(Default)]
pub struct InMemory {
    blobs: Mutex<HashMap<String, Vec<u8>>>,
    fail_on_save: bool,
}

impl InMemory {
    pub fn new() -> Self {
        Self::default()
    }

    /// 置こうとすると必ず落ちる置き場。
    pub fn failing() -> Self {
        Self {
            blobs: Mutex::new(HashMap::new()),
            fail_on_save: true,
        }
    }
}

impl BlobStore for InMemory {
    fn save(&self, key: &str, bytes: &[u8]) -> Result<(), StoreError> {
        if self.fail_on_save {
            return Err(StoreError::Io("仕込んだ失敗".to_owned()));
        }
        self.blobs
            .lock()
            .expect("毒されたロック")
            .insert(key.to_owned(), bytes.to_vec());
        Ok(())
    }

    fn load(&self, key: &str) -> Result<Vec<u8>, StoreError> {
        self.blobs
            .lock()
            .expect("毒されたロック")
            .get(key)
            .cloned()
            .ok_or(StoreError::NotFound)
    }

    fn delete(&self, key: &str) -> Result<(), StoreError> {
        self.blobs.lock().expect("毒されたロック").remove(key);
        Ok(())
    }
}
