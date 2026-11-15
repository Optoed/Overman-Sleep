import { ImageResponse } from 'next/og';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';
export default function Icon() {
  return new ImageResponse(<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#191919', color: '#fff', width: '100%', height: '100%', fontSize: 90, fontWeight: 800 }}>B.</div>, size);
}
