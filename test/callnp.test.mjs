// 안전 도착 · 데리러 와줘: 부모님이 알림을 받을 수 있는지(np)를 자녀 앱에 알려 주는 시험(s412) + 부모 확인 카드 가운데 맞춤
// 실행: node --no-warnings test/callnp.test.mjs
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
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = { DB, FCM_SA: JSON.stringify({ client_email: 'x@y.iam', project_id: 'p1', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) };
const pushes = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  u = String(u);
  if (u.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3000 }), { status: 200 });
  if (u.startsWith('https://fcm.googleapis.com/')) { const b = JSON.parse(init.body); pushes.push({ token: b.message.token, data: b.message.data }); return new Response('{}', { status: 200 }); }
  return realFetch(u, init);
};
const mod = (await import(file)).default;
const MIN = 60000;
let NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
Date.now = () => NOW;
let pend = [];
const ctx = { waitUntil: (p) => { pend.push(p); } };
const flush = async () => { await Promise.all(pend); pend = []; };
const CID = 'child000001', PID = 'parent00001', CS = 'c'.repeat(20), PS = 'p'.repeat(20);
const req = async (method, path, who, body) => {
  const h = { 'content-type': 'application/json' };
  if (who === 'c') { h['x-id'] = CID; h['x-sec'] = CS; } else if (who === 'p') { h['x-id'] = PID; h['x-sec'] = PS; }
  const r = await mod.fetch(new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const j = await r.json(); await flush(); return j;
};
await req('POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req('POST', '/reg', null, { id: PID, sec: PS, role: 'p' });
const pr = await req('POST', '/c/pair', 'c', {});
await req('POST', '/p/join', 'p', { code: pr.code, nm: '쭈르' });
await req('POST', '/c/ft', 'c', { tk: 'child-token-1234567890abcdef' });

// 부모 기기에 알림 열쇠(토큰)는 있지만 법정대리인 확인 전
await req('POST', '/p/ft', 'p', { tk: 'parent-token-1234567890abcd' });
let r = await req('POST', '/c/call', 'c', { k: 'arr' });
chk(r.ok && r.linked === 1 && r.np === 0, '확인 전: 안전 도착 → 기록은 되지만 알림 받을 부모 np=0');
NOW += 6 * MIN;
r = await req('POST', '/c/call', 'c', { k: 'pick' });
chk(r.ok && r.np === 0, '확인 전: 데리러 와줘 → np=0');
const n0 = pushes.length;
NOW += 6 * MIN;
r = await req('POST', '/c/call', 'c', { k: 'sos' });
chk(r.ok && r.np === 1 && pushes.length > n0, '긴급 호출은 확인 전에도 알림 np=1 · 푸시 감');

// 법정대리인 확인 뒤
await req('POST', '/p/act', 'p', { v: 'kg.ok', cid: CID });
NOW += 6 * MIN;
const n1 = pushes.length;
r = await req('POST', '/c/call', 'c', { k: 'arr' });
chk(r.ok && r.np === 1 && pushes.length === n1 + 1, '확인 뒤: 안전 도착 np=1 · 푸시 1건');
NOW += 30000;
r = await req('POST', '/c/call', 'c', { k: 'arr' });
chk(r.dup === 1 && r.np === 1, '2분 안에 또 누르면 dup=1 이고 np 도 함께 온다');

// 알림 열쇠가 없는 부모 기기
DB._db.prepare("UPDATE devices SET ft='' WHERE id=?").run(PID);
NOW += 6 * MIN;
r = await req('POST', '/c/call', 'c', { k: 'arr' });
chk(r.ok && r.np === 0, '부모 기기에 알림 열쇠가 없으면 np=0');
DB._db.prepare("UPDATE devices SET ft='parent-token-1234567890abcd' WHERE id=?").run(PID);

// 부모 화면: 카드는 가장 급한 하나만(긴급 우선) · 가운데 맞춤 · 카드가 얹힌 만큼 지도가 줄어 아래 칸 크기는 그대로
const mapOf = (h) => h.screen.head.find((n) => n.t === 'tmap');
const cardsOf = (h) => (h.screen.head || []).filter((n) => n.t === 'panel' && /긴급 호출|데리러 와 달라고/.test(JSON.stringify(n)));
let hub = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
let cards = cardsOf(hub);
chk(cards.length === 1 && JSON.stringify(cards[0]).includes('긴급 호출'), '긴급 호출과 데리러 와줘가 함께 있으면 카드는 긴급 하나만');
let tt = cards[0] ? cards[0].kids.filter((k) => k.t === 'text') : [];
chk(tt.length === 1 && tt.every((k) => k.align === 'center') && cards[0].act && cards[0].act.v === 'kx.open', '허브에는 가운데 맞춤 한 줄만 남고 누르면 호출 팝업이 열린다(s415)');
chk(mapOf(hub).h === 204, '한 줄이 있으면 지도가 그만큼 줄어든다(250 → 204, 아래 칸 크기는 그대로): ' + mapOf(hub).h);
const ko = await req('POST', '/p/act', 'p', { v: 'kx.open', cid: CID });
chk(ko.ok && ko.pop && ko.pop.k === 'sos' && ko.pop.ka === 'kx.ack', '허브 줄을 누르면(kx.open) 그 호출의 팝업 값을 준다(s415)');
await req('POST', '/c/call', 'c', { k: 'sos', op: 'cancel' });
hub = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
cards = cardsOf(hub);
chk(cards.length === 1 && JSON.stringify(cards[0]).includes('데리러 와 달라고'), '긴급이 끝나면 데리러 와줘 카드가 보인다');
await req('POST', '/p/act', 'p', { v: 'kx.done', cid: CID, id: DB._db.prepare("SELECT id FROM calls WHERE k='pick'").get().id });
DB._db.prepare("UPDATE calls SET st=3 WHERE k='pick'").run();
hub = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
chk(cardsOf(hub).length === 0 && mapOf(hub).h === 250, '카드가 없으면 지도는 원래 높이(250)');

// 지난 경로: 아래 줄이 아니라 '+ 장소 등록 · 등록한 장소' 줄의 세 번째 단추(누르면 kr.open 팝업)
const flat = (n) => (Array.isArray(n) ? n.flatMap(flat) : n && typeof n === 'object' ? [n].concat(Object.values(n).flatMap(flat)) : []);
const rows3 = flat(hub.screen.body).filter((n) => n.t === 'row' && Array.isArray(n.kids) && n.kids.some((k) => k.act && k.act.v === 'kps.open'));
chk(rows3.length === 1 && rows3[0].kids.length === 3 && rows3[0].kids[2].s.startsWith('지난 경로') && rows3[0].kids[2].act.v === 'kr.open', '지난 경로가 장소 등록 · 등록한 장소 줄의 세 번째 단추다');
chk(!flat(hub.screen.body).some((n) => n.t === 'navrow' && n.title === '지난 경로'), '예전 "지난 경로" 줄은 없다');

// 연결 끊김: 부모 없음
await req('POST', '/c/unlink', 'c', {});
r = await req('POST', '/c/call', 'c', { k: 'arr' });
chk(r.ok && r.linked === 0 && r.np === undefined, '연결 없음은 그대로 linked=0');
console.log(`${ok} 통과, ${bad} 실패`); process.exit(bad ? 1 : 0);
