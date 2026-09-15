// 写真をアップロードする前にブラウザ上で縮小する。
// iPhoneの写真は1枚2〜3MBあるが、長辺1200pxのJPEGにすると200KB前後になる。
const MAX_SIZE = 1200;
const QUALITY = 0.8;

export async function shrinkImage(file) {
  // imageOrientation: EXIFの回転情報を反映させる（iPhoneの縦写真が横向きにならないように）
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('画像を変換できませんでした');
  return blob;
}
