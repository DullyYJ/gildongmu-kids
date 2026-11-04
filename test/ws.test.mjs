// WebSocket 초인종 시험(s426): 기본은 꺼짐(예전과 똑같이) · 켜면 /c/ws · /p/ws 가 허브로 넘어가고, 바뀌면 허브가 연결된 앱들에게 {r:rev} 한 줄을 보낸다.
// 앱은 그 한 줄을 받으면 평소 요청(nw=1: 붙들지 않고 바로 답)으로 새 화면을 받아 간다. 실행: node --no-warnings test/ws.test.mjs
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { FamHub } from '../engine/kids-hub-do.js';

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
// 가짜 절전 연결 환경: acceptWebSocket · getWebSockets · WebSocketPair · 101 응답(Node 의 Response 는 101 을 못 만든다)
const sockets = [];
const mkSock = () => { const s = { sent: [], send(m) { this.sent.push(String(m)); }, close() { this.closed = 1; } }; return s; };
globalThis.WebSocketPair = function () { const a = mkSock(), b = mkSock(); a.peer = b; this[0] = a; this[1] = b; };
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse { constructor(body, init) { if (init && init.status === 101) { super(null, { status: 200 }); this.fake101 = true; this.webSocket = init.webSocket; Object.defineProperty(this, 'status', { value: 101 }); } else super(body, init); } };
function fakeNs() {
  const objs = new Map(), calls = [];
  const stateOf = () => ({ acceptWebSocket(s) { sockets.push(s); }, getWebSockets() { return sockets.filter((s) => !s.closed); } });
  return { calls, idFromName: (n) => n, get: (id) => { if (!objs.has(id)) objs.set(id, new FamHub(stateOf())); const o = objs.get(id); return { fetch: async (u) => { const rq = u instanceof Request ? u : new Request(String(u)); calls.push(rq.url); return o.fetch(rq); } }; } };
}
const DB = mkD1();
const FAM = fakeNs();
const envOff = { DB, FAM }, envNoHub = { DB, WS_MODE: 'all' }, envAll = { DB, FAM, WS_MODE: 'all' };
const CID = 'child000001', PID = 'parent00001', CID2 = 'child000002', CS = 'c'.repeat(20), PS = 'p'.repeat(20);
let pend = [];
const ctx = { waitUntil: (p) => { pend.push(p); } };
const flush = async () => { await Promise.all(pend); pend = []; };
const mod = (await import(file)).default;
const call = async (env, method, path, who, body, extra) => {
  const h = Object.assign({ 'content-type': 'application/json' }, extra || {});
  if (who === 'c') { h['x-id'] = CID; h['x-sec'] = CS; } else if (who === 'p') { h['x-id'] = PID; h['x-sec'] = PS; }
  const r = await mod.fetch(new RealResponse ? new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }) : null, env, ctx);
  let j = null; if (r.fake101) j = { status: 101 }; else { try { j = await r.json(); } catch (e) { j = null; } j = j && typeof j === 'object' ? Object.assign({ status: r.status }, j) : { status: r.status }; }
  await flush(); return j;
};
await call(envOff, 'POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await call(envOff, 'POST', '/reg', null, { id: PID, sec: PS, role: 'p' });
const pr = await call(envOff, 'POST', '/c/pair', 'c', {});
await call(envOff, 'POST', '/p/join', 'p', { code: pr.code, nm: '쭈르' });
await call(envOff, 'POST', '/p/act', 'p', { v: 'kg.ok', cid: CID });
const revNow = () => (DB._db.prepare('SELECT n FROM rev WHERE cid=?').get(CID) || { n: 0 }).n;

// ── 꺼짐(기본): 허브가 있어도 WS_MODE 가 없으면 예전과 똑같다 ──
let r = await call(envOff, 'GET', '/c/ws', 'c', null, { Upgrade: 'websocket' });
chk(r.status === 404, '꺼짐: /c/ws 는 404 — 앱은 예전 긴 대기를 그대로 쓴다');
r = await call(envOff, 'GET', '/p/ws?cid=' + CID, 'p', null, { Upgrade: 'websocket' });
chk(r.status === 404, '꺼짐: /p/ws 도 404');
{
  const since = revNow(), t0 = Date.now();
  const w = call(envOff, 'GET', '/c/wait?since=' + since + '&nw=1&tab=home', 'c');
  await new Promise((res) => setTimeout(res, 800));
  await call(envOff, 'POST', '/c/ev', 'c', { k: 'feed', x: '물' });
  r = await w;
  chk(r.ws === undefined && r.rev > since && Date.now() - t0 < 5000, '꺼짐: nw=1 을 보내도 무시하고 예전처럼 붙들어 두었다가 바뀌면 답한다(ws 힌트 없음)');
}
r = await call(envNoHub, 'GET', '/c/ws', 'c', null, { Upgrade: 'websocket' });
chk(r.status === 404, '허브(FAM)가 없으면 WS_MODE=all 이어도 404');

// ── 켜짐(all) ──
r = await call(envAll, 'GET', '/c/ws', 'c', null, { Upgrade: 'websocket' });
chk(r.status === 101 && FAM.calls.some((u) => u === 'https://hub/ws'), '켜짐: /c/ws 는 허브로 넘어가 101(연결 수락)');
chk(sockets.length === 1 && sockets[0].sent[0] === '{"hi":1}', '허브가 연결을 받아 인사({hi:1})를 한 줄 보낸다');
r = await call(envAll, 'GET', '/p/ws?cid=' + CID, 'p', null, { Upgrade: 'websocket' });
chk(r.status === 101 && sockets.length === 2, '켜짐: 연결된 부모도 /p/ws 로 같은 허브에 연결');
r = await call(envAll, 'GET', '/p/ws?cid=' + CID2, 'p', null, { Upgrade: 'websocket' });
chk(r.status === 404 && sockets.length === 2, '연결돼 있지 않은 자녀의 /p/ws 는 404(다른 가족 연결 불가)');
r = await call(envAll, 'GET', '/c/ws', null, null, { Upgrade: 'websocket' });
chk(r.status !== 101, '인증 없이는 연결되지 않는다(' + r.status + ')');
r = await call(envAll, 'GET', '/c/ws', 'c');
chk(r.status === 426, 'Upgrade 머리글이 없으면 426 — 연결되지 않는다');

// nw=1: 안 붙들고 바로 답한다
{
  const since = revNow(), t0 = Date.now();
  r = await call(envAll, 'GET', '/c/wait?since=' + since + '&nw=1&tab=home', 'c');
  chk(Date.now() - t0 < 500 && r.same === 1 && r.ws === 1 && r.rev === since, '자녀 nw=1: 바뀐 게 없으면 바로 {same:1, ws:1}(' + (Date.now() - t0) + 'ms)');
  r = await call(envAll, 'GET', '/c/wait?since=' + (since - 1) + '&nw=1&tab=home', 'c');
  chk(r.ok && r.ws === 1 && !r.same && r.rev === since, '자녀 nw=1: 값이 달라졌으면 새 묶음을 그대로 준다(+ws:1)');
  const t1 = Date.now();
  r = await call(envAll, 'GET', '/p/wait?v=hub&cid=' + CID + '&since=' + since + '&nw=1', 'p');
  chk(Date.now() - t1 < 500 && r.same === 1 && r.ws === 1, '부모 nw=1: 바뀐 게 없으면 바로 {same:1, ws:1}');
  const wt = DB._db.prepare('SELECT wt FROM devices WHERE id=?').get(PID).wt;
  chk(wt > 0, '부모 nw=1 도 "보는 중" 시각을 갱신한다(실시간 보기가 끊기지 않는다)');
  r = await call(envAll, 'GET', '/p/wait?v=hub&cid=' + CID + '&since=-1', 'p');
  chk(r.ok && r.screen && r.ws === 1, '부모: 처음(since=-1)은 화면을 바로 받고 ws 힌트가 붙는다');
}

// ── 바뀌면 허브가 연결된 앱들에게 {r:rev} 한 줄 ──
{
  const before = sockets.map((s) => s.sent.length);
  const rv = revNow();
  await call(envAll, 'POST', '/c/ev', 'c', { k: 'feed', x: '밥' });
  const after = sockets.map((s) => s.sent.length);
  chk(after[0] === before[0] + 1 && after[1] === before[1] + 1, '자녀가 무언가 하면(rev 상승) 연결된 자녀 · 부모 둘 다 한 줄씩 받는다');
  const last = JSON.parse(sockets[0].sent[sockets[0].sent.length - 1]);
  chk(last.r === revNow() && last.r > rv, '그 한 줄은 {r: 새 rev} — 내용은 담지 않는다(' + sockets[0].sent[sockets[0].sent.length - 1] + ')');
}
// 끊긴 연결은 건너뛴다
{
  sockets[0].closed = 1; const n0 = sockets[1].sent.length, m0 = sockets[0].sent.length;
  await call(envAll, 'POST', '/c/ev', 'c', { k: 'feed', x: '간식' });
  chk(sockets[1].sent.length === n0 + 1 && sockets[0].sent.length === m0, '끊긴 연결은 건너뛰고 남은 연결에만 보낸다');
}

// ── 카나리: 목록에 있는 자녀만 ──
{
  const envC = { DB, FAM, WS_MODE: 'canary', WS_CANARY: 'other0000001, ' + CID };
  r = await call(envC, 'GET', '/c/ws', 'c', null, { Upgrade: 'websocket' });
  chk(r.status === 101, '카나리: 목록(쉼표 · 공백 허용)에 있는 자녀는 켜진다');
  const envD = { DB, FAM, WS_MODE: 'canary', WS_CANARY: 'other0000001' };
  r = await call(envD, 'GET', '/c/ws', 'c', null, { Upgrade: 'websocket' });
  chk(r.status === 404, '카나리: 목록에 없는 자녀는 꺼져 있다');
}
// ── 자녀 앱 소스: 서버가 허락할 때만 · 아니면 예전 그대로 ──
{
  const eng = fs.readFileSync(new URL('../app/src/main/java/com/dullyyj/kids/Engine.java', import.meta.url).pathname, 'utf8');
  const door = fs.readFileSync(new URL('../app/src/main/java/com/dullyyj/kids/Door.java', import.meta.url).pathname, 'utf8');
  const gr = fs.readFileSync(new URL('../app/build.gradle', import.meta.url).pathname, 'utf8');
  chk(/private volatile boolean wsHint = false;/.test(eng), '앱: 기본은 허락 없음(예전 긴 대기)');
  chk(/"&qt=" \+ \("p"\.equals\(questTabNow\(\)\) \? "p" : "c"\) \+ \(bell \? "&nw=1" : ""\), null, cid, csec, bell \? 10000 : 24000\)/.test(eng), '앱: 허락이 없으면 요청 · 읽기 제한이 예전과 같고(24초) nw=1 은 초인종이 이어졌을 때만');
  chk(/wsHint = r\.indexOf\("\\"ws\\":1"\) >= 0;/.test(eng), '앱: 서버 응답의 ws:1 로만 켜지고 사라지면 꺼진다');
  chk(/finally \{\s*door\.close\(\);/.test(eng), '앱: 화면을 떠나면 연결을 닫는다');
  chk(/door\.ensure\(Kid\.BASE \+ "\/c\/ws", cid, csec, srnd\.nextInt\(3000\)\)/.test(eng), '앱: 흩뿌림은 엔진이 정해 넘긴다');
  chk(!/android\./.test(eng.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), '앱 엔진은 안드로이드 부품을 안 쓴다(경계 규칙)');
  chk(!/java\.util\.Random|SecureRandom/.test(door), 'Door 는 무작위를 쓰지 않는다');
  chk(/com\.squareup\.okhttp3:okhttp:4\.12\.0/.test(gr), '앱: okhttp 의존성');
}
Response = RealResponse;
console.log(`${ok} 통과, ${bad} 실패`); process.exit(bad ? 1 : 0);
