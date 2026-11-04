// 비용 절감 시험(s426): 부모가 키즈 화면을 보는 동안만 자녀 보고를 촘촘히 받고(watch 푸시 · 응답 w) · 가는 방향 · 따라가기(fol) · 15분 뒤 느슨해짐 · 보는 사람이 없으면 원래대로
// 실행: node --no-warnings test/slow.test.mjs
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


const countSql = (re) => { let n = 0; const orig = DB.prepare; return { start() { n = 0; DB.prepare = (sql) => { if (re.test(sql)) n++; return orig(sql); }; }, stop() { DB.prepare = orig; return n; } }; };
const rev = () => (rows('SELECT n FROM rev WHERE cid=?', CID)[0] || { n: 0 }).n;
const dayWd = () => ((new Date(NOW + 9 * 3600000).getUTCDay() + 6) % 7);

// ── ① 처음 한 번은 느리게 하지 않는다 · 가만히 있고 장소와 멀면 sl:1 ──
let r = await loc();
chk(r.ok && !r.sl, '첫 보고에는 sl 이 없다(이전 위치를 모르니)');
NOW += 5 * MIN; r = await loc();
chk(r.ok && r.sl === 1 && !r.w, '같은 자리에서 다시 보고하고 장소·약속·보는 사람이 없으면 sl:1');

// ── 움직이면 sl 이 없다 ──
NOW += 5 * MIN; la += 400 * M; r = await loc();
chk(r.ok && !r.sl, '400m 움직인 보고에는 sl 이 없다(이동 중)');
NOW += 5 * MIN; r = await loc();
chk(!r.sl, '움직인 지 5분밖에 안 지났으면 sl 이 없다(10분 이상 가만히 있어야)');
NOW += 6 * MIN; r = await loc();
chk(r.sl === 1, '10분 넘게 가만히 있으면 다시 sl:1');

// ── 등록 장소 500m 안이면 sl 이 없다 ──
DB._db.prepare('INSERT INTO places(id,cid,name,la,lo,hh,mm,days,t) VALUES(?,?,?,?,?,?,?,?,?)').run('plc00001', CID, '학원', la + 300 * M, lo, 15, 0, 0, NOW);
NOW += 5 * MIN; r = await loc();
chk(!r.sl, '등록 장소가 300m 안에 있으면 sl 이 없다(원래 주기)');
DB._db.prepare('UPDATE places SET la=? WHERE id=?').run(la + 800 * M, 'plc00001');
NOW += 5 * MIN; r = await loc();
chk(r.sl === 1, '장소가 800m 밖이면 sl:1');

// ── 약속 시간대면 sl 이 없다(약속 40분 전부터 · 약속 뒤 2시간까지) ──
{
  const KST = 9 * 3600000, ds = Math.floor((NOW + KST) / 86400000) * 86400000 - KST;
  const setEta = (eta, tc) => {
    const mins = Math.round((eta - ds) / MIN);
    DB._db.prepare('UPDATE places SET hh=?,mm=?,days=? WHERE id=?').run(Math.floor(mins / 60), mins % 60, 1 << dayWd(), 'plc00001');
    const ymd = Number(new Date(NOW + KST).toISOString().slice(0, 10).replace(/-/g, ''));
    DB._db.prepare('INSERT OR REPLACE INTO trips(id,cid,pl,day,st,tn,tk,td,ta,tc) VALUES(?,?,?,?,?,?,?,?,?,?)').run('plc00001:' + ymd, CID, 'plc00001', ymd, 'due', NOW, 0, 0, 0, tc ? 1 : 0);
  };
  NOW += 5 * MIN; setEta(NOW + 30 * MIN); r = await loc();
  chk(!r.sl, '약속이 30분 뒤면 sl 이 없다(원래 주기)');
  NOW += 5 * MIN; setEta(NOW + 3 * 3600000); r = await loc();
  chk(r.sl === 1, '약속이 3시간 뒤면 sl:1');
  NOW += 5 * MIN; setEta(NOW + 30 * MIN, true); r = await loc();
  chk(r.sl === 1, '이미 끝난(도착한) 약속은 창에 넣지 않는다');
  NOW += 5 * MIN; setEta(NOW - 60 * MIN); r = await loc();
  chk(!r.sl, '약속 시각이 1시간 지났어도(2시간 안) sl 이 없다(도착 · 안 옴 알림 대기)');
}

