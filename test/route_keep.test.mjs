// 지난 경로 보관 시험(s391): 30분 정지 → 길 저장 · 자녀당 10개(11번째부터 오래된 것 삭제) · 150m 미만 제외 · 보고 끊김은 정지가 아님 · 지난 경로 보기 화면 · 연결 해제 시 삭제
// 실행: node --no-warnings test/route_keep.test.mjs   (Node 22+ 의 node:sqlite 로 가짜 D1 을 만들어 워커를 그대로 돌린다)
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

const file = new URL('../engine/kids-worker.js', import.meta.url).pathname;
let ok = 0, bad = 0;
const chk = (c, msg) => { if (c) { ok++; console.log('  ok  ', msg); } else { bad++; console.log('  FAIL', msg); } };

// ── 순수 계산(rtNext · rtThin · rtBuild)을 워커 소스에서 떼어 단독으로 ──
const src = fs.readFileSync(file, 'utf8');
const m = src.match(/\/\/ ── routes:begin[\s\S]*?\/\/ ── routes:end ──/);
chk(!!m, '순수 계산 구간(routes:begin~end)이 있다');
const consts = src.match(/const RT_KEEP[^\n]*\n/)[0];
const P = new Function(consts + m[0] + '\nreturn { rtNext, rtThin, rtBuild, rtLen, RT_MIN_M, RT_DWELL_M, RT_DWELL_MS, RT_GAP_MS, RT_PTS };')();
const hv = (a, b, c, d) => { const R = 6371000, p1 = a * Math.PI / 180, p2 = c * Math.PI / 180, dp = p2 - p1, dl = (d - b) * Math.PI / 180; const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const M = 1 / 111320;                               // 위도 1m
const MIN = 60000;

// rtNext 단독
{
  let st = null, t = 1e12, close = null;
  const step = (la, lo, dt, lastT) => { const r = P.rtNext(st, la, lo, t + dt, lastT, '집', hv); st = r.st; if (r.close) close = r.close; return r; };
  step(37.5, 127, 0, 0);
  step(37.5, 127, 5 * MIN, t);
  chk(!close, '5분 머문 것으로는 길을 닫지 않는다');
  step(37.5, 127, 29 * MIN, t + 24 * MIN);
  chk(!close, '29분에도 닫지 않는다');
  step(37.5, 127, 30 * MIN, t + 29 * MIN);
  chk(!!close && close.t1 === t, '30분이 되면 닫는다(정지가 시작된 시각 t1)');
  const c1 = close; close = null;
  step(37.5, 127, 40 * MIN, t + 30 * MIN);
  chk(!close, '이미 닫은 정지에서 계속 있어도 다시 닫지 않는다');
  step(37.5 + 150 * M, 127, 45 * MIN, t + 40 * MIN);
  chk(st.cl === 0 && st.rte === t + 40 * MIN && st.rsa === 37.5, '100m 넘게 벗어나면 출발 — 새 길은 바로 앞 보고 이후부터, 출발 자리를 기억');
  chk(st.sn === '집', '출발지 이름은 닫을 때의 이름');
}
{ // 보고가 20분 넘게 끊기면 센 시간이 이어지지 않는다
  let st = P.rtNext(null, 37.5, 127, 1e12, 0, '', hv).st;
  let r = P.rtNext(st, 37.5, 127, 1e12 + 10 * MIN, 1e12, '', hv); st = r.st;
  r = P.rtNext(st, 37.5, 127, 1e12 + 45 * MIN, 1e12 + 10 * MIN, '', hv);          // 35분 만에 다시 보고 — 사이가 끊겼다
  chk(!r.close && r.st.dt === 1e12 + 45 * MIN, '35분 동안 끊겼다 돌아온 보고는 정지로 치지 않고 여기서 새로 센다');
}
{ // 점 간추리기
  const line = []; for (let i = 0; i < 2000; i++) line.push([37.5 + i * 5 * M, 127 + Math.sin(i / 40) * 30 * M * 1.3]);
  const th = P.rtThin(line, 300);
  chk(th.length <= 300 && th.length >= 20, '2000점 → ' + th.length + '점으로 간추린다(≤300)');
  chk(th[0] === line[0] && th[th.length - 1] === line[line.length - 1], '처음과 끝은 남는다');
  const straight = [[37.5, 127], [37.5001, 127], [37.5002, 127], [37.5003, 127]];
  chk(P.rtThin(straight, 400).length === 4, '적은 점은 그대로(max 이하)');
  const b = P.rtBuild([{ la: 37.5, lo: 127 }, { la: 37.5 + 40 * M, lo: 127 }], { from: null, to: [37.5 + 80 * M, 127] }, hv);
  chk(b === null, '이동 80m 는 저장하지 않는다(150m 미만)');
  const b100 = P.rtBuild([{ la: 37.5, lo: 127 }, { la: 37.5 + 90 * M, lo: 127 }], { from: null, to: [37.5 + 170 * M, 127] }, hv);
  chk(b100 && b100.m >= 160 && b100.m <= 180, '이동 170m 는 저장한다(150m 이상)');
  chk(P.rtBuild([{ la: 37.5, lo: 127 }, { la: 37.5 + 60 * M, lo: 127 }], { from: null, to: [37.5 + 130 * M, 127] }, hv) === null, '이동 130m 는 저장하지 않는다(150m 미만)');
  const b2 = P.rtBuild([{ la: 37.5, lo: 127 }, { la: 37.5 + 200 * M, lo: 127 }], { from: [37.5 - 50 * M, 127], to: [37.5 + 400 * M, 127] }, hv);
  chk(b2 && b2.m >= 440 && b2.m <= 460 && b2.pts.length >= 2, '출발 자리 + 기록 + 멈춘 자리를 이어 ~450m 로 센다');
}

// ── 가짜 D1(node:sqlite) 위에서 워커 그대로 ──
function mkD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, params) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
    first: async () => db.prepare(sql).get(...params) || null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    _x: () => db.prepare(sql).run(...params),
  });
  return { prepare: (sql) => stmt(sql, []), batch: async (arr) => { db.exec('BEGIN'); try { for (const s of arr) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; }, _db: db };
}
const DB = mkD1();
const env = { DB };
const mod = (await import(file)).default;
let NOW = Date.UTC(2026, 10, 3, 0, 0, 0);          // 2026-11-03 09:00 KST
Date.now = () => NOW;
const ctx = { waitUntil: () => {} };
const CID = 'child000001', PID = 'parent00001', CS = 'c'.repeat(20), PS = 'p'.repeat(20);
const req = async (method, path, who, body) => {
  const h = { 'content-type': 'application/json' };
  if (who === 'c') { h['x-id'] = CID; h['x-sec'] = CS; } else if (who === 'p') { h['x-id'] = PID; h['x-sec'] = PS; }
  const r = await mod.fetch(new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  return r.json();
};
await req('POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req('POST', '/reg', null, { id: PID, sec: PS, role: 'p' });
const pr = await req('POST', '/c/pair', 'c', {});
const jr = await req('POST', '/p/join', 'p', { code: pr.code, nm: '엄마' });
await req('POST', '/p/act', 'p', { v: 'kg.ok', cid: CID });
chk(jr.ok && jr.cid === CID, '연결(자녀 ↔ 부모)');

const rows = (sql, ...a) => DB._db.prepare(sql).all(...a);
let la = 37.5000, lo = 126.8400;                     // 집
const rep = async (dt) => { NOW += dt; return req('POST', '/c/loc', 'c', { la, lo, acc: 10 }); };
const stay = async (min, every = 5) => { for (let t = 0; t < min; t += every) await rep(every * MIN); };
const walk = async (meters, stepM = 250, every = 3) => { const n = Math.ceil(meters / stepM); for (let i = 0; i < n; i++) { la += (stepM * M); lo += (stepM * M * 0.3); await rep(every * MIN); } };
// 가만히 있기 → 이동 → 정지 한 번을 '길 하나'로
const trip = async (meters, dwellMin = 35) => { await walk(meters); await stay(dwellMin); };

await rep(0);
await stay(40);
chk(rows('SELECT * FROM routes').length === 0, '처음 40분 머문 것(이동 없음)은 길이 없어서 저장하지 않는다');
await trip(2000);
let rt = rows('SELECT * FROM routes ORDER BY id');
chk(rt.length === 1, '2km 걸어 35분 머물면 길 1개가 저장된다');
chk(rt[0] && rt[0].m >= 1800 && rt[0].m <= 2300, '저장된 길이 ' + (rt[0] && rt[0].m) + 'm (≈2km)');
const pts0 = rt[0] ? JSON.parse(rt[0].pts) : [];
chk(pts0.length >= 2 && pts0.length <= P.RT_PTS, '점 ' + pts0.length + '개(≤' + P.RT_PTS + ')');
chk(rt[0] && rt[0].t1 > rt[0].t0, '시작·끝 시각 순서');

await trip(150, 35);                                  // 150m 만 가서 머묾 → 150m 이상이라 저장한다
chk(rows('SELECT * FROM routes').length === 2, '250m 이동 뒤 정지는 저장한다(150m 이상)');
{ const before = rows('SELECT * FROM routes').length; await walk(60, 60); await stay(35); chk(rows('SELECT * FROM routes').length === before, '반경(100m) 안에서 60m 만 움직이면 출발로 치지 않아 새 길이 생기지 않는다'); }

// 보고가 25분 끊겼다 돌아온 경우: 가짜 정지를 만들지 않는다
await walk(1000);
NOW += 60 * MIN;                                       // 폰이 꺼져 있던 1시간
await stay(20);                                        // 돌아와서 20분만 보고(센 시간이 새로 시작)
chk(rows('SELECT * FROM routes').length === 2, '끊겼다 돌아온 뒤 20분만으로는 정지로 치지 않는다');
await stay(20);                                        // 합쳐 40분 — 이제 새로 센 30분이 넘는다
chk(rows('SELECT * FROM routes').length === 3, '돌아온 뒤 30분을 다시 채우면 저장된다');

// 11번째부터는 오래된 것 삭제
for (let i = 0; i < 11; i++) await trip(700 + i * 10);
rt = rows('SELECT id,t0,t1 FROM routes ORDER BY id');
chk(rt.length === 10, '길이 13개 쌓여도 10개만 남는다(' + rt.length + ')');
chk(rt.every((r, i) => i === 0 || r.id > rt[i - 1].id), '남은 것은 가장 최근 10개(번호가 이어진다)');
const maxId = rows('SELECT MAX(id) m FROM routes')[0].m;
chk(rt[0].id === maxId - 9, '가장 오래된 것부터 지워졌다');
chk(rows('SELECT COUNT(*) n FROM routes WHERE cid=?', 'other0000001')[0].n === 0, '자녀별로 센다(다른 자녀 몫은 건드리지 않는다)');

// ── 화면 ──
const hub = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
const str = JSON.stringify(hub.screen);
chk(hub.ok && /지난 경로/.test(str) && /kr\.open/.test(str), '확인 화면에 "지난 경로" 단추가 있다');
chk(/"s":"지난 경로 10"/.test(str), '단추에 개수(10)가 보인다');
const sheet = await req('POST', '/p/act', 'p', { v: 'kr.open', cid: CID });
const sj = JSON.stringify(sheet.screen);
chk(sheet.ok && sheet.sheet === 'ev' && (sj.match(/"v":"kr\.\d+"/g) || []).length === 10, '목록 팝업에 길 10개(누르는 행동 kr.<번호>)');
const first = rt[rt.length - 1];                      // 가장 최근
const pick = await req('POST', '/p/act', 'p', { v: 'kr.' + first.id, cid: CID });
const tm = pick.screen.head.find((n) => n.t === 'tmap');
chk(pick.ok && pick.close === true && tm && tm.line.length >= 2 && tm.pts.length === 2, '고르면 팝업이 닫히고 지도에 그 길(선 + 출발·도착 핀 2개)이 그려진다');
chk(tm && tm.line.length <= 400, '선은 400점 이하(앱이 받는 한도)');
chk(/실시간으로 돌아가기/.test(JSON.stringify(pick.screen.body)), '"실시간으로 돌아가기" 단추가 있다');
const again = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
chk(again.screen.head.find((n) => n.t === 'tmap').pts.length === 2, '화면을 다시 받아도(긴 대기) 고른 길이 그대로 보인다');
const live = await req('POST', '/p/act', 'p', { v: 'kr.live', cid: CID });
chk(live.screen.head.find((n) => n.t === 'tmap').pts.length >= 1 && /지난 경로/.test(JSON.stringify(live.screen.body)) && !/실시간으로 돌아가기/.test(JSON.stringify(live.screen.body)), '실시간으로 돌아가면 원래 화면');
await req('POST', '/p/act', 'p', { v: 'kr.' + first.id, cid: CID });
NOW += 11 * MIN;
const late = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
chk(!/실시간으로 돌아가기/.test(JSON.stringify(late.screen.body)), '10분이 지나면 저절로 실시간으로 돌아간다');
const gone = await req('POST', '/p/act', 'p', { v: 'kr.999999', cid: CID });
chk(gone.ok && /이미 지워진/.test(JSON.stringify(gone.screen)), '없는 길을 누르면 안내 글');

if (process.env.DUMP_DIR) { fs.mkdirSync(process.env.DUMP_DIR, { recursive: true }); for (const [k, v] of Object.entries({ hub: hub.screen, sheet: sheet.screen, pick: pick.screen, live: live.screen })) fs.writeFileSync(process.env.DUMP_DIR + '/' + k + '.json', JSON.stringify(v)); }      // 부모 앱 화면 해석기(ScreenCore)로 따로 검증할 때

// ── 7일이 지난 길은 지운다(개인정보) ──
{
  const before = rows('SELECT COUNT(*) n FROM routes')[0].n;
  DB._db.prepare('UPDATE routes SET t1=t1-? WHERE id=(SELECT MIN(id) FROM routes)').run(8 * 24 * 60 * MIN);
  await mod.scheduled({}, env, ctx);                                      // 크론이 만료된 길을 지운다
  await new Promise((r) => setTimeout(r, 50));
  const after = rows('SELECT COUNT(*) n FROM routes')[0].n;
  chk(after === before - 1, '8일 된 길은 크론이 지운다(' + before + ' → ' + after + ')');
}

// ── 해제 ──
await req('POST', '/c/unlink', 'c', {});
chk(rows('SELECT COUNT(*) n FROM routes')[0].n === 0 && rows('SELECT COUNT(*) n FROM rtst')[0].n === 0, '연결을 끊으면 저장된 길과 정지 상태도 지워진다');

console.log(`${ok} 통과, ${bad} 실패`); process.exit(bad ? 1 : 0);
