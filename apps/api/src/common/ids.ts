import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function code(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function eventRequestReference(): string {
  return `EVR-${code(8)}`;
}

export function orderNumber(eventDate: string): string {
  return `UTS-${eventDate.replace(/-/g, '').slice(2)}-${code(5)}`;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'vendor'
  );
}
