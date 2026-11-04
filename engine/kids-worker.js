// 길동무 키즈 엔진 — Cloudflare Worker + D1 (바인딩 이름: DB)
// 길동무 엔진(route-v2)과 따로 돌아간다. 자녀 앱·부모(길동무) 앱은 화면을 받아 그리기만 하고, 계산·저장·판단·문구는 모두 여기서 한다.
// 인증: 요청 머리글 x-id / x-sec (기기가 처음 정한 아이디와 비밀. 서버에는 SHA-256 만 저장).
// 자녀 앱 = 역할 c, 부모(길동무 앱) = 역할 p.
// 미션: k='c' 는 부모가 자녀에게 주는 미션(자녀 미션), k='p' 는 자녀가 부모에게 주는 미션(부모님 미션).
//   자녀 미션 s: 0 대기 -> 1 자녀가 해냈다고 알림(부모 확인 대기) -> 2 부모가 확인(길동무포인트 지급)
//   부모님 미션 s: 0 대기 -> 1 부모가 해냈다고 표시 (길동무포인트 없음)
// 장소(places): 부모가 정한 '그 요일 · 그 시각까지 가 있어야 하는 곳'. 시각 30분 전에 자녀에게 알림(trip 'due') ->
//   자녀 [확인](그냥 끔 'seen') / [출발]('go') -> 남은 거리 알약 -> 도착점 100m 안에서 [도착 확인] -> 'done' + 10 길동무포인트.
// 실시간: 모든 바뀜은 rev(cid) 를 올리고, 앱은 /c/wait · /p/wait 로 '바뀔 때까지' 붙들어 두었다가 곧바로 새 화면을 받는다(0.6초 안).
const DAY = 86400000, KST = 9 * 3600000, CHAT_KEEP = 7 * DAY, PAIR_TTL = 10 * 60000, MAX_PARENTS = 4, MAX_TXT = 300, MAX_CHAT = 300, MAX_QUEST = 100, MAX_PT = 5, MAX_PLACES = 12, MAX_CHEER = 20, CHEER_LEN = 40;
const LEAD = 30 * 60000, STAY = 120 * 60000, PROMPT_AFTER = 60 * 60000, ARR_M = 100, ARR_AUTO_M = 50, HERE_M = 150, LOC_FRESH = 90000, ARRIVE_PT = 10, WAIT_MS = 15000, WAIT_STEP = 600, HUB_SLICE = 5000;
const KEYS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WD = ['월', '화', '수', '목', '금', '토', '일'];

const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (m, s) => J({ ok: false, err: m }, s || 400);


// ───────── 푸시(FCM HTTP v1) — 앱이 꺼져 있어도 알림이 가도록, 바뀐 일을 기기 토큰으로 보낸다 ─────────
// 서비스 계정 키(JSON 전체)는 워커 비밀값 FCM_SA 에 넣는다. 없으면 푸시만 건너뛰고 나머지는 그대로 돈다.
const MISS_AFTER = 5 * 60000;
let CTX = null, ENVG = null;                    // ENVG: 지금 요청의 바인딩(허브 FAM 이 있으면 실시간 깨우기에 쓴다)
function later(p) { const q = Promise.resolve(p).catch(() => {}); try { if (CTX && CTX.waitUntil) CTX.waitUntil(q); } catch (e) { /* 이미 끝난 요청의 핸들이면 그냥 돌아가게 둔다 */ } return q; }
const locBumpAt = new Map();
// s426: 아무도 안 보고 · 가만히 있고 · 등록 장소와 멀고 · 약속 시간대가 아니면 자녀 앱이 보고 주기를 8분(앱 쪽)으로 늘려도 된다고 응답에 sl:1 을 실어 준다. 안전 점검(위치 끊김 20분)보다 짧게.
const SLOW_STILL_MS = 10 * 60000, SLOW_PLACE_M = 500, SLOW_LEAD_MS = 30 * 60000 + 10 * 60000;
const locHold = new Map();                      // 튄 것으로 보고 보류한 위치(cid → {la,lo,t}) — 곧바로 같은 곳에서 또 오면 진짜로 본다
const LOC_FRESH_MS = 5 * 60000, LOC_POOR_M = 100, LOC_JUMP_M = 1500, LOC_JUMP_MS = 60, LOC_CONFIRM_MS = 120000;
// 부모가 처음 열었는데(앱을 새로 깔았거나 막 연결) 자녀 위치가 없거나 오래됐으면, 자녀 폰에 '위치 한 번 올려' 푸시를 보낸다(s390).
// 앱이 꺼져 있어도 푸시로 깨어나 위치를 한 번 올린다 — 위치 공유가 켜져 있고 자녀 폰이 동의·권한을 준 경우만. 같은 자녀는 3분에 한 번만 묻는다.
const locAskAt = new Map();
const LOC_ASK_GAP = 3 * 60000, LOC_STALE_MS = 30 * 60000;
async function askLoc(env, DB, cid, now) {
  if ((locAskAt.get(cid) || 0) > now - LOC_ASK_GAP) return false;
  const lr = await DB.prepare('SELECT t FROM loc WHERE cid=?').bind(cid).first();
  if (lr && now - lr.t < LOC_STALE_MS) return false;
  locAskAt.set(cid, now);
  later(notifyChild(env, DB, cid, { k: 'locreq', tag: 'locreq' }));
  return true;
}
// ───────── 실시간 보기(s393) ─────────
// 부모 앱이 키즈 화면(허브)에 긴 대기를 걸어 두는 동안만 '보는 중'이다(WATCH_MS 안에 대기가 이어져 있으면). 보기 시작하면 자녀 폰에 'watch' 푸시를 보내 앱이 꺼져 있어도 위치를 빨리 올리게 하고,
// 그 뒤로는 자녀 위치 보고(/c/loc)의 응답에 w(주기 종류)를 실어 보낸다: 1 = 움직이는 중 2.5초 · 2 = 15분 넘게 이어 봄 10초 · 3 = 가만히 있음 15초 · 없음 = 보는 사람 없음(원래 주기).
// 몇 초마다 보낼지 · 언제 멈출지는 서버(엔진)가 정하고 자녀 앱은 그대로 따른다.
const WATCH_MS = 40000, WATCH_FAST_MS = 15 * 60000, WATCH_PUSH_GAP = 20000, MOVE_REC_MS = 60000;
const watchPushAt = new Map();
/** 이 자녀를 지금 보고 있는 부모가 있으면 {ws}(가장 먼저 보기 시작한 시각), 없으면 null */
async function watchOf(DB, cid, now) {
  const r = await DB.prepare('SELECT MIN(d.ws) ws FROM links l JOIN devices d ON d.id=l.pid WHERE l.cid=? AND d.wt>?').bind(cid, now - WATCH_MS).first();
  return r && r.ws ? { ws: r.ws } : null;
}
/** s428: 부모가 보는 중이거나, 긴급 호출(sos) · 데리러 와줘(pick)가 열려 있으면(30분) 촘촘한 보고 — 한 번의 조회로 둘 다 본다. 열린 호출은 느린 보고(sl)도 막는다. */
const CALL_FAST_MS = 30 * 60000;
/** s429: 초인종 모드에서 앱이 울림을 기다리는 최대 시간(서버가 알려 준다 — 앱은 숫자를 모른다). 허브 화면은 '보는 중' 표시(WATCH_MS)가 끊기지 않게 그 절반. */
const WS_WAIT_MS = 45000, WS_HUB_WAIT_MS = WATCH_MS / 2;
async function watchOrCall(DB, cid, now) {
  const r = await DB.prepare("SELECT MIN(d.ws) ws, (SELECT 1 FROM calls WHERE cid=? AND k IN ('sos','pick') AND st IN (0,1) AND t>? LIMIT 1) cl FROM links l JOIN devices d ON d.id=l.pid WHERE l.cid=? AND d.wt>?").bind(cid, now - CALL_FAST_MS, cid, now - WATCH_MS).first();
  if (r && r.ws) return { ws: r.ws };
  return r && r.cl ? { ws: now, call: 1 } : null;
}
/** 부모가 키즈 화면을 보고 있다고 적는다. 새로 보기 시작했으면 자녀 폰에 'watch' 푸시. */
async function watchTouch(env, DB, pid, cid, now) {
  const d = await DB.prepare('SELECT wt FROM devices WHERE id=?').bind(pid).first();
  if (!d) return false;
  if (d.wt > now - WATCH_MS) { if (now - d.wt >= 5000) await DB.prepare('UPDATE devices SET wt=? WHERE id=?').bind(now, pid).run(); return false; }
  await DB.prepare('UPDATE devices SET wt=?,ws=? WHERE id=?').bind(now, now, pid).run();
  if (now - (watchPushAt.get(cid) || 0) < WATCH_PUSH_GAP) return false;
  watchPushAt.set(cid, now);
  later(notifyChild(env, DB, cid, { k: 'watch', tag: 'watch' }));
  return true;
}
/** 자녀 앱에 알려 줄 주기 종류(위 설명). 보는 사람이 없으면 0. */
function watchCode(w, mt, now) {
  if (!w) return 0;
  if (now - w.ws > WATCH_FAST_MS) return 2;
  return mt && now - mt < MOVE_REC_MS ? 1 : 3;
}
/** 두 점 사이 가는 방향(도 · 북쪽 0 · 시계 방향) */
function bearing(a, b, c, d) {
  const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r);
  return Math.round((Math.atan2(y, x) / r + 360) % 360) % 360;
}
const EV_KEEP = 3 * DAY, MAX_EV = 150;
// 이동 이력(p-kids65): 자녀가 보낸 위치를 CRUMB_M(40m, 오차가 더 크면 오차) 넘게 움직였을 때마다 한 점씩 쌓아 3일 보관하고, 부모 키즈 탭 지도에 지난 TRAIL_MS 의 경로(line)로 그린다.
// 활동 줄 'mv'(이동 중 · 동네 · 거리)는 마지막 줄을 남긴 자리에서 MV_EV_M(200m) 넘게, 그리고 MV_EV_GAP(2.8분) 넘게 지났을 때만 남긴다.
const TRAIL_KEEP = 3 * DAY, TRAIL_MS = 6 * 3600000, MAX_TRAIL = 1500, TRAIL_PTS = 400, CRUMB_M = 40, MV_EV_M = 200, MV_EV_GAP = 170000;
// ───────── 지난 경로 보관(s391): 한 곳에 30분 넘게 머물면 그 전까지 이동한 길을 한 건으로 닫아 자녀당 10개까지 둔다(11번째부터 가장 오래된 것을 지운다) ─────────
// 정지 = 위치가 이어서 들어오는 동안 반경 RT_DWELL_M(100m) 안에 RT_DWELL_MS(30분) 넘게. 보고가 RT_GAP_MS(20분) 넘게 끊기면 '정지'로 치지 않는다(꺼졌던 폰으로 가짜 경로를 만들지 않게).
// 이동 거리가 RT_MIN_M(150m) 미만이면 저장하지 않는다(집 안 · GPS 흔들림이 10칸을 채우지 않게). 점은 RT_PTS(300)개 이하로 간추려 둔다(화면 지도가 400점까지 받는다).
const RT_KEEP = 10, RT_MIN_M = 150, RT_DWELL_M = 100, RT_DWELL_MS = 30 * 60000, RT_GAP_MS = 20 * 60000, RT_PTS = 300, RT_VIEW_MS = 10 * 60000;
// 지난 경로는 10개이면서 7일(RT_MAX_AGE)이 지나면 지운다(개인정보: 오래 쌓아 두지 않는다 — DESIGN.md 9장 11번). 머문 곳은 30일(STRANGE_KEEP) · 도착/출발 알림 시각은 하루.
const RT_MAX_AGE = 7 * 24 * 3600000;
// ── routes:begin (순수 계산 — 시험이 이 구간을 떼어 돌린다) ──
/** 정지 상태 한 걸음. st = {dla,dlo,dt,cl,rte,rsa,rso,sn,en}(없으면 null) · lastT = 바로 앞 보고 시각(0 이면 없음) · name = 지금 있는 곳 이름.
 *  돌려주는 값 {st, close} — close = {t1, from:[la,lo]|null, since, sn, en} 이면 '지금까지의 길'을 한 건으로 닫으라는 뜻(점은 호출한 쪽이 since 이후 · t1 이전 기록에서 읽는다). */
function rtNext(st, la, lo, now, lastT, name, hav) {
  if (!st) return { st: { dla: la, dlo: lo, dt: now, cl: 0, rte: 0, rsa: null, rso: null, sn: '', en: '' }, close: null };
  const n = Object.assign({}, st), d = hav(st.dla, st.dlo, la, lo);
  if (d <= RT_DWELL_M) {
    if (st.cl) return { st: n, close: null };                                   // 이미 닫은 정지 — 가만히 있는 동안은 아무 일 없다
    if (lastT && now - lastT > RT_GAP_MS) { n.dla = la; n.dlo = lo; n.dt = now; return { st: n, close: null }; }    // 보고가 끊겼다 → 여기서 새로 센다
    if (now - st.dt >= RT_DWELL_MS) {
      n.cl = 1; n.en = name || '';
      return { st: n, close: { t1: st.dt, from: st.rsa == null ? null : [st.rsa, st.rso], to: [st.dla, st.dlo], since: st.rte, sn: st.sn || '', en: name || '' } };
    }
    return { st: n, close: null };
  }
  if (st.cl) {                                                                  // 닫힌 정지에서 벗어났다 = 출발: 새 길은 바로 앞 보고 이후의 기록부터
    return { st: { dla: la, dlo: lo, dt: now, cl: 0, rte: lastT || st.dt, rsa: st.dla, rso: st.dlo, sn: st.en || '', en: '' }, close: null };
  }
  n.dla = la; n.dlo = lo; n.dt = now;                                           // 움직이는 중 — 기준점을 따라 옮긴다
  return { st: n, close: null };
}
/** 점들의 길이(m) */
function rtLen(pts, hav) { let m = 0; for (let i = 1; i < pts.length; i++) m += hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); return m; }
/** 점 간추리기: 직선에서 eps(m) 넘게 벗어난 점만 남기는 Douglas-Peucker, 그래도 max 보다 많으면 eps 를 키워 다시(처음과 끝은 늘 남는다) */
function rtThin(pts, max) {
  if (pts.length <= max) return pts.slice();
  const k = 111320, c = Math.cos((pts[0][0] * Math.PI) / 180);
  const xy = pts.map((q) => [q[1] * k * c, q[0] * k]);
  for (let eps = 6; eps < 5000; eps *= 1.6) {
    const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let bi = -1, bd = eps;
      const dx = xy[b][0] - xy[a][0], dy = xy[b][1] - xy[a][1], L = Math.hypot(dx, dy);
      for (let i = a + 1; i < b; i++) {
        const dd = L < 1e-9 ? Math.hypot(xy[i][0] - xy[a][0], xy[i][1] - xy[a][1]) : Math.abs(dy * (xy[i][0] - xy[a][0]) - dx * (xy[i][1] - xy[a][1])) / L;
        if (dd > bd) { bd = dd; bi = i; }
      }
      if (bi >= 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    const out = []; for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    if (out.length <= max) return out;
  }
  return [pts[0], pts[pts.length - 1]];
}
/** 닫을 길의 점 모으기: 출발 자리 + 기록된 점들 + 멈춘 자리. RT_MIN_M(150m) 미만이면 null(저장하지 않는다). */
function rtBuild(rows, c, hav) {
  const pts = [];
  const push = (la, lo) => { const q = [+la.toFixed(5), +lo.toFixed(5)]; const l = pts[pts.length - 1]; if (!l || hav(l[0], l[1], q[0], q[1]) >= 5) pts.push(q); };
  if (c.from) push(c.from[0], c.from[1]);
  for (const r of rows) push(r.la, r.lo);
  push(c.to[0], c.to[1]);
  if (pts.length < 2) return null;
  const m = rtLen(pts, hav);
  if (m < RT_MIN_M) return null;
  return { pts: rtThin(pts, RT_PTS), m: Math.round(m) };
}
// ── routes:end ──
// ───────── 안전 알림(s392) ─────────
// 위치 끊김: 보고가 STALE_MS(20분) 넘게 없으면 부모에게 한 번(밤 23~06시와 자녀가 공유를 끈 동안은 보내지 않는다) · 다시 들어오면 되살린다. 배터리 15% 이하(충전 중 아님)는 3시간에 한 번.
// 낯선 곳 정지: 30분 넘게 머문 곳이 등록 장소 150m 밖이고 최근 30일 안에 다른 날 2번 넘게 머문 적이 없으면 알린다(처음 3일은 배우는 기간이라 알리지 않는다).
// 날씨: 아침 7시 30분 이후 하루 한 번, 자녀가 있는 곳의 낮(7~20시) 예보에 비 · 눈 · 폭염 · 한파 · 미세먼지가 있으면 부모에게.
const STALE_MS = 20 * 60000, BATT_LOW = 15, BATT_GAP = 3 * 3600000, STRANGE_LEARN_MS = 3 * DAY, STRANGE_KEEP = 30 * DAY, MAX_STOPS = 200, STRANGE_M = 200, WX_AT = 7 * 60 + 30;
// ── wx:begin (순수 계산 — 시험이 이 구간을 떼어 돌린다) ──
/** 낮(7~20시) 예보에서 부모에게 알릴 것을 고른다. w = Open-Meteo forecast.hourly · aq = air-quality.hourly. 돌려주는 값: [{k, s}] (알릴 것이 없으면 빈 배열) */
function wxDecide(w, aq) {
  const out = [];
  const hrs = (h) => { const r = []; if (!h || !h.time) return r; h.time.forEach((t, i) => { const hh = +String(t).slice(11, 13); if (hh >= 7 && hh <= 20) r.push(i); }); return r; };
  const num = (a, idx) => idx.map((i) => (a && typeof a[i] === 'number' ? a[i] : null)).filter((v) => v !== null);
  if (w && w.time) {
    const ix = hrs(w), pp = num(w.precipitation_probability, ix), pr = num(w.precipitation, ix), sn = num(w.snowfall, ix), ap = num(w.apparent_temperature, ix);
    const maxP = pp.length ? Math.max(...pp) : 0, sumR = pr.reduce((a, b) => a + b, 0), sumS = sn.reduce((a, b) => a + b, 0);
    if (sumS >= 0.5) out.push({ k: 'snow', s: '눈이 와요' });
    else if (maxP >= 60 || sumR >= 1) out.push({ k: 'rain', s: '비가 와요 (강수확률 ' + Math.round(maxP) + '%) · 우산' });
    if (ap.length && Math.max(...ap) >= 33) out.push({ k: 'heat', s: '체감 ' + Math.round(Math.max(...ap)) + '°C 폭염 · 물과 그늘' });
    if (ap.length && Math.min(...ap) <= -10) out.push({ k: 'cold', s: '체감 ' + Math.round(Math.min(...ap)) + '°C 한파 · 따뜻하게' });
  }
  if (aq && aq.time) {
    const ix = hrs(aq), p25 = num(aq.pm2_5, ix), p10 = num(aq.pm10, ix);
    const m25 = p25.length ? Math.max(...p25) : 0, m10 = p10.length ? Math.max(...p10) : 0;
    if (m25 >= 76 || m10 >= 151) out.push({ k: 'dust', s: '미세먼지 매우 나쁨 · 마스크' });
    else if (m25 >= 36 || m10 >= 81) out.push({ k: 'dust', s: '미세먼지 나쁨 · 마스크' });
  }
  return out;
}
// ── wx:end ──
/** 낯선 곳 정지인지 보고 맞으면 부모에게 알린다. 정지가 닫힐 때마다 부른다(길 저장 여부와 상관없이). */
async function strangeStop(env, DB, cid, c, name, now) {
  const la = c.to[0], lo = c.to[1], day = kstParts(c.t1).ds;
  const pls = (await DB.prepare('SELECT la,lo FROM places WHERE cid=?').bind(cid).all()).results || [];
  const atPlace = pls.some((q) => hav(la, lo, q.la, q.lo) <= HERE_M);
  const first = (await DB.prepare('SELECT MIN(t) m FROM stops WHERE cid=?').bind(cid).first() || {}).m || 0;
  const dLa = STRANGE_M / 111320, dLo = STRANGE_M / (111320 * Math.max(0.2, Math.cos((la * Math.PI) / 180)));
  const known = (await DB.prepare('SELECT COUNT(DISTINCT d) n FROM stops WHERE cid=? AND t>? AND la BETWEEN ? AND ? AND lo BETWEEN ? AND ?').bind(cid, now - STRANGE_KEEP, la - dLa, la + dLa, lo - dLo, lo + dLo).first() || { n: 0 }).n;
  await DB.batch([
    DB.prepare('INSERT INTO stops(cid,la,lo,t,d) VALUES(?,?,?,?,?)').bind(cid, la, lo, c.t1, day),
    DB.prepare('DELETE FROM stops WHERE cid=? AND (t<? OR id NOT IN (SELECT id FROM stops WHERE cid=? ORDER BY id DESC LIMIT ?))').bind(cid, now - STRANGE_KEEP, cid, MAX_STOPS),
  ]);
  if (atPlace || known >= 2 || !first || now - first < STRANGE_LEARN_MS) return false;
  const where = (name || '').trim() || '알 수 없는 곳';
  await ev(DB, cid, 'odd', where, now);
  await bump(DB, cid);
  later(notifyParents(env, DB, cid, (nm) => ({ k: 'odd', title: '길동무', body: who(nm) + ' 평소와 다른 곳(' + where + ')에서 30분 넘게 머물러 있어요 · ' + clock(c.t1) + '부터', tag: 'odd' })));
  return true;
}
/** 보고가 올 때마다 부른다: 정지 판정 상태를 한 걸음 옮기고, 30분 정지가 확인되면 지금까지의 길을 한 건으로 저장한다. 저장했으면 true. */
async function routeStep(env, DB, cid, la, lo, now, lastT, name) {
  const row = await DB.prepare('SELECT dla,dlo,dt,cl,rte,rsa,rso,sn,en FROM rtst WHERE cid=?').bind(cid).first();
  const r = rtNext(row || null, la, lo, now, lastT, name, hav);
  let saved = false;
  if (r.close) {
    const c = r.close;
    try { await strangeStop(env, DB, cid, c, name, now); } catch (e) { /* 알림이 길 저장을 막지 않는다 */ }
    const rows = ((await DB.prepare('SELECT la,lo FROM locs WHERE cid=? AND t>? AND t<=? ORDER BY id ASC LIMIT 1500').bind(cid, c.since || 0, c.t1).all()).results || []);
    const b = rtBuild(rows, c, hav);
    if (b) {
      const t0 = rows.length ? (await DB.prepare('SELECT t FROM locs WHERE cid=? AND t>? ORDER BY id ASC LIMIT 1').bind(cid, c.since || 0).first() || { t: c.t1 }).t : c.t1;
      await DB.batch([
        DB.prepare('INSERT INTO routes(cid,t0,t1,m,sn,en,pts) VALUES(?,?,?,?,?,?,?)').bind(cid, t0, c.t1, b.m, String(c.sn || '').slice(0, 20), String(c.en || '').slice(0, 20), JSON.stringify(b.pts)),
        DB.prepare('DELETE FROM routes WHERE cid=? AND id NOT IN (SELECT id FROM routes WHERE cid=? ORDER BY id DESC LIMIT ?)').bind(cid, cid, RT_KEEP),
        DB.prepare('DELETE FROM routes WHERE cid=? AND t1<?').bind(cid, now - RT_MAX_AGE),
      ]);
      saved = true;
    }
  }
  const o = r.st;
  if (!row || row.dla !== o.dla || row.dlo !== o.dlo || row.dt !== o.dt || row.cl !== o.cl || row.rte !== o.rte || row.rsa !== o.rsa || row.rso !== o.rso || row.sn !== o.sn || row.en !== o.en)
    await DB.prepare('INSERT INTO rtst(cid,dla,dlo,dt,cl,rte,rsa,rso,sn,en) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cid) DO UPDATE SET dla=excluded.dla,dlo=excluded.dlo,dt=excluded.dt,cl=excluded.cl,rte=excluded.rte,rsa=excluded.rsa,rso=excluded.rso,sn=excluded.sn,en=excluded.en')
      .bind(cid, o.dla, o.dlo, o.dt, o.cl, o.rte, o.rsa == null ? null : o.rsa, o.rso == null ? null : o.rso, o.sn || '', o.en || '').run();
  return saved;
}
const EVK = new Set(['feed', 'clean', 'drop', 'dress', 'psleep', 'pstudy', 'pplay']);       // 자녀 앱이 알려 주는 활동 — 자녀가 직접 한 일만(친구들 스스로의 놀기·공부·잠·응가는 기록하지 않는다)
const EV_HIDE = "('play','study','sleep','poop')";                   // 옛 앱이 남긴 친구들 행동 줄은 보이지 않게 거른다
/** '뭐하니?' 활동 한 줄을 남긴다(k 종류 · x 장소/동네/친구 이름). 부모 화면이 바로 바뀌도록 알린다 */
async function ev(DB, cid, k, x, now) {
  try { await DB.prepare('INSERT INTO evs(cid,k,x,t) VALUES(?,?,?,?)').bind(cid, k, String(x).slice(0, 40), now).run(); await bump(DB, cid); } catch (e) { /* 기록 실패는 본 일에 영향 없다 */ }
}
async function pnOf(DB, pid) { return ((await DB.prepare("SELECT pnm FROM links WHERE pid=? AND pnm<>'' LIMIT 1").bind(pid).first()) || {}).pnm || ''; }
const b64u = (buf) => { let r = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) r += String.fromCharCode(a[i]); return btoa(r).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64s = (x) => b64u(new TextEncoder().encode(x));
function saOf(env) {
  try { const j = JSON.parse(env.FCM_SA || ''); return j && j.client_email && j.private_key && j.project_id ? j : null; } catch (e) { return null; }
}
let fcmTok = null;
async function fcmAccess(sa) {
  const now = Date.now();
  if (fcmTok && fcmTok.exp > now + 60000) return fcmTok.t;
  const h = b64s(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), iat = Math.floor(now / 1000);
  const c = b64s(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + c));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + h + '.' + c + '.' + b64u(sig) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('fcm auth ' + r.status);
  fcmTok = { t: j.access_token, exp: now + (j.expires_in || 3000) * 1000 };
  return fcmTok.t;
}
/** rows: [{id, ft, data}] — 데이터 메시지(높은 우선순위)를 한 기기씩 보낸다. 죽은 토큰은 지운다. */
async function pushRows(env, DB, rows) {
  const sa = saOf(env);
  if (!sa || !rows.length) return 0;
  const at = await fcmAccess(sa);
  let ok = 0;
  await inChunks(rows, 100, async (r) => {
    const data = {};
    for (const k of Object.keys(r.data)) data[k] = String(r.data[k]).slice(0, 400);
    const res = await fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
      method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: r.ft, data, android: { priority: 'HIGH', ttl: '3600s' } } }),
    });
    if (res.ok) ok++;
    else if (res.status === 404 || res.status === 400) { const t = await res.text().catch(() => ''); if (/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(t)) await DB.prepare("UPDATE devices SET ft='' WHERE id=? AND ft=?").bind(r.id, r.ft).run(); }
  });
  return ok;
}
async function notifyChild(env, DB, cid, data) {
  const d = await DB.prepare("SELECT id,ft FROM devices WHERE id=? AND ft<>''").bind(cid).first();
  if (d) await pushRows(env, DB, [{ id: d.id, ft: d.ft, data: Object.assign({ cid }, data) }]);
}
// ───────── 법정대리인 확인 · 위치 제공 기록(s394) ─────────
const GD_VER = 1, LBS_KEEP = 200 * 86400000;      // 6개월(약 183일)보다 길게
async function gdOk(DB, pid) { const r = await DB.prepare('SELECT v FROM gd WHERE pid=?').bind(pid).first(); return !!r && r.v >= GD_VER; }
/** 이용 · 제공 사실 한 줄(같은 부모 · 자녀 · 종류는 gapMs 안에는 한 번만) */
async function lbsLog(DB, cid, pid, k, now, gapMs) {
  await DB.prepare('INSERT INTO lbs(t,cid,pid,k) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM lbs WHERE cid=? AND pid=? AND k=? AND t>?)').bind(now, cid, pid, k, cid, pid, k, now - (gapMs || 0)).run();
}
const LEGAL_BASE = 'https://gildongmu-kids.phg0643.workers.dev';          // 앱이 쓰는 주소와 같다(앱 안 링크용)
function gdScreen(nm) {
  return scr('kidgd', [], [
    tx('보호자 확인', { size: 16, bold: true, pad: [16, 24, 16, 6] }),
    tx(nm + '의 위치를 보기 전에 아래를 확인해 주세요.', { size: 12.5, color: 'sub', pad: [16, 0, 16, 8] }),
    panel([tx('• 저는 이 자녀의 법정대리인(친권자 · 후견인)이에요', { size: 13, pad: [0, 4, 0, 4] }),
      tx('• 자녀는 만 9세 이상이에요', { size: 13, pad: [0, 4, 0, 4] }),
      tx('• 자녀에게 위치를 확인한다는 것을 알리고, 자녀도 동의했어요 (자녀 앱에서 동의해야 위치가 와요)', { size: 13, pad: [0, 4, 0, 4] }),
      tx('• 자녀의 안전을 지키는 데에만 쓰고, 다른 사람의 위치를 몰래 확인하는 데 쓰지 않아요', { size: 13, pad: [0, 4, 0, 4] }),
      tx('• 사실과 다르면 이용이 제한될 수 있고 법적 책임은 제게 있어요', { size: 13, pad: [0, 4, 0, 4] })], { pad: [12, 4, 12, 0], ip: [14, 10, 14, 10] }),
    tx('이 확인을 한 시각이 기록돼요. 자세한 내용은 개인정보 처리방침과 위치기반서비스 이용약관에 있어요.', { size: 11, color: 'sub', pad: [16, 10, 16, 6] }),
    { t: 'row', gap: 8, pad: [12, 0, 12, 0], kids: [btn('처리방침 보기', { a: 'open', url: LEGAL_BASE + '/legal/privacy' }, { h: 34, size: 12, bold: false }), btn('이용약관 보기', { a: 'open', url: LEGAL_BASE + '/legal/terms' }, { h: 34, size: 12, bold: false })] },          // s430
    { t: 'row', gap: 8, pad: [12, 12, 12, 16], kids: [btn('모두 확인했어요', call('kg.ok'), gold)] },
  ], { dlg: dlg() });          // s415: 키즈 화면 위 가운데 팝업(앱이 '키즈 화면'이 아니라 팝업으로 띄운다)
}
/** 연결된 부모마다(자녀 이름은 부모가 정한 이름) 글을 따로 만들어 보낸다. mk(nm) => data */
/** 꾸미기 저장 글: "고른친구,탭;모자,옷,소지품;…(8명)" — 이 모양만 받는다(번호는 -1 ~ 19). */
const WEAR_RE = /^[0-7],[0-2](;-?\d{1,2},-?\d{1,2},-?\d{1,2}){8}$/;
const wearOk = (w) => typeof w === 'string' && w.length <= 120 && WEAR_RE.test(w) && w.split(';').slice(1).every((t) => t.split(',').every((x) => +x >= -1 && +x <= 19));
/** 이 부모에게 연결된 자녀(요청한 자녀가 아니면 첫 자녀)가 꾸민 모습 — 없으면 빈 글. */
async function wearFor(DB, pid, cid0) {
  const kids = await childrenOf(DB, pid);
  const cid = kids.some((k) => k.cid === cid0) ? cid0 : kids[0] ? kids[0].cid : '';
  const r = cid ? await DB.prepare('SELECT w FROM wear WHERE cid=?').bind(cid).first() : null;
  return { cid, w: r ? r.w : '' };
}
/** 부모 앱 홈 장면이 바로 바뀌도록 조용한 알림(k:'wear')을 보낸다 — 화면에 알림 카드는 뜨지 않는다. */
async function wearPush(env, DB, cid, w) {
  const rs = (await DB.prepare('SELECT d.id id,d.ft ft FROM links l JOIN devices d ON d.id=l.pid JOIN gd g ON g.pid=l.pid AND g.v>=? WHERE l.cid=? AND d.ft<>\'\'').bind(GD_VER, cid).all()).results || [];
  if (rs.length) await pushRows(env, DB, rs.map((r) => ({ id: r.id, ft: r.ft, data: { k: 'wear', cid, w } })));
}
async function notifyParents(env, DB, cid, mk, all) {      // all: 법정대리인 확인 전인 부모에게도 보낸다(긴급 호출 — 알림에는 위치가 없고, 위치는 확인을 마쳐야 보인다)
  const rs = (all
    ? await DB.prepare("SELECT d.id id,d.ft ft,l.nm nm FROM links l JOIN devices d ON d.id=l.pid WHERE l.cid=? AND d.ft<>''").bind(cid).all()
    : await DB.prepare("SELECT d.id id,d.ft ft,l.nm nm FROM links l JOIN devices d ON d.id=l.pid JOIN gd g ON g.pid=l.pid AND g.v>=? WHERE l.cid=? AND d.ft<>''").bind(GD_VER, cid).all()).results || [];
  const now = Date.now();
  if (rs.length) await DB.batch(rs.map((r) => DB.prepare("INSERT INTO lbs(t,cid,pid,k) VALUES(?,?,?,'n')").bind(now, cid, r.id)));
  await pushRows(env, DB, rs.map((r) => ({ id: r.id, ft: r.ft, data: Object.assign({ cid }, mk(r.nm || '')) })));
}
const who = (nm) => (nm ? ga(nm) : '자녀가');
/** 지금 알림을 실제로 받을 수 있는 부모 수(notifyParents 와 같은 조건) — 0 이면 자녀 앱에 "알림이 가지 않아요" 라고 알려 준다. */
async function pushable(DB, cid, all) {
  const r = all
    ? await DB.prepare("SELECT COUNT(*) n FROM links l JOIN devices d ON d.id=l.pid WHERE l.cid=? AND d.ft<>''").bind(cid).first()
    : await DB.prepare("SELECT COUNT(*) n FROM links l JOIN devices d ON d.id=l.pid JOIN gd g ON g.pid=l.pid AND g.v>=? WHERE l.cid=? AND d.ft<>''").bind(GD_VER, cid).first();
  return (r && r.n) || 0;
}
// ───────── 긴급 호출 · 안전하게 도착 · 데리러 와줘(s399) ─────────
// 자녀가 누르면(자녀 앱 /c/call) 서버가 기록하고 부모에게 알린다. 알림 글에는 좌표가 없고(장소 이름만), 좌표는 부모가 확인을 마친 화면에서만 보인다.
const CALL_GAP = { sos: 60000, pick: 5 * 60000, arr: 2 * 60000 };          // 같은 것을 이 시간 안에 또 누르면 새로 만들지 않는다(실수로 여러 번 눌러도 알림 폭탄 없음)
const CALL_OPEN_MS = 3 * 3600000, CALL_KEEP = 7 * 86400000, CALL_NEAR_M = 150;
async function nearPlaceName(DB, cid, la, lo) {
  const ps = (await DB.prepare('SELECT name,la,lo FROM places WHERE cid=?').bind(cid).all()).results || [];
  let best = null, bd = CALL_NEAR_M + 1;
  for (const p of ps) { const d = hav(la, lo, p.la, p.lo); if (d < bd) { bd = d; best = p.name; } }
  return best || '';
}
/** s415: 호출 팝업(가운데)에 뭐라고 쓰고 · 어떤 단추가 있고 · 저절로 뜰지는 엔진이 정한다. 앱은 이 값으로 그리기만 한다(푸시에도 같은 값이 실려 키즈 탭 밖에서도 같은 팝업이 뜬다).
 *  c: {id,k,t,la,lo,pl,st}  st 0 = 아직 확인 전(저절로 뜬다) · 1 = 확인함(허브 줄을 눌러 '만났어요') */
