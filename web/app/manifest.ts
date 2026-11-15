import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Overman · Сон и твой мир', short_name: 'Overman', description: 'Твой ритм сна, история ночей и живая башня.',
    start_url: '/', display: 'standalone', background_color: '#11121c', theme_color: '#11121c', lang: 'ru',
    icons: [
      { src: '/app-icon?size=192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
