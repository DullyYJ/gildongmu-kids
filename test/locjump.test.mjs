// 튄 위치 거르기 시험(s402): 부정확한 위치 · 순간이동 위치는 현재 위치를 덮지 않는다
// 실행: node --no-warnings test/locjump.test.mjs
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
let la = 37.5, lo = 126.84;
const loc = (extra) => req('POST', '/c/loc', 'c', Object.assign({ la, lo, acc: 8 }, extra || {}));
const hubScr = async (how) => how === 'wait' ? req('GET', '/p/wait?v=hub&cid=' + CID + '&since=-1', 'p') : req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
const tmapOf = (r) => r.screen.head.find((n) => n.t === 'tmap');


const cur = () => rows('SELECT la,lo,acc,t FROM loc WHERE cid=?', CID)[0];
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 기준 위치(정확한 위치)
let r = await loc({ acc: 8 });
chk(r.ok && !r.same && near(cur().la, 37.5), '처음 위치(오차 8m)는 저장된다');

// ① 방금 받은 것보다 훨씬 부정확한 위치(큰 오차)는 덮지 않는다
NOW += 20 * SEC;
r = await loc({ la: 37.5 + 2300 * M, lo: 126.84, acc: 2000 });
chk(r.same === 1 && near(cur().la, 37.5), '오차 2000m 위치는 방금 받은 정확한 위치를 덮지 않는다(2.3km 튐 방지)');
NOW += 20 * SEC;
r = await loc({ la: 37.5 + 120 * M, lo: 126.84, acc: 150 });
chk(r.same === 1 && near(cur().la, 37.5), '오차 150m 위치(100m 초과 · 직전의 2배 넘게 부정확)도 덮지 않는다');
NOW += 20 * SEC;
r = await loc({ la: 37.5 + 70 * M, lo: 126.84, acc: 40 });
chk(!r.same && near(cur().la, 37.5 + 70 * M), '오차 40m 위치(정상 범위 · 흔들림 반경 48m 밖)는 저장된다');

// 오차가 컸던 위치가 기준이면 비슷한 오차의 위치는 받는다(실내에서 계속 부정확한 경우)
NOW += 20 * SEC;
await loc({ la: 37.5 + 30 * M, lo: 126.84, acc: 200 });      // 직전이 40m 라 건너뛰어진다
NOW += 6 * MIN;                                               // s443: 5분이 아니라 12분 — 가만히 있을 땐 보고가 5~8분 간격이라 5분 기준은 늘 빠져나갔다
r = await loc({ la: 37.5 + 80 * M + 40 * M, lo: 126.84, acc: 200 });
chk(r.same === 1 && near(cur().la, 37.5 + 70 * M), '6분 뒤에도 정상 위치가 직전이면 부정확한 위치는 건너뛴다(s443: 12분 기준)');
NOW += 15 * MIN;                                              // 12분 넘게 정상 위치가 없으면 부정확해도 받는다
r = await loc({ la: 37.5 + 120 * M, lo: 126.84, acc: 200 });
chk(!r.same && near(cur().la, 37.5 + 120 * M), '12분 넘게 정상 위치가 없으면 부정확한 위치라도 받는다(실내에서 위치가 아예 멈추지 않게)');

// ② 순간이동: 몇 초 만에 1.5km 넘게 간 위치는 보류, 곧 그 근처에서 또 오면 진짜로 본다
NOW += 5 * SEC;
const before = cur().la;
r = await loc({ la: 37.5 + 5000 * M, lo: 126.84, acc: 20 });
chk(r.same === 1 && near(cur().la, before), '5초 만에 4.9km 간 위치(오차 20m)는 보류한다');
NOW += 15 * SEC;
r = await loc({ la: before + 40 * M, lo: 126.84, acc: 15 });
chk(!r.same && near(cur().la, before + 40 * M), '곧바로 원래 자리에서 오면 정상으로 받는다(튄 위치는 버려졌다)');
NOW += 15 * SEC;
r = await loc({ la: 37.5 + 5000 * M, lo: 126.84, acc: 20 });
chk(r.same === 1, '정상 위치가 이어진 뒤 다시 튀면 또 보류(앞의 튐을 확인으로 치지 않는다)');
NOW += 8 * SEC;
r = await loc({ la: 37.5 + 5010 * M, lo: 126.84, acc: 20 });
chk(!r.same && near(cur().la, 37.5 + 5010 * M), '120초 안에 그 근처(300m 안)에서 또 오면 진짜 이동으로 받는다(터널 · 지하철 뒤 등)');

// 천천히 멀리 간 것(차 · 지하철)은 속도 규칙에 안 걸린다
NOW += 5 * MIN;
r = await loc({ la: 37.5 + 9000 * M, lo: 126.84, acc: 30 });
chk(!r.same && near(cur().la, 37.5 + 9000 * M), '5분에 4km(13m/s)는 정상 이동이라 받는다');

// ③ s443 제자리 흔들림: 오차 25m 넘는 위치가 직전 위치의 오차(×1.2, 80m 상한) 안쪽이면 점을 옮기지 않는다 · 오차 25m 이하(걷는 속도 따라가기)는 거르지 않는다
NOW += 30 * MIN;
la = 37.6; lo = 126.9;
await loc({ acc: 40 });
NOW += 40 * SEC; await loc({ acc: 40 });                                  // 한 곳에 가만히
const base0 = cur().la, t0 = cur().t;
NOW += 4 * SEC;
r = await loc({ la: la + 30 * M, lo, acc: 40 });
chk(near(cur().la, base0) && cur().t > t0, '가만히 있는데 30m 흔들린 위치(오차 40m)는 점을 그대로 두고 시각만 새로 한다');
NOW += 4 * SEC;
r = await loc({ la: la - 35 * M, lo: lo + 20 * M, acc: 45 });
chk(near(cur().la, base0), '반대쪽으로 흔들려도 점은 그대로(지도가 흔들리지 않는다)');
NOW += 4 * SEC;
r = await loc({ la: la + 90 * M, lo, acc: 40 });
chk(!r.same && near(cur().la, la + 90 * M), '오차 반경(48m) 밖으로 90m 가면 진짜 이동으로 받는다');
NOW += 4 * SEC;
r = await loc({ la: la + 90 * M + 12 * M, lo, acc: 10 });
chk(!r.same && near(cur().la, la + 102 * M), '오차 10m 이하의 정확한 위치는 흔들림으로 거르지 않는다(걷는 속도를 따라간다)');
// 더 정확한 새 위치는 부정확했던 직전 위치를 바로잡는다
NOW += 30 * MIN;
await loc({ la: la + 500 * M, lo, acc: 90 });
NOW += 5 * SEC;
r = await loc({ la: la + 530 * M, lo, acc: 8 });
chk(!r.same && near(cur().la, la + 530 * M), '직전이 부정확(90m)했어도 오차 8m 새 위치는 받는다');

console.log('\n' + ok + ' 통과, ' + bad + ' 실패');
process.exit(bad ? 1 : 0);
