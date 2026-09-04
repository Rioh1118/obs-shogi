//! 読み手が値ごと持ち出せる、書き換えのたびに丸ごと差し替わる升。
//!
//! **中身を一切知らない。** ここが変わるのは並行性の都合だけ
//! （`RwLock` を `ArcSwap` に替える、読みの待ちを測る）で、
//! 索引に何が入るかでは変わらない。
//!
//! **型引数であって trait ではない。** 器は中身のメソッドを1つも呼ばないので、
//! trait を切ってもメンバーがゼロになる。依存を逆転させるには
//! 逆転させる振る舞いが要るが、ここには無い。

use std::sync::Arc;

use parking_lot::RwLock;

/// 値ごと差し替える共有升。
///
/// 読み手は [`Self::snapshot`] で `Arc` を持ち出し、**その後の書き換えに
/// 影響されない**まま読み切れる。書き手は新しい値を作って丸ごと置く。
/// 途中の状態は読み手に見えない。**持ち出したあとの読み切りにロックは要らない**
/// —— 持ち出す一瞬だけ握る。
///
/// **`T` は入れ替えるたびに丸ごと作り直される。** 差分更新はできない。
/// 大きい `T` を細かく更新する使い方には向かない
/// （索引は `Arc` で共有できる部分が大半なので、作り直しは浅い複製で済む）。
#[derive(Debug, Default)]
pub struct SnapshotCell<T> {
    inner: RwLock<Arc<T>>,
}

impl<T> SnapshotCell<T> {
    pub fn new(value: T) -> Self {
        Self {
            inner: RwLock::new(Arc::new(value)),
        }
    }

    /// いまの値を持ち出す。**持ち出した後の書き換えは見えない。**
    ///
    /// 握るのは `Arc` を1つ複製する間だけ。ただし
    /// [`Self::update`] が走っている最中は、それが終わるまで待つ。
    pub fn snapshot(&self) -> Arc<T> {
        self.inner.read().clone()
    }

    /// いまの値を捨てて置き換える。前の値は読まない。
    pub fn replace(&self, value: T) {
        *self.inner.write() = Arc::new(value);
    }

    /// いまの値から次の値を作って置き換える。
    ///
    /// **`f` は書き込みロックの中で走る。** その間に来た読み手は
    /// [`Self::snapshot`] で待つ —— **`f` の長さがそのまま読みの待ちになる。**
    ///
    /// 読み手を待たせたくないなら `ArcSwap` へ替えることになるが、
    /// そのとき `update` の「読んで作って置く」が分割されるので、
    /// 書き手どうしの競合を別に留める必要がある。
    pub fn update(&self, f: impl FnOnce(&T) -> T) {
        let mut guard = self.inner.write();
        *guard = Arc::new(f(&guard));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **持ち出した値は、その後の書き換えで変わらない。**
    ///
    /// これが崩れると、検索の途中で索引が差し替わったとき
    /// 同じ検索の中で違う索引を見ることになる。
    #[test]
    fn a_snapshot_taken_before_a_write_does_not_see_it() {
        let cell = SnapshotCell::new(vec![1u32]);
        let before = cell.snapshot();

        cell.replace(vec![9, 9]);

        assert_eq!(*before, vec![1], "持ち出した値が書き換えで動いた");
        assert_eq!(*cell.snapshot(), vec![9, 9]);
    }

    /// **`update` は前の値を読んで次を作る。**
    #[test]
    fn update_builds_the_next_value_from_the_current_one() {
        let cell = SnapshotCell::new(vec![1u32, 2]);
        let before = cell.snapshot();

        cell.update(|v| {
            let mut next = v.clone();
            next.push(3);
            next
        });

        assert_eq!(*before, vec![1, 2], "持ち出した値が update で動いた");
        assert_eq!(*cell.snapshot(), vec![1, 2, 3]);
    }
}
