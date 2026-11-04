// 실시간 깨우기 허브 시험(s425): Durable Object 가 연결돼 있으면 기다리는 동안 DB 를 읽지 않고, 서버가 달라도 바뀌는 즉시 깨어난다.
// 연결돼 있지 않으면 예전과 똑같이 동작한다. 실행: node --no-warnings test/hub.test.mjs
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { FamHub } from '../engine/kids-hub-do.js';

const file = new URL('../engine/kids-worker.js', import.meta.url).pathname;
let ok = 0, bad = 0;
const chk = (c, msg) => { if (c) { ok++; console.log('  ok  ', msg); } else { bad++; console.log('  FAIL', msg); } };
const C = { n: 0 };
function mkD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, params) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { C.n++; const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
    first: async () => { C.n++; return db.prepare(sql).get(...params) || null; },
    all: async () => { C.n++; return { results: db.prepare(sql).all(...params) }; },
  });
  return { prepare: (sql) => stmt(sql, []), batch: async (arr) => { db.exec('BEGIN'); try { for (const s of arr) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; }, _db: db };
}
// 가짜 Durable Object 이름공간: 진짜 FamHub 클래스를 그대로 쓴다(이름마다 하나)
function fakeNs() {
  const objs = new Map(), calls = [];
  return { calls, idFromName: (n) => n, get: (id) => { if (!objs.has(id)) objs.set(id, new FamHub({})); const o = objs.get(id); return { fetch: async (u) => { calls.push(String(u)); return o.fetch(new Request(String(u))); } }; } };
}
const DB = mkD1();
const FAM = fakeNs();
const envHub = { DB, FAM }, envPlain = { DB };
let pend = [];
const ctx = { waitUntil: (p) => { pend.push(p); } };
const flush = async () => { await Promise.all(pend); pend = []; };
const A = (await import(file + '?A')).default, B = (await import(file + '?B')).default;     // 서로 다른 서버(모듈 두 개)
const CID = 'child000001', PID = 'parent00001', CS = 'c'.repeat(20), PS = 'p'.repeat(20);
const req = async (mod, env, method, path, who, body) => {
  const h = { 'content-type': 'application/json' };
  if (who === 'c') { h['x-id'] = CID; h['x-sec'] = CS; } else if (who === 'p') { h['x-id'] = PID; h['x-sec'] = PS; }
  const r = await mod.fetch(new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const j = await r.json(); await flush(); return j;
};
await req(A, envPlain, 'POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req(A, envPlain, 'POST', '/reg', null, { id: PID, sec: PS, role: 'p' });
const pr = await req(A, envPlain, 'POST', '/c/pair', 'c', {});
await req(A, envPlain, 'POST', '/p/join', 'p', { code: pr.code, nm: '쭈르' });
await req(A, envPlain, 'POST', '/p/act', 'p', { v: 'kg.ok', cid: CID });
const rev0 = DB._db.prepare('SELECT n FROM rev WHERE cid=?').get(CID);
const R0 = rev0 ? rev0.n : 0;

// 1) 허브가 없으면: 예전 방식 — 다른 서버가 바꿔도 DB 를 보다가 알아챈다(0.6초 안)
{
  const t0 = Date.now();
  const w = req(A, envPlain, 'GET', '/c/wait?since=' + R0 + '&tab=home', 'c');
  await new Promise((r) => setTimeout(r, 150));
  await req(B, envPlain, 'POST', '/c/ev', 'c', { k: 'feed', x: '밥' });
  const j = await w, dt = Date.now() - t0;
  chk(j && j.rev > R0 && dt < 1000, '허브 없음: 예전처럼 바뀌면 0.6초 안에 알아챈다(' + dt + 'ms)');
}
const R1 = DB._db.prepare('SELECT n FROM rev WHERE cid=?').get(CID).n;
// 2) 허브가 있으면: 다른 서버가 바꾸면 곧바로 깨어난다 + 기다리는 동안 DB 읽기가 거의 없다
{
  FAM.calls.length = 0;
  const t0 = Date.now();
  C.n = 0;
  const w = req(A, envHub, 'GET', '/c/wait?since=' + R1 + '&tab=home', 'c');
  await new Promise((r) => setTimeout(r, 1800));       // 예전 방식이면 이 사이 DB 를 3번쯤 더 읽는다
  const reads = C.n;
  await req(B, envHub, 'POST', '/c/ev', 'c', { k: 'feed', x: '간식' });
  const j = await w, dt = Date.now() - t0;
  chk(j && j.rev > R1, '허브 있음: 다른 서버가 바꾸면 기다리던 쪽이 새 rev 를 받는다');
  chk(dt < 1800 + 300, '바뀐 뒤 0.3초 안에 깨어난다(' + (dt - 1800) + 'ms)');
  chk(reads <= 6, '1.8초 기다리는 동안 DB 호출 ' + reads + '번(예전 방식은 인증 · rev 읽기 + 0.6초마다 읽기)');
  chk(FAM.calls.some((u) => u.includes('/bump?rev=')) && FAM.calls.some((u) => u.includes('/wait?rev=')), '허브에 바뀜 신호(bump)와 기다림(wait)이 간다');
}
// 3) 이미 바뀐 값을 들고 오면 기다리지 않고 바로 돌려준다
{
  const t0 = Date.now();
  const j = await req(A, envHub, 'GET', '/c/wait?since=' + (R1 - 1) + '&tab=home', 'c');
  chk(j && j.rev >= R1 && Date.now() - t0 < 500, '이미 바뀐 것은 바로 돌려준다');
}
// 4) 허브가 응답하지 않아도 예전 방식으로 끝까지 돌아간다
{
  const R2 = DB._db.prepare('SELECT n FROM rev WHERE cid=?').get(CID).n;
  const broken = { DB, FAM: { idFromName: (n) => n, get: () => ({ fetch: async () => { throw new Error('hub down'); } }) } };
  const t0 = Date.now();
  const w = req(A, broken, 'GET', '/c/wait?since=' + R2 + '&tab=home', 'c');
  await new Promise((r) => setTimeout(r, 200));
  await req(B, envPlain, 'POST', '/c/ev', 'c', { k: 'feed', x: '점심' });
  const j = await w;
  chk(j && j.rev > R2 && Date.now() - t0 < 3500, '허브가 죽어도 기다리던 요청은 새 값을 받는다(' + (Date.now() - t0) + 'ms)');
}
// 5) FamHub 자체: 신호 · 기다림 · 시간 초과
{
  const h = new FamHub({});
  const w = h.fetch(new Request('https://hub/wait?rev=5&ms=2000')).then((r) => r.json());
  await new Promise((r) => setTimeout(r, 50));
  await h.fetch(new Request('https://hub/bump?rev=6'));
  const j = await w;
  chk(j.woke === 1 && j.rev === 6, '허브: bump 가 오면 기다리는 요청을 깨운다');
  const t0 = Date.now();
  const j2 = await (await h.fetch(new Request('https://hub/wait?rev=6&ms=300'))).json();
  chk(j2.woke === 0 && Date.now() - t0 >= 280, '허브: 아무 일 없으면 시간이 다 되어 돌려준다');
  const j3 = await (await h.fetch(new Request('https://hub/wait?rev=3&ms=5000'))).json();
  chk(j3.woke === 1, '허브: 방금 바뀐 값보다 낮은 값을 들고 오면 바로 돌려준다');
  h.at = Date.now() - 60000;                           // 옛 신호만 남은 경우 계속 즉시 돌려주지 않는다
  const t1 = Date.now();
  const j4 = await (await h.fetch(new Request('https://hub/wait?rev=3&ms=200'))).json();
  chk(j4.woke === 1 || Date.now() - t1 >= 180, '허브: 옛 신호는 즉시 응답의 근거가 되지 않는다');
}
console.log('\n' + ok + ' 통과, ' + bad + ' 실패');
process.exit(bad ? 1 : 0);
