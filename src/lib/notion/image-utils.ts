// src/lib/notion/image-utils.ts
import fs from 'node:fs';
import axios from 'axios';
import sharp from 'sharp';

export async function downloadAndProcessImage(url: string, savePath: string) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data, 'binary');
  await sharp(buffer)
    .resize(1200) // 任意でサイズ変更
    .toFile(savePath);
}
