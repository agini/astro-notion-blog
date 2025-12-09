import fs, { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import axios from 'axios';
import sharp from 'sharp';
import ExifTransformer from 'exif-be-gone';

/**
 * 画像をダウンロードしてリサイズ・EXIF除去
 * @param url 画像URL
 * @param savePath 保存先パス
 * @param width オプションのリサイズ幅
 */
export async function downloadAndProcessImage(url: string, savePath: string, width?: number) {
  let res;
  try {
    res = await axios.get(url, { responseType: 'stream', timeout: 10000 });
  } catch (err) {
    console.warn(`Failed to download image: ${url}`);
    return;
  }

  if (res.status !== 200) return;

  // ディレクトリ作成
  const dir = savePath.split('/').slice(0, -1).join('/');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let stream = res.data;

  // JPEGなら回転を自動処理
  if (res.headers['content-type'] === 'image/jpeg') {
    stream = stream.pipe(sharp().rotate());
  }

  // EXIF除去 + 保存
  const writeStream = createWriteStream(savePath);
  try {
    if (width) {
      await pipeline(stream, sharp().resize({ width }).toFormat('jpeg'), new ExifTransformer(), writeStream);
    } else {
      await pipeline(stream, new ExifTransformer(), writeStream);
    }
  } catch (err) {
    console.error(`Failed to process image: ${url}`, err);
    writeStream.end();
  }
}
