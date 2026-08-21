import { describe, expect, it } from 'vitest';
import OtaPartition from '@/esp/OtaPartition';
import {
  OtaPartitionState,
  otaPartitionStateToBytes,
} from '@/esp/OtaPartitionState';
import { isEqualBytes, u32ToLeBytes } from '@/utils/bytes';
import { generateCrc32Le } from '@/utils/crc';

const OTADATA_SIZE = 0x2000;

function buildOtadata(
  slots: {
    app0?: { sequence: number; state: OtaPartitionState; corruptCrc?: boolean };
    app1?: { sequence: number; state: OtaPartitionState; corruptCrc?: boolean };
  } = {},
): Uint8Array {
  const data = new Uint8Array(OTADATA_SIZE).fill(0xff);
  (['app0', 'app1'] as const).forEach((label) => {
    const slot = slots[label];
    if (!slot) return;
    const offset = label === 'app1' ? 0x1000 : 0;
    data.set(u32ToLeBytes(slot.sequence), offset);
    data.set(otaPartitionStateToBytes(slot.state), offset + 0x18);
    const crc = slot.corruptCrc
      ? new Uint8Array([0xde, 0xad, 0xbe, 0xef])
      : generateCrc32Le(slot.sequence);
    data.set(crc, offset + 0x1c);
  });
  return data;
}

describe('OtaPartition', () => {
  it('selects slot with higher sequence as boot slot (app1 higher)', () => {
    const data = buildOtadata({
      app0: { sequence: 5, state: OtaPartitionState.VALID },
      app1: { sequence: 9, state: OtaPartitionState.VALID },
    });
    const ota = new OtaPartition(data);

    expect(ota.getCurrentBootPartitionLabel()).toBe('app1');
    expect(ota.getCurrentBackupPartitionLabel()).toBe('app0');
  });

  it('selects slot with higher sequence as boot slot (app0 higher)', () => {
    const data = buildOtadata({
      app0: { sequence: 9, state: OtaPartitionState.VALID },
      app1: { sequence: 5, state: OtaPartitionState.VALID },
    });
    const ota = new OtaPartition(data);

    expect(ota.getCurrentBootPartitionLabel()).toBe('app0');
    expect(ota.getCurrentBackupPartitionLabel()).toBe('app1');
  });

  it('skips INVALID state even with higher sequence', () => {
    const data = buildOtadata({
      app0: { sequence: 5, state: OtaPartitionState.VALID },
      app1: { sequence: 9, state: OtaPartitionState.INVALID },
    });
    const ota = new OtaPartition(data);

    expect(ota.getCurrentBootPartitionLabel()).toBe('app0');
  });

  it('skips ABORTED state even with higher sequence', () => {
    const data = buildOtadata({
      app0: { sequence: 5, state: OtaPartitionState.VALID },
    });
    // Write ABORTED directly because otaPartitionStateToBytes throws on ABORTED
    const offset = 0x1000;
    data.set(u32ToLeBytes(9), offset);
    data.set(u32ToLeBytes(4), offset + 0x18); // 4 = ABORTED
    data.set(generateCrc32Le(9), offset + 0x1c);

    const ota = new OtaPartition(data);
    expect(ota.getCurrentBootPartitionLabel()).toBe('app0');
  });

  it('disqualifies a slot with a corrupt CRC', () => {
    const data = buildOtadata({
      app0: { sequence: 5, state: OtaPartitionState.VALID },
      app1: { sequence: 9, state: OtaPartitionState.VALID, corruptCrc: true },
    });
    const ota = new OtaPartition(data);

    expect(ota.getCurrentBootPartitionLabel()).toBe('app0');
  });

  it('falls back to app0 when no valid slots exist', () => {
    const data = buildOtadata({
      app0: { sequence: 5, state: OtaPartitionState.VALID, corruptCrc: true },
      app1: { sequence: 9, state: OtaPartitionState.VALID, corruptCrc: true },
    });
    const ota = new OtaPartition(data);

    expect(ota.getCurrentBootPartition()).toBeUndefined();
    expect(ota.getCurrentBootPartitionLabel()).toBe('app0');
  });

  it('bumps sequence past current boot slot when setBootPartition is called', () => {
    const data = buildOtadata({
      app0: { sequence: 5, state: OtaPartitionState.VALID },
      app1: { sequence: 9, state: OtaPartitionState.VALID },
    });
    const app1PreBytes = data.slice(0x1000, 0x1020);
    const ota = new OtaPartition(data);

    ota.setBootPartition('app0');

    expect(ota.getCurrentBootPartitionLabel()).toBe('app0');
    const [app0] = ota.otaAppPartitions();
    expect(app0.sequence).toBe(10);
    expect(app0.state).toBe(OtaPartitionState.NEW);
    expect(app0.crcValid).toBe(true);

    const app1PostBytes = data.slice(0x1000, 0x1020);
    expect(isEqualBytes(app1PreBytes, app1PostBytes)).toBe(true);
  });

  it('is a no-op when setBootPartition targets the currently booting slot', () => {
    const data = buildOtadata({
      app0: { sequence: 5, state: OtaPartitionState.VALID },
      app1: { sequence: 9, state: OtaPartitionState.VALID },
    });
    const preCallBytes = data.slice();
    const ota = new OtaPartition(data);

    ota.setBootPartition('app1');

    expect(isEqualBytes(data, preCallBytes)).toBe(true);
  });

  it('invalidates cache so subsequent reads reflect updated partition state', () => {
    const data = buildOtadata({
      app0: { sequence: 5, state: OtaPartitionState.VALID },
      app1: { sequence: 9, state: OtaPartitionState.VALID },
    });
    const ota = new OtaPartition(data);

    const initialPartitions = ota.otaAppPartitions();
    expect(initialPartitions[0].sequence).toBe(5);

    ota.setBootPartition('app0');

    const updatedPartitions = ota.otaAppPartitions();
    expect(updatedPartitions[0].sequence).toBe(10);
  });
});
