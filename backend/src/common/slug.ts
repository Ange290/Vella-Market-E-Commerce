import { randomBytes } from 'node:crypto';

export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'item';
}

/** Returns a slug that is unused according to `exists`, appending a short random suffix on collision. */
export async function uniqueSlug(input: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(input);
  if (!(await exists(base))) return base;
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${randomBytes(2).toString('hex')}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${randomBytes(6).toString('hex')}`;
}
