import { ImageResponse } from 'next/og';
export function GET(request: Request) {
  const size = new URL(request.url).searchParams.get('size') === '192' ? 192 : 512;
  return new ImageResponse(<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#191919', color: '#fff', width: '100%', height: '100%', fontSize: size * .48, fontWeight: 800 }}>B.</div>,
    { width: size, height: size });
}
