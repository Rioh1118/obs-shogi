//! 値1つとバイト列の相互変換。
//!
//! **置き場を知らない。** どこへ置くかは [`BlobStore`](super::BlobStore)。
//! ここは「この値をどう並べるか」だけ。
//!
//! **入れ子にできる。** 圧縮は符号化と直交するので、[`Zstd`] が中の
//! [`Codec`] を包む。索引の並べ方を変えても圧縮の話は動かないし、逆も同じ。

use super::{BlobStore, StoreError};

/// 値1つとバイト列の相互変換。
///
/// **入口と出口の型は違ってよい。** 詰めるのは生きている状態への借用で足りるが、
/// 取り出すのは所有した値でないと使えない。1つの型にすると
/// **詰めるたびに状態を丸ごと複製する**ことになる。
///
/// **往復すること。** `decode(encode(v))` は `v` と同じ意味の値を返す。
/// 同じにならない形（丸めや切り捨て）を入れるなら、それが意図であることを
/// 実装側の doc に書くこと。
pub trait Codec {
    /// 詰めるもの。**借用でよい。**
    type Input<'a>;
    /// 取り出すもの。**所有した値。**
    type Output;

    fn encode(&self, value: Self::Input<'_>) -> Result<Vec<u8>, String>;
    fn decode(&self, bytes: &[u8]) -> Result<Self::Output, String>;
}

/// 中の [`Codec`] の結果を zstd で包む。
///
/// **level=1 は速さを取る。** 起動のたびに展開するので、縮みより展開の速さが効く。
pub struct Zstd<C>(pub C);

impl<C: Codec> Codec for Zstd<C> {
    type Input<'a> = C::Input<'a>;
    type Output = C::Output;

    fn encode(&self, value: Self::Input<'_>) -> Result<Vec<u8>, String> {
        let body = self.0.encode(value)?;
        zstd::stream::encode_all(body.as_slice(), 1).map_err(|e| format!("zstd encode: {e}"))
    }

    fn decode(&self, bytes: &[u8]) -> Result<Self::Output, String> {
        let body = zstd::stream::decode_all(bytes).map_err(|e| format!("zstd decode: {e}"))?;
        self.0.decode(&body)
    }
}

/// 値を符号化して置く。
pub fn save<C: Codec>(
    store: &dyn BlobStore,
    codec: &C,
    key: &str,
    value: C::Input<'_>,
) -> Result<(), String> {
    let bytes = codec.encode(value)?;
    store.save(key, &bytes).map_err(|e| format!("save: {e}"))
}

/// 置いてあるものを読んで復号する。
///
/// **置かれていないことと、読めないことを区別しない。** どちらも呼び手にとっては
/// 「復元できない」で、次の手（作り直す）が同じだから。
pub fn load<C: Codec>(store: &dyn BlobStore, codec: &C, key: &str) -> Result<C::Output, String> {
    let bytes = match store.load(key) {
        Ok(v) => v,
        Err(StoreError::NotFound) => return Err("not found".to_owned()),
        Err(e) => return Err(format!("load: {e}")),
    };
    codec.decode(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::InMemory;

    /// 数を4バイトで並べるだけの codec。**入れ子の形を試すための題材。**
    struct U32Codec;

    impl Codec for U32Codec {
        type Input<'a> = &'a u32;
        type Output = u32;

        fn encode(&self, value: &u32) -> Result<Vec<u8>, String> {
            Ok(value.to_le_bytes().to_vec())
        }

        fn decode(&self, bytes: &[u8]) -> Result<u32, String> {
            let b: [u8; 4] = bytes.try_into().map_err(|_| "4バイトでない".to_owned())?;
            Ok(u32::from_le_bytes(b))
        }
    }

    /// **置いて読み戻すと同じ値。**
    #[test]
    fn a_value_survives_a_round_trip() {
        let store = InMemory::new();
        save(&store, &U32Codec, "k", &42).expect("置けない");
        assert_eq!(load(&store, &U32Codec, "k").expect("読めない"), 42);
    }

    /// **圧縮を挟んでも同じ値。**
    #[test]
    fn wrapping_in_zstd_does_not_change_the_value() {
        let store = InMemory::new();
        let codec = Zstd(U32Codec);
        save(&store, &codec, "k", &42).expect("置けない");
        assert_eq!(load(&store, &codec, "k").expect("読めない"), 42);
    }

    /// **圧縮した blob は、中の codec だけでは読めない。**
    ///
    /// 包み方を変えたのに読む側を直し忘れる形を、ここで落とす。
    #[test]
    fn a_compressed_blob_is_not_readable_by_the_inner_codec() {
        let store = InMemory::new();
        save(&store, &Zstd(U32Codec), "k", &42).expect("置けない");
        assert!(load(&store, &U32Codec, "k").is_err());
    }

    /// **置いていないものは失敗。** 復元ではこれは正規の経路。
    #[test]
    fn loading_something_never_saved_fails() {
        let store = InMemory::new();
        assert!(load(&store, &U32Codec, "k").is_err());
    }

    /// **置き場が落ちたら置くのも落ちる。**
    #[test]
    fn a_failing_store_makes_the_save_fail() {
        assert!(save(&InMemory::failing(), &U32Codec, "k", &42).is_err());
    }
}
