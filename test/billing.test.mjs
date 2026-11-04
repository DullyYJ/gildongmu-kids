// 구독(s431, 기본 꺼짐) · 지표(개인정보 없는 횟수) 시험
// 실행: node --no-warnings test/billing.test.mjs
import fs from 'fs';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const file = new URL('../engine/kids-worker.js', import.meta.url).pathname;
let ok = 0, bad = 0;
const chk = (c, msg) => { if (c) { ok++; console.log('  ok  ', msg); } else { bad++; console.log('  FAIL', msg); } };

function mkD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, params) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
    first: async () => db.prepare(sql).get(...params) || null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
  });
  return { prepare: (sql) => stmt(sql, []), batch: async (arr) => { db.exec('BEGIN'); try { for (const s of arr) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; }, _db: db };
}
const DB = mkD1();
const pk = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = { DB, FCM_SA: JSON.stringify({ client_email: 'x@y.iam', project_id: 'p1', private_key: pk() }) };
const calls = [];
let play = { state: 'SUBSCRIPTION_STATE_ACTIVE', exp: '2026-12-03T00:00:00Z', ack: 'ACKNOWLEDGEMENT_STATE_PENDING', product: 'gildongmu_gps', status: 200 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  u = String(u);
  if (u.startsWith('https://oauth2.googleapis.com/token')) { calls.push({ u: 'token', scope: Buffer.from(decodeURIComponent(String(init.body)).split('assertion=')[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString().includes('androidpublisher') ? 'gp' : 'fcm' }); return new Response(JSON.stringify({ access_token: 'at', expires_in: 3000 }), { status: 200 }); }
  if (u.startsWith('https://fcm.googleapis.com/')) return new Response('{}', { status: 200 });
  if (u.startsWith('https://androidpublisher.googleapis.com/')) {
    calls.push({ u, m: (init && init.method) || 'GET', auth: init && init.headers && init.headers.authorization });
    if (u.endsWith(':acknowledge')) return new Response('{}', { status: 200 });
    if (play.status !== 200) return new Response('{}', { status: play.status });
    return new Response(JSON.stringify({ subscriptionState: play.state, acknowledgementState: play.ack, lineItems: [{ productId: play.product, expiryTime: play.exp }] }), { status: 200 });
  }
  return realFetch(u, init);
};
const mod = (await import(file)).default;
let NOW = Date.UTC(2026, 10, 3, 3, 0, 0);
Date.now = () => NOW;
let pend = [];
const ctx = { waitUntil: (p) => { pend.push(p); } };
const flush = async () => { await Promise.all(pend); pend = []; };
const CID = 'child000001', PID = 'parent00001', CS = 'c'.repeat(20), PS = 'p'.repeat(20);
const req = async (method, path, who, body, hdr) => {
  const h = Object.assign({ 'content-type': 'application/json' }, hdr || {});
  if (who === 'c') { h['x-id'] = CID; h['x-sec'] = CS; } else if (who === 'p') { h['x-id'] = PID; h['x-sec'] = PS; }
  const r = await mod.fetch(new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const j = await r.json(); await flush(); return j;
};
const rows = (sql, ...a) => DB._db.prepare(sql).all(...a);
const hubOf = () => req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
const hasMap = (r) => /"t":"tmap"/.test(JSON.stringify(r.screen));
const TOK = 'purchase-token-abcdefghijklmnop';

await req('POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req('POST', '/reg', null, { id: PID, sec: PS, role: 'p' });
await req('POST', '/c/consent', 'c', { v: 1 });
const pr = await req('POST', '/c/pair', 'c', {});
await req('POST', '/p/join', 'p', { code: pr.code, nm: '쭈르' });
await req('POST', '/c/loc', 'c', { la: 37.5, lo: 126.84, acc: 8 });
await req('POST', '/p/act', 'p', { v: 'kg.ok', cid: CID });

// ── 꺼져 있을 때(기본): 지금과 똑같다 ──
let h = await hubOf();
chk(h.ok && h.screen.screen !== 'kidpay' && hasMap(h), '기본(BILLING_MODE 없음): 구독 없이도 지도가 그대로 보인다');
chk(calls.length === 0, '기본: 구글(Play)에 아무것도 묻지 않는다');
chk((await req('GET', '/p/loc?cid=' + CID, 'p')).loc !== null, '기본: 옛 위치 주소도 그대로 위치를 준다');
env.BILLING_MODE = 'off';
h = await hubOf();
chk(h.screen.screen !== 'kidpay' && hasMap(h), 'BILLING_MODE=off: 그대로 무료');
env.BILLING_MODE = 'xyz';
h = await hubOf();
chk(h.screen.screen !== 'kidpay', '이상한 값은 꺼짐으로 본다');

// ── 켜짐: 구독 없는 사람 ──
env.BILLING_MODE = 'on';
const wtBefore = rows('SELECT wt FROM devices WHERE id=?', PID)[0].wt;
NOW += 1000;
h = await hubOf();
const js = JSON.stringify(h.screen);
chk(h.ok && h.screen.screen === 'kidpay' && !hasMap(h), '켜짐 + 구독 없음: 구독 안내 화면이 지도 자리에 나온다');
chk(/sub\.buy/.test(js) && /gildongmu_gps/.test(js) && /monthly/.test(js) && /yearly/.test(js) && /sub\.restore/.test(js), '안내 화면: 월 · 연 단추와 구매 복원 단추(상품 · 요금제는 엔진이 정한다)');
chk(/14일 무료/.test(js) && /2,900/.test(js) && /24,900/.test(js), '안내 화면: 무료 체험 14일 · 월 2,900원 · 연 24,900원');
chk((await req('GET', '/p/loc?cid=' + CID, 'p')).loc === null, '옛 위치 주소(/p/loc)도 구독 없으면 위치를 주지 않는다');
const ch = await req('GET', '/p/children', 'p');
chk(ch.children.length === 1 && ch.children[0].la === null && ch.children[0].lo === null, '자녀 목록도 구독 없으면 좌표가 없다');
const ro = await req('POST', '/p/act', 'p', { v: 'kr.open', cid: CID });
chk(ro.ok && ro.close === true && !ro.screen, '지난 길 같은 위치 동작도 구독 없으면 받지 않는다');
chk(rows('SELECT wt FROM devices WHERE id=?', PID)[0].wt === wtBefore, '구독 없으면 "보는 중" 표시도 하지 않는다(자녀 폰이 빠른 보고로 바뀌지 않는다)');
// 긴급 호출은 늘 무료
await req('POST', '/c/call', 'c', { k: 'sos', la: 37.5, lo: 126.84 });
const hp = await hubOf();
chk(hp.pop && /긴급/.test(JSON.stringify(hp.pop)), '구독이 없어도 긴급 호출 팝업은 부모에게 간다');
const ack = await req('POST', '/p/act', 'p', { v: 'kx.ack', cid: CID, t: hp.pop.ci });
chk(ack.ok, '구독이 없어도 긴급 호출 확인(kx.ack)은 받는다');
await req('POST', '/c/call', 'c', { k: 'sos', la: 37.5, lo: 126.84 });
chk(rows("SELECT SUM(n) n FROM mx WHERE k='call_sos'")[0].n === 1, '이미 열린 호출을 또 눌러도 새 호출로 세지 않는다');

// ── 구독 확인 ──
chk((await req('POST', '/p/sub', 'p', { tk: TOK })).sub === 0, '구글 설정(GP_SA · GP_PKG)이 없으면 샀다는 말만으로는 열어 주지 않는다');
env.GP_SA = JSON.stringify({ client_email: 'play@y.iam', private_key: pk() });
env.GP_PKG = 'com.dullyyj.subway';
NOW += 10000;
let sb = await req('POST', '/p/sub', 'p', { tk: TOK });
chk(sb.ok && sb.sub === 1 && sb.exp === Date.parse('2026-12-03T00:00:00Z'), '구글이 활성이라 하면 열린다(끝나는 시각도 구글 값)');
const gc = calls.filter((c) => c.m);
chk(gc.length === 2 && /subscriptionsv2\/tokens\//.test(gc[0].u) && /com\.dullyyj\.subway/.test(gc[0].u) && gc[0].auth === 'Bearer at', '구글 구독 조회(v2)를 앱 패키지로 한다');
chk(/subscriptions\/gildongmu_gps\/tokens\/.*:acknowledge$/.test(gc[1].u) && gc[1].m === 'POST', '아직 확인 전인 구매는 서버가 acknowledge 한다(3일 안에 안 하면 환불)');
chk(calls.some((c) => c.scope === 'gp'), 'Play 용 접근 토큰은 androidpublisher 범위로 받는다');
h = await hubOf();
chk(h.screen.screen !== 'kidpay' && hasMap(h), '구독 뒤: 지도가 보인다');
chk((await req('GET', '/p/loc?cid=' + CID, 'p')).loc !== null, '구독 뒤: 옛 위치 주소도 위치를 준다');
const n0 = calls.length;
await hubOf(); await hubOf();
chk(calls.length === n0, '구독 중에는 화면을 볼 때마다 구글에 묻지 않는다(0번)');
chk(rows('SELECT * FROM subs').length === 1 && rows('SELECT tk FROM subs')[0].tk === TOK, '구독 한 줄만 남는다(기기당 하나)');

// ── 연타 방지 · 잘못된 입력 ──
NOW += 1000;
const fast = await mod.fetch(new Request('https://k.test/p/sub', { method: 'POST', headers: { 'content-type': 'application/json', 'x-id': PID, 'x-sec': PS }, body: JSON.stringify({ tk: TOK }) }), env, ctx);
chk(fast.status === 429, '3초 안에 또 보내면 429(구글 호출을 아낀다)');
NOW += 5000;
chk((await req('POST', '/p/sub', 'p', { tk: 'x' })).sub === 0, '너무 짧은 토큰은 구글에 묻지도 않는다');
NOW += 4000;
const nbefore = calls.length;
chk((await req('POST', '/p/sub', 'p', { tk: 'y'.repeat(700) })).sub === 0 && calls.length === nbefore, '너무 긴 토큰도 묻지 않는다');
const ur = await mod.fetch(new Request('https://k.test/p/sub', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env, ctx);
chk(ur.status === 401, '인증 없이는 /p/sub 를 못 쓴다');

// ── 끝남 · 갱신 ──
NOW = Date.parse('2026-12-03T00:05:00Z');
play = Object.assign({}, play, { state: 'SUBSCRIPTION_STATE_EXPIRED', ack: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' });
h = await hubOf();
chk(h.screen.screen === 'kidpay', '끝난 구독: 구글에 다시 묻고(만료) 안내 화면으로 돌아간다');
const n1 = calls.length;
await hubOf();
chk(calls.length === n1, '만료 확인 뒤 10분 동안은 또 묻지 않는다');
NOW += 11 * 60000;
play = Object.assign({}, play, { state: 'SUBSCRIPTION_STATE_ACTIVE', exp: '2027-01-03T00:00:00Z' });
h = await hubOf();
chk(h.screen.screen !== 'kidpay' && hasMap(h), '갱신되면 10분 안에 다시 열린다');
NOW += 11 * 60000;
play = Object.assign({}, play, { state: 'SUBSCRIPTION_STATE_CANCELED' });
h = await hubOf();
chk(hasMap(h), '해지(취소)해도 낸 기간 끝까지는 쓴다');
NOW = Date.parse('2027-01-03T00:30:00Z'); play = Object.assign({}, play, { state: 'SUBSCRIPTION_STATE_ON_HOLD' });
h = await hubOf();
chk(h.screen.screen === 'kidpay', '결제 보류(ON_HOLD)는 막는다');
NOW += 11 * 60000; play = Object.assign({}, play, { status: 500 });
h = await hubOf();
chk(h.screen.screen === 'kidpay', '구글이 오류를 내면 열어 주지 않는다(서버 오류로 공짜가 되지 않는다)');
play = Object.assign({}, play, { status: 200 });

// ── 출시 직후 무료 기간 ──
env.BILLING_FREE_UNTIL = String(NOW + 3600000);
chk((await hubOf()).screen.screen !== 'kidpay', 'BILLING_FREE_UNTIL 전까지는 켜져 있어도 모두 무료');
NOW += 3700000;
chk((await hubOf()).screen.screen === 'kidpay', 'BILLING_FREE_UNTIL 이 지나면 구독이 필요하다');
env.BILLING_MODE = 'off';
chk((await hubOf()).screen.screen !== 'kidpay', '다시 off 로 돌리면 즉시 전부 무료(되돌리기)');

// ── 상품이 다르면 인정하지 않는다 ──
env.BILLING_MODE = 'on'; env.BILLING_FREE_UNTIL = '0';
rows('SELECT 1'); DB._db.prepare('DELETE FROM subs').run();
play = Object.assign({}, play, { state: 'SUBSCRIPTION_STATE_ACTIVE', exp: '2028-01-01T00:00:00Z', product: 'other_item' });
NOW += 10000;
chk((await req('POST', '/p/sub', 'p', { tk: TOK })).sub === 0 && rows('SELECT * FROM subs').length === 0, '다른 상품의 영수증은 인정하지 않고 저장하지도 않는다');

// ── 지표 ──
const mx = Object.fromEntries(rows('SELECT k, SUM(n) n FROM mx GROUP BY k').map((r) => [r.k, r.n]));
chk(mx.reg_c === 1 && mx.reg_p === 1 && mx.pair === 1 && mx.guardian_p === 1 && mx.consent_c === 1 && mx.call_sos === 1 && mx.sub >= 1, '지표: 가입 · 연결 · 보호자 확인 · 동의 · 긴급 호출 · 구독이 횟수로 쌓인다');
const cols = rows("SELECT name FROM pragma_table_info('mx')").map((r) => r.name).join(',');
chk(cols === 'd,k,n', '지표 표에는 날짜 · 항목 · 횟수뿐(기기 · 사람 정보가 없다)');
NOW += 31 * 60000;
await mod.scheduled({}, env, ctx); await flush();
const snap = Object.fromEntries(rows('SELECT k,n FROM mx WHERE d=?', Math.floor((NOW + 9 * 3600000) / 86400000)).map((r) => [r.k, r.n]));
chk(snap.tot_p === 1 && snap.tot_c === 1 && snap.tot_fam === 1 && snap.act_c === 0 && 'act_p' in snap && 'tot_sub' in snap, '크론이 전체 · 오늘 활동 수를 그날 줄에 덮어쓴다');
const sn1 = rows("SELECT v FROM meta WHERE k='mxsnap'")[0].v;
await mod.scheduled({}, env, ctx); await flush();
chk(rows("SELECT v FROM meta WHERE k='mxsnap'")[0].v === sn1, '30분 안에는 다시 세지 않는다');
// 끝난 지 오래된 구독 줄은 지운다(약 13개월)
DB._db.prepare('INSERT INTO subs(pid,tk,st,exp,vt,t) VALUES(?,?,?,?,?,?)').run('oldparent1', 'tk-old-1234567890', 'EXPIRED', NOW - 401 * 86400000, NOW, NOW);
DB._db.prepare('INSERT INTO subs(pid,tk,st,exp,vt,t) VALUES(?,?,?,?,?,?)').run('newparent1', 'tk-new-1234567890', 'EXPIRED', NOW - 100 * 86400000, NOW, NOW);
NOW += 11 * 60000;
await mod.scheduled({}, env, ctx); await flush();
chk(rows("SELECT pid FROM subs WHERE pid='oldparent1'").length === 0 && rows("SELECT pid FROM subs WHERE pid='newparent1'").length === 1, '끝난 지 400일이 넘은 구독 줄만 지운다(처리방침 약 13개월)');
// 관리자 읽기
const noKey = await mod.fetch(new Request('https://k.test/admin/mx'), env, ctx);
chk(noKey.status === 404, 'ADMIN_KEY 가 없으면 /admin/mx 는 없는 길(404)');
env.ADMIN_KEY = 'adm-' + 'k'.repeat(24);
const wrong = await mod.fetch(new Request('https://k.test/admin/mx', { headers: { 'x-admin-key': 'nope' } }), env, ctx);
chk(wrong.status === 404, '틀린 키는 404');
const good = await mod.fetch(new Request('https://k.test/admin/mx?days=120', { headers: { 'x-admin-key': env.ADMIN_KEY } }), env, ctx);
const gj = await good.json();
const dks = Object.keys(gj.days);
chk(good.status === 200 && gj.ok && dks.length > 0 && dks.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) && Object.values(gj.days).some((d) => d.reg_p === 1), '맞는 키면 날짜별 횟수를 준다');
chk(!/cid|pid|child000001|parent00001/.test(JSON.stringify(gj)), '응답에 기기 · 사람을 가리키는 값이 없다');

// ── 원본 확인 ──
const src = fs.readFileSync(file, 'utf8');
chk(!/\/c\/loc'[^\n]*mxAdd/.test(src), '위치 보고 길(/c/loc)에는 지표 쓰기를 더하지 않았다');

console.log('\n' + ok + ' 통과, ' + bad + ' 실패');
process.exit(bad ? 1 : 0);
