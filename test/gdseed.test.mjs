// s415: 부모 앱(KidsHub.GD_SEED)이 처음 가족 화면을 열 때 통신 없이 띄우는 '보호자 확인' 팝업은 서버 gdScreen('가족구성원')와 같은 모양이어야 한다.
//   서버 모양을 바꾸면 test/fixtures/gd_seed.json 을 다시 뽑아 부모 앱 KidsHub.GD_SEED 에 붙여 넣는다. 부모 저장소가 옆에 있으면 그 파일에도 같은 글이 있는지 본다.
import { gdScreen } from '../engine/kids-worker.js';
import fs from 'fs';
let ok = 0, bad = 0;
const chk = (c, m) => { if (c) { ok++; console.log('  ok  ', m); } else { bad++; console.log('  FAIL', m); } };
const want = JSON.stringify(gdScreen('가족구성원')), have = fs.readFileSync(new URL('./fixtures/gd_seed.json', import.meta.url), 'utf8').trim();
chk(want === have, '서버 gdScreen 과 시드 파일이 같다');
chk(JSON.parse(want).screen === 'kidgd' && JSON.parse(want).dlg.w === 460, '보호자 확인은 가운데 팝업(kidgd + dlg)이다');
const kh = ['../subway-app/native/shell/KidsHub.java', '../../subway-app/native/shell/KidsHub.java'].map((p) => new URL(p, import.meta.url)).find((u) => fs.existsSync(u));
if (kh) { const j = fs.readFileSync(kh, 'utf8'); chk(j.includes(want.replace(/\\/g, '\\\\').replace(/"/g, '\\"')), '부모 앱 KidsHub.GD_SEED 가 같은 글이다'); } else console.log('  skip   부모 저장소가 옆에 없어 앱 쪽 비교는 건너뜀');
console.log(ok + ' 통과, ' + bad + ' 실패'); process.exit(bad ? 1 : 0);