function callPopData(c, nm) {
  const sos = c.k === 'sos', arr = c.k === 'arr';
  const sub = clock(c.t) + (c.pl ? ' · ' + c.pl + ' 근처' : '') + (arr ? '' : c.st === 1 ? ' · 부모님 중 한 분이 확인했어요' : '') + (arr ? '' : (c.la || c.lo) ? ' · 지도에 표시했어요' : ' · 위치를 아직 못 받았어요');
  const pt = arr ? '✅ ' + nm + ' 안전하게 도착했어요' : sos ? '🚨 ' + nm + ' 긴급 호출' : '🚗 ' + nm + ' 데리러 와 달라고 해요';
  const st = c.st || 0;
  return { pk: c.id + ':' + st + ':' + c.t, ci: c.id || '', pt, ps: sub, bt: arr ? '확인' : st === 0 ? (sos ? '확인했어요' : '지금 가요') : (sos ? '상황이 끝났어요' : '만났어요'), ka: arr ? '' : st === 0 ? 'kx.ack' : 'kx.done', au: st === 0 ? 1 : 0, k: c.k };
}
/** 허브 응답에 실리는 호출 팝업(가장 급한 하나 — 긴급 우선, 아니면 최근). 열린 호출이 없거나 법정대리인 확인 전이면 null */
async function popOf(DB, pid, cid, now) {
  if (!(await gdOk(DB, pid))) return null;
  const calls = (await DB.prepare("SELECT id,k,t,la,lo,pl,st FROM calls WHERE cid=? AND k IN ('sos','pick') AND st IN (0,1) AND t>? ORDER BY t DESC LIMIT 2").bind(cid, now - CALL_OPEN_MS).all()).results || [];
  const c = calls.find((x) => x.k === 'sos') || calls[0];
  if (!c) return null;
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid);
  return callPopData(c, nmOf(cur));
}
const callAck = (k) => (k === 'sos' ? '부모님이 확인했어요' : '부모님이 데리러 가고 있어요');
const callDone = (k) => (k === 'sos' ? '부모님이 상황이 끝났다고 했어요' : '부모님을 만났어요 😊');
async function callRequest(env, DB, cid, body, now) {
  const k = String(body.k || '');
  if (!CALL_GAP[k]) return { err: '형식이 맞지 않아요' };
  const linked = await linkedCount(DB, cid);
  if (linked === 0) return { ok: true, linked: 0 };
  const np = await pushable(DB, cid, k === 'sos');                     // 알림을 받을 수 있는 부모 수(0 이면 자녀 앱이 안내한다)
  let la = Number(body.la), lo = Number(body.lo);
  let has = body.la != null && body.lo != null && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 85 && Math.abs(lo) <= 180 && (la || lo);
  if (!has) { const l = await DB.prepare('SELECT la,lo,t FROM loc WHERE cid=?').bind(cid).first(); if (l && now - l.t < 30 * 60000) { la = l.la; lo = l.lo; has = true; } }
  if (body.op === 'cancel') {
    if (k === 'arr') return { err: '형식이 맞지 않아요' };
    const r = await DB.prepare('UPDATE calls SET st=2,at=? WHERE cid=? AND k=? AND st IN (0,1) AND t>?').bind(now, cid, k, now - CALL_OPEN_MS).run();
    if (r && r.meta && r.meta.changes > 0) {
      await bump(DB, cid);
      later(notifyParents(env, DB, cid, (nm) => ({ k: 'callx', title: k === 'sos' ? '긴급 호출 취소' : '길동무', body: who(nm) + (k === 'sos' ? ' 긴급 호출을 취소했어요. 괜찮다고 해요' : ' 데리러 와 달라는 요청을 취소했어요'), tag: k }), k === 'sos'));
    }
    return { ok: true, linked };
  }
  const last = await DB.prepare('SELECT id,t,st FROM calls WHERE cid=? AND k=? ORDER BY t DESC LIMIT 1').bind(cid, k).first();
  if (last && last.st !== 2 && now - last.t < CALL_GAP[k]) return { ok: true, id: last.id, dup: 1, linked, np };
  const place = has ? await nearPlaceName(DB, cid, la, lo) : '';
  const keep = has && k !== 'arr';                                      // 도착 알림은 좌표를 남기지 않는다(장소 이름만)
  const opened = k === 'arr' ? null : await DB.prepare('SELECT id FROM calls WHERE cid=? AND k=? AND st IN (0,1) AND t>? ORDER BY t DESC LIMIT 1').bind(cid, k, now - CALL_OPEN_MS).first();
  let id;
  if (opened) {                                                         // 아직 안 끝난 호출을 또 누르면 카드를 늘리지 않고 그 카드를 새로(미확인으로) 올리고 다시 알린다
    id = opened.id;
    await DB.prepare('UPDATE calls SET t=?,la=?,lo=?,pl=?,st=0,at=0 WHERE id=?').bind(now, keep ? la : 0, keep ? lo : 0, place, id).run();
  } else {
    id = rid();
    await DB.prepare('INSERT INTO calls(id,cid,k,t,la,lo,pl,st,at) VALUES(?,?,?,?,?,?,?,0,0)').bind(id, cid, k, now, keep ? la : 0, keep ? lo : 0, place).run();
  }
  await ev(DB, cid, k, place, now);
  const near = place ? ' · ' + place + ' 근처' : '';
  const pc = { id, k, t: now, la: keep ? la : 0, lo: keep ? lo : 0, pl: place, st: 0 };
  later(notifyParents(env, DB, cid, (nm) => Object.assign(callPopData(pc, nm || '자녀'), (k === 'sos'
    ? { k: 'sos', title: '🚨 긴급 호출', body: who(nm) + ' 긴급 호출을 했어요. 지금 길동무를 열어 확인해 주세요', tag: 'sos' }
    : k === 'pick' ? { k: 'pick', title: '길동무', body: who(nm) + ' 데리러 와 달라고 해요' + near, tag: 'pick' }
      : { k: 'arr', title: '길동무', body: who(nm) + ' 안전하게 도착했다고 알렸어요' + near + ' · ' + clock(now), tag: 'arr' })), k === 'sos'));
  return { ok: true, id, linked, np };
}
/** 같은 일을 두 번 보내지 않는다(비트가 처음 켜질 때만 true) */
async function once(DB, id, bit) {
  const r = await DB.prepare('UPDATE trips SET pn=pn|? WHERE id=? AND (pn&?)=0').bind(bit, id, bit).run();
  return !!(r && r.meta && r.meta.changes > 0);
}
const cut = (x, n) => (x.length > n ? x.slice(0, n - 1) + '…' : x);

/** 등록 장소에 들어오거나 벗어나면 부모에게 알린다(같은 곳 · 같은 일은 5분에 한 번 — GPS 흔들림 · 오가는 것 방지). 도착 확인을 눌러 둔 곳('출발'한 이동)은 그쪽 알림이 있어 '왔어요'는 생략. */
async function zoneAlert(env, DB, cid, kind, plId, name, now, pt) {
  const key = cid + ':' + plId + ':' + kind;
  const zr = await DB.prepare('INSERT INTO zt(k,t) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET t=excluded.t WHERE zt.t<?').bind(key, now, now - 5 * 60000).run();      // 5분 안에 이미 보냈으면 바뀌는 것이 없다(워커 인스턴스가 달라도 한 번만)
  if (!(zr && zr.meta && zr.meta.changes > 0)) return false;
  if (kind === 'at') { const g = await DB.prepare("SELECT 1 a FROM trips WHERE cid=? AND pl=? AND st='go' AND day=?").bind(cid, plId, kstParts(now).ds).first(); if (g) return false; }
  await notifyParents(env, DB, cid, (nm) => ({ k: 'zone', title: '길동무', body: who(nm) + ' ' + name + (kind === 'at' ? ' 근처에 왔어요' : kind === 'in' ? '에 도착했어요' + (pt ? ' (포인트 +' + ARRIVE_PT + ')' : '') : '에서 멀어졌어요') + ' · ' + clock(now), tag: 'zone' + plId }));
  return true;
}
/** 도착(50m 안): 그날 '출발'한 길이 있으면 도착을 확인해 길동무포인트를 주고(자녀가 단추를 안 눌러도), 없으면 '도착했어요' 알림만 보낸다. */
async function arriveAuto(env, DB, cid, plId, name, now) {
  const tr = await DB.prepare("SELECT id FROM trips WHERE cid=? AND pl=? AND day=? AND st='go'").bind(cid, plId, kstParts(now).ds).first();
  if (tr) {
    const r = await DB.prepare("UPDATE trips SET st='done', tc=?, ta=CASE WHEN ta=0 THEN ? ELSE ta END WHERE id=? AND st='go'").bind(now, now, tr.id).run();
    if (r && r.meta && r.meta.changes > 0) {
      const paid = await arrivePay(DB, cid, plId, now);
      await ev(DB, cid, 'done', name, now);
      if (await once(DB, tr.id, 4)) await notifyParents(env, DB, cid, (nm) => ({ k: 'done', title: '길동무', body: who(nm) + ' ' + name + '에 도착했어요' + (paid ? ' (포인트 +' + ARRIVE_PT + ')' : ''), tag: 'trip' + tr.id }));
    }
    return;
  }
  const paid2 = await arrivePay(DB, cid, plId, now);                 // s422: 출발 단추 · 시각 규칙이 없어도 등록한 장소에 도착하면 포인트(그날 그 장소 첫 도착만)
  if (await zoneAlert(env, DB, cid, 'in', plId, name, now, paid2)) await ev(DB, cid, 'in', name, now);
}
/** 배터리가 낮으면 부모에게(3시간에 한 번) */
async function battAlert(env, DB, cid, bt, now) {
  await DB.prepare('INSERT OR IGNORE INTO cst(cid) VALUES(?)').bind(cid).run();
  const r = await DB.prepare('UPDATE cst SET lb=? WHERE cid=? AND lb<?').bind(now, cid, now - BATT_GAP).run();
  if (!(r && r.meta && r.meta.changes > 0)) return false;
  await bump(DB, cid);
  await notifyParents(env, DB, cid, (nm) => ({ k: 'batt', title: '길동무', body: who(nm) + ' 폰 배터리가 ' + bt + '% 예요. 곧 위치가 끊길 수 있어요', tag: 'batt' }));
  return true;
}
/** 1분마다(크론) 안전 점검: 위치 끊김 · 날씨. fetchFn 은 시험에서 바꿔 끼운다. */
async function safetyCron(env, DB, now, fetchFn) {
  const kp = kstParts(now), night = kp.h >= 23 || kp.h < 6;
  const rows = (await DB.prepare('SELECT o.cid cid, o.t t, o.la la, o.lo lo, o.dn dn, c.sh sh, c.stl stl, c.wx wx FROM (SELECT DISTINCT cid FROM links) l JOIN loc o ON o.cid=l.cid LEFT JOIN cst c ON c.cid=l.cid').all()).results || [];
  for (const r of rows) {
    const fresh = now - r.t < STALE_MS;
    if (fresh && r.stl) await DB.prepare('UPDATE cst SET stl=0 WHERE cid=?').bind(r.cid).run();
    if (!fresh && !r.stl && r.sh !== 0 && !night && now - r.t < 48 * 3600000) {
      await DB.prepare('INSERT OR IGNORE INTO cst(cid) VALUES(?)').bind(r.cid).run();
      const u = await DB.prepare('UPDATE cst SET stl=1 WHERE cid=? AND stl=0').bind(r.cid).run();
      if (u && u.meta && u.meta.changes > 0) {
        await bump(DB, r.cid);
        const dong = dongOf(r.dn);
        await notifyParents(env, DB, r.cid, (nm) => ({ k: 'stale', title: '길동무', body: (nm || '자녀') + ' 위치가 ' + ago(now - r.t).replace(' 전', '') + ' 동안 들어오지 않아요 · 마지막 ' + (dong ? dong + ' ' : '') + clock(r.t), tag: 'stale' }));
      }
    }
    if (kp.h * 60 + kp.mi >= WX_AT && kp.h < 11 && String(r.wx || '') !== String(kp.ds) && now - r.t < 24 * 3600000) {
      try {
        const q = 'latitude=' + r.la.toFixed(2) + '&longitude=' + r.lo.toFixed(2) + '&timezone=Asia%2FSeoul&forecast_days=1';
        const [w, a] = await Promise.all([
          fetchFn('https://api.open-meteo.com/v1/forecast?' + q + '&hourly=precipitation_probability,precipitation,snowfall,apparent_temperature').then((x) => (x.ok ? x.json() : null)),
          fetchFn('https://air-quality-api.open-meteo.com/v1/air-quality?' + q + '&hourly=pm10,pm2_5').then((x) => (x.ok ? x.json() : null)).catch(() => null),
        ]);
        if (!w || !w.hourly) continue;                                           // 못 받았다 — 다음 분에 다시(11시까지)
        await DB.prepare('INSERT OR IGNORE INTO cst(cid) VALUES(?)').bind(r.cid).run();
        await DB.prepare('UPDATE cst SET wx=? WHERE cid=?').bind(String(kp.ds), r.cid).run();
        const items = wxDecide(w.hourly, a && a.hourly);
        if (items.length) await notifyParents(env, DB, r.cid, (nm) => ({ k: 'wx', title: '길동무 · 오늘 날씨', body: cut((nm || '자녀') + ' 오늘 낮 — ' + items.map((i) => i.s).join(' · '), 110), tag: 'wx' }));
      } catch (e) { /* 날씨를 못 받아도 다른 일은 계속 */ }
    }
  }
}
/** 1분마다(크론): 시각이 되어 생기는 일 — 30분 전 알림(자녀) · 약속 시각이 지나도 도착하지 않음(부모) */
/** 오래 쌓아 두지 않는다(개인정보): 지난 경로 7일 · 머문 곳 30일 · 도착/출발 알림 시각 하루. 10분에 한 번만 돈다. */
let prunedOldAt = 0;
async function pruneOld(DB, now) {
  if (now - prunedOldAt < 10 * 60000) return;
  prunedOldAt = now;
  await DB.batch([DB.prepare('DELETE FROM calls WHERE t<?').bind(now - CALL_KEEP), DB.prepare('DELETE FROM routes WHERE t1<?').bind(now - RT_MAX_AGE), DB.prepare('DELETE FROM stops WHERE t<?').bind(now - STRANGE_KEEP), DB.prepare('DELETE FROM zt WHERE t<?').bind(now - DAY), DB.prepare('DELETE FROM drafts WHERE t<?').bind(now - DAY), DB.prepare('DELETE FROM lbs WHERE t<?').bind(now - LBS_KEEP), DB.prepare('DELETE FROM cons WHERE t<?').bind(now - 2 * LBS_KEEP)]);          // 쓰다 만 장소 등록 · 고치기 임시본(주소 검색어 포함)은 하루 뒤 지운다
}
async function cron(env) {
  const DB = env.DB, now = Date.now();
  await init(DB);
  await tripsCron(env, DB, now);
  try { await pruneOld(DB, now); } catch (e) { /* 정리가 알림을 막지 않는다 */ }
  try { await safetyCron(env, DB, now, (u) => fetch(u)); } catch (e) { /* 안전 점검이 일정 알림을 막지 않는다 */ }
}
/** n 개씩 한꺼번에(동시에) 처리한다 — 사람이 많아도 차례로 줄줄이 기다리지 않고, 한 번에 너무 많이 열지도 않는다. */
async function inChunks(arr, n, fn) {
  for (let i = 0; i < arr.length; i += n) await Promise.all(arr.slice(i, i + n).map(fn));
}
async function tripsCron(env, DB, now) {
  // s424: 장소가 있는 자녀를 한 명씩 돌며 읽던 것을 표 하나로 한꺼번에(자녀 수가 늘어도 DB 호출 수가 같다). 오늘 약속 시각 30분 전 ~ 2시간 안인 장소에만 '오늘 일정' 줄을 만들고, 새로 생긴 자녀만 화면을 깨운다.
  const kp = kstParts(now), ds0 = dayStart(now);
  const made = await DB.prepare("INSERT OR IGNORE INTO trips(id,cid,pl,day,st,tn) SELECT id||':'||?1, cid, id, ?1, 'due', ?2 FROM places WHERE ((days >> ?3) & 1)=1 AND (hh*60+mm)*60000 >= ?4 AND (hh*60+mm)*60000 <= ?5").bind(kp.ds, now, kp.wd, now - ds0 - STAY, now - ds0 + LEAD).run();
  if (made && made.meta && made.meta.changes > 0)          // 새로 생긴 줄(tn = 지금)이 있는 자녀의 화면만 한 번에 깨운다(자녀마다 쓰기 1번씩 하지 않고 문장 하나로)
    await DB.prepare('INSERT INTO rev(cid,n) SELECT DISTINCT cid,1 FROM trips WHERE tn=? AND day=? ON CONFLICT(cid) DO UPDATE SET n=n+1').bind(now, kp.ds).run();
  if (!saOf(env)) return;
  const rows = (await DB.prepare('SELECT t.id id,t.cid cid,t.st st,t.ta ta,t.tc tc,t.pn pn,p.name name,p.hh hh,p.mm mm FROM trips t JOIN places p ON p.id=t.pl WHERE t.day=? AND ((t.pn&1)=0 OR (t.pn&8)=0) AND (p.hh*60+p.mm)*60000 >= ? AND (p.hh*60+p.mm)*60000 <= ?').bind(kp.ds, now - ds0 - STAY, now - ds0 + LEAD).all()).results || [];
  await inChunks(rows, 20, async (r) => {
    const eta = etaOf(r, now);
    if (r.st === 'due' && !(r.pn & 1) && now >= eta - LEAD && now < eta + STAY && (await once(DB, r.id, 1)))
      await notifyChild(env, DB, r.cid, { k: 'due', title: '길동무 키즈', body: r.name + '에 가야해요', tag: 'trip' + r.id });
    if (!(r.pn & 8) && !r.tc && !r.ta && now >= eta + MISS_AFTER && now <= eta + STAY && (await once(DB, r.id, 8)))
      await notifyParents(env, DB, r.cid, (nm) => ({ k: 'miss', title: '길동무', body: who(nm) + ' ' + r.name + '에 ' + (r.st === 'go' ? '가고 있어요 · 약속 시각(' + clock(eta) + ')이 지났어요' : '도착하지 않았어요 (' + clock(eta) + ' 약속)'), tag: 'trip' + r.id }));
  });
}

let ready = false;
async function addCol(DB, table, col, ddl) {              // 옛 표에 열을 한 번만 덧붙인다
  const cols = (await DB.prepare('PRAGMA table_info(' + table + ')').all()).results || [];
  if (cols.some((c) => c.name === col)) return;
  try { await DB.prepare('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + ddl).run(); } catch (e) { /* 다른 요청이 먼저 덧붙였다 */ }
}
// s424: 서버가 새로 뜰 때마다 표 · 열 확인(약 70번)을 하던 것을 '버전 한 줄 확인'으로 바꿨다. 표 · 열을 고치면(아래 migrate) SCHEMA_V 도 올려야 새 서버가 다시 준비한다(시험이 지켜 준다).
const SCHEMA_V = 's424-1';
async function init(DB) {
  if (ready) return;
  try {
    const m = await DB.prepare("SELECT v FROM meta WHERE k='schema'").first();
    if (m && m.v === SCHEMA_V) { ready = true; return; }
  } catch (e) { /* meta 표가 아직 없다 — 아래에서 처음부터 준비 */ }
  await migrate(DB);
  try { await DB.prepare("INSERT INTO meta(k,v) VALUES('schema',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(SCHEMA_V).run(); } catch (e) { /* 다음 서버가 다시 한 번 준비한다(같은 일을 되풀이할 뿐 안전) */ }
  ready = true;
}
async function migrate(DB) {
  await DB.batch([
    DB.prepare('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, role TEXT NOT NULL, sh TEXT NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY, cid TEXT NOT NULL, exp INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS links(cid TEXT NOT NULL, pid TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY(cid, pid))'),
    DB.prepare('CREATE TABLE IF NOT EXISTS loc(cid TEXT PRIMARY KEY, la REAL NOT NULL, lo REAL NOT NULL, acc REAL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS chat(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, f TEXT NOT NULL, x TEXT NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS chat_c ON chat(cid, t)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS chat_rd(cid TEXT NOT NULL, s TEXT NOT NULL, id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(cid, s))'),      // 읽음: 각자(p 부모 · c 자녀)가 어디까지 읽었나(chat.id)
    DB.prepare('CREATE TABLE IF NOT EXISTS quests(id TEXT PRIMARY KEY, cid TEXT NOT NULL, k TEXT NOT NULL, x TEXT NOT NULL, s INTEGER NOT NULL DEFAULT 0, t INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS quests_c ON quests(cid, t)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS stars(cid TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS rev(cid TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS places(id TEXT PRIMARY KEY, cid TEXT NOT NULL, name TEXT NOT NULL, la REAL NOT NULL, lo REAL NOT NULL, hh INTEGER NOT NULL, mm INTEGER NOT NULL, days INTEGER NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS places_c ON places(cid)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY, cid TEXT NOT NULL, pl TEXT NOT NULL, day INTEGER NOT NULL, st TEXT NOT NULL, tn INTEGER NOT NULL DEFAULT 0, tk INTEGER NOT NULL DEFAULT 0, td INTEGER NOT NULL DEFAULT 0, ta INTEGER NOT NULL DEFAULT 0, tc INTEGER NOT NULL DEFAULT 0)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS trips_c ON trips(cid, day)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS cheers(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, x TEXT NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS cheers_c ON cheers(cid, id)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS links_p ON links(pid)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS evs(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, k TEXT NOT NULL, x TEXT NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS evs_c ON evs(cid, id)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS locs(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, la REAL NOT NULL, lo REAL NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS locs_c ON locs(cid, id)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS routes(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, t0 INTEGER NOT NULL, t1 INTEGER NOT NULL, m INTEGER NOT NULL, sn TEXT NOT NULL DEFAULT \'\', en TEXT NOT NULL DEFAULT \'\', pts TEXT NOT NULL)'),      // 지난 경로(s391): 자녀당 RT_KEEP 개
    DB.prepare('CREATE INDEX IF NOT EXISTS routes_c ON routes(cid, id)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS cst(cid TEXT PRIMARY KEY, sh INTEGER NOT NULL DEFAULT 1, stl INTEGER NOT NULL DEFAULT 0, lb INTEGER NOT NULL DEFAULT 0, wx TEXT NOT NULL DEFAULT \'\')'),      // 안전 알림 상태: 위치 공유(1 켬 · 0 끔) · 끊김 알림을 보냈나 · 배터리 알림 시각 · 날씨 알림을 보낸 날
    DB.prepare('CREATE TABLE IF NOT EXISTS wear(cid TEXT PRIMARY KEY, w TEXT NOT NULL, t INTEGER NOT NULL)'),      // s423: 자녀가 꾸민 길동무 친구들(입은 모자 · 옷 · 소지품 번호) — 부모 앱 홈 장면이 같은 모습으로 보인다
    DB.prepare('CREATE TABLE IF NOT EXISTS zt(k TEXT PRIMARY KEY, t INTEGER NOT NULL)'),      // 장소 도착/출발 알림을 마지막으로 보낸 시각(자녀:장소:종류 → 5분에 한 번 — 워커가 바뀌어도 유지)
    DB.prepare('CREATE TABLE IF NOT EXISTS gd(pid TEXT PRIMARY KEY, v INTEGER NOT NULL, t INTEGER NOT NULL)'),      // 법정대리인 확인 동의(부모 기기별 · 버전 · 시각) — 이 동의가 있어야 자녀 위치가 보인다
    DB.prepare('CREATE TABLE IF NOT EXISTS lbs(id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, cid TEXT NOT NULL, pid TEXT NOT NULL, k TEXT NOT NULL)'),      // 위치정보법 제16조 이용·제공사실 확인자료: 언제 · 누가 · 누구의 위치를 받았나(좌표는 없다) · 6개월 넘게 보관
    DB.prepare('CREATE INDEX IF NOT EXISTS lbs_c ON lbs(cid, pid, k, t)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, cid TEXT NOT NULL, k TEXT NOT NULL, t INTEGER NOT NULL, la REAL NOT NULL DEFAULT 0, lo REAL NOT NULL DEFAULT 0, pl TEXT NOT NULL DEFAULT \'\', st INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0)'),      // 긴급 호출(sos) · 데리러 와줘(pick) · 안전하게 도착(arr): st 0 새것 · 1 부모가 확인 · 2 자녀가 취소 · 3 끝남
    DB.prepare('CREATE INDEX IF NOT EXISTS calls_c ON calls(cid, k, t)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS cons(cid TEXT PRIMARY KEY, v INTEGER NOT NULL, t INTEGER NOT NULL)'),      // 자녀 앱에서 보호자 · 본인 동의를 마친 기록(동의 증빙)
    DB.prepare('CREATE TABLE IF NOT EXISTS stops(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, la REAL NOT NULL, lo REAL NOT NULL, t INTEGER NOT NULL, d INTEGER NOT NULL)'),      // 30분 넘게 머문 곳 기록(낯선 곳 판정용 · 30일)
    DB.prepare('CREATE INDEX IF NOT EXISTS stops_c ON stops(cid, id)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS rtst(cid TEXT PRIMARY KEY, dla REAL NOT NULL, dlo REAL NOT NULL, dt INTEGER NOT NULL, cl INTEGER NOT NULL DEFAULT 0, rte INTEGER NOT NULL DEFAULT 0, rsa REAL, rso REAL, sn TEXT NOT NULL DEFAULT \'\', en TEXT NOT NULL DEFAULT \'\')'),      // 정지 판정 상태
    DB.prepare('CREATE TABLE IF NOT EXISTS drafts(pid TEXT PRIMARY KEY, cid TEXT NOT NULL, pl TEXT NOT NULL DEFAULT \'\', la REAL NOT NULL, lo REAL NOT NULL, name TEXT NOT NULL DEFAULT \'\', hh INTEGER NOT NULL, mm INTEGER NOT NULL, days INTEGER NOT NULL, t INTEGER NOT NULL)'),
  ]);
  await addCol(DB, 'loc', 'bt', 'INTEGER NOT NULL DEFAULT -1');          // 자녀 폰 배터리 %(모르면 -1)
  await addCol(DB, 'loc', 'ch', 'INTEGER NOT NULL DEFAULT 0');           // 충전 중이면 1
  await addCol(DB, 'drafts', 'q', "TEXT NOT NULL DEFAULT ''");           // 장소 등록: 찾아 본 주소 글
  await addCol(DB, 'devices', 'rv', 'INTEGER NOT NULL DEFAULT 0');         // 부모가 지도에서 보는 지난 경로 번호(0 = 실시간) — 10분 지나면 실시간으로 돌아간다
  await addCol(DB, 'devices', 'rvt', 'INTEGER NOT NULL DEFAULT 0');
  await addCol(DB, 'devices', 'kh', 'INTEGER NOT NULL DEFAULT 0');   // 부모: 앱을 켤 때 키즈 화면으로 시작할지(1)
  await addCol(DB, 'quests', 'pt', 'INTEGER NOT NULL DEFAULT 1');
  await addCol(DB, 'quests', 'fl', 'INTEGER NOT NULL DEFAULT 0');       // 1 = 새 흐름(승낙 → 완료 → 확인) 상태 값. 0 이면 옛 값이라 한 번 옮긴다
  try {                                                                  // 옛 값 옮기기(한 번만): 자녀 미션 0 진행 → 1 · 1 자녀가 해냈다고 알림 → 2 · 2 확인 → 3 / 부모님 미션 0 진행 → 1 · 1 완료 → 3
    await DB.prepare("UPDATE quests SET s=CASE WHEN k='p' THEN (CASE s WHEN 0 THEN 1 ELSE 3 END) ELSE (CASE s WHEN 0 THEN 1 WHEN 1 THEN 2 ELSE 3 END) END, fl=1 WHERE fl=0").run();
  } catch (e) { /* 다음에 다시 */ }
  await addCol(DB, 'devices', 'ft', "TEXT NOT NULL DEFAULT ''");          // 푸시 토큰(FCM)
  await addCol(DB, 'devices', 'fa', 'INTEGER NOT NULL DEFAULT 0');         // 토큰을 받은 시각
  await addCol(DB, 'trips', 'pn', 'INTEGER NOT NULL DEFAULT 0');           // 보낸 푸시(1 30분 전 · 2 출발 · 4 도착 · 8 미도착)
  await addCol(DB, 'links', 'nm', "TEXT NOT NULL DEFAULT ''");
  await addCol(DB, 'links', 'pnm', "TEXT NOT NULL DEFAULT ''");          // 부모가 정한 자기 이름(자녀 화면에 보인다)
  await addCol(DB, 'chat', 'pn', "TEXT NOT NULL DEFAULT ''");            // 부모 글을 쓴 부모의 이름
  await addCol(DB, 'loc', 'dn', "TEXT NOT NULL DEFAULT ''");             // 자녀가 알려 준 동네 이름
  await addCol(DB, 'loc', 'mva', 'REAL NOT NULL DEFAULT 0');             // 마지막으로 '이동 중' 줄을 남긴 자리(위도 · 경도 · 시각) — 0 이면 아직 없음
  await addCol(DB, 'loc', 'mvo', 'REAL NOT NULL DEFAULT 0');
  await addCol(DB, 'loc', 'mvt', 'INTEGER NOT NULL DEFAULT 0');
  await addCol(DB, 'loc', 'ap', "TEXT NOT NULL DEFAULT ''");             // 지금 50m 안(도착)으로 본 등록 장소(없으면 빈 글) — 80m 넘게 벗어나야 비워진다
  await addCol(DB, 'loc', 'hp', "TEXT NOT NULL DEFAULT ''");             // 지금 150m 안에 있는 등록 장소(없으면 빈 글)
  await addCol(DB, 'loc', 'pla', 'REAL');
  await addCol(DB, 'loc', 'plo', 'REAL');
  await addCol(DB, 'loc', 'plt', 'INTEGER NOT NULL DEFAULT 0');
  await addCol(DB, 'loc', 'hd', 'INTEGER NOT NULL DEFAULT -1');           // 가는 방향(도 · 북쪽 0 · 시계 방향, 모르면 -1) — 바로 앞 보고에서 6m 넘게 움직였을 때만 새로 계산
  await addCol(DB, 'loc', 'hdt', 'INTEGER NOT NULL DEFAULT 0');           // 방향을 계산한 시각
  await addCol(DB, 'loc', 'mt', 'INTEGER NOT NULL DEFAULT 0');            // 마지막으로 '움직이는 중'(연속 보고 사이 6m 넘게)이라 본 시각
  await addCol(DB, 'loc', 'ha', 'REAL NOT NULL DEFAULT 0');                // 움직임 판단 기준점(위도 · 경도 · 시각) — 이 점에서 8m 넘게 벗어나면 '움직이는 중'이고 가는 방향을 새로 계산한다
  await addCol(DB, 'loc', 'hb', 'REAL NOT NULL DEFAULT 0');
  await addCol(DB, 'loc', 'hat', 'INTEGER NOT NULL DEFAULT 0');
  await addCol(DB, 'devices', 'wt', 'INTEGER NOT NULL DEFAULT 0');        // 부모가 키즈 화면(허브)을 마지막으로 보고 있던 시각 — 실시간(보는 중) 판단
  await addCol(DB, 'devices', 'ws', 'INTEGER NOT NULL DEFAULT 0');        // 이번에 이어서 보기 시작한 시각
}

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const okId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);
const okSec = (s) => typeof s === 'string' && s.length >= 16 && s.length <= 128;
const txt = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, MAX_TXT) : '');
const rid = () => [...crypto.getRandomValues(new Uint8Array(9))].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12);
// 미션 상태(s): 0 대기(받는 쪽이 승낙하길 기다림) · 1 승낙(진행 중) · 2 완료 보고(한 쪽이 했다고 눌렀고 보낸 쪽의 확인을 기다림) · 3 종료(완료) · 4 거절
//   자녀 미션(k='c', 부모 → 자녀): 부모가 보냄 → 자녀 승낙/거절 → 자녀가 완료 → 부모가 확인(이때 자녀에게 포인트 pt 지급)
//   부모님 미션(k='p', 자녀 → 부모): 자녀가 보냄(포인트 SEND_COST 필요) → 부모 승낙(이때 자녀 포인트 SEND_COST 차감)/거절 → 부모가 완료 → 자녀가 확인
const SEND_COST = 50;
const QS_WAIT = 0, QS_ON = 1, QS_REP = 2, QS_DONE = 3, QS_NO = 4;
const pts = (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= MAX_PT ? n : 1; };
const pad2 = (n) => String(n).padStart(2, '0');

