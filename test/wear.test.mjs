// 꾸민 모습 연동 시험(s423): 가족구성원이 꾸민 모습을 서버에 올리면 부모가 같은 모습을 받고, 연결된 부모 앱에 조용한 알림(k:wear)이 간다
// 실행: node --no-warnings test/wear.test.mjs
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
const M = 1 / 111320, SEC = 1000, MIN = 60000;
let NOW = Date.UTC(2026, 10, 3, 3, 0, 0);
Date.now = () => NOW;
let pend = [];
const ctx = { waitUntil: (p) => { pend.push(p); } };
const flush = async () => { await Promise.all(pend); pend = []; };
const CID = 'child000001', PID = 'parent00001', CS = 'c'.repeat(20), PS = 'p'.repeat(20);
const CTK = 'child-token-1234567890abcdef', PTK = 'parent-token-1234567890abcd';
const req = async (method, path, who, body) => {
  const h = { 'content-type': 'application/json' };
  if (who === 'c') { h['x-id'] = CID; h['x-sec'] = CS; } else if (who === 'p') { h['x-id'] = PID; h['x-sec'] = PS; }
  const r = await mod.fetch(new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const j = await r.json(); await flush(); return j;
};
const rows = (sql, ...a) => DB._db.prepare(sql).all(...a);
const watchPushes = (from = 0) => pushes.slice(from).filter((p) => p.data.k === 'watch' && p.token === CTK).length;

await req('POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req('POST', '/reg', null, { id: PID, sec: PS, role: 'p' });
const pr = await req('POST', '/c/pair', 'c', {});
await req('POST', '/p/join', 'p', { code: pr.code, nm: '쭈르' });
await req('POST', '/p/act', 'p', { v: 'kg.ok', cid: CID });
await req('POST', '/c/ft', 'c', { tk: CTK });
await req('POST', '/p/ft', 'p', { tk: PTK });

const W1 = '3,1;-1,-1,-1;4,7,-1;-1,2,19;-1,-1,-1;0,0,0;-1,-1,-1;-1,-1,-1;12,-1,5';
const W2 = '0,0;-1,-1,-1;-1,-1,-1;-1,-1,-1;-1,-1,-1;-1,-1,-1;-1,-1,-1;-1,-1,-1;-1,-1,-1';
const g0 = await req('GET', '/p/wear?cid=' + CID, 'p');
chk(g0.ok && g0.w === '', '꾸미기를 올리기 전에는 빈 글');
let a = pushes.length;
const bd = await req('POST', '/c/wear', 'c', { w: 'x' });
chk(!bd.ok && rows('SELECT * FROM wear').length === 0, '모양이 틀린 글은 받지 않는다');
const bd2 = await req('POST', '/c/wear', 'c', { w: W1.replace('19', '99') });
chk(!bd2.ok && rows('SELECT * FROM wear').length === 0, '번호가 범위를 넘으면 받지 않는다');
const r1 = await req('POST', '/c/wear', 'c', { w: W1 });
chk(r1.ok && rows('SELECT w FROM wear WHERE cid=?', CID)[0].w === W1, '가족구성원이 꾸민 모습을 저장한다');
const wp = pushes.slice(a).filter((p) => p.token === PTK && p.data.k === 'wear');
chk(wp.length === 1 && wp[0].data.w === W1 && wp[0].data.cid === CID && !wp[0].data.title && !wp[0].data.body, '연결된 부모 앱에 조용한 알림(k:wear · 글만 · 알림 카드 글 없음) 1건');
const g1 = await req('GET', '/p/wear?cid=' + CID, 'p');
chk(g1.ok && g1.w === W1 && g1.cid === CID, '부모가 같은 모습을 받는다');
a = pushes.length;
await req('POST', '/c/wear', 'c', { w: W1 });
chk(pushes.slice(a).filter((p) => p.data.k === 'wear').length === 0, '같은 모습을 다시 올리면 알림을 또 보내지 않는다');
await req('POST', '/c/wear', 'c', { w: W2 });
chk((await req('GET', '/p/wear?cid=' + CID, 'p')).w === W2 && pushes.slice(a).filter((p) => p.data.k === 'wear').length === 1, '모두 벗으면 그 모습으로 바뀌고 알림 1건');
const other = await req('GET', '/p/wear?cid=nobody000001', 'p');
chk(other.ok && other.cid === CID, '연결되지 않은 가족구성원은 읽을 수 없다(연결된 가족구성원 것으로 돌려준다)');

// 가족구성원 앱: 올리는 글은 입은 것만(고르기만 바꿔서는 다시 올리지 않는다) · 성공해야 기억한다 · 엔진은 안드로이드를 모른다
{
  const en = fs.readFileSync(new URL('../app/src/main/java/com/dullyyj/kids/Engine.java', import.meta.url).pathname, 'utf8');
  chk(/return i < 0 \? e : "0,0" \+ e\.substring\(i\);/.test(en), '앱: 고른 친구 · 탭은 빼고 입은 것만 올린다');
  chk(/Kid\.call\("POST", "\/c\/wear", o\.toString\(\), cid, csec\);\s*if \(r != null && new JSONObject\(r\)\.optBoolean\("ok", false\)\) store\.put\("wear_sent", w\);/.test(en), '앱: 올리기에 성공했을 때만 기억한다(못 올리면 다시)');
  chk(/wearPoll\(now\);/.test(en) && /now - wearChg < 1200L \|\| now - wearTry < 10000L/.test(en) && !/android\.os\.Handler/.test(en), '앱: 멈춘 뒤 한 번 · 실패하면 10초 간격 다시 — 엔진 틱에서(안드로이드 없이)');
}

console.log('\n' + ok + ' 통과, ' + bad + ' 실패');
process.exit(bad ? 1 : 0);
