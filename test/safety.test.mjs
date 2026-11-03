// 안전 알림 + 장소 등록 시험(s392): 위치 끊김 · 배터리 · 공유 끔 · 장소 도착/출발 · 낯선 곳 정지 · 날씨 · 장소 등록 흐름 · 연결 해제 정리
// 실행: node --no-warnings test/safety.test.mjs   (가짜 D1 위에서 워커를 그대로, FCM · Open-Meteo · 카카오는 fetch 를 바꿔 끼워 흉내)
import fs from 'fs';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const file = new URL('../engine/kids-worker.js', import.meta.url).pathname;
let ok = 0, bad = 0;
const chk = (c, msg) => { if (c) { ok++; console.log('  ok  ', msg); } else { bad++; console.log('  FAIL', msg); } };
const src = fs.readFileSync(file, 'utf8');

// ── 날씨 판단(순수) ──
{
  const m = src.match(/\/\/ ── wx:begin[\s\S]*?\/\/ ── wx:end ──/);
  chk(!!m, '날씨 판단 구간(wx:begin~end)이 있다');
  const wxDecide = new Function(m[0] + '\nreturn wxDecide;')();
  const T = () => ({ time: Array.from({ length: 24 }, (_, i) => '2026-11-03T' + String(i).padStart(2, '0') + ':00') });
  const day = (f) => { const a = Array.from({ length: 24 }, (_, i) => f(i)); return a; };
  const mk = (o) => Object.assign({}, T(), o);
  const kinds = (w, a) => wxDecide(w, a).map((x) => x.k).join(',');
  chk(kinds(mk({ precipitation_probability: day(() => 10), precipitation: day(() => 0), snowfall: day(() => 0), apparent_temperature: day(() => 15) }), null) === '', '맑은 날은 알릴 것이 없다');
  chk(kinds(mk({ precipitation_probability: day((i) => (i === 14 ? 80 : 0)), precipitation: day(() => 0), snowfall: day(() => 0), apparent_temperature: day(() => 15) }), null) === 'rain', '낮 강수확률 80% → 비');
  chk(kinds(mk({ precipitation_probability: day((i) => (i === 3 ? 100 : 0)), precipitation: day((i) => (i === 3 ? 9 : 0)), snowfall: day(() => 0), apparent_temperature: day(() => 15) }), null) === '', '새벽(3시) 비는 낮 알림에서 뺀다');
  chk(kinds(mk({ precipitation_probability: day(() => 0), precipitation: day(() => 0), snowfall: day((i) => (i === 10 ? 1 : 0)), apparent_temperature: day(() => 0) }), null) === 'snow', '눈 → snow(비 알림과 겹치지 않는다)');
  chk(kinds(mk({ precipitation_probability: day(() => 0), precipitation: day(() => 0), snowfall: day(() => 0), apparent_temperature: day((i) => (i === 14 ? 35 : 25)) }), null) === 'heat', '체감 35°C → 폭염');
  chk(kinds(mk({ precipitation_probability: day(() => 0), precipitation: day(() => 0), snowfall: day(() => 0), apparent_temperature: day((i) => (i === 8 ? -12 : -2)) }), null) === 'cold', '체감 -12°C → 한파');
  chk(kinds(null, mk({ pm2_5: day(() => 40), pm10: day(() => 30) })) === 'dust', 'PM2.5 40 → 미세먼지 나쁨');
  chk(wxDecide(null, mk({ pm2_5: day(() => 80), pm10: day(() => 30) }))[0].s.includes('매우'), 'PM2.5 80 → 매우 나쁨');
  chk(kinds(null, mk({ pm2_5: day(() => 10), pm10: day(() => 20) })) === '', '공기 좋으면 알리지 않는다');
}

