import type { NextConfig } from 'next';

const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === 'true';
const repositoryName =
  process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'xteink-flasher';
const pagesBasePath = isGitHubPagesBuild ? `/${repositoryName}` : '';

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    optimizePackageImports: ['@chakra-ui/react'],
  },
  ...(!isGitHubPagesBuild
    ? {
        async headers() {
          return [
            {
              source: '/:path*',
              headers: [
                {
                  key: 'Permissions-Policy',
                  value: 'usb=(self)',
                },
              ],
            },
          ];
        },
      }
    : {}),
  ...(isGitHubPagesBuild
    ? {
        output: 'export',
        trailingSlash: true,
        basePath: pagesBasePath,
        assetPrefix: `${pagesBasePath}/`,
      }
    : {}),
};

export default nextConfig;
