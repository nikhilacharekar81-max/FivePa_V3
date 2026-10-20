/** Converts text into a URL-safe slug (lowercase, hyphen-separated). */
export const slugify = (text?: string | null): string =>
  String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
