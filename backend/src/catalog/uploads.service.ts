import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const UPLOAD_DIR = join(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');

/** Detects the real image type from magic bytes — the client-supplied MIME type and filename are never trusted. */
function sniff(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

@Injectable()
export class UploadsService {
  /** Stores the image under a random name and returns its public URL path. */
  async saveImage(file: Express.Multer.File): Promise<string> {
    const ext = sniff(file.buffer);
    if (!ext) throw new BadRequestException('Only JPEG, PNG or WebP images are allowed');
    await mkdir(UPLOAD_DIR, { recursive: true });
    const name = `${randomBytes(16).toString('hex')}.${ext}`;
    await writeFile(join(UPLOAD_DIR, name), file.buffer, { flag: 'wx' });
    return `/uploads/${name}`;
  }
}