// ── 가짜 D1 · FCM · 외부 API ──
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
const pushes = [];                                              // 받은 알림 [{token, data}]
let wxMode = 'clear', wxCalls = 0, geoDocs = {}, geoFail = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  u = String(u);
  if (u.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3000 }), { status: 200 });
  if (u.startsWith('https://fcm.googleapis.com/')) { const b = JSON.parse(init.body); pushes.push({ token: b.message.token, data: b.message.data }); return new Response('{}', { status: 200 }); }
  if (u.includes('open-meteo.com/v1/forecast')) {
    wxCalls++;
    if (wxMode === 'fail') return new Response('x', { status: 500 });
    const t = Array.from({ length: 24 }, (_, i) => '2026-11-03T' + String(i).padStart(2, '0') + ':00');
    const rain = wxMode === 'rain';
    return new Response(JSON.stringify({ hourly: { time: t, precipitation_probability: t.map(() => (rain ? 90 : 0)), precipitation: t.map(() => (rain ? 2 : 0)), snowfall: t.map(() => 0), apparent_temperature: t.map(() => 15) } }), { status: 200 });
  }
  if (u.includes('air-quality-api')) return new Response(JSON.stringify({ hourly: { time: Array.from({ length: 24 }, (_, i) => '2026-11-03T' + String(i).padStart(2, '0') + ':00'), pm10: new Array(24).fill(20), pm2_5: new Array(24).fill(10) } }), { status: 200 });
  if (u.includes('kakao-local')) {
    if (geoFail) return new Response('x', { status: 500 });
    const path = decodeURIComponent((u.match(/path=([^&]*)/) || [])[1] || '');
    const q = decodeURIComponent(decodeURIComponent((u.match(/qs=([^&]*)/) || [])[1] || '').replace(/^query=/, '').split('&')[0]);
    return new Response(JSON.stringify({ documents: (geoDocs[path] && geoDocs[path][q]) || [] }), { status: 200 });
  }
  return realFetch(u, init);
};

