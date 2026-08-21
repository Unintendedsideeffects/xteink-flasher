import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

describe('getCommunityFirmwareRemoteData', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and parses the latest ForkDrift release metadata', async () => {
    const mockRelease = {
      name: '3109-dev',
      tag_name: 'latest',
      published_at: '2026-02-23T22:40:01Z',
      assets: [
        {
          name: 'crosspoint-lean.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-lean.bin',
        },
        {
          name: 'crosspoint-standard.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-standard.bin',
        },
        {
          name: 'firmware-20260726-39072d6.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/firmware-20260726-39072d6.bin',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getCommunityFirmwareRemoteData } =
      await import('@/remote/firmwareFetcher');
    const result = await getCommunityFirmwareRemoteData();

    expect(result).toEqual({
      crossPoint: {
        version: '3109-dev',
        releaseDate: '2026-02-23',
        downloadUrl:
          'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-standard.bin',
      },
    });
  });

  it('picks crosspoint-standard.bin when sibling assets appear earlier in the list', async () => {
    const mockRelease = {
      name: '3109-dev',
      tag_name: 'latest',
      published_at: '2026-02-23T22:40:01Z',
      assets: [
        {
          name: 'crosspoint-full.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-full.bin',
        },
        {
          name: 'crosspoint-standard.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-standard.bin',
        },
        {
          name: 'crosspoint-lean.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-lean.bin',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getCommunityFirmwareRemoteData } =
      await import('@/remote/firmwareFetcher');
    const result = await getCommunityFirmwareRemoteData();

    expect(result.crossPoint.downloadUrl).toBe(
      'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-standard.bin',
    );
  });

  it('calls the ForkDrift tags/latest endpoint and not upstream endpoint', async () => {
    const mockRelease = {
      name: '3109-dev',
      tag_name: 'latest',
      published_at: '2026-02-23T22:40:01Z',
      assets: [
        {
          name: 'crosspoint-standard.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-standard.bin',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getCommunityFirmwareRemoteData } =
      await import('@/remote/firmwareFetcher');
    await getCommunityFirmwareRemoteData();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('Unintendedsideeffects/ForkDrift-crosspointReader');
    expect(url).toContain('/releases/tags/latest');
    expect(url).not.toContain(['dave', 'allie'].join(''));
    expect(url).not.toMatch(/\/releases\x2flatest$/);
  });

  it('throws an error with status code on non-OK response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getCommunityFirmwareRemoteData } =
      await import('@/remote/firmwareFetcher');

    await expect(getCommunityFirmwareRemoteData()).rejects.toThrow(/403/);
  });

  it('throws when crosspoint-standard.bin asset is missing', async () => {
    const mockRelease = {
      name: '3109-dev',
      tag_name: 'latest',
      published_at: '2026-02-23T22:40:01Z',
      assets: [
        {
          name: 'crosspoint-lean.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-lean.bin',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getCommunityFirmwareRemoteData } =
      await import('@/remote/firmwareFetcher');

    await expect(getCommunityFirmwareRemoteData()).rejects.toThrow(
      /crosspoint-standard\.bin/,
    );
  });

  it('throws a descriptive error rather than a TypeError on malformed payload without assets', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getCommunityFirmwareRemoteData } =
      await import('@/remote/firmwareFetcher');

    let caughtError: unknown;
    try {
      await getCommunityFirmwareRemoteData();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError).not.toBeInstanceOf(TypeError);
    expect((caughtError as Error).message).toContain('Unexpected');
  });

  it('falls back to tag_name when name is absent', async () => {
    const mockRelease = {
      tag_name: 'latest',
      published_at: '2026-02-23T22:40:01Z',
      assets: [
        {
          name: 'crosspoint-standard.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-standard.bin',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getCommunityFirmwareRemoteData } =
      await import('@/remote/firmwareFetcher');
    const result = await getCommunityFirmwareRemoteData();

    expect(result.crossPoint.version).toBe('latest');
  });

  it('caches the result on success so subsequent calls do not re-fetch', async () => {
    const mockRelease = {
      name: '3109-dev',
      tag_name: 'latest',
      published_at: '2026-02-23T22:40:01Z',
      assets: [
        {
          name: 'crosspoint-standard.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-standard.bin',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getCommunityFirmwareRemoteData } =
      await import('@/remote/firmwareFetcher');
    const result1 = await getCommunityFirmwareRemoteData();
    const result2 = await getCommunityFirmwareRemoteData();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result1).toEqual(result2);
  });

  it('does not cache failures, retrying the fetch on subsequent calls', async () => {
    const mockRelease = {
      name: '3109-dev',
      tag_name: 'latest',
      published_at: '2026-02-23T22:40:01Z',
      assets: [
        {
          name: 'crosspoint-standard.bin',
          browser_download_url:
            'https://github.com/Unintendedsideeffects/ForkDrift-crosspointReader/releases/download/latest/crosspoint-standard.bin',
        },
      ],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockRelease,
      });
    vi.stubGlobal('fetch', fetchMock);

    const { getCommunityFirmwareRemoteData } =
      await import('@/remote/firmwareFetcher');

    await expect(getCommunityFirmwareRemoteData()).rejects.toThrow(/500/);

    const result = await getCommunityFirmwareRemoteData();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.crossPoint.version).toBe('3109-dev');
  });
});
