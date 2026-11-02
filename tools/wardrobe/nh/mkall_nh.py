# 사용: python3 mkall.py <id,...>  → mk/<id>_{w,p,a}NN.png (정규 프레임 512) · ..._m.png (부위 색칠 512: R 몸통 G 머리 B 팔다리)
import asyncio, base64, io, json, math, os, sys
from playwright.async_api import async_playwright
from PIL import Image
EL=0.2; BASE={'dolsom':248.5,'lovel':250,'ppopu':248.5,'chaeng':244.5,'sul':230.5,'dudung':222.5}
FLOAT={'chaeng':['sit','sleep','happy','shiver','pant','squint'],'sul':['happy','pant']}; HOP=['happy']
NAMES=['sit','sleep','happy','shiver','pant','squint']
D=os.path.dirname(os.path.abspath(__file__))
MW=json.load(open(D+'/meta.json')); MA=json.load(open(D+'/meta_all.json')); MF=json.load(open(D+'/meta_fit.json'))
SPEC={'dolsom':'dog_acts','ppopu':'dog_acts','lovel':'lovel_acts','dudung':'dudung_acts','sul':'sul_acts','chaeng':'chaeng_acts'}
def dec(d): return Image.open(io.BytesIO(base64.b64decode(d.split(',')[1]))).convert('RGBA')
def lowrow(im): bb=im.split()[3].point(lambda v:255 if v>24 else 0).getbbox(); return bb[3]-1 if bb else -1
async def main(ids):
    os.makedirs(D+'/mk_nh',exist_ok=True)
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        for cid in ids:
            def save(tag,i,im,m): im.save(f'{D}/mk_nh/{cid}_{tag}{i:02d}.png'); m.save(f'{D}/mk_nh/{cid}_{tag}{i:02d}_m.png')
            # 걷기
            p=await b.new_page(viewport={'width':512,'height':512}); p.on('pageerror',lambda e:print('pageerror',e))
            await p.goto('file://'+D+'/render.html'); await p.wait_for_function('window.ready',timeout=60000)
            du='data:image/png;base64,'+base64.b64encode(open(D+'/nh_head.png','rb').read()).decode()
            await p.evaluate("async d=>{const im=new Image();im.src=d;await im.decode();window.TEXIMG.dudung_head_nh=im;window.NOHELM=true;}",du)
            await p.evaluate("v=>{window.OV=v}",MA[cid]['view']); await p.evaluate("id=>window.setup(id)",cid)
            for i in range(16):
                await p.evaluate("()=>{window.MK=false}"); im=dec(await p.evaluate("ph=>window.frame(ph)",i/16))
                await p.evaluate("()=>{window.MK=true}"); m=dec(await p.evaluate("ph=>window.frame(ph)",i/16)); await p.evaluate("()=>{window.MK=false}")
                save('w',i,im,m)
            await p.close()
            # 동작
            p=await b.new_page(viewport={'width':512,'height':512}); p.on('pageerror',lambda e:print('pageerror',e))
            await p.goto('file://'+D+'/render5.html'); await p.wait_for_function('window.ready',timeout=60000)
            du='data:image/png;base64,'+base64.b64encode(open(D+'/nh_head.png','rb').read()).decode()
            await p.evaluate("async d=>{const im=new Image();im.src=d;await im.decode();window.TEXIMG.dudung_head_nh=im;window.NOHELM=true;}",du)
            V=MF[cid]['view']; await p.evaluate("v=>{window.OV=v}",V)
            specs=json.load(open(D+'/'+SPEC[cid]+'.json'))
            for i,s in enumerate(specs):
                sp=dict(s['spec']); sp['dy']=0
                try:
                    im=dec(await p.evaluate("a=>window.frameAct(a)",[cid,sp])); tot=0
                    if not sp.get('float'):
                        for it in range(14):
                            e=lowrow(im)-(2*BASE[cid]-1)
                            if abs(e)<=1: break
                            tot+=e*V[0]/512/math.cos(EL); sp['dy']=tot; im=dec(await p.evaluate("a=>window.frameAct(a)",[cid,sp]))
                    await p.evaluate("()=>{window.MK=true}"); m=dec(await p.evaluate("a=>window.frameAct(a)",[cid,sp])); await p.evaluate("()=>{window.MK=false}")
                except Exception as e:
                    print('ERR',cid,s['name'],str(e)[:150]); continue
                save('a',i,im,m)
            await p.close(); print('done',cid,flush=True)
        await b.close()
asyncio.run(main(sys.argv[1].split(',')))