// ───────── 시각 · 거리 · 말투 ─────────
function kstParts(t) {
  const d = new Date(t + KST), y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, dd = d.getUTCDate();
  return { ds: y * 10000 + mo * 100 + dd, wd: (d.getUTCDay() + 6) % 7, h: d.getUTCHours(), mi: d.getUTCMinutes(), mo, d: dd };
}
const dayStart = (t) => Math.floor((t + KST) / DAY) * DAY - KST;
const etaOf = (pl, now) => dayStart(now) + (pl.hh * 60 + pl.mm) * 60000;
const hmTxt = (h, m) => h + '시' + (m ? ' ' + m + '분' : '');
const clock = (t) => { const p = kstParts(t); return pad2(p.h) + ':' + pad2(p.mi); };
function hav(a, b, c, d) {
  const R = 6371000, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
  const s = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const fmtDist = (m) => (m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + 'm' : (m / 1000).toFixed(1) + 'km');
// 역 주변 표시: 역 좌표표(이름,위도,경도;…) — 가장 가까운 역이 STN_NEAR_M 안일 때만 '(00역 주변 00m)' 를 붙인다
const STN_NEAR_M = 500;
const STN_TXT = '수원,37.26616,126.99982;오목천,37.24301,126.96363;인하대,37.44819,126.64983;영등포구청,37.52421,126.89502;영등포시장,37.52276,126.90514;사당,37.47656,126.98175;남태령,37.46434,126.98908;백마,37.65835,126.79440;중랑,37.59495,127.07615;상봉,37.59567,127.08571;서울숲,37.54365,127.04469;압구정로데오,37.52739,127.04055;강남구청,37.51718,127.04122;선정릉,37.51028,127.04376;가천대,37.44878,127.12668;어천,37.25008,126.90881;합정,37.54903,126.91355;오금,37.50223,127.12770;진접,37.72047,127.20317;남영,37.54060,126.97117;용산,37.52989,126.96478;노량진,37.51407,126.94167;대방,37.51339,126.92641;망우,37.59999,127.09203;신내,37.61257,127.10433;갈매,37.63414,127.11480;별내,37.64252,127.12730;퇴계원,37.64832,127.14386;사릉,37.65114,127.17684;금곡,37.63700,127.21600;굴봉산,37.83209,127.55773;동대문역사문화공원,37.56468,127.00533;오남,37.70541,127.19164;영등포,37.51576,126.90741;신도림,37.50881,126.89122;응봉,37.55043,127.03482;왕십리,37.56197,127.03726;김유정,37.81847,127.71430;남춘천,37.86407,127.72376;춘천,37.88439,127.71660;봉명,36.80158,127.13632;쌍용,36.79375,127.12136;아산,36.79219,127.10438;탕정,36.78827,127.08445;배방,36.77754,127.05275;신당,37.56617,127.01616;별내별가람,37.66783,127.11617;불암산,37.67009,127.07900;청량리,37.58015,127.04506;외대앞,37.59616,127.06357;신이문,37.60183,127.06735;온양온천,36.78042,127.00371;신창,36.76921,126.95013;선바위,37.45185,127.00216;경마공원,37.44399,127.00790;대공원,37.43572,127.00647;과천,37.43281,126.99640;야목,37.26121,126.88403;사리,37.29081,126.85717;태평,37.43984,127.12775;인천논현,37.40064,126.72249;여의도,37.52158,126.92432;마포,37.53972,126.94604;석남,37.50621,126.67621;상왕십리,37.56450,127.02887;상계,37.66058,127.07320;석계,37.61494,127.06592;광운대,37.62357,127.06181;회기,37.58960,127.05794;월계,37.63311,127.05884;정부과천청사,37.42645,126.98980;초월,37.37339,127.30000;신둔도예촌,37.31550,127.40525;여주,37.28288,127.62857;가산디지털단지,37.48038,126.88270;금천구청,37.45576,126.89434;호구포,37.40162,126.70868;녹천,37.64460,127.05141;한티,37.49621,127.05288;석수,37.43516,126.90223;관악,37.41958,126.90848;기흥,37.27566,127.11594;상갈,37.26180,127.10872;청명,37.25948,127.07895;영통,37.25152,127.07134;공덕,37.54359,126.95166;애오개,37.55359,126.95673;충정로,37.56006,126.96278;서대문,37.56581,126.96664;광화문,37.57055,126.97657;청구,37.56022,127.01378;한양대,37.55658,127.04350;노원,37.65448,127.06055;창동,37.65299,127.04675;쌍문,37.64827,127.03438;수유,37.63713,127.02473;도곡,37.49113,127.05569;구룡,37.48698,127.05950;개포동,37.48911,127.06603;대모산입구,37.49135,127.07270;수서,37.48751,127.10132;복정,37.47102,127.12675;망포,37.24579,127.05737;안양,37.40193,126.92265;매교,37.26550,127.01566;원인재,37.41236,126.68789;연수,37.41777,126.67899;송도,37.42971,126.65449;숭의,37.46089,126.63804;인천,37.47636,126.61694;회룡,37.72404,127.04732;의정부,37.73873,127.04589;가능,37.74836,127.04425;녹양,37.75942,127.04227;양주,37.77428,127.04472;덕계,37.81876,127.05668;덕정,37.84322,127.06151;보산,37.91427,127.05713;뚝섬,37.54718,127.04741;미아,37.62644,127.02615;미아사거리,37.61328,127.03008;길음,37.60409,127.02535;신길,37.51763,126.91489;곡산,37.64573,126.80188;풍산,37.67217,126.78636;일산,37.68223,126.76952;명학,37.38444,126.93558;군포,37.35373,126.94852;고색,37.24983,126.98059;신길온천,37.33821,126.76584;도농,37.60876,127.16111;남동인더스파크,37.40767,126.69561;신금호,37.55450,127.02040;마장,37.56607,127.04292;답십리,37.56683,127.05266;양정,37.59920,127.18830;덕소,37.58689,127.20883;도심,37.57963,127.22280;팔당,37.54732,127.24390;운길산,37.55466,127.31009;신원,37.52592,127.37274;서울,37.55325,126.96977;신촌,37.55515,126.93689;효창공원앞,37.53928,126.96135;서강대,37.55213,126.93539;홍대입구,37.55675,126.92364;가좌,37.56861,126.91484;디지털미디어시티,37.57700,126.89864;수색,37.58085,126.89568;한국항공대,37.60310,126.86829;강매,37.61240,126.84454;행신,37.61212,126.83406;중앙,37.31570,126.83870;장한평,37.56144,127.06460;삼각지,37.53556,126.97400;능곡,37.61874,126.82089;군자,37.55715,127.07948;아차산,37.55201,127.08961;성수,37.54463,127.05598;성신여대입구,37.59278,127.01734;한성대입구,37.58838,127.00675;혜화,37.58212,127.00176;동대문,37.57084,127.00940;충무로,37.56130,126.99547;명동,37.56106,126.98827;회현,37.55970,126.97956;숙대입구,37.54512,126.97195;주엽,37.67014,126.76123;대화,37.67588,126.74776;건대입구,37.54088,127.07110;불광,37.61092,126.92950;녹번,37.60088,126.93576;경복궁,37.57584,126.97358;종로3가,37.57255,126.99045;을지로3가,37.56630,126.99262;동대입구,37.55816,127.00527;이촌,37.52253,126.97335;서빙고,37.51961,126.98836;한남,37.52936,127.00898;옥수,37.54165,127.01730;양원,37.60660,127.10880;구리,37.60326,127.14337;서구청,37.54384,126.67679;교대,37.49306,127.01380;서초,37.49191,127.00795;방배,37.48147,126.99763;낙성대,37.47693,126.96378;서울대입구,37.48123,126.95274;봉천,37.48242,126.94190;신림,37.48422,126.92957;신대방,37.48753,126.91328;구로디지털단지,37.48501,126.90263;대림,37.49298,126.89700;문래,37.51799,126.89477;당산,37.53388,126.90201;을지로입구,37.56600,126.98257;을지로4가,37.56658,126.99813;구의,37.53686,127.08502;강변,37.53516,127.09468;잠실나루,37.52069,127.10384;잠실,37.51465,127.10427;잠실새내,37.52073,127.10374;종합운동장,37.51101,127.07364;삼성,37.50883,127.06320;선릉,37.50426,127.04817;역삼,37.50066,127.03643;강남,37.49796,127.02754;화서,37.28399,126.98958;광나루,37.54530,127.10348;천호,37.53792,127.12318;길동,37.53802,127.14008;굽은다리,37.54544,127.14284;명일,37.55132,127.14400;고덕,37.55500,127.15421;상일동,37.55671,127.16638;둔촌동,37.52779,127.13622;올림픽공원,37.51622,127.13096;방이,37.50875,127.12605;개롱,37.49810,127.13482;거여,37.49321,127.14398;마천,37.49497,127.15278;강일,37.55752,127.17602;하남검단산,37.53973,127.22343;응암,37.59859,126.91558;독바위,37.61841,126.93304;새절,37.59115,126.91361;증산,37.58399,126.90978;월드컵경기장,37.56944,126.89908;망원,37.55603,126.91013;상수,37.54770,126.92292;광흥창,37.54746,126.93197;녹사평,37.53469,126.98665;이태원,37.53448,126.99437;한강진,37.53956,127.00173;버티고개,37.54793,127.00695;대곡,37.63163,126.81103;백양리,37.83088,127.58908;성남,37.39471,127.11949;구로,37.50318,126.88204;동두천중앙,37.90182,127.05653;동두천,37.92757,127.05482;소요산,37.94861,127.06101;청산,37.99514,127.07410;전곡,38.02404,127.07191;연천,38.10048,127.07368;원흥,37.65071,126.87324;삼송,37.65310,126.89556;목동,37.52609,126.86430;오목교,37.52456,126.87505;양평,37.52561,126.88618;고려대,37.59034,127.03626;월곡,37.60192,127.04149;태릉입구,37.61732,127.07474;장암,37.70015,127.05313;도봉산,37.68913,127.04655;수락산,37.67780,127.05531;마들,37.66499,127.05770;하계,37.63636,127.06800;공릉,37.62564,127.07297;먹골,37.61064,127.07772;중화,37.60260,127.07925;면목,37.58867,127.08750;사가정,37.58091,127.08850;용마산,37.57375,127.08680;중곡,37.56588,127.08429;어린이대공원,37.54796,127.07465;자양,37.53156,127.06671;청담,37.51910,127.05185;학동,37.51426,127.03174;논현,37.51111,127.02138;남성,37.48469,126.97111;숭실대입구,37.49626,126.95365;상도,37.50279,126.94795;장승배기,37.50485,126.93903;철산,37.47616,126.86822;광명사거리,37.47927,126.85485;천왕,37.48670,126.83868;온수,37.49206,126.82329;장자호수공원,37.58722,127.13793;석촌,37.50540,127.10699;달월,37.37999,126.74543;월곶,37.39189,126.74274;소래포구,37.40096,126.73353;미사,37.56329,127.19295;하남풍산,37.55220,127.20390;하남시청,37.54172,127.20690;가락시장,37.49300,127.11828;장지,37.47861,127.12623;산성,37.45689,127.14993;남한산성입구,37.45157,127.15985;단대오거리,37.44506,127.15673;신흥,37.44095,127.14759;수진,37.43758,127.14094;모란,37.43389,127.12992;남위례,37.46284,127.13905;검단호수공원,37.60250,126.68806;신검단중앙,37.60260,126.69861;아라,37.59412,126.71301;계양,37.57177,126.73632;귤현,37.56636,126.74250;박촌,37.55353,126.74495;신포,37.46844,126.62451;여의나루,37.52714,126.93281;화랑대,37.61988,127.08411;봉화산,37.61729,127.09137;임학,37.54506,126.73864;부평구청,37.50752,126.72136;부평시장,37.49849,126.72228;동수,37.48541,126.71846;부평삼거리,37.47827,126.71049;인천시청,37.45761,126.70222;예술회관,37.44933,126.70099;인천터미널,37.44192,126.69973;문학경기장,37.43496,126.69837;신연수,37.41803,126.69385;동춘,37.40468,126.68084;동막,37.39817,126.67356;캠퍼스타운,37.38821,126.66199;테크노파크,37.38231,126.65636;지식정보단지,37.37802,126.64541;국제업무지구,37.40042,126.63011;송도달빛축제공원,37.40687,126.62605;마전,37.59776,126.66720;완정,37.59287,126.67296;독정,37.58493,126.67598;검암,37.56916,126.67354;약수,37.55409,127.01024;금호,37.54827,127.01578;진위,37.10977,127.06234;성환,36.91578,127.12701;직산,36.87092,127.14377;두정,36.83379,127.14890;천안,36.81024,127.14642;고잔,37.31682,126.82309;초지,37.32058,126.80615;안산,37.32701,126.78875;수리산,37.35030,126.92554;오이도,37.36177,126.73844;개봉,37.49470,126.85850;오류동,37.49440,126.84455;부평,37.48946,126.72458;검바위,37.56109,126.67753;아시아드경기장,37.55137,126.67708;가정,37.52481,126.67539;주안,37.46504,126.68070;제물포,37.46681,126.65717;동인천,37.47541,126.63260;구일,37.49597,126.86920;소사,37.48275,126.79506;부개,37.48848,126.74055;간석,37.46469,126.69341;도원,37.46860,126.64282;구성,37.29901,127.10566;화곡,37.54158,126.84044;행당,37.55730,127.02948;가정중앙시장,37.51751,126.67678;백운,37.48330,126.70718;동암,37.47084,126.70302;서부여성회관,37.50030,126.67588;인천가좌,37.48996,126.67528;운연,37.43953,126.75961;까치울,37.50624,126.81095;압구정,37.52617,127.02850;신사,37.51644,127.02025;중동,37.48666,126.76447;도화,37.46615,126.66846;한대앞,37.30969,126.85366;정왕,37.35182,126.74284;연신내,37.61860,126.92052;구산,37.61122,126.91725;부천종합운동장,37.50538,126.79735;춘의,37.50365,126.78707;부천시청,37.50461,126.76356;상동,37.50577,126.75308;삼산체육관,37.50643,126.74208;굴포천,37.50695,126.73148;산곡,37.50855,126.70351;개화,37.57859,126.79783;김포공항,37.56217,126.80127;공항시장,37.56373,126.81068;신방화,37.56750,126.81667;선유도,37.53778,126.89389;국회의사당,37.52810,126.91787;샛강,37.51730,126.92840;신논현,37.50444,127.02442;언주,37.50729,127.03387;삼성중앙,37.51301,127.05328;봉은사,37.51422,127.06024;삼전,37.50453,127.08721;석촌고분,37.50244,127.09661;둔촌오륜,37.51934,127.13862;중앙보훈병원,37.52881,127.14849;마곡나루,37.56582,126.82764;청라국제도시,37.55651,126.62472;운서,37.49285,126.49366;공항화물청사,37.45903,126.47743;잠원,37.51299,127.01161;고속터미널,37.50339,127.00505;신정,37.52500,126.85618;화정,37.63420,126.83260;정발산,37.65971,126.77325;원종,37.52406,126.80484;마곡,37.56218,126.82693;발산,37.56218,126.82693;우장산,37.54886,126.83633;까치산,37.53181,126.84671;금릉,37.75129,126.76540;금촌,37.76611,126.77451;파주,37.81539,126.79243;문산,37.85457,126.78753;임진강,37.88836,126.74678;운천,37.87940,126.77050;남부터미널,37.48494,127.01629;탄현,37.69411,126.76108;야당,37.71275,126.76153;운정,37.72544,126.76708;송파,37.49978,127.11212;문정,37.48593,127.12247;노들,37.51273,126.95310;흑석,37.50889,126.96361;동작,37.50357,126.98017;양재,37.48466,127.03513;매봉,37.48711,127.04691;독산,37.46599,126.88951;세류,37.24410,127.01377;병점,37.20682,127.03327;세마,37.18729,127.04328;오산대,37.16940,127.06308;오산,37.14547,127.06671;송탄,37.07538,127.05440;서정리,37.05646,127.05284;평택지제,37.01882,127.07027;평택,36.99056,127.08550;인천공항1터미널,37.44761,126.45234;인천공항2터미널,37.46866,126.43341;영종,37.51210,126.52425;광명,37.41600,126.88452;산본,37.35802,126.93297;대야미,37.32830,126.91716;반월,37.31224,126.90368;상록수,37.30284,126.86653;동묘앞,37.57227,127.01567;대치,37.49460,127.06345;당정,37.34338,126.94839;서동탄,37.19568,127.05189;석천사거리,37.45693,126.71038;모래내시장,37.45584,126.71958;만수,37.45496,126.73176;남동구청,37.44818,126.73658;인천대공원,37.44848,126.75305;역곡,37.48514,126.81162;부천,37.48407,126.78278;송내,37.48763,126.75305;창신,37.57977,127.01525;보문,37.58529,127.01938;안암,37.58626,127.02903;가재울,37.48415,126.68388;주안국가산단,37.47360,126.68110;양수,37.54600,127.32895;국수,37.51617,127.39940;아신,37.51395,127.44324;오빈,37.50606,127.47405;원덕,37.46858,127.54747;야탑,37.41132,127.12866;서현,37.38493,127.12325;수내,37.37844,127.11422;정자,37.36750,127.10849;미금,37.35058,127.10880;오리,37.33983,127.10899;이매,37.39474,127.12705;보정,37.31274,127.10822;신갈,37.28613,127.11131;학여울,37.49676,127.07054;남구로,37.48618,126.88737;양천향교,37.56833,126.84139;가양,37.56111,126.85508;증미,37.55785,126.86107;등촌,37.55111,126.86472;염창,37.54694,126.87472;신목동,37.54417,126.88306;용문,37.48240,127.59490;지평,37.47650,127.62968;매탄권선,37.25246,127.04082;수원시청,37.26194,127.03074;반포,37.50817,127.01172;평내호평,37.65323,127.24445;천마산,37.65899,127.28573;마석,37.65233,127.31171;대성리,37.68391,127.37917;청평,37.73548,127.42654;상천,37.77031,127.45420;가평,37.81452,127.51069;백석,37.64297,126.78811;마두,37.65219,126.77764;대청,37.49361,127.07953;일원,37.48389,127.08416;경찰병원,37.49575,127.12420;이대,37.55673,126.94590;아현,37.55741,126.95608;용답,37.56641,126.97786;신답,37.56147,127.05635;신설동,37.57465,127.02516;도림천,37.51476,126.88259;양천구청,37.51219,126.86519;신정네거리,37.52022,126.85285;용두,37.57401,127.03811;지축,37.64828,126.91255;구파발,37.63661,126.91883;홍제,37.58885,126.94409;무악재,37.58266,126.95013;독립문,37.57453,126.95790;안국,37.57656,126.98547;신용산,37.52919,126.96858;총신대입구,37.48526,126.98177;인덕원,37.40190,126.97672;평촌,37.39435,126.96388;범계,37.38978,126.95075;금정,37.37196,126.94341;경기광주,37.39897,127.25320;곤지암,37.35052,127.34619;이천,37.26422,127.44213;부발,37.26041,127.49030;세종대왕릉,37.29364,127.57076;방화,37.57767,126.81282;간석오거리,37.46692,126.70786;선학,37.42699,126.69887;송파나루,37.51055,127.11245;한성백제,37.51637,127.11621;청계산입구,37.44871,127.05434;강촌,37.80573,127.63405;상월곡,37.60639,127.04851;돌곶이,37.61052,127.05642;구반포,37.50139,126.98722;신반포,37.50350,126.99604;사평,37.50416,127.01522;의왕,37.32065,126.94810;성균관대,37.30034,126.97086;방학,37.66747,127.04430;도봉,37.67944,127.04552;망월사,37.71050,127.04736;내방,37.48764,126.99354;이수,37.48526,126.98177;신대방삼거리,37.49972,126.92822;보라매,37.49992,126.92011;신풍,37.50011,126.90981;월롱,37.79620,126.79257;송정,37.56141,126.81205;암사역사공원,37.55717,127.13756;암사,37.55013,127.12752;강동구청,37.53035,127.12046;몽촌토성,37.51769,127.11274;양재시민의숲,37.47096,127.03842;삼동,37.40873,127.20345;개화산,37.57246,126.80684;판교,37.39502,127.11121;김량장,37.23732,127.19861;용인중앙시장,37.23791,127.20905;고진,37.24464,127.21418;보평,37.25896,127.21848;둔전,37.26721,127.21364;전대.에버랜드,37.28534,127.21956;발곡,37.72698,127.05289;범골,37.72873,127.04372;화계,37.63428,127.01750;마포구청,37.56354,126.90333;시민공원,37.45834,126.68101;석바위시장,37.45766,126.69239;다산,37.62437,127.14980;동구릉,37.61056,127.13506;동천,37.33800,127.11600;수지구청,37.32250,127.09478;성복,37.31374,127.08058;상현,37.29809,127.06948;광교중앙,37.28845,127.05161;서울지방병무청,37.50605,126.92278;보라매공원,37.49522,126.91826;보라매병원,37.49296,126.92389;당곡,37.49004,126.92757;원당,37.65310,126.84289;강동,37.53581,127.13249;죽전,37.32470,127.10740;대흥,37.54773,126.94221;계산,37.54324,126.72844;경인교대입구,37.53827,126.72260;작전,37.53027,126.72255;갈산,37.51712,126.72157;지행,37.89236,127.05573;역촌,37.60605,126.92276;중계,37.64505,127.06408;인천대입구,37.38624,126.63935;센트럴파크,37.39283,126.63500;왕길,37.59502,126.64228;검단사거리,37.60169,126.65654;신중동,37.50308,126.77616;검단오류,37.59502,126.62801;경전철의정부,37.73730,127.04332;의정부시청,37.73925,127.03485;의정부중앙,37.74372,127.04963;동오,37.74519,127.05703;새말,37.74890,127.06387;경기도청북부청사,37.75073,127.07148;효자,37.75399,127.07731;곤제,37.75054,127.08387;어룡,37.74272,127.08521;송산,37.73717,127.08728;탑석,37.73355,127.08891;북한산우이,37.66284,127.01272;솔밭공원,37.65607,127.01326;4.19민주묘지,37.64954,127.01371;가오리,37.64162,127.01681;삼양,37.62706,127.01817;삼양사거리,37.62144,127.02049;솔샘,37.62037,127.01357;북한산보국문,37.61233,127.00816;정릉,37.60278,127.01345;서원,37.47827,126.93323;서울대벤처타운,37.47204,126.93398;관악산,37.46917,126.94495;강남대,37.27017,127.12607;지석,37.26974,127.13633;어정,37.27495,127.14375;동백,37.26930,127.15200;초당,37.26081,127.15947;삼가,37.24206,127.16818;시청.용인대,37.23915,127.17841;명지대,37.23808,127.19029;광교,37.30174,127.04486;소새울,37.46851,126.79723;시흥대야,37.45048,126.79314;신천,37.43912,126.78683;신현,37.40914,126.78788;시흥시청,37.38141,126.80595;시흥능곡,37.36999,126.80859;달미,37.34900,126.80932;선부,37.33459,126.81000;시우,37.31310,126.79550;원시,37.30265,126.78679;양촌,37.64164,126.61469;구래,37.64535,126.62850;마산,37.64061,126.64394;장기,37.64403,126.66900;운양,37.65386,126.68383;걸포북변,37.63164,126.70575;사우,37.62036,126.71972;풍무,37.61233,126.73258;고촌,37.59850,126.77150;운정중앙,37.72544,126.76708;킨텍스,37.66532,126.74843;동탄,37.20034,127.09569;시청,37.56353,126.97527;종각,37.57020,126.98312;종로5가,37.57097,127.00190;제기동,37.57812,127.03490;흥선,37.74323,127.03718;다대포해수욕장,35.04867,128.96410;다대포항,35.05782,128.97130;낫개,35.06526,128.97987;신장림,35.07443,128.97704;장림,35.08109,128.97750;동매,35.08990,128.97420;신평,35.09518,128.96056;하단,35.10618,128.96680;당리,35.10353,128.97385;사하,35.09985,128.98310;괴정,35.09982,128.99214;대티,35.10313,128.99994;서대신,35.11094,129.01218;동대신,35.11045,129.01768;토성,35.10073,129.01978;자갈치,35.09737,129.02667;남포,35.09795,129.03487;부산,35.11522,129.03970;초량,35.12117,129.04304;부산진,35.12779,129.04789;좌천,35.13436,129.05445;범일,35.14095,129.05935;범내골,35.14740,129.05926;서면,35.15828,129.05956;부전,35.16259,129.06295;연산,35.18617,129.08153;동래,35.20564,129.07851;명륜,35.21255,129.07966;온천장,35.22025,129.08644;부산대,35.22961,129.08936;장전,35.23809,129.08811;구서,35.24741,129.09133;두실,35.25696,129.09139;남산,35.26540,129.09250;범어사,35.27311,129.09268;노포,35.28469,129.09497;장산,35.16991,129.17699;해운대,35.16367,129.15891;벡스코,35.16884,129.13893;센텀시티,35.16883,129.13174;민락,35.16723,129.12191;수영,35.16523,129.11471;광안,35.15792,129.11317;금련산,35.14977,129.11096;남천,35.14214,129.10798;경성대·부경대,35.13759,129.10055;대연,35.13515,129.09216;못골,35.13473,129.08442;지게골,35.13557,129.07437;문현,35.13915,129.06740;국제금융센터·부산은행,35.14582,129.06676;전포,35.15310,129.06537;부암,35.15744,129.05018;가야,35.15588,129.04282;동의대,35.15399,129.03275;개금,35.15328,129.02053;냉정,35.15125,129.01226;주례,35.15051,129.00308;감전,35.15553,128.99115;사상,35.16236,128.98462;덕포,35.17375,128.98396;모덕,35.18037,128.98562;모라,35.18966,128.98865;구남,35.19680,128.99493;구명,35.20252,128.99932;덕천,35.21022,129.00567;수정,35.22336,129.00920;화명,35.23628,129.01392;율리,35.24671,129.01292;동원,35.25866,129.01239;호포,35.28041,129.01710;부산대양산캠퍼스,35.31696,129.01394;남양산,35.32536,129.01946;양산,35.33873,129.02639;망미,35.17153,129.10823;배산,35.17350,129.09550;물만골,35.17681,129.08575;거제,35.18859,129.07394;사직,35.19900,129.06500;미남,35.20550,129.06806;만덕,35.21300,129.03653;남산정,35.21334,129.02393;숙등,35.21197,129.01275;구포,35.20670,128.99637;강서구청,35.21125,128.98176;체육공원,35.21258,128.96965;대저,35.21339,128.96105;수안,35.20183,129.08381;낙민,35.20025,129.09077;충렬사,35.19986,129.09764;명장,35.20514,129.10152;서동,35.21333,129.10768;금사,35.21583,129.11515;반여농산물시장,35.21778,129.12406;석대,35.21811,129.13718;영산대,35.22578,129.14615;윗반송,35.23251,129.15402;안평,35.23736,129.17182;설화명곡,35.79862,128.48939;화원,35.80435,128.50041;진천,35.81381,128.52237;월배,35.81612,128.53012;상인,35.81886,128.53756;월촌,35.82370,128.54547;송현,35.83109,128.55176;서부정류장,35.83734,128.55707;대명,35.83929,128.56528;안지랑,35.83920,128.57400;현충로,35.84072,128.58085;영대병원,35.84425,128.58824;명덕,35.85738,128.59088;반월당,35.86389,128.59331;중앙로,35.87087,128.59389;대구,35.87638,128.59692;칠성시장,35.87616,128.60488;동대구,35.87763,128.62715;동구청,35.88448,128.63229;아양교,35.88721,128.63957;동촌,35.88604,128.65045;해안,35.88376,128.65908;방촌,35.87993,128.66977;용계,35.87626,128.68141;율하,35.86975,128.69278;신기,35.86676,128.70172;반야월,35.86595,128.71366;각산,35.86785,128.72384;안심,35.87120,128.73380;대구한의대병원,35.87171,128.75082;부호,35.90028,128.80311;하양,35.90943,128.81754;문양,35.86414,128.43700;다사,35.86495,128.45829;대실,35.85733,128.46563;강창,35.85311,128.47900;계명대,35.85146,128.49197;성서산업단지,35.85182,128.50717;이곡,35.85062,128.51577;감삼,35.85433,128.54790;두류,35.85724,128.55551;내당,35.86019,128.56459;반고개,35.86230,128.57282;청라언덕,35.86500,128.58232;경대병원,35.86310,128.60316;대구은행,35.85987,128.61398;범어,35.85910,128.62570;수성구청,35.85874,128.63595;만촌,35.85884,128.64495;담티,35.85484,128.65415;연호,35.84650,128.67185;수성알파시티,35.84272,128.67999;고산,35.84296,128.69335;신매,35.84080,128.70500;사월,35.83707,128.71517;정평,35.83407,128.72869;임당,35.83413,128.74108;영남대,35.83637,128.75297;칠곡경대병원,35.95839,128.55989;학정,35.95155,128.55919;팔거,35.94405,128.55834;칠곡운암,35.93145,128.55453;구암,35.92574,128.55034;태전,35.91962,128.54739;매천,35.91265,128.54340;매천시장,35.90443,128.54576;팔달,35.89777,128.54680;공단,35.89200,128.55360;만평,35.88989,128.56100;팔달시장,35.88883,128.56787;원대,35.88789,128.57439;북구청,35.88381,128.58145;달성공원,35.87573,128.58212;서문시장,35.86966,128.58224;건들바위,35.85538,128.59969;대봉교,35.85500,128.60637;수성시장,35.85432,128.61603;수성구민운동장,35.85241,128.62512;어린이세상,35.84517,128.62447;황금,35.83908,128.62392;수성못,35.83136,128.62322;지산,35.82515,128.63195;범물,35.82084,128.64011;용지,35.81827,128.64654;녹동,35.10703,126.93393;소태,35.12411,126.93201;학동증심사입구,35.13302,126.92838;남광주,35.13898,126.92318;문화전당,35.14661,126.92005;금남로4가,35.15098,126.91445;금남로5가,35.15366,126.91003;양동시장,35.15418,126.90109;돌고개,35.15205,126.89564;농성,35.15336,126.88397;쌍촌,35.15179,126.86952;상무,35.14678,126.84864;김대중컨벤션센터,35.14321,126.84144;공항,35.14418,126.81153;송정공원,35.14357,126.79924;광주송정,35.13753,126.79149;도산,35.13171,126.78794;평동,35.12470,126.76959;판암,36.31690,127.45826;대동,36.32953,127.44285;대전,36.33158,127.43312;중구청,36.32483,127.41963;서대전네거리,36.32242,127.41252;오룡,36.32858,127.40505;탄방,36.34544,127.38460;정부청사,36.35766,127.38105;갈마,36.35752,127.37263;월평,36.35827,127.36438;갑천,36.35458,127.35447;유성온천,36.35369,127.34152;현충원,36.35902,127.32152;노은,36.37415,127.31784;지족,36.38411,127.31950;반석,36.39213,127.31458';
let STN_LIST = null;
function nearStn(la, lo) {
  if (!STN_LIST) STN_LIST = STN_TXT.split(';').map((r) => { const q = r.split(','); return { n: q[0], la: +q[1], lo: +q[2] }; }).filter((x) => x.n && x.la && x.lo);
  let best = null, bd = 1e9;
  for (const x of STN_LIST) {
    if (Math.abs(x.la - la) > 0.01 || Math.abs(x.lo - lo) > 0.013) continue;
    const d = hav(la, lo, x.la, x.lo);
    if (d < bd) { bd = d; best = x; }
  }
  return best && bd <= STN_NEAR_M ? { n: best.n.replace(/역$/, ''), m: bd } : null;
}
const dongOf = (dn) => { const w = String(dn || '').trim().split(/\s+/); return w[w.length - 1] || ''; };
function locHead(nm, loc, now) {                                // '쭈르 위치: 대덕동 (11월03일23시12분 기준) (송도역 주변 120m)' — 역 주변이 아니면 뒤 괄호 없이
  const dong = dongOf(loc.dn), sn = nearStn(loc.la, loc.lo);
  const p = kstParts(loc.t), at = ' (' + pad2(p.mo) + '월' + pad2(p.d) + '일' + pad2(p.h) + '시' + pad2(p.mi) + '분 기준)';          // s418: 이 위치를 받은 때(한국시간)
  return nm + ' 위치: ' + (dong || '확인 중') + at + (sn ? ' (' + sn.n + '역 주변 ' + fmtDist(sn.m) + ')' : '');
}
function ga(nm) {                                              // '민지' -> '민지가' · '철수' -> '철수가' · 받침 있으면 '이가' ('00이가')
  const c = nm.charCodeAt(nm.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? nm + '이가' : nm + '가';
}
const daysTxt = (m) => { const a = []; for (let i = 0; i < 7; i++) if ((m >> i) & 1) a.push(WD[i]); return a.length === 7 ? '매일' : a.join('·'); };
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return '방금';
  if (s < 3600) return Math.round(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}

const AUTH_MAX = 20000;
const authOk = new Map();                                   // 방금 확인한 기기는 5분 동안 다시 읽지 않는다(요청마다 표 읽기 · 해시를 아낀다)
async function auth(req, DB, role) {
  const id = req.headers.get('x-id'), sec = req.headers.get('x-sec');
  if (!okId(id) || !okSec(sec)) return null;
  const ck = role + id + sec, hit = authOk.get(ck);
  if (hit && hit > Date.now()) return id;
  const r = await DB.prepare('SELECT sh FROM devices WHERE id=? AND role=?').bind(id, role).first();
  if (!r) return null;
  if (r.sh !== (await sha(sec))) return null;
  if (authOk.size >= AUTH_MAX) { let n = AUTH_MAX >> 3; for (const k of authOk.keys()) { authOk.delete(k); if (--n <= 0) break; } }          // s424: 가득 차면 전부 지우지 않고 오래된 것 1/8 만(전부 지우면 한꺼번에 다시 읽느라 몰린다)
  authOk.set(ck, Date.now() + 300000);
  return id;
}

async function linkedCount(DB, cid) {
  const r = await DB.prepare('SELECT COUNT(*) n FROM links WHERE cid=?').bind(cid).first();
  return r ? r.n : 0;
}
async function isLinked(DB, cid, pid) {
  return !!(await DB.prepare('SELECT 1 x FROM links WHERE cid=? AND pid=?').bind(cid, pid).first());
}
async function starsOf(DB, cid) {
  const r = await DB.prepare('SELECT n FROM stars WHERE cid=?').bind(cid).first();
  return r ? r.n : 0;
}
/** 길동무포인트를 n 만큼 덜어 낸다(모자라면 false · 0 아래로 내려가지 않는다) */
async function takeStars(DB, cid, n) {
  const r = await DB.prepare('UPDATE stars SET n=n-? WHERE cid=? AND n>=?').bind(n, cid, n).run();
  return !!(r && r.meta && r.meta.changes > 0);
}
async function addStars(DB, cid, n) {
  await DB.prepare('INSERT INTO stars(cid,n) VALUES(?,?) ON CONFLICT(cid) DO UPDATE SET n=n+excluded.n').bind(cid, n).run();
}
/** s422: 등록한 장소에 도착하면 그 장소 · 그날(한국시간) 첫 도착에 한해 길동무포인트 ARRIVE_PT. 시각 규칙이 없는 장소(요일을 안 고른 장소)나 '출발'을 안 눌렀어도 받고, 같은 곳을 하루에 여러 번 오가도 한 번만(포인트 불리기 방지). 받았으면 true. */
async function arrivePay(DB, cid, plId, now) {
  const r = await DB.prepare('INSERT OR IGNORE INTO zt(k,t) VALUES(?,?)').bind('pt:' + cid + ':' + plId + ':' + kstParts(now).ds, now).run();
  if (!(r && r.meta && r.meta.changes > 0)) return false;
  await addStars(DB, cid, ARRIVE_PT);
  return true;
}

// ───────── 실시간: 바뀔 때마다 rev 를 올리고, 기다리는 쪽은 바뀌는 즉시 깨어난다 ─────────
const waiters = new Map();                                  // 같은 서버 안에서 기다리는 쪽(바뀌면 0.6초를 기다리지 않고 곧바로 깨운다)
function wakeAll(cid) { const w = waiters.get(cid); if (w) { waiters.delete(cid); for (const f of w) f(); } }
function sleepOrWake(cid, ms) {
  return new Promise((res) => {
    let w = waiters.get(cid); if (!w) { w = new Set(); waiters.set(cid, w); }
    const done = () => { clearTimeout(tm); w.delete(done); if (!w.size) waiters.delete(cid); res(); };
    const tm = setTimeout(done, ms); w.add(done);
  });
}
// s425: 허브(Durable Object, 선택)가 연결돼 있으면 바뀐 rev 를 알려 기다리는 쪽을 서버가 달라도 곧바로 깨운다. 없으면 이전과 똑같다.
// s426: WebSocket 초인종 스위치 — 워커 변수 WS_MODE: 없음/off = 꺼짐(기본, 예전 그대로) · canary = WS_CANARY(쉼표로 자녀 아이디)만 · all = 모두. 허브(FAM)가 연결돼 있어야 한다.
const wsOn = (env, cid) => { const md = env && env.WS_MODE; if (!md || !env.FAM) return false; if (md === 'all') return true; return md === 'canary' && String(env.WS_CANARY || '').split(',').some((x) => x.trim() === cid); };
const famHub = (cid) => { const e = ENVG; return e && e.FAM && e.FAM.idFromName ? e.FAM.get(e.FAM.idFromName(cid)) : null; };
async function bump(DB, cid) {
  const hub = famHub(cid);
  if (!hub) { await DB.prepare('INSERT INTO rev(cid,n) VALUES(?,1) ON CONFLICT(cid) DO UPDATE SET n=n+1').bind(cid).run(); wakeAll(cid); return; }
  const r = await DB.prepare('INSERT INTO rev(cid,n) VALUES(?,1) ON CONFLICT(cid) DO UPDATE SET n=n+1 RETURNING n').bind(cid).first();
  wakeAll(cid);
  later(hub.fetch('https://hub/bump?rev=' + (r ? r.n : 0)));
}
/** 읽음(카톡의 '1'): 부모(p)·자녀(c)가 대화방을 실제로 보는 동안 가장 최근 글(chat.id)까지 읽은 것으로 적는다. 바뀌었을 때만 true(그리고 화면 갱신 신호). */
async function rdMap(DB, cid) {
  const o = { p: 0, c: 0 };
  ((await DB.prepare('SELECT s,id FROM chat_rd WHERE cid=?').bind(cid).all()).results || []).forEach((r) => { if (r.s === 'p' || r.s === 'c') o[r.s] = r.id; });
  return o;
}
async function markRd(DB, cid, side) {
  const m = await DB.prepare('SELECT MAX(id) m FROM chat WHERE cid=?').bind(cid).first();
  const mx = (m && m.m) || 0;
  if (!mx) return false;
  const r = await DB.prepare('INSERT INTO chat_rd(cid,s,id) VALUES(?,?,?) ON CONFLICT(cid,s) DO UPDATE SET id=excluded.id WHERE chat_rd.id<excluded.id').bind(cid, side, mx).run();
  const ch = !!(r && r.meta && r.meta.changes > 0);
  if (ch) await bump(DB, cid);
  return ch;
}
async function revOf(DB, cid) {
  const r = await DB.prepare('SELECT n FROM rev WHERE cid=?').bind(cid).first();
  return r ? r.n : 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** since 와 다른 rev 가 될 때까지(최대 WAIT_MS) 0.6초마다 본다. 기다리는 동안 시각이 되어 생기는 일(알림)도 가끔 챙긴다. */
async function waitRev(DB, cid, since, now0) {
  const end = Date.now() + WAIT_MS;
  let n = await revOf(DB, cid), i = 0;
  const hub = n === since ? famHub(cid) : null;
  if (hub) {                                                // s425: 허브에서 기다린다 — 기다리는 동안 DB 읽기 없음(5초에 한 번 안전 확인), 바뀌면 서버가 달라도 곧바로 깨어난다
    let bad = 0;
    while (n === since && Date.now() < end) {
      const slice = Math.min(HUB_SLICE, end - Date.now());
      let woke = false;
      try { const r = await hub.fetch('https://hub/wait?rev=' + n + '&ms=' + slice); const j = await r.json(); woke = !!(j && j.woke); bad = 0; }
      catch (e) { bad++; await sleepOrWake(cid, WAIT_STEP); }                          // 허브가 응답하지 않으면 그 사이는 예전처럼
      if (bad >= 3) break;                                  // 허브가 계속 안 되면 아래 예전 방식으로
      n = await revOf(DB, cid);
      if (n === since && woke) await sleepOrWake(cid, WAIT_STEP);       // 허브는 바뀌었다는데 DB 값은 그대로(허브 값이 어긋남) — 빙빙 돌지 않게 잠깐 쉰다
      await tripsSync(DB, cid, Date.now());
    }
    if (n !== since || bad < 3) return n;
  }
  while (n === since && Date.now() < end) {
    await sleepOrWake(cid, WAIT_STEP);
    i++;
    if (i % 5 === 0) await tripsSync(DB, cid, Date.now());
    n = await revOf(DB, cid);
  }
  return n;
}

const prunedAt = new Map();
async function prune(DB, cid, now) {
  if (now - (prunedAt.get(cid) || 0) < 600000) return;           // 10분에 한 번만 청소
  prunedAt.set(cid, now);
  await DB.batch([
    DB.prepare('DELETE FROM chat WHERE cid=? AND t<?').bind(cid, now - CHAT_KEEP),
    DB.prepare('DELETE FROM chat WHERE cid=? AND id NOT IN (SELECT id FROM chat WHERE cid=? ORDER BY id DESC LIMIT ?)').bind(cid, cid, MAX_CHAT),
    DB.prepare('DELETE FROM quests WHERE cid=? AND id NOT IN (SELECT id FROM quests WHERE cid=? ORDER BY t DESC LIMIT ?)').bind(cid, cid, MAX_QUEST),
    DB.prepare('DELETE FROM evs WHERE cid=? AND (t<? OR id NOT IN (SELECT id FROM evs WHERE cid=? ORDER BY id DESC LIMIT ?))').bind(cid, now - EV_KEEP, cid, MAX_EV),
    DB.prepare('DELETE FROM locs WHERE cid=? AND (t<? OR id NOT IN (SELECT id FROM locs WHERE cid=? ORDER BY id DESC LIMIT ?))').bind(cid, now - TRAIL_KEEP, cid, MAX_TRAIL),
    DB.prepare('DELETE FROM codes WHERE exp<?').bind(now),
    DB.prepare('DELETE FROM trips WHERE cid=? AND day<?').bind(cid, kstParts(now - 30 * DAY).ds),
  ]);
}

// ───────── 장소 일정: 시각이 되면 오늘의 이동(trip)을 만든다 ─────────
const plCache = new Map();                                  // 장소가 있는 자녀인지 잠깐 기억(없으면 기다리는 동안 장소 표를 읽지 않는다)
async function tripsSync(DB, cid, now) {            // s424: 읽은 장소 목록을 돌려준다(위치 보고가 같은 표를 또 읽지 않게 — 결과는 그대로, 호출만 1번 적게)
  const pc = plCache.get(cid);
  if (pc && now < pc.exp && !pc.has) return null;                  // 장소 없음으로 기억해 둔 자녀 — 읽지 않았다(null)
  const pls = (await DB.prepare('SELECT id,name,la,lo,hh,mm,days FROM places WHERE cid=?').bind(cid).all()).results || [];
  if (plCache.size > 20000) plCache.clear();
  plCache.set(cid, { has: pls.length > 0, exp: now + (pls.length ? 300000 : 20000) });
  if (!pls.length) return pls;
  const kp = kstParts(now), st = [];
  for (const pl of pls) {
    if (!((pl.days >> kp.wd) & 1)) continue;
    const eta = etaOf(pl, now);
    if (now < eta - LEAD || now > eta + STAY) continue;
    st.push(DB.prepare("INSERT OR IGNORE INTO trips(id,cid,pl,day,st,tn) VALUES(?,?,?,?,'due',?)").bind(pl.id + ':' + kp.ds, cid, pl.id, kp.ds, now));
  }
  if (!st.length) return pls;
  const rs = await DB.batch(st);
  if (rs.some((r) => r && r.meta && r.meta.changes > 0)) await bump(DB, cid);
  return pls;
}
async function todayTrips(DB, cid, now) {
  const kp = kstParts(now);
  return (await DB.prepare('SELECT t.id id,t.pl pl,t.st st,t.tn tn,t.tk tk,t.td td,t.ta ta,t.tc tc,p.name name,p.la la,p.lo lo,p.hh hh,p.mm mm FROM trips t JOIN places p ON p.id=t.pl WHERE t.cid=? AND t.day=?').bind(cid, kp.ds).all()).results || [];
}

/** 자녀 앱이 그리는 모든 것: 연결 수 · 길동무포인트 · 알림(prompt) · 남은 거리 알약(trip). 계산은 모두 여기서. */
async function childState(DB, cid, now) {
  await tripsSync(DB, cid, now);
  const rows = await todayTrips(DB, cid, now);
  const loc = await DB.prepare('SELECT la,lo,t FROM loc WHERE cid=?').bind(cid).first();
  const out = { linked: await linkedCount(DB, cid), stars: await starsOf(DB, cid) };
  let go = null, due = null;
  for (const r of rows) {
    const eta = dayStart(now) + (r.hh * 60 + r.mm) * 60000;
    if (r.st === 'go') { if (!go || eta < go.eta) go = { r, eta }; } else if (r.st === 'due' && now <= eta + PROMPT_AFTER) { if (!due || eta < due.eta) due = { r, eta }; }
  }
  if (go) {
    const r = go.r;
    let m = null, fresh = false;
    if (loc) { m = hav(loc.la, loc.lo, r.la, r.lo); fresh = now - loc.t <= LOC_FRESH; }
    out.trip = { id: r.id, name: r.name, near: m != null && m <= ARR_M && fresh, dist: m == null ? '' : fmtDist(m), text: m == null ? r.name + '까지 위치를 확인하는 중이에요' : r.name + '까지 ' + fmtDist(m), hint: m != null && m <= ARR_M && fresh ? '도착했어요! 확인을 눌러요' : '도착하면 확인을 눌러요' };
  }
  const cl = await DB.prepare("SELECT k,st FROM calls WHERE cid=? AND k IN ('sos','pick') AND st IN (0,1) AND t>? ORDER BY t DESC LIMIT 1").bind(cid, now - CALL_OPEN_MS).first();
  if (cl) out.call = { k: cl.k, st: cl.st, text: cl.st === 1 ? callAck(cl.k) : '부모님께 알렸어요' };
  out.cheers = ((await DB.prepare('SELECT x FROM cheers WHERE cid=? ORDER BY id LIMIT ?').bind(cid, MAX_CHEER).all()).results || []).map((r) => r.x);
  if (due) out.prompt = { id: due.r.id, name: due.r.name, text: hmTxt(due.r.hh, due.r.mm) + '까지 ' + due.r.name + '에 가야해요!' };
  return out;
}

// ───────── 화면 (앱은 그리기만 한다) ─────────
const b = (t, o) => Object.assign({ t }, o || {});
const item = (label, act, on) => b('i', { label, act, on });
function kst(t) {
  const d = new Date(t + KST), h = d.getUTCHours();
  return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + ' ' + (h < 12 ? '오전' : '오후') + ' ' + (h % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

async function chatScreen(DB, cid, now) {
  const rows = (await DB.prepare('SELECT id,f,x,t,pn FROM chat WHERE cid=? AND t>=? ORDER BY id ASC LIMIT ?').bind(cid, now - CHAT_KEEP, MAX_CHAT).all()).results || [];
  const rd = await rdMap(DB, cid);
  const a = [b('head', { text: '가족대화' })];
  const k1 = [b('text', { text: '글자만 보낼 수 있어요. 대화는 7일이 지나면 지워져요.', sub: '1', tight: '1' })];
  if (!rows.length) k1.push(b('text', { text: '아직 대화가 없어요. 부모님이 연결되면 여기서 이야기할 수 있어요.', sub: '1', tight: '1' }));
  a.push(b('box', { flush: '1', kids: k1 }));
  const k2 = rows.map((m) => b('msg', Object.assign({ text: m.x, me: m.f === 'c' ? '1' : '0', time: (m.f === 'p' && m.pn ? m.pn + ' · ' : '') + kst(m.t) }, m.f === 'c' && m.id > rd.p ? { un: '1' } : {})));      // 내 글을 부모가 아직 안 읽었으면 un
  k2.push(b('input', { hint: '메시지를 입력해요', act: 'chat.send' }));
  a.push(b('box', { fill: '1', flush: '1', kids: k2 }));
  return { mode: 'scroll', bottom: '1', blocks: a };
}

// 퀘스트 화면: 위(제목 · 길동무포인트 · 칸 두 개)는 그대로 있고, 칸 아래 목록만 좌우로 밀려 돈다(앱이 칸 아래를 한 덩어리로 민다).
async function questScreen(DB, cid, tab) {
  const rows = (await DB.prepare('SELECT id,k,x,s,pt FROM quests WHERE cid=? ORDER BY t DESC LIMIT ?').bind(cid, MAX_QUEST).all()).results || [];
  const star = await starsOf(DB, cid);
  const kid = tab !== 'p';
  const nc = rows.filter((q) => q.k !== 'p').length, np = rows.length - nc;
  const act = rows.filter((q) => (q.k !== 'p' ? q.s === QS_WAIT || q.s === QS_ON : q.s === QS_REP)).length;          // 내가 눌러야 하는 것
  const pend = rows.filter((q) => q.k === 'p' && q.s === QS_WAIT).length;
  const a = [b('head', { text: '퀘스트' })];
  a.push(b('stars', { n: star, label: '길동무포인트', sub: act > 0 ? '내가 할 일 ' + act + '개' : '' }));
  a.push(b('chips', { eq: '1', loop: '1', items: [item('자녀 미션 ' + nc, 'quest.tab:c', kid ? '1' : '0'), item('부모님 미션 ' + np, 'quest.tab:p', kid ? '0' : '1')] }));
  a.push(b('text', { text: kid ? '부모님이 보내 주신 미션이에요. 승낙하고 해낸 뒤 완료를 누르면 부모님이 확인하고, 그러면 길동무포인트가 올라가요.' : '내가 부모님께 보내는 미션이에요(한 번에 길동무포인트 ' + SEND_COST + '). 부모님이 승낙하면 ' + SEND_COST + '이 차감되고, 부모님이 완료하면 내가 확인해요.', sub: '1' }));
  if (!kid) a.push(b('input', { hint: '부모님께 보낼 미션을 적어요 (포인트 ' + SEND_COST + ')', act: 'quest.send' }));
  let shown = 0;
  for (const q of rows) {
    if ((q.k === 'p') === kid) continue;
    const p = q.pt || 1;
    let st, tone = '0', btns = null;
    if (kid) {
      if (q.s === QS_WAIT) { st = '새 미션이에요 · 해내면 포인트 +' + p; tone = '1'; btns = [item('승낙', 'quest.accept:' + q.id, '1'), item('거절', 'quest.reject:' + q.id, '0')]; }
      else if (q.s === QS_ON) { st = '진행 중 · 다 했으면 완료를 눌러요 (포인트 +' + p + ')'; tone = '1'; btns = [item('완료', 'quest.fin:' + q.id, '1')]; }
      else if (q.s === QS_REP) { st = '완료했어요 · 부모님 확인을 기다려요'; tone = '1'; }
      else if (q.s === QS_DONE) st = '완료! 포인트 +' + p + ' 받았어요';
      else st = '거절한 미션이에요';
    } else {
      if (q.s === QS_WAIT) { st = '대기 중 · 부모님이 승낙하면 포인트 -' + (q.pt || SEND_COST) + ' 차감돼요'; tone = '1'; }
      else if (q.s === QS_ON) { st = '승낙! 포인트 -' + (q.pt || SEND_COST) + ' · 부모님이 하는 중이에요'; tone = '1'; }
      else if (q.s === QS_REP) { st = '부모님이 완료했어요 · 확인해 주세요'; tone = '1'; btns = [item('확인', 'quest.confirm:' + q.id, '1')]; }
      else if (q.s === QS_DONE) st = '완료했어요';
      else st = '부모님이 거절했어요';
    }
    a.push(b('card', { title: q.x, text: st, thumb: '', act: '', tone }));
    if (btns) a.push(b('btns', { items: btns }));
    shown++;
  }
  if (!shown) a.push(b('card', { title: kid ? '아직 받은 미션이 없어요' : '아직 보낸 미션이 없어요', text: kid ? '부모님이 길동무 앱에서 미션을 보내면 여기에 나타나요' : '위 칸에 적어서 부모님께 보내 보세요', thumb: '', act: '' }));
  return { mode: 'scroll', blocks: a };
}

async function screenOf(DB, cid, tab, qt, now) {
  if (tab === 'chat') return chatScreen(DB, cid, now);
  if (tab === 'quest') return questScreen(DB, cid, qt);
  return null;
}
/** 자녀 앱이 한 번에 받는 묶음: 상태 + (보는 탭의) 화면들 + rev */
async function childBundle(DB, cid, tab, qt, now, rev) {
  const o = Object.assign({ ok: true, rev }, await childState(DB, cid, now));
  if (tab === 'quest') o.screens = { c: await questScreen(DB, cid, 'c'), p: await questScreen(DB, cid, 'p') };
  else if (tab === 'chat') o.screen = await chatScreen(DB, cid, now);
  return o;
}

// ───────── 부모(길동무 앱) 화면: 길동무와 같은 화면 규격(ScreenCore v1) ─────────
function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function scr(id, head, body, extra) {
  const o = Object.assign({ ok: true, v: 1, screen: id, cover: 'tab', head, body }, extra || {});
  o.rev = hashStr(JSON.stringify([head, body, o.foot || 0]));
  return o;
}
const call = (v, id, t) => { const a = { a: 'call', v }; if (id) a.id = id; if (t) a.t = t; return a; };
const tx = (s, o) => Object.assign({ t: 'text', s, size: 13, color: 'text', pad: [0, 0, 0, 0] }, o || {});
const panel = (kids, o) => Object.assign({ t: 'panel', pad: [14, 10, 14, 0], ip: [14, 12, 14, 12], fill: 'card', line: 'border', r: 14, kids }, o || {});
const btn = (s, act, o) => Object.assign({ t: 'button', s, act, h: 40, size: 13, bold: true, r: 10 }, o || {});
const gold = { fill: 'gold', tc: '#121214', line: 'gold' };
const dlg = () => ({ w: 460, maxh: 0.9, dim: 0.5, top: 0.5, r: 18, mx: 14, fit: false });      // 모든 팝업이 같은 넓은 폭(내용에 맞춰 줄지 않는다)

async function childrenOf(DB, pid) {
  return (await DB.prepare('SELECT l.cid cid, l.nm nm, COALESCE(s.n,0) stars FROM links l LEFT JOIN stars s ON s.cid=l.cid WHERE l.pid=? ORDER BY l.t ASC').bind(pid).all()).results || [];
}
const nmOf = (c) => (c && c.nm ? c.nm : '자녀');

/** 지도 아래 알림 글: 지금 시각의 일정마다 '도착했어요 / 가고 있어요 / 도착하지 않았어요 / 곧 가야 해요' 를 엔진이 정한다 */
function alertLines(nm, pls, trips, loc, now) {
  const out = [];
  const kp = kstParts(now), who = ga(nm);
  const act = [];
  for (const pl of pls) {
    if (!((pl.days >> kp.wd) & 1)) continue;
    const eta = etaOf(pl, now);
    if (now < eta - LEAD || now > eta + STAY) continue;
    act.push({ pl, eta, tr: trips.find((t) => t.pl === pl.id) });
  }
  act.sort((x, y) => x.eta - y.eta);
  for (const a of act) {
    const { pl, eta, tr } = a, hmS = clock(eta);
    const d = loc ? hav(loc.la, loc.lo, pl.la, pl.lo) : null;
    const dp = loc && loc.pla != null && loc.plt ? hav(loc.pla, loc.plo, pl.la, pl.lo) : null;
    if (tr && tr.tc) out.push({ tone: 'ok', s: who + ' ' + pl.name + '에 도착했어요 · ' + clock(tr.tc) + ' (포인트 +' + ARRIVE_PT + ')' });
    else if (d != null && d <= HERE_M) out.push({ tone: 'ok', s: who + ' ' + pl.name + '에 와 있어요 · ' + (tr && tr.ta ? clock(tr.ta) + ' 도착' : '지금') });
    else if (now >= eta) {
      const closer = d != null && dp != null && d < dp - 15;
      if ((tr && tr.st === 'go') || closer) out.push({ tone: 'go', s: who + ' ' + pl.name + '에 가고 있어요' + (d != null ? ' · 남은 ' + fmtDist(d) : '') });
      else out.push({ tone: 'warn', s: who + ' ' + pl.name + '에 도착하지 않았어요 (' + hmS + ' 약속)' });
    } else if (tr && tr.st === 'go') out.push({ tone: 'go', s: who + ' ' + pl.name + '로 출발했어요' + (d != null ? ' · 남은 ' + fmtDist(d) : '') });
    else out.push({ tone: 'info', s: hmS + '까지 ' + pl.name + ' — ' + (tr && tr.st === 'seen' ? '알림을 확인했어요' : '자녀에게 알림을 보냈어요') });
  }
  return out;
}

const HUB_CARD_H = 46;                                              // 허브 위에 얹히는 긴급 호출 · 데리러 와줘 카드 한 장의 높이(dp, 어림) — 지도를 이만큼 줄인다
const EV_SHOW = 50, EV_VIS = 4, HUB_CHAT = 40, CHAT_BOX = 230;     // 허브 아래 3칸은 글 수와 상관없이 크기 고정: 활동 칸 = 상태 2줄 + 활동 EV_VIS 줄 · 퀘스트 칸 = 단추·길동무포인트·바로가기 · 대화 칸 = 글 영역 CHAT_BOX(dp). 넘치는 글은 칸 안에서만 위아래로 민다                    
const KIDS_TAB = { label: '키즈', icon: 'M12 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM6.8 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17.2 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 12.5c-3.9 0-7 2-7 4.5V22h14v-5c0-2.5-3.1-4.5-7-4.5z' };      // 키즈 모드의 아래 탭(홈 칸을 바꿔 그린다): 어린이 모양 + 글자 — 앱은 이대로 그린다
const evWhen = (t, now) => { if (kstParts(t).ds === kstParts(now).ds) return clock(t); const d = new Date(t + KST); return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + ' ' + clock(t); };
/** 활동 한 줄의 글(종류 k · x 는 장소 · 동네 · 친구 이름). 자녀 이름 nm 은 부모가 정한 이름 */
function eul(w) { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? w + '을' : w + '를'; }
function evText(e, nm) {
  const x = e.x;
  switch (e.k) {
    case 'loc': return '현재 위치 · ' + x;
    case 'mv': return '이동 중 · ' + x;
    case 'at': return x + ' 근처에 왔어요';
    case 'lv': return x + '에서 멀어졌어요';
    case 'in': return x + '에 도착했어요';
    case 'odd': return '평소와 다른 곳에 머물러요 · ' + x;
    case 'go': return x + '로 출발했어요';
    case 'done': return x + '에 도착했어요 (포인트 +' + ARRIVE_PT + ')';
    case 'feed': return ga(nm) + ' ' + x + '에게 밥을 줬어요';
    case 'clean': return ga(nm) + ' ' + x + '의 응가를 치워 줬어요';
    case 'drop': return ga(nm) + ' ' + eul(x) + ' 공중에서 떨어뜨렸어요';
    case 'dress': return ga(nm) + ' ' + eul(x) + ' 꾸며 줬어요';
    case 'psleep': return ga(nm) + ' ' + eul(x) + ' 재웠어요';
    case 'pstudy': return ga(nm) + ' ' + x + '에게 공부를 시켰어요';
    case 'pplay': return ga(nm) + ' ' + eul(x) + ' 놀게 했어요';
    case 'sos': return ga(nm) + ' 긴급 호출을 했어요' + (x ? ' · ' + x + ' 근처' : '');
    case 'pick': return ga(nm) + ' 데리러 와 달라고 했어요' + (x ? ' · ' + x + ' 근처' : '');
    case 'arr': return ga(nm) + ' 안전하게 도착했다고 알렸어요' + (x ? ' · ' + x : '');
    default: return x;
  }
}
/** 길동무 확인 화면(홈 버튼을 3초 누르면 오른쪽에서 밀려 들어오는 화면) */
async function hubScreen(DB, pid, cid, now) {
  const kids = await childrenOf(DB, pid);
  const cur = kids.find((k) => k.cid === cid) || kids[0];
  if (!cur) return scr('kids', [], [b('text', { t: 'text' })].slice(0, 0).concat([tx('연결된 자녀가 없어요', { size: 15, bold: true, pad: [16, 24, 16, 6] }), tx('길동무 키즈의 시크릿 키나 QR 로 연결해 주세요', { color: 'sub', pad: [16, 0, 16, 0] })]));
  cid = cur.cid;
  const nm = nmOf(cur);
  // s421: 서로 기대지 않는 조회는 한꺼번에 묻는다(예전엔 16번을 줄줄이 기다려 지난 경로를 고를 때마다 1~2초가 걸렸다). 법정대리인 확인이 안 된 사람에게는 읽은 값을 쓰지 않고 돌려보낸다.
  const ALL = (q) => q.all().then((r) => (r && r.results) || []);
  const [gok, loc, wch, cs0, pls, calls, trailRows, rts, vs, qs, msgs0, rd, sync0] = await Promise.all([
    gdOk(DB, pid),
    DB.prepare('SELECT la,lo,acc,t,pla,plo,plt,dn,bt,ch,hd,hdt,mt FROM loc WHERE cid=?').bind(cid).first(),
    watchOf(DB, cid, now),
    DB.prepare('SELECT sh FROM cst WHERE cid=?').bind(cid).first(),
    ALL(DB.prepare('SELECT id,name,la,lo,hh,mm,days FROM places WHERE cid=? ORDER BY hh,mm LIMIT ?').bind(cid, MAX_PLACES)),
    ALL(DB.prepare("SELECT id,k,t,la,lo,pl,st FROM calls WHERE cid=? AND k IN ('sos','pick') AND st IN (0,1) AND t>? ORDER BY t DESC LIMIT 2").bind(cid, now - CALL_OPEN_MS)),
    ALL(DB.prepare('SELECT la,lo FROM locs WHERE cid=? AND t>=? ORDER BY id ASC LIMIT 1500').bind(cid, now - TRAIL_MS)),
    ALL(DB.prepare('SELECT id,t0,t1,m,sn,en FROM routes WHERE cid=? ORDER BY id DESC LIMIT ?').bind(cid, RT_KEEP)),
    DB.prepare('SELECT rv,rvt FROM devices WHERE id=?').bind(pid).first(),
    ALL(DB.prepare('SELECT k,s FROM quests WHERE cid=?').bind(cid)),
    ALL(DB.prepare('SELECT id,f,x,t FROM chat WHERE cid=? AND t>=? ORDER BY id DESC LIMIT ?').bind(cid, now - CHAT_KEEP, HUB_CHAT)),
    rdMap(DB, cid),
    tripsSync(DB, cid, now).then(() => Promise.all([todayTrips(DB, cid, now), ALL(DB.prepare('SELECT k,x,t FROM evs WHERE cid=? AND t>=? AND k NOT IN ' + EV_HIDE + ' ORDER BY id DESC LIMIT ?').bind(cid, now - EV_KEEP, EV_SHOW + 1))])),
  ]);
  if (!gok) return gdScreen(nm);                                   // 법정대리인 확인 전에는 자녀 위치를 보여 주지 않는다
  const watching = !!wch;
  const cs = cs0 || { sh: 1 };
  const trips = sync0[0], evr = sync0[1];
  const pins = [];
  const heading = loc && watching && loc.hd >= 0 && now - loc.mt < MOVE_REC_MS && now - loc.hdt < 90000 ? loc.hd : -1;       // 움직이는 중일 때만 가는 방향(앱은 화살표만 돌린다)
  if (loc) pins.push({ la: loc.la, lo: loc.lo, k: 'm', l: nm, g: 'kid.' + markerKey(cid), ...(heading >= 0 ? { h: heading } : {}) });
  pls.slice(0, 9).forEach((p, i) => pins.push({ la: p.la, lo: p.lo, k: 's', n: String(i + 1), l: p.name, v: 'kp.' + p.id }));
  let cpin = -1;                                                                  // 긴급 호출 · 데리러 와줘 가 있으면 그 자리를 지도에 찍고 거기로 맞춘다
  for (const c of calls) if ((c.la || c.lo) && cpin < 0) { cpin = pins.length; pins.push({ la: c.la, lo: c.lo, k: 's', n: '!', l: c.k === 'sos' ? '긴급' : '데리러' }); }
  const noLoc = !pins.length;
  if (noLoc) pins.push({ la: 37.5665, lo: 126.978, k: 's', n: '', l: '' });
  // 이동 경로: 지난 TRAIL_MS 동안 쌓인 점(최대 TRAIL_PTS 개로 솎음) + 지금 위치
  let trail = trailRows.map((r) => [+r.la.toFixed(5), +r.lo.toFixed(5)]);
  if (loc && trail.length && hav(trail[trail.length - 1][0], trail[trail.length - 1][1], loc.la, loc.lo) >= 15) trail.push([+loc.la.toFixed(5), +loc.lo.toFixed(5)]);
  if (trail.length > TRAIL_PTS) { const st2 = (trail.length - 1) / (TRAIL_PTS - 1); trail = Array.from({ length: TRAIL_PTS }, (_, i) => trail[Math.round(i * st2)]); }
  // 지난 경로 보기(s391): 부모가 고른 경로가 있고 10분이 안 지났으면 지도에 그 경로를(출발 · 도착 핀) 그린다 — 고르는 것도 그리는 것도 엔진, 앱은 받은 선과 핀을 그릴 뿐
  const rview = vs && vs.rv && vs.rvt > now - RT_VIEW_MS ? await DB.prepare('SELECT id,t0,t1,m,sn,en,pts FROM routes WHERE id=? AND cid=?').bind(vs.rv, cid).first() : null;
  let rpts = null;
  if (rview) { try { rpts = JSON.parse(rview.pts); } catch (e) { rpts = null; } }
  const viewing = !!(rview && rpts && rpts.length >= 2);
  if (viewing) {
    trail = rpts.slice(0, 400);
    pins.length = 0;
    pins.push({ la: rpts[0][0], lo: rpts[0][1], k: 's', n: '출', l: rview.sn || '출발' }, { la: rpts[rpts.length - 1][0], lo: rpts[rpts.length - 1][1], k: 's', n: '도', l: rview.en || '도착' });
  }
  const follow = !viewing && cpin < 0 && !!loc && !noLoc && watching && now - loc.t < 60000;                  // 실시간 따라가기(s393): 보는 중이고 위치가 방금 온 것일 때만 — 앱은 점을 부드럽게 옮기고 지도가 따라간다
  // 한 화면에 스크롤 없이(s414): 위에 카드가 얹히면 그만큼 지도를 줄여 아래 칸 크기가 그대로이게 한다 — 긴급 호출 · 데리러 와줘 카드는 가장 급한 하나만(긴급 우선, 아니면 최근)
  const topCall = calls.find((c) => c.k === 'sos') || calls[0] || null;
  const mapH = Math.max(150, 250 - (topCall ? HUB_CARD_H : 0) - (kids.length > 1 ? 44 : 0));
  const head = [
    viewing ? { t: 'lth', s: nm + ' 지난 경로', dot: '#8e8e93', live: false, pad: [16, 8, 16, 6] } : { t: 'lth', s: '자녀 위치', dot: '#111111', live: true, pad: [16, 8, 16, 6] },
    { t: 'tmap', ...(trail.length >= 2 ? { line: trail } : {}), live: 1, h: mapH, r: 14, pad: [12, 0, 12, 0], pts: pins, foc: viewing ? -1 : cpin >= 0 ? cpin : loc ? 0 : -1, ...(follow ? { fol: 1 } : {}), hint: viewing ? '지난 경로 · 아래 단추로 실시간으로 돌아가요' : noLoc ? '자녀 위치를 아직 받지 못했어요' : follow ? '실시간으로 따라가는 중 · 지도를 밀면 잠시 멈춰요' : '지도를 3초 누르면 장소를 등록해요', lp: 'kpl.new', fp: 40, fz: 16 },
  ];
  for (const c of topCall ? [topCall] : []) head.unshift(panel([          // s415: 호출 내용은 가운데 팝업으로 뜬다 — 허브에는 한 줄만 남겨 눌러서 다시 열 수 있게
    tx((c.k === 'sos' ? '🚨 ' + nm + ' 긴급 호출' : '🚗 ' + nm + ' 데리러 와 달라고 해요') + (c.st === 1 ? ' · 확인함' : '') + '  ›', { size: 13.5, bold: true, color: 'orange', lines: 1, align: 'center' }),
  ], { pad: [12, 8, 12, 0], ip: [14, 11, 14, 11], act: call('kx.open', '', c.id) }));
  const body = [];
  if (viewing) body.push(panel([
    tx(rtTitle(rview, now), { size: 13, bold: true, lines: 1 }),
    tx(rtSub(rview), { size: 11.5, color: 'sub', lines: 1, pad: [0, 3, 0, 8] }),
    { t: 'row', gap: 8, kids: [btn('실시간으로 돌아가기', call('kr.live'), { fill: 'card2', tc: 'text', line: 'border', h: 38, size: 12.5 }), btn('다른 경로 보기', call('kr.open'), { fill: 'card2', tc: 'text', line: 'border', h: 38, size: 12.5 })] },
  ], { pad: [12, 10, 12, 0] }));
  if (kids.length > 1) body.push({ t: 'chips', pad: [12, 8, 12, 0], items: kids.map((k) => ({ label: nmOf(k), on: k.cid === cid, act: call('kc.' + k.cid) })) });
  // 뭐하니?: 지금 상태 한두 줄 + 활동 기록(채팅처럼 아래로 갈수록 최근 — 지난 일은 '지난 활동 보기'로 올려 본다)
  const lines = alertLines(nm, pls, trips, loc, now);
  if (loc && cs.sh === 0) lines.unshift({ tone: 'warn', s: nm + '가 위치 공유를 껐어요 · 마지막 ' + clock(loc.t) });          // 안전 알림(s392): 위치가 안 오는 이유를 화면에서도 바로 알려 준다
  else if (loc && now - loc.t >= STALE_MS) lines.unshift({ tone: 'warn', s: '위치가 ' + ago(now - loc.t).replace(' 전', '') + ' 동안 들어오지 않아요 · 마지막 ' + clock(loc.t) });
  if (loc && loc.bt >= 0 && loc.bt <= BATT_LOW && !loc.ch && now - loc.t < 30 * 60000) lines.unshift({ tone: 'warn', s: nm + ' 폰 배터리 ' + loc.bt + '%' });
  const st = [];                                                                   // 상태 글: {s, bold, color, size} — 칸에는 정확히 2줄(한 줄씩 · 길면 … 으로 줄임), 3째 줄부터는 아래 목록 맨 위 줄로 넘긴다
  if (!loc) {
    st.push({ s: nm + '의 위치를 아직 받지 못했어요', size: 13, bold: true, color: 'text' });
    if ((locAskAt.get(cid) || 0) > now - LOC_ASK_GAP) st.push({ s: '자녀 폰에 위치를 요청했어요 · 곧 나타나요', size: 11.5, bold: false, color: 'sub' });
  }
  else if (!lines.length) st.push({ s: locHead(nm, loc, now), size: 13, bold: true, color: 'text' }, { s: pls.length ? '오늘은 도착해야 할 장소가 없어요' : '장소를 등록하면 도착 여부를 알려 드려요', size: 11.5, bold: false, color: 'sub' });
  for (const l of lines) st.push({ s: l.s, size: 13, bold: true, color: l.tone === 'warn' ? 'orange' : l.tone === 'ok' ? 'gold' : 'text' });
  const al = st.slice(0, 2).map((x, i) => tx(x.s, { size: x.size, bold: x.bold, color: x.color, lines: 1, pad: [0, i ? 4 : 0, 0, 0] }));
  while (al.length < 2) al.push(tx('\u00a0', { size: 11.5, lines: 1, pad: [0, 4, 0, 0] }));        // 항상 2줄 — 글이 적어도 칸 높이가 같다
  const evs = evr.slice(0, EV_SHOW).reverse();                                   // 아래로 갈수록 최근
  // 활동 칸: 늘 상태 2줄 + 활동 EV_VIS 줄이 보인다(글이 적으면 빈 줄로 채워 같은 높이) · 더 있으면 칸 안에서 위아래로 밀어 지난 활동을 본다(처음엔 맨 아래 = 가장 최근)
  const rows = st.slice(2).map((x) => ({ a: x.s })).concat(evs.map((e, i) => ({ a: evWhen(e.t, now) + '  ' + evText(e, nm), on: i === evs.length - 1, act: call('kd.open') })));
  if (!evs.length) rows.push({ a: '아직 활동이 없어요. 길동무 키즈가 켜져 있으면 여기에 나타나요', on: true });
  while (rows.length < EV_VIS) rows.unshift({ a: '\u00a0' });
  const fk = [{ t: 'pickl', key: 'kev' + cid, plain: true, h: 21, vis: EV_VIS, size: 12.5, pad: [0, 8, 0, 0], rows }];
  body.push({ t: 'lth', s: nm + ' 뭐하니?', dot: '#ff3b30', live: true, pad: [16, 12, 16, 0] });
  const regBtn = { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('+ 장소 등록', call('kpg.open', cid), { fill: 'card2', tc: 'text', line: 'border', h: 36, size: 12.5 }), btn('등록한 장소' + (pls.length ? ' ' + pls.length : ''), call('kps.open', cid), { fill: 'card2', tc: 'text', line: 'border', h: 36, size: 12.5 }), btn('지난 경로' + (rts.length ? ' ' + rts.length : ''), call('kr.open'), { fill: 'card2', tc: 'text', line: 'border', h: 36, size: 12.5 })] };          // 왼쪽 = 새 장소 등록 팝업 · 오른쪽 = 등록한 장소 목록 팝업(s401)
  body.push(panel(al.concat(fk, [regBtn]), { pad: [12, 1, 12, 0], fill: lines.some((l) => l.tone === 'warn') ? 'card2' : 'card' }));
  // 퀘스트(노란 점)
  const nc = qs.filter((q) => q.k === 'c').length, np = qs.length - nc, wait = qs.filter((q) => (q.k === 'c' && q.s === QS_REP) || (q.k === 'p' && (q.s === QS_WAIT || q.s === QS_ON))).length;
  body.push({ t: 'lth', s: '퀘스트', dot: '#f5b800', live: true, pad: [16, 12, 16, 0] });
  body.push(panel([
    { t: 'row', gap: 8, kids: [btn('자녀 미션 ' + nc, call('kq.open', cid, 'c'), { fill: 'card2', tc: 'text', line: 'border', h: 40, size: 12.5 }), btn('부모님 미션 ' + np, call('kq.open', cid, 'p'), { fill: 'card2', tc: 'text', line: 'border', h: 40, size: 12.5 })] },
    tx('길동무포인트 ' + cur.stars + (wait ? ' · 내가 할 일 ' + wait + '개' : ''), { size: 13, bold: true, color: wait ? 'orange' : 'gold', lines: 1, pad: [0, 8, 0, 6] }),
    { t: 'navrow', title: '미션 보내기 · 확인하기', sub: wait ? '처리할 일 ' + wait : '', act: call('kq.open', cid, 'c'), size: 13, vp: 8 },
  ], { pad: [12, 1, 12, 0] }));
  // 지난 경로(s391): 30분 넘게 머물 때마다 그 전까지의 길이 저장된다 — 자녀당 RT_KEEP 개. 목록은 위 '지난 경로' 단추의 팝업(rtSheet)에서 본다(s413: 줄 → 단추)
  // 등록한 장소는 위 오른쪽 단추의 팝업(placesSheet)에서 본다
  // 최근 이동 기록은 '지난 경로' 팝업(rtSheet)으로 옮겼다(s414: 허브는 한 화면에 스크롤 없이 — 칸 크기가 글 수에 따라 달라지지 않게)
  // 가족 실시간 대화(파란 점): 제목은 네모칸 밖(위)에 — 네모칸 안은 위가 대화 내용(남는 세로를 처음부터 다 차지 · 아래가 최근 · 지난 글은 칸 안에서만 밀어 봄), 맨 아래가 입력줄. 박스를 누르면 전체 대화 팝업
  const msgs = msgs0.reverse();
  const ck = [{ t: 'spacer', h: 0, ffill: 1, fk: 3, fdh: 42, ffmax: CHAT_BOX }];          // 남는 세로를 메우는 빈칸 — 글은 아래(최신)에 붙고 위로 과거
  if (!msgs.length) ck.push(tx('아직 대화가 없어요. ' + nm + '에게 먼저 말을 걸어 보세요', { size: 12, color: 'sub', pad: [2, 6, 2, 2] }));
  msgs.forEach((m, i) => ck.push(Object.assign({ t: 'msg', s: m.x, mine: m.f === 'p', nick: m.f === 'p' ? '' : nm, time: clock(m.t), pad: [0, 4, 0, 0], fd: i + 1 }, m.f === 'p' && m.id > rd.c ? { un: true } : {})));
  ck.push({ t: 'inbar', key: 'khc', hint: '메시지를 입력해요', btn: '보내기', act: call('kh.say', cid), pad: [0, 8, 0, 0], maxlen: 100 });
  const foot = [
    { t: 'lth', s: '가족 실시간 대화', dot: '#2f7cf6', live: true, pad: [16, 8, 16, 0] },
    panel(ck, { pad: [10, 0, 10, 6], ip: [12, 8, 12, 4], fill: 'card', line: 'border', r: 16, act: call('kc.open') })      // 박스를 누르면 전체 대화 팝업(위아래로 밀어 봄)
  ];
  // 자녀가 여럿이면 좌우로 밀어 다음·이전 자녀로(끝에서 처음으로 돈다) — 어느 자녀로 갈지는 엔진이 정해 sw 에 담고, 앱은 그 행동(kc.<cid>)을 그대로 보낸다. 지도·'OO 뭐하니?'·퀘스트·대화가 모두 그 자녀 것으로 새로 온다.
  const ki = Math.max(0, kids.findIndex((k) => k.cid === cid)), nk = kids.length;
  const sw = nk > 1 ? { k: cid, l: call('kc.' + kids[(ki + 1) % nk].cid), r: call('kc.' + kids[(ki - 1 + nk) % nk].cid) } : null;
  return scr('kids', head, body, Object.assign({ foot, fl: false }, sw ? { sw } : {}));
}

/** 최근 이동 기록(출발 · 도착 4건) 글 줄 — 없으면 빈 배열. */
async function histLines(DB, cid) {
  const hist = (await DB.prepare('SELECT t.day day,t.st st,t.tn tn,t.td td,t.ta ta,t.tc tc,p.name name FROM trips t JOIN places p ON p.id=t.pl WHERE t.cid=? AND t.td>0 ORDER BY t.td DESC LIMIT 4').bind(cid).all()).results || [];
  if (!hist.length) return [];
  const k = [tx('최근 이동 기록', { size: 12, bold: true, color: 'sub', pad: [0, 0, 0, 4] })];
  for (const h of hist) {
    const dd = String(h.day).slice(4, 6) * 1 + '/' + String(h.day).slice(6) * 1;
    k.push(tx(dd + ' ' + h.name + ' · ' + clock(h.td) + ' 출발' + (h.tc ? ' → ' + clock(h.tc) + ' 도착 (포인트 +' + ARRIVE_PT + ')' : h.ta ? ' → ' + clock(h.ta) + ' 도착(미확인)' : ' → 도착 전'), { size: 12, color: h.tc ? 'text' : 'sub', pad: [0, 2, 0, 2] }));
  }
  return k;
}
/** 지난 경로 줄 글: '11/03 06:20 → 06:48 · 3.2km' (같은 날이면 날짜 생략) */
function rtTitle(r, now) { return evWhen(r.t0, now) + ' → ' + clock(r.t1) + ' · ' + fmtDist(r.m); }
function rtSub(r) { const mi = Math.max(1, Math.round((r.t1 - r.t0) / 60000)); return (r.sn || '출발') + ' → ' + (r.en || '도착') + ' · ' + (mi >= 60 ? Math.floor(mi / 60) + '시간 ' + (mi % 60 ? mi % 60 + '분' : '') : mi + '분'); }
/** 지난 경로 목록 팝업(최신이 위) — 누르면 지도에 그 경로가 그려진다 */
async function rtSheet(DB, pid, cid, now, notice) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid), nm = nmOf(cur);
  const rows = (await DB.prepare('SELECT id,t0,t1,m,sn,en FROM routes WHERE cid=? ORDER BY id DESC LIMIT ?').bind(cid, RT_KEEP).all()).results || [];
  const body = [tx(nm + ' 지난 경로', { size: 15, bold: true, pad: [16, 14, 16, 4] }), tx('한 곳에 30분 넘게 머물면 그 전까지의 길이 저장돼요 · 최대 ' + RT_KEEP + '개 · ' + RT_MIN_M + 'm 미만은 저장하지 않아요', { size: 11, color: 'sub', pad: [16, 0, 16, 8] })];
  if (notice) body.push(tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 0, 16, 6] }));
  if (!rows.length) body.push(tx('아직 저장된 경로가 없어요', { size: 12.5, color: 'sub', pad: [16, 12, 16, 12] }));
  if (rows.length) body.push(panel(rows.map((r) => ({ t: 'navrow', title: rtTitle(r, now), sub: rtSub(r), act: call('kr.' + r.id), size: 13, vp: 8 })), { pad: [12, 0, 12, 0], ip: [14, 6, 14, 6] }));
  const hk = await histLines(DB, cid);
  if (hk.length) body.push(panel(hk, { pad: [12, 8, 12, 0] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('닫기', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  return scr('kidrt', [], body, { dlg: dlg() });
}

/** 활동 기록 전체(위가 오래된 것, 아래가 최근) */
async function evSheet(DB, pid, cid, now) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid), nm = nmOf(cur);
  const rows = ((await DB.prepare('SELECT k,x,t FROM evs WHERE cid=? AND t>=? AND k NOT IN ' + EV_HIDE + ' ORDER BY id DESC LIMIT ?').bind(cid, now - EV_KEEP, MAX_EV).all()).results || []).reverse();
  const body = [tx(nm + ' 활동 기록', { size: 15, bold: true, pad: [16, 14, 16, 4] }), tx('최근 3일 · 아래로 갈수록 최근이에요', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (!rows.length) body.push(tx('아직 활동이 없어요', { size: 12.5, color: 'sub', pad: [16, 12, 16, 12] }));
  rows.forEach((e) => body.push(tx(evWhen(e.t, now) + '  ' + evText(e, nm), { size: 12.5, pad: [16, 4, 16, 0] })));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('닫기', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  return scr('kidev', [], body, { dlg: dlg() });
}

async function chatSheet(DB, pid, cid, now) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid);
  const rows = (await DB.prepare('SELECT id,f,x,t FROM chat WHERE cid=? AND t>=? ORDER BY id DESC LIMIT 40').bind(cid, now - CHAT_KEEP).all()).results || [];
  const rd = await rdMap(DB, cid);
  const body = [tx(nmOf(cur) + '와의 가족 대화', { size: 15, bold: true, pad: [16, 14, 16, 4] }), tx('글자만 보낼 수 있어요. 대화는 7일이 지나면 지워져요.', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (!rows.length) body.push(tx('아직 대화가 없어요. 먼저 말을 걸어 보세요.', { size: 12.5, color: 'sub', pad: [16, 12, 16, 12] }));
  rows.slice().reverse().forEach((m) => body.push(Object.assign({ t: 'msg', s: m.x, mine: m.f === 'p', nick: m.f === 'p' ? '' : nmOf(cur), time: clock(m.t), pad: [12, 4, 12, 0] }, m.f === 'p' && m.id > rd.c ? { un: true } : {})));
  const foot = [{ t: 'inbar', key: 'kct', hint: '메시지를 입력해요', btn: '보내기', act: call('kc.send', cid), pad: [12, 8, 12, 12], maxlen: 100 }];
  return scr('kidchat', [], body, { foot, anchor: 'bottom', dlg: dlg() });      // 아래에서 올라오는 팝업: 대화는 아래로 갈수록 최근, 입력줄은 맨 아래에 붙는다
}

/** 커뮤니티 맨 앞 '가족대화' 칸(길동무 확인 팝업이 아니라 커뮤니티 화면 본문): 말풍선은 위에서 아래로, 입력줄은 아래에 붙는다 */
async function famScreen(DB, pid, cid, now) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid);
  const rows = (await DB.prepare('SELECT id,f,x,t FROM chat WHERE cid=? AND t>=? ORDER BY id DESC LIMIT 60').bind(cid, now - CHAT_KEEP).all()).results || [];
  const rd = await rdMap(DB, cid);
  const body = [tx(nmOf(cur) + '와의 가족대화 · 글자만, 7일 뒤 지워져요', { size: 11, color: 'sub', pad: [16, 10, 16, 4] })];
  if (!rows.length) body.push(tx('아직 대화가 없어요. ' + nmOf(cur) + '에게 먼저 말을 걸어 보세요.', { size: 12.5, color: 'sub', pad: [16, 28, 16, 12], align: 'center' }));
  rows.slice().reverse().forEach((m) => body.push(Object.assign({ t: 'msg', s: m.x, mine: m.f === 'p', nick: m.f === 'p' ? '' : nmOf(cur), time: clock(m.t), pad: [12, 4, 12, 0] }, m.f === 'p' && m.id > rd.c ? { un: true } : {})));
  const foot = [{ t: 'inbar', key: 'kct', hint: '메시지를 입력해요', btn: '보내기', act: call('kf.send', cid), pad: [12, 8, 12, 10], maxlen: 100 }];
  return scr('kidfam', [], body, { foot, anchor: 'bottom' });
}

async function questSheet(DB, pid, cid, qt) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid);
  const rows = (await DB.prepare('SELECT id,k,x,s,pt FROM quests WHERE cid=? ORDER BY t DESC LIMIT ?').bind(cid, MAX_QUEST).all()).results || [];
  const star = await starsOf(DB, cid);
  const tab = qt === 'p' ? 'p' : 'c';
  const cRows = rows.filter((q) => q.k !== 'p'), pRows = rows.filter((q) => q.k === 'p');
  const nc = cRows.length, np = pRows.length;
  // 상태(s): 0 대기 · 1 승낙(진행 중) · 2 완료 보고(확인 대기) · 3 종료 · 4 거절 — 자세한 흐름은 SEND_COST 위의 설명
  const list = tab === 'c' ? cRows : pRows;
  const doneN = list.filter((q) => q.s === QS_DONE).length, ingN = list.filter((q) => q.s < QS_DONE).length;
  // 제목 · 길동무포인트 · 알약(자녀 미션 / 부모님 미션)은 고정 머리 — 좌우로 밀어도 안 움직이고 고른 알약 색만 바뀐다. 그 아래(body)만 밀린다.
  const head = [tx(nmOf(cur) + '의 미션', { size: 15, bold: true, pad: [16, 14, 16, 2] }), tx('길동무포인트 ' + star, { size: 12, bold: true, color: 'gold', pad: [16, 0, 16, 6] }),
    { t: 'chips', pad: [12, 4, 12, 4], items: [{ label: '자녀 미션 ' + nc, on: tab === 'c', act: call('kq.tab', cid, 'c') }, { label: '부모님 미션 ' + np, on: tab === 'p', act: call('kq.tab', cid, 'p') }] }];
  const body = [
    tx(tab === 'c' ? '부모님이 자녀에게 준 미션이에요. 자녀가 승낙하고 해낸 뒤 완료를 누르면, 확인을 눌러 길동무포인트를 주세요.' : '자녀가 부모님께 보낸 미션이에요(한 번에 길동무포인트 ' + SEND_COST + '). 승낙하면 자녀의 길동무포인트가 ' + SEND_COST + ' 차감되고, 끝낸 뒤 완료를 누르면 자녀가 확인해요.', { size: 11, color: 'sub', pad: [16, 8, 16, 0] }),
    tx((tab === 'c' ? '오른쪽 부모님 미션' : '왼쪽 자녀 미션') + '으로 화면을 밀어서 넘길 수 있어요', { size: 10.5, color: 'sub', pad: [16, 2, 16, 4] }),
    tx('진행 중 ' + ingN + ' · 완료 ' + doneN, { size: 12.5, bold: true, color: ingN ? 'orange' : 'gold', pad: [16, 4, 16, 2] })];
  if (tab === 'c') {
    body.push(panel([tx('자녀에게 미션 보내기', { size: 12, bold: true, color: 'sub', pad: [0, 0, 0, 6] }), { t: 'field', key: 'kqx', hint: '예) 방 정리하기', maxlen: 60, h: 42 },
      tx('해냈을 때 받는 길동무포인트', { size: 11.5, color: 'sub', pad: [0, 8, 0, 4] }),
      { t: 'row', gap: 6, kids: [1, 2, 3, 4, 5].map((n) => btn(String(n), call('kq.pt', cid, String(n)), Object.assign({ h: 38 }, n === 1 ? gold : { fill: 'card2', tc: 'text', line: 'border' }))) },
      tx('길동무포인트를 고르고 아래 확인을 눌러야 보내져요', { size: 10.5, color: 'sub', pad: [0, 6, 0, 8] }),
      btn('확인', call('kq.send', cid, '1'), Object.assign({ h: 42 }, gold))], { pad: [12, 8, 12, 0] }));
  }
  for (const q of list) {
    const k = [tx(q.x, { size: 13.5, bold: true })], p = q.pt || 1;
    const line = (txt, color, bold) => k.push(tx(txt, { size: 11.5, color, bold: !!bold, pad: [0, 4, 0, 4] }));
    if (tab === 'c') {
      if (q.s === QS_WAIT) line('대기 중 · 자녀가 승낙하면 시작돼요 (완료하면 포인트 +' + p + ')', 'sub');
      else if (q.s === QS_ON) line('진행 중 · 자녀가 완료를 누르면 확인할 수 있어요', 'sub');
      else if (q.s === QS_REP) { line('자녀가 완료했어요 · 확인해 주세요', 'orange', true); k.push({ t: 'row', gap: 8, kids: [btn('확인 (포인트 +' + p + ')', call('kq.ok', q.id, 'c'), gold), btn('다시 하기', call('kq.redo', q.id, 'c'), { fill: 'card2', tc: 'text', line: 'border' })] }); }
      else if (q.s === QS_DONE) line('완료 · 포인트 +' + p + ' 지급했어요', 'gold');
      else line('자녀가 거절했어요', 'sub');
    } else {
      if (q.s === QS_WAIT) { line('자녀가 보냈어요 · 승낙하면 자녀 포인트 -' + (q.pt || SEND_COST) + ' 차감돼요', 'orange', true); k.push({ t: 'row', gap: 8, kids: [btn('승낙', call('kq.accept', q.id, 'p'), gold), btn('거절', call('kq.reject', q.id, 'p'), { fill: 'card2', tc: 'text', line: 'border' })] }); }
      else if (q.s === QS_ON) { line('승낙했어요 (포인트 -' + (q.pt || SEND_COST) + ') · 끝냈으면 완료를 눌러요', 'orange', true); k.push(btn('완료', call('kq.fin', q.id, 'p'), gold)); }
      else if (q.s === QS_REP) line('완료했어요 · 자녀의 확인을 기다려요', 'sub');
      else if (q.s === QS_DONE) line('완료 · 자녀가 확인했어요', 'gold');
      else line('거절했어요', 'sub');
    }
    body.push(panel(k, { pad: [12, 8, 12, 0] }));
  }
  if (!list.length) body.push(tx(tab === 'c' ? '아직 보낸 미션이 없어요' : '자녀가 보낸 미션이 아직 없어요', { size: 12.5, color: 'sub', pad: [16, 14, 16, 8] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('닫기', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  const sw = tab === 'c' ? { k: 'c', r: call('kq.tab', cid, 'p') } : { k: 'p', l: call('kq.tab', cid, 'c') };         // 좌우로 밀어 자녀 미션 ↔ 부모님 미션
  return scr('kidquest', head, body, { dlg: dlg(), sw });
}

async function readDraft(DB, pid) { return DB.prepare('SELECT * FROM drafts WHERE pid=?').bind(pid).first(); }
// ───────── 장소 등록(s392): 주소(또는 장소 이름)를 적어 찾으면 지도가 그쪽으로 옮겨가고, 이름을 적어 등록하면 도착 · 출발을 부모에게 알린다 ─────────
const GEO_BASE = 'https://gentle-lab-7e47subway-api.phg0643.workers.dev/kakao-local';
/** 주소 · 장소 이름 찾기(카카오 로컬을 길동무 프록시로) — 주소로 먼저, 없으면 장소 이름으로. 돌려주는 값: [{n 이름, a 주소, la, lo}] 최대 5개 */
async function geoFind(q, near, env) {
  let err = '';
  const T = () => (AbortSignal && AbortSignal.timeout ? { signal: AbortSignal.timeout(4500) } : undefined);
  const fail = (e) => { err = err || (e && e.name === 'TimeoutError' ? '시간 초과' : '연결 실패'); };
  // 카카오 검색 — 1) 서비스 바인딩 GEO(워커끼리 직접 연결, 가장 확실) 2) 중계 워커 주소 3) 비밀키 KAKAO_REST_KEY 로 직접
  const get = async (path, qs) => {
    const tries = [];
    const px = GEO_BASE + '?path=' + encodeURIComponent(path) + '&qs=' + encodeURIComponent(qs);
    if (env && env.GEO && typeof env.GEO.fetch === 'function') tries.push(() => env.GEO.fetch(px));
    tries.push(() => fetch(px, T()));
    if (env && env.KAKAO_REST_KEY) tries.push(() => fetch('https://dapi.kakao.com/v2/local/' + path + '?' + qs, Object.assign({ headers: { Authorization: 'KakaoAK ' + env.KAKAO_REST_KEY } }, T())));
    for (const f of tries) {
      try {
        const r = await f();
        if (!r.ok) { err = err || ('응답 ' + r.status); continue; }
        const j = await r.json();
        if (j && Array.isArray(j.documents)) { err = ''; return j.documents; }
      } catch (e) { fail(e); }
    }
    return [];
  };
  const ok = (d) => Number.isFinite(+d.x) && Number.isFinite(+d.y) && Math.abs(+d.y) <= 85 && Math.abs(+d.x) <= 180 && (+d.x || +d.y);
  // 주소 찾기와 장소 이름 찾기를 동시에 묻는다 — 주소 결과를 먼저, 없으면 장소 이름 결과
  const [ad, kw] = await Promise.all([
    get('search/address.json', 'query=' + encodeURIComponent(q) + '&size=5'),
    get('search/keyword.json', 'query=' + encodeURIComponent(q) + '&size=5' + (near ? '&x=' + near[1].toFixed(5) + '&y=' + near[0].toFixed(5) : '')),
  ]);
  let out = ad.filter(ok).map((d) => ({ n: (d.road_address && d.road_address.building_name) || d.address_name || q, a: d.address_name || '', la: +d.y, lo: +d.x }));
  if (!out.length) out = kw.filter(ok).map((d) => ({ n: d.place_name || d.address_name || q, a: d.road_address_name || d.address_name || '', la: +d.y, lo: +d.x }));
  // 카카오가 막혔거나 못 찾으면 OpenStreetMap(Nominatim) 으로 한 번 더 — 주소와 학교·건물 이름 모두 받는다
  if (!out.length) {
    try {
      const vb = near ? '&viewbox=' + [near[1] - 0.6, near[0] + 0.6, near[1] + 0.6, near[0] - 0.6].map((x) => x.toFixed(4)).join(',') : '';
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=kr&accept-language=ko&q=' + encodeURIComponent(q) + vb,
        Object.assign({ headers: { 'User-Agent': 'gildongmu-kids/1.0 (place search)', Accept: 'application/json' } }, T()));
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j)) {
          out = j.filter((d) => ok({ x: d.lon, y: d.lat })).map((d) => {
            const parts = String(d.display_name || '').split(',').map((x) => x.trim()).filter(Boolean);
            return { n: (d.name || parts[0] || q).slice(0, 30), a: parts.slice(d.name ? 1 : 1, 5).reverse().join(' ').slice(0, 60), la: +d.lat, lo: +d.lon };
          });
          if (out.length) err = '';
        }
      } else err = err || ('응답 ' + r.status);
    } catch (e) { fail(e); }
  }
  out = out.slice(0, 5);
  if (!out.length && err) out.err = err;                      // 검색 서버 문제와 '진짜 없음'을 구분해 알린다
  return out;
}
async function saveDraft(DB, pid, cid, la, lo, name, q, now) {
  await DB.prepare("INSERT INTO drafts(pid,cid,pl,la,lo,name,hh,mm,days,t,q) VALUES(?,?,'',?,?,?,16,0,0,?,?) ON CONFLICT(pid) DO UPDATE SET cid=excluded.cid,pl='',la=excluded.la,lo=excluded.lo,name=excluded.name,hh=16,mm=0,days=0,t=excluded.t,q=excluded.q").bind(pid, cid, la, lo, name, now, q).run();
}
function regSheet(d, results, notice) {
  const body = [tx('장소 등록', { size: 15, bold: true, pad: [16, 14, 16, 2] }), tx('주소나 장소 이름을 찾으면 지도가 그쪽으로 옮겨가요. 이름을 적어 등록하면 자녀가 도착하거나 벗어날 때 알려 드려요.', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (notice) body.push(tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 2, 16, 4] }));
  body.push(panel([{ t: 'field', key: 'kpa', hint: '주소 또는 건물·학교·회사 이름 (예: 대동초등학교 · 가양로 12)', value: d.q || '', maxlen: 60, h: 44 },
    { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('주소 찾기', call('kpg.find'), gold)] }], { pad: [12, 6, 12, 0] }));
  if (results && results.length > 1) body.push(panel(results.map((r, i) => ({ t: 'navrow', title: r.n, sub: r.a, act: call('kpg.pick', '', (+r.la).toFixed(6) + '|' + (+r.lo).toFixed(6) + '|' + String(r.n || '').replace(/\|/g, ' ').slice(0, 20)), size: 13, vp: 8 })), { pad: [12, 8, 12, 0], ip: [14, 6, 14, 6] }));
  body.push(tx('원하는 위치가 없을시 지도를 클릭하여 위치를 지정하세요', { size: 11.5, bold: true, cc: '#1A73E8', color: 'text', pad: [14, 10, 14, 0] }));          // s420: 파란 한 줄 안내(옛 앱은 cc 를 몰라 기본 글색)
  body.push({ t: 'tmap', h: 190, r: 14, act: call('kpg.map'), pad: [12, 4, 12, 0], pts: [{ la: d.la, lo: d.lo, k: 's', n: '', l: d.name || '여기' }], foc: 0, fz: 17 });          // 고정 지도(live 아님): 팝업에 MapLibre 를 올리면 열 때마다 버벅인다 · 위치는 찾기로 정한다
  body.push(panel([{ t: 'field', key: 'kpn', hint: '장소 이름 (예: 우리집 · 00학교)', value: d.name || '', maxlen: 20, h: 44 },
    tx('위치 ' + (+d.la).toFixed(4) + ', ' + (+d.lo).toFixed(4) + ' · 시각 알림은 등록 뒤 장소를 눌러 정할 수 있어요', { size: 10.5, color: 'sub', pad: [0, 8, 0, 0] })], { pad: [12, 8, 12, 0] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('취소', call('kpg.cancel'), { fill: 'card2', tc: 'text', line: 'border' }), btn('등록', call('kpg.add'), gold)] });
  return scr('kidreg', [], body, { dlg: dlg() });
}
/** 등록한 장소 목록 팝업(s401): 한 곳을 누르면 그 장소를 고치는 팝업(kp.<id>)으로 바뀐다. */
async function placesSheet(DB, cid) {
  const pls = (await DB.prepare('SELECT id,name,hh,mm,days FROM places WHERE cid=? ORDER BY hh,mm LIMIT ?').bind(cid, MAX_PLACES).all()).results || [];
  const body = [tx('등록한 장소', { size: 15, bold: true, pad: [16, 14, 16, 2] }),
    tx(pls.length ? '장소를 누르면 시각 · 요일을 고치거나 지울 수 있어요. (' + pls.length + '/' + MAX_PLACES + ')' : '아직 등록한 장소가 없어요. 장소를 등록하면 자녀가 도착하거나 벗어날 때 알려 드려요.', { size: 12, color: 'sub', pad: [16, 0, 16, 8] })];
  if (pls.length) body.push(panel(pls.map((p, i) => ({ t: 'navrow', title: (i + 1) + '. ' + p.name, sub: p.days ? pad2(p.hh) + ':' + pad2(p.mm) + ' ' + daysTxt(p.days) : '출입 알림 · 시각 없음', act: call('kp.' + p.id), size: 13, vp: 8 })), { pad: [12, 4, 12, 0], ip: [14, 6, 14, 6] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('닫기', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' }), btn('+ 장소 등록', call('kpg.open', cid), gold)] });
  return scr('kidpls', [], body, { dlg: dlg() });
}
function placeSheet(d, edit, notice) {
  const body = [tx(edit ? '장소 고치기' : '장소 등록', { size: 15, bold: true, pad: [16, 14, 16, 2] }), tx('요일을 고르면 그 시각에 자녀가 이 장소에 있어야 해요(30분 전에 자녀에게 알려요). 요일을 안 고르면 도착 · 출발 알림만 와요.', { size: 11, color: 'sub', pad: [16, 0, 16, 6] }),
    ...(notice ? [tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 4, 16, 2] })] : []),
    panel([{ t: 'field', key: 'kpn', hint: '이름 (예: 00학원)', value: d.name || '', maxlen: 20, h: 44 },
      tx('도착해야 하는 시각', { size: 11.5, color: 'sub', pad: [0, 10, 0, 2] }), tx(pad2(d.hh) + ':' + pad2(d.mm), { size: 30, bold: true, align: 'center', color: 'text', pad: [0, 2, 0, 8] }),
      { t: 'row', gap: 6, kids: [['−1시간', -60], ['−10분', -10], ['+10분', 10], ['+1시간', 60]].map((x) => btn(x[0], call('kpl.t', '', String(x[1])), { h: 36, size: 12, fill: 'card2', tc: 'text', line: 'border' })) },
      tx('요일', { size: 11.5, color: 'sub', pad: [0, 12, 0, 4] }),
      { t: 'row', gap: 4, kids: WD.map((w, i) => btn(w, call('kpl.d', '', String(i)), Object.assign({ h: 38, size: 12 }, (d.days >> i) & 1 ? gold : { fill: 'card2', tc: 'text', line: 'border' }))) },
      tx('위치: 지도에서 고른 곳 (' + d.la.toFixed(4) + ', ' + d.lo.toFixed(4) + ')', { size: 10.5, color: 'sub', pad: [0, 10, 0, 0] })], { pad: [12, 6, 12, 0] }),
    { t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: (edit ? [btn('삭제', call('kpl.del'), { fill: 'card2', tc: 'orange', line: 'border' })] : []).concat([btn('취소', call('kpl.cancel'), { fill: 'card2', tc: 'text', line: 'border' }), btn('저장', call('kpl.save'), gold)]) }];
  return scr('kidplace', [], body, { dlg: dlg() });
}

async function cheerSheet(DB, pid, cid, notice) {
  const kids = await childrenOf(DB, pid);
  const cur = kids.find((k) => k.cid === cid) || kids[0];
  if (!cur) return scr('kidcheer', [], [tx('연결된 자녀가 없어요', { size: 15, bold: true, pad: [16, 20, 16, 12] })], { dlg: dlg() });
  const rows = (await DB.prepare('SELECT id,x FROM cheers WHERE cid=? ORDER BY id LIMIT ?').bind(cur.cid, MAX_CHEER).all()).results || [];
  const body = [tx(nmOf(cur) + ' 응원문구', { size: 15, bold: true, pad: [16, 14, 16, 2] }),
    tx('만들면 키즈 앱 맨 위에 흐르는 글이 이 문구로 바뀌어요. 하나도 없으면 기본 문구가 나와요. (' + rows.length + '/' + MAX_CHEER + ')', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (kids.length > 1) body.push({ t: 'chips', pad: [12, 4, 12, 0], items: kids.map((k) => ({ label: nmOf(k), on: k.cid === cur.cid, act: call('kh.cheer', k.cid) })) });
  if (notice) body.push(tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 6, 16, 2] }));
  if (rows.length) body.push(panel(rows.map((r) => ({ t: 'row', gap: 8, pad: [0, 4, 0, 4], kids: [tx(r.x, { size: 13, pad: [0, 8, 0, 0], flex: 1 }), btn('삭제', call('kh.cd', cur.cid, String(r.id)), { fill: 'card2', tc: 'orange', line: 'border', h: 32, size: 12 })] })), { pad: [12, 6, 12, 0] }));
  if (rows.length < MAX_CHEER) body.push(panel([{ t: 'field', key: 'kch', hint: '응원문구 (최대 ' + CHEER_LEN + '자)', maxlen: CHEER_LEN, h: 44 },
    { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('추가', call('kh.ca', cur.cid), gold)] }], { pad: [12, 8, 12, 0] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('‹ 뒤로', call('kn.open'), { fill: 'card2', tc: 'text', line: 'border' }), btn('닫기', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  return scr('kidcheer', [], body, { dlg: dlg() });
}

async function linkSheet(DB, pid, notice) {
  const kids = await childrenOf(DB, pid);
  const body = [tx('길동무 키즈 연결', { size: 15, bold: true, pad: [16, 14, 16, 2] }), tx('자녀 폰의 길동무 키즈 설정에서 QR 이나 시크릿 키를 만들어 주세요(10분 동안 쓸 수 있어요).', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (notice) body.push(tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 2, 16, 4] }));
  for (const k of kids) {
    body.push(panel([tx(nmOf(k) + ' · 연결됨', { size: 13.5, bold: true }), tx('길동무포인트 ' + k.stars, { size: 11.5, color: 'sub', pad: [0, 2, 0, 8] }),
      { t: 'field', key: 'kn_' + k.cid.slice(0, 12), hint: '자녀 이름 (예: 민지)', value: k.nm || '', maxlen: 8, h: 40 },
      { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('이름 저장', call('kl.name', k.cid), gold), btn('연결 끊기', call('kl.unlink', k.cid), { fill: 'card2', tc: 'orange', line: 'border' })] }], { pad: [12, 8, 12, 0] }));
  }
  const pnm = await pnOf(DB, pid);
  body.push(panel([tx('내 이름 (자녀에게 보여요)', { size: 12, bold: true, color: 'sub', pad: [0, 0, 0, 6] }), { t: 'field', key: 'kpn', hint: '예: 엄마 · 아빠', value: pnm, maxlen: 8, h: 42 },
    { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('이름 저장', call('kl.pname'), gold)] }], { pad: [12, 8, 12, 0] }));
  body.push(panel([tx('새 자녀 연결', { size: 12, bold: true, color: 'sub', pad: [0, 0, 0, 6] }), { t: 'field', key: 'klc', hint: '시크릿 키 입력 (XXXXX-XXXXX)', maxlen: 12, h: 42, watch: true },
    { t: 'field', key: 'kln', hint: '자녀 이름 (선택)', maxlen: 8, h: 42 },
    { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('QR 찍기', call('kl.scan'), { fill: 'card2', tc: 'text', line: 'border' }), btn('키로 연결', call('kl.join'), gold)] }], { pad: [12, 8, 12, 0] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('닫기', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  return scr('kidlink', [], body, { dlg: dlg() });
}

/** 설정 탭 맨 위에 끼울 한 줄(연결되었을 때만). 연결이 없으면 null — 길동무는 아무것도 보이지 않는다. */
async function settingsRow(DB, pid, kn) {          // 설정 맨 위에 끼울 노드들(연결된 부모에게만). 아무도 연결 안 했으면 null. kn: 새 앱(길동무 키즈 탭 하나 → 팝업에서 설정)
  const kids = await childrenOf(DB, pid);
  if (!kids.length) return null;
  const names = kids.map(nmOf).join(', ');
  if (kn) return [
    { t: 'panel', pad: [16, 12, 16, 0], ip: [16, 6, 16, 6], fill: 'card', line: 'border', r: 14, kids: [
      { t: 'navrow', title: '길동무 키즈', sub: '연동되었습니다 · ' + names, act: call('kn.open'), size: 14, top: true }] },
  ];
  const kh = (await DB.prepare('SELECT kh FROM devices WHERE id=?').bind(pid).first())?.kh ? true : false;
  const nc = (await DB.prepare('SELECT COUNT(*) n FROM cheers WHERE cid=?').bind(kids[0].cid).first())?.n || 0;
  return [
    { t: 'panel', pad: [16, 12, 16, 0], ip: [16, 6, 16, 6], fill: 'card', line: 'border', r: 14, kids: [
      { t: 'navrow', title: '길동무 키즈', sub: '길동무 키즈와 연동되었습니다 · ' + names, act: call('kl.open'), size: 14, top: true }] },
    tx('키즈 관련 설정', { size: 12, bold: true, color: 'sub', pad: [20, 16, 16, 6] }),
    { t: 'panel', pad: [16, 0, 16, 0], ip: [16, 6, 16, 6], fill: 'card', line: 'border', r: 14, kids: [
      { t: 'toggle', key: 'kidsHome', title: '키즈 화면으로 시작', sub: '켜면 앱을 열 때 키즈 감시 화면이 먼저 나와요. 끄면 길동무 홈으로 시작해요.', on: kh, top: false, vp: 9, size: 14, ssize: 11, onc: 'gold' },
      { t: 'navrow', title: '자녀 응원문구 만들기', sub: kids.length > 1 ? '자녀마다 최대 ' + MAX_CHEER + '개' : nc + '/' + MAX_CHEER + '개', act: call('kh.cheer'), size: 14, top: true }] },
  ];
}
/** 자녀 마커 사진의 열쇠 — 지도 핀(g)과 앱 저장소가 같은 글을 쓴다(앱 KidsHub.markerKey 와 같은 규칙) */
const markerKey = (cid) => String(cid || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 34);
async function kidMenuSheet(DB, pid) {          // 설정 > 길동무 키즈 팝업: 연동 · 시작 화면 · 응원문구 · 마커 변경
  const kids = await childrenOf(DB, pid);
  if (!kids.length) return scr('kidmenu', [], [tx('연결된 자녀가 없어요', { size: 15, bold: true, pad: [16, 20, 16, 12] })], { dlg: dlg() });
  const kh = (await DB.prepare('SELECT kh FROM devices WHERE id=?').bind(pid).first())?.kh ? true : false;
  const nc = (await DB.prepare('SELECT COUNT(*) n FROM cheers WHERE cid=?').bind(kids[0].cid).first())?.n || 0;
  const body = [tx('길동무 키즈', { size: 15, bold: true, pad: [16, 14, 16, 2] }),
    tx('길동무 키즈와 연동되었습니다 · ' + kids.map(nmOf).join(', '), { size: 11, color: 'sub', pad: [16, 0, 16, 6] }),
    panel([{ t: 'toggle', key: 'kidsHome', title: '키즈 화면으로 시작', sub: '켜면 앱을 열 때 키즈 감시 화면이 먼저 나와요. 끄면 길동무 홈으로 시작해요.', on: kh, top: false, vp: 9, size: 14, ssize: 11, onc: 'gold' }], { ip: [14, 6, 14, 6] }),
    panel([
      { t: 'navrow', title: '자녀 응원문구 만들기', sub: kids.length > 1 ? '자녀마다 최대 ' + MAX_CHEER + '개' : nc + '/' + MAX_CHEER + '개', act: call('kh.cheer'), size: 14, top: true },
      { t: 'navrow', title: '마커 변경', sub: '지도에 보이는 자녀 마커를 사진으로 바꿔요', act: call('km.open'), size: 14, top: true },
      { t: 'navrow', title: '연동 관리', sub: '자녀 추가 · 연결 끊기', act: call('kl.open'), size: 14, top: true }], { ip: [14, 6, 14, 6] }),
    { t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('닫기', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] }];
  return scr('kidmenu', [], body, { dlg: dlg() });
}
async function kidMarkerSheet(DB, pid) {          // 마커 변경 팝업: 자녀마다 [사진 고르기] [기본으로] — 사진은 이 기기에만 저장돼요(앱이 처리, 서버는 모른다)
  const kids = await childrenOf(DB, pid);
  const body = [tx('마커 변경', { size: 15, bold: true, pad: [16, 14, 16, 2] }),
    tx('사진을 고른 뒤 동그라미 안에 들어오게 옮기고 확대하면, 지도의 자녀 마커가 그 사진으로 바뀌어요. 사진은 이 폰에만 저장돼요.', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (!kids.length) body.push(tx('연결된 자녀가 없어요', { size: 13, pad: [16, 8, 16, 8] }));
  else body.push(panel(kids.map((k) => ({ t: 'row', gap: 8, pad: [0, 4, 0, 4], kids: [tx(nmOf(k), { size: 14, bold: true, pad: [0, 10, 0, 0], flex: 1 }),
    btn('사진 고르기', call('km.pick', k.cid), Object.assign({ h: 34, size: 12 }, gold)), btn('기본으로', call('km.clr', k.cid), { fill: 'card2', tc: 'text', line: 'border', h: 34, size: 12 })] })), { ip: [14, 8, 14, 8] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('‹ 뒤로', call('kn.open'), { fill: 'card2', tc: 'text', line: 'border' }), btn('닫기', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  return scr('kidmk', [], body, { dlg: dlg() });
}
async function startPref(DB, pid) {          // 앱이 켜질 때 먼저 볼 화면(연결이 있고 설정이 켜졌을 때만 1)
  const kids = await childrenOf(DB, pid);
  if (!kids.length) return 0;
  return (await DB.prepare('SELECT kh FROM devices WHERE id=?').bind(pid).first())?.kh ? 1 : 0;
}

// ───────── 길 ─────────
async function newDraft(DB, pid, cid, la, lo, now) {
  await DB.prepare('INSERT INTO drafts(pid,cid,pl,la,lo,name,hh,mm,days,t) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(pid) DO UPDATE SET cid=excluded.cid,pl=excluded.pl,la=excluded.la,lo=excluded.lo,name=excluded.name,hh=excluded.hh,mm=excluded.mm,days=excluded.days,t=excluded.t')
    .bind(pid, cid, '', la, lo, '', 16, 0, 31, now).run();
}

/** 기기 푸시 토큰을 저장한다(같은 토큰이 다른 기기에 남아 있으면 지운다 — 앱을 지웠다 깔았을 때 알림이 엉키지 않게) */
async function saveFt(DB, id, tk, now) {
  if (typeof tk !== 'string' || tk.length < 20 || tk.length > 400 || /[^\w:.\-]/.test(tk)) return { ok: false, err: '토큰 모양이 맞지 않아요' };
  await DB.batch([DB.prepare("UPDATE devices SET ft='' WHERE ft=? AND id<>?").bind(tk, id), DB.prepare('UPDATE devices SET ft=?,fa=? WHERE id=?').bind(tk, now, id)]);
  return { ok: true };
}
// ───────── 개인정보 처리방침 · 위치기반서비스 이용약관 공개 쪽(s430) ─────────
// LEGAL-BEGIN (tools/embed-legal.py 가 만든다 — 직접 고치지 말고 docs/legal 을 고친 뒤 다시 실행)
const LEGAL_DOCS = {"privacy": "# 길동무 키즈 개인정보 처리방침\n\n> 시행일: {{LEGAL_DATE}} · 버전 1.0\n\n{{OP_NAME}}(이하 \"운영자\")는 「개인정보 보호법」 제30조와 「위치정보의 보호 및 이용 등에 관한 법률」(이하 \"위치정보법\")에 따라, \"길동무 키즈\"(자녀용 앱)와 \"길동무\"(부모용 앱)의 키즈 기능(이하 \"서비스\")을 이용하는 분의 개인정보와 개인위치정보를 어떻게 처리하는지 알려 드립니다.\n\n## 1. 서비스가 하는 일\n부모(보호자)가 연결한 자녀의 휴대폰 위치를 부모에게 보여 주고, 도착·출발·낯선 곳·날씨·배터리 같은 안전 알림과 가족 대화·미션 기능을 제공합니다.\n\n## 2. 처리하는 개인정보와 개인위치정보\n\n| 구분 | 항목 | 처리 목적 | 보유 기간 |\n|---|---|---|---|\n| 자녀 위치 | 현재 위치(위도·경도·정확도·시각), 이동 방향 | 부모에게 현재 위치 표시 | 새 위치로 바뀔 때까지(연결을 끊으면 즉시 삭제) |\n| 자녀 위치 기록 | 지난 위치 점 | 지난 길 표시, 낯선 곳 판단 | **3일** |\n| 지난 길 | 출발~도착 경로 | 지난 경로 보기 | **7일 · 최대 10개** |\n| 머문 곳 | 30분 넘게 머문 위치 | 낯선 곳 알림 판단 | **30일 · 최대 200개** |\n| 이벤트 | 도착·출발·알림 기록 | 부모에게 알림 기록 표시 | **3일 · 최대 150개** |\n| 동네 이름 | 자녀 기기가 위치로 알아낸 시·동 이름 | 부모 화면에 동네 표시 | 위치와 함께(새 위치로 바뀔 때까지) |\n| 기기 상태 | 배터리 잔량·충전 여부 | 배터리 부족 알림 | 최신 값만 보관 |\n| 긴급 호출·데리러 와줘 | 자녀가 누른 종류, 누른 시각, 그때의 위치와 가까운 장소 이름 | 보호자에게 알림 | **7일** |\n| 장소 등록 | 부모가 등록한 장소 이름·위치·시각 | 도착·출발 알림 | 부모가 삭제하거나 연결을 끊을 때까지 |\n| 대화 | 가족 대화 글 | 가족 소통 | **7일 · 최대 300개** |\n| 미션·응원문구 | 미션, 응원문구 | 가족 소통 | 최대 100개(미션) · 연결을 끊을 때까지 |\n| 법정대리인 확인 | 보호자 기기 번호, 확인한 시각·버전(\"법정대리인이며 자녀는 만 9세 이상\" 선언) | 자녀 위치를 보기 전 법정대리인 확인 | 보호자 기기가 삭제될 때까지 |\n| 동의 기록 | 자녀 기기 번호, 동의 버전·시각 | 보호자·자녀 동의 증빙 | 약 400일 |\n| 위치 이용·제공 사실 | 시각, 자녀 기기 번호, 보호자 기기 번호, 종류(화면 보기 · 알림). **좌표는 포함하지 않음** | 위치정보법 제16조 의무 이행 | **약 200일(6개월 이상)** — 연결을 끊어도 이 기간은 보관 |\n| 기기 식별 | 서비스가 만든 임의의 기기 번호·비밀키, 푸시 알림 토큰 | 기기 연결·알림 전송 | 연결을 끊을 때까지 |\n| 부모가 입력한 주소 | 장소 등록 때 검색한 주소·장소 이름 | 지도 위치 찾기 | 등록 작업 중에만 임시 보관(등록·취소 시 삭제, 쓰다 만 것은 1일 뒤 삭제) |\n\n- 이름, 전화번호, 이메일, 사진 같은 직접 식별정보는 **수집하지 않습니다**. (별명은 보호자가 정하는 이름입니다.)\n- 광고 식별자는 사용하지 않으며, 광고·분석 SDK를 넣지 않습니다.\n\n- **만 9세 이상**만 이용할 수 있습니다. 보호자는 법정대리인이어야 하며, 자녀 위치를 보기 전에 앱에서 이를 확인합니다. 확인 전에는 위치·알림이 보호자에게 제공되지 않습니다.\n\n## 3. 위치를 보내는 주기\n- 평소: 움직이는 중 약 3분, 멈춰 있으면 약 5분마다 보냅니다. 오래 가만히 있고 등록한 장소·약속과 멀리 떨어져 있으면 배터리를 아끼기 위해 약 8분마다 보낼 수 있습니다.\n- **긴급 호출·데리러 와줘**를 누른 뒤 30분 동안은 보호자가 지도를 보지 않아도 빠른 주기(2.5~15초)로 보냅니다.\n- **보호자가 지도를 보고 있는 동안**: 2.5~15초마다 보내 실시간처럼 보여 줍니다(보호자가 화면을 닫으면 곧 평소로 돌아갑니다). 이때 자녀 앱의 맨 위 줄과 알림에 \"부모님이 지금 내 위치를 보고 있어요\"가 표시됩니다.\n\n## 4. 개인정보를 제3자에게 제공하는 경우\n- 자녀의 위치는 **연결된 보호자에게만** 제공됩니다. 그 밖의 제3자에게 제공하지 않습니다. (법령에 따른 요청이 있는 경우는 제외)\n\n## 5. 처리 위탁 및 국외 이전\n서비스 운영을 위해 아래 사업자의 서비스를 사용합니다. 아래 사업자의 서버는 국외에 있을 수 있습니다.\n\n| 수탁자 | 위탁 업무 | 이전되는 항목 | 비고 |\n|---|---|---|---|\n| Cloudflare, Inc. | 서버 운영, 데이터베이스 보관 | 2항의 서버 보관 항목 전체 | 국외 처리 가능 |\n| Google LLC (Firebase Cloud Messaging) | 푸시 알림 전송 | 푸시 토큰, 알림 문구 | 국외 처리 가능 |\n| Open-Meteo | 날씨·대기질 조회 | 대략의 위치(좌표, 소수 2자리 · 약 1km 단위) | 개인 식별 정보 없음 |\n| OpenFreeMap / OpenStreetMap | 지도 이미지 | 보고 있는 지도 범위 | 개인 식별 정보 없음 |\n| Kakao (로컬 API, 운영자 서버 경유) | 주소·장소 검색 | 검색어 | 보호자가 장소 등록 때 검색한 때만. 같은 검색을 빠르게 하려고 운영자 서버가 검색어와 결과를 최대 90일 임시 저장할 수 있으며, 이용자 식별 정보는 함께 저장하지 않습니다 |\n| 기기 운영체제(안드로이드 위치 변환 기능) | 자녀 기기가 위치로 동네 이름을 알아내는 기능 | 기기 안에서 처리되며, 기기 제조사·구글 서비스로 위치가 전달될 수 있습니다 | 운영자 서버를 거치지 않음 |\n\n## 6. 보호자와 자녀의 권리\n- 보호자와 자녀는 언제든 연결을 끊을 수 있고, 끊으면 해당 자녀의 위치·경로·머문 곳·장소·대화·미션·알림 기록이 **즉시 삭제**됩니다(법정 보관 대상인 6항의 이용·제공 사실 자료는 제외).\n- 자녀는 자녀 앱 설정에서 위치 공유를 끄거나 동의를 철회할 수 있습니다.\n- 만 14세 미만 자녀의 개인정보는 법정대리인(보호자)의 동의를 받아 처리하며, 서비스는 자녀 본인의 동의도 함께 받습니다.\n- 열람·정정·삭제·처리정지 요청은 아래 연락처로 하실 수 있습니다. 10일 안에 답변드립니다.\n- 개인위치정보의 이용·제공 사실 확인 자료(시각·자녀·보호자·종류, 좌표 없음)는 위치정보법 제16조에 따라 약 200일 보관합니다. 연결을 끊거나 삭제를 요청하셔도 이 자료는 법정 기간 동안 남습니다.\n\n## 7. 파기\n보유 기간이 지나거나 목적을 이룬 개인정보는 지체 없이 삭제합니다. 서버는 10분마다 기간이 지난 기록을 지웁니다. 삭제된 정보는 복구하지 않습니다.\n\n## 8. 안전성 확보 조치\n- 기기와 서버 사이의 통신은 암호화(HTTPS)합니다.\n- 기기별 비밀키로 요청을 확인하고, 연결된 보호자만 해당 자녀의 정보를 볼 수 있습니다.\n- 기록은 위 기간이 지나면 자동으로 지웁니다.\n\n## 9. 개인정보 보호책임자 및 문의\n- 책임자: {{OP_MGR}}\n- 연락처: {{OP_CONTACT}}\n- 침해 신고·상담: 개인정보침해신고센터 (privacy.kisa.or.kr, 118), 개인정보분쟁조정위원회 (kopico.go.kr, 1833-6972)\n\n## 10. 변경\n이 방침이 바뀌면 시행 7일 전에 앱과 {{LEGAL_URL}}에 알립니다. 수집 항목이나 위치 보고 방식이 달라지는 중요한 변경은 보호자와 자녀의 동의를 다시 받습니다.\n", "terms": "# 길동무 키즈 위치기반서비스 이용약관\n\n> 시행일: {{LEGAL_DATE}} · 버전 1.0\n\n## 제1조 (목적)\n이 약관은 {{OP_NAME}}가 제공하는 길동무 키즈 서비스(이하 \"서비스\")의 이용과 관련해 운영자와 이용자(보호자·자녀)의 권리와 의무를 정합니다.\n\n## 제2조 (용어)\n1. \"보호자\": 자녀를 보호할 법적 권한이 있는 사람으로, 자녀 휴대폰과 연결한 사람.\n2. \"자녀\": 길동무 키즈 앱을 쓰며 위치를 알리는 사람.\n3. \"개인위치정보\": 자녀의 위치(위도·경도·시각)에 관한 정보.\n4. \"위치기반서비스\": 개인위치정보를 이용해 제공하는 이 서비스의 기능 일체.\n\n## 제3조 (서비스 내용)\n1. 자녀의 현재 위치와 지난 길 보기\n2. 장소 등록과 도착·출발·낯선 곳·날씨·배터리 알림, 긴급 호출·데리러 와줘\n3. 가족 대화, 미션, 응원문구\n\n## 제4조 (이용 자격과 동의)\n1. 보호자는 자녀의 법정대리인(친권자·후견인)이어야 합니다. 자녀 위치를 보기 전에 앱에서 \"법정대리인이며 자녀는 만 9세 이상이고, 자녀에게 알렸다\"는 사항을 확인하며, 확인한 시각이 기록됩니다. 사실과 다르면 이용이 제한되고 그 책임은 보호자에게 있습니다.\n2. 자녀 앱을 처음 켤 때 **보호자의 동의와 자녀 본인의 동의를 모두** 받습니다. 둘 중 하나라도 없으면 위치 공유는 시작되지 않습니다.\n3. 서비스는 **만 9세 이상**의 자녀만 이용할 수 있습니다. 만 8세 이하 아동에 대해서는 제공하지 않습니다.\n4. 동의는 설정에서 언제든지 철회할 수 있습니다. 일부(예: 제3자 제공)만 철회할 수도 있습니다.\n\n## 제5조 (개인위치정보의 수집·이용·제공)\n1. 수집 방법: 자녀 휴대폰의 위치 센서(GPS 등)로 앱이 직접 측정합니다.\n2. 이용 목적: 연결된 보호자에게 자녀 위치를 보여 주고 안전 알림을 보내기 위해서입니다. 다른 목적으로 쓰지 않습니다.\n3. 제공: 자녀가 연결한 보호자에게만 제공합니다. 제공할 때마다 자녀 앱의 맨 위 줄과 알림으로 \"부모님이 지금 내 위치를 보고 있어요\"를 알립니다.\n4. 보유: 개인정보 처리방침에 적은 기간이 지나면 지웁니다.\n5. 이용·제공 사실 확인 자료(시각·자녀·보호자·종류, 좌표 없음)는 법령에 따라 약 200일 보관합니다.\n\n## 제6조 (보호자의 의무)\n1. 자녀의 안전을 위한 목적으로만 서비스를 사용하고, 자녀가 아닌 사람(배우자·연인·직장 동료 등)의 위치를 몰래 확인하는 데 쓰지 않습니다.\n2. 자녀의 나이와 성숙도에 맞게 위치 확인의 이유와 방식을 자녀와 이야기합니다.\n3. 얻은 위치정보를 제3자에게 공개·전달하지 않습니다.\n\n## 제7조 (운영자의 의무)\n1. 개인위치정보를 목적 밖에 쓰거나 동의 없이 제3자에게 제공하지 않습니다.\n2. 개인위치정보를 안전하게 지키기 위해 기술적·관리적 조치를 합니다.\n3. 개인위치정보 관련 불만·요청은 {{OP_CONTACT}}에서 받고 신속히 처리합니다.\n\n## 제8조 (서비스의 한계)\n1. 위치는 GPS·네트워크 상태에 따라 오차가 있거나 늦을 수 있습니다.\n2. 서비스는 안전을 돕는 보조 수단이며, 사고·실종 등 긴급 상황에서는 **112·119에 먼저 신고**해야 합니다.\n3. 휴대폰 꺼짐·절전·권한 거부·통신 불량으로 위치가 오지 않을 수 있습니다.\n\n## 제9조 (서비스 중단·종료)\n운영자는 점검·장애·사업 사정으로 서비스를 중단할 수 있으며, 미리 알립니다. 종료할 때는 30일 전에 알리고 자료를 지웁니다.\n\n## 제10조 (연결 해제와 탈퇴)\n보호자와 자녀는 언제든 연결을 끊을 수 있고, 끊으면 해당 자녀의 위치 관련 자료가 즉시 삭제됩니다.\n\n## 제11조 (손해배상·면책)\n운영자의 고의·과실로 이용자에게 손해가 생기면 법령에 따라 배상합니다. 천재지변·통신사 장애 등 운영자가 통제할 수 없는 사유는 책임이 제한됩니다.\n\n## 제12조 (분쟁 해결)\n위치정보와 관련한 분쟁은 방송미디어통신위원회 또는 개인정보분쟁조정위원회에 조정을 신청할 수 있습니다. 관할 법원은 민사소송법에 따릅니다.\n\n## 부칙\n이 약관은 {{LEGAL_DATE}}부터 시행합니다.\n"};
// LEGAL-END
const escH = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inlineMd = (t) => escH(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
/** 아주 작은 마크다운 → HTML (제목 · 목록 · 표 · 인용 · 굵게만) */
function mdHtml(md) {
  const out = []; let list = '', tbl = false, first = true;
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = ''; } };
  const closeTbl = () => { if (tbl) { out.push('</table>'); tbl = false; first = true; } };
  for (const ln of md.split('\n')) {
    if (/^\|/.test(ln)) {
      closeList();
      if (/^\|[\s|:-]+\|?$/.test(ln)) continue;
      const cells = ln.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (!tbl) { out.push('<table>'); tbl = true; first = true; }
      out.push('<tr>' + cells.map((c) => (first ? '<th>' : '<td>') + inlineMd(c) + (first ? '</th>' : '</td>')).join('') + '</tr>'); first = false; continue;
    }
    closeTbl();
    let m;
    if ((m = /^(#{1,3}) (.*)$/.exec(ln))) { closeList(); out.push('<h' + m[1].length + '>' + inlineMd(m[2]) + '</h' + m[1].length + '>'); }
    else if ((m = /^- (.*)$/.exec(ln))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inlineMd(m[1]) + '</li>'); }
    else if ((m = /^\d+\. (.*)$/.exec(ln))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inlineMd(m[1]) + '</li>'); }
    else if ((m = /^> (.*)$/.exec(ln))) { closeList(); out.push('<p class="q">' + inlineMd(m[1]) + '</p>'); }
    else if (ln.trim() === '') closeList();
    else { closeList(); out.push('<p>' + inlineMd(ln) + '</p>'); }
  }
  closeList(); closeTbl();
  return out.join('\n');
}
/** /legal, /legal/privacy, /legal/terms — 로그인 없이 읽는 공개 쪽. 운영자 정보는 워커 변수(OP_NAME · OP_MGR · OP_CONTACT · LEGAL_DATE · LBS_NO)로 채운다. */
function legalPage(url, env) {
  const p = url.pathname.replace(/\/+$/, ''), e = env || {};
  const kind = p === '/legal/privacy' ? 'privacy' : p === '/legal/terms' ? 'terms' : '';
  const css = '<style>body{font-family:-apple-system,"Noto Sans KR",sans-serif;background:#f6f8fb;margin:0;color:#16202e;line-height:1.65}main{max-width:720px;margin:0 auto;padding:20px 18px 60px}h1{font-size:22px}h2{font-size:17px;margin-top:28px}p,li{font-size:14.5px}table{border-collapse:collapse;width:100%;font-size:13px;margin:10px 0}th,td{border:1px solid #d5dbe5;padding:6px 8px;text-align:left;vertical-align:top}th{background:#eaf0f8}.q{background:#fff3cd;border-radius:8px;padding:8px 12px;font-size:13px}code{background:#e9eef6;padding:1px 4px;border-radius:4px}a{color:#1d6fd6}@media(prefers-color-scheme:dark){body{background:#121418;color:#e6ebf2}th{background:#1d2430}th,td{border-color:#2b3441}code{background:#1d2430}a{color:#7db4ff}}</style>';
  const head = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">';
  const page = (title, inner) => new Response(head + '<title>' + title + '</title>' + css + '</head><body><main>' + inner + '</main></body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (!kind) return page('길동무 키즈 약관', '<h1>길동무 키즈</h1><ul><li><a href="/legal/privacy">개인정보 처리방침</a></li><li><a href="/legal/terms">위치기반서비스 이용약관</a></li></ul>');
  const val = { OP_NAME: e.OP_NAME, OP_MGR: e.OP_MGR, OP_CONTACT: e.OP_CONTACT, LEGAL_DATE: e.LEGAL_DATE, LEGAL_URL: url.origin + '/legal/privacy' };
  const missing = ['OP_NAME', 'OP_MGR', 'OP_CONTACT', 'LEGAL_DATE'].filter((k) => !val[k]);
  let md = LEGAL_DOCS[kind].replace(/\{\{(\w+)\}\}/g, (a, k) => (val[k] ? String(val[k]).slice(0, 200) : '(입력 전)'));
  if (kind === 'terms' && e.LBS_NO) md += '\n- 위치기반서비스사업 신고번호: ' + String(e.LBS_NO).slice(0, 60) + '\n';
  const warn = missing.length ? '<p class="q">운영자 정보가 아직 모두 입력되지 않은 문서입니다. (입력 전: ' + missing.join(', ') + ')</p>' : '';
  return page(kind === 'privacy' ? '개인정보 처리방침' : '위치기반서비스 이용약관', warn + mdHtml(md) + '<p style="margin-top:28px"><a href="/legal/' + (kind === 'privacy' ? 'terms' : 'privacy') + '">' + (kind === 'privacy' ? '위치기반서비스 이용약관 보기' : '개인정보 처리방침 보기') + '</a></p>');
}
async function handle(req, env, url) {
  const DB = env.DB, now = Date.now(), p = url.pathname, m = req.method;
  if (m === 'GET' && (p === '/legal' || p.startsWith('/legal/'))) return legalPage(url, env);          // s430: 공개 쪽(DB 를 건드리지 않는다)
  await init(DB);
  if (p === '/' || p === '/health') return J({ ok: true, name: 'gildongmu-kids', t: now });
  if (p === '/q' && m === 'GET') {              // 자녀 폰 QR 을 기본 카메라로 찍으면 열리는 안내 쪽: '길동무로 열기' 한 번이면 부모 앱이 바로 연결한다
    const k = String(url.searchParams.get('k') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 11);
    const deep = 'gildongmu-kids://pair?k=' + k;
    const intent = 'intent://pair?k=' + k + '#Intent;scheme=gildongmu-kids;package=com.dullyyj.subway;end';
    const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>길동무 키즈 연결</title>'
      + '<style>body{font-family:sans-serif;background:#f3f6fb;margin:0;padding:28px 20px;color:#16202e;text-align:center}.c{max-width:420px;margin:40px auto;background:#fff;border-radius:18px;padding:28px 20px;box-shadow:0 2px 14px #0001}'
      + 'h1{font-size:19px;margin:0 0 8px}p{font-size:14px;color:#5b6778;margin:6px 0}.k{font-size:26px;font-weight:700;letter-spacing:2px;margin:18px 0;color:#1d8fe6}a.b{display:block;background:#1d8fe6;color:#fff;text-decoration:none;font-weight:700;border-radius:12px;padding:15px;margin-top:18px;font-size:16px}</style></head><body><div class="c">'
      + '<h1>길동무 키즈 연결</h1><p>부모님 폰의 길동무 앱에서 열어 주세요</p><div class="k">' + (k || '----- -----') + '</div>'
      + '<a class="b" href="' + intent + '">길동무로 열기</a><p style="margin-top:16px">앱이 열리지 않으면 길동무 설정 → 길동무 키즈 연결에서 위 시크릿 키를 직접 넣어 주세요</p></div></body></html>';
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const body = m === 'POST' ? await req.json().catch(() => ({})) : {};

  if (p === '/reg' && m === 'POST') {          // 기기 등록(처음 한 번). 같은 아이디는 같은 비밀만 다시 쓸 수 있다
    const id = body.id, sec = body.sec, role = body.role;
    if (!okId(id) || !okSec(sec) || (role !== 'c' && role !== 'p')) return bad('형식이 맞지 않아요');
    const sh = await sha(sec);
    const ex = await DB.prepare('SELECT sh,role FROM devices WHERE id=?').bind(id).first();
    if (ex) return ex.sh === sh && ex.role === role ? J({ ok: true }) : bad('이미 쓰는 아이디예요', 403);
    await DB.prepare('INSERT INTO devices(id,role,sh,t) VALUES(?,?,?,?)').bind(id, role, sh, now).run();
    return J({ ok: true });
  }

  if (p.startsWith('/c/')) {
    const cid = await auth(req, DB, 'c');
    if (!cid) return bad('인증이 필요해요', 401);
    if (p === '/c/ft' && m === 'POST') return J(await saveFt(DB, cid, body.tk, now));
    if (p === '/c/pair' && m === 'POST') {        // 연결 비밀키(10분)
      let code = '';
      const r = crypto.getRandomValues(new Uint8Array(10));
      for (let i = 0; i < 10; i++) { if (i === 5) code += '-'; code += KEYS[r[i] % KEYS.length]; }
      await DB.batch([DB.prepare('DELETE FROM codes WHERE cid=?').bind(cid), DB.prepare('INSERT INTO codes(code,cid,exp) VALUES(?,?,?)').bind(code, cid, now + PAIR_TTL)]);
      return J({ ok: true, code, exp: now + PAIR_TTL });
    }
    if (p === '/c/consent' && m === 'POST') {       // 자녀 앱에서 보호자 · 본인 동의를 마쳤다(증빙으로 버전과 시각만 남긴다)
      const cv = Math.round(+body.v) || 0;
      if (cv < 1 || cv > 99) return bad('잘못된 요청이에요');
      await DB.prepare('INSERT INTO cons(cid,v,t) VALUES(?,?,?) ON CONFLICT(cid) DO UPDATE SET v=excluded.v,t=excluded.t').bind(cid, cv, now).run();
      return J({ ok: true });
    }
    if (p === '/c/loc' && m === 'POST') {         // 위치는 연결된 부모가 있을 때만, 가장 최근 한 건만 저장(바로 앞 위치도 하나 둔다: 가는 중인지 보려고)
      const la = +body.la, lo = +body.lo, acc = +body.acc || 0;
      if (!(la >= -90 && la <= 90 && lo >= -180 && lo <= 180) || (la === 0 && lo === 0)) return bad('위치가 맞지 않아요');
      const nl = await DB.prepare('SELECT (SELECT COUNT(*) FROM links WHERE cid=?) n, l.la la,l.lo lo,l.acc acc,l.t t,l.dn dn,l.hp hp,l.ap ap,l.mva mva,l.mvo mvo,l.mvt mvt,l.bt bt,l.mt mt,l.ha ha,l.hb hb,l.hat hat FROM (SELECT 1) x LEFT JOIN loc l ON l.cid=?').bind(cid, cid).first();          // s424: 연결 수 + 이전 위치를 한 번에(결과는 같고 DB 호출만 1번 적게)
      const n = nl ? nl.n : 0;
      const last = n > 0 && nl && nl.t != null ? nl : null;
      let mtNow = last ? last.mt : 0;
      const wch = n > 0 ? await watchOrCall(DB, cid, now) : null;                   // 실시간 보기(s393): 보는 중이면 보고를 촘촘히 받고 응답에 주기 종류를 실어 준다
      const bt = Number.isFinite(+body.bt) && +body.bt >= 0 && +body.bt <= 100 ? Math.round(+body.bt) : -1, ch = body.ch ? 1 : 0;
      if (last && now - last.t < (wch ? 1200 : 12000) && hav(last.la, last.lo, la, lo) < (wch ? 2 : 8)) return J({ ok: true, linked: n, same: 1, w: watchCode(wch, last.mt, now) });     // 거의 같은 자리 · 방금 보냈다 — 쓰지도 알리지도 않는다
      if (last && now - last.t < LOC_FRESH_MS) {   // 튄 위치 거르기(지도가 갑자기 멀리 갔다 오는 일): ① 방금 받은 것보다 훨씬 부정확한 위치 ② 몇 초 만에 1.5km 넘게 순간이동한 위치는 덮지 않는다(②는 120초 안에 그 근처에서 또 오면 진짜로 본다)
        const dd = hav(last.la, last.lo, la, lo), gap = Math.max(1, (now - last.t) / 1000);
        let skip = acc > LOC_POOR_M && acc > 2 * (last.acc || 0);
        if (!skip && dd > LOC_JUMP_M && dd / gap > LOC_JUMP_MS) {
          const h = locHold.get(cid);
          if (h && now - h.t < LOC_CONFIRM_MS && hav(h.la, h.lo, la, lo) < 300) locHold.delete(cid);
          else { locHold.set(cid, { la, lo, t: now }); skip = true; }
        }
        if (skip) return J({ ok: true, linked: n, same: 1, w: watchCode(wch, last.mt, now) });
        locHold.delete(cid);                       // 정상 위치가 이어졌다 — 보류해 둔 튄 위치는 잊는다(같은 튐이 되풀이돼도 확인으로 치지 않는다)
      }
      let slowOk = false;
      if (n > 0) {
        const lcols = [], lvals = [];                                       // 같은 요청에서 loc 의 다른 칸을 여러 번 바꾸던 것을 모아 한 번에 쓴다
        const lset = (c, v) => { lcols.push(c); for (const x of v) lvals.push(x); };
        await DB.prepare('INSERT INTO loc(cid,la,lo,acc,t,bt,ch) VALUES(?,?,?,?,?,?,?) ON CONFLICT(cid) DO UPDATE SET bt=excluded.bt,ch=excluded.ch,pla=CASE WHEN excluded.t-loc.t>=20000 THEN loc.la ELSE loc.pla END, plo=CASE WHEN excluded.t-loc.t>=20000 THEN loc.lo ELSE loc.plo END, plt=CASE WHEN excluded.t-loc.t>=20000 THEN loc.t ELSE loc.plt END, la=excluded.la,lo=excluded.lo,acc=excluded.acc,t=excluded.t').bind(cid, la, lo, acc, now, bt, ch).run();
        if (acc <= 60) {                                                       // 움직임 · 가는 방향: 기준점에서 max(8m, 오차) 넘게 벗어나면 움직이는 중 + 방향 계산(걷는 속도로 2.5초마다 보고해도 잡힌다). 25초 넘게 제자리면 기준점을 새로 잡는다
          if (!last || !last.hat) lset('ha=?,hb=?,hat=?', [la, lo, now]);
          else if (hav(last.ha, last.hb, la, lo) >= Math.max(8, acc)) { mtNow = now; lset('hd=?,hdt=?,mt=?,ha=?,hb=?,hat=?', [bearing(last.ha, last.hb, la, lo), now, now, la, lo, now]); }
          else if (now - last.hat > 25000) lset('ha=?,hb=?,hat=?', [la, lo, now]);
        }
        if (bt >= 0 && bt <= BATT_LOW && !ch && (!last || last.bt < 0 || last.bt > BATT_LOW || now - last.t > 30 * 60000)) later(battAlert(env, DB, cid, bt, now));
        let pls2 = await tripsSync(DB, cid, now);
        if (!pls2) pls2 = (await DB.prepare('SELECT id,name,la,lo FROM places WHERE cid=?').bind(cid).all()).results || [];          // 기억만 보고 지나간 경우는 예전처럼 직접 읽는다(방금 등록한 장소를 놓치지 않게)
        const trs = await todayTrips(DB, cid, now);
        const tr = trs.filter((r) => !r.ta && hav(la, lo, r.la, r.lo) <= HERE_M);   // 장소 150m 안에 들어섰다 — 도착 시각 기록
        if (tr.length) await DB.batch(tr.map((r) => DB.prepare('UPDATE trips SET ta=? WHERE id=? AND ta=0').bind(now, r.id)));
        // '뭐하니?' 기록: 등록 장소 150m 안에 들어오거나(근처) 벗어나면(210m 밖 — 흔들림으로 들락거리지 않게), 동네 이름이 바뀌면 한 줄
        const dn = String(body.dn || '').replace(/\s+/g, ' ').trim().slice(0, 20), ohp = last ? last.hp || '' : '', odn = last ? last.dn || '' : '';
        let hp = '', hn = '', bd = HERE_M + 1;
        for (const q of pls2) { const dd = hav(la, lo, q.la, q.lo); if (dd <= HERE_M && dd < bd) { bd = dd; hp = q.id; hn = q.name; } }
        const oq = ohp ? pls2.find((q) => q.id === ohp) : null;
        if (oq && hav(la, lo, oq.la, oq.lo) <= HERE_M + 60) { hp = oq.id; hn = oq.name; }
        if (hp !== ohp || (dn && dn !== odn)) lset('dn=?,hp=?', [dn || odn, hp]);
        // 이동 이력: 한 점 쌓기(오차가 큰 위치는 건너뜀) + 많이 움직였으면 '이동 중' 활동 줄
        if (acc <= 150) {
          const cr = await DB.prepare('SELECT la,lo FROM locs WHERE cid=? ORDER BY id DESC LIMIT 1').bind(cid).first();
          if (!cr || hav(cr.la, cr.lo, la, lo) >= Math.max(CRUMB_M, acc)) await DB.prepare('INSERT INTO locs(cid,la,lo,t) VALUES(?,?,?,?)').bind(cid, la, lo, now).run();
        }
        let arrNow = false, arrCall = null;                                 // 이번 보고로 도착했다 — 같이 보내려던 '근처에 왔어요' 알림은 건너뛴다
        if (acc <= 60) {                                                    // 도착: 등록 장소 50m 안(오차 60m 이하인 위치만)에 들어서면 도착 — 80m 넘게 벗어나야 다시 도착할 수 있다
          const oap = last ? last.ap || '' : '';
          let ap = '', an = '', ad = ARR_AUTO_M + 1;
          for (const q of pls2) { const dd = hav(la, lo, q.la, q.lo); if (dd <= ARR_AUTO_M && dd < ad) { ad = dd; ap = q.id; an = q.name; } }
          const oaq = oap ? pls2.find((q) => q.id === oap) : null;
          if (oaq && hav(la, lo, oaq.la, oaq.lo) <= ARR_AUTO_M + 30) { ap = oaq.id; an = oaq.name; }
          if (ap !== oap) {
            lset('ap=?', [ap]);
            if (ap) { arrNow = true; arrCall = () => later(arriveAuto(env, DB, cid, ap, an, now)); }
          }
        }
        let mvDm = 0;                                                       // 이동 기록 기준점(mva…) 갱신도 여기서 함께 모은다 — 활동 줄은 아래에서 남긴다
        if (acc <= 150) {
          if (!last || !last.mvt) lset('mva=?,mvo=?,mvt=?', [la, lo, now]);
          else { const dm = hav(last.mva, last.mvo, la, lo); if (dm >= MV_EV_M && now - last.mvt >= MV_EV_GAP) { mvDm = dm; lset('mva=?,mvo=?,mvt=?', [la, lo, now]); } }
        }
        if (lcols.length) await DB.prepare('UPDATE loc SET ' + lcols.join(',') + ' WHERE cid=?').bind(...lvals, cid).run();      // s426: 위치 표 갱신을 한 문장으로(예전엔 최대 5번 따로)
        if (arrCall) arrCall();
        let rtSaved = false;
        if (acc <= 150) { try { rtSaved = await routeStep(env, DB, cid, la, lo, now, last ? last.t : 0, hn || dn || odn); } catch (e) { /* 경로 보관이 위치 저장을 막지 않는다 */ } }
        let evd = false;
        if (hp !== ohp) {
          if (hp) { await ev(DB, cid, 'at', hn, now); evd = true; if (!arrNow) later(zoneAlert(env, DB, cid, 'at', hp, hn, now)); }
          else if (oq) { await ev(DB, cid, 'lv', oq.name, now); evd = true; later(zoneAlert(env, DB, cid, 'lv', oq.id, oq.name, now)); }
        }
        else if (last && dn && dn !== odn) { await ev(DB, cid, 'loc', dn, now); evd = true; }
        if (mvDm && !evd) { await ev(DB, cid, 'mv', ((dn || odn) ? (dn || odn) + ' · ' : '') + fmtDist(mvDm), now); evd = true; }
        if (rtSaved) { await bump(DB, cid); evd = true; }                 // 지난 경로가 하나 늘었다 — 부모 화면의 '지난 경로' 줄이 바로 바뀐다
        if (!evd) {                                  // 제자리(15m 안)에서 보낸 위치는 1분에 한 번만 부모 화면을 깨운다 — 가만히 있을 때 화면이 계속 다시 그려지지 않게
          const lb = locBumpAt.get(cid) || 0;
          if (wch && ((last ? hav(last.la, last.lo, la, lo) : 1e9) >= 15 || now - lb >= 1500)) { locBumpAt.set(cid, now); await bump(DB, cid); }      // s426: 부모가 키즈 화면을 보는 중일 때만 깨운다(1.5초마다). 아무도 안 보면 쓰지 않는다 — 부모가 앱을 열면 어차피 현재 위치를 새로 받는다
        }
        if (!wch && acc <= 150 && last && hav(last.la, last.lo, la, lo) < 100 && (!mtNow || now - mtNow >= SLOW_STILL_MS)) {      // s426: 가만히 있다 → 장소·약속과 멀면 보고 주기를 늘려도 된다
          slowOk = !pls2.some((q) => hav(la, lo, q.la, q.lo) <= SLOW_PLACE_M) && !trs.some((r) => { if (r.tc) return false; const eta = etaOf(r, now); return now >= eta - SLOW_LEAD_MS && now < eta + STAY; });
        }
      }
      let sl = 0;                                   // s426: 보고 주기를 늘려도 되는 때(아래 조건이 모두 맞을 때만). 하나라도 어긋나면 원래 주기.
      if (n > 0 && !wch && acc <= 150 && slowOk) sl = 1;
      return J(sl ? { ok: true, linked: n, w: watchCode(wch, mtNow, now), sl: 1 } : { ok: true, linked: n, w: watchCode(wch, mtNow, now) });
    }
    if (p === '/c/ev' && m === 'POST') {          // 자녀 앱이 알리는 활동(밥 · 놀기 · 공부 · 잠 · 응가) — 연결된 부모가 있을 때만, 같은 일은 60초에 한 번만
      const k = String(body.k || ''), x = String(body.x || '').replace(/\s+/g, ' ').trim().slice(0, 12);
      if (['play', 'study', 'sleep', 'poop'].includes(k)) return J({ ok: true, linked: await linkedCount(DB, cid) });      // 옛 앱: 친구들 행동은 더 이상 기록하지 않는다
      if (!EVK.has(k) || !x) return bad('형식이 맞지 않아요');
      const n = await linkedCount(DB, cid);
      if (n > 0 && !(await DB.prepare('SELECT 1 a FROM evs WHERE cid=? AND k=? AND x=? AND t>? LIMIT 1').bind(cid, k, x, now - 60000).first())) await ev(DB, cid, k, x, now);
      return J({ ok: true, linked: n });
    }
    if (p === '/c/wear' && m === 'POST') {        // s423: 자녀가 꾸민 모습을 알린다 — 바뀐 때만 저장하고 연결된 부모 앱에 조용한 알림
      const w = String(body.w || '');
      if (!wearOk(w)) return bad('형식이 맞지 않아요');
      const old = await DB.prepare('SELECT w FROM wear WHERE cid=?').bind(cid).first();
      if (!old || old.w !== w) {
        await DB.prepare('INSERT INTO wear(cid,w,t) VALUES(?,?,?) ON CONFLICT(cid) DO UPDATE SET w=excluded.w,t=excluded.t').bind(cid, w, now).run();
        if ((await linkedCount(DB, cid)) > 0) later(wearPush(env, DB, cid, w));
      }
      return J({ ok: true });
    }
    if (p === '/c/call' && m === 'POST') {        // 자녀가 긴급 호출 · 안전하게 도착 · 데리러 와줘 를 누른다(op:'cancel' 은 긴급 호출 · 데리러 와줘 취소)
      const r = await callRequest(env, DB, cid, body, now);
      return r.err ? bad(r.err) : J(r);
    }
    if (p === '/c/share' && m === 'POST') {       // 자녀가 위치 공유를 켜고 끈다고 알린다 — 끄면 부모에게 알리고, 끈 동안은 '위치 끊김' 알림을 보내지 않는다
      const on = body.on ? 1 : 0;
      await DB.prepare('INSERT OR IGNORE INTO cst(cid) VALUES(?)').bind(cid).run();
      const prev = ((await DB.prepare('SELECT sh FROM cst WHERE cid=?').bind(cid).first()) || { sh: 1 }).sh;
      await DB.prepare('UPDATE cst SET sh=?,stl=0 WHERE cid=?').bind(on, cid).run();
      if (prev !== on && (await linkedCount(DB, cid)) > 0) {
        await bump(DB, cid);
        later(notifyParents(env, DB, cid, (nm) => ({ k: 'share', title: '길동무', body: who(nm) + (on ? ' 위치 공유를 다시 켰어요' : ' 위치 공유를 껐어요'), tag: 'share' })));
      }
      return J({ ok: true });
    }
    if (p === '/c/unlink' && m === 'POST') {      // 자녀가 모든 연결을 끊는다(위치도 함께 지운다)
      await DB.batch([DB.prepare('DELETE FROM links WHERE cid=?').bind(cid), DB.prepare('DELETE FROM loc WHERE cid=?').bind(cid), DB.prepare('DELETE FROM locs WHERE cid=?').bind(cid), DB.prepare('DELETE FROM routes WHERE cid=?').bind(cid), DB.prepare('DELETE FROM rtst WHERE cid=?').bind(cid), DB.prepare('DELETE FROM cst WHERE cid=?').bind(cid), DB.prepare('DELETE FROM stops WHERE cid=?').bind(cid), DB.prepare('DELETE FROM zt WHERE k LIKE ?').bind(cid + ':%'), DB.prepare('DELETE FROM drafts WHERE cid=?').bind(cid), DB.prepare('DELETE FROM codes WHERE cid=?').bind(cid), DB.prepare('DELETE FROM places WHERE cid=?').bind(cid), DB.prepare('DELETE FROM trips WHERE cid=?').bind(cid), DB.prepare('DELETE FROM cheers WHERE cid=?').bind(cid), DB.prepare('DELETE FROM evs WHERE cid=?').bind(cid), DB.prepare('DELETE FROM calls WHERE cid=?').bind(cid)]);
      await bump(DB, cid);
      return J({ ok: true });
    }
    if (p === '/c/state' && m === 'GET') return J(Object.assign({ ok: true, rev: await revOf(DB, cid) }, await childState(DB, cid, now)));
    if (p === '/c/ws' && m === 'GET') {           // s426: 초인종 연결(켜져 있고 이 자녀가 대상일 때만 · 아니면 404 — 앱은 예전 긴 대기를 그대로 쓴다)
      const hub = wsOn(env, cid) ? famHub(cid) : null;
      if (!hub) return bad('없어요', 404);
      return hub.fetch(new Request('https://hub/ws', req));
    }
    if (p === '/c/wait' && m === 'GET') {         // 바뀔 때까지 붙들어 두었다가 새 묶음을 준다(자녀 앱이 늘 이걸 걸어 둔다)
      const since = +url.searchParams.get('since') || 0, tab = url.searchParams.get('tab'), qt = url.searchParams.get('qt');
      if (tab === 'chat' && url.searchParams.get('fg') === '1') await markRd(DB, cid, 'c');      // 자녀 앱이 앞에 떠서 대화 탭을 보는 중(fg=1) = 부모 글을 읽는 중
      const ws = wsOn(env, cid), nw = ws && url.searchParams.get('nw') === '1';      // nw=1: 초인종이 이어져 있다 — 붙들지 않고 지금 값으로 바로 답한다
      const rev = nw ? await revOf(DB, cid) : await waitRev(DB, cid, since, now);
      if (nw && rev === since) return J({ ok: true, rev, same: 1, ws: 1, wa: WS_WAIT_MS });
      const b = await childBundle(DB, cid, tab, qt, Date.now(), rev);
      return J(ws && b && typeof b === 'object' ? Object.assign({}, b, { ws: 1, wa: WS_WAIT_MS }) : b);
    }
    if (p === '/c/screen' && m === 'GET') {
      if (url.searchParams.get('tab') === 'chat' && url.searchParams.get('fg') === '1') await markRd(DB, cid, 'c');
      const s = await screenOf(DB, cid, url.searchParams.get('tab'), url.searchParams.get('qt'), now);
      return s ? J({ ok: true, screen: s, linked: await linkedCount(DB, cid), rev: await revOf(DB, cid) }) : bad('없는 화면이에요', 404);
    }
    if (p === '/c/act' && m === 'POST') {         // 눌림 · 보내기를 처리하고 새 화면과 상태를 돌려준다
      const v = typeof body.v === 'string' ? body.v : '', arg = txt(body.arg), tab = body.tab, qt = body.qt;
      await prune(DB, cid, now);
      let notice = '', changed = true;
      if (v === 'chat.send' && arg) {
        await DB.prepare('INSERT INTO chat(cid,f,x,t) VALUES(?,?,?,?)').bind(cid, 'c', arg, now).run();
        await markRd(DB, cid, 'c');
        later(notifyParents(env, DB, cid, (nm) => ({ k: 'chat', title: nm || '길동무 키즈', body: cut(arg, 80), tag: 'chat' })));
      } else if (v === 'quest.send' && arg) {        // 부모님 미션 보내기: 길동무포인트 SEND_COST 가 있어야 한다(아직 대기 중인 것의 몫은 미리 빼 둔다)
        const have = await starsOf(DB, cid);
        const waiting = (await DB.prepare("SELECT COUNT(*) n FROM quests WHERE cid=? AND k='p' AND s=?").bind(cid, QS_WAIT).first())?.n || 0;
        if (have - waiting * SEND_COST < SEND_COST) { notice = '길동무포인트가 모자라요 (한 번에 ' + SEND_COST + ' 필요)'; changed = false; }
        else {
          await DB.prepare('INSERT INTO quests(id,cid,k,x,s,t,pt,fl) VALUES(?,?,?,?,0,?,?,1)').bind(rid(), cid, 'p', arg, now, SEND_COST).run();
          later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '길동무', body: who(nm) + ' 부모님 미션을 보냈어요. 승낙해 주세요: ' + cut(arg, 40), tag: 'quest' })));
        }
      } else if (v.startsWith('quest.accept:') || v.startsWith('quest.reject:')) {      // 자녀 미션(부모가 준 것): 자녀가 승낙(진행) 또는 거절
        const yes = v.startsWith('quest.accept:'), qid = v.slice(13);
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s=?").bind(yes ? QS_ON : QS_NO, qid, cid, QS_WAIT).run();
        if (r && r.meta && r.meta.changes > 0) later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '길동무', body: who(nm) + (yes ? ' 미션을 승낙했어요' : ' 미션을 거절했어요'), tag: 'quest' })));
        else changed = false;
      } else if (v.startsWith('quest.fin:')) {      // 자녀 미션: 자녀가 해냈다고 완료를 누른다 — 부모가 확인하면 길동무포인트가 올라간다
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s=?").bind(QS_REP, v.slice(10), cid, QS_ON).run();
        if (r && r.meta && r.meta.changes > 0) later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '길동무', body: who(nm) + ' 미션을 완료했대요. 확인해 주세요', tag: 'quest' })));
        else changed = false;
      } else if (v.startsWith('quest.confirm:') || v.startsWith('quest.pdone:')) {      // 부모님 미션: 부모님이 완료한 것을 자녀가 확인하면 끝(완료)
        const qid = v.startsWith('quest.confirm:') ? v.slice(14) : v.slice(12);
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_DONE, qid, cid, QS_REP).run();
        if (r && r.meta && r.meta.changes > 0) later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '길동무', body: who(nm) + ' 부모님 미션 완료를 확인했어요', tag: 'quest' })));
        else changed = false;
      } else if (v.startsWith('quest.done:')) {   // 옛 자녀 앱: 자녀가 해냈다고 알린다 — 부모가 길동무에서 확인해야 길동무포인트가 오른다
        const qd = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s IN (0,1)").bind(QS_REP, v.slice(11), cid).run();
        if (qd && qd.meta && qd.meta.changes > 0) later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '길동무', body: who(nm) + ' 미션을 해냈대요. 확인해 주세요', tag: 'quest' })));
      } else if (v.startsWith('trip.')) {         // 장소 알림: 확인(그냥 끔) · 출발 · 도착 확인(100m 안에서 길동무포인트 10)
        const kind = v.slice(5, v.indexOf(':')), id = v.slice(v.indexOf(':') + 1);
        const tr = await DB.prepare('SELECT t.st st, t.pl pl, p.name name, p.la la, p.lo lo FROM trips t JOIN places p ON p.id=t.pl WHERE t.id=? AND t.cid=?').bind(id, cid).first();
        if (!tr) changed = false;
        else if (kind === 'ok' && tr.st === 'due') await DB.prepare("UPDATE trips SET st='seen', tk=? WHERE id=? AND st='due'").bind(now, id).run();
        else if (kind === 'go' && (tr.st === 'due' || tr.st === 'seen')) { await DB.prepare("UPDATE trips SET st='go', td=? WHERE id=? AND st IN ('due','seen')").bind(now, id).run(); notice = tr.name + '에 도착하면 포인트가 쌓여요'; const tid = id; later(ev(DB, cid, 'go', tr.name, now)); if (await once(DB, tid, 2)) { const tn = tr.name, kn = tn; later(notifyParents(env, DB, cid, (nm) => ({ k: 'go', title: '길동무', body: who(nm) + ' ' + kn + '로 출발했어요', tag: 'trip' + tid }))); } }
        else if (kind === 'arrive' && tr.st === 'go') {
          const loc = await DB.prepare('SELECT la,lo,t FROM loc WHERE cid=?').bind(cid).first();
          if (!loc || now - loc.t > LOC_FRESH) { notice = '위치를 확인하는 중이에요. 잠시 뒤에 다시 눌러요'; changed = false; }
          else if (hav(loc.la, loc.lo, tr.la, tr.lo) > ARR_M) { notice = '아직 ' + tr.name + '에 도착하지 않았어요'; changed = false; }
          else {
            const r = await DB.prepare("UPDATE trips SET st='done', tc=?, ta=CASE WHEN ta=0 THEN ? ELSE ta END WHERE id=? AND st='go'").bind(now, now, id).run();
            if (r && r.meta && r.meta.changes > 0) { const paid3 = await arrivePay(DB, cid, tr.pl, now); notice = tr.name + '에 도착했어요!' + (paid3 ? ' 길동무포인트 ' + ARRIVE_PT + '점을 받았어요' : ''); const tn = tr.name, tid = id; later(ev(DB, cid, 'done', tn, now)); if (await once(DB, tid, 4)) later(notifyParents(env, DB, cid, (nm) => ({ k: 'done', title: '길동무', body: who(nm) + ' ' + tn + '에 도착했어요' + (paid3 ? ' (포인트 +' + ARRIVE_PT + ')' : ''), tag: 'trip' + tid }))); }
          }
        } else changed = false;
      } else changed = false;
      if (changed) await bump(DB, cid);
      return J(Object.assign({ notice }, await childBundle(DB, cid, tab, qt, now, await revOf(DB, cid))));
    }
    return bad('없는 길이에요', 404);
  }

  if (p.startsWith('/p/')) {
    if (p === '/p/join' && m === 'POST') {        // 부모 길동무 앱이 QR/비밀키로 연결 (먼저 /reg 로 role p 등록)
      const pid = await auth(req, DB, 'p');
      if (!pid) return bad('인증이 필요해요', 401);
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      const row = await DB.prepare('SELECT cid,exp FROM codes WHERE code=?').bind(code).first();
      if (!row || row.exp < now) return bad('키가 맞지 않거나 시간이 지났어요', 404);
      if (!(await isLinked(DB, row.cid, pid)) && (await linkedCount(DB, row.cid)) >= MAX_PARENTS) return bad('연결할 수 있는 부모 수를 넘었어요', 409);
      const nm = typeof body.nm === 'string' ? body.nm.replace(/\s+/g, '').slice(0, 8) : '';
      await DB.batch([DB.prepare('INSERT OR IGNORE INTO links(cid,pid,t,nm) VALUES(?,?,?,?)').bind(row.cid, pid, now, nm), DB.prepare('DELETE FROM codes WHERE code=?').bind(code)]);
      if (nm) await DB.prepare('UPDATE links SET nm=? WHERE cid=? AND pid=?').bind(nm, row.cid, pid).run();
      await bump(DB, row.cid);                   // 자녀 앱이 곧바로 '연결됐어요' 를 받는다
      later(notifyChild(env, DB, row.cid, { k: 'link', title: '길동무 키즈', body: '부모님과 연결됐어요', tag: 'link' }));
      locAskAt.set(row.cid, now);                                                       // 연결 직후에도 위치를 한 번 바로 받아 온다(허브가 또 묻지 않게 3분 표시)
      later(notifyChild(env, DB, row.cid, { k: 'locreq', tag: 'locreq' }));
      return J({ ok: true, cid: row.cid });
    }
    const pid = await auth(req, DB, 'p');
    if (!pid) return bad('인증이 필요해요', 401);
    if (p === '/p/ft' && m === 'POST') return J(await saveFt(DB, pid, body.tk, now));
    if (p === '/p/children' && m === 'GET') {
      const rows = (await DB.prepare('SELECT l.cid cid, l.nm nm, o.la la, o.lo lo, o.acc acc, o.t t, COALESCE(s.n,0) stars FROM links l LEFT JOIN loc o ON o.cid=l.cid LEFT JOIN stars s ON s.cid=l.cid WHERE l.pid=?').bind(pid).all()).results || [];
      if (!(await gdOk(DB, pid))) rows.forEach((r) => { r.la = null; r.lo = null; r.acc = null; r.t = null; });          // 법정대리인 확인 전에는 위치를 주지 않는다
      return J({ ok: true, children: rows });
    }
    if (p === '/p/setrow' && m === 'GET') { const [nodes, start, wr] = await Promise.all([settingsRow(DB, pid, url.searchParams.get('kn') === '1'), startPref(DB, pid), wearFor(DB, pid, url.searchParams.get('cid') || '')]); return J({ ok: true, nodes, start, tab: KIDS_TAB, w: wr.w }); }          // s423: 같이 꾸민 모습(w)도 — 앱을 켤 때마다 하던 이 한 번의 통신으로 받는다     // 설정 탭에 끼울 한 줄(연결 없으면 null)
    if (p === '/p/wear' && m === 'GET') {         // s423: 연결된 자녀가 꾸민 모습(없으면 빈 글) — 부모 앱이 홈 장면에 입힌다
      const wr = await wearFor(DB, pid, url.searchParams.get('cid') || '');
      return J({ ok: true, cid: wr.cid, w: wr.w });
    }
    if (p === '/p/screen' && m === 'GET') {       // 부모 화면 묶음: v = hub · chat · quest · link
      const v = url.searchParams.get('v') || 'hub', cid0 = url.searchParams.get('cid') || '';
      if (v === 'link') return J({ ok: true, screen: await linkSheet(DB, pid, '') });
      const kids = await childrenOf(DB, pid);
      const cid = kids.some((k) => k.cid === cid0) ? cid0 : kids[0] ? kids[0].cid : '';
      if (!cid) return J({ ok: true, linked: 0, screen: await hubScreen(DB, pid, '', now) });
      if (v === 'cheer') return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await cheerSheet(DB, pid, cid, '') });
      if (v === 'chat' || v === 'fam') await markRd(DB, cid, 'p');                    // 대화방을 열었다 = 자녀 글을 읽었다(허브 미리 받기 v=hub 는 읽음이 아니다)
      if (v === 'chat') return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await chatSheet(DB, pid, cid, now) });
      if (v === 'fam') return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await famScreen(DB, pid, cid, now) });
      if (v === 'quest') return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await questSheet(DB, pid, cid, url.searchParams.get('qt')) });
      if (v === 'hub' && await gdOk(DB, pid)) { await watchTouch(env, DB, pid, cid, now); await askLoc(env, DB, cid, now); await lbsLog(DB, cid, pid, 'v', now, 60000); }                // 보는 중 표시(+ 새로 보기 시작하면 자녀 폰에 watch 푸시) · 위치가 없거나 오래됐으면 자녀 폰에 한 번 요청
      return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await hubScreen(DB, pid, cid, now), pop: v === 'hub' ? await popOf(DB, pid, cid, now) : null });
    }
    if (p === '/p/ws' && m === 'GET') {           // s426: 초인종 연결(부모) — 이 부모에게 연결된 자녀만, 켜져 있고 대상일 때만. 아니면 404
      const cid0 = url.searchParams.get('cid') || '';
      const hub = (await childrenOf(DB, pid)).some((k) => k.cid === cid0) && wsOn(env, cid0) ? famHub(cid0) : null;
      if (!hub) return bad('없어요', 404);
      return hub.fetch(new Request('https://hub/ws', req));
    }
    if (p === '/p/wait' && m === 'GET') {         // 바뀔 때까지 붙들어 두었다가 그 화면을 새로 준다(부모 앱이 보는 화면마다 건다)
      const v = url.searchParams.get('v') || 'hub', cid0 = url.searchParams.get('cid') || '', since = +url.searchParams.get('since') || 0;
      const kids0 = await childrenOf(DB, pid);
      const cid = kids0.some((k) => k.cid === cid0) ? cid0 : kids0[0] ? kids0[0].cid : '';
      if (!cid) return J({ ok: true, linked: 0, rev: 0 });
      if (v === 'hub' || v === 'chat' || v === 'fam') await markRd(DB, cid, 'p');         // 부모 앱이 키즈 화면을 보는 동안에만 긴 대기를 건다 — 그동안은 자녀 글을 읽는 중
      if (v === 'hub' && await gdOk(DB, pid)) { await watchTouch(env, DB, pid, cid, now); await lbsLog(DB, cid, pid, 'v', now, 60000); }                          // 실시간 보기(s393): 대기가 이어져 있는 동안 '보는 중'
      const ws = wsOn(env, cid), nw = ws && url.searchParams.get('nw') === '1';      // s426: nw=1 — 초인종이 이어져 있다. 붙들지 않고 지금 값으로 바로 답한다(보는 중 표시 · 읽음은 위에서 그대로 처리)
      const rev = nw ? await revOf(DB, cid) : await waitRev(DB, cid, since, now);
      if (nw && rev === since) return J({ ok: true, rev, cid, same: 1, ws: 1, wa: v === 'hub' ? WS_HUB_WAIT_MS : WS_WAIT_MS });
      const t2 = Date.now(), kids = await childrenOf(DB, pid);
      if (!kids.some((k) => k.cid === cid)) return J({ ok: true, linked: kids.length, rev, gone: true });
      const screen = v === 'cheer' ? await cheerSheet(DB, pid, cid, '') : v === 'chat' ? await chatSheet(DB, pid, cid, t2) : v === 'fam' ? await famScreen(DB, pid, cid, t2) : v === 'quest' ? await questSheet(DB, pid, cid, url.searchParams.get('qt')) : await hubScreen(DB, pid, cid, t2);
      return J(Object.assign({ ok: true, linked: kids.length, rev, cid, screen, pop: v === 'hub' ? await popOf(DB, pid, cid, t2) : null }, ws ? { ws: 1, wa: v === 'hub' ? WS_HUB_WAIT_MS : WS_WAIT_MS } : {}));
    }
    if (p === '/p/act' && m === 'POST') {         // 부모가 누른 것 · 보낸 것. 화면은 엔진이 다시 짜서 돌려준다
      const v = typeof body.v === 'string' ? body.v : '', id = typeof body.id === 'string' ? body.id : '', t = typeof body.t === 'string' ? body.t : '';
      const f = body.f && typeof body.f === 'object' ? body.f : {};
      const kids = await childrenOf(DB, pid);
      const cid1 = typeof body.cid === 'string' ? body.cid : '';
      const cid = kids.some((k) => k.cid === (id || cid1)) && v.startsWith('kl.') ? id : kids.some((k) => k.cid === cid1) ? cid1 : kids[0] ? kids[0].cid : '';
      const R = (o) => J(Object.assign({ ok: true }, o));
      // 법정대리인 확인(s394): 하기 전에는 위치와 관련된 동작을 받지 않는다
      if (v === 'kg.ok') {
        if (!cid) return R({ close: true });
        await DB.prepare('INSERT INTO gd(pid,v,t) VALUES(?,?,?) ON CONFLICT(pid) DO UPDATE SET v=excluded.v,t=excluded.t').bind(pid, GD_VER, now).run();
        await bump(DB, cid);
        return R({ screen: await hubScreen(DB, pid, cid, now), cid, hub: 1 });
      }
      if (/^k(r|pg|p|pl|ps|d|x)\./.test(v) && !(await gdOk(DB, pid))) return R({ close: true, hub: 1 });
      if (v === 'kx.open') {                          // s415: 허브의 호출 줄을 눌렀다 — 그 호출의 팝업(앱이 그림)
        const pop = await popOf(DB, pid, cid, now);
        return R(pop ? { pop, cid } : { hub: 1 });
      }
      if (v === 'kx.ack' || v === 'kx.done') {          // 부모가 긴급 호출 · 데리러 와줘 를 확인했다 / 끝났다 — s415: 앱은 누르자마자 팝업을 닫는다. 여기서는 최소한만 하고 자녀에게 바로 알린다(화면은 앱이 따로 받는다)
        if (!cid || !t) return R({ hub: 1 });
        const ack = v === 'kx.ack';
        const [r, c] = await Promise.all([
          DB.prepare('UPDATE calls SET st=?,at=? WHERE id=? AND cid=? AND st=?').bind(ack ? 1 : 3, now, String(t), cid, ack ? 0 : 1).run(),
          DB.prepare('SELECT k FROM calls WHERE id=?').bind(String(t)).first(),
        ]);
        if (r && r.meta && r.meta.changes > 0) {
          if (c) later(notifyChild(env, DB, cid, ack ? { k: 'callack', title: '길동무 키즈', body: callAck(c.k), tag: 'callack' } : { k: 'calldone', title: '길동무 키즈', body: callDone(c.k), tag: 'calldone' }));
          await bump(DB, cid);
        }
        return R({ hub: 1, cid });
      }
      // 연결 관리
      if (v === 'kl.open') return R({ screen: await linkSheet(DB, pid, '') });
      if (v === 'kl.close') return R({ close: true });
      if (v === 'kl.start') {                      // 설정 토글: 키즈 화면으로 시작
        if (!kids.length) return R({ start: 0 });
        await DB.prepare('UPDATE devices SET kh=? WHERE id=?').bind(t === '1' ? 1 : 0, pid).run();
        return R({ start: t === '1' ? 1 : 0 });
      }
      if (v === 'kl.join') {
        let code = String(t || f.klc || '').trim().toUpperCase();
        { const raw = code.replace(/[^A-Z0-9]/g, ''); if (raw.length === 10) code = raw.slice(0, 5) + '-' + raw.slice(5); }          // 하이픈 없이 10자리로 와도 XXXXX-XXXXX 로 맞춘다
        if (!code) return R({ screen: await linkSheet(DB, pid, '시크릿 키를 입력해 주세요') });
        const row = await DB.prepare('SELECT cid,exp FROM codes WHERE code=?').bind(code).first();
        if (!row || row.exp < now) return R({ screen: await linkSheet(DB, pid, '키가 맞지 않거나 시간이 지났어요') });
        if (!(await isLinked(DB, row.cid, pid)) && (await linkedCount(DB, row.cid)) >= MAX_PARENTS) return R({ screen: await linkSheet(DB, pid, '연결할 수 있는 부모 수를 넘었어요') });
        const nm = String(f.kln || '').replace(/\s+/g, '').slice(0, 8);
        await DB.batch([DB.prepare('INSERT OR IGNORE INTO links(cid,pid,t,nm) VALUES(?,?,?,?)').bind(row.cid, pid, now, nm), DB.prepare('DELETE FROM codes WHERE code=?').bind(code)]);
        if (nm) await DB.prepare('UPDATE links SET nm=? WHERE cid=? AND pid=?').bind(nm, row.cid, pid).run();
        const pn0 = String(f.kpn || '').replace(/\s+/g, ' ').trim().slice(0, 8);
        if (pn0) await DB.prepare('UPDATE links SET pnm=? WHERE pid=?').bind(pn0, pid).run();
        else { const old = await pnOf(DB, pid); if (old) await DB.prepare('UPDATE links SET pnm=? WHERE cid=? AND pid=?').bind(old, row.cid, pid).run(); }
        await bump(DB, row.cid);
        later(notifyChild(env, DB, row.cid, { k: 'link', title: '길동무 키즈', body: '부모님과 연결됐어요', tag: 'link' }));
        return R({ screen: await linkSheet(DB, pid, '연결됐어요'), linked: 1, notice: '길동무 키즈와 연동되었습니다' });
      }
      if (v === 'kl.pname') {                      // 부모가 자기 이름을 정한다(연결된 모든 자녀에게 같은 이름)
        const pn = String(f.kpn || '').replace(/\s+/g, ' ').trim().slice(0, 8);
        await DB.prepare('UPDATE links SET pnm=? WHERE pid=?').bind(pn, pid).run();
        for (const k of kids) await bump(DB, k.cid);
        return R({ screen: await linkSheet(DB, pid, pn ? '이름을 저장했어요' : '이름을 지웠어요'), notice: '저장했어요' });
      }
      if (v === 'kl.name' && kids.some((k) => k.cid === id)) {
        const nm = String(f['kn_' + id.slice(0, 12)] || '').replace(/\s+/g, '').slice(0, 8);
        await DB.prepare('UPDATE links SET nm=? WHERE cid=? AND pid=?').bind(nm, id, pid).run();
        await bump(DB, id);
        return R({ screen: await linkSheet(DB, pid, '이름을 저장했어요'), notice: '저장했어요' });
      }
      if (v === 'kl.unlink' && kids.some((k) => k.cid === id)) {
        await DB.prepare('DELETE FROM links WHERE cid=? AND pid=?').bind(id, pid).run();
        if ((await linkedCount(DB, id)) === 0) await DB.batch([DB.prepare('DELETE FROM loc WHERE cid=?').bind(id), DB.prepare('DELETE FROM locs WHERE cid=?').bind(id), DB.prepare('DELETE FROM routes WHERE cid=?').bind(id), DB.prepare('DELETE FROM rtst WHERE cid=?').bind(id), DB.prepare('DELETE FROM cst WHERE cid=?').bind(id), DB.prepare('DELETE FROM stops WHERE cid=?').bind(id), DB.prepare('DELETE FROM zt WHERE k LIKE ?').bind(id + ':%'), DB.prepare('DELETE FROM drafts WHERE cid=?').bind(id), DB.prepare('DELETE FROM places WHERE cid=?').bind(id), DB.prepare('DELETE FROM trips WHERE cid=?').bind(id), DB.prepare('DELETE FROM cheers WHERE cid=?').bind(id), DB.prepare('DELETE FROM evs WHERE cid=?').bind(id), DB.prepare('DELETE FROM calls WHERE cid=?').bind(id)]);
        await bump(DB, id);
        const left = await childrenOf(DB, pid);
        return R({ screen: await linkSheet(DB, pid, '연결을 끊었어요'), linked: left.length, notice: '연결을 끊었어요' });
      }
      if (!cid) return bad('연결된 자녀가 없어요', 403);
      // 가족 대화
      if (v === 'kn.open') return R({ screen: await kidMenuSheet(DB, pid) });                  // 설정 > 길동무 키즈 팝업
      if (v === 'km.open') return R({ screen: await kidMarkerSheet(DB, pid) });                // 마커 변경 팝업 (사진 고르기 · 기본으로는 앱이 이 폰 안에서 처리)
      if (v === 'kh.cheer') return R({ screen: await cheerSheet(DB, pid, kids.some((k) => k.cid === id) ? id : cid, ''), cid: kids.some((k) => k.cid === id) ? id : cid, sheet: 'cheer' });
      if (v === 'kh.ca' || v === 'kh.cd') {
        const c2 = kids.some((k) => k.cid === id) ? id : cid;
        if (!c2) return R({ close: true });
        let note = '';
        if (v === 'kh.ca') {
          const x = (typeof f.kch === 'string' ? f.kch : '').replace(/\s+/g, ' ').trim().slice(0, CHEER_LEN);
          const n = (await DB.prepare('SELECT COUNT(*) n FROM cheers WHERE cid=?').bind(c2).first())?.n || 0;
          if (!x) note = '문구를 적어 주세요';
          else if (n >= MAX_CHEER) note = '응원문구는 최대 ' + MAX_CHEER + '개까지예요';
          else { await DB.prepare('INSERT INTO cheers(cid,x,t) VALUES(?,?,?)').bind(c2, x, now).run(); await bump(DB, c2); }
        } else { await DB.prepare('DELETE FROM cheers WHERE id=? AND cid=?').bind(Math.round(Number(t)) || 0, c2).run(); await bump(DB, c2); }
        return R({ screen: await cheerSheet(DB, pid, c2, note), cid: c2, sheet: 'cheer', clear: 'kch' });
      }
      if (v === 'kc.open') { await markRd(DB, cid, 'p'); return R({ screen: await chatSheet(DB, pid, cid, now), cid, sheet: 'chat' }); }
      if (v === 'kd.open') return R({ screen: await evSheet(DB, pid, cid, now), cid, sheet: 'ev' });
      if (v === 'kps.open') return R({ screen: await placesSheet(DB, cid), cid, sheet: 'ev' });
      // 장소 등록(s392)
      if (v === 'kpg.open') {
        const [cn0, l0] = await Promise.all([DB.prepare('SELECT COUNT(*) n FROM places WHERE cid=?').bind(cid).first(), DB.prepare('SELECT la,lo FROM loc WHERE cid=?').bind(cid).first()]);      // s419: 두 조회를 함께
        if (((cn0) || { n: 0 }).n >= MAX_PLACES) return R({ close: true, notice: '장소는 ' + MAX_PLACES + '곳까지 등록할 수 있어요' });
        const la0 = l0 ? l0.la : 37.5665, lo0 = l0 ? l0.lo : 126.978;
        await saveDraft(DB, pid, cid, la0, lo0, '', '', now);
        return R({ screen: regSheet({ la: la0, lo: lo0, name: '', q: '' }, null, l0 ? '' : '자녀 위치를 아직 몰라요. 주소를 찾아 주세요'), cid, sheet: 'ev' });
      }
      if (v.startsWith('kpg.')) {
        // s419: 초안이 없어도(열기 답이 늦어 아직 못 만들었어도) 팝업을 닫지 않고 그 자리에서 만든다
        if (v === 'kpg.cancel') { await DB.prepare('DELETE FROM drafts WHERE pid=?').bind(pid).run(); return R({ close: true }); }
        let d = await readDraft(DB, pid);
        if (!d) {
          const l1 = await DB.prepare('SELECT la,lo FROM loc WHERE cid=?').bind(cid).first();
          d = { la: l1 ? l1.la : 37.5665, lo: l1 ? l1.lo : 126.978, name: '', q: '' };
          await saveDraft(DB, pid, cid, d.la, d.lo, '', '', now);
        }
        const name = typeof f.kpn === 'string' ? f.kpn.replace(/\s+/g, ' ').trim().slice(0, 20) : d.name;
        const xy = /^(-?\d{1,3}(?:\.\d+)?)\|(-?\d{1,3}(?:\.\d+)?)\|/.exec(String(t || ''));       // 앱이 결과에서 고른 곳을 직접 알려 준다(다시 찾지 않는다)
        if (v === 'kpg.map' && !xy) return R({});                      // 좌표 없이 온 지도 눌림(옛 앱)은 무시 — 팝업을 닫지 않는다
        if (xy && (v === 'kpg.pick' || v === 'kpg.sv' || v === 'kpg.map')) {
          const la9 = +xy[1], lo9 = +xy[2];
          if (!(Math.abs(la9) <= 85 && Math.abs(lo9) <= 180)) return R({});
          const q9 = typeof f.kpa === 'string' ? f.kpa.replace(/\s+/g, ' ').trim().slice(0, 60) : (d.q || '');
          await saveDraft(DB, pid, cid, la9, lo9, name || String(t).split('|').slice(2).join(' ').slice(0, 20), q9, now);
          return R({});                                   // 화면은 앱이 이미 고쳤다 — 저장만 하고 답은 비워 둔다
        }
        if (v === 'kpg.find') {
          const q = typeof f.kpa === 'string' ? f.kpa.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
          if (!q) { await saveDraft(DB, pid, cid, d.la, d.lo, name, '', now); return R({ screen: regSheet({ la: d.la, lo: d.lo, name, q: '' }, null, '찾을 주소나 장소를 적어 주세요'), cid, sheet: 'ev' }); }
          const res = await geoFind(q, [d.la, d.lo], env);
          if (!res.length) { await saveDraft(DB, pid, cid, d.la, d.lo, name, q, now); return R({ screen: regSheet({ la: d.la, lo: d.lo, name, q }, null, (res.err ? '검색 서버가 응답하지 않아요 (' + res.err + '). 잠시 뒤 다시 눌러 보세요' : '찾지 못했어요. 다른 말로 적어 보세요 (예: 시·구·동 + 건물 이름)')), cid, sheet: 'ev' }); }
          const nm2 = name || (res.length === 1 ? res[0].n.slice(0, 20) : '');
          await saveDraft(DB, pid, cid, res[0].la, res[0].lo, nm2, q, now);
          return R({ screen: regSheet({ la: res[0].la, lo: res[0].lo, name: nm2, q }, res, res.length > 1 ? '여러 곳이 나왔어요. 아래에서 고르세요' : ''), cid, sheet: 'ev' });
        }
        if (v === 'kpg.pick') {
          const res = d.q ? await geoFind(d.q, [d.la, d.lo], env) : [], i = Math.round(Number(t)), r = res[i];
          if (!r) return R({ screen: regSheet(d, null, '다시 찾아 주세요'), cid, sheet: 'ev' });
          await saveDraft(DB, pid, cid, r.la, r.lo, name || r.n.slice(0, 20), d.q, now);
          return R({ screen: regSheet(await readDraft(DB, pid), res, ''), cid, sheet: 'ev' });
        }
        if (v === 'kpg.add') {
          if (!name) { await saveDraft(DB, pid, cid, d.la, d.lo, '', d.q || '', now); return R({ screen: regSheet(Object.assign({}, d, { name: '' }), null, '장소 이름을 적어 주세요'), cid, sheet: 'ev' }); }
          if (((await DB.prepare('SELECT COUNT(*) n FROM places WHERE cid=?').bind(cid).first()) || { n: 0 }).n >= MAX_PLACES) return R({ close: true, notice: '장소는 ' + MAX_PLACES + '곳까지 등록할 수 있어요' });
          const xa = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(String(t || '')), la8 = xa && Math.abs(+xa[1]) <= 85 && Math.abs(+xa[2]) <= 180 ? +xa[1] : d.la, lo8 = xa && Math.abs(+xa[1]) <= 85 && Math.abs(+xa[2]) <= 180 ? +xa[2] : d.lo;      // 앱이 팝업에 보이는 지도 좌표를 같이 보낸다(초안 저장이 늦어도 어긋나지 않게)
          await DB.batch([DB.prepare('INSERT INTO places(id,cid,name,la,lo,hh,mm,days,t) VALUES(?,?,?,?,?,0,0,0,?)').bind(rid(), cid, name, la8, lo8, now), DB.prepare('DELETE FROM drafts WHERE pid=?').bind(pid)]);
          plCache.delete(cid);
          await bump(DB, cid);
          return R({ close: true, hub: 1, notice: name + ' 등록했어요 · 도착하거나 벗어나면 알려 드려요' });
        }
        return R({ close: true });
      }
      if (v === 'kr.open') return R({ screen: await rtSheet(DB, pid, cid, now, ''), cid, sheet: 'ev' });
      if (v === 'kr.live') { await DB.prepare('UPDATE devices SET rv=0,rvt=0 WHERE id=?').bind(pid).run(); return R({ screen: await hubScreen(DB, pid, cid, now), cid }); }
      if (/^kr\.\d{1,12}$/.test(v)) {                  // 지난 경로 하나를 골랐다 → 지도에 그린다(10분 동안 · 팝업은 닫는다)
        const rid_ = +v.slice(3), ok = await DB.prepare('SELECT 1 a FROM routes WHERE id=? AND cid=?').bind(rid_, cid).first();
        if (!ok) return R({ screen: await rtSheet(DB, pid, cid, now, '이미 지워진 경로예요'), cid, sheet: 'ev' });
        await DB.prepare('UPDATE devices SET rv=?,rvt=? WHERE id=?').bind(rid_, now, pid).run();
        return R({ screen: await hubScreen(DB, pid, cid, now), cid, close: true });
      }
      if (v === 'kh.say') {                         // 길동무 확인 화면 아래 입력줄에서 보낸 글
        const x = txt(f.khc);
        if (x) { await prune(DB, cid, now); const pn_ = await pnOf(DB, pid); await DB.prepare('INSERT INTO chat(cid,f,x,t,pn) VALUES(?,?,?,?,?)').bind(cid, 'p', x, now, pn_).run(); await bump(DB, cid); await markRd(DB, cid, 'p'); later(notifyChild(env, DB, cid, { k: 'chat', title: pn_ || '부모님', body: cut(x, 80), tag: 'chat' })); }
        return R({ cid, clear: 'khc', light: 1 });                  // 가볍게: 새 화면은 앱이 방금 그린 글(낙관적 표시)과 긴 대기(바뀜 0.6초 안)가 이어 받는다
      }
      if (v === 'kf.send') {                        // 커뮤니티 가족대화 본문에서 보낸 글
        const x = txt(f.kct);
        if (x) { await prune(DB, cid, now); const pn_ = await pnOf(DB, pid); await DB.prepare('INSERT INTO chat(cid,f,x,t,pn) VALUES(?,?,?,?,?)').bind(cid, 'p', x, now, pn_).run(); await bump(DB, cid); await markRd(DB, cid, 'p'); later(notifyChild(env, DB, cid, { k: 'chat', title: pn_ || '부모님', body: cut(x, 80), tag: 'chat' })); }
        return R({ screen: await famScreen(DB, pid, cid, now), cid, clear: 'kct' });
      }
      if (v === 'kc.send') {
        const x = txt(f.kct);
        if (x) { await prune(DB, cid, now); const pn_ = await pnOf(DB, pid); await DB.prepare('INSERT INTO chat(cid,f,x,t,pn) VALUES(?,?,?,?,?)').bind(cid, 'p', x, now, pn_).run(); await bump(DB, cid); await markRd(DB, cid, 'p'); later(notifyChild(env, DB, cid, { k: 'chat', title: pn_ || '부모님', body: cut(x, 80), tag: 'chat' })); }
        return R({ screen: await chatSheet(DB, pid, cid, now), cid, clear: 'kct' });
      }
      // 퀘스트
      if (v === 'kq.open') return R({ screen: await questSheet(DB, pid, cid, t), cid, sheet: 'quest', qt: t === 'p' ? 'p' : 'c' });
      if (v === 'kq.pt') return R({ screen: await questSheet(DB, pid, cid, 'c'), cid });      // 옛 앱 호환(새 앱은 점수 고르기를 기기에서 바로 처리한다)
      if (v === 'kq.tab') return R({ screen: await questSheet(DB, pid, cid, t), cid, qt: t === 'p' ? 'p' : 'c' });
      if (v === 'kq.send') {
        const x = txt(f.kqx);
        if (!x) return R({ screen: await questSheet(DB, pid, cid, 'c'), cid, notice: '미션 내용을 적어 주세요' });
        await prune(DB, cid, now);
        await DB.prepare('INSERT INTO quests(id,cid,k,x,s,t,pt,fl) VALUES(?,?,?,?,0,?,?,1)').bind(rid(), cid, 'c', x, now, pts(t)).run();
        await bump(DB, cid);
        later(notifyChild(env, DB, cid, { k: 'quest', title: '새 퀘스트', body: cut(x, 80) + ' · 승낙해 주세요', tag: 'quest' }));
        return R({ screen: await questSheet(DB, pid, cid, 'c'), cid, clear: 'kqx', notice: '미션을 보냈어요' });
      }
      if (v === 'kq.ok') {                          // 자녀 미션: 자녀가 완료했다고 한 것을 부모가 확인 → 종료 + 길동무포인트 지급
        const q = await DB.prepare("SELECT pt FROM quests WHERE id=? AND cid=? AND k='c' AND s=?").bind(id, cid, QS_REP).first();
        let notice = '확인할 수 있는 상태가 아니에요';
        if (q) {
          const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s=?").bind(QS_DONE, id, cid, QS_REP).run();
          if (r && r.meta && r.meta.changes > 0) { await addStars(DB, cid, q.pt || 1); notice = '길동무포인트 ' + (q.pt || 1) + '점을 줬어요'; await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'star', title: '길동무포인트', body: '미션을 해내서 길동무포인트 ' + (q.pt || 1) + '점을 받았어요', tag: 'quest' })); }
        }
        return R({ screen: await questSheet(DB, pid, cid, 'c'), cid, notice });
      }
      if (v === 'kq.redo') { const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s=?").bind(QS_ON, id, cid, QS_REP).run(); if (r && r.meta && r.meta.changes > 0) { await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'quest', title: '미션', body: '부모님이 다시 해 보래요', tag: 'quest' })); } return R({ screen: await questSheet(DB, pid, cid, 'c'), cid, notice: '다시 하게 돌려보냈어요' }); }
      if (v === 'kq.accept') {                      // 부모님 미션: 부모가 승낙 → 자녀 길동무포인트 SEND_COST 차감(모자라면 승낙되지 않는다)
        const q = await DB.prepare("SELECT pt FROM quests WHERE id=? AND cid=? AND k='p' AND s=?").bind(id, cid, QS_WAIT).first();
        let notice = '이미 처리한 미션이에요';
        if (q) {
          const cost = q.pt || SEND_COST;
          const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_ON, id, cid, QS_WAIT).run();
          if (r && r.meta && r.meta.changes > 0) {
            if (await takeStars(DB, cid, cost)) { notice = '승낙했어요 · 자녀 길동무포인트 ' + cost + ' 차감'; await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'quest', title: '미션 승낙', body: '부모님이 승낙했어요 · 길동무포인트 ' + cost + ' 차감', tag: 'quest' })); }
            else { await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_WAIT, id, cid, QS_ON).run(); notice = '자녀의 길동무포인트가 모자라서 승낙할 수 없어요'; }
          }
        }
        return R({ screen: await questSheet(DB, pid, cid, 'p'), cid, notice });
      }
      if (v === 'kq.reject') {                      // 부모님 미션: 거절(차감 없음)
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_NO, id, cid, QS_WAIT).run();
        if (r && r.meta && r.meta.changes > 0) { await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'quest', title: '미션', body: '부모님이 이번 미션은 어렵대요', tag: 'quest' })); }
        return R({ screen: await questSheet(DB, pid, cid, 'p'), cid, notice: '거절했어요' });
      }
      if (v === 'kq.fin') {                         // 부모님 미션: 부모가 해냈다고 완료 → 자녀가 확인해야 종료
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_REP, id, cid, QS_ON).run();
        if (r && r.meta && r.meta.changes > 0) { await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'quest', title: '미션 완료', body: '부모님이 미션을 해냈어요. 확인해 주세요', tag: 'quest' })); }
        return R({ screen: await questSheet(DB, pid, cid, 'p'), cid, notice: '자녀가 확인하면 완료돼요' });
      }
      if (v === 'kq.done') return R({ screen: await questSheet(DB, pid, cid, 'p'), cid, notice: '부모님이 완료를 누르고 자녀가 확인해요' });      // 옛 앱 호환
      // 장소 등록(지도를 3초 누르면 새 장소 · 핀을 누르면 고치기)
      if (v === 'kpl.new') {
        const [la, lo] = String(t).split(',').map(Number);
        if (!(la >= -85 && la <= 85 && lo >= -180 && lo <= 180) || (!la && !lo)) return bad('위치가 맞지 않아요');
        if (((await DB.prepare('SELECT COUNT(*) n FROM places WHERE cid=?').bind(cid).first()) || { n: 0 }).n >= MAX_PLACES) return R({ notice: '장소는 ' + MAX_PLACES + '곳까지 등록할 수 있어요' });
        await newDraft(DB, pid, cid, la, lo, now);
        return R({ screen: placeSheet({ pid, cid, pl: '', la, lo, name: '', hh: 16, mm: 0, days: 31 }, false), cid, sheet: 'place', haptic: 1 });          // 방금 만든 초안 값을 그대로 그린다(다시 읽지 않는다)
      }
      if (v.startsWith('kp.')) {
        const pl = await DB.prepare('SELECT * FROM places WHERE id=? AND cid=?').bind(v.slice(3), cid).first();
        if (!pl) return R({ notice: '없는 장소예요' });
        await DB.prepare('INSERT INTO drafts(pid,cid,pl,la,lo,name,hh,mm,days,t) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(pid) DO UPDATE SET cid=excluded.cid,pl=excluded.pl,la=excluded.la,lo=excluded.lo,name=excluded.name,hh=excluded.hh,mm=excluded.mm,days=excluded.days,t=excluded.t').bind(pid, cid, pl.id, pl.la, pl.lo, pl.name, pl.hh, pl.mm, pl.days, now).run();
        return R({ screen: placeSheet(await readDraft(DB, pid), true), cid, sheet: 'place' });
      }
      if (v.startsWith('kpl.')) {
        const d = await readDraft(DB, pid);
        if (!d) return R({ close: true });
        const name = typeof f.kpn === 'string' ? f.kpn.replace(/\s+/g, ' ').trim().slice(0, 20) : d.name;
        if (v === 'kpl.cancel') { await DB.prepare('DELETE FROM drafts WHERE pid=?').bind(pid).run(); return R({ close: true }); }
        if (v === 'kpl.t') {
          let mins = (d.hh * 60 + d.mm + (Math.round(Number(t)) || 0)) % 1440;
          if (mins < 0) mins += 1440;
          await DB.prepare('UPDATE drafts SET name=?,hh=?,mm=? WHERE pid=?').bind(name, Math.floor(mins / 60), mins % 60, pid).run();
        } else if (v === 'kpl.d') {
          const i = Math.round(Number(t));
          await DB.prepare('UPDATE drafts SET name=?,days=? WHERE pid=?').bind(name, i >= 0 && i < 7 ? d.days ^ (1 << i) : d.days, pid).run();
        } else if (v === 'kpl.del') {
          if (d.pl) { await DB.batch([DB.prepare('DELETE FROM places WHERE id=? AND cid=?').bind(d.pl, cid), DB.prepare('DELETE FROM trips WHERE pl=? AND cid=?').bind(d.pl, cid), DB.prepare('DELETE FROM drafts WHERE pid=?').bind(pid)]); await bump(DB, cid); }
          return R({ close: true, hub: 1, notice: '장소를 지웠어요' });
        } else if (v === 'kpl.save') {
          // 앱이 시각 · 요일을 팝업 안에서 바로 고치고 저장할 때 함께 보낸다(kpm=분 0~1439 · kpd=요일 비트 0~127). 없으면 서버 초안 값.
          const km = Number(f.kpm), kd = Number(f.kpd), dd = Object.assign({}, d);
          if (f.kpm !== undefined && Number.isInteger(km) && km >= 0 && km < 1440) { dd.hh = Math.floor(km / 60); dd.mm = km % 60; }
          if (f.kpd !== undefined && Number.isInteger(kd) && kd >= 0 && kd < 128) dd.days = kd;
          if (!name) { await DB.prepare('UPDATE drafts SET name=?,hh=?,mm=?,days=? WHERE pid=?').bind('', dd.hh, dd.mm, dd.days, pid).run(); return R({ screen: placeSheet(Object.assign({}, dd, { name: '' }), !!d.pl, '장소 이름을 적어 주세요'), cid }); }
          if (d.pl) await DB.prepare('UPDATE places SET name=?,la=?,lo=?,hh=?,mm=?,days=? WHERE id=? AND cid=?').bind(name, dd.la, dd.lo, dd.hh, dd.mm, dd.days, d.pl, cid).run();
          else await DB.prepare('INSERT INTO places(id,cid,name,la,lo,hh,mm,days,t) VALUES(?,?,?,?,?,?,?,?,?)').bind(rid(), cid, name, dd.la, dd.lo, dd.hh, dd.mm, dd.days, now).run();
          await DB.prepare('DELETE FROM drafts WHERE pid=?').bind(pid).run();
          plCache.delete(cid);
          await tripsSync(DB, cid, now);
          await bump(DB, cid);
          return R({ close: true, hub: 1, notice: name + ' 일정을 저장했어요' });
        }
        return R({ screen: placeSheet(await readDraft(DB, pid), !!d.pl), cid });
      }
      if (v.startsWith('kc.') && kids.some((k) => k.cid === v.slice(3))) return R({ screen: await hubScreen(DB, pid, v.slice(3), now), cid: v.slice(3) });   // 자녀 칩
      return bad('없는 행동이에요', 404);
    }
    const cid = body.cid || url.searchParams.get('cid');
    if (!okId(cid) || !(await isLinked(DB, cid, pid))) return bad('연결되지 않은 자녀예요', 403);
    if (p === '/p/loc' && m === 'GET') {
      if (!(await gdOk(DB, pid))) return J({ ok: true, loc: null });
      const r = await DB.prepare('SELECT la,lo,acc,t FROM loc WHERE cid=?').bind(cid).first();
      if (r) await lbsLog(DB, cid, pid, 'v', now, 60000);
      return J({ ok: true, loc: r || null });
    }
    if (p === '/p/chat' && m === 'GET') {
      const rows = (await DB.prepare('SELECT f,x,t FROM chat WHERE cid=? AND t>=? ORDER BY id ASC LIMIT ?').bind(cid, now - CHAT_KEEP, MAX_CHAT).all()).results || [];
      return J({ ok: true, chat: rows });
    }
    if (p === '/p/chat' && m === 'POST') {
      const x = txt(body.x);
      if (!x) return bad('내용이 없어요');
      await prune(DB, cid, now);
      const pn_ = await pnOf(DB, pid); await DB.prepare('INSERT INTO chat(cid,f,x,t,pn) VALUES(?,?,?,?,?)').bind(cid, 'p', x, now, pn_).run();
      await bump(DB, cid);
      later(notifyChild(env, DB, cid, { k: 'chat', title: pn_ || '부모님', body: cut(x, 80), tag: 'chat' }));
      return J({ ok: true });
    }
    if (p === '/p/quests' && m === 'GET') {       // s: 자녀 미션(k=c) 0 대기 · 1 자녀가 해냈다고 알림(확인 필요) · 2 확인함 / 부모님 미션(k=p) 0 대기 · 1 부모가 해냈다고 표시
      const rows = (await DB.prepare('SELECT id,k,x,s,pt,t FROM quests WHERE cid=? ORDER BY t DESC LIMIT ?').bind(cid, MAX_QUEST).all()).results || [];
      return J({ ok: true, quests: rows, stars: await starsOf(DB, cid) });
    }
    if (p === '/p/stars' && m === 'GET') return J({ ok: true, stars: await starsOf(DB, cid) });
    if (p === '/p/places' && m === 'GET') {
      const rows = (await DB.prepare('SELECT id,name,la,lo,hh,mm,days FROM places WHERE cid=? ORDER BY hh,mm').bind(cid).all()).results || [];
      return J({ ok: true, places: rows });
    }
    if (p === '/p/unlink' && m === 'POST') {
      await DB.batch([DB.prepare('DELETE FROM links WHERE cid=? AND pid=?').bind(cid, pid)]);
      if ((await linkedCount(DB, cid)) === 0) await DB.batch([DB.prepare('DELETE FROM loc WHERE cid=?').bind(cid), DB.prepare('DELETE FROM locs WHERE cid=?').bind(cid), DB.prepare('DELETE FROM routes WHERE cid=?').bind(cid), DB.prepare('DELETE FROM rtst WHERE cid=?').bind(cid), DB.prepare('DELETE FROM cst WHERE cid=?').bind(cid), DB.prepare('DELETE FROM stops WHERE cid=?').bind(cid), DB.prepare('DELETE FROM zt WHERE k LIKE ?').bind(cid + ':%'), DB.prepare('DELETE FROM drafts WHERE cid=?').bind(cid), DB.prepare('DELETE FROM places WHERE cid=?').bind(cid), DB.prepare('DELETE FROM trips WHERE cid=?').bind(cid), DB.prepare('DELETE FROM cheers WHERE cid=?').bind(cid), DB.prepare('DELETE FROM evs WHERE cid=?').bind(cid), DB.prepare('DELETE FROM calls WHERE cid=?').bind(cid)]);
      await bump(DB, cid);
      return J({ ok: true });
    }
    return bad('없는 길이에요', 404);
  }
  return bad('없는 길이에요', 404);
}

export { gdScreen };          // s415: 부모 앱이 첫 화면(보호자 확인 팝업)을 통신 없이 바로 띄우려고 이 모양을 복사해 간다 — 시험이 같은지 확인한다
export default {
  async scheduled(event, env, ctx) {
    CTX = ctx; ENVG = env;
    ctx.waitUntil(cron(env).catch(() => {}));
  },
  async fetch(req, env, ctx) {
    CTX = ctx; ENVG = env;
    try {
      return await handle(req, env, new URL(req.url));
    } catch (e) {
      return J({ ok: false, err: 'server', msg: String((e && e.message) || e).slice(0, 200) }, 500);
    }
  },
};
