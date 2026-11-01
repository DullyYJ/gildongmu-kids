# 사용: python3 mkfr.py → mk/juksun_*, mk/bbosong_*  (히뽀 = bbosong_0 신발 0번)
import asyncio, base64, io, json, os, sys
from playwright.async_api import async_playwright
from PIL import Image
D=os.path.dirname(os.path.abspath(__file__)); M=json.load(open(D+'/f_walk_meta.json')); SP=json.load(open(D+'/f_act_specs.json'))
POSES=['sit','sleep','happy','shiver','pant','squint','x1','x2']
def dec(d): return Image.open(io.BytesIO(base64.b64decode(d.split(',')[1]))).convert('RGBA')
T=[('juksun','panda',{'bb':'L'},'juksun','panda'),('bbosong','hippo',{'shoe':0},'bbosong_0','hippo')]
async def main(only):
    os.makedirs(D+'/mk',exist_ok=True)
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        p=await b.new_page(viewport={'width':512,'height':512}); p.on('pageerror',lambda e:print('pageerror',e))
        await p.goto('file://'+D+'/render3.html'); await p.wait_for_function('window.ready',timeout=60000)
        for name,id,opt,mk,sk in T:
            if only and name not in only: continue
            await p.evaluate("v=>{window.OV=v}",M[mk]['view']); await p.evaluate("a=>window.setup(a[0],a[1])",[id,opt])
            async def both(tag,i,expr,arg):
                await p.evaluate("()=>{window.MK=false}"); im=dec(await p.evaluate(expr,arg))
                await p.evaluate("()=>{window.MK=true}"); m=dec(await p.evaluate(expr,arg)); await p.evaluate("()=>{window.MK=false}")
                im.save(f'{D}/mk/{name}_{tag}{i:02d}.png'); m.save(f'{D}/mk/{name}_{tag}{i:02d}_m.png')
            for i in range(16): await both('w',i,"ph=>window.frameWalk(ph)",i/16)
            for i,n in enumerate(POSES): await both('p',i,"n=>window.framePose(n)",n)
            for i,s in enumerate(SP[sk]): await both('a',i,"sp=>window.frameSpec(sp)",s['spec'])
            print('done',name,flush=True)
        await b.close()
asyncio.run(main(sys.argv[1].split(',') if len(sys.argv)>1 else None))
