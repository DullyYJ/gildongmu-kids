import art, random
IDS=['ppopu','dolsom','lovel','chaeng','sul','dudung','bbosong','juksun']
NAMES=['뽀푸','둘숑','러블','챙챙','독슐','두덩','히뽀','죽순']
PAL={
'ppopu':[('초코','7b4a2a','f2d3a0','ff6b6b'),('카라멜','c98a4b','fff1c9','5b3a1e'),('쿠키','d9a65a','8a5a2b','fff3d6'),('밤톨','8d5a34','e8c28a','3e7d4a'),('호박','e8892b','ffd36b','6b3f1d'),('꿀','f2b632','fff0a8','a8601a'),('토스트','e5b873','fff5e0','c4622d'),('모카','5e3b2b','d8b08c','ff9aa2'),('밀크티','d2b48c','fffaf0','8b5e3c'),('고구마','a64d79','ffd0e0','e8a33d')],
'dolsom':[('솜사탕','ffd1e8','ffffff','7ec8ff'),('구름','f4f8ff','b7d7ff','ff9ec7'),('눈꽃','e6f2ff','8fc1ff','ffffff'),('우유','fffaf0','ffd9e8','6fb1ff'),('하늘빛','8fd0ff','ffffff','ffcf5a'),('딸기우유','ffb6cf','fff0f5','ff6f9c'),('진주','f5efe6','c8d6ff','ffc2d9'),('블루베리','6f7fe0','dfe5ff','ffd1e8'),('벚꽃','ffc4d8','ffffff','9fd6a8'),('마시멜로','fff3d9','ffc0d9','8fd7ff')],
'lovel':[('달빛','dfe3f5','8c94c8','ffe27a'),('은하','3b3f7a','9aa5ff','ffe27a'),('보랏빛','9a6fd1','e3d1ff','ffd36b'),('안개','b8c0cc','eef1f5','7a8699'),('한밤','262b52','6f79c9','f5d76e'),('별똥','5b4b8a','ffe9a8','ff9ad5'),('라벤더','b79be6','f1e8ff','7bd1c2'),('은빛','c5cad6','ffffff','6a7285'),('연기','8b909c','d9dce3','ff8a7a'),('자수정','7a4fb5','d9c2ff','ffd0f0')],
'chaeng':[('파도','2f6fd1','bfe3ff','ffffff'),('물방울','7fd3ff','e6f7ff','2f6fd1'),('바다','1f4e9a','5fb7ff','ffd36b'),('이슬','9be3d1','effff9','3f9a8a'),('개구리','6cc04a','d9f5b0','ffd36b'),('산호','ff8a7a','ffd1c8','2f6fd1'),('연잎','4faa5a','b9ecb0','ff9ec7'),('심해','14316b','3a7bd5','7de3ff'),('조개','ffd1c2','fff3ea','7fb7ff'),('빗방울','5b8bd9','cfe0ff','ffe27a')],
'sul':[('하늘','6fb7ff','e8f3ff','ffd36b'),('황금','f2b632','fff0a8','8a5a1a'),('노을','ff8a5c','ffd1a8','7a4a8a'),('폭풍','4a5568','a8b3c7','ffe27a'),('질풍','5fa8a0','d3f2ee','ffffff'),('깃털','c2a27a','fff3dc','5b3f2a'),('번개','ffd93b','fff7a8','3b4a6b'),('창공','2f7de0','a8d0ff','ffffff'),('새벽','8a7fd0','e3dcff','ffd0a8'),('솔개','7a5a3a','ffffff','e8b830')],
'dudung':[('흙','8a5a33','d9b88c','ffd36b'),('황토','c98f4a','f2d49b','6b3f1d'),('광산','5a5f6b','ffd93b','ff8a3c'),('금속','9aa3ad','e3e8ee','ff8a3c'),('모래','e3c98f','fff3d1','8a5a33'),('도토리','8b5a2b','d9a066','5fa84a'),('지하','3f3a4f','8a7fd0','ffd93b'),('보석','5ec0d9','d9f5ff','ff6fa8'),('점토','b07a58','f0c9a0','4a8a5a'),('램프','ffb84a','fff0b0','5a3b1f')],
'bbosong':[('분홍','ff8fb8','ffd9e8','ffffff'),('복숭아','ffb58f','ffe0cf','7fd6a0'),('딸기','ff5f8a','ffd0dd','5fb865'),('민트','7fe0c8','e3fff6','ff9ec7'),('라일락','c79bff','f0e3ff','ffd36b'),('레모네이드','ffe55c','fffbd1','7fd0ff'),('캔디','ff7fb5','7fe0ff','fff27a'),('수박','ff6b7a','9be38a','2f6b3a'),('꽃잎','ffc2dc','fff5fa','ff7fb5'),('아가','ffd9e6','fff0d9','a8d8ff')],
'juksun':[('대나무','6cc04a','cdeeb0','3f7a2a'),('새순','a8e063','eaffc9','56ab2f'),('흑백','2b2b2b','ffffff','6cc04a'),('청죽','3a9a6b','b9eed1','ffffff'),('차밭','8fb86a','e8f5d1','5a7a3a'),('이끼','5f8a4a','c3dca8','e0d1a0'),('달빛숲','2f4f3f','a8d8b8','ffe27a'),('눈송이','f2f7fa','b9d7e8','6cc04a'),('먹빛','3a3a3a','9a9a9a','e0e0e0'),('이슬숲','7fd6b0','e0fff2','3f9a7a')],
}
EXC={ # 템플릿 번호 빼기(모자32 · 옷28 · 소지품30 중 20개만 남긴다)
'hat':{'ppopu':[7,9,16,23,24,30,28,29,21,20,12,14],'dolsom':[6,23,12,24,29,26,2,17,18,22,5,19],'lovel':[0,1,3,5,6,8,9,12,13,17,18,22],'chaeng':[2,4,6,7,8,9,23,19,12,5,30,24],
 'sul':[1,3,5,8,9,10,11,17,21,27,28,31],'dudung':[4,7,8,9,16,14,19,28,30,31,27,11],'bbosong':[6,12,23,24,29,26,2,14,17,22,30,5],'juksun':[4,3,8,9,6,7,19,21,28,31,27,17]},
'cloth':{'ppopu':[9,16,20,11,15,23,24,17],'dolsom':[10,13,26,21,20,12,2,3],'lovel':[2,12,13,26,7,22,8,24],'chaeng':[10,11,21,20,15,3,26,8],'sul':[9,16,22,19,14,24,7,15],'dudung':[9,16,23,11,24,15,17,18],'bbosong':[10,11,21,20,13,26,2,12],'juksun':[9,16,23,24,22,14,11,13]},
'item':{'ppopu':[4,5,6,11,14,15,16,26,28,29],'dolsom':[5,6,11,14,15,16,26,29,23,19],'lovel':[10,14,15,16,26,29,27,0,19,23],'chaeng':[5,6,10,14,15,29,18,19,26,20],'sul':[0,2,10,9,22,23,26,27,14,28],'dudung':[0,2,4,11,16,24,28,3,8,9],'bbosong':[5,6,14,15,29,10,11,19,16,18],'juksun':[4,10,11,14,15,29,18,19,20,22]},
}
LISTS={'hat':art.HATS,'cloth':art.CLOTH,'item':art.ITEMS}
def build():
    cat={}
    for ci,ch in enumerate(IDS):
        cat[ch]={}
        for sl in ('hat','cloth','item'):
            L=LISTS[sl]; ex=set(EXC[sl][ch]); idx=[i for i in range(len(L)) if i not in ex]
            assert len(idx)==20,(ch,sl,len(idx))
            rnd=random.Random(ci*31+len(sl)); rnd.shuffle(idx)
            items=[]
            for j,ti in enumerate(idx):
                adj,c1,c2,c3=PAL[ch][(j+ci*3+(0 if sl=='hat' else 4 if sl=='cloth' else 7))%10]
                noun,fn=L[ti]
                items.append((adj+' '+noun, fn(c1,c2,c3,(j+ci)%6)))
            cat[ch][sl]=items
    return cat
if __name__=='__main__':
    c=build(); arts=set(); names=set(); n=0
    for ch in c:
        for sl in c[ch]:
            for nm,a in c[ch][sl]:
                n+=1; assert a not in arts, nm; arts.add(a); assert nm not in names, nm; names.add(nm)
    print(n,'unique arts/names OK', sum(len(a) for a in arts)//1000,'KB')
