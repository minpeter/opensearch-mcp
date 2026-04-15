import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TtlCache } from '../cache.ts';

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves a value', () => {
    const cache = new TtlCache<string, string>(60_000);
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  it('has() returns true for a cached key', () => {
    const cache = new TtlCache<string, number>(60_000);
    cache.set('num', 42);
    expect(cache.has('num')).toBe(true);
  });

  it('returns undefined for missing key', () => {
    const cache = new TtlCache<string, string>(60_000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('has() returns false for missing key', () => {
    const cache = new TtlCache<string, string>(60_000);
    expect(cache.has('missing')).toBe(false);
  });

  it('returns undefined after TTL expiry', () => {
    const cache = new TtlCache<string, string>(60_000);
    cache.set('key', 'value');
    vi.advanceTimersByTime(61_000);
    expect(cache.get('key')).toBeUndefined();
  });

  it('has() returns false after TTL expiry', () => {
    const cache = new TtlCache<string, string>(60_000);
    cache.set('key', 'value');
    vi.advanceTimersByTime(61_000);
    expect(cache.has('key')).toBe(false);
  });

  it('works with array values', () => {
    const cache = new TtlCache<string, number[]>(60_000);
    cache.set('arr', [1, 2, 3]);
    expect(cache.get('arr')).toEqual([1, 2, 3]);
  });

  it('works with object values', () => {
    const cache = new TtlCache<string, { name: string }>(60_000);
    cache.set('obj', { name: 'test' });
    expect(cache.get('obj')).toEqual({ name: 'test' });
  });
});
