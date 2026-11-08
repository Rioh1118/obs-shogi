/**
 * このスライスの公開 API。名前を明示列挙する。
 *
 * `export *` にすると、モジュールにシンボルを1つ足しただけで公開 API が黙って広がる。
 * ここに並ぶのは**スライスの外に呼び出し元があるものだけ**。
 */
export { default, type EditorFace } from "./ui/PositionEditor";
