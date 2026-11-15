/** Continuous value noise, shared by terrain geometry and its normal samples. */
export function terrainNoise(x:number,z:number) {
  const hash=(a:number,b:number)=>{const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n);};
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
  const a=hash(ix,iz),b=hash(ix+1,iz),c=hash(ix,iz+1),d=hash(ix+1,iz+1);
  return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
}
export function terrainFbm(x:number,z:number) {let n=0,a=.55;for(let i=0;i<5;i++){n+=terrainNoise(x,z)*a;x=x*2.07+13.1;z=z*2.03-8.2;a*=.49;}return n;}
