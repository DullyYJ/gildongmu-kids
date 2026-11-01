from PIL import Image, ImageDraw
import math
SS=4
def col(c):
    c=c.lstrip('#'); r,g,b=int(c[0:2],16),int(c[2:4],16),int(c[4:6],16); al=int(c[6:8],16) if len(c)>=8 else 255
    return (r,g,b,al)
def dk(c): return (int(c[0]*.62),int(c[1]*.62),int(c[2]*.62),c[3])
class R:
    def __init__(s,img,cx,cy,u):
        s.d=ImageDraw.Draw(img,'RGBA'); s.cx,s.cy,s.u=cx*SS,cy*SS,u*SS
    def P(s,x,y): return (s.cx+x/100*s.u, s.cy+y/100*s.u)
    def poly(s,pts,c,ol):
        s.d.polygon(pts,fill=c)
        if ol: s.d.line(pts+[pts[0]],fill=dk(c),width=max(1,int(.022*s.u)),joint='curve')
    def run(s,art):
        for op in art.split(';'):
            t=op.split(' '); k=t[0]
            if k in ('o','O','r','R','t','T','p','P','h','H','s','S'):
                ol=k.islower(); k=k.lower()
                if k=='p':
                    c=col(t[1]); n=[float(x) for x in t[2:]]; s.poly([s.P(n[i],n[i+1]) for i in range(0,len(n),2)],c,ol); continue
                c=col(t[-1]); n=[float(x) for x in t[1:-1]]
                if k=='o':
                    x,y,rx,ry=n; s.poly([s.P(x+rx*math.cos(a*math.pi/18),y+ry*math.sin(a*math.pi/18)) for a in range(36)],c,ol)
                elif k=='r':
                    x,y,w,h,rad=n; rad=min(rad,w/2,h/2); pts=[]
                    for cxx,cyy,a0 in ((x+w/2-rad,y-h/2+rad,-90),(x+w/2-rad,y+h/2-rad,0),(x-w/2+rad,y+h/2-rad,90),(x-w/2+rad,y-h/2+rad,180)):
                        for j in range(0,91,15):
                            a=(a0+j)*math.pi/180; pts.append(s.P(cxx+rad*math.cos(a),cyy+rad*math.sin(a)))
                    s.poly(pts,c,ol)
                elif k=='t': s.poly([s.P(n[0],n[1]),s.P(n[2],n[3]),s.P(n[4],n[5])],c,ol)
                elif k=='h':
                    x,y,r=n; pts=[]
                    for j in range(41):
                        a=j/40*2*math.pi; hx=16*math.sin(a)**3; hy=-(13*math.cos(a)-5*math.cos(2*a)-2*math.cos(3*a)-math.cos(4*a))
                        pts.append(s.P(x+hx/17*r,y+hy/17*r*0.95-r*.1))
                    s.poly(pts,c,ol)
                elif k=='s':
                    x,y,r=n; pts=[]
                    for j in range(10):
                        a=(-90+j*36)*math.pi/180; rr=r if j%2==0 else r*.45; pts.append(s.P(x+rr*math.cos(a),y+rr*math.sin(a)))
                    s.poly(pts,c,ol)
            elif k=='l':
                x1,y1,x2,y2,w=[float(v) for v in t[1:6]]; c=col(t[6]); a=s.P(x1,y1); b=s.P(x2,y2); wd=max(1,int(w/100*s.u))
                s.d.line([a,b],fill=c,width=wd); r=wd/2
                for p in (a,b): s.d.ellipse([p[0]-r,p[1]-r,p[0]+r,p[1]+r],fill=c)
            elif k=='q':
                x1,y1,cx,cy,x2,y2,w=[float(v) for v in t[1:8]]; c=col(t[8]); pts=[]
                for j in range(17):
                    u=j/16; pts.append(s.P((1-u)**2*x1+2*(1-u)*u*cx+u*u*x2,(1-u)**2*y1+2*(1-u)*u*cy+u*u*y2))
                s.d.line(pts,fill=c,width=max(1,int(w/100*s.u)),joint='curve')
            elif k=='a':
                x,y,r=[float(v) for v in t[1:4]]; a0,a1=float(t[4]),float(t[5]); w=float(t[6]); c=col(t[7]); pts=[]
                if a1<a0: a1+=360
                for j in range(25):
                    a=(a0+(a1-a0)*j/24)*math.pi/180; pts.append(s.P(x+r*math.cos(a),y+r*math.sin(a)))
                s.d.line(pts,fill=c,width=max(1,int(w/100*s.u)),joint='curve')
            elif k=='e':
                x,y,rx,ry,w=[float(v) for v in t[1:6]]; c=col(t[6]); pts=[s.P(x+rx*math.cos(a*math.pi/18),y+ry*math.sin(a*math.pi/18)) for a in range(37)]
                s.d.line(pts,fill=c,width=max(1,int(w/100*s.u)),joint='curve')
def render(items,cols,cell=128,bg=(235,235,235,255),scale=.55):
    rows=(len(items)+cols-1)//cols; W=Image.new('RGBA',(cols*cell*SS,rows*cell*SS),bg)
    for i,a in enumerate(items):
        R(W,(i%cols)*cell+cell/2,(i//cols)*cell+cell/2,cell*scale).run(a)
    return W.resize((cols*cell,rows*cell),Image.LANCZOS)
