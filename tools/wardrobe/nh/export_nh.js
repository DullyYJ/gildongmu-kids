// 사용: cd tools/chars3d && npm i three@0.160.0 playwright && cp node_modules/three/build/three.min.js . && python3 prep_tex.py src2d && node export.js lovel,dolsom,ppopu,chaeng,sul,dudung 16 14 && python3 assemble.py  → out/*.webp 를 www/chars3d 로 복사(바닥줄·중심은 fr/meta.json 을 앱 D3·OverlayPlugin.cfg3 에 옮긴다)
// 순서: ① 넉넉한 카메라로 모든 프레임의 범위를 재서 ② 캐릭터마다 카메라(view)를 딱 맞추고 ③ 다시 렌더 → fr/<id>/*.png, fr/meta.json(칸 안 바닥줄·몸 중심·크기)
const {chromium}=require('playwright');const fs=require('fs');
const ids=process.argv[2].split(',');const N=+process.argv[3]||16;const NI=+process.argv[4]||14;
const EL=0.2,GROUND_MODE={sul:'bottom',chaeng:'bottom',dolsom:'bottom',lovel:'bottom',ppopu:'bottom',dudung:'bottom'};   // 땅을 딛는 캐릭터는 원점(발 밑)을, 날고 헤엄치는 캐릭터는 가장 낮은 점을 바닥줄로 쓴다
const PNG=require('zlib');
function alphaBox(buf,S){ // PNG → 알파 범위 (브라우저에서 계산하는 게 간단해서 page.evaluate 로 한다)
}
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage();p.on('pageerror',e=>console.log('err',e.message));
await p.goto('file://' + __dirname + '/render.html');await p.waitForFunction('window.ready',null,{timeout:30000});if(process.env.NOHELM){const du='data:image/png;base64,'+fs.readFileSync(__dirname+'/nh_head.png').toString('base64');await p.evaluate(async d=>{const im=new Image();im.src=d;await im.decode();window.TEXIMG.dudung_head_nh=im;window.NOHELM=true;},du);}
// 알파 범위 재기: dataURL → 캔버스
const box=d=>p.evaluate(async d=>{const im=new Image();im.src=d;await im.decode();const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');x.drawImage(im,0,0);const a=x.getImageData(0,0,512,512).data;let x0=999,x1=-1,y0=999,y1=-1;for(let y=0;y<512;y++)for(let xx=0;xx<512;xx++){if(a[(y*512+xx)*4+3]>24){if(xx<x0)x0=xx;if(xx>x1)x1=xx;if(y<y0)y0=y;if(y>y1)y1=y;}}return [x0,x1,y0,y1];},d);
const meta={};
for(const id of ids){
  const frames=async(cb)=>{const out=[];for(let i=0;i<N;i++)out.push(await p.evaluate(ph=>window.frame(ph),i/N));if(id==='dudung'){for(let i=0;i<NI;i++)out.push(await p.evaluate(u=>window.frameIntro(u),i/(NI-1)));await p.evaluate(()=>window.cleanup());}return out;};
  // ① 넉넉한 카메라(크기 8, 중심 (0,1.5,0))로 범위 측정
  const V0=[8,1.5,0];await p.evaluate(v=>{window.OV=v;},V0);await p.evaluate(id=>window.setup(id),id);
  let bx=[999,-1,999,-1];for(const d of await frames()){const q=await box(d);bx=[Math.min(bx[0],q[0]),Math.max(bx[1],q[1]),Math.min(bx[2],q[2]),Math.max(bx[3],q[3])];}
  const k=V0[0]/512;                       // px → 화면 단위
  const wU=(bx[1]-bx[0]+1)*k,hU=(bx[3]-bx[2]+1)*k,midX=(bx[0]+bx[1])/2,midY=(bx[2]+bx[3])/2;
  const size=Math.max(wU,hU)*1.06;
  const cx=V0[2]+(midX-256)*k,cy=V0[1]+(256-midY)*k/Math.cos(EL);
  let V=[+size.toFixed(3),+cy.toFixed(3),+cx.toFixed(3)];
  if(process.env.FIXV){const fv=JSON.parse(process.env.FIXV)[id];if(fv){V=fv;console.log('FIXV',id,JSON.stringify(V),'측정한 범위로 맞췄다면',JSON.stringify([+size.toFixed(3),+cy.toFixed(3),+cx.toFixed(3)]));}}
  // ② 맞춘 카메라로 다시 렌더
  await p.evaluate(v=>{window.OV=v;},V);await p.evaluate(id=>window.setup(id),id);fs.mkdirSync(`${process.env.OUT||'fr'}/${id}`,{recursive:true});
  let lowest=-1,f2=0;const all=await frames();
  for(let i=0;i<all.length;i++){const isIntro=(id==='dudung'&&i>=N);const nm=isIntro?`intro_${String(i-N).padStart(2,'0')}`:`loop_${String(i).padStart(2,'0')}`;fs.writeFileSync(`${process.env.OUT||'fr'}/${id}/${nm}.png`,Buffer.from(all[i].split(',')[1],'base64'));if(!isIntro){const q=await box(all[i]);if(q[3]>lowest)lowest=q[3];}}
  const sc=256/V[0]/1;  // 화면 단위 → 256칸 px  (512px 프레임 → 칸 256 이므로 ×0.5 포함)
  const originY=(256+V[1]*Math.cos(EL)/V[0]*512)/2, originX=(256-V[2]/V[0]*512)/2;
  const bottomRow=(lowest+1)/2;
  meta[id]={view:V,size:V[0],originX:+originX.toFixed(1),originY:+originY.toFixed(1),bottomRow:+bottomRow.toFixed(1),mode:GROUND_MODE[id]||'ground',base:+((GROUND_MODE[id]==='bottom')?bottomRow:originY).toFixed(1),ox:+originX.toFixed(1)};
  console.log('done',id,JSON.stringify(meta[id]));
}
fs.writeFileSync(`${process.env.OUT||'fr'}/meta.json`,JSON.stringify(meta,null,1));
await b.close();})();
