import { describe, expect, it } from 'vitest';
import { isEqualBytes, leBytesToU32, u32ToLeBytes } from '@/utils/bytes';

describe('u32ToLeBytes', () => {
  it('converts 0 to little-endian bytes', () => {
    expect(u32ToLeBytes(0)).toEqual(new Uint8Array([0, 0, 0, 0]));
  });

  it('converts 1 to little-endian bytes', () => {
    expect(u32ToLeBytes(1)).toEqual(new Uint8Array([1, 0, 0, 0]));
  });

  it('converts 0x12345678 to little-endian bytes', () => {
    expect(u32ToLeBytes(0x12345678)).toEqual(
      new Uint8Array([0x78, 0x56, 0x34, 0x12]),
    );
  });

  it('converts 0xffffffff to little-endian bytes', () => {
    expect(u32ToLeBytes(0xffffffff)).toEqual(
      new Uint8Array([0xff, 0xff, 0xff, 0xff]),
    );
  });
});

describe('leBytesToU32', () => {
  it('round-trips 0', () => {
    expect(leBytesToU32(u32ToLeBytes(0))).toBe(0);
  });

  it('round-trips 1', () => {
    expect(leBytesToU32(u32ToLeBytes(1))).toBe(1);
  });

  it('round-trips 0x12345678', () => {
    expect(leBytesToU32(u32ToLeBytes(0x12345678))).toBe(0x12345678);
  });

  it('round-trips 0xffffffff to 4294967295', () => {
    expect(leBytesToU32(u32ToLeBytes(0xffffffff))).toBe(4294967295);
  });

  it('handles empty input returning 0', () => {
    expect(leBytesToU32(new Uint8Array([]))).toBe(0);
  });

  it('handles short input treating missing bytes as 0', () => {
    expect(leBytesToU32(new Uint8Array([1, 2]))).toBe(513);
  });
});

describe('isEqualBytes', () => {
  it('returns true for equal arrays', () => {
    expect(
      isEqualBytes(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3, 4])),
    ).toBe(true);
  });

  it('returns false for same length with different content', () => {
    expect(
      isEqualBytes(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 9, 4])),
    ).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(
      isEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4])),
    ).toBe(false);
  });

  it('returns true for two empty arrays', () => {
    expect(isEqualBytes(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});
