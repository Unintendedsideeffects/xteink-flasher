import { describe, expect, it } from 'vitest';
import {
  OtaPartitionState,
  otaPartitionStateFromBytes,
  otaPartitionStateToBytes,
} from '@/esp/OtaPartitionState';
import { u32ToLeBytes } from '@/utils/bytes';

describe('otaPartitionStateFromBytes', () => {
  it('maps 0 to NEW', () => {
    expect(otaPartitionStateFromBytes(u32ToLeBytes(0))).toBe(
      OtaPartitionState.NEW,
    );
  });

  it('maps 1 to PENDING_VERIFY', () => {
    expect(otaPartitionStateFromBytes(u32ToLeBytes(1))).toBe(
      OtaPartitionState.PENDING_VERIFY,
    );
  });

  it('maps 2 to VALID', () => {
    expect(otaPartitionStateFromBytes(u32ToLeBytes(2))).toBe(
      OtaPartitionState.VALID,
    );
  });

  it('maps 3 to INVALID', () => {
    expect(otaPartitionStateFromBytes(u32ToLeBytes(3))).toBe(
      OtaPartitionState.INVALID,
    );
  });

  it('maps 4 to ABORTED', () => {
    expect(otaPartitionStateFromBytes(u32ToLeBytes(4))).toBe(
      OtaPartitionState.ABORTED,
    );
  });

  it('maps 0xffffffff to UNDEFINED', () => {
    expect(otaPartitionStateFromBytes(u32ToLeBytes(0xffffffff))).toBe(
      OtaPartitionState.UNDEFINED,
    );
  });

  it('throws on unsupported state value 5', () => {
    expect(() => otaPartitionStateFromBytes(u32ToLeBytes(5))).toThrow(
      'Invalid state',
    );
  });
});

describe('otaPartitionStateToBytes', () => {
  it('round-trips NEW', () => {
    const bytes = otaPartitionStateToBytes(OtaPartitionState.NEW);
    expect(otaPartitionStateFromBytes(bytes)).toBe(OtaPartitionState.NEW);
  });

  it('round-trips PENDING_VERIFY', () => {
    const bytes = otaPartitionStateToBytes(OtaPartitionState.PENDING_VERIFY);
    expect(otaPartitionStateFromBytes(bytes)).toBe(
      OtaPartitionState.PENDING_VERIFY,
    );
  });

  it('round-trips VALID', () => {
    const bytes = otaPartitionStateToBytes(OtaPartitionState.VALID);
    expect(otaPartitionStateFromBytes(bytes)).toBe(OtaPartitionState.VALID);
  });

  it('round-trips INVALID', () => {
    const bytes = otaPartitionStateToBytes(OtaPartitionState.INVALID);
    expect(otaPartitionStateFromBytes(bytes)).toBe(OtaPartitionState.INVALID);
  });

  it('round-trips UNDEFINED', () => {
    const bytes = otaPartitionStateToBytes(OtaPartitionState.UNDEFINED);
    expect(otaPartitionStateFromBytes(bytes)).toBe(OtaPartitionState.UNDEFINED);
  });

  // BUG (documented, not fixed here): fromBytes() produces ABORTED for byte
  // value 4, but toBytes() has no ABORTED branch and throws. Unreachable today
  // because setBootPartition() only ever writes NEW. See plans/001 maintenance
  // notes.
  it('throws when converting ABORTED to bytes', () => {
    expect(() => otaPartitionStateToBytes(OtaPartitionState.ABORTED)).toThrow(
      'Invalid state',
    );
  });
});
