# 사용: python3 act5.py <id> <specs.json> <out.png> [sheet.webp]   specs = [{name, spec}]  spec.float=true 이면 바닥 맞춤을 하지 않는다
import asyncio, base64, io, json, math, os, sys
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
EL=0.2; BASE={'dolsom':248.5,'lovel':250,'ppopu':248.5,'chaeng':244.5,'sul':230.5,'dudung':222.5}
D=os.path.dirname(os.path.abspath(__file__)); M=json.load(open(D+'/meta_fit.json'))
cid=sys.argv[1]; specs=json.load(open(sys.argv[2])); out=sys.argv[3]; sheet=sys.argv[4] if len(sys.argv)>4 else None
def dec(d): return Image.open(io.BytesIO(base64.b64decode(d.split(',')[1]))).convert('RGBA')
def lowrow(im): bb=im.split()[3].point(lambda v:255 if v>24 else 0).getbbox(); return bb[3]-1 if bb else -1
async def main():
    ims=[]
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        p=await b.new_page(viewport={'width':512,'height':512}); p.on('pageerror',lambda e:print('pageerror',e))
        await p.goto('file://'+D+'/render5.html'); await p.wait_for_function('window.ready',timeout=60000)
        du='data:image/png;base64,'+base64.b64encode(open(D+'/nh_head.png','rb').read()).decode()
        await p.evaluate("async d=>{const im=new Image();im.src=d;await im.decode();window.TEXIMG.dudung_head_nh=im;window.NOHELM=true;}",du)
        V=M[cid]['view']; await p.evaluate("v=>{window.OV=v}",V)
        for s in specs:
            sp=dict(s['spec']); sp['dy']=0
            try:
                im=dec(await p.evaluate("a=>window.frameAct(a)",[cid,sp]))
            except Exception as e:
                print('ERR',s['name'],str(e)[:200]); im=Image.new('RGBA',(512,512),(255,0,0,60)); ims.append((s['name'],im,0)); continue
            tot=0
            if not sp.get('float'):
                for it in range(14):
                    e=lowrow(im)-(2*BASE[cid]-1)
                    if abs(e)<=1: break
                    tot+=e*V[0]/512/math.cos(EL); sp['dy']=tot; im=dec(await p.evaluate("a=>window.frameAct(a)",[cid,sp]))
            ims.append((s['name'],im,tot))
        await b.close()
    cols=4; rows=(len(ims)+cols-1)//cols; W=Image.new('RGBA',(256*cols,256*rows),(236,240,246,255)); dr=ImageDraw.Draw(W)
    for i,(n,im,t) in enumerate(ims):
        x,y=(i%cols)*256,(i//cols)*256; W.alpha_composite(im.resize((256,256),Image.LANCZOS),(x,y)); dr.text((x+4,y+4),f'{i} {n}',fill=(120,0,0,255)); dr.line((x,y+BASE[cid],x+256,y+BASE[cid]),fill=(255,0,0,120))
    W.convert('RGB').save(out)
    if sheet:
        sh=Image.new('RGBA',(256*4,256*4),(0,0,0,0))
        for i,(n,im,t) in enumerate(ims):
            sh.paste(im.convert('RGBa').resize((256,256),Image.LANCZOS).convert('RGBA'),((i%4)*256,(i//4)*256))
        sh.save(sheet,'WEBP',quality=84,method=6,alpha_quality=90); print('sheet',sheet,os.path.getsize(sheet)//1024,'KB')
asyncio.run(main())
