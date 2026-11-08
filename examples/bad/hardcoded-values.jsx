// 悪い例・真似しない：Tailwind のユーティリティクラスと style 属性の直書き（素の CSS とトークンだけを使う規則に違反）
export function BadButton() {
  return (
    <button className="bg-violet-600 text-white px-4 py-2 rounded-lg" style={{ color: '#ffffff' }}>
      保存
    </button>
  );
}
