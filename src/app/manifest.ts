import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FORKDRIFT Flash Tools',
    short_name: 'FORKDRIFT Flash',
    description: 'Web-based tool to help flash the FORKDRIFT device',
    start_url: './',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000',
    icons: [
      {
        src: 'icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
