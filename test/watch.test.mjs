// 실시간 보기 시험(s393): 부모가 가족 화면을 보는 동안만 가족구성원 보고를 촘촘히 받고(watch 푸시 · 응답 w) · 가는 방향 · 따라가기(fol) · 15분 뒤 느슨해짐 · 보는 사람이 없으면 원래대로
// 실행: node --no-warnings test/watch.test.mjs
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

// ── 보는 사람이 없을 때 = 원래대로 ──
let r1 = await loc();
chk(r1.ok && !r1.w, '보는 사람이 없으면 응답에 주기 종류(w)가 없다(원래 주기)');
NOW += 1 * SEC; la += 3 * M;
r1 = await loc();
chk(r1.same === 1, '보는 사람이 없을 때 1초 만에 3m 움직인 보고는 건너뛴다(12초 · 8m 규칙)');

// ── 보기 시작: watch 푸시 ──
NOW += 30 * SEC;
let a = pushes.length;
const h1 = await hubScr();
chk(h1.ok && watchPushes(a) === 1, '부모가 가족 화면을 열면 가족구성원 폰에 watch 푸시 1건');
a = pushes.length; NOW += 10 * SEC; await hubScr('wait');
chk(watchPushes(a) === 0, '이어서 보는 동안(대기가 이어짐)은 푸시를 또 보내지 않는다');
chk(rows('SELECT wt,ws FROM devices WHERE id=?', PID)[0].wt === NOW, '긴 대기(/p/wait)도 "보는 중" 시각을 갱신한다');

// ── 보는 중: 촘촘한 보고 · 응답 w ──
NOW += 2500; let r2 = await loc();
chk(r2.ok && r2.w === 3, '보는 중이고 가만히 있으면 w=3(15초 주기)');
const steps = [];
for (let i = 0; i < 6; i++) { NOW += 2500; la += 3.5 * M; steps.push(await loc()); }
chk(steps.every((s) => !s.same), '보는 중에는 2.5초마다 3.5m 걷는 보고를 건너뛰지 않고 받는다');
chk(steps[steps.length - 1].w === 1, '걷고 있으면 w=1(2.5초 주기)');
chk(rows('SELECT t FROM loc')[0].t === NOW, '위치가 매번 갱신된다');
const hd1 = rows('SELECT hd FROM loc')[0].hd;
chk(hd1 === 0 || hd1 >= 355 || hd1 <= 5, '북쪽으로 걸으면 방향 ' + hd1 + '도(≈0)');
for (let i = 0; i < 5; i++) { NOW += 2500; lo += 3.5 * M * 1.26; await loc(); }
const hd2 = rows('SELECT hd FROM loc')[0].hd;
chk(hd2 >= 80 && hd2 <= 100, '동쪽으로 걸으면 방향 ' + hd2 + '도(≈90)');

// ── 화면: 따라가기 · 방향 ──
NOW += 1 * SEC; await hubScr('wait');
const hub = await hubScr('wait');
const tm = tmapOf(hub);
chk(tm.fol === 1, '보는 중이고 위치가 방금 온 것이면 지도에 fol:1(따라가기)');
const mePin = tm.pts.find((p) => p.k === 'm');
chk(mePin && mePin.h >= 80 && mePin.h <= 100, '가족구성원 점에 가는 방향 h=' + (mePin && mePin.h));
chk(/따라가는 중/.test(tm.hint), '안내 글이 따라가는 중으로 바뀐다');
if (process.env.DUMP_DIR) { fs.mkdirSync(process.env.DUMP_DIR, { recursive: true }); fs.writeFileSync(process.env.DUMP_DIR + '/hub_follow.json', JSON.stringify(hub.screen)); }

// ── 멈추면 ──
NOW += 70 * SEC; await hubScr('wait'); NOW += 2500;
const r3 = await loc();
chk(r3.w === 3, '70초 가만히 있으면 w=3(15초 주기)로 느슨해진다');
const hub2 = await hubScr('wait');
chk(!tmapOf(hub2).pts.find((p) => p.k === 'm').h, '멈춘 뒤에는 방향 화살표를 주지 않는다');

// ── 15분 넘게 이어 보면 ──
let wcode = 0;
for (let i = 0; i < 34; i++) { NOW += 30 * SEC; await hubScr('wait'); if (i === 33) { NOW += 1 * SEC; la += 3 * M; wcode = (await loc()).w; } }
chk(wcode === 2, '15분 넘게 이어 보면 w=2(10초 주기)로 더 느슨해진다');

// ── 보는 사람이 없어지면 ──
NOW += 45 * SEC; la += 20 * M;
const r4 = await loc();
chk(r4.ok && !r4.w, '대기가 끊기고 40초가 지나면 w 가 없다(가족구성원 앱이 원래 주기로 돌아간다)');
const hub3 = await req('POST', '/p/act', 'p', { v: 'kh.none', cid: CID });
a = pushes.length; NOW += 5 * SEC; await hubScr();
chk(watchPushes(a) === 1, '다시 열면 새로 보기 시작한 것이라 watch 푸시를 다시 보낸다');

// ── 지난 경로를 보는 중에는 따라가지 않는다 ──
{
  DB._db.prepare("INSERT INTO routes(cid,t0,t1,m,sn,en,pts) VALUES(?,?,?,?,?,?,?)").run(CID, NOW - HOUR(), NOW - HOUR() + 10 * MIN, 500, '집', '학교', JSON.stringify([[37.5, 126.84], [37.502, 126.842], [37.504, 126.845]]));
  const id = rows('SELECT id FROM routes')[0].id;
  const pk = await req('POST', '/p/act', 'p', { v: 'kr.' + id, cid: CID });
  chk(!tmapOf(pk).fol, '지난 경로를 보는 중에는 fol 이 없다');
  await req('POST', '/p/act', 'p', { v: 'kr.live', cid: CID });
}
function HOUR() { return 3600000; }

// ── 화면 해석기용 덤프 ──
// ── 해제 ──
await req('POST', '/c/unlink', 'c', {});
chk(rows('SELECT COUNT(*) n FROM loc')[0].n === 0, '연결을 끊으면 위치가 지워진다');
console.log(`${ok} 통과, ${bad} 실패`); process.exit(bad ? 1 : 0);
