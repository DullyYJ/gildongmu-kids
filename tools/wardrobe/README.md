# 꾸미기 도감 만드는 도구 (p-kids48)

`Wardrobe.java` (app/src/main/java/com/dullyyj/kids) 는 여기서 만든다 — 손으로 고치지 않는다.

- `art.py` : 모자 32 · 옷 28 · 소지품 30 가지 그림 틀(그림 문장). `catalog.py` : 친구 8명의 색 팔레트(10개씩) · 틀 고르기(친구마다 20개) · 이름/그림 480개가 겹치지 않는지 확인.
- `metrics2.py` : 캐릭터 시트(걷기 16 · 자세 8 · 동작 16칸)에서 칸마다 머리 꼭대기·몸 너비/높이를 잰다(assets/chars3d 필요). `kconst.py` : 친구별 놓는 자리 비율.
- `gen.py` → `/tmp/wg/Wardrobe.java` 로 쓴다. `rend.py` · `preview.py` : 그림 문장을 PIL 로 그려 눈으로 확인.
- 시험: `javac -d out app/src/main/java/com/dullyyj/kids/{Wardrobe,Art,Dress}.java test/WardrobeTest.java && java -cp out com.dullyyj.kids.WardrobeTest`

## 3D 렌더링 (p-kids49)
- `fab3d.py` : 그림 문장 → 도형별 높이 지도(부풀린 입체 · 겹친 도형은 위로 솟음 · 큰 곡면) → 법선 → 빛(왼쪽 위 + 아래 반사광) · 재질(니트·면·부직포·털·청·가죽·새틴·나일론·밀짚·나무·종이·유광·플라스틱·금속·연장)별 질감·반짝임·가장자리 비침 · 막힘 어둡게 · 이음선 · 바닥 그림자. 옷은 몸통 원통에 두른 것처럼 가장자리를 좁힌다. 도형 크기에 맞춘 꼭 맞는 틀(가운데·한 변)로 192px 칸에 그린다.
- `build_atlas.py` : 480개를 모두 렌더링 → 친구별 `assets/wear/<친구>.webp`(8x8칸 × 192px, 칸 번호 = 칸종류*20 + 번호) + `meta.json`(칸별 가운데 x·y · 한 변). `gen.py` 가 meta 를 읽어 Wardrobe.java 의 `WM`·`sprite()` 로 만든다.
- `comp3d.py` : 캐릭터 걷기 칸 위에 3D 그림을 얹어 눈으로 확인.
- 순서: build_atlas.py → gen.py → 시트(webp)와 Wardrobe.java 를 저장소에 올린다.


## 몸에 두르듯 입히기 (p-kids50)
`fit.py` 가 칸(걷기 16 · 자세 8 · 동작 16)마다 시트 알파에서 몸 윤곽(줄 40개 × 왼·오른쪽)을 /tmp/wg3d/atlas/fit.json 으로 뽑고, `gen.py` 가 그것과 옷 줄별 가장자리를 Wardrobe.java 문자열 상수로 넣는다(`strips.java.txt` 가 엔진 코드). `fitprev.py` 는 같은 알고리즘의 파이썬 시안(합성 그림 확인용).
