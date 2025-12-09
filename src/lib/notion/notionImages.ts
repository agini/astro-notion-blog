// lib/notionImages.ts
import fs, { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import axios, { AxiosResponse } from 'axios';
import sharp from 'sharp';
import ExifTransformer from 'exif-be-gone';
import { REQUEST_TIMEOUT_MS } from '../server-constants';

// Notion クライアントを import
import { notion } from './client';

/**
 * URL から画像をダウンロードして保存
 * JPEG は自動回転＋EXIF除去
 * @param url Image URL
 * @returns Promise<void>
 */
export async function downloadAndProcessImage(url: URL): Promise<void> {
  let res!: AxiosResponse;
  try {
    res = await axios({
      method: 'get',
      url: url.toString(),
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'stream',
    });
  } catch (err) {
    console.error('Axios download error:', err);
    return;
  }

  if (!res || res.status !== 200) {
    console.error('Invalid response:', res?.status);
    return;
  }

  // 保存先ディレクトリを作成
  const dir = `./public/notion/${url.pathname.split('/').slice(-2)[0]}`;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = decodeURIComponent(url.pathname.split('/').slice(-1)[0]);
  const filepath = `${dir}/${filename}`;

  const writeStream = createWriteStream(filepath);

  let stream = res.data;

  // JPEG は自動回転
  if (res.headers['content-type'] === 'image/jpeg') {
    stream = stream.pipe(sharp().rotate());
  }

  try {
    await pipeline(stream, new ExifTransformer(), writeStream);
    console.log(`Downloaded and processed image: ${filepath}`);
  } catch (err) {
    console.error('Pipeline error:', err);
    writeStream.end();
  }
}