const mod = (await import(file)).default;
const MIN = 60000, HOUR = 3600000, DAY = 86400000, M = 1 / 111320;
let NOW = Date.UTC(2026, 10, 3, 0, 0, 0);                        // 2026-11-03 09:00 KST
Date.now = () => NOW;
let pend = [];
const ctx = { waitUntil: (p) => { pend.push(p); } };
const flush = async () => { await Promise.all(pend); pend = []; };
const CID = 'child000001', PID = 'parent00001', CS = 'c'.repeat(20), PS = 'p'.repeat(20);
const PTK = 'parent-token-1234567890abcd';
const req = async (method, path, who, body) => {
  const h = { 'content-type': 'application/json' };
  if (who === 'c') { h['x-id'] = CID; h['x-sec'] = CS; } else if (who === 'p') { h['x-id'] = PID; h['x-sec'] = PS; }
  const r = await mod.fetch(new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const j = await r.json(); await flush(); return j;
};
const cron = async () => { await mod.scheduled({}, env, ctx); await flush(); };
const rows = (sql, ...a) => DB._db.prepare(sql).all(...a);
const kinds = (from = 0) => pushes.slice(from).map((p) => p.data.k);
const n0 = () => pushes.length;

await req('POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req('POST', '/reg', null, { id: PID, sec: PS, role: 'p' });
const pr = await req('POST', '/c/pair', 'c', {});
const jr = await req('POST', '/p/join', 'p', { code: pr.code, nm: '쭈르' });
chk(jr.ok && jr.cid === CID, '연결(자녀 ↔ 부모)');
chk((await req('POST', '/p/ft', 'p', { tk: PTK })).ok, '부모 알림 토큰 등록');
let la = 37.5000, lo = 126.8400;                                 // 집 근처 시작점
const loc = (extra) => req('POST', '/c/loc', 'c', Object.assign({ la, lo, acc: 10 }, extra || {}));

// ── 장소 등록 흐름 ──
geoDocs['search/address.json'] = { '가양로 12': [{ address_name: '서울 강서구 가양동 12', x: '126.8600', y: '37.5300', road_address: { building_name: '가양빌딩' } }] };
geoDocs['search/keyword.json'] = { '학교': [{ place_name: '가양초등학교', address_name: '서울 강서구 가양동', road_address_name: '서울 강서구 가양로 1', x: '126.8500', y: '37.5200' }, { place_name: '가양중학교', address_name: '서울 강서구 가양동', road_address_name: '서울 강서구 가양로 9', x: '126.8510', y: '37.5210' }] };
await loc();                                                     // 자녀 위치 알림(처음)
{
  const hub = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
  const s = JSON.stringify(hub.screen);
  chk(hub.ok && /kpg\.open/.test(s) && /장소 등록/.test(s), '확인 화면에 "장소 등록" 단추가 있다');
  const o = await req('POST', '/p/act', 'p', { v: 'kpg.open', cid: CID });
  const so = JSON.stringify(o.screen);
  chk(o.ok && o.sheet === 'ev' && o.screen.screen === 'kidreg' && /kpg\.find/.test(so) && /kpg\.add/.test(so) && /"t":"tmap"/.test(so), '장소 등록 팝업: 주소칸 · 찾기 · 지도 · 이름칸 · 등록');
  chk(o.screen.body.find((n) => n.t === 'tmap').pts[0].la === la, '처음엔 자녀가 있는 곳에 지도가 열린다');
  const e1 = await req('POST', '/p/act', 'p', { v: 'kpg.find', cid: CID, f: { kpa: '' } });
  chk(/찾을 주소나 장소를 적어/.test(JSON.stringify(e1.screen)), '주소를 안 적고 찾기 → 안내');
  const f1 = await req('POST', '/p/act', 'p', { v: 'kpg.find', cid: CID, f: { kpa: '가양로 12' } });
  const tm = f1.screen.body.find((n) => n.t === 'tmap');
  chk(f1.ok && Math.abs(tm.pts[0].la - 37.53) < 1e-6 && Math.abs(tm.pts[0].lo - 126.86) < 1e-6, '주소를 찾으면 지도가 그 자리로 옮겨간다');
  chk(/가양빌딩/.test(JSON.stringify(f1.screen)), '찾은 건물 이름이 이름칸에 미리 들어간다(한 곳일 때)');
  const f2 = await req('POST', '/p/act', 'p', { v: 'kpg.find', cid: CID, f: { kpa: '학교' } });
  chk((JSON.stringify(f2.screen).match(/kpg\.pick/g) || []).length === 2, '장소 이름으로 찾으면(주소가 없을 때) 여러 곳을 고르게 한다');
  const pk = await req('POST', '/p/act', 'p', { v: 'kpg.pick', cid: CID, t: '1' });
  const tm2 = pk.screen.body.find((n) => n.t === 'tmap');
  chk(Math.abs(tm2.pts[0].la - 37.521) < 1e-6 && /가양중학교/.test(JSON.stringify(pk.screen)), '고르면 지도가 그곳으로 옮겨가고 이름이 채워진다');
  const nn = await req('POST', '/p/act', 'p', { v: 'kpg.add', cid: CID, f: { kpn: '' } });
  chk(/장소 이름을 적어/.test(JSON.stringify(nn.screen)) && rows('SELECT * FROM places').length === 0, '이름 없이 등록 → 막고 안내(등록 안 됨)');
  const nf = await req('POST', '/p/act', 'p', { v: 'kpg.find', cid: CID, f: { kpa: '없는곳xyz' } });
  chk(/찾지 못했어요/.test(JSON.stringify(nf.screen)), '못 찾으면 안내');
  geoFail = true; const gf = await req('POST', '/p/act', 'p', { v: 'kpg.find', cid: CID, f: { kpa: '가양로 12' } }); geoFail = false;
  chk(gf.ok && /찾지 못했어요/.test(JSON.stringify(gf.screen)), '주소 서버가 실패해도 오류 없이 안내');
  await req('POST', '/p/act', 'p', { v: 'kpg.find', cid: CID, f: { kpa: '가양로 12' } });
  const ad = await req('POST', '/p/act', 'p', { v: 'kpg.add', cid: CID, f: { kpn: '학원' } });
  const pl = rows('SELECT * FROM places');
  chk(ad.ok && ad.close === true && ad.hub === 1 && pl.length === 1 && pl[0].name === '학원' && Math.abs(pl[0].la - 37.53) < 1e-6 && pl[0].days === 0, '이름을 적고 등록 → 장소 저장(요일 없음 = 시각 규칙 없음)');
  chk(rows('SELECT * FROM drafts').length === 0, '등록하면 임시 작성본은 지워진다');
  const c1 = await req('POST', '/p/act', 'p', { v: 'kpg.open', cid: CID }); await req('POST', '/p/act', 'p', { v: 'kpg.cancel', cid: CID });
  chk(rows('SELECT * FROM drafts').length === 0 && rows('SELECT * FROM places').length === 1, '취소하면 아무것도 저장하지 않는다');
}

// ── 장소 도착 · 출발 알림 ──
{
  const home = { la: 37.5300, lo: 126.8600 };                    // '학원'
  la = 37.5000; lo = 126.8400; await loc();
  let a = n0();
  la = home.la + 30 * M; lo = home.lo; NOW += 10 * MIN; await loc();
  chk(kinds(a).join() === 'zone' && /학원 근처에 왔어요/.test(pushes[a].data.body) && /쭈르/.test(pushes[a].data.body), '장소 150m 안에 들어오면 부모에게 "왔어요" 푸시');
  a = n0(); NOW += 1 * MIN; la = home.la + 60 * M; await loc();
  chk(kinds(a).length === 0, '장소 안에서 움직여도 다시 알리지 않는다');
  a = n0(); NOW += 10 * MIN; la = home.la + 1000 * M; await loc();
  chk(kinds(a).join() === 'zone' && /멀어졌어요/.test(pushes[a].data.body), '벗어나면 "멀어졌어요" 푸시');
  a = n0(); NOW += 1 * MIN; la = home.la + 20 * M; await loc(); NOW += 1 * MIN; la = home.la + 1000 * M; await loc(); NOW += 1 * MIN; la = home.la + 20 * M; await loc(); NOW += 1 * MIN; la = home.la + 1000 * M; await loc();
  chk(kinds(a).join() === 'zone', '5분 안에 오가며 흔들려도(GPS) 같은 종류 알림은 5분에 한 번만 — 들어옴 1건만 나가고 나머지는 생략');
  NOW += 10 * MIN; la = home.la + 20 * M; a = n0(); await loc();
  chk(kinds(a).join() === 'zone', '5분이 지난 뒤 다시 도착하면 다시 알린다');
  // 도착 확인(약속)을 눌러 둔 곳은 '왔어요' 푸시를 생략(그쪽 알림이 있다)
  NOW += 10 * MIN; la = home.la + 1000 * M; await loc();
  const pid0 = rows('SELECT id FROM places')[0].id;
  const kp = new Date(NOW + 9 * HOUR); const ds = kp.getUTCFullYear() * 10000 + (kp.getUTCMonth() + 1) * 100 + kp.getUTCDate();
  DB._db.prepare("INSERT OR IGNORE INTO trips(id,cid,pl,day,st,ta,tc,pn) VALUES(?,?,?,?,'go',0,0,0)").run('tg1', CID, pid0, ds);
  const tcols = rows('PRAGMA table_info(trips)').map((c) => c.name);
  NOW += 10 * MIN; la = home.la + 20 * M; a = n0(); await loc();
  chk(rows("SELECT 1 FROM trips WHERE st='go'").length === 0 || !kinds(a).includes('zone'), '출발 확인한 이동은 "왔어요" 푸시를 중복하지 않는다(trips: ' + tcols.length + '열)');
  DB._db.prepare('DELETE FROM trips').run();
}

// ── 배터리 · 공유 끔 ──
{
  const home = { la: 37.5000, lo: 126.8400 };
  la = home.la; lo = home.lo; NOW += 30 * MIN; await loc({ bt: 80, ch: 0 });
  let a = n0();
  NOW += 5 * MIN; await loc({ bt: 14, ch: 0 });
  chk(kinds(a).join() === 'batt' && /14%/.test(pushes[a].data.body), '배터리 14% → 부모에게 푸시');
  a = n0(); NOW += 5 * MIN; await loc({ bt: 12, ch: 0 });
  chk(kinds(a).length === 0, '3시간 안에는 다시 알리지 않는다');
  const hub = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
  chk(/배터리 12%/.test(JSON.stringify(hub.screen)), '확인 화면에도 "배터리 12%" 경고 줄');
  a = n0(); NOW += 3 * HOUR + 5 * MIN; await loc({ bt: 50, ch: 0 }); NOW += 5 * MIN; await loc({ bt: 9, ch: 0 });
  chk(kinds(a).join() === 'batt', '3시간 뒤 다시 낮아지면 다시 알린다');
  a = n0(); NOW += 4 * HOUR; await loc({ bt: 50, ch: 0 }); NOW += 5 * MIN; await loc({ bt: 10, ch: 1 });
  chk(kinds(a).length === 0, '충전 중이면 알리지 않는다');
  a = n0(); await loc({ bt: -1 });
  chk(kinds(a).length === 0, '배터리를 모르면(옛 앱) 알리지 않는다');

  a = n0(); await req('POST', '/c/share', 'c', { on: 0 });
  chk(kinds(a).join() === 'share' && /껐어요/.test(pushes[a].data.body), '공유를 끄면 부모에게 푸시');
  a = n0(); await req('POST', '/c/share', 'c', { on: 0 });
  chk(kinds(a).length === 0, '이미 꺼진 것을 또 알려도 푸시하지 않는다');
  const hub2 = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
  chk(/위치 공유를 껐어요/.test(JSON.stringify(hub2.screen)), '확인 화면에 "위치 공유를 껐어요" 경고 줄');
  // 끈 동안은 '위치 끊김' 알림이 없다
  a = n0(); NOW += 2 * HOUR; await cron();
  chk(!kinds(a).includes('stale'), '공유를 끈 동안은 "위치 끊김"을 보내지 않는다');
  a = n0(); await req('POST', '/c/share', 'c', { on: 1 });
  chk(kinds(a).join() === 'share' && /다시 켰어요/.test(pushes[a].data.body), '다시 켜면 푸시');
}

// ── 위치 끊김 ──
{
  wxMode = 'clear';
  // 날씨는 이미 오늘 확인한 것으로 치게(앞 시험의 cron) — 여기선 끊김만 본다
  la = 37.5000; lo = 126.8400; NOW += 1 * MIN; await loc({ bt: 80, ch: 0 });
  let a = n0(); NOW += 10 * MIN; await cron();
  chk(!kinds(a).includes('stale'), '10분 안 오는 것은 알리지 않는다');
  a = n0(); NOW += 15 * MIN; await cron();
  chk(kinds(a).filter((k) => k === 'stale').length === 1 && /들어오지 않아요/.test(pushes.slice(a).find((p) => p.data.k === 'stale').data.body), '25분 안 오면 "위치가 들어오지 않아요" 푸시 한 번');
  a = n0(); NOW += 1 * MIN; await cron(); NOW += 5 * MIN; await cron();
  chk(!kinds(a).includes('stale'), '같은 끊김은 되풀이하지 않는다');
  const hub = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
  chk(/들어오지 않아요/.test(JSON.stringify(hub.screen)), '확인 화면에도 경고 줄');
  NOW += 1 * MIN; await loc({ bt: 80, ch: 0 }); await cron();                 // 위치가 들어온 상태로 점검이 한 번 돌아야 '끊김'이 풀린다(실제로는 매분 돈다)
  chk(rows('SELECT stl FROM cst')[0].stl === 0, '위치가 다시 들어오면 끊김 상태가 풀린다');
  a = n0(); NOW += 30 * MIN; await cron();
  chk(kinds(a).filter((k) => k === 'stale').length === 1, '풀린 뒤 또 끊기면 다시 알린다(되살림)');
  // 밤에는 보내지 않는다 (23:30 KST = 14:30 UTC)
  NOW = Date.UTC(2026, 10, 3, 14, 0, 0); await loc({ bt: 80, ch: 0 });
  a = n0(); NOW += 40 * MIN; await cron();
  chk(!kinds(a).includes('stale'), '밤(23~06시)에는 끊김을 알리지 않는다');
}

// ── 날씨 ──
{
  // 새 날(11-04) 아침. 자녀 위치는 어제 것이라 24시간 안이어야 한다
  NOW = Date.UTC(2026, 10, 3, 23, 40, 0);                         // 11-04 08:40 KST
  la = 37.5000; lo = 126.8400; await loc({ bt: 80, ch: 0 });
  wxMode = 'fail'; let a = n0(), c = wxCalls;
  NOW += 1 * MIN; await cron();
  chk(wxCalls > c && !kinds(a).includes('wx'), '날씨를 못 받으면 알림 없이 넘어간다');
  wxMode = 'rain'; a = n0(); NOW += 1 * MIN; await loc({ bt: 80, ch: 0 }); await cron();
  const w1 = pushes.slice(a).filter((p) => p.data.k === 'wx');
  chk(w1.length === 1 && /비가 와요/.test(w1[0].data.body), '다음 분에 다시 받아 비 소식을 부모에게 푸시(실패해도 하루 안에 다시 시도)');
  a = n0(); c = wxCalls; NOW += 1 * MIN; await loc({ bt: 80, ch: 0 }); await cron();
  chk(wxCalls === c && !kinds(a).includes('wx'), '하루 한 번만 — 오늘은 다시 받지도 알리지도 않는다');
  // 이른 새벽(07:30 전)과 11시 이후에는 시도하지 않는다
  NOW = Date.UTC(2026, 10, 4, 1, 30, 0); c = wxCalls; await loc({ bt: 80, ch: 0 }); await cron();   // 10:30 KST, 11-04 이미 함 → 변화 없음
  NOW = Date.UTC(2026, 10, 4, 22, 0, 0); c = wxCalls; await loc({ bt: 80, ch: 0 }); await cron();      // 11-05 07:00 KST
  chk(wxCalls === c, '07:30 이전에는 날씨를 받지 않는다');
  wxMode = 'clear'; a = n0(); NOW += 31 * MIN; await loc({ bt: 80, ch: 0 }); await cron();
  chk(wxCalls > c && !kinds(a).includes('wx'), '다음 날 07:30 이후 받고, 맑으면 알리지 않는다');
}

// ── 낯선 곳에서 오래 머묾 ──
{
  const t0 = NOW;
  const ins = (cid, la_, lo_, t, d) => DB._db.prepare('INSERT INTO stops(cid,la,lo,t,d) VALUES(?,?,?,?,?)').run(cid, la_, lo_, t, d);
  DB._db.prepare('DELETE FROM stops').run();
  const far = { la: 37.4500, lo: 126.9500 };
  const dwell = async (p, min) => { la = p.la; lo = p.lo; for (let t = 0; t < min; t += 5) { NOW += 5 * MIN; await loc({ bt: 80, ch: 0 }); } NOW += 5 * MIN; la = p.la + 400 * M; await loc({ bt: 80, ch: 0 }); };
  // 배우는 기간(처음 3일) — 알리지 않는다
  let a = n0(); NOW += 10 * MIN; la = 37.4000; lo = 126.9000; await loc({ bt: 80, ch: 0 });
  await dwell(far, 35);
  chk(!kinds(a).includes('odd') && rows('SELECT * FROM stops').length >= 1, '처음 3일(배우는 기간)은 낯선 곳이어도 알리지 않고 기록만 한다');
  // 배운 뒤: 첫 기록을 5일 전으로 미룬다
  DB._db.prepare('UPDATE stops SET t=t-?, d=d-5').run(5 * DAY);
  ins(CID, 37.3000, 126.8000, NOW - 4 * DAY, 20261030);
  const farB = { la: 37.4800, lo: 126.7000 };
  a = n0(); await dwell(farB, 35);
  const odd = pushes.slice(a).filter((p) => p.data.k === 'odd');
  chk(odd.length === 1 && /평소와 다른 곳/.test(odd[0].data.body), '배운 뒤 처음 가 본 곳에서 30분 넘게 머물면 부모에게 푸시');
  chk(rows("SELECT 1 FROM evs WHERE k='odd'").length === 1, '"뭐하니" 활동에도 한 줄이 남는다');
  // 같은 곳을 다른 날 두 번 더 가면 익숙한 곳
  ins(CID, farB.la, farB.lo, NOW - 3 * DAY, 20261031); ins(CID, farB.la, farB.lo, NOW - 2 * DAY, 20261101);
  a = n0(); await dwell(farB, 35);
  chk(!kinds(a).includes('odd'), '다른 날 두 번 넘게 머문 적이 있는 곳은 낯설지 않다');
  // 등록 장소 근처는 알리지 않는다
  a = n0(); await dwell({ la: 37.5300 + 40 * M, lo: 126.8600 }, 35);
  chk(!kinds(a).includes('odd'), '등록한 장소(학원)에서 머무는 것은 알리지 않는다');
  chk(rows('SELECT COUNT(*) n FROM stops')[0].n <= 200, '머문 곳 기록은 200개를 넘지 않는다');
}

// ── 화면 해석기용 덤프 ──
if (process.env.DUMP_DIR) {
  fs.mkdirSync(process.env.DUMP_DIR, { recursive: true });
  const hub = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
  fs.writeFileSync(process.env.DUMP_DIR + '/hub2.json', JSON.stringify(hub.screen));
  const o = await req('POST', '/p/act', 'p', { v: 'kpg.open', cid: CID });
  fs.writeFileSync(process.env.DUMP_DIR + '/kidreg.json', JSON.stringify(o.screen));
  const f = await req('POST', '/p/act', 'p', { v: 'kpg.find', cid: CID, f: { kpa: '학교' } });
  fs.writeFileSync(process.env.DUMP_DIR + '/kidreg2.json', JSON.stringify(f.screen));
  await req('POST', '/p/act', 'p', { v: 'kpg.cancel', cid: CID });
}

// ── 해제 ──
await req('POST', '/c/unlink', 'c', {});
chk(rows('SELECT COUNT(*) n FROM cst')[0].n === 0 && rows('SELECT COUNT(*) n FROM stops')[0].n === 0 && rows('SELECT COUNT(*) n FROM places')[0].n === 0, '연결을 끊으면 안전 상태 · 머문 곳 · 장소가 지워진다');

console.log(`${ok} 통과, ${bad} 실패`); process.exit(bad ? 1 : 0);
