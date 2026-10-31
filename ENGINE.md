# 길동무 키즈 엔진 (Cloudflare Worker + D1)

`engine/kids-worker.js` — 길동무 엔진(route-v2)과 따로 도는 키즈 전용 서버. 주소 `https://gildongmu-kids.phg0643.workers.dev`, D1 바인딩 이름 `DB`(데이터베이스 `gildongmu-kids`). 첫 요청 때 표를 스스로 만든다. 앱은 화면만 그리고, 대화·퀘스트·연결·위치의 계산과 저장은 모두 여기서 한다.

## 인증
기기마다 처음에 아이디(`id`, 8~64자 영숫자·_-)와 비밀(`sec`, 16~128자)을 정해 `POST /reg {id,sec,role}` 로 등록한다. 이후 모든 요청에 머리글 `x-id` / `x-sec`. 서버에는 비밀의 SHA-256 만 둔다. 역할 `c` = 자녀(키즈 앱), `p` = 부모(길동무 앱).

## 자녀 앱 (role c)
- `POST /c/pair` → `{code,exp}` 연결 비밀키 `XXXXX-XXXXX` (10분). QR 글은 `gildongmu-kids://pair?c=<cid>&k=<code>`
- `POST /c/loc {la,lo,acc}` 정확한 위치. 연결된 부모가 1명 이상일 때만 가장 최근 한 건을 저장
- `POST /c/unlink` 모든 연결과 위치 삭제
- `GET /c/state` → `{linked}`
- `GET /c/screen?tab=chat|quest&qt=c|p` → `{screen,linked}` (앱이 그대로 그리는 화면 JSON)
- `POST /c/act {v,arg,tab,qt}` `chat.send` · `quest.send` · `quest.done:<id>` 를 처리하고 새 화면을 돌려줌

## 부모 앱 (role p, 길동무 앱에서 붙일 것)
- `POST /reg {id,sec,role:"p"}` 후 `POST /p/join {code}` (QR/비밀키) → `{cid}`. 자녀 한 명당 부모 최대 4명
- `GET /p/children` 연결된 자녀와 마지막 위치 · `GET /p/loc?cid=`
- `GET|POST /p/chat` (`{cid,x}`) · `GET /p/quests?cid=` · `POST /p/quest {cid,x}` 자녀에게 미션 보내기 · `POST /p/quest/done {cid,id}` 자녀가 보낸(부모님 미션) 완료 표시 · `POST /p/unlink {cid}`

## 보관 규칙
대화 7일·최대 300개, 퀘스트 최대 100개, 위치는 연결된 부모가 있을 때 가장 최근 한 건(연결이 모두 끊기면 삭제), 비밀키 10분.

## 배포
Cloudflare 대시보드 → Workers → `gildongmu-kids` → 코드 편집에 `engine/kids-worker.js` 전체를 붙여 넣고 배포. 바인딩 `DB` 는 D1 `gildongmu-kids`. 엔진 파일이 바뀌면 이 파일을 다시 배포해야 한다.

## 앱 쪽
`Kid.java` 가 서버와 말하고(뒤 스레드), `Engine.java` 가 받은 화면을 저장해 두었다가 그리게 넘긴다(저장해 둔 것을 먼저 보이고 4초마다 갱신). 서버에 닿지 못하면 마지막으로 받은 화면을 그대로 보인다.
