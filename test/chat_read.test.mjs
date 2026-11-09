// 가족대화 안 읽은 사람 수(카톡처럼) · 쓴 사람 이름 · 시각 시험. 실행: node --no-warnings test/chat_read.test.mjs
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
const M = (await import(file + '?chat')).default;
const CID = 'child000001', P1 = 'parent00001', P2 = 'parent00002', CS = 'c'.repeat(20), S1 = 'p'.repeat(20), S2 = 'q'.repeat(20);
const sec = { [CID]: CS, [P1]: S1, [P2]: S2 };
const env = { DB };
const req = async (method, path, id, body) => {
  const h = { 'content-type': 'application/json' };
  if (id) { h['x-id'] = id; h['x-sec'] = sec[id]; }
  const r = await M.fetch(new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const j = await r.json(); await flush(); return j;
};
await req('POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req('POST', '/reg', null, { id: P1, sec: S1, role: 'p' });
await req('POST', '/reg', null, { id: P2, sec: S2, role: 'p' });
let pr = await req('POST', '/c/pair', CID, {});
await req('POST', '/p/join', P1, { code: pr.code, nm: '엄마' });
pr = await req('POST', '/c/pair', CID, {});
await req('POST', '/p/join', P2, { code: pr.code, nm: '아빠' });
await req('POST', '/p/act', P1, { v: 'kg.ok', cid: CID });
await req('POST', '/p/act', P2, { v: 'kg.ok', cid: CID });
// 링크 시각을 글보다 앞으로(같은 밀리초에 만들어지므로)
DB._db.exec('UPDATE links SET t=1');
DB._db.prepare("UPDATE links SET pnm='엄마' WHERE pid=?").run(P1);
DB._db.prepare("UPDATE links SET pnm='아빠' WHERE pid=?").run(P2);

const chatMsgs = async () => {
  const j = await req('GET', '/c/screen?tab=chat&fg=1', CID);
  const box = j.screen.blocks[2];
  return { box, msgs: box.kids.filter((k) => k.t === 'msg') };
};
const un = (m) => (m.un === undefined ? 0 : +m.un);

// 1) 가족이 글을 보냄 — 부모 2명이 아직 안 봄 → 2
await req('POST', '/c/act', CID, { v: 'chat.send', arg: '안녕', tab: 'chat' });
let r = await chatMsgs();
chk(r.msgs.length === 1 && r.msgs[0].me === '1' && un(r.msgs[0]) === 2, '3명 방: 내 글을 아무도 안 읽으면 2');
chk(r.box.unall === '2', '박스에 처음 값(unall=연결된 부모 수 2)이 실린다');
chk(/^\d\d:\d\d$/.test(r.msgs[0].time), '오늘 글은 시각만(길동무처럼) ' + r.msgs[0].time);
chk(r.msgs[0].nick === undefined, '내 글에는 이름이 없다');
// 2) 엄마가 대화방을 열면 → 1
await req('POST', '/p/act', P1, { v: 'kc.open', cid: CID });
r = await chatMsgs();
chk(un(r.msgs[0]) === 1, '엄마가 읽으면 1');
// 3) 엄마가 또 열어도(이미 읽음) 그대로 1
await req('POST', '/p/act', P1, { v: 'kc.open', cid: CID });
r = await chatMsgs();
chk(un(r.msgs[0]) === 1, '같은 부모가 또 읽어도 1');
// 4) 아빠가 읽으면 → 숫자가 사라진다
await req('POST', '/p/act', P2, { v: 'kc.open', cid: CID });
r = await chatMsgs();
chk(un(r.msgs[0]) === 0 && r.msgs[0].un === undefined, '아빠까지 읽으면 숫자가 없다');
// 5) 엄마가 글을 보냄: 이름이 붙고(엄마), 아빠가 아직 안 읽음 → 1 (엄마 본인은 읽은 걸로)
await req('POST', '/p/act', P1, { v: 'kc.send', cid: CID, f: { kct: '뭐해' } });
r = await chatMsgs();
const m2 = r.msgs[1];
chk(m2.me === '0' && m2.nick === '엄마', '부모 글에는 쓴 사람 이름(엄마)이 붙는다');
chk(un(m2) === 1, '엄마 글: 아빠만 안 읽음 → 1(보낸 엄마·나는 제외)');
// 6) 가족이 보고 있어도(내 앱) 아빠가 읽기 전까지 1, 아빠가 읽으면 0
await req('POST', '/p/act', P2, { v: 'kc.open', cid: CID });
r = await chatMsgs();
chk(un(r.msgs[1]) === 0, '아빠가 읽으면 엄마 글도 숫자가 없다');
chk(un(r.msgs[0]) === 0, '먼저 글은 계속 숫자가 없다');
// 7) 글보다 늦게 연결된 부모는 세지 않는다
const P3 = 'parent00003', S3 = 'r'.repeat(20); sec[P3] = S3;
await req('POST', '/reg', null, { id: P3, sec: S3, role: 'p' });
pr = await req('POST', '/c/pair', CID, {});
await req('POST', '/p/join', P3, { code: pr.code, nm: '할머니' });
await req('POST', '/p/act', P3, { v: 'kg.ok', cid: CID });
r = await chatMsgs();
chk(r.msgs.every((m) => un(m) === 0), '글보다 나중에 연결된 부모(할머니)는 옛 글의 안 읽은 수에 안 들어간다');
await req('POST', '/c/act', CID, { v: 'chat.send', arg: '할머니도 왔다', tab: 'chat' });
r = await chatMsgs();
chk(un(r.msgs[2]) === 3 && r.box.unall === '3', '새 글: 부모 3명 모두 안 읽음 → 3');
await req('POST', '/p/act', P3, { v: 'kc.open', cid: CID });
r = await chatMsgs();
chk(un(r.msgs[2]) === 2, '할머니가 읽으면 3 → 2');
// 8) 예전 방식(부모별 기록이 생기기 전) 글은 '부모 누구든 읽었으면 읽음'을 따른다 — 시작 번호(rdpp)까지의 글에만
DB._db.exec("DELETE FROM chat_rd WHERE s LIKE 'p:%'");
const top = DB._db.prepare('SELECT MAX(id) m FROM chat').get().m;
DB._db.prepare("UPDATE meta SET v=? WHERE k='rdpp'").run(String(top));
DB._db.prepare("UPDATE chat_rd SET id=? WHERE cid=? AND s='p'").run(top, CID);
r = await chatMsgs();
chk(r.msgs.every((m) => un(m) === 0), '옛 글(시작 번호 이하): 부모 누구든 읽었다는 옛 기록을 따라 숫자가 없다');
await req('POST', '/c/act', CID, { v: 'chat.send', arg: '새 글', tab: 'chat' });
r = await chatMsgs();
chk(un(r.msgs[3]) === 3, '시작 번호 뒤의 새 글은 부모별로 센다 → 3');
console.log('\n' + ok + ' ok, ' + bad + ' fail');
process.exit(bad ? 1 : 0);