// ── 보는 사람이 있으면 sl 이 없다 ──
await hubScr(); await hubScr('wait');
NOW += 2 * SEC; r = await loc();
chk(!r.sl && r.w > 0, '부모가 키즈 화면을 보는 중이면 sl 이 없고 w 가 온다');

// ── ② 아무도 안 보면 화면 갱신 신호(rev)를 올리지 않는다 · 보는 중에는 올린다 ──
NOW += 2 * MIN;                                  // 보는 중 시각이 지나 보는 사람 없음
const rv0 = rev(); la += 30 * M; r = await loc();
chk(rev() === rv0, '아무도 안 볼 때 30m 움직인 보고는 rev 를 올리지 않는다(쓰기 1건 절약)');
await hubScr('wait'); NOW += 2500; const rv1 = rev(); la += 30 * M; r = await loc();
chk(rev() === rv1 + 1, '부모가 보는 중이면 움직임마다 rev 를 올려 화면이 바로 바뀐다');
const scr = await hubScr();
const pin = tmapOf(scr).pts.find((p) => p.k === 'm');
chk(pin && Math.abs(pin.la - la) < 1e-6, '화면을 새로 열면 현재 위치를 그대로 받는다(rev 를 안 올려도 최신)');

// ── ③ 위치 표 UPDATE 는 보고 한 번에 한 문장 ──
{
  NOW += 3 * MIN; const c = countSql(/^UPDATE loc SET/); c.start(); la += 150 * M; await loc(); const n1 = c.stop();
  chk(n1 <= 1, '이동 보고 한 번의 loc UPDATE 는 ' + n1 + '번(예전엔 최대 5번)');
  const lrow = rows('SELECT ha,hb,hat,mva,mvo,mvt FROM loc')[0];
  chk(lrow.hat === NOW && lrow.mvt > 0, '합쳐도 기준점(ha/hat)과 이동 기록(mva/mvt) 값이 함께 갱신된다');
}

// ── s428: 긴급 호출 · 데리러 와줘가 열려 있으면 느린 보고 대신 촘촘히 ──
{
  DB._db.exec('DELETE FROM trips; DELETE FROM places');                      // 앞 시험에서 남은 약속 · 장소를 치운다
  NOW += 3 * MIN; la += 5000 * M; await loc();                               // 멀리 이동(등록 장소와 떨어진 곳)
  NOW += 12 * MIN; await loc(); NOW += 12 * MIN; r = await loc();
  chk(r.sl === 1 && !r.w, '(기준) 호출이 없으면 가만히 있을 때 sl:1');
  for (const k of ['sos', 'pick']) {
    const cr = await req('POST', '/c/call', 'c', { k, la, lo });
    chk(cr.ok, k + ' 호출을 만든다');
    NOW += 12 * MIN; const rv = rev(); la += 30 * M; r = await loc();
    chk(!r.sl && r.w > 0, k + ' 호출이 열려 있으면 sl 이 없고 w 가 와서 빠른 주기가 된다');
    chk(rev() === rv + 1, k + ' 호출 중에는 움직임마다 rev 를 올려 부모 화면이 바로 바뀐다');
    await req('POST', '/c/call', 'c', { k, op: 'cancel' });
    NOW += 12 * MIN; r = await loc(); NOW += 12 * MIN; r = await loc();
    chk(r.sl === 1 && !r.w, k + ' 호출을 취소하면 다시 느린 보고가 된다');
  }
  await req('POST', '/c/call', 'c', { k: 'sos', la, lo });
  NOW += 12 * MIN; r = await loc();
  chk(r.w > 0 && !r.sl, '호출이 12분 지났어도 30분 안이면 빠른 주기');
  NOW += 25 * MIN; r = await loc();
  chk(r.sl === 1 && !r.w, '30분이 지나면 부모가 확인하지 않았어도 다시 느린 보고(호출은 계속 열려 있음)');
  await req('POST', '/c/call', 'c', { k: 'sos', op: 'cancel' });
}

{
  const calls = fs.readFileSync(new URL('../app/src/main/java/com/dullyyj/kids/Calls.java', import.meta.url).pathname, 'utf8');
  chk((calls.match(/LocReq\.watch\(a\.getApplicationContext\(\)\)/g) || []).length === 2, '앱: 긴급 호출 · 데리러 와줘가 나가면 바로 빠른 보고(arr 안전 도착은 아님)');
}

console.log(`${ok} 통과, ${bad} 실패`); process.exit(bad ? 1 : 0);
