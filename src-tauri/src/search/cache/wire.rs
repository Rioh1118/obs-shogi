//! blob に並べるバイトの原始。
//!
//! **意味を知らない。** どの欄をどの順で並べるかは `format.rs` の
//! `encode_all` / `decode_all`。ここは「`u32` を little endian で4バイト」だけ。
//!
//! 読む側は [`Reader`] が持つ。**残りバイト数を超える長さを断る**のがここの役目で、
//! 化けた長さで巨大な確保をしないための唯一の門番
//! （`docs/state-transitions/search.md` のビット化けの表）。

use crate::search::read::fs_scan::KifuKind;

pub(super) fn kind_to_u8(k: KifuKind) -> u8 {
    match k {
        KifuKind::Kif => 1,
        KifuKind::Ki2 => 2,
        KifuKind::Csa => 3,
        KifuKind::Jkf => 4,
    }
}
pub(super) fn u8_to_kind(v: u8) -> Result<KifuKind, String> {
    Ok(match v {
        1 => KifuKind::Kif,
        2 => KifuKind::Ki2,
        3 => KifuKind::Csa,
        4 => KifuKind::Jkf,
        _ => return Err(format!("bad kind: {v}")),
    })
}

// FileTable から全エントリを列挙したいので helper を FileTable に追加する（Step5参照）

pub(super) fn write_u8(w: &mut Vec<u8>, v: u8) {
    w.push(v);
}
pub(super) fn write_u16(w: &mut Vec<u8>, v: u16) {
    w.extend_from_slice(&v.to_le_bytes());
}
pub(super) fn write_u32(w: &mut Vec<u8>, v: u32) {
    w.extend_from_slice(&v.to_le_bytes());
}
pub(super) fn write_u64(w: &mut Vec<u8>, v: u64) {
    w.extend_from_slice(&v.to_le_bytes());
}

pub(super) fn write_string(w: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    write_u32(w, b.len() as u32);
    w.extend_from_slice(b);
}

pub(super) struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}
impl<'a> Reader<'a> {
    pub(super) fn new(b: &'a [u8]) -> Self {
        Self { b, i: 0 }
    }
    pub(super) fn read_u8(&mut self) -> Result<u8, String> {
        if self.i + 1 > self.b.len() {
            return Err("unexpected eof".to_string());
        }
        let v = self.b[self.i];
        self.i += 1;
        Ok(v)
    }
    pub(super) fn read_u16(&mut self) -> Result<u16, String> {
        let a = self.read_fixed::<2>()?;
        Ok(u16::from_le_bytes(a))
    }
    pub(super) fn read_u32(&mut self) -> Result<u32, String> {
        let a = self.read_fixed::<4>()?;
        Ok(u32::from_le_bytes(a))
    }
    pub(super) fn read_u64(&mut self) -> Result<u64, String> {
        let a = self.read_fixed::<8>()?;
        Ok(u64::from_le_bytes(a))
    }
    pub(super) fn read_string(&mut self) -> Result<String, String> {
        let n = self.read_u32()? as usize;
        if self.i + n > self.b.len() {
            return Err("unexpected eof".to_string());
        }
        let s = std::str::from_utf8(&self.b[self.i..self.i + n]).map_err(|e| e.to_string())?;
        self.i += n;
        Ok(s.to_string())
    }
    /// 項目数を読む。**残っているバイト数で縛る。**
    ///
    /// キャッシュから読んだ `u32` をそのまま `with_capacity` / `reserve` /
    /// `resize` に渡すと、**壊れた4バイトが確保量を決める**。
    /// とくに `HashMap::with_capacity` は hashbrown が制御バイトを埋めるので
    /// 遅延予約にならず、実際にページを触る — 68バイトの blob で
    /// `map_len = 5e8` にすると 1.08 GB / 353 ms を実測している。
    /// `u32::MAX` まで振れば `handle_alloc_error` が unwind せずプロセスが落ちる。
    ///
    /// 実プロジェクトの項目数は小さいので、**最上位ビットが1つ反転するだけで
    /// 20億を超える**。`zstd` は checksum 無しなので化けた値はここに届く（#336）。
    ///
    /// `min_bytes_each` は [`min_bytes`] から選ぶ。n 項目を読むには
    /// 少なくとも `n * min_bytes_each` バイト残っている必要があり、
    /// **これで確保量が blob の長さで頭打ちになる**。
    pub(super) fn read_len(&mut self, min_bytes_each: usize) -> Result<usize, String> {
        let n = self.read_u32()? as usize;
        let remaining = self.b.len() - self.i;
        if n.saturating_mul(min_bytes_each) > remaining {
            return Err(format!("bad length: {n} (remaining {remaining} bytes)"));
        }
        Ok(n)
    }

    pub(super) fn read_fixed<const N: usize>(&mut self) -> Result<[u8; N], String> {
        if self.i + N > self.b.len() {
            return Err("unexpected eof".to_string());
        }
        let mut out = [0u8; N];
        out.copy_from_slice(&self.b[self.i..self.i + N]);
        self.i += N;
        Ok(out)
    }
}
