// 자녀가 여럿일 때 확인 화면을 좌우로 밀면 다른 가족구성원(지도 · 뭐하니 · 퀘스트)으로 — 시험. 실행: node --no-warnings test/multi_kid.test.mjs
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

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
const M = (await import(file + '?mk')).default;
const CID = 'child000001', CID2 = 'child000002', P1 = 'parent00001', CS = 'c'.repeat(20), CS2 = 'd'.repeat(20), S1 = 'p'.repeat(20);
const sec = { [CID]: CS, [CID2]: CS2, [P1]: S1 };
const env = { DB };
const req = async (method, path, id, body) => {
  const h = { 'content-type': 'application/json' };
  if (id) { h['x-id'] = id; h['x-sec'] = sec[id]; }
  const r = await M.fetch(new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const j = await r.json(); await flush(); return j;
};
await req('POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req('POST', '/reg', null, { id: CID2, sec: CS2, role: 'c' });
await req('POST', '/reg', null, { id: P1, sec: S1, role: 'p' });
let pr = await req('POST', '/c/pair', CID, {});
await req('POST', '/p/join', P1, { code: pr.code, nm: '엄마' });
pr = await req('POST', '/c/pair', CID2, {});
await req('POST', '/p/join', P1, { code: pr.code, nm: '엄마' });
await req('POST', '/p/act', P1, { v: 'kg.ok', cid: CID });
DB._db.exec("UPDATE links SET nm='첫째' WHERE cid='" + CID + "'");
DB._db.exec("UPDATE links SET nm='둘째' WHERE cid='" + CID2 + "'");
DB._db.exec("INSERT INTO quests(id,cid,k,x,s,t,pt,fl) VALUES('qa1','" + CID + "','c','첫째 미션',0,1,10,1),('qb1','" + CID2 + "','c','둘째 미션1',0,1,10,1),('qb2','" + CID2 + "','c','둘째 미션2',0,1,10,1)");
const hub = async (cid) => req('GET', '/p/screen?v=hub&cid=' + cid, P1);
const h1 = await hub(CID), h2 = await hub(CID2);
chk(h1.screen && h1.screen.sw && h1.screen.sw.l && /kc\./.test(JSON.stringify(h1.screen.sw)), '자녀가 둘이면 화면에 좌우 밀기(sw)가 있다');
chk(h1.screen.sw.l.v === 'kc.' + CID2 && h1.screen.sw.r.v === 'kc.' + CID2, '둘뿐이면 어느 쪽으로 밀어도 다른 가족구성원으로 간다');
const sw = await req('POST', '/p/act', P1, { v: h1.screen.sw.l.v, cid: CID });
chk(sw.cid === CID2 && /둘째 뭐하니/.test(JSON.stringify(sw.screen)), '밀면 그 가족구성원의 뭐하니? 로 바뀐다');
const qtxt = (j) => JSON.stringify(j.screen.body.filter((n) => n.t === 'panel').map((n) => n)).match(/가족구성원 미션 (\d+)/);
chk(qtxt(h1) && qtxt(h1)[1] === '1' && qtxt(sw) && qtxt(sw)[1] === '2', '퀘스트(미션 수)도 그 가족구성원 것으로 바뀐다');
const q2 = await req('POST', '/p/act', P1, { v: 'kq.open', cid: CID2, t: 'c' });
chk(/둘째 미션1/.test(JSON.stringify(q2.screen)) && !/첫째 미션/.test(JSON.stringify(q2.screen)), '퀘스트 팝업도 지금 보는 가족구성원 것');
console.log(ok + ' 통과, ' + bad + ' 실패'); process.exit(bad ? 1 : 0);
