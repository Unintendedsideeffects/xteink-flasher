interface CommunityFirmwareVersions {
  crossPoint: {
    version: string;
    releaseDate: string;
    downloadUrl: string;
  };
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  name?: string;
  tag_name?: string;
  published_at?: string;
  assets?: GithubReleaseAsset[];
}

const FORKDRIFT_REPO = 'Unintendedsideeffects/ForkDrift-crosspointReader';
const FORKDRIFT_RELEASE_CHANNEL = 'latest';
const forkDriftReleaseUrl = `https://api.github.com/repos/${FORKDRIFT_REPO}/releases/tags/${FORKDRIFT_RELEASE_CHANNEL}`;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

const getCached = <T>(key: string): T | null => {
  const cached = memoryCache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() > cached.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return cached.value as T;
};

const setCached = <T>(key: string, value: T, ttlSeconds: number) => {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
};

export async function getCommunityFirmwareRemoteData(): Promise<CommunityFirmwareVersions> {
  const cacheKey = 'firmware-versions.community.v1';

  const value = getCached<CommunityFirmwareVersions>(cacheKey);
  if (value) {
    return value;
  }

  const response = await fetch(forkDriftReleaseUrl);
  if (!response.ok) {
    throw new Error(
      `GitHub API returned ${response.status} for the ForkDrift release`,
    );
  }

  const releaseData: GithubRelease = await response.json();
  if (!Array.isArray(releaseData.assets)) {
    throw new Error('Unexpected GitHub release payload');
  }

  const firmwareAsset = releaseData.assets.find(
    (asset) => asset.name === 'crosspoint-standard.bin',
  );
  if (!firmwareAsset) {
    throw new Error(
      'ForkDrift firmware asset crosspoint-standard.bin not found in the latest release',
    );
  }

  const releaseDate = releaseData.published_at
    ? new Date(releaseData.published_at).toISOString().slice(0, 10)
    : '';

  const data: CommunityFirmwareVersions = {
    crossPoint: {
      version: releaseData.name || releaseData.tag_name || '',
      releaseDate,
      downloadUrl: firmwareAsset.browser_download_url,
    },
  };

  setCached(cacheKey, data, 60 * 60); // 1 hour

  return data;
}

export async function getCommunityFirmware(_firmware: 'CrossPoint') {
  const releaseData = await getCommunityFirmwareRemoteData().then(
    (data) => data.crossPoint,
  );

  const response = await fetch(releaseData.downloadUrl);
  return new Uint8Array(await response.arrayBuffer());
}
