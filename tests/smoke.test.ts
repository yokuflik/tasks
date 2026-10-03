import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';

describe('עשן: הכלים רצים', () => {
  it('vitest', () => expect(1 + 1).toBe(2));
  it('fast-check', () => fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a)));
  it('fake-indexeddb ו-idb', async () => {
    const db = await openDB('smoke', 1, { upgrade: (d) => void d.createObjectStore('s') });
    await db.put('s', 'v', 'k');
    expect(await db.get('s', 'k')).toBe('v');
  });
  it('אזור הזמן ירושלים זמין', () => {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false });
    expect(f.format(new Date('2026-06-07T12:00:00Z'))).toBe('15');
  });
});
