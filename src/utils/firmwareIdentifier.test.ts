import { describe, expect, it } from 'vitest';
import {
  FirmwareInfo,
  identifyFirmware,
  isIdentificationSuccessful,
} from '@/utils/firmwareIdentifier';

function buildImage(payload: string, { valid = true } = {}): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const data = new Uint8Array(0x40 + body.length);
  data[0] = valid ? 0xe9 : 0x00;
  // App descriptor magic 0xabcd5432, little-endian, at offset 0x20.
  data.set(new Uint8Array([0x32, 0x54, 0xcd, 0xab]), 0x20);
  data.set(body, 0x40);
  return data;
}

describe('identifyFirmware', () => {
  it('identifies official Chinese firmware when XTOS is in proximity', () => {
    const result = identifyFirmware(buildImage('V3.1.9 XTOS build'));
    expect(result.type).toBe('official-chinese');
    expect(result.version).toBe('V3.1.9');
  });

  it('identifies official English firmware when no XTOS is nearby', () => {
    const result = identifyFirmware(buildImage('V3.1.1 build info'));
    expect(result.type).toBe('official-english');
    expect(result.version).toBe('V3.1.1');
  });

  it('identifies as English when XTOS is too far away (>50 bytes)', () => {
    const payload = `V3.1.1${' '.repeat(80)}XTOS`;
    const result = identifyFirmware(buildImage(payload));
    expect(result.type).toBe('official-english');
  });

  it('identifies CrossPoint firmware and extracts version', () => {
    const result = identifyFirmware(buildImage('CrossPoint-ESP32-0.12.0'));
    expect(result.type).toBe('crosspoint');
    expect(result.version).toBe('0.12.0');
  });

  it('identifies CrossPoint firmware via log-string path', () => {
    const result = identifyFirmware(buildImage('Starting CrossPoint version'));
    expect(result.type).toBe('crosspoint');
  });

  it('falls through to unknown when ESP32 header is invalid', () => {
    const result = identifyFirmware(
      buildImage('V3.1.1 XTOS', { valid: false }),
    );
    expect(result.type).toBe('unknown');
  });

  it('identifies unrecognized image as unknown', () => {
    const result = identifyFirmware(buildImage('nothing recognisable here'));
    expect(result.type).toBe('unknown');
  });

  it('handles empty input gracefully without throwing', () => {
    const result = identifyFirmware(new Uint8Array());
    expect(result.type).toBe('unknown');
    expect(result.version).toBe('unknown');
  });
});

describe('isIdentificationSuccessful', () => {
  it('returns true for known types and false for unknown', () => {
    const chinese: FirmwareInfo = {
      type: 'official-chinese',
      version: 'V1.0.0',
      displayName: 'Official Chinese',
    };
    const english: FirmwareInfo = {
      type: 'official-english',
      version: 'V1.0.0',
      displayName: 'Official English',
    };
    const crosspoint: FirmwareInfo = {
      type: 'crosspoint',
      version: '0.1.0',
      displayName: 'CrossPoint Community Reader',
    };
    const unknown: FirmwareInfo = {
      type: 'unknown',
      version: 'unknown',
      displayName: 'Custom/Unknown Firmware',
    };

    expect(isIdentificationSuccessful(chinese)).toBe(true);
    expect(isIdentificationSuccessful(english)).toBe(true);
    expect(isIdentificationSuccessful(crosspoint)).toBe(true);
    expect(isIdentificationSuccessful(unknown)).toBe(false);
  });
});
