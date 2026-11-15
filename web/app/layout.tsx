import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/golos-text';
import '@fontsource-variable/manrope';
import '@fontsource/press-start-2p/400.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Become Overman — Башня сна',
  description: 'Ты отдыхаешь. Твой мир растёт. Личный ритм сна и башня, которая строится ночь за ночью.',
  applicationName: 'Become Overman',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Overman' },
  icons: { icon: '/icon.svg', apple: '/apple-icon' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#10191b' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
