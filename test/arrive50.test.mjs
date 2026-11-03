// 도착 50m 시험(s403): 등록 장소 50m 안에 들어서면 도착(알림 · 출발한 길이면 길동무포인트) — 80m 넘게 벗어나야 다시
// 실행: node --no-warnings test/arrive50.test.mjs
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


const PL = 'plc00001', PLA = 37.5, PLO = 126.84;
DB._db.prepare('INSERT INTO places(id,cid,name,la,lo,hh,mm,days,t) VALUES(?,?,?,?,?,?,?,?,?)').run(PL, CID, '쮸르 집', PLA, PLO, 0, 0, 0, NOW);
const arrPush = (from) => pushes.slice(from).filter((p) => p.data.k === 'zone' && p.token === PTK && /도착했어요/.test(p.data.body || '')).length;
const nearPush = (from) => pushes.slice(from).filter((p) => p.data.k === 'zone' && p.token === PTK && /근처에 왔어요/.test(p.data.body || '')).length;
const star = () => (rows('SELECT n FROM stars WHERE cid=?', CID)[0] || { n: 0 }).n;
const at = (m, acc = 10) => { la = PLA + m * M; lo = PLO; return loc({ acc }); };

await at(400);                                              // 멀리(400m)
let a = pushes.length;
NOW += 20 * SEC; await at(140);                              // 150m 안 → 근처
chk(nearPush(a) === 1 && arrPush(a) === 0, '140m 에서는 "근처에 왔어요"만(도착은 아직)');
a = pushes.length; NOW += 20 * SEC; await at(70);
chk(arrPush(a) === 0 && rows('SELECT ap FROM loc WHERE cid=?', CID)[0].ap === '', '70m 는 아직 도착이 아니다');
a = pushes.length; NOW += 20 * SEC; await at(45);
chk(arrPush(a) === 1, '45m 안에 들어서면 "도착했어요" 알림 1건');
chk(star() === 10 && /포인트 \+10/.test(pushes.slice(a).find((p) => p.data.k === 'zone' && /도착했어요/.test(p.data.body || '')).data.body), 's422: 출발 단추 · 시각 규칙이 없어도(요일 없는 장소) 그날 첫 도착이면 길동무포인트 10 + 알림 글에 포인트');
chk(rows('SELECT ap FROM loc WHERE cid=?', CID)[0].ap === PL && rows('SELECT k FROM evs WHERE cid=? AND k=?', CID, 'in').length === 1, '도착 장소가 기록되고 활동 줄 1개');
a = pushes.length; NOW += 20 * SEC; await at(30); NOW += 20 * SEC; await at(55); NOW += 20 * SEC; await at(48);
chk(arrPush(a) === 0, '안에서 왔다 갔다(80m 안)해도 알림이 또 가지 않는다');
a = pushes.length; NOW += 20 * SEC; await at(120); NOW += 6 * MIN; await at(40);
chk(arrPush(a) === 1, '80m 넘게 벗어났다가 다시 50m 안에 들어오면 다시 도착');
chk(star() === 10, 's422: 같은 장소를 하루에 다시 도착해도 포인트는 한 번만(10 그대로)');

// 오차가 큰 위치로는 도착으로 보지 않는다
NOW += 6 * MIN; await at(300); NOW += 6 * MIN;
a = pushes.length; await at(20, 90);
chk(arrPush(a) === 0, '오차 90m 위치는 도착으로 치지 않는다');

// 출발한 길(go)이 있으면 단추 없이 도착 확인 + 길동무포인트
NOW += 6 * MIN; await at(300);
const day = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW)).replace(/-/g, ''));
DB._db.prepare("INSERT INTO trips(id,cid,pl,day,st,tn,td) VALUES(?,?,?,?,'go',?,?)").run(PL + ':' + day, CID, PL, day, NOW, NOW);
const s0 = star(); a = pushes.length; NOW += 6 * MIN; await at(40);
const tr = rows('SELECT st,tc FROM trips WHERE cid=?', CID)[0];
chk(tr && tr.st === 'done' && tr.tc === NOW && star() === s0, '출발한 길은 50m 안에서 자동으로 도착 확인(오늘 이미 받았으면 포인트는 더 주지 않는다)');
chk(pushes.slice(a).filter((p) => p.data.k === 'done' && p.token === PTK).length === 1 && nearPush(a) === 0 && !/포인트/.test(pushes.slice(a).find((p) => p.data.k === 'done').data.body), '이미 받은 날은 "도착했어요" 알림에 포인트 글이 없다 · 같은 때 "근처에 왔어요"는 따로 가지 않는다');

// 다음날: 출발한 길이 있으면 도착 확인 + 포인트 10(하루 한 번이라 다시 받는다)
NOW += 24 * 60 * MIN; await at(300); NOW += 6 * MIN;
const day2 = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW)).replace(/-/g, ''));
DB._db.prepare("INSERT INTO trips(id,cid,pl,day,st,tn,td) VALUES(?,?,?,?,'go',?,?)").run(PL + ':' + day2, CID, PL, day2, NOW, NOW);
const s1 = star(); a = pushes.length; NOW += 6 * MIN; await at(40);
chk(star() === s1 + 10 && rows('SELECT st FROM trips WHERE id=?', PL + ':' + day2)[0].st === 'done' && /포인트 \+10/.test(pushes.slice(a).find((p) => p.data.k === 'done').data.body), '다음날 출발한 길은 도착 확인 + 포인트 10 + 알림에 포인트 글');

console.log('\n' + ok + ' 통과, ' + bad + ' 실패');
process.exit(bad ? 1 : 0);
