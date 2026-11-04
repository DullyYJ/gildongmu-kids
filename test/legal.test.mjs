// 공개 쪽(처리방침 · 약관, s430) 시험. 실행: node --no-warnings test/legal.test.mjs
import fs from 'fs';
const file = new URL('../engine/kids-worker.js', import.meta.url).pathname;
let ok = 0, bad = 0;
const chk = (c, msg) => { if (c) { ok++; console.log('  ok  ', msg); } else { bad++; console.log('  FAIL', msg); } };
const mod = (await import(file)).default;
const get = async (p, env) => { const r = await mod.fetch(new Request('https://k.test' + p), env || {}, { waitUntil() {} }); return { r, t: await r.text() }; };

let { r, t } = await get('/legal/privacy');
chk(r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && /개인정보 처리방침/.test(t), '처리방침이 로그인 없이 열린다(DB 없이도)');
chk(/입력 전/.test(t) && /운영자 정보가 아직/.test(t), '운영자 정보가 없으면 "입력 전" 표시와 안내 문구가 뜬다');
chk(!/\{\{|\[YYYY|\[운영자|\[사실이면|\[ \]/.test(t), '자리표시자 · 검토 메모가 공개 글에 남지 않는다');
chk(/<table>/.test(t) && /<th>구분<\/th>/.test(t) && /소수 2자리/.test(t) && /긴급 호출/.test(t), '표가 그려지고 현재 동작(날씨 2자리 · 긴급 호출 보관)이 반영돼 있다');
({ r, t } = await get('/legal/terms', { OP_NAME: '홍길동 <b>', OP_MGR: '홍길동 대표', OP_CONTACT: 'help@example.com', LEGAL_DATE: '2026-12-01', LBS_NO: '제2026-서울-0001호' }));
chk(r.status === 200 && /홍길동 &lt;b&gt;/.test(t) && !/<b>[^<]*홍길동 <b>/.test(t), '운영자 이름은 HTML 로 해석되지 않게 이스케이프된다');
chk(!/입력 전/.test(t) && !/운영자 정보가 아직/.test(t) && /2026-12-01/.test(t) && /help@example\.com/.test(t), '운영자 정보를 넣으면 안내 문구가 사라지고 값이 들어간다');
chk(/신고번호: 제2026-서울-0001호/.test(t), '신고번호(LBS_NO)를 넣으면 약관에 표시된다');
({ r, t } = await get('/legal/delete', { OP_NAME: '원윤재', OP_MGR: '원윤재', OP_CONTACT: 'phg0643@gmail.com', LEGAL_DATE: '2026-12-01' }));
chk(r.status === 200 && /연결 모두 끊기/.test(t) && /phg0643@gmail\.com/.test(t) && /10일 안에/.test(t) && /약 200일/.test(t) && !/\{\{/.test(t), '삭제 안내(/legal/delete)가 열리고 앱 안 삭제 방법 · 이메일 · 남는 정보가 있다');
({ r, t } = await get('/legal'));
chk(r.status === 200 && /\/legal\/privacy/.test(t) && /\/legal\/terms/.test(t), '/legal 은 두 문서로 가는 목록');
({ r } = await get('/legal/other'));
chk(r.status === 200, '모르는 주소는 목록으로(오류 없이)');
const w = fs.readFileSync(file, 'utf8');
const li = w.indexOf('return legalPage(url, env)');
chk(li > 0 && w.slice(li - 400, li).includes('async function handle') && w.indexOf('await init(DB);', li) > li && w.slice(li - 400, li).indexOf('await init(DB)') < 0, '/legal 은 DB 초기화 전에 처리한다(요청 비용 없음)');
{
  const eng = fs.readFileSync(new URL('../app/src/main/java/com/dullyyj/kids/Engine.java', import.meta.url).pathname, 'utf8');
  const main = fs.readFileSync(new URL('../app/src/main/java/com/dullyyj/kids/MainActivity.java', import.meta.url).pathname, 'utf8');
  chk((eng.match(/a\.put\(legalLinks\(\)\)/g) || []).length === 2 && /legal\.privacy/.test(eng) && /legal\.terms/.test(eng), '자녀 앱: 동의 창과 설정에 처리방침 · 이용약관 보기가 있다');
  chk(!/import android\./.test(eng), '엔진은 안드로이드를 모른다(주소만 명령으로 돌려준다)');
  const man = fs.readFileSync(new URL('../app/src/main/AndroidManifest.xml', import.meta.url).pathname, 'utf8');
  chk(/앱을 닫아도 계속돼요/.test(eng) && /집·학교 도착·출발 알림/.test(eng), '동의 화면: 앱을 닫아도 위치를 계속 쓴다는 고지(Play 공개 고지)');
  chk(!/REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/.test(man) && !/ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/.test(main), '배터리 최적화: 권한 없이 설정 화면만 연다');
  chk(/"open"\.equals\(cmd\)/.test(main) && /startsWith\(Kid\.BASE \+ "\/legal\/"\)/.test(main), '앱은 우리 서버의 /legal/ 주소만 연다');
  const w = fs.readFileSync(file, 'utf8');
  chk(/btn\('처리방침 보기', \{ a: 'open', url: LEGAL_BASE \+ '\/legal\/privacy' \}/.test(w) && /LEGAL_BASE = 'https:\/\/gildongmu-kids\.phg0643\.workers\.dev'/.test(w), '부모 확인 화면에 처리방침 · 약관 보기 버튼이 있다');
  const kt = fs.readFileSync(new URL('../app/src/main/java/com/dullyyj/kids/Kid.java', import.meta.url).pathname, 'utf8');
  chk(kt.includes("BASE = \"https://gildongmu-kids.phg0643.workers.dev\""), '앱 주소와 링크 주소가 같다');
}

console.log(`${ok} 통과, ${bad} 실패`); process.exit(bad ? 1 : 0);
