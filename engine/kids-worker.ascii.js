// \uae38\ub3d9\ubb34 \ud0a4\uc988 \uc5d4\uc9c4 \u2014 Cloudflare Worker + D1 (\ubc14\uc778\ub529 \uc774\ub984: DB)
// \uae38\ub3d9\ubb34 \uc5d4\uc9c4(route-v2)\uacfc \ub530\ub85c \ub3cc\uc544\uac04\ub2e4. \uc790\ub140 \uc571\u00b7\ubd80\ubaa8(\uae38\ub3d9\ubb34) \uc571\uc740 \ud654\uba74\uc744 \ubc1b\uc544 \uadf8\ub9ac\uae30\ub9cc \ud558\uace0, \uacc4\uc0b0\u00b7\uc800\uc7a5\u00b7\ud310\ub2e8\u00b7\ubb38\uad6c\ub294 \ubaa8\ub450 \uc5ec\uae30\uc11c \ud55c\ub2e4.
// \uc778\uc99d: \uc694\uccad \uba38\ub9ac\uae00 x-id / x-sec (\uae30\uae30\uac00 \ucc98\uc74c \uc815\ud55c \uc544\uc774\ub514\uc640 \ube44\ubc00. \uc11c\ubc84\uc5d0\ub294 SHA-256 \ub9cc \uc800\uc7a5).
// \uc790\ub140 \uc571 = \uc5ed\ud560 c, \ubd80\ubaa8(\uae38\ub3d9\ubb34 \uc571) = \uc5ed\ud560 p.
// \ubbf8\uc158: k='c' \ub294 \ubd80\ubaa8\uac00 \uc790\ub140\uc5d0\uac8c \uc8fc\ub294 \ubbf8\uc158(\uc790\ub140 \ubbf8\uc158), k='p' \ub294 \uc790\ub140\uac00 \ubd80\ubaa8\uc5d0\uac8c \uc8fc\ub294 \ubbf8\uc158(\ubd80\ubaa8\ub2d8 \ubbf8\uc158).
//   \uc790\ub140 \ubbf8\uc158 s: 0 \ub300\uae30 -> 1 \uc790\ub140\uac00 \ud574\ub0c8\ub2e4\uace0 \uc54c\ub9bc(\ubd80\ubaa8 \ud655\uc778 \ub300\uae30) -> 2 \ubd80\ubaa8\uac00 \ud655\uc778(\uc2a4\ud0c0\ud3ec\uc778\ud2b8 \uc9c0\uae09)
//   \ubd80\ubaa8\ub2d8 \ubbf8\uc158 s: 0 \ub300\uae30 -> 1 \ubd80\ubaa8\uac00 \ud574\ub0c8\ub2e4\uace0 \ud45c\uc2dc (\uc2a4\ud0c0\ud3ec\uc778\ud2b8 \uc5c6\uc74c)
// \uc7a5\uc18c(places): \ubd80\ubaa8\uac00 \uc815\ud55c '\uadf8 \uc694\uc77c \u00b7 \uadf8 \uc2dc\uac01\uae4c\uc9c0 \uac00 \uc788\uc5b4\uc57c \ud558\ub294 \uacf3'. \uc2dc\uac01 30\ubd84 \uc804\uc5d0 \uc790\ub140\uc5d0\uac8c \uc54c\ub9bc(trip 'due') ->
//   \uc790\ub140 [\ud655\uc778](\uadf8\ub0e5 \ub054 'seen') / [\ucd9c\ubc1c]('go') -> \ub0a8\uc740 \uac70\ub9ac \uc54c\uc57d -> \ub3c4\ucc29\uc810 100m \uc548\uc5d0\uc11c [\ub3c4\ucc29 \ud655\uc778] -> 'done' + 50 \uc2a4\ud0c0\ud3ec\uc778\ud2b8.
// \uc2e4\uc2dc\uac04: \ubaa8\ub4e0 \ubc14\ub01c\uc740 rev(cid) \ub97c \uc62c\ub9ac\uace0, \uc571\uc740 /c/wait \u00b7 /p/wait \ub85c '\ubc14\ub014 \ub54c\uae4c\uc9c0' \ubd99\ub4e4\uc5b4 \ub450\uc5c8\ub2e4\uac00 \uace7\ubc14\ub85c \uc0c8 \ud654\uba74\uc744 \ubc1b\ub294\ub2e4(0.6\ucd08 \uc548).
const DAY = 86400000, KST = 9 * 3600000, CHAT_KEEP = 7 * DAY, PAIR_TTL = 10 * 60000, MAX_PARENTS = 4, MAX_TXT = 300, MAX_CHAT = 300, MAX_QUEST = 100, MAX_PT = 5, MAX_PLACES = 12, MAX_CHEER = 20, CHEER_LEN = 40;
const LEAD = 30 * 60000, STAY = 120 * 60000, PROMPT_AFTER = 60 * 60000, ARR_M = 100, HERE_M = 150, LOC_FRESH = 90000, ARRIVE_PT = 50, WAIT_MS = 15000, WAIT_STEP = 600;
const KEYS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WD = ['\uc6d4', '\ud654', '\uc218', '\ubaa9', '\uae08', '\ud1a0', '\uc77c'];

const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (m, s) => J({ ok: false, err: m }, s || 400);


// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \ud478\uc2dc(FCM HTTP v1) \u2014 \uc571\uc774 \uaebc\uc838 \uc788\uc5b4\ub3c4 \uc54c\ub9bc\uc774 \uac00\ub3c4\ub85d, \ubc14\ub010 \uc77c\uc744 \uae30\uae30 \ud1a0\ud070\uc73c\ub85c \ubcf4\ub0b8\ub2e4 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// \uc11c\ube44\uc2a4 \uacc4\uc815 \ud0a4(JSON \uc804\uccb4)\ub294 \uc6cc\ucee4 \ube44\ubc00\uac12 FCM_SA \uc5d0 \ub123\ub294\ub2e4. \uc5c6\uc73c\uba74 \ud478\uc2dc\ub9cc \uac74\ub108\ub6f0\uace0 \ub098\uba38\uc9c0\ub294 \uadf8\ub300\ub85c \ub3c8\ub2e4.
const MISS_AFTER = 5 * 60000;
let CTX = null;
function later(p) { const q = Promise.resolve(p).catch(() => {}); if (CTX && CTX.waitUntil) CTX.waitUntil(q); return q; }
const locBumpAt = new Map();
// \ubd80\ubaa8\uac00 \ucc98\uc74c \uc5f4\uc5c8\ub294\ub370(\uc571\uc744 \uc0c8\ub85c \uae54\uc558\uac70\ub098 \ub9c9 \uc5f0\uacb0) \uc790\ub140 \uc704\uce58\uac00 \uc5c6\uac70\ub098 \uc624\ub798\ub410\uc73c\uba74, \uc790\ub140 \ud3f0\uc5d0 '\uc704\uce58 \ud55c \ubc88 \uc62c\ub824' \ud478\uc2dc\ub97c \ubcf4\ub0b8\ub2e4(s390).
// \uc571\uc774 \uaebc\uc838 \uc788\uc5b4\ub3c4 \ud478\uc2dc\ub85c \uae68\uc5b4\ub098 \uc704\uce58\ub97c \ud55c \ubc88 \uc62c\ub9b0\ub2e4 \u2014 \uc704\uce58 \uacf5\uc720\uac00 \ucf1c\uc838 \uc788\uace0 \uc790\ub140 \ud3f0\uc774 \ub3d9\uc758\u00b7\uad8c\ud55c\uc744 \uc900 \uacbd\uc6b0\ub9cc. \uac19\uc740 \uc790\ub140\ub294 3\ubd84\uc5d0 \ud55c \ubc88\ub9cc \ubb3b\ub294\ub2e4.
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
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uc2e4\uc2dc\uac04 \ubcf4\uae30(s393) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// \ubd80\ubaa8 \uc571\uc774 \ud0a4\uc988 \ud654\uba74(\ud5c8\ube0c)\uc5d0 \uae34 \ub300\uae30\ub97c \uac78\uc5b4 \ub450\ub294 \ub3d9\uc548\ub9cc '\ubcf4\ub294 \uc911'\uc774\ub2e4(WATCH_MS \uc548\uc5d0 \ub300\uae30\uac00 \uc774\uc5b4\uc838 \uc788\uc73c\uba74). \ubcf4\uae30 \uc2dc\uc791\ud558\uba74 \uc790\ub140 \ud3f0\uc5d0 'watch' \ud478\uc2dc\ub97c \ubcf4\ub0b4 \uc571\uc774 \uaebc\uc838 \uc788\uc5b4\ub3c4 \uc704\uce58\ub97c \ube68\ub9ac \uc62c\ub9ac\uac8c \ud558\uace0,
// \uadf8 \ub4a4\ub85c\ub294 \uc790\ub140 \uc704\uce58 \ubcf4\uace0(/c/loc)\uc758 \uc751\ub2f5\uc5d0 w(\uc8fc\uae30 \uc885\ub958)\ub97c \uc2e4\uc5b4 \ubcf4\ub0b8\ub2e4: 1 = \uc6c0\uc9c1\uc774\ub294 \uc911 2.5\ucd08 \u00b7 2 = 15\ubd84 \ub118\uac8c \uc774\uc5b4 \ubd04 10\ucd08 \u00b7 3 = \uac00\ub9cc\ud788 \uc788\uc74c 15\ucd08 \u00b7 \uc5c6\uc74c = \ubcf4\ub294 \uc0ac\ub78c \uc5c6\uc74c(\uc6d0\ub798 \uc8fc\uae30).
// \uba87 \ucd08\ub9c8\ub2e4 \ubcf4\ub0bc\uc9c0 \u00b7 \uc5b8\uc81c \uba48\ucd9c\uc9c0\ub294 \uc11c\ubc84(\uc5d4\uc9c4)\uac00 \uc815\ud558\uace0 \uc790\ub140 \uc571\uc740 \uadf8\ub300\ub85c \ub530\ub978\ub2e4.
const WATCH_MS = 40000, WATCH_FAST_MS = 15 * 60000, WATCH_PUSH_GAP = 20000, MOVE_REC_MS = 60000;
const watchPushAt = new Map();
/** \uc774 \uc790\ub140\ub97c \uc9c0\uae08 \ubcf4\uace0 \uc788\ub294 \ubd80\ubaa8\uac00 \uc788\uc73c\uba74 {ws}(\uac00\uc7a5 \uba3c\uc800 \ubcf4\uae30 \uc2dc\uc791\ud55c \uc2dc\uac01), \uc5c6\uc73c\uba74 null */
async function watchOf(DB, cid, now) {
  const r = await DB.prepare('SELECT MIN(d.ws) ws FROM links l JOIN devices d ON d.id=l.pid WHERE l.cid=? AND d.wt>?').bind(cid, now - WATCH_MS).first();
  return r && r.ws ? { ws: r.ws } : null;
}
/** \ubd80\ubaa8\uac00 \ud0a4\uc988 \ud654\uba74\uc744 \ubcf4\uace0 \uc788\ub2e4\uace0 \uc801\ub294\ub2e4. \uc0c8\ub85c \ubcf4\uae30 \uc2dc\uc791\ud588\uc73c\uba74 \uc790\ub140 \ud3f0\uc5d0 'watch' \ud478\uc2dc. */
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
/** \uc790\ub140 \uc571\uc5d0 \uc54c\ub824 \uc904 \uc8fc\uae30 \uc885\ub958(\uc704 \uc124\uba85). \ubcf4\ub294 \uc0ac\ub78c\uc774 \uc5c6\uc73c\uba74 0. */
function watchCode(w, mt, now) {
  if (!w) return 0;
  if (now - w.ws > WATCH_FAST_MS) return 2;
  return mt && now - mt < MOVE_REC_MS ? 1 : 3;
}
/** \ub450 \uc810 \uc0ac\uc774 \uac00\ub294 \ubc29\ud5a5(\ub3c4 \u00b7 \ubd81\ucabd 0 \u00b7 \uc2dc\uacc4 \ubc29\ud5a5) */
function bearing(a, b, c, d) {
  const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r);
  return Math.round((Math.atan2(y, x) / r + 360) % 360) % 360;
}
const EV_KEEP = 3 * DAY, MAX_EV = 150;
// \uc774\ub3d9 \uc774\ub825(p-kids65): \uc790\ub140\uac00 \ubcf4\ub0b8 \uc704\uce58\ub97c CRUMB_M(40m, \uc624\ucc28\uac00 \ub354 \ud06c\uba74 \uc624\ucc28) \ub118\uac8c \uc6c0\uc9c1\uc600\uc744 \ub54c\ub9c8\ub2e4 \ud55c \uc810\uc529 \uc313\uc544 3\uc77c \ubcf4\uad00\ud558\uace0, \ubd80\ubaa8 \ud0a4\uc988 \ud0ed \uc9c0\ub3c4\uc5d0 \uc9c0\ub09c TRAIL_MS \uc758 \uacbd\ub85c(line)\ub85c \uadf8\ub9b0\ub2e4.
// \ud65c\ub3d9 \uc904 'mv'(\uc774\ub3d9 \uc911 \u00b7 \ub3d9\ub124 \u00b7 \uac70\ub9ac)\ub294 \ub9c8\uc9c0\ub9c9 \uc904\uc744 \ub0a8\uae34 \uc790\ub9ac\uc5d0\uc11c MV_EV_M(200m) \ub118\uac8c, \uadf8\ub9ac\uace0 MV_EV_GAP(2.8\ubd84) \ub118\uac8c \uc9c0\ub0ac\uc744 \ub54c\ub9cc \ub0a8\uae34\ub2e4.
const TRAIL_KEEP = 3 * DAY, TRAIL_MS = 6 * 3600000, MAX_TRAIL = 1500, TRAIL_PTS = 400, CRUMB_M = 40, MV_EV_M = 200, MV_EV_GAP = 170000;
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uc9c0\ub09c \uacbd\ub85c \ubcf4\uad00(s391): \ud55c \uacf3\uc5d0 30\ubd84 \ub118\uac8c \uba38\ubb3c\uba74 \uadf8 \uc804\uae4c\uc9c0 \uc774\ub3d9\ud55c \uae38\uc744 \ud55c \uac74\uc73c\ub85c \ub2eb\uc544 \uc790\ub140\ub2f9 10\uac1c\uae4c\uc9c0 \ub454\ub2e4(11\ubc88\uc9f8\ubd80\ud130 \uac00\uc7a5 \uc624\ub798\ub41c \uac83\uc744 \uc9c0\uc6b4\ub2e4) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// \uc815\uc9c0 = \uc704\uce58\uac00 \uc774\uc5b4\uc11c \ub4e4\uc5b4\uc624\ub294 \ub3d9\uc548 \ubc18\uacbd RT_DWELL_M(100m) \uc548\uc5d0 RT_DWELL_MS(30\ubd84) \ub118\uac8c. \ubcf4\uace0\uac00 RT_GAP_MS(20\ubd84) \ub118\uac8c \ub04a\uae30\uba74 '\uc815\uc9c0'\ub85c \uce58\uc9c0 \uc54a\ub294\ub2e4(\uaebc\uc84c\ub358 \ud3f0\uc73c\ub85c \uac00\uc9dc \uacbd\ub85c\ub97c \ub9cc\ub4e4\uc9c0 \uc54a\uac8c).
// \uc774\ub3d9 \uac70\ub9ac\uac00 RT_MIN_M(150m) \ubbf8\ub9cc\uc774\uba74 \uc800\uc7a5\ud558\uc9c0 \uc54a\ub294\ub2e4(\uc9d1 \uc548 \u00b7 GPS \ud754\ub4e4\ub9bc\uc774 10\uce78\uc744 \ucc44\uc6b0\uc9c0 \uc54a\uac8c). \uc810\uc740 RT_PTS(300)\uac1c \uc774\ud558\ub85c \uac04\ucd94\ub824 \ub454\ub2e4(\ud654\uba74 \uc9c0\ub3c4\uac00 400\uc810\uae4c\uc9c0 \ubc1b\ub294\ub2e4).
const RT_KEEP = 10, RT_MIN_M = 150, RT_DWELL_M = 100, RT_DWELL_MS = 30 * 60000, RT_GAP_MS = 20 * 60000, RT_PTS = 300, RT_VIEW_MS = 10 * 60000;
// \uc9c0\ub09c \uacbd\ub85c\ub294 10\uac1c\uc774\uba74\uc11c 7\uc77c(RT_MAX_AGE)\uc774 \uc9c0\ub098\uba74 \uc9c0\uc6b4\ub2e4(\uac1c\uc778\uc815\ubcf4: \uc624\ub798 \uc313\uc544 \ub450\uc9c0 \uc54a\ub294\ub2e4 \u2014 DESIGN.md 9\uc7a5 11\ubc88). \uba38\ubb38 \uacf3\uc740 30\uc77c(STRANGE_KEEP) \u00b7 \ub3c4\ucc29/\ucd9c\ubc1c \uc54c\ub9bc \uc2dc\uac01\uc740 \ud558\ub8e8.
const RT_MAX_AGE = 7 * 24 * 3600000;
// \u2500\u2500 routes:begin (\uc21c\uc218 \uacc4\uc0b0 \u2014 \uc2dc\ud5d8\uc774 \uc774 \uad6c\uac04\uc744 \ub5bc\uc5b4 \ub3cc\ub9b0\ub2e4) \u2500\u2500
/** \uc815\uc9c0 \uc0c1\ud0dc \ud55c \uac78\uc74c. st = {dla,dlo,dt,cl,rte,rsa,rso,sn,en}(\uc5c6\uc73c\uba74 null) \u00b7 lastT = \ubc14\ub85c \uc55e \ubcf4\uace0 \uc2dc\uac01(0 \uc774\uba74 \uc5c6\uc74c) \u00b7 name = \uc9c0\uae08 \uc788\ub294 \uacf3 \uc774\ub984.
 *  \ub3cc\ub824\uc8fc\ub294 \uac12 {st, close} \u2014 close = {t1, from:[la,lo]|null, since, sn, en} \uc774\uba74 '\uc9c0\uae08\uae4c\uc9c0\uc758 \uae38'\uc744 \ud55c \uac74\uc73c\ub85c \ub2eb\uc73c\ub77c\ub294 \ub73b(\uc810\uc740 \ud638\ucd9c\ud55c \ucabd\uc774 since \uc774\ud6c4 \u00b7 t1 \uc774\uc804 \uae30\ub85d\uc5d0\uc11c \uc77d\ub294\ub2e4). */
function rtNext(st, la, lo, now, lastT, name, hav) {
  if (!st) return { st: { dla: la, dlo: lo, dt: now, cl: 0, rte: 0, rsa: null, rso: null, sn: '', en: '' }, close: null };
  const n = Object.assign({}, st), d = hav(st.dla, st.dlo, la, lo);
  if (d <= RT_DWELL_M) {
    if (st.cl) return { st: n, close: null };                                   // \uc774\ubbf8 \ub2eb\uc740 \uc815\uc9c0 \u2014 \uac00\ub9cc\ud788 \uc788\ub294 \ub3d9\uc548\uc740 \uc544\ubb34 \uc77c \uc5c6\ub2e4
    if (lastT && now - lastT > RT_GAP_MS) { n.dla = la; n.dlo = lo; n.dt = now; return { st: n, close: null }; }    // \ubcf4\uace0\uac00 \ub04a\uacbc\ub2e4 \u2192 \uc5ec\uae30\uc11c \uc0c8\ub85c \uc13c\ub2e4
    if (now - st.dt >= RT_DWELL_MS) {
      n.cl = 1; n.en = name || '';
      return { st: n, close: { t1: st.dt, from: st.rsa == null ? null : [st.rsa, st.rso], to: [st.dla, st.dlo], since: st.rte, sn: st.sn || '', en: name || '' } };
    }
    return { st: n, close: null };
  }
  if (st.cl) {                                                                  // \ub2eb\ud78c \uc815\uc9c0\uc5d0\uc11c \ubc97\uc5b4\ub0ac\ub2e4 = \ucd9c\ubc1c: \uc0c8 \uae38\uc740 \ubc14\ub85c \uc55e \ubcf4\uace0 \uc774\ud6c4\uc758 \uae30\ub85d\ubd80\ud130
    return { st: { dla: la, dlo: lo, dt: now, cl: 0, rte: lastT || st.dt, rsa: st.dla, rso: st.dlo, sn: st.en || '', en: '' }, close: null };
  }
  n.dla = la; n.dlo = lo; n.dt = now;                                           // \uc6c0\uc9c1\uc774\ub294 \uc911 \u2014 \uae30\uc900\uc810\uc744 \ub530\ub77c \uc62e\uae34\ub2e4
  return { st: n, close: null };
}
/** \uc810\ub4e4\uc758 \uae38\uc774(m) */
function rtLen(pts, hav) { let m = 0; for (let i = 1; i < pts.length; i++) m += hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); return m; }
/** \uc810 \uac04\ucd94\ub9ac\uae30: \uc9c1\uc120\uc5d0\uc11c eps(m) \ub118\uac8c \ubc97\uc5b4\ub09c \uc810\ub9cc \ub0a8\uae30\ub294 Douglas-Peucker, \uadf8\ub798\ub3c4 max \ubcf4\ub2e4 \ub9ce\uc73c\uba74 eps \ub97c \ud0a4\uc6cc \ub2e4\uc2dc(\ucc98\uc74c\uacfc \ub05d\uc740 \ub298 \ub0a8\ub294\ub2e4) */
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
/** \ub2eb\uc744 \uae38\uc758 \uc810 \ubaa8\uc73c\uae30: \ucd9c\ubc1c \uc790\ub9ac + \uae30\ub85d\ub41c \uc810\ub4e4 + \uba48\ucd98 \uc790\ub9ac. RT_MIN_M(150m) \ubbf8\ub9cc\uc774\uba74 null(\uc800\uc7a5\ud558\uc9c0 \uc54a\ub294\ub2e4). */
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
// \u2500\u2500 routes:end \u2500\u2500
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uc548\uc804 \uc54c\ub9bc(s392) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// \uc704\uce58 \ub04a\uae40: \ubcf4\uace0\uac00 STALE_MS(20\ubd84) \ub118\uac8c \uc5c6\uc73c\uba74 \ubd80\ubaa8\uc5d0\uac8c \ud55c \ubc88(\ubc24 23~06\uc2dc\uc640 \uc790\ub140\uac00 \uacf5\uc720\ub97c \ub048 \ub3d9\uc548\uc740 \ubcf4\ub0b4\uc9c0 \uc54a\ub294\ub2e4) \u00b7 \ub2e4\uc2dc \ub4e4\uc5b4\uc624\uba74 \ub418\uc0b4\ub9b0\ub2e4. \ubc30\ud130\ub9ac 15% \uc774\ud558(\ucda9\uc804 \uc911 \uc544\ub2d8)\ub294 3\uc2dc\uac04\uc5d0 \ud55c \ubc88.
// \ub0af\uc120 \uacf3 \uc815\uc9c0: 30\ubd84 \ub118\uac8c \uba38\ubb38 \uacf3\uc774 \ub4f1\ub85d \uc7a5\uc18c 150m \ubc16\uc774\uace0 \ucd5c\uadfc 30\uc77c \uc548\uc5d0 \ub2e4\ub978 \ub0a0 2\ubc88 \ub118\uac8c \uba38\ubb38 \uc801\uc774 \uc5c6\uc73c\uba74 \uc54c\ub9b0\ub2e4(\ucc98\uc74c 3\uc77c\uc740 \ubc30\uc6b0\ub294 \uae30\uac04\uc774\ub77c \uc54c\ub9ac\uc9c0 \uc54a\ub294\ub2e4).
// \ub0a0\uc528: \uc544\uce68 7\uc2dc 30\ubd84 \uc774\ud6c4 \ud558\ub8e8 \ud55c \ubc88, \uc790\ub140\uac00 \uc788\ub294 \uacf3\uc758 \ub0ae(7~20\uc2dc) \uc608\ubcf4\uc5d0 \ube44 \u00b7 \ub208 \u00b7 \ud3ed\uc5fc \u00b7 \ud55c\ud30c \u00b7 \ubbf8\uc138\uba3c\uc9c0\uac00 \uc788\uc73c\uba74 \ubd80\ubaa8\uc5d0\uac8c.
const STALE_MS = 20 * 60000, BATT_LOW = 15, BATT_GAP = 3 * 3600000, STRANGE_LEARN_MS = 3 * DAY, STRANGE_KEEP = 30 * DAY, MAX_STOPS = 200, STRANGE_M = 200, WX_AT = 7 * 60 + 30;
// \u2500\u2500 wx:begin (\uc21c\uc218 \uacc4\uc0b0 \u2014 \uc2dc\ud5d8\uc774 \uc774 \uad6c\uac04\uc744 \ub5bc\uc5b4 \ub3cc\ub9b0\ub2e4) \u2500\u2500
/** \ub0ae(7~20\uc2dc) \uc608\ubcf4\uc5d0\uc11c \ubd80\ubaa8\uc5d0\uac8c \uc54c\ub9b4 \uac83\uc744 \uace0\ub978\ub2e4. w = Open-Meteo forecast.hourly \u00b7 aq = air-quality.hourly. \ub3cc\ub824\uc8fc\ub294 \uac12: [{k, s}] (\uc54c\ub9b4 \uac83\uc774 \uc5c6\uc73c\uba74 \ube48 \ubc30\uc5f4) */
function wxDecide(w, aq) {
  const out = [];
  const hrs = (h) => { const r = []; if (!h || !h.time) return r; h.time.forEach((t, i) => { const hh = +String(t).slice(11, 13); if (hh >= 7 && hh <= 20) r.push(i); }); return r; };
  const num = (a, idx) => idx.map((i) => (a && typeof a[i] === 'number' ? a[i] : null)).filter((v) => v !== null);
  if (w && w.time) {
    const ix = hrs(w), pp = num(w.precipitation_probability, ix), pr = num(w.precipitation, ix), sn = num(w.snowfall, ix), ap = num(w.apparent_temperature, ix);
    const maxP = pp.length ? Math.max(...pp) : 0, sumR = pr.reduce((a, b) => a + b, 0), sumS = sn.reduce((a, b) => a + b, 0);
    if (sumS >= 0.5) out.push({ k: 'snow', s: '\ub208\uc774 \uc640\uc694' });
    else if (maxP >= 60 || sumR >= 1) out.push({ k: 'rain', s: '\ube44\uac00 \uc640\uc694 (\uac15\uc218\ud655\ub960 ' + Math.round(maxP) + '%) \u00b7 \uc6b0\uc0b0' });
    if (ap.length && Math.max(...ap) >= 33) out.push({ k: 'heat', s: '\uccb4\uac10 ' + Math.round(Math.max(...ap)) + '\u00b0C \ud3ed\uc5fc \u00b7 \ubb3c\uacfc \uadf8\ub298' });
    if (ap.length && Math.min(...ap) <= -10) out.push({ k: 'cold', s: '\uccb4\uac10 ' + Math.round(Math.min(...ap)) + '\u00b0C \ud55c\ud30c \u00b7 \ub530\ub73b\ud558\uac8c' });
  }
  if (aq && aq.time) {
    const ix = hrs(aq), p25 = num(aq.pm2_5, ix), p10 = num(aq.pm10, ix);
    const m25 = p25.length ? Math.max(...p25) : 0, m10 = p10.length ? Math.max(...p10) : 0;
    if (m25 >= 76 || m10 >= 151) out.push({ k: 'dust', s: '\ubbf8\uc138\uba3c\uc9c0 \ub9e4\uc6b0 \ub098\uc068 \u00b7 \ub9c8\uc2a4\ud06c' });
    else if (m25 >= 36 || m10 >= 81) out.push({ k: 'dust', s: '\ubbf8\uc138\uba3c\uc9c0 \ub098\uc068 \u00b7 \ub9c8\uc2a4\ud06c' });
  }
  return out;
}
// \u2500\u2500 wx:end \u2500\u2500
/** \ub0af\uc120 \uacf3 \uc815\uc9c0\uc778\uc9c0 \ubcf4\uace0 \ub9de\uc73c\uba74 \ubd80\ubaa8\uc5d0\uac8c \uc54c\ub9b0\ub2e4. \uc815\uc9c0\uac00 \ub2eb\ud790 \ub54c\ub9c8\ub2e4 \ubd80\ub978\ub2e4(\uae38 \uc800\uc7a5 \uc5ec\ubd80\uc640 \uc0c1\uad00\uc5c6\uc774). */
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
  const where = (name || '').trim() || '\uc54c \uc218 \uc5c6\ub294 \uacf3';
  await ev(DB, cid, 'odd', where, now);
  await bump(DB, cid);
  later(notifyParents(env, DB, cid, (nm) => ({ k: 'odd', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' \ud3c9\uc18c\uc640 \ub2e4\ub978 \uacf3(' + where + ')\uc5d0\uc11c 30\ubd84 \ub118\uac8c \uba38\ubb3c\ub7ec \uc788\uc5b4\uc694 \u00b7 ' + clock(c.t1) + '\ubd80\ud130', tag: 'odd' })));
  return true;
}
/** \ubcf4\uace0\uac00 \uc62c \ub54c\ub9c8\ub2e4 \ubd80\ub978\ub2e4: \uc815\uc9c0 \ud310\uc815 \uc0c1\ud0dc\ub97c \ud55c \uac78\uc74c \uc62e\uae30\uace0, 30\ubd84 \uc815\uc9c0\uac00 \ud655\uc778\ub418\uba74 \uc9c0\uae08\uae4c\uc9c0\uc758 \uae38\uc744 \ud55c \uac74\uc73c\ub85c \uc800\uc7a5\ud55c\ub2e4. \uc800\uc7a5\ud588\uc73c\uba74 true. */
async function routeStep(env, DB, cid, la, lo, now, lastT, name) {
  const row = await DB.prepare('SELECT dla,dlo,dt,cl,rte,rsa,rso,sn,en FROM rtst WHERE cid=?').bind(cid).first();
  const r = rtNext(row || null, la, lo, now, lastT, name, hav);
  let saved = false;
  if (r.close) {
    const c = r.close;
    try { await strangeStop(env, DB, cid, c, name, now); } catch (e) { /* \uc54c\ub9bc\uc774 \uae38 \uc800\uc7a5\uc744 \ub9c9\uc9c0 \uc54a\ub294\ub2e4 */ }
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
const EVK = new Set(['feed', 'clean', 'drop', 'dress', 'psleep', 'pstudy', 'pplay']);       // \uc790\ub140 \uc571\uc774 \uc54c\ub824 \uc8fc\ub294 \ud65c\ub3d9 \u2014 \uc790\ub140\uac00 \uc9c1\uc811 \ud55c \uc77c\ub9cc(\uce5c\uad6c\ub4e4 \uc2a4\uc2a4\ub85c\uc758 \ub180\uae30\u00b7\uacf5\ubd80\u00b7\uc7a0\u00b7\uc751\uac00\ub294 \uae30\ub85d\ud558\uc9c0 \uc54a\ub294\ub2e4)
const EV_HIDE = "('play','study','sleep','poop')";                   // \uc61b \uc571\uc774 \ub0a8\uae34 \uce5c\uad6c\ub4e4 \ud589\ub3d9 \uc904\uc740 \ubcf4\uc774\uc9c0 \uc54a\uac8c \uac70\ub978\ub2e4
/** '\ubb50\ud558\ub2c8?' \ud65c\ub3d9 \ud55c \uc904\uc744 \ub0a8\uae34\ub2e4(k \uc885\ub958 \u00b7 x \uc7a5\uc18c/\ub3d9\ub124/\uce5c\uad6c \uc774\ub984). \ubd80\ubaa8 \ud654\uba74\uc774 \ubc14\ub85c \ubc14\ub00c\ub3c4\ub85d \uc54c\ub9b0\ub2e4 */
async function ev(DB, cid, k, x, now) {
  try { await DB.prepare('INSERT INTO evs(cid,k,x,t) VALUES(?,?,?,?)').bind(cid, k, String(x).slice(0, 40), now).run(); await bump(DB, cid); } catch (e) { /* \uae30\ub85d \uc2e4\ud328\ub294 \ubcf8 \uc77c\uc5d0 \uc601\ud5a5 \uc5c6\ub2e4 */ }
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
/** rows: [{id, ft, data}] \u2014 \ub370\uc774\ud130 \uba54\uc2dc\uc9c0(\ub192\uc740 \uc6b0\uc120\uc21c\uc704)\ub97c \ud55c \uae30\uae30\uc529 \ubcf4\ub0b8\ub2e4. \uc8fd\uc740 \ud1a0\ud070\uc740 \uc9c0\uc6b4\ub2e4. */
async function pushRows(env, DB, rows) {
  const sa = saOf(env);
  if (!sa || !rows.length) return 0;
  const at = await fcmAccess(sa);
  let ok = 0;
  await Promise.all(rows.map(async (r) => {
    const data = {};
    for (const k of Object.keys(r.data)) data[k] = String(r.data[k]).slice(0, 400);
    const res = await fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
      method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: r.ft, data, android: { priority: 'HIGH', ttl: '3600s' } } }),
    });
    if (res.ok) ok++;
    else if (res.status === 404 || res.status === 400) { const t = await res.text().catch(() => ''); if (/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(t)) await DB.prepare("UPDATE devices SET ft='' WHERE id=? AND ft=?").bind(r.id, r.ft).run(); }
  }));
  return ok;
}
async function notifyChild(env, DB, cid, data) {
  const d = await DB.prepare("SELECT id,ft FROM devices WHERE id=? AND ft<>''").bind(cid).first();
  if (d) await pushRows(env, DB, [{ id: d.id, ft: d.ft, data: Object.assign({ cid }, data) }]);
}
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \ubc95\uc815\ub300\ub9ac\uc778 \ud655\uc778 \u00b7 \uc704\uce58 \uc81c\uacf5 \uae30\ub85d(s394) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const GD_VER = 1, LBS_KEEP = 200 * 86400000;      // 6\uac1c\uc6d4(\uc57d 183\uc77c)\ubcf4\ub2e4 \uae38\uac8c
async function gdOk(DB, pid) { const r = await DB.prepare('SELECT v FROM gd WHERE pid=?').bind(pid).first(); return !!r && r.v >= GD_VER; }
/** \uc774\uc6a9 \u00b7 \uc81c\uacf5 \uc0ac\uc2e4 \ud55c \uc904(\uac19\uc740 \ubd80\ubaa8 \u00b7 \uc790\ub140 \u00b7 \uc885\ub958\ub294 gapMs \uc548\uc5d0\ub294 \ud55c \ubc88\ub9cc) */
async function lbsLog(DB, cid, pid, k, now, gapMs) {
  await DB.prepare('INSERT INTO lbs(t,cid,pid,k) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM lbs WHERE cid=? AND pid=? AND k=? AND t>?)').bind(now, cid, pid, k, cid, pid, k, now - (gapMs || 0)).run();
}
function gdScreen(nm) {
  return scr('kids', [], [
    tx('\ubcf4\ud638\uc790 \ud655\uc778', { size: 16, bold: true, pad: [16, 24, 16, 6] }),
    tx(nm + '\uc758 \uc704\uce58\ub97c \ubcf4\uae30 \uc804\uc5d0 \uc544\ub798\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.', { size: 12.5, color: 'sub', pad: [16, 0, 16, 8] }),
    panel([tx('\u2022 \uc800\ub294 \uc774 \uc790\ub140\uc758 \ubc95\uc815\ub300\ub9ac\uc778(\uce5c\uad8c\uc790 \u00b7 \ud6c4\uacac\uc778)\uc774\uc5d0\uc694', { size: 13, pad: [0, 4, 0, 4] }),
      tx('\u2022 \uc790\ub140\ub294 \ub9cc 9\uc138 \uc774\uc0c1\uc774\uc5d0\uc694', { size: 13, pad: [0, 4, 0, 4] }),
      tx('\u2022 \uc790\ub140\uc5d0\uac8c \uc704\uce58\ub97c \ud655\uc778\ud55c\ub2e4\ub294 \uac83\uc744 \uc54c\ub9ac\uace0, \uc790\ub140\ub3c4 \ub3d9\uc758\ud588\uc5b4\uc694 (\uc790\ub140 \uc571\uc5d0\uc11c \ub3d9\uc758\ud574\uc57c \uc704\uce58\uac00 \uc640\uc694)', { size: 13, pad: [0, 4, 0, 4] }),
      tx('\u2022 \uc790\ub140\uc758 \uc548\uc804\uc744 \uc9c0\ud0a4\ub294 \ub370\uc5d0\ub9cc \uc4f0\uace0, \ub2e4\ub978 \uc0ac\ub78c\uc758 \uc704\uce58\ub97c \ubab0\ub798 \ud655\uc778\ud558\ub294 \ub370 \uc4f0\uc9c0 \uc54a\uc544\uc694', { size: 13, pad: [0, 4, 0, 4] }),
      tx('\u2022 \uc0ac\uc2e4\uacfc \ub2e4\ub974\uba74 \uc774\uc6a9\uc774 \uc81c\ud55c\ub420 \uc218 \uc788\uace0 \ubc95\uc801 \ucc45\uc784\uc740 \uc81c\uac8c \uc788\uc5b4\uc694', { size: 13, pad: [0, 4, 0, 4] })], { pad: [12, 4, 12, 0], ip: [14, 10, 14, 10] }),
    tx('\uc774 \ud655\uc778\uc744 \ud55c \uc2dc\uac01\uc774 \uae30\ub85d\ub3fc\uc694. \uc790\uc138\ud55c \ub0b4\uc6a9\uc740 \uac1c\uc778\uc815\ubcf4 \ucc98\ub9ac\ubc29\uce68\uacfc \uc704\uce58\uae30\ubc18\uc11c\ube44\uc2a4 \uc774\uc6a9\uc57d\uad00\uc5d0 \uc788\uc5b4\uc694.', { size: 11, color: 'sub', pad: [16, 10, 16, 6] }),
    { t: 'row', gap: 8, pad: [12, 12, 12, 16], kids: [btn('\ubaa8\ub450 \ud655\uc778\ud588\uc5b4\uc694', call('kg.ok'), gold)] },
  ]);
}
/** \uc5f0\uacb0\ub41c \ubd80\ubaa8\ub9c8\ub2e4(\uc790\ub140 \uc774\ub984\uc740 \ubd80\ubaa8\uac00 \uc815\ud55c \uc774\ub984) \uae00\uc744 \ub530\ub85c \ub9cc\ub4e4\uc5b4 \ubcf4\ub0b8\ub2e4. mk(nm) => data */
async function notifyParents(env, DB, cid, mk, all) {      // all: \ubc95\uc815\ub300\ub9ac\uc778 \ud655\uc778 \uc804\uc778 \ubd80\ubaa8\uc5d0\uac8c\ub3c4 \ubcf4\ub0b8\ub2e4(\uae34\uae09 \ud638\ucd9c \u2014 \uc54c\ub9bc\uc5d0\ub294 \uc704\uce58\uac00 \uc5c6\uace0, \uc704\uce58\ub294 \ud655\uc778\uc744 \ub9c8\uccd0\uc57c \ubcf4\uc778\ub2e4)
  const rs = (all
    ? await DB.prepare("SELECT d.id id,d.ft ft,l.nm nm FROM links l JOIN devices d ON d.id=l.pid WHERE l.cid=? AND d.ft<>''").bind(cid).all()
    : await DB.prepare("SELECT d.id id,d.ft ft,l.nm nm FROM links l JOIN devices d ON d.id=l.pid JOIN gd g ON g.pid=l.pid AND g.v>=? WHERE l.cid=? AND d.ft<>''").bind(GD_VER, cid).all()).results || [];
  const now = Date.now();
  if (rs.length) await DB.batch(rs.map((r) => DB.prepare("INSERT INTO lbs(t,cid,pid,k) VALUES(?,?,?,'n')").bind(now, cid, r.id)));
  await pushRows(env, DB, rs.map((r) => ({ id: r.id, ft: r.ft, data: Object.assign({ cid }, mk(r.nm || '')) })));
}
const who = (nm) => (nm ? ga(nm) : '\uc790\ub140\uac00');
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uae34\uae09 \ud638\ucd9c \u00b7 \uc548\uc804\ud558\uac8c \ub3c4\ucc29 \u00b7 \ub370\ub9ac\ub7ec \uc640\uc918(s399) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// \uc790\ub140\uac00 \ub204\ub974\uba74(\uc790\ub140 \uc571 /c/call) \uc11c\ubc84\uac00 \uae30\ub85d\ud558\uace0 \ubd80\ubaa8\uc5d0\uac8c \uc54c\ub9b0\ub2e4. \uc54c\ub9bc \uae00\uc5d0\ub294 \uc88c\ud45c\uac00 \uc5c6\uace0(\uc7a5\uc18c \uc774\ub984\ub9cc), \uc88c\ud45c\ub294 \ubd80\ubaa8\uac00 \ud655\uc778\uc744 \ub9c8\uce5c \ud654\uba74\uc5d0\uc11c\ub9cc \ubcf4\uc778\ub2e4.
const CALL_GAP = { sos: 60000, pick: 5 * 60000, arr: 2 * 60000 };          // \uac19\uc740 \uac83\uc744 \uc774 \uc2dc\uac04 \uc548\uc5d0 \ub610 \ub204\ub974\uba74 \uc0c8\ub85c \ub9cc\ub4e4\uc9c0 \uc54a\ub294\ub2e4(\uc2e4\uc218\ub85c \uc5ec\ub7ec \ubc88 \ub20c\ub7ec\ub3c4 \uc54c\ub9bc \ud3ed\ud0c4 \uc5c6\uc74c)
const CALL_OPEN_MS = 3 * 3600000, CALL_KEEP = 7 * 86400000, CALL_NEAR_M = 150;
async function nearPlaceName(DB, cid, la, lo) {
  const ps = (await DB.prepare('SELECT name,la,lo FROM places WHERE cid=?').bind(cid).all()).results || [];
  let best = null, bd = CALL_NEAR_M + 1;
  for (const p of ps) { const d = hav(la, lo, p.la, p.lo); if (d < bd) { bd = d; best = p.name; } }
  return best || '';
}
const callAck = (k) => (k === 'sos' ? '\ubd80\ubaa8\ub2d8\uc774 \ud655\uc778\ud588\uc5b4\uc694' : '\ubd80\ubaa8\ub2d8\uc774 \ub370\ub9ac\ub7ec \uac00\uace0 \uc788\uc5b4\uc694');
async function callRequest(env, DB, cid, body, now) {
  const k = String(body.k || '');
  if (!CALL_GAP[k]) return { err: '\ud615\uc2dd\uc774 \ub9de\uc9c0 \uc54a\uc544\uc694' };
  const linked = await linkedCount(DB, cid);
  if (linked === 0) return { ok: true, linked: 0 };
  let la = Number(body.la), lo = Number(body.lo);
  let has = body.la != null && body.lo != null && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 85 && Math.abs(lo) <= 180 && (la || lo);
  if (!has) { const l = await DB.prepare('SELECT la,lo,t FROM loc WHERE cid=?').bind(cid).first(); if (l && now - l.t < 30 * 60000) { la = l.la; lo = l.lo; has = true; } }
  if (body.op === 'cancel') {
    if (k === 'arr') return { err: '\ud615\uc2dd\uc774 \ub9de\uc9c0 \uc54a\uc544\uc694' };
    const r = await DB.prepare('UPDATE calls SET st=2,at=? WHERE cid=? AND k=? AND st IN (0,1) AND t>?').bind(now, cid, k, now - CALL_OPEN_MS).run();
    if (r && r.meta && r.meta.changes > 0) {
      await bump(DB, cid);
      later(notifyParents(env, DB, cid, (nm) => ({ k: 'callx', title: k === 'sos' ? '\uae34\uae09 \ud638\ucd9c \ucde8\uc18c' : '\uae38\ub3d9\ubb34', body: who(nm) + (k === 'sos' ? ' \uae34\uae09 \ud638\ucd9c\uc744 \ucde8\uc18c\ud588\uc5b4\uc694. \uad1c\ucc2e\ub2e4\uace0 \ud574\uc694' : ' \ub370\ub9ac\ub7ec \uc640 \ub2ec\ub77c\ub294 \uc694\uccad\uc744 \ucde8\uc18c\ud588\uc5b4\uc694'), tag: k }), k === 'sos'));
    }
    return { ok: true, linked };
  }
  const last = await DB.prepare('SELECT id,t,st FROM calls WHERE cid=? AND k=? ORDER BY t DESC LIMIT 1').bind(cid, k).first();
  if (last && last.st !== 2 && now - last.t < CALL_GAP[k]) return { ok: true, id: last.id, dup: 1, linked };
  const place = has ? await nearPlaceName(DB, cid, la, lo) : '';
  const keep = has && k !== 'arr';                                      // \ub3c4\ucc29 \uc54c\ub9bc\uc740 \uc88c\ud45c\ub97c \ub0a8\uae30\uc9c0 \uc54a\ub294\ub2e4(\uc7a5\uc18c \uc774\ub984\ub9cc)
  const opened = k === 'arr' ? null : await DB.prepare('SELECT id FROM calls WHERE cid=? AND k=? AND st IN (0,1) AND t>? ORDER BY t DESC LIMIT 1').bind(cid, k, now - CALL_OPEN_MS).first();
  let id;
  if (opened) {                                                         // \uc544\uc9c1 \uc548 \ub05d\ub09c \ud638\ucd9c\uc744 \ub610 \ub204\ub974\uba74 \uce74\ub4dc\ub97c \ub298\ub9ac\uc9c0 \uc54a\uace0 \uadf8 \uce74\ub4dc\ub97c \uc0c8\ub85c(\ubbf8\ud655\uc778\uc73c\ub85c) \uc62c\ub9ac\uace0 \ub2e4\uc2dc \uc54c\ub9b0\ub2e4
    id = opened.id;
    await DB.prepare('UPDATE calls SET t=?,la=?,lo=?,pl=?,st=0,at=0 WHERE id=?').bind(now, keep ? la : 0, keep ? lo : 0, place, id).run();
  } else {
    id = rid();
    await DB.prepare('INSERT INTO calls(id,cid,k,t,la,lo,pl,st,at) VALUES(?,?,?,?,?,?,?,0,0)').bind(id, cid, k, now, keep ? la : 0, keep ? lo : 0, place).run();
  }
  await ev(DB, cid, k, place, now);
  const near = place ? ' \u00b7 ' + place + ' \uadfc\ucc98' : '';
  later(notifyParents(env, DB, cid, (nm) => (k === 'sos'
    ? { k: 'sos', title: '\ud83d\udea8 \uae34\uae09 \ud638\ucd9c', body: who(nm) + ' \uae34\uae09 \ud638\ucd9c\uc744 \ud588\uc5b4\uc694. \uc9c0\uae08 \uae38\ub3d9\ubb34\ub97c \uc5f4\uc5b4 \ud655\uc778\ud574 \uc8fc\uc138\uc694', tag: 'sos' }
    : k === 'pick' ? { k: 'pick', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' \ub370\ub9ac\ub7ec \uc640 \ub2ec\ub77c\uace0 \ud574\uc694' + near, tag: 'pick' }
      : { k: 'arr', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' \uc548\uc804\ud558\uac8c \ub3c4\ucc29\ud588\ub2e4\uace0 \uc54c\ub838\uc5b4\uc694' + near + ' \u00b7 ' + clock(now), tag: 'arr' }), k === 'sos'));
  return { ok: true, id, linked };
}
/** \uac19\uc740 \uc77c\uc744 \ub450 \ubc88 \ubcf4\ub0b4\uc9c0 \uc54a\ub294\ub2e4(\ube44\ud2b8\uac00 \ucc98\uc74c \ucf1c\uc9c8 \ub54c\ub9cc true) */
async function once(DB, id, bit) {
  const r = await DB.prepare('UPDATE trips SET pn=pn|? WHERE id=? AND (pn&?)=0').bind(bit, id, bit).run();
  return !!(r && r.meta && r.meta.changes > 0);
}
const cut = (x, n) => (x.length > n ? x.slice(0, n - 1) + '\u2026' : x);

/** \ub4f1\ub85d \uc7a5\uc18c\uc5d0 \ub4e4\uc5b4\uc624\uac70\ub098 \ubc97\uc5b4\ub098\uba74 \ubd80\ubaa8\uc5d0\uac8c \uc54c\ub9b0\ub2e4(\uac19\uc740 \uacf3 \u00b7 \uac19\uc740 \uc77c\uc740 5\ubd84\uc5d0 \ud55c \ubc88 \u2014 GPS \ud754\ub4e4\ub9bc \u00b7 \uc624\uac00\ub294 \uac83 \ubc29\uc9c0). \ub3c4\ucc29 \ud655\uc778\uc744 \ub20c\ub7ec \ub454 \uacf3('\ucd9c\ubc1c'\ud55c \uc774\ub3d9)\uc740 \uadf8\ucabd \uc54c\ub9bc\uc774 \uc788\uc5b4 '\uc654\uc5b4\uc694'\ub294 \uc0dd\ub7b5. */
async function zoneAlert(env, DB, cid, kind, plId, name, now) {
  const key = cid + ':' + plId + ':' + kind;
  const zr = await DB.prepare('INSERT INTO zt(k,t) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET t=excluded.t WHERE zt.t<?').bind(key, now, now - 5 * 60000).run();      // 5\ubd84 \uc548\uc5d0 \uc774\ubbf8 \ubcf4\ub0c8\uc73c\uba74 \ubc14\ub00c\ub294 \uac83\uc774 \uc5c6\ub2e4(\uc6cc\ucee4 \uc778\uc2a4\ud134\uc2a4\uac00 \ub2ec\ub77c\ub3c4 \ud55c \ubc88\ub9cc)
  if (!(zr && zr.meta && zr.meta.changes > 0)) return false;
  if (kind === 'at') { const g = await DB.prepare("SELECT 1 a FROM trips WHERE cid=? AND pl=? AND st='go' AND day=?").bind(cid, plId, kstParts(now).ds).first(); if (g) return false; }
  await notifyParents(env, DB, cid, (nm) => ({ k: 'zone', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' ' + name + (kind === 'at' ? ' \uadfc\ucc98\uc5d0 \uc654\uc5b4\uc694' : '\uc5d0\uc11c \uba40\uc5b4\uc84c\uc5b4\uc694') + ' \u00b7 ' + clock(now), tag: 'zone' + plId }));
  return true;
}
/** \ubc30\ud130\ub9ac\uac00 \ub0ae\uc73c\uba74 \ubd80\ubaa8\uc5d0\uac8c(3\uc2dc\uac04\uc5d0 \ud55c \ubc88) */
async function battAlert(env, DB, cid, bt, now) {
  await DB.prepare('INSERT OR IGNORE INTO cst(cid) VALUES(?)').bind(cid).run();
  const r = await DB.prepare('UPDATE cst SET lb=? WHERE cid=? AND lb<?').bind(now, cid, now - BATT_GAP).run();
  if (!(r && r.meta && r.meta.changes > 0)) return false;
  await bump(DB, cid);
  await notifyParents(env, DB, cid, (nm) => ({ k: 'batt', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' \ud3f0 \ubc30\ud130\ub9ac\uac00 ' + bt + '% \uc608\uc694. \uace7 \uc704\uce58\uac00 \ub04a\uae38 \uc218 \uc788\uc5b4\uc694', tag: 'batt' }));
  return true;
}
/** 1\ubd84\ub9c8\ub2e4(\ud06c\ub860) \uc548\uc804 \uc810\uac80: \uc704\uce58 \ub04a\uae40 \u00b7 \ub0a0\uc528. fetchFn \uc740 \uc2dc\ud5d8\uc5d0\uc11c \ubc14\uafd4 \ub07c\uc6b4\ub2e4. */
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
        await notifyParents(env, DB, r.cid, (nm) => ({ k: 'stale', title: '\uae38\ub3d9\ubb34', body: (nm || '\uc790\ub140') + ' \uc704\uce58\uac00 ' + ago(now - r.t).replace(' \uc804', '') + ' \ub3d9\uc548 \ub4e4\uc5b4\uc624\uc9c0 \uc54a\uc544\uc694 \u00b7 \ub9c8\uc9c0\ub9c9 ' + (dong ? dong + ' ' : '') + clock(r.t), tag: 'stale' }));
      }
    }
    if (kp.h * 60 + kp.mi >= WX_AT && kp.h < 11 && String(r.wx || '') !== String(kp.ds) && now - r.t < 24 * 3600000) {
      try {
        const q = 'latitude=' + r.la.toFixed(3) + '&longitude=' + r.lo.toFixed(3) + '&timezone=Asia%2FSeoul&forecast_days=1';
        const [w, a] = await Promise.all([
          fetchFn('https://api.open-meteo.com/v1/forecast?' + q + '&hourly=precipitation_probability,precipitation,snowfall,apparent_temperature').then((x) => (x.ok ? x.json() : null)),
          fetchFn('https://air-quality-api.open-meteo.com/v1/air-quality?' + q + '&hourly=pm10,pm2_5').then((x) => (x.ok ? x.json() : null)).catch(() => null),
        ]);
        if (!w || !w.hourly) continue;                                           // \ubabb \ubc1b\uc558\ub2e4 \u2014 \ub2e4\uc74c \ubd84\uc5d0 \ub2e4\uc2dc(11\uc2dc\uae4c\uc9c0)
        await DB.prepare('INSERT OR IGNORE INTO cst(cid) VALUES(?)').bind(r.cid).run();
        await DB.prepare('UPDATE cst SET wx=? WHERE cid=?').bind(String(kp.ds), r.cid).run();
        const items = wxDecide(w.hourly, a && a.hourly);
        if (items.length) await notifyParents(env, DB, r.cid, (nm) => ({ k: 'wx', title: '\uae38\ub3d9\ubb34 \u00b7 \uc624\ub298 \ub0a0\uc528', body: cut((nm || '\uc790\ub140') + ' \uc624\ub298 \ub0ae \u2014 ' + items.map((i) => i.s).join(' \u00b7 '), 110), tag: 'wx' }));
      } catch (e) { /* \ub0a0\uc528\ub97c \ubabb \ubc1b\uc544\ub3c4 \ub2e4\ub978 \uc77c\uc740 \uacc4\uc18d */ }
    }
  }
}
/** 1\ubd84\ub9c8\ub2e4(\ud06c\ub860): \uc2dc\uac01\uc774 \ub418\uc5b4 \uc0dd\uae30\ub294 \uc77c \u2014 30\ubd84 \uc804 \uc54c\ub9bc(\uc790\ub140) \u00b7 \uc57d\uc18d \uc2dc\uac01\uc774 \uc9c0\ub098\ub3c4 \ub3c4\ucc29\ud558\uc9c0 \uc54a\uc74c(\ubd80\ubaa8) */
/** \uc624\ub798 \uc313\uc544 \ub450\uc9c0 \uc54a\ub294\ub2e4(\uac1c\uc778\uc815\ubcf4): \uc9c0\ub09c \uacbd\ub85c 7\uc77c \u00b7 \uba38\ubb38 \uacf3 30\uc77c \u00b7 \ub3c4\ucc29/\ucd9c\ubc1c \uc54c\ub9bc \uc2dc\uac01 \ud558\ub8e8. 10\ubd84\uc5d0 \ud55c \ubc88\ub9cc \ub3c8\ub2e4. */
let prunedOldAt = 0;
async function pruneOld(DB, now) {
  if (now - prunedOldAt < 10 * 60000) return;
  prunedOldAt = now;
  await DB.batch([DB.prepare('DELETE FROM calls WHERE t<?').bind(now - CALL_KEEP), DB.prepare('DELETE FROM routes WHERE t1<?').bind(now - RT_MAX_AGE), DB.prepare('DELETE FROM stops WHERE t<?').bind(now - STRANGE_KEEP), DB.prepare('DELETE FROM zt WHERE t<?').bind(now - DAY), DB.prepare('DELETE FROM drafts WHERE t<?').bind(now - DAY), DB.prepare('DELETE FROM lbs WHERE t<?').bind(now - LBS_KEEP), DB.prepare('DELETE FROM cons WHERE t<?').bind(now - 2 * LBS_KEEP)]);          // \uc4f0\ub2e4 \ub9cc \uc7a5\uc18c \ub4f1\ub85d \u00b7 \uace0\uce58\uae30 \uc784\uc2dc\ubcf8(\uc8fc\uc18c \uac80\uc0c9\uc5b4 \ud3ec\ud568)\uc740 \ud558\ub8e8 \ub4a4 \uc9c0\uc6b4\ub2e4
}
async function cron(env) {
  const DB = env.DB, now = Date.now();
  await init(DB);
  await tripsCron(env, DB, now);
  try { await pruneOld(DB, now); } catch (e) { /* \uc815\ub9ac\uac00 \uc54c\ub9bc\uc744 \ub9c9\uc9c0 \uc54a\ub294\ub2e4 */ }
  try { await safetyCron(env, DB, now, (u) => fetch(u)); } catch (e) { /* \uc548\uc804 \uc810\uac80\uc774 \uc77c\uc815 \uc54c\ub9bc\uc744 \ub9c9\uc9c0 \uc54a\ub294\ub2e4 */ }
}
async function tripsCron(env, DB, now) {
  const cids = ((await DB.prepare('SELECT DISTINCT cid FROM places').all()).results || []).map((r) => r.cid);
  if (!cids.length) return;
  for (const cid of cids) { plCache.delete(cid); await tripsSync(DB, cid, now); }
  if (!saOf(env)) return;
  const kp = kstParts(now);
  const rows = (await DB.prepare('SELECT t.id id,t.cid cid,t.st st,t.ta ta,t.tc tc,t.pn pn,p.name name,p.hh hh,p.mm mm FROM trips t JOIN places p ON p.id=t.pl WHERE t.day=?').bind(kp.ds).all()).results || [];
  for (const r of rows) {
    const eta = etaOf(r, now);
    if (r.st === 'due' && !(r.pn & 1) && now >= eta - LEAD && now < eta + STAY && (await once(DB, r.id, 1)))
      await notifyChild(env, DB, r.cid, { k: 'due', title: '\uae38\ub3d9\ubb34 \ud0a4\uc988', body: r.name + '\uc5d0 \uac00\uc57c\ud574\uc694', tag: 'trip' + r.id });
    if (!(r.pn & 8) && !r.tc && !r.ta && now >= eta + MISS_AFTER && now <= eta + STAY && (await once(DB, r.id, 8)))
      await notifyParents(env, DB, r.cid, (nm) => ({ k: 'miss', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' ' + r.name + '\uc5d0 ' + (r.st === 'go' ? '\uac00\uace0 \uc788\uc5b4\uc694 \u00b7 \uc57d\uc18d \uc2dc\uac01(' + clock(eta) + ')\uc774 \uc9c0\ub0ac\uc5b4\uc694' : '\ub3c4\ucc29\ud558\uc9c0 \uc54a\uc558\uc5b4\uc694 (' + clock(eta) + ' \uc57d\uc18d)'), tag: 'trip' + r.id }));
  }
}

let ready = false;
async function addCol(DB, table, col, ddl) {              // \uc61b \ud45c\uc5d0 \uc5f4\uc744 \ud55c \ubc88\ub9cc \ub367\ubd99\uc778\ub2e4
  const cols = (await DB.prepare('PRAGMA table_info(' + table + ')').all()).results || [];
  if (cols.some((c) => c.name === col)) return;
  try { await DB.prepare('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + ddl).run(); } catch (e) { /* \ub2e4\ub978 \uc694\uccad\uc774 \uba3c\uc800 \ub367\ubd99\uc600\ub2e4 */ }
}
async function init(DB) {
  if (ready) return;
  await DB.batch([
    DB.prepare('CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, role TEXT NOT NULL, sh TEXT NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY, cid TEXT NOT NULL, exp INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS links(cid TEXT NOT NULL, pid TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY(cid, pid))'),
    DB.prepare('CREATE TABLE IF NOT EXISTS loc(cid TEXT PRIMARY KEY, la REAL NOT NULL, lo REAL NOT NULL, acc REAL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS chat(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, f TEXT NOT NULL, x TEXT NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS chat_c ON chat(cid, t)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS chat_rd(cid TEXT NOT NULL, s TEXT NOT NULL, id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(cid, s))'),      // \uc77d\uc74c: \uac01\uc790(p \ubd80\ubaa8 \u00b7 c \uc790\ub140)\uac00 \uc5b4\ub514\uae4c\uc9c0 \uc77d\uc5c8\ub098(chat.id)
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
    DB.prepare('CREATE TABLE IF NOT EXISTS routes(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, t0 INTEGER NOT NULL, t1 INTEGER NOT NULL, m INTEGER NOT NULL, sn TEXT NOT NULL DEFAULT \'\', en TEXT NOT NULL DEFAULT \'\', pts TEXT NOT NULL)'),      // \uc9c0\ub09c \uacbd\ub85c(s391): \uc790\ub140\ub2f9 RT_KEEP \uac1c
    DB.prepare('CREATE INDEX IF NOT EXISTS routes_c ON routes(cid, id)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS cst(cid TEXT PRIMARY KEY, sh INTEGER NOT NULL DEFAULT 1, stl INTEGER NOT NULL DEFAULT 0, lb INTEGER NOT NULL DEFAULT 0, wx TEXT NOT NULL DEFAULT \'\')'),      // \uc548\uc804 \uc54c\ub9bc \uc0c1\ud0dc: \uc704\uce58 \uacf5\uc720(1 \ucf2c \u00b7 0 \ub054) \u00b7 \ub04a\uae40 \uc54c\ub9bc\uc744 \ubcf4\ub0c8\ub098 \u00b7 \ubc30\ud130\ub9ac \uc54c\ub9bc \uc2dc\uac01 \u00b7 \ub0a0\uc528 \uc54c\ub9bc\uc744 \ubcf4\ub0b8 \ub0a0
    DB.prepare('CREATE TABLE IF NOT EXISTS zt(k TEXT PRIMARY KEY, t INTEGER NOT NULL)'),      // \uc7a5\uc18c \ub3c4\ucc29/\ucd9c\ubc1c \uc54c\ub9bc\uc744 \ub9c8\uc9c0\ub9c9\uc73c\ub85c \ubcf4\ub0b8 \uc2dc\uac01(\uc790\ub140:\uc7a5\uc18c:\uc885\ub958 \u2192 5\ubd84\uc5d0 \ud55c \ubc88 \u2014 \uc6cc\ucee4\uac00 \ubc14\ub00c\uc5b4\ub3c4 \uc720\uc9c0)
    DB.prepare('CREATE TABLE IF NOT EXISTS gd(pid TEXT PRIMARY KEY, v INTEGER NOT NULL, t INTEGER NOT NULL)'),      // \ubc95\uc815\ub300\ub9ac\uc778 \ud655\uc778 \ub3d9\uc758(\ubd80\ubaa8 \uae30\uae30\ubcc4 \u00b7 \ubc84\uc804 \u00b7 \uc2dc\uac01) \u2014 \uc774 \ub3d9\uc758\uac00 \uc788\uc5b4\uc57c \uc790\ub140 \uc704\uce58\uac00 \ubcf4\uc778\ub2e4
    DB.prepare('CREATE TABLE IF NOT EXISTS lbs(id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, cid TEXT NOT NULL, pid TEXT NOT NULL, k TEXT NOT NULL)'),      // \uc704\uce58\uc815\ubcf4\ubc95 \uc81c16\uc870 \uc774\uc6a9\u00b7\uc81c\uacf5\uc0ac\uc2e4 \ud655\uc778\uc790\ub8cc: \uc5b8\uc81c \u00b7 \ub204\uac00 \u00b7 \ub204\uad6c\uc758 \uc704\uce58\ub97c \ubc1b\uc558\ub098(\uc88c\ud45c\ub294 \uc5c6\ub2e4) \u00b7 6\uac1c\uc6d4 \ub118\uac8c \ubcf4\uad00
    DB.prepare('CREATE INDEX IF NOT EXISTS lbs_c ON lbs(cid, pid, k, t)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, cid TEXT NOT NULL, k TEXT NOT NULL, t INTEGER NOT NULL, la REAL NOT NULL DEFAULT 0, lo REAL NOT NULL DEFAULT 0, pl TEXT NOT NULL DEFAULT \'\', st INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0)'),      // \uae34\uae09 \ud638\ucd9c(sos) \u00b7 \ub370\ub9ac\ub7ec \uc640\uc918(pick) \u00b7 \uc548\uc804\ud558\uac8c \ub3c4\ucc29(arr): st 0 \uc0c8\uac83 \u00b7 1 \ubd80\ubaa8\uac00 \ud655\uc778 \u00b7 2 \uc790\ub140\uac00 \ucde8\uc18c \u00b7 3 \ub05d\ub0a8
    DB.prepare('CREATE INDEX IF NOT EXISTS calls_c ON calls(cid, k, t)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS cons(cid TEXT PRIMARY KEY, v INTEGER NOT NULL, t INTEGER NOT NULL)'),      // \uc790\ub140 \uc571\uc5d0\uc11c \ubcf4\ud638\uc790 \u00b7 \ubcf8\uc778 \ub3d9\uc758\ub97c \ub9c8\uce5c \uae30\ub85d(\ub3d9\uc758 \uc99d\ube59)
    DB.prepare('CREATE TABLE IF NOT EXISTS stops(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, la REAL NOT NULL, lo REAL NOT NULL, t INTEGER NOT NULL, d INTEGER NOT NULL)'),      // 30\ubd84 \ub118\uac8c \uba38\ubb38 \uacf3 \uae30\ub85d(\ub0af\uc120 \uacf3 \ud310\uc815\uc6a9 \u00b7 30\uc77c)
    DB.prepare('CREATE INDEX IF NOT EXISTS stops_c ON stops(cid, id)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS rtst(cid TEXT PRIMARY KEY, dla REAL NOT NULL, dlo REAL NOT NULL, dt INTEGER NOT NULL, cl INTEGER NOT NULL DEFAULT 0, rte INTEGER NOT NULL DEFAULT 0, rsa REAL, rso REAL, sn TEXT NOT NULL DEFAULT \'\', en TEXT NOT NULL DEFAULT \'\')'),      // \uc815\uc9c0 \ud310\uc815 \uc0c1\ud0dc
    DB.prepare('CREATE TABLE IF NOT EXISTS drafts(pid TEXT PRIMARY KEY, cid TEXT NOT NULL, pl TEXT NOT NULL DEFAULT \'\', la REAL NOT NULL, lo REAL NOT NULL, name TEXT NOT NULL DEFAULT \'\', hh INTEGER NOT NULL, mm INTEGER NOT NULL, days INTEGER NOT NULL, t INTEGER NOT NULL)'),
  ]);
  await addCol(DB, 'loc', 'bt', 'INTEGER NOT NULL DEFAULT -1');          // \uc790\ub140 \ud3f0 \ubc30\ud130\ub9ac %(\ubaa8\ub974\uba74 -1)
  await addCol(DB, 'loc', 'ch', 'INTEGER NOT NULL DEFAULT 0');           // \ucda9\uc804 \uc911\uc774\uba74 1
  await addCol(DB, 'drafts', 'q', "TEXT NOT NULL DEFAULT ''");           // \uc7a5\uc18c \ub4f1\ub85d: \ucc3e\uc544 \ubcf8 \uc8fc\uc18c \uae00
  await addCol(DB, 'devices', 'rv', 'INTEGER NOT NULL DEFAULT 0');         // \ubd80\ubaa8\uac00 \uc9c0\ub3c4\uc5d0\uc11c \ubcf4\ub294 \uc9c0\ub09c \uacbd\ub85c \ubc88\ud638(0 = \uc2e4\uc2dc\uac04) \u2014 10\ubd84 \uc9c0\ub098\uba74 \uc2e4\uc2dc\uac04\uc73c\ub85c \ub3cc\uc544\uac04\ub2e4
  await addCol(DB, 'devices', 'rvt', 'INTEGER NOT NULL DEFAULT 0');
  await addCol(DB, 'devices', 'kh', 'INTEGER NOT NULL DEFAULT 0');   // \ubd80\ubaa8: \uc571\uc744 \ucf24 \ub54c \ud0a4\uc988 \ud654\uba74\uc73c\ub85c \uc2dc\uc791\ud560\uc9c0(1)
  await addCol(DB, 'quests', 'pt', 'INTEGER NOT NULL DEFAULT 1');
  await addCol(DB, 'quests', 'fl', 'INTEGER NOT NULL DEFAULT 0');       // 1 = \uc0c8 \ud750\ub984(\uc2b9\ub099 \u2192 \uc644\ub8cc \u2192 \ud655\uc778) \uc0c1\ud0dc \uac12. 0 \uc774\uba74 \uc61b \uac12\uc774\ub77c \ud55c \ubc88 \uc62e\uae34\ub2e4
  try {                                                                  // \uc61b \uac12 \uc62e\uae30\uae30(\ud55c \ubc88\ub9cc): \uc790\ub140 \ubbf8\uc158 0 \uc9c4\ud589 \u2192 1 \u00b7 1 \uc790\ub140\uac00 \ud574\ub0c8\ub2e4\uace0 \uc54c\ub9bc \u2192 2 \u00b7 2 \ud655\uc778 \u2192 3 / \ubd80\ubaa8\ub2d8 \ubbf8\uc158 0 \uc9c4\ud589 \u2192 1 \u00b7 1 \uc644\ub8cc \u2192 3
    await DB.prepare("UPDATE quests SET s=CASE WHEN k='p' THEN (CASE s WHEN 0 THEN 1 ELSE 3 END) ELSE (CASE s WHEN 0 THEN 1 WHEN 1 THEN 2 ELSE 3 END) END, fl=1 WHERE fl=0").run();
  } catch (e) { /* \ub2e4\uc74c\uc5d0 \ub2e4\uc2dc */ }
  await addCol(DB, 'devices', 'ft', "TEXT NOT NULL DEFAULT ''");          // \ud478\uc2dc \ud1a0\ud070(FCM)
  await addCol(DB, 'devices', 'fa', 'INTEGER NOT NULL DEFAULT 0');         // \ud1a0\ud070\uc744 \ubc1b\uc740 \uc2dc\uac01
  await addCol(DB, 'trips', 'pn', 'INTEGER NOT NULL DEFAULT 0');           // \ubcf4\ub0b8 \ud478\uc2dc(1 30\ubd84 \uc804 \u00b7 2 \ucd9c\ubc1c \u00b7 4 \ub3c4\ucc29 \u00b7 8 \ubbf8\ub3c4\ucc29)
  await addCol(DB, 'links', 'nm', "TEXT NOT NULL DEFAULT ''");
  await addCol(DB, 'links', 'pnm', "TEXT NOT NULL DEFAULT ''");          // \ubd80\ubaa8\uac00 \uc815\ud55c \uc790\uae30 \uc774\ub984(\uc790\ub140 \ud654\uba74\uc5d0 \ubcf4\uc778\ub2e4)
  await addCol(DB, 'chat', 'pn', "TEXT NOT NULL DEFAULT ''");            // \ubd80\ubaa8 \uae00\uc744 \uc4f4 \ubd80\ubaa8\uc758 \uc774\ub984
  await addCol(DB, 'loc', 'dn', "TEXT NOT NULL DEFAULT ''");             // \uc790\ub140\uac00 \uc54c\ub824 \uc900 \ub3d9\ub124 \uc774\ub984
  await addCol(DB, 'loc', 'mva', 'REAL NOT NULL DEFAULT 0');             // \ub9c8\uc9c0\ub9c9\uc73c\ub85c '\uc774\ub3d9 \uc911' \uc904\uc744 \ub0a8\uae34 \uc790\ub9ac(\uc704\ub3c4 \u00b7 \uacbd\ub3c4 \u00b7 \uc2dc\uac01) \u2014 0 \uc774\uba74 \uc544\uc9c1 \uc5c6\uc74c
  await addCol(DB, 'loc', 'mvo', 'REAL NOT NULL DEFAULT 0');
  await addCol(DB, 'loc', 'mvt', 'INTEGER NOT NULL DEFAULT 0');
  await addCol(DB, 'loc', 'hp', "TEXT NOT NULL DEFAULT ''");             // \uc9c0\uae08 150m \uc548\uc5d0 \uc788\ub294 \ub4f1\ub85d \uc7a5\uc18c(\uc5c6\uc73c\uba74 \ube48 \uae00)
  await addCol(DB, 'loc', 'pla', 'REAL');
  await addCol(DB, 'loc', 'plo', 'REAL');
  await addCol(DB, 'loc', 'plt', 'INTEGER NOT NULL DEFAULT 0');
  await addCol(DB, 'loc', 'hd', 'INTEGER NOT NULL DEFAULT -1');           // \uac00\ub294 \ubc29\ud5a5(\ub3c4 \u00b7 \ubd81\ucabd 0 \u00b7 \uc2dc\uacc4 \ubc29\ud5a5, \ubaa8\ub974\uba74 -1) \u2014 \ubc14\ub85c \uc55e \ubcf4\uace0\uc5d0\uc11c 6m \ub118\uac8c \uc6c0\uc9c1\uc600\uc744 \ub54c\ub9cc \uc0c8\ub85c \uacc4\uc0b0
  await addCol(DB, 'loc', 'hdt', 'INTEGER NOT NULL DEFAULT 0');           // \ubc29\ud5a5\uc744 \uacc4\uc0b0\ud55c \uc2dc\uac01
  await addCol(DB, 'loc', 'mt', 'INTEGER NOT NULL DEFAULT 0');            // \ub9c8\uc9c0\ub9c9\uc73c\ub85c '\uc6c0\uc9c1\uc774\ub294 \uc911'(\uc5f0\uc18d \ubcf4\uace0 \uc0ac\uc774 6m \ub118\uac8c)\uc774\ub77c \ubcf8 \uc2dc\uac01
  await addCol(DB, 'loc', 'ha', 'REAL NOT NULL DEFAULT 0');                // \uc6c0\uc9c1\uc784 \ud310\ub2e8 \uae30\uc900\uc810(\uc704\ub3c4 \u00b7 \uacbd\ub3c4 \u00b7 \uc2dc\uac01) \u2014 \uc774 \uc810\uc5d0\uc11c 8m \ub118\uac8c \ubc97\uc5b4\ub098\uba74 '\uc6c0\uc9c1\uc774\ub294 \uc911'\uc774\uace0 \uac00\ub294 \ubc29\ud5a5\uc744 \uc0c8\ub85c \uacc4\uc0b0\ud55c\ub2e4
  await addCol(DB, 'loc', 'hb', 'REAL NOT NULL DEFAULT 0');
  await addCol(DB, 'loc', 'hat', 'INTEGER NOT NULL DEFAULT 0');
  await addCol(DB, 'devices', 'wt', 'INTEGER NOT NULL DEFAULT 0');        // \ubd80\ubaa8\uac00 \ud0a4\uc988 \ud654\uba74(\ud5c8\ube0c)\uc744 \ub9c8\uc9c0\ub9c9\uc73c\ub85c \ubcf4\uace0 \uc788\ub358 \uc2dc\uac01 \u2014 \uc2e4\uc2dc\uac04(\ubcf4\ub294 \uc911) \ud310\ub2e8
  await addCol(DB, 'devices', 'ws', 'INTEGER NOT NULL DEFAULT 0');        // \uc774\ubc88\uc5d0 \uc774\uc5b4\uc11c \ubcf4\uae30 \uc2dc\uc791\ud55c \uc2dc\uac01
  ready = true;
}

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const okId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);
const okSec = (s) => typeof s === 'string' && s.length >= 16 && s.length <= 128;
const txt = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, MAX_TXT) : '');
const rid = () => [...crypto.getRandomValues(new Uint8Array(9))].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12);
// \ubbf8\uc158 \uc0c1\ud0dc(s): 0 \ub300\uae30(\ubc1b\ub294 \ucabd\uc774 \uc2b9\ub099\ud558\uae38 \uae30\ub2e4\ub9bc) \u00b7 1 \uc2b9\ub099(\uc9c4\ud589 \uc911) \u00b7 2 \uc644\ub8cc \ubcf4\uace0(\ud55c \ucabd\uc774 \ud588\ub2e4\uace0 \ub20c\ub800\uace0 \ubcf4\ub0b8 \ucabd\uc758 \ud655\uc778\uc744 \uae30\ub2e4\ub9bc) \u00b7 3 \uc885\ub8cc(\uc644\ub8cc) \u00b7 4 \uac70\uc808
//   \uc790\ub140 \ubbf8\uc158(k='c', \ubd80\ubaa8 \u2192 \uc790\ub140): \ubd80\ubaa8\uac00 \ubcf4\ub0c4 \u2192 \uc790\ub140 \uc2b9\ub099/\uac70\uc808 \u2192 \uc790\ub140\uac00 \uc644\ub8cc \u2192 \ubd80\ubaa8\uac00 \ud655\uc778(\uc774\ub54c \uc790\ub140\uc5d0\uac8c \uc2a4\ud0c0 pt \uc9c0\uae09)
//   \ubd80\ubaa8\ub2d8 \ubbf8\uc158(k='p', \uc790\ub140 \u2192 \ubd80\ubaa8): \uc790\ub140\uac00 \ubcf4\ub0c4(\uc2a4\ud0c0 SEND_COST \ud544\uc694) \u2192 \ubd80\ubaa8 \uc2b9\ub099(\uc774\ub54c \uc790\ub140 \uc2a4\ud0c0 SEND_COST \ucc28\uac10)/\uac70\uc808 \u2192 \ubd80\ubaa8\uac00 \uc644\ub8cc \u2192 \uc790\ub140\uac00 \ud655\uc778
const SEND_COST = 50;
const QS_WAIT = 0, QS_ON = 1, QS_REP = 2, QS_DONE = 3, QS_NO = 4;
const pts = (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= MAX_PT ? n : 1; };
const pad2 = (n) => String(n).padStart(2, '0');

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uc2dc\uac01 \u00b7 \uac70\ub9ac \u00b7 \ub9d0\ud22c \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function kstParts(t) {
  const d = new Date(t + KST), y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, dd = d.getUTCDate();
  return { ds: y * 10000 + mo * 100 + dd, wd: (d.getUTCDay() + 6) % 7, h: d.getUTCHours(), mi: d.getUTCMinutes(), mo, d: dd };
}
const dayStart = (t) => Math.floor((t + KST) / DAY) * DAY - KST;
const etaOf = (pl, now) => dayStart(now) + (pl.hh * 60 + pl.mm) * 60000;
const hmTxt = (h, m) => h + '\uc2dc' + (m ? ' ' + m + '\ubd84' : '');
const clock = (t) => { const p = kstParts(t); return pad2(p.h) + ':' + pad2(p.mi); };
function hav(a, b, c, d) {
  const R = 6371000, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
  const s = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const fmtDist = (m) => (m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + 'm' : (m / 1000).toFixed(1) + 'km');
// \uc5ed \uc8fc\ubcc0 \ud45c\uc2dc: \uc5ed \uc88c\ud45c\ud45c(\uc774\ub984,\uc704\ub3c4,\uacbd\ub3c4;\u2026) \u2014 \uac00\uc7a5 \uac00\uae4c\uc6b4 \uc5ed\uc774 STN_NEAR_M \uc548\uc77c \ub54c\ub9cc '(00\uc5ed \uc8fc\ubcc0 00m)' \ub97c \ubd99\uc778\ub2e4
const STN_NEAR_M = 500;
const STN_TXT = '\uc218\uc6d0,37.26616,126.99982;\uc624\ubaa9\ucc9c,37.24301,126.96363;\uc778\ud558\ub300,37.44819,126.64983;\uc601\ub4f1\ud3ec\uad6c\uccad,37.52421,126.89502;\uc601\ub4f1\ud3ec\uc2dc\uc7a5,37.52276,126.90514;\uc0ac\ub2f9,37.47656,126.98175;\ub0a8\ud0dc\ub839,37.46434,126.98908;\ubc31\ub9c8,37.65835,126.79440;\uc911\ub791,37.59495,127.07615;\uc0c1\ubd09,37.59567,127.08571;\uc11c\uc6b8\uc232,37.54365,127.04469;\uc555\uad6c\uc815\ub85c\ub370\uc624,37.52739,127.04055;\uac15\ub0a8\uad6c\uccad,37.51718,127.04122;\uc120\uc815\ub989,37.51028,127.04376;\uac00\ucc9c\ub300,37.44878,127.12668;\uc5b4\ucc9c,37.25008,126.90881;\ud569\uc815,37.54903,126.91355;\uc624\uae08,37.50223,127.12770;\uc9c4\uc811,37.72047,127.20317;\ub0a8\uc601,37.54060,126.97117;\uc6a9\uc0b0,37.52989,126.96478;\ub178\ub7c9\uc9c4,37.51407,126.94167;\ub300\ubc29,37.51339,126.92641;\ub9dd\uc6b0,37.59999,127.09203;\uc2e0\ub0b4,37.61257,127.10433;\uac08\ub9e4,37.63414,127.11480;\ubcc4\ub0b4,37.64252,127.12730;\ud1f4\uacc4\uc6d0,37.64832,127.14386;\uc0ac\ub989,37.65114,127.17684;\uae08\uace1,37.63700,127.21600;\uad74\ubd09\uc0b0,37.83209,127.55773;\ub3d9\ub300\ubb38\uc5ed\uc0ac\ubb38\ud654\uacf5\uc6d0,37.56468,127.00533;\uc624\ub0a8,37.70541,127.19164;\uc601\ub4f1\ud3ec,37.51576,126.90741;\uc2e0\ub3c4\ub9bc,37.50881,126.89122;\uc751\ubd09,37.55043,127.03482;\uc655\uc2ed\ub9ac,37.56197,127.03726;\uae40\uc720\uc815,37.81847,127.71430;\ub0a8\ucd98\ucc9c,37.86407,127.72376;\ucd98\ucc9c,37.88439,127.71660;\ubd09\uba85,36.80158,127.13632;\uc30d\uc6a9,36.79375,127.12136;\uc544\uc0b0,36.79219,127.10438;\ud0d5\uc815,36.78827,127.08445;\ubc30\ubc29,36.77754,127.05275;\uc2e0\ub2f9,37.56617,127.01616;\ubcc4\ub0b4\ubcc4\uac00\ub78c,37.66783,127.11617;\ubd88\uc554\uc0b0,37.67009,127.07900;\uccad\ub7c9\ub9ac,37.58015,127.04506;\uc678\ub300\uc55e,37.59616,127.06357;\uc2e0\uc774\ubb38,37.60183,127.06735;\uc628\uc591\uc628\ucc9c,36.78042,127.00371;\uc2e0\ucc3d,36.76921,126.95013;\uc120\ubc14\uc704,37.45185,127.00216;\uacbd\ub9c8\uacf5\uc6d0,37.44399,127.00790;\ub300\uacf5\uc6d0,37.43572,127.00647;\uacfc\ucc9c,37.43281,126.99640;\uc57c\ubaa9,37.26121,126.88403;\uc0ac\ub9ac,37.29081,126.85717;\ud0dc\ud3c9,37.43984,127.12775;\uc778\ucc9c\ub17c\ud604,37.40064,126.72249;\uc5ec\uc758\ub3c4,37.52158,126.92432;\ub9c8\ud3ec,37.53972,126.94604;\uc11d\ub0a8,37.50621,126.67621;\uc0c1\uc655\uc2ed\ub9ac,37.56450,127.02887;\uc0c1\uacc4,37.66058,127.07320;\uc11d\uacc4,37.61494,127.06592;\uad11\uc6b4\ub300,37.62357,127.06181;\ud68c\uae30,37.58960,127.05794;\uc6d4\uacc4,37.63311,127.05884;\uc815\ubd80\uacfc\ucc9c\uccad\uc0ac,37.42645,126.98980;\ucd08\uc6d4,37.37339,127.30000;\uc2e0\ub454\ub3c4\uc608\ucd0c,37.31550,127.40525;\uc5ec\uc8fc,37.28288,127.62857;\uac00\uc0b0\ub514\uc9c0\ud138\ub2e8\uc9c0,37.48038,126.88270;\uae08\ucc9c\uad6c\uccad,37.45576,126.89434;\ud638\uad6c\ud3ec,37.40162,126.70868;\ub179\ucc9c,37.64460,127.05141;\ud55c\ud2f0,37.49621,127.05288;\uc11d\uc218,37.43516,126.90223;\uad00\uc545,37.41958,126.90848;\uae30\ud765,37.27566,127.11594;\uc0c1\uac08,37.26180,127.10872;\uccad\uba85,37.25948,127.07895;\uc601\ud1b5,37.25152,127.07134;\uacf5\ub355,37.54359,126.95166;\uc560\uc624\uac1c,37.55359,126.95673;\ucda9\uc815\ub85c,37.56006,126.96278;\uc11c\ub300\ubb38,37.56581,126.96664;\uad11\ud654\ubb38,37.57055,126.97657;\uccad\uad6c,37.56022,127.01378;\ud55c\uc591\ub300,37.55658,127.04350;\ub178\uc6d0,37.65448,127.06055;\ucc3d\ub3d9,37.65299,127.04675;\uc30d\ubb38,37.64827,127.03438;\uc218\uc720,37.63713,127.02473;\ub3c4\uace1,37.49113,127.05569;\uad6c\ub8e1,37.48698,127.05950;\uac1c\ud3ec\ub3d9,37.48911,127.06603;\ub300\ubaa8\uc0b0\uc785\uad6c,37.49135,127.07270;\uc218\uc11c,37.48751,127.10132;\ubcf5\uc815,37.47102,127.12675;\ub9dd\ud3ec,37.24579,127.05737;\uc548\uc591,37.40193,126.92265;\ub9e4\uad50,37.26550,127.01566;\uc6d0\uc778\uc7ac,37.41236,126.68789;\uc5f0\uc218,37.41777,126.67899;\uc1a1\ub3c4,37.42971,126.65449;\uc22d\uc758,37.46089,126.63804;\uc778\ucc9c,37.47636,126.61694;\ud68c\ub8e1,37.72404,127.04732;\uc758\uc815\ubd80,37.73873,127.04589;\uac00\ub2a5,37.74836,127.04425;\ub179\uc591,37.75942,127.04227;\uc591\uc8fc,37.77428,127.04472;\ub355\uacc4,37.81876,127.05668;\ub355\uc815,37.84322,127.06151;\ubcf4\uc0b0,37.91427,127.05713;\ub69d\uc12c,37.54718,127.04741;\ubbf8\uc544,37.62644,127.02615;\ubbf8\uc544\uc0ac\uac70\ub9ac,37.61328,127.03008;\uae38\uc74c,37.60409,127.02535;\uc2e0\uae38,37.51763,126.91489;\uace1\uc0b0,37.64573,126.80188;\ud48d\uc0b0,37.67217,126.78636;\uc77c\uc0b0,37.68223,126.76952;\uba85\ud559,37.38444,126.93558;\uad70\ud3ec,37.35373,126.94852;\uace0\uc0c9,37.24983,126.98059;\uc2e0\uae38\uc628\ucc9c,37.33821,126.76584;\ub3c4\ub18d,37.60876,127.16111;\ub0a8\ub3d9\uc778\ub354\uc2a4\ud30c\ud06c,37.40767,126.69561;\uc2e0\uae08\ud638,37.55450,127.02040;\ub9c8\uc7a5,37.56607,127.04292;\ub2f5\uc2ed\ub9ac,37.56683,127.05266;\uc591\uc815,37.59920,127.18830;\ub355\uc18c,37.58689,127.20883;\ub3c4\uc2ec,37.57963,127.22280;\ud314\ub2f9,37.54732,127.24390;\uc6b4\uae38\uc0b0,37.55466,127.31009;\uc2e0\uc6d0,37.52592,127.37274;\uc11c\uc6b8,37.55325,126.96977;\uc2e0\ucd0c,37.55515,126.93689;\ud6a8\ucc3d\uacf5\uc6d0\uc55e,37.53928,126.96135;\uc11c\uac15\ub300,37.55213,126.93539;\ud64d\ub300\uc785\uad6c,37.55675,126.92364;\uac00\uc88c,37.56861,126.91484;\ub514\uc9c0\ud138\ubbf8\ub514\uc5b4\uc2dc\ud2f0,37.57700,126.89864;\uc218\uc0c9,37.58085,126.89568;\ud55c\uad6d\ud56d\uacf5\ub300,37.60310,126.86829;\uac15\ub9e4,37.61240,126.84454;\ud589\uc2e0,37.61212,126.83406;\uc911\uc559,37.31570,126.83870;\uc7a5\ud55c\ud3c9,37.56144,127.06460;\uc0bc\uac01\uc9c0,37.53556,126.97400;\ub2a5\uace1,37.61874,126.82089;\uad70\uc790,37.55715,127.07948;\uc544\ucc28\uc0b0,37.55201,127.08961;\uc131\uc218,37.54463,127.05598;\uc131\uc2e0\uc5ec\ub300\uc785\uad6c,37.59278,127.01734;\ud55c\uc131\ub300\uc785\uad6c,37.58838,127.00675;\ud61c\ud654,37.58212,127.00176;\ub3d9\ub300\ubb38,37.57084,127.00940;\ucda9\ubb34\ub85c,37.56130,126.99547;\uba85\ub3d9,37.56106,126.98827;\ud68c\ud604,37.55970,126.97956;\uc219\ub300\uc785\uad6c,37.54512,126.97195;\uc8fc\uc5fd,37.67014,126.76123;\ub300\ud654,37.67588,126.74776;\uac74\ub300\uc785\uad6c,37.54088,127.07110;\ubd88\uad11,37.61092,126.92950;\ub179\ubc88,37.60088,126.93576;\uacbd\ubcf5\uad81,37.57584,126.97358;\uc885\ub85c3\uac00,37.57255,126.99045;\uc744\uc9c0\ub85c3\uac00,37.56630,126.99262;\ub3d9\ub300\uc785\uad6c,37.55816,127.00527;\uc774\ucd0c,37.52253,126.97335;\uc11c\ube59\uace0,37.51961,126.98836;\ud55c\ub0a8,37.52936,127.00898;\uc625\uc218,37.54165,127.01730;\uc591\uc6d0,37.60660,127.10880;\uad6c\ub9ac,37.60326,127.14337;\uc11c\uad6c\uccad,37.54384,126.67679;\uad50\ub300,37.49306,127.01380;\uc11c\ucd08,37.49191,127.00795;\ubc29\ubc30,37.48147,126.99763;\ub099\uc131\ub300,37.47693,126.96378;\uc11c\uc6b8\ub300\uc785\uad6c,37.48123,126.95274;\ubd09\ucc9c,37.48242,126.94190;\uc2e0\ub9bc,37.48422,126.92957;\uc2e0\ub300\ubc29,37.48753,126.91328;\uad6c\ub85c\ub514\uc9c0\ud138\ub2e8\uc9c0,37.48501,126.90263;\ub300\ub9bc,37.49298,126.89700;\ubb38\ub798,37.51799,126.89477;\ub2f9\uc0b0,37.53388,126.90201;\uc744\uc9c0\ub85c\uc785\uad6c,37.56600,126.98257;\uc744\uc9c0\ub85c4\uac00,37.56658,126.99813;\uad6c\uc758,37.53686,127.08502;\uac15\ubcc0,37.53516,127.09468;\uc7a0\uc2e4\ub098\ub8e8,37.52069,127.10384;\uc7a0\uc2e4,37.51465,127.10427;\uc7a0\uc2e4\uc0c8\ub0b4,37.52073,127.10374;\uc885\ud569\uc6b4\ub3d9\uc7a5,37.51101,127.07364;\uc0bc\uc131,37.50883,127.06320;\uc120\ub989,37.50426,127.04817;\uc5ed\uc0bc,37.50066,127.03643;\uac15\ub0a8,37.49796,127.02754;\ud654\uc11c,37.28399,126.98958;\uad11\ub098\ub8e8,37.54530,127.10348;\ucc9c\ud638,37.53792,127.12318;\uae38\ub3d9,37.53802,127.14008;\uad7d\uc740\ub2e4\ub9ac,37.54544,127.14284;\uba85\uc77c,37.55132,127.14400;\uace0\ub355,37.55500,127.15421;\uc0c1\uc77c\ub3d9,37.55671,127.16638;\ub454\ucd0c\ub3d9,37.52779,127.13622;\uc62c\ub9bc\ud53d\uacf5\uc6d0,37.51622,127.13096;\ubc29\uc774,37.50875,127.12605;\uac1c\ub871,37.49810,127.13482;\uac70\uc5ec,37.49321,127.14398;\ub9c8\ucc9c,37.49497,127.15278;\uac15\uc77c,37.55752,127.17602;\ud558\ub0a8\uac80\ub2e8\uc0b0,37.53973,127.22343;\uc751\uc554,37.59859,126.91558;\ub3c5\ubc14\uc704,37.61841,126.93304;\uc0c8\uc808,37.59115,126.91361;\uc99d\uc0b0,37.58399,126.90978;\uc6d4\ub4dc\ucef5\uacbd\uae30\uc7a5,37.56944,126.89908;\ub9dd\uc6d0,37.55603,126.91013;\uc0c1\uc218,37.54770,126.92292;\uad11\ud765\ucc3d,37.54746,126.93197;\ub179\uc0ac\ud3c9,37.53469,126.98665;\uc774\ud0dc\uc6d0,37.53448,126.99437;\ud55c\uac15\uc9c4,37.53956,127.00173;\ubc84\ud2f0\uace0\uac1c,37.54793,127.00695;\ub300\uace1,37.63163,126.81103;\ubc31\uc591\ub9ac,37.83088,127.58908;\uc131\ub0a8,37.39471,127.11949;\uad6c\ub85c,37.50318,126.88204;\ub3d9\ub450\ucc9c\uc911\uc559,37.90182,127.05653;\ub3d9\ub450\ucc9c,37.92757,127.05482;\uc18c\uc694\uc0b0,37.94861,127.06101;\uccad\uc0b0,37.99514,127.07410;\uc804\uace1,38.02404,127.07191;\uc5f0\ucc9c,38.10048,127.07368;\uc6d0\ud765,37.65071,126.87324;\uc0bc\uc1a1,37.65310,126.89556;\ubaa9\ub3d9,37.52609,126.86430;\uc624\ubaa9\uad50,37.52456,126.87505;\uc591\ud3c9,37.52561,126.88618;\uace0\ub824\ub300,37.59034,127.03626;\uc6d4\uace1,37.60192,127.04149;\ud0dc\ub989\uc785\uad6c,37.61732,127.07474;\uc7a5\uc554,37.70015,127.05313;\ub3c4\ubd09\uc0b0,37.68913,127.04655;\uc218\ub77d\uc0b0,37.67780,127.05531;\ub9c8\ub4e4,37.66499,127.05770;\ud558\uacc4,37.63636,127.06800;\uacf5\ub989,37.62564,127.07297;\uba39\uace8,37.61064,127.07772;\uc911\ud654,37.60260,127.07925;\uba74\ubaa9,37.58867,127.08750;\uc0ac\uac00\uc815,37.58091,127.08850;\uc6a9\ub9c8\uc0b0,37.57375,127.08680;\uc911\uace1,37.56588,127.08429;\uc5b4\ub9b0\uc774\ub300\uacf5\uc6d0,37.54796,127.07465;\uc790\uc591,37.53156,127.06671;\uccad\ub2f4,37.51910,127.05185;\ud559\ub3d9,37.51426,127.03174;\ub17c\ud604,37.51111,127.02138;\ub0a8\uc131,37.48469,126.97111;\uc22d\uc2e4\ub300\uc785\uad6c,37.49626,126.95365;\uc0c1\ub3c4,37.50279,126.94795;\uc7a5\uc2b9\ubc30\uae30,37.50485,126.93903;\ucca0\uc0b0,37.47616,126.86822;\uad11\uba85\uc0ac\uac70\ub9ac,37.47927,126.85485;\ucc9c\uc655,37.48670,126.83868;\uc628\uc218,37.49206,126.82329;\uc7a5\uc790\ud638\uc218\uacf5\uc6d0,37.58722,127.13793;\uc11d\ucd0c,37.50540,127.10699;\ub2ec\uc6d4,37.37999,126.74543;\uc6d4\uacf6,37.39189,126.74274;\uc18c\ub798\ud3ec\uad6c,37.40096,126.73353;\ubbf8\uc0ac,37.56329,127.19295;\ud558\ub0a8\ud48d\uc0b0,37.55220,127.20390;\ud558\ub0a8\uc2dc\uccad,37.54172,127.20690;\uac00\ub77d\uc2dc\uc7a5,37.49300,127.11828;\uc7a5\uc9c0,37.47861,127.12623;\uc0b0\uc131,37.45689,127.14993;\ub0a8\ud55c\uc0b0\uc131\uc785\uad6c,37.45157,127.15985;\ub2e8\ub300\uc624\uac70\ub9ac,37.44506,127.15673;\uc2e0\ud765,37.44095,127.14759;\uc218\uc9c4,37.43758,127.14094;\ubaa8\ub780,37.43389,127.12992;\ub0a8\uc704\ub840,37.46284,127.13905;\uac80\ub2e8\ud638\uc218\uacf5\uc6d0,37.60250,126.68806;\uc2e0\uac80\ub2e8\uc911\uc559,37.60260,126.69861;\uc544\ub77c,37.59412,126.71301;\uacc4\uc591,37.57177,126.73632;\uade4\ud604,37.56636,126.74250;\ubc15\ucd0c,37.55353,126.74495;\uc2e0\ud3ec,37.46844,126.62451;\uc5ec\uc758\ub098\ub8e8,37.52714,126.93281;\ud654\ub791\ub300,37.61988,127.08411;\ubd09\ud654\uc0b0,37.61729,127.09137;\uc784\ud559,37.54506,126.73864;\ubd80\ud3c9\uad6c\uccad,37.50752,126.72136;\ubd80\ud3c9\uc2dc\uc7a5,37.49849,126.72228;\ub3d9\uc218,37.48541,126.71846;\ubd80\ud3c9\uc0bc\uac70\ub9ac,37.47827,126.71049;\uc778\ucc9c\uc2dc\uccad,37.45761,126.70222;\uc608\uc220\ud68c\uad00,37.44933,126.70099;\uc778\ucc9c\ud130\ubbf8\ub110,37.44192,126.69973;\ubb38\ud559\uacbd\uae30\uc7a5,37.43496,126.69837;\uc2e0\uc5f0\uc218,37.41803,126.69385;\ub3d9\ucd98,37.40468,126.68084;\ub3d9\ub9c9,37.39817,126.67356;\ucea0\ud37c\uc2a4\ud0c0\uc6b4,37.38821,126.66199;\ud14c\ud06c\ub178\ud30c\ud06c,37.38231,126.65636;\uc9c0\uc2dd\uc815\ubcf4\ub2e8\uc9c0,37.37802,126.64541;\uad6d\uc81c\uc5c5\ubb34\uc9c0\uad6c,37.40042,126.63011;\uc1a1\ub3c4\ub2ec\ube5b\ucd95\uc81c\uacf5\uc6d0,37.40687,126.62605;\ub9c8\uc804,37.59776,126.66720;\uc644\uc815,37.59287,126.67296;\ub3c5\uc815,37.58493,126.67598;\uac80\uc554,37.56916,126.67354;\uc57d\uc218,37.55409,127.01024;\uae08\ud638,37.54827,127.01578;\uc9c4\uc704,37.10977,127.06234;\uc131\ud658,36.91578,127.12701;\uc9c1\uc0b0,36.87092,127.14377;\ub450\uc815,36.83379,127.14890;\ucc9c\uc548,36.81024,127.14642;\uace0\uc794,37.31682,126.82309;\ucd08\uc9c0,37.32058,126.80615;\uc548\uc0b0,37.32701,126.78875;\uc218\ub9ac\uc0b0,37.35030,126.92554;\uc624\uc774\ub3c4,37.36177,126.73844;\uac1c\ubd09,37.49470,126.85850;\uc624\ub958\ub3d9,37.49440,126.84455;\ubd80\ud3c9,37.48946,126.72458;\uac80\ubc14\uc704,37.56109,126.67753;\uc544\uc2dc\uc544\ub4dc\uacbd\uae30\uc7a5,37.55137,126.67708;\uac00\uc815,37.52481,126.67539;\uc8fc\uc548,37.46504,126.68070;\uc81c\ubb3c\ud3ec,37.46681,126.65717;\ub3d9\uc778\ucc9c,37.47541,126.63260;\uad6c\uc77c,37.49597,126.86920;\uc18c\uc0ac,37.48275,126.79506;\ubd80\uac1c,37.48848,126.74055;\uac04\uc11d,37.46469,126.69341;\ub3c4\uc6d0,37.46860,126.64282;\uad6c\uc131,37.29901,127.10566;\ud654\uace1,37.54158,126.84044;\ud589\ub2f9,37.55730,127.02948;\uac00\uc815\uc911\uc559\uc2dc\uc7a5,37.51751,126.67678;\ubc31\uc6b4,37.48330,126.70718;\ub3d9\uc554,37.47084,126.70302;\uc11c\ubd80\uc5ec\uc131\ud68c\uad00,37.50030,126.67588;\uc778\ucc9c\uac00\uc88c,37.48996,126.67528;\uc6b4\uc5f0,37.43953,126.75961;\uae4c\uce58\uc6b8,37.50624,126.81095;\uc555\uad6c\uc815,37.52617,127.02850;\uc2e0\uc0ac,37.51644,127.02025;\uc911\ub3d9,37.48666,126.76447;\ub3c4\ud654,37.46615,126.66846;\ud55c\ub300\uc55e,37.30969,126.85366;\uc815\uc655,37.35182,126.74284;\uc5f0\uc2e0\ub0b4,37.61860,126.92052;\uad6c\uc0b0,37.61122,126.91725;\ubd80\ucc9c\uc885\ud569\uc6b4\ub3d9\uc7a5,37.50538,126.79735;\ucd98\uc758,37.50365,126.78707;\ubd80\ucc9c\uc2dc\uccad,37.50461,126.76356;\uc0c1\ub3d9,37.50577,126.75308;\uc0bc\uc0b0\uccb4\uc721\uad00,37.50643,126.74208;\uad74\ud3ec\ucc9c,37.50695,126.73148;\uc0b0\uace1,37.50855,126.70351;\uac1c\ud654,37.57859,126.79783;\uae40\ud3ec\uacf5\ud56d,37.56217,126.80127;\uacf5\ud56d\uc2dc\uc7a5,37.56373,126.81068;\uc2e0\ubc29\ud654,37.56750,126.81667;\uc120\uc720\ub3c4,37.53778,126.89389;\uad6d\ud68c\uc758\uc0ac\ub2f9,37.52810,126.91787;\uc0db\uac15,37.51730,126.92840;\uc2e0\ub17c\ud604,37.50444,127.02442;\uc5b8\uc8fc,37.50729,127.03387;\uc0bc\uc131\uc911\uc559,37.51301,127.05328;\ubd09\uc740\uc0ac,37.51422,127.06024;\uc0bc\uc804,37.50453,127.08721;\uc11d\ucd0c\uace0\ubd84,37.50244,127.09661;\ub454\ucd0c\uc624\ub95c,37.51934,127.13862;\uc911\uc559\ubcf4\ud6c8\ubcd1\uc6d0,37.52881,127.14849;\ub9c8\uace1\ub098\ub8e8,37.56582,126.82764;\uccad\ub77c\uad6d\uc81c\ub3c4\uc2dc,37.55651,126.62472;\uc6b4\uc11c,37.49285,126.49366;\uacf5\ud56d\ud654\ubb3c\uccad\uc0ac,37.45903,126.47743;\uc7a0\uc6d0,37.51299,127.01161;\uace0\uc18d\ud130\ubbf8\ub110,37.50339,127.00505;\uc2e0\uc815,37.52500,126.85618;\ud654\uc815,37.63420,126.83260;\uc815\ubc1c\uc0b0,37.65971,126.77325;\uc6d0\uc885,37.52406,126.80484;\ub9c8\uace1,37.56218,126.82693;\ubc1c\uc0b0,37.56218,126.82693;\uc6b0\uc7a5\uc0b0,37.54886,126.83633;\uae4c\uce58\uc0b0,37.53181,126.84671;\uae08\ub989,37.75129,126.76540;\uae08\ucd0c,37.76611,126.77451;\ud30c\uc8fc,37.81539,126.79243;\ubb38\uc0b0,37.85457,126.78753;\uc784\uc9c4\uac15,37.88836,126.74678;\uc6b4\ucc9c,37.87940,126.77050;\ub0a8\ubd80\ud130\ubbf8\ub110,37.48494,127.01629;\ud0c4\ud604,37.69411,126.76108;\uc57c\ub2f9,37.71275,126.76153;\uc6b4\uc815,37.72544,126.76708;\uc1a1\ud30c,37.49978,127.11212;\ubb38\uc815,37.48593,127.12247;\ub178\ub4e4,37.51273,126.95310;\ud751\uc11d,37.50889,126.96361;\ub3d9\uc791,37.50357,126.98017;\uc591\uc7ac,37.48466,127.03513;\ub9e4\ubd09,37.48711,127.04691;\ub3c5\uc0b0,37.46599,126.88951;\uc138\ub958,37.24410,127.01377;\ubcd1\uc810,37.20682,127.03327;\uc138\ub9c8,37.18729,127.04328;\uc624\uc0b0\ub300,37.16940,127.06308;\uc624\uc0b0,37.14547,127.06671;\uc1a1\ud0c4,37.07538,127.05440;\uc11c\uc815\ub9ac,37.05646,127.05284;\ud3c9\ud0dd\uc9c0\uc81c,37.01882,127.07027;\ud3c9\ud0dd,36.99056,127.08550;\uc778\ucc9c\uacf5\ud56d1\ud130\ubbf8\ub110,37.44761,126.45234;\uc778\ucc9c\uacf5\ud56d2\ud130\ubbf8\ub110,37.46866,126.43341;\uc601\uc885,37.51210,126.52425;\uad11\uba85,37.41600,126.88452;\uc0b0\ubcf8,37.35802,126.93297;\ub300\uc57c\ubbf8,37.32830,126.91716;\ubc18\uc6d4,37.31224,126.90368;\uc0c1\ub85d\uc218,37.30284,126.86653;\ub3d9\ubb18\uc55e,37.57227,127.01567;\ub300\uce58,37.49460,127.06345;\ub2f9\uc815,37.34338,126.94839;\uc11c\ub3d9\ud0c4,37.19568,127.05189;\uc11d\ucc9c\uc0ac\uac70\ub9ac,37.45693,126.71038;\ubaa8\ub798\ub0b4\uc2dc\uc7a5,37.45584,126.71958;\ub9cc\uc218,37.45496,126.73176;\ub0a8\ub3d9\uad6c\uccad,37.44818,126.73658;\uc778\ucc9c\ub300\uacf5\uc6d0,37.44848,126.75305;\uc5ed\uace1,37.48514,126.81162;\ubd80\ucc9c,37.48407,126.78278;\uc1a1\ub0b4,37.48763,126.75305;\ucc3d\uc2e0,37.57977,127.01525;\ubcf4\ubb38,37.58529,127.01938;\uc548\uc554,37.58626,127.02903;\uac00\uc7ac\uc6b8,37.48415,126.68388;\uc8fc\uc548\uad6d\uac00\uc0b0\ub2e8,37.47360,126.68110;\uc591\uc218,37.54600,127.32895;\uad6d\uc218,37.51617,127.39940;\uc544\uc2e0,37.51395,127.44324;\uc624\ube48,37.50606,127.47405;\uc6d0\ub355,37.46858,127.54747;\uc57c\ud0d1,37.41132,127.12866;\uc11c\ud604,37.38493,127.12325;\uc218\ub0b4,37.37844,127.11422;\uc815\uc790,37.36750,127.10849;\ubbf8\uae08,37.35058,127.10880;\uc624\ub9ac,37.33983,127.10899;\uc774\ub9e4,37.39474,127.12705;\ubcf4\uc815,37.31274,127.10822;\uc2e0\uac08,37.28613,127.11131;\ud559\uc5ec\uc6b8,37.49676,127.07054;\ub0a8\uad6c\ub85c,37.48618,126.88737;\uc591\ucc9c\ud5a5\uad50,37.56833,126.84139;\uac00\uc591,37.56111,126.85508;\uc99d\ubbf8,37.55785,126.86107;\ub4f1\ucd0c,37.55111,126.86472;\uc5fc\ucc3d,37.54694,126.87472;\uc2e0\ubaa9\ub3d9,37.54417,126.88306;\uc6a9\ubb38,37.48240,127.59490;\uc9c0\ud3c9,37.47650,127.62968;\ub9e4\ud0c4\uad8c\uc120,37.25246,127.04082;\uc218\uc6d0\uc2dc\uccad,37.26194,127.03074;\ubc18\ud3ec,37.50817,127.01172;\ud3c9\ub0b4\ud638\ud3c9,37.65323,127.24445;\ucc9c\ub9c8\uc0b0,37.65899,127.28573;\ub9c8\uc11d,37.65233,127.31171;\ub300\uc131\ub9ac,37.68391,127.37917;\uccad\ud3c9,37.73548,127.42654;\uc0c1\ucc9c,37.77031,127.45420;\uac00\ud3c9,37.81452,127.51069;\ubc31\uc11d,37.64297,126.78811;\ub9c8\ub450,37.65219,126.77764;\ub300\uccad,37.49361,127.07953;\uc77c\uc6d0,37.48389,127.08416;\uacbd\ucc30\ubcd1\uc6d0,37.49575,127.12420;\uc774\ub300,37.55673,126.94590;\uc544\ud604,37.55741,126.95608;\uc6a9\ub2f5,37.56641,126.97786;\uc2e0\ub2f5,37.56147,127.05635;\uc2e0\uc124\ub3d9,37.57465,127.02516;\ub3c4\ub9bc\ucc9c,37.51476,126.88259;\uc591\ucc9c\uad6c\uccad,37.51219,126.86519;\uc2e0\uc815\ub124\uac70\ub9ac,37.52022,126.85285;\uc6a9\ub450,37.57401,127.03811;\uc9c0\ucd95,37.64828,126.91255;\uad6c\ud30c\ubc1c,37.63661,126.91883;\ud64d\uc81c,37.58885,126.94409;\ubb34\uc545\uc7ac,37.58266,126.95013;\ub3c5\ub9bd\ubb38,37.57453,126.95790;\uc548\uad6d,37.57656,126.98547;\uc2e0\uc6a9\uc0b0,37.52919,126.96858;\ucd1d\uc2e0\ub300\uc785\uad6c,37.48526,126.98177;\uc778\ub355\uc6d0,37.40190,126.97672;\ud3c9\ucd0c,37.39435,126.96388;\ubc94\uacc4,37.38978,126.95075;\uae08\uc815,37.37196,126.94341;\uacbd\uae30\uad11\uc8fc,37.39897,127.25320;\uace4\uc9c0\uc554,37.35052,127.34619;\uc774\ucc9c,37.26422,127.44213;\ubd80\ubc1c,37.26041,127.49030;\uc138\uc885\ub300\uc655\ub989,37.29364,127.57076;\ubc29\ud654,37.57767,126.81282;\uac04\uc11d\uc624\uac70\ub9ac,37.46692,126.70786;\uc120\ud559,37.42699,126.69887;\uc1a1\ud30c\ub098\ub8e8,37.51055,127.11245;\ud55c\uc131\ubc31\uc81c,37.51637,127.11621;\uccad\uacc4\uc0b0\uc785\uad6c,37.44871,127.05434;\uac15\ucd0c,37.80573,127.63405;\uc0c1\uc6d4\uace1,37.60639,127.04851;\ub3cc\uacf6\uc774,37.61052,127.05642;\uad6c\ubc18\ud3ec,37.50139,126.98722;\uc2e0\ubc18\ud3ec,37.50350,126.99604;\uc0ac\ud3c9,37.50416,127.01522;\uc758\uc655,37.32065,126.94810;\uc131\uade0\uad00\ub300,37.30034,126.97086;\ubc29\ud559,37.66747,127.04430;\ub3c4\ubd09,37.67944,127.04552;\ub9dd\uc6d4\uc0ac,37.71050,127.04736;\ub0b4\ubc29,37.48764,126.99354;\uc774\uc218,37.48526,126.98177;\uc2e0\ub300\ubc29\uc0bc\uac70\ub9ac,37.49972,126.92822;\ubcf4\ub77c\ub9e4,37.49992,126.92011;\uc2e0\ud48d,37.50011,126.90981;\uc6d4\ub871,37.79620,126.79257;\uc1a1\uc815,37.56141,126.81205;\uc554\uc0ac\uc5ed\uc0ac\uacf5\uc6d0,37.55717,127.13756;\uc554\uc0ac,37.55013,127.12752;\uac15\ub3d9\uad6c\uccad,37.53035,127.12046;\ubabd\ucd0c\ud1a0\uc131,37.51769,127.11274;\uc591\uc7ac\uc2dc\ubbfc\uc758\uc232,37.47096,127.03842;\uc0bc\ub3d9,37.40873,127.20345;\uac1c\ud654\uc0b0,37.57246,126.80684;\ud310\uad50,37.39502,127.11121;\uae40\ub7c9\uc7a5,37.23732,127.19861;\uc6a9\uc778\uc911\uc559\uc2dc\uc7a5,37.23791,127.20905;\uace0\uc9c4,37.24464,127.21418;\ubcf4\ud3c9,37.25896,127.21848;\ub454\uc804,37.26721,127.21364;\uc804\ub300.\uc5d0\ubc84\ub79c\ub4dc,37.28534,127.21956;\ubc1c\uace1,37.72698,127.05289;\ubc94\uace8,37.72873,127.04372;\ud654\uacc4,37.63428,127.01750;\ub9c8\ud3ec\uad6c\uccad,37.56354,126.90333;\uc2dc\ubbfc\uacf5\uc6d0,37.45834,126.68101;\uc11d\ubc14\uc704\uc2dc\uc7a5,37.45766,126.69239;\ub2e4\uc0b0,37.62437,127.14980;\ub3d9\uad6c\ub989,37.61056,127.13506;\ub3d9\ucc9c,37.33800,127.11600;\uc218\uc9c0\uad6c\uccad,37.32250,127.09478;\uc131\ubcf5,37.31374,127.08058;\uc0c1\ud604,37.29809,127.06948;\uad11\uad50\uc911\uc559,37.28845,127.05161;\uc11c\uc6b8\uc9c0\ubc29\ubcd1\ubb34\uccad,37.50605,126.92278;\ubcf4\ub77c\ub9e4\uacf5\uc6d0,37.49522,126.91826;\ubcf4\ub77c\ub9e4\ubcd1\uc6d0,37.49296,126.92389;\ub2f9\uace1,37.49004,126.92757;\uc6d0\ub2f9,37.65310,126.84289;\uac15\ub3d9,37.53581,127.13249;\uc8fd\uc804,37.32470,127.10740;\ub300\ud765,37.54773,126.94221;\uacc4\uc0b0,37.54324,126.72844;\uacbd\uc778\uad50\ub300\uc785\uad6c,37.53827,126.72260;\uc791\uc804,37.53027,126.72255;\uac08\uc0b0,37.51712,126.72157;\uc9c0\ud589,37.89236,127.05573;\uc5ed\ucd0c,37.60605,126.92276;\uc911\uacc4,37.64505,127.06408;\uc778\ucc9c\ub300\uc785\uad6c,37.38624,126.63935;\uc13c\ud2b8\ub7f4\ud30c\ud06c,37.39283,126.63500;\uc655\uae38,37.59502,126.64228;\uac80\ub2e8\uc0ac\uac70\ub9ac,37.60169,126.65654;\uc2e0\uc911\ub3d9,37.50308,126.77616;\uac80\ub2e8\uc624\ub958,37.59502,126.62801;\uacbd\uc804\ucca0\uc758\uc815\ubd80,37.73730,127.04332;\uc758\uc815\ubd80\uc2dc\uccad,37.73925,127.03485;\uc758\uc815\ubd80\uc911\uc559,37.74372,127.04963;\ub3d9\uc624,37.74519,127.05703;\uc0c8\ub9d0,37.74890,127.06387;\uacbd\uae30\ub3c4\uccad\ubd81\ubd80\uccad\uc0ac,37.75073,127.07148;\ud6a8\uc790,37.75399,127.07731;\uace4\uc81c,37.75054,127.08387;\uc5b4\ub8e1,37.74272,127.08521;\uc1a1\uc0b0,37.73717,127.08728;\ud0d1\uc11d,37.73355,127.08891;\ubd81\ud55c\uc0b0\uc6b0\uc774,37.66284,127.01272;\uc194\ubc2d\uacf5\uc6d0,37.65607,127.01326;4.19\ubbfc\uc8fc\ubb18\uc9c0,37.64954,127.01371;\uac00\uc624\ub9ac,37.64162,127.01681;\uc0bc\uc591,37.62706,127.01817;\uc0bc\uc591\uc0ac\uac70\ub9ac,37.62144,127.02049;\uc194\uc0d8,37.62037,127.01357;\ubd81\ud55c\uc0b0\ubcf4\uad6d\ubb38,37.61233,127.00816;\uc815\ub989,37.60278,127.01345;\uc11c\uc6d0,37.47827,126.93323;\uc11c\uc6b8\ub300\ubca4\ucc98\ud0c0\uc6b4,37.47204,126.93398;\uad00\uc545\uc0b0,37.46917,126.94495;\uac15\ub0a8\ub300,37.27017,127.12607;\uc9c0\uc11d,37.26974,127.13633;\uc5b4\uc815,37.27495,127.14375;\ub3d9\ubc31,37.26930,127.15200;\ucd08\ub2f9,37.26081,127.15947;\uc0bc\uac00,37.24206,127.16818;\uc2dc\uccad.\uc6a9\uc778\ub300,37.23915,127.17841;\uba85\uc9c0\ub300,37.23808,127.19029;\uad11\uad50,37.30174,127.04486;\uc18c\uc0c8\uc6b8,37.46851,126.79723;\uc2dc\ud765\ub300\uc57c,37.45048,126.79314;\uc2e0\ucc9c,37.43912,126.78683;\uc2e0\ud604,37.40914,126.78788;\uc2dc\ud765\uc2dc\uccad,37.38141,126.80595;\uc2dc\ud765\ub2a5\uace1,37.36999,126.80859;\ub2ec\ubbf8,37.34900,126.80932;\uc120\ubd80,37.33459,126.81000;\uc2dc\uc6b0,37.31310,126.79550;\uc6d0\uc2dc,37.30265,126.78679;\uc591\ucd0c,37.64164,126.61469;\uad6c\ub798,37.64535,126.62850;\ub9c8\uc0b0,37.64061,126.64394;\uc7a5\uae30,37.64403,126.66900;\uc6b4\uc591,37.65386,126.68383;\uac78\ud3ec\ubd81\ubcc0,37.63164,126.70575;\uc0ac\uc6b0,37.62036,126.71972;\ud48d\ubb34,37.61233,126.73258;\uace0\ucd0c,37.59850,126.77150;\uc6b4\uc815\uc911\uc559,37.72544,126.76708;\ud0a8\ud14d\uc2a4,37.66532,126.74843;\ub3d9\ud0c4,37.20034,127.09569;\uc2dc\uccad,37.56353,126.97527;\uc885\uac01,37.57020,126.98312;\uc885\ub85c5\uac00,37.57097,127.00190;\uc81c\uae30\ub3d9,37.57812,127.03490;\ud765\uc120,37.74323,127.03718;\ub2e4\ub300\ud3ec\ud574\uc218\uc695\uc7a5,35.04867,128.96410;\ub2e4\ub300\ud3ec\ud56d,35.05782,128.97130;\ub0ab\uac1c,35.06526,128.97987;\uc2e0\uc7a5\ub9bc,35.07443,128.97704;\uc7a5\ub9bc,35.08109,128.97750;\ub3d9\ub9e4,35.08990,128.97420;\uc2e0\ud3c9,35.09518,128.96056;\ud558\ub2e8,35.10618,128.96680;\ub2f9\ub9ac,35.10353,128.97385;\uc0ac\ud558,35.09985,128.98310;\uad34\uc815,35.09982,128.99214;\ub300\ud2f0,35.10313,128.99994;\uc11c\ub300\uc2e0,35.11094,129.01218;\ub3d9\ub300\uc2e0,35.11045,129.01768;\ud1a0\uc131,35.10073,129.01978;\uc790\uac08\uce58,35.09737,129.02667;\ub0a8\ud3ec,35.09795,129.03487;\ubd80\uc0b0,35.11522,129.03970;\ucd08\ub7c9,35.12117,129.04304;\ubd80\uc0b0\uc9c4,35.12779,129.04789;\uc88c\ucc9c,35.13436,129.05445;\ubc94\uc77c,35.14095,129.05935;\ubc94\ub0b4\uace8,35.14740,129.05926;\uc11c\uba74,35.15828,129.05956;\ubd80\uc804,35.16259,129.06295;\uc5f0\uc0b0,35.18617,129.08153;\ub3d9\ub798,35.20564,129.07851;\uba85\ub95c,35.21255,129.07966;\uc628\ucc9c\uc7a5,35.22025,129.08644;\ubd80\uc0b0\ub300,35.22961,129.08936;\uc7a5\uc804,35.23809,129.08811;\uad6c\uc11c,35.24741,129.09133;\ub450\uc2e4,35.25696,129.09139;\ub0a8\uc0b0,35.26540,129.09250;\ubc94\uc5b4\uc0ac,35.27311,129.09268;\ub178\ud3ec,35.28469,129.09497;\uc7a5\uc0b0,35.16991,129.17699;\ud574\uc6b4\ub300,35.16367,129.15891;\ubca1\uc2a4\ucf54,35.16884,129.13893;\uc13c\ud140\uc2dc\ud2f0,35.16883,129.13174;\ubbfc\ub77d,35.16723,129.12191;\uc218\uc601,35.16523,129.11471;\uad11\uc548,35.15792,129.11317;\uae08\ub828\uc0b0,35.14977,129.11096;\ub0a8\ucc9c,35.14214,129.10798;\uacbd\uc131\ub300\u00b7\ubd80\uacbd\ub300,35.13759,129.10055;\ub300\uc5f0,35.13515,129.09216;\ubabb\uace8,35.13473,129.08442;\uc9c0\uac8c\uace8,35.13557,129.07437;\ubb38\ud604,35.13915,129.06740;\uad6d\uc81c\uae08\uc735\uc13c\ud130\u00b7\ubd80\uc0b0\uc740\ud589,35.14582,129.06676;\uc804\ud3ec,35.15310,129.06537;\ubd80\uc554,35.15744,129.05018;\uac00\uc57c,35.15588,129.04282;\ub3d9\uc758\ub300,35.15399,129.03275;\uac1c\uae08,35.15328,129.02053;\ub0c9\uc815,35.15125,129.01226;\uc8fc\ub840,35.15051,129.00308;\uac10\uc804,35.15553,128.99115;\uc0ac\uc0c1,35.16236,128.98462;\ub355\ud3ec,35.17375,128.98396;\ubaa8\ub355,35.18037,128.98562;\ubaa8\ub77c,35.18966,128.98865;\uad6c\ub0a8,35.19680,128.99493;\uad6c\uba85,35.20252,128.99932;\ub355\ucc9c,35.21022,129.00567;\uc218\uc815,35.22336,129.00920;\ud654\uba85,35.23628,129.01392;\uc728\ub9ac,35.24671,129.01292;\ub3d9\uc6d0,35.25866,129.01239;\ud638\ud3ec,35.28041,129.01710;\ubd80\uc0b0\ub300\uc591\uc0b0\ucea0\ud37c\uc2a4,35.31696,129.01394;\ub0a8\uc591\uc0b0,35.32536,129.01946;\uc591\uc0b0,35.33873,129.02639;\ub9dd\ubbf8,35.17153,129.10823;\ubc30\uc0b0,35.17350,129.09550;\ubb3c\ub9cc\uace8,35.17681,129.08575;\uac70\uc81c,35.18859,129.07394;\uc0ac\uc9c1,35.19900,129.06500;\ubbf8\ub0a8,35.20550,129.06806;\ub9cc\ub355,35.21300,129.03653;\ub0a8\uc0b0\uc815,35.21334,129.02393;\uc219\ub4f1,35.21197,129.01275;\uad6c\ud3ec,35.20670,128.99637;\uac15\uc11c\uad6c\uccad,35.21125,128.98176;\uccb4\uc721\uacf5\uc6d0,35.21258,128.96965;\ub300\uc800,35.21339,128.96105;\uc218\uc548,35.20183,129.08381;\ub099\ubbfc,35.20025,129.09077;\ucda9\ub82c\uc0ac,35.19986,129.09764;\uba85\uc7a5,35.20514,129.10152;\uc11c\ub3d9,35.21333,129.10768;\uae08\uc0ac,35.21583,129.11515;\ubc18\uc5ec\ub18d\uc0b0\ubb3c\uc2dc\uc7a5,35.21778,129.12406;\uc11d\ub300,35.21811,129.13718;\uc601\uc0b0\ub300,35.22578,129.14615;\uc717\ubc18\uc1a1,35.23251,129.15402;\uc548\ud3c9,35.23736,129.17182;\uc124\ud654\uba85\uace1,35.79862,128.48939;\ud654\uc6d0,35.80435,128.50041;\uc9c4\ucc9c,35.81381,128.52237;\uc6d4\ubc30,35.81612,128.53012;\uc0c1\uc778,35.81886,128.53756;\uc6d4\ucd0c,35.82370,128.54547;\uc1a1\ud604,35.83109,128.55176;\uc11c\ubd80\uc815\ub958\uc7a5,35.83734,128.55707;\ub300\uba85,35.83929,128.56528;\uc548\uc9c0\ub791,35.83920,128.57400;\ud604\ucda9\ub85c,35.84072,128.58085;\uc601\ub300\ubcd1\uc6d0,35.84425,128.58824;\uba85\ub355,35.85738,128.59088;\ubc18\uc6d4\ub2f9,35.86389,128.59331;\uc911\uc559\ub85c,35.87087,128.59389;\ub300\uad6c,35.87638,128.59692;\uce60\uc131\uc2dc\uc7a5,35.87616,128.60488;\ub3d9\ub300\uad6c,35.87763,128.62715;\ub3d9\uad6c\uccad,35.88448,128.63229;\uc544\uc591\uad50,35.88721,128.63957;\ub3d9\ucd0c,35.88604,128.65045;\ud574\uc548,35.88376,128.65908;\ubc29\ucd0c,35.87993,128.66977;\uc6a9\uacc4,35.87626,128.68141;\uc728\ud558,35.86975,128.69278;\uc2e0\uae30,35.86676,128.70172;\ubc18\uc57c\uc6d4,35.86595,128.71366;\uac01\uc0b0,35.86785,128.72384;\uc548\uc2ec,35.87120,128.73380;\ub300\uad6c\ud55c\uc758\ub300\ubcd1\uc6d0,35.87171,128.75082;\ubd80\ud638,35.90028,128.80311;\ud558\uc591,35.90943,128.81754;\ubb38\uc591,35.86414,128.43700;\ub2e4\uc0ac,35.86495,128.45829;\ub300\uc2e4,35.85733,128.46563;\uac15\ucc3d,35.85311,128.47900;\uacc4\uba85\ub300,35.85146,128.49197;\uc131\uc11c\uc0b0\uc5c5\ub2e8\uc9c0,35.85182,128.50717;\uc774\uace1,35.85062,128.51577;\uac10\uc0bc,35.85433,128.54790;\ub450\ub958,35.85724,128.55551;\ub0b4\ub2f9,35.86019,128.56459;\ubc18\uace0\uac1c,35.86230,128.57282;\uccad\ub77c\uc5b8\ub355,35.86500,128.58232;\uacbd\ub300\ubcd1\uc6d0,35.86310,128.60316;\ub300\uad6c\uc740\ud589,35.85987,128.61398;\ubc94\uc5b4,35.85910,128.62570;\uc218\uc131\uad6c\uccad,35.85874,128.63595;\ub9cc\ucd0c,35.85884,128.64495;\ub2f4\ud2f0,35.85484,128.65415;\uc5f0\ud638,35.84650,128.67185;\uc218\uc131\uc54c\ud30c\uc2dc\ud2f0,35.84272,128.67999;\uace0\uc0b0,35.84296,128.69335;\uc2e0\ub9e4,35.84080,128.70500;\uc0ac\uc6d4,35.83707,128.71517;\uc815\ud3c9,35.83407,128.72869;\uc784\ub2f9,35.83413,128.74108;\uc601\ub0a8\ub300,35.83637,128.75297;\uce60\uace1\uacbd\ub300\ubcd1\uc6d0,35.95839,128.55989;\ud559\uc815,35.95155,128.55919;\ud314\uac70,35.94405,128.55834;\uce60\uace1\uc6b4\uc554,35.93145,128.55453;\uad6c\uc554,35.92574,128.55034;\ud0dc\uc804,35.91962,128.54739;\ub9e4\ucc9c,35.91265,128.54340;\ub9e4\ucc9c\uc2dc\uc7a5,35.90443,128.54576;\ud314\ub2ec,35.89777,128.54680;\uacf5\ub2e8,35.89200,128.55360;\ub9cc\ud3c9,35.88989,128.56100;\ud314\ub2ec\uc2dc\uc7a5,35.88883,128.56787;\uc6d0\ub300,35.88789,128.57439;\ubd81\uad6c\uccad,35.88381,128.58145;\ub2ec\uc131\uacf5\uc6d0,35.87573,128.58212;\uc11c\ubb38\uc2dc\uc7a5,35.86966,128.58224;\uac74\ub4e4\ubc14\uc704,35.85538,128.59969;\ub300\ubd09\uad50,35.85500,128.60637;\uc218\uc131\uc2dc\uc7a5,35.85432,128.61603;\uc218\uc131\uad6c\ubbfc\uc6b4\ub3d9\uc7a5,35.85241,128.62512;\uc5b4\ub9b0\uc774\uc138\uc0c1,35.84517,128.62447;\ud669\uae08,35.83908,128.62392;\uc218\uc131\ubabb,35.83136,128.62322;\uc9c0\uc0b0,35.82515,128.63195;\ubc94\ubb3c,35.82084,128.64011;\uc6a9\uc9c0,35.81827,128.64654;\ub179\ub3d9,35.10703,126.93393;\uc18c\ud0dc,35.12411,126.93201;\ud559\ub3d9\uc99d\uc2ec\uc0ac\uc785\uad6c,35.13302,126.92838;\ub0a8\uad11\uc8fc,35.13898,126.92318;\ubb38\ud654\uc804\ub2f9,35.14661,126.92005;\uae08\ub0a8\ub85c4\uac00,35.15098,126.91445;\uae08\ub0a8\ub85c5\uac00,35.15366,126.91003;\uc591\ub3d9\uc2dc\uc7a5,35.15418,126.90109;\ub3cc\uace0\uac1c,35.15205,126.89564;\ub18d\uc131,35.15336,126.88397;\uc30d\ucd0c,35.15179,126.86952;\uc0c1\ubb34,35.14678,126.84864;\uae40\ub300\uc911\ucee8\ubca4\uc158\uc13c\ud130,35.14321,126.84144;\uacf5\ud56d,35.14418,126.81153;\uc1a1\uc815\uacf5\uc6d0,35.14357,126.79924;\uad11\uc8fc\uc1a1\uc815,35.13753,126.79149;\ub3c4\uc0b0,35.13171,126.78794;\ud3c9\ub3d9,35.12470,126.76959;\ud310\uc554,36.31690,127.45826;\ub300\ub3d9,36.32953,127.44285;\ub300\uc804,36.33158,127.43312;\uc911\uad6c\uccad,36.32483,127.41963;\uc11c\ub300\uc804\ub124\uac70\ub9ac,36.32242,127.41252;\uc624\ub8e1,36.32858,127.40505;\ud0c4\ubc29,36.34544,127.38460;\uc815\ubd80\uccad\uc0ac,36.35766,127.38105;\uac08\ub9c8,36.35752,127.37263;\uc6d4\ud3c9,36.35827,127.36438;\uac11\ucc9c,36.35458,127.35447;\uc720\uc131\uc628\ucc9c,36.35369,127.34152;\ud604\ucda9\uc6d0,36.35902,127.32152;\ub178\uc740,36.37415,127.31784;\uc9c0\uc871,36.38411,127.31950;\ubc18\uc11d,36.39213,127.31458';
let STN_LIST = null;
function nearStn(la, lo) {
  if (!STN_LIST) STN_LIST = STN_TXT.split(';').map((r) => { const q = r.split(','); return { n: q[0], la: +q[1], lo: +q[2] }; }).filter((x) => x.n && x.la && x.lo);
  let best = null, bd = 1e9;
  for (const x of STN_LIST) {
    if (Math.abs(x.la - la) > 0.01 || Math.abs(x.lo - lo) > 0.013) continue;
    const d = hav(la, lo, x.la, x.lo);
    if (d < bd) { bd = d; best = x; }
  }
  return best && bd <= STN_NEAR_M ? { n: best.n.replace(/\uc5ed$/, ''), m: bd } : null;
}
const dongOf = (dn) => { const w = String(dn || '').trim().split(/\s+/); return w[w.length - 1] || ''; };
function locHead(nm, loc, now) {                                // '\ucb48\ub974 \uc704\uce58: \ub300\ub355\ub3d9 (\uc1a1\ub3c4\uc5ed \uc8fc\ubcc0 120m)' \u2014 \uc5ed \uc8fc\ubcc0\uc774 \uc544\ub2c8\uba74 \uad04\ud638 \uc5c6\uc774 \ub3d9\uae4c\uc9c0\ub9cc
  const dong = dongOf(loc.dn), sn = nearStn(loc.la, loc.lo);
  const stale = now - loc.t > 5 * 60000 ? ' \u00b7 ' + ago(now - loc.t) : '';
  return nm + ' \uc704\uce58: ' + (dong || '\ud655\uc778 \uc911') + (sn ? ' (' + sn.n + '\uc5ed \uc8fc\ubcc0 ' + fmtDist(sn.m) + ')' : '') + stale;
}
function ga(nm) {                                              // '\ubbfc\uc9c0' -> '\ubbfc\uc9c0\uac00' \u00b7 '\ucca0\uc218' -> '\ucca0\uc218\uac00' \u00b7 \ubc1b\uce68 \uc788\uc73c\uba74 '\uc774\uac00' ('00\uc774\uac00')
  const c = nm.charCodeAt(nm.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? nm + '\uc774\uac00' : nm + '\uac00';
}
const daysTxt = (m) => { const a = []; for (let i = 0; i < 7; i++) if ((m >> i) & 1) a.push(WD[i]); return a.length === 7 ? '\ub9e4\uc77c' : a.join('\u00b7'); };
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return '\ubc29\uae08';
  if (s < 3600) return Math.round(s / 60) + '\ubd84 \uc804';
  if (s < 86400) return Math.floor(s / 3600) + '\uc2dc\uac04 \uc804';
  return Math.floor(s / 86400) + '\uc77c \uc804';
}

const authOk = new Map();                                   // \ubc29\uae08 \ud655\uc778\ud55c \uae30\uae30\ub294 5\ubd84 \ub3d9\uc548 \ub2e4\uc2dc \uc77d\uc9c0 \uc54a\ub294\ub2e4(\uc694\uccad\ub9c8\ub2e4 \ud45c \uc77d\uae30 \u00b7 \ud574\uc2dc\ub97c \uc544\ub080\ub2e4)
async function auth(req, DB, role) {
  const id = req.headers.get('x-id'), sec = req.headers.get('x-sec');
  if (!okId(id) || !okSec(sec)) return null;
  const ck = role + id + sec, hit = authOk.get(ck);
  if (hit && hit > Date.now()) return id;
  const r = await DB.prepare('SELECT sh FROM devices WHERE id=? AND role=?').bind(id, role).first();
  if (!r) return null;
  if (r.sh !== (await sha(sec))) return null;
  if (authOk.size > 500) authOk.clear();
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
/** \uc2a4\ud0c0\ud3ec\uc778\ud2b8\ub97c n \ub9cc\ud07c \ub35c\uc5b4 \ub0b8\ub2e4(\ubaa8\uc790\ub77c\uba74 false \u00b7 0 \uc544\ub798\ub85c \ub0b4\ub824\uac00\uc9c0 \uc54a\ub294\ub2e4) */
async function takeStars(DB, cid, n) {
  const r = await DB.prepare('UPDATE stars SET n=n-? WHERE cid=? AND n>=?').bind(n, cid, n).run();
  return !!(r && r.meta && r.meta.changes > 0);
}
async function addStars(DB, cid, n) {
  await DB.prepare('INSERT INTO stars(cid,n) VALUES(?,?) ON CONFLICT(cid) DO UPDATE SET n=n+excluded.n').bind(cid, n).run();
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uc2e4\uc2dc\uac04: \ubc14\ub014 \ub54c\ub9c8\ub2e4 rev \ub97c \uc62c\ub9ac\uace0, \uae30\ub2e4\ub9ac\ub294 \ucabd\uc740 \ubc14\ub00c\ub294 \uc989\uc2dc \uae68\uc5b4\ub09c\ub2e4 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const waiters = new Map();                                  // \uac19\uc740 \uc11c\ubc84 \uc548\uc5d0\uc11c \uae30\ub2e4\ub9ac\ub294 \ucabd(\ubc14\ub00c\uba74 0.6\ucd08\ub97c \uae30\ub2e4\ub9ac\uc9c0 \uc54a\uace0 \uace7\ubc14\ub85c \uae68\uc6b4\ub2e4)
function wakeAll(cid) { const w = waiters.get(cid); if (w) { waiters.delete(cid); for (const f of w) f(); } }
function sleepOrWake(cid, ms) {
  return new Promise((res) => {
    let w = waiters.get(cid); if (!w) { w = new Set(); waiters.set(cid, w); }
    const done = () => { clearTimeout(tm); w.delete(done); if (!w.size) waiters.delete(cid); res(); };
    const tm = setTimeout(done, ms); w.add(done);
  });
}
async function bump(DB, cid) {
  await DB.prepare('INSERT INTO rev(cid,n) VALUES(?,1) ON CONFLICT(cid) DO UPDATE SET n=n+1').bind(cid).run();
  wakeAll(cid);
}
/** \uc77d\uc74c(\uce74\ud1a1\uc758 '1'): \ubd80\ubaa8(p)\u00b7\uc790\ub140(c)\uac00 \ub300\ud654\ubc29\uc744 \uc2e4\uc81c\ub85c \ubcf4\ub294 \ub3d9\uc548 \uac00\uc7a5 \ucd5c\uadfc \uae00(chat.id)\uae4c\uc9c0 \uc77d\uc740 \uac83\uc73c\ub85c \uc801\ub294\ub2e4. \ubc14\ub00c\uc5c8\uc744 \ub54c\ub9cc true(\uadf8\ub9ac\uace0 \ud654\uba74 \uac31\uc2e0 \uc2e0\ud638). */
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
/** since \uc640 \ub2e4\ub978 rev \uac00 \ub420 \ub54c\uae4c\uc9c0(\ucd5c\ub300 WAIT_MS) 0.6\ucd08\ub9c8\ub2e4 \ubcf8\ub2e4. \uae30\ub2e4\ub9ac\ub294 \ub3d9\uc548 \uc2dc\uac01\uc774 \ub418\uc5b4 \uc0dd\uae30\ub294 \uc77c(\uc54c\ub9bc)\ub3c4 \uac00\ub054 \ucc59\uae34\ub2e4. */
async function waitRev(DB, cid, since, now0) {
  const end = Date.now() + WAIT_MS;
  let n = await revOf(DB, cid), i = 0;
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
  if (now - (prunedAt.get(cid) || 0) < 600000) return;           // 10\ubd84\uc5d0 \ud55c \ubc88\ub9cc \uccad\uc18c
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

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uc7a5\uc18c \uc77c\uc815: \uc2dc\uac01\uc774 \ub418\uba74 \uc624\ub298\uc758 \uc774\ub3d9(trip)\uc744 \ub9cc\ub4e0\ub2e4 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const plCache = new Map();                                  // \uc7a5\uc18c\uac00 \uc788\ub294 \uc790\ub140\uc778\uc9c0 \uc7a0\uae50 \uae30\uc5b5(\uc5c6\uc73c\uba74 \uae30\ub2e4\ub9ac\ub294 \ub3d9\uc548 \uc7a5\uc18c \ud45c\ub97c \uc77d\uc9c0 \uc54a\ub294\ub2e4)
async function tripsSync(DB, cid, now) {
  const pc = plCache.get(cid);
  if (pc && now < pc.exp && !pc.has) return;
  const pls = (await DB.prepare('SELECT id,hh,mm,days FROM places WHERE cid=?').bind(cid).all()).results || [];
  plCache.set(cid, { has: pls.length > 0, exp: now + (pls.length ? 300000 : 20000) });
  if (!pls.length) return;
  const kp = kstParts(now), st = [];
  for (const pl of pls) {
    if (!((pl.days >> kp.wd) & 1)) continue;
    const eta = etaOf(pl, now);
    if (now < eta - LEAD || now > eta + STAY) continue;
    st.push(DB.prepare("INSERT OR IGNORE INTO trips(id,cid,pl,day,st,tn) VALUES(?,?,?,?,'due',?)").bind(pl.id + ':' + kp.ds, cid, pl.id, kp.ds, now));
  }
  if (!st.length) return;
  const rs = await DB.batch(st);
  if (rs.some((r) => r && r.meta && r.meta.changes > 0)) await bump(DB, cid);
}
async function todayTrips(DB, cid, now) {
  const kp = kstParts(now);
  return (await DB.prepare('SELECT t.id id,t.pl pl,t.st st,t.tn tn,t.tk tk,t.td td,t.ta ta,t.tc tc,p.name name,p.la la,p.lo lo,p.hh hh,p.mm mm FROM trips t JOIN places p ON p.id=t.pl WHERE t.cid=? AND t.day=?').bind(cid, kp.ds).all()).results || [];
}

/** \uc790\ub140 \uc571\uc774 \uadf8\ub9ac\ub294 \ubaa8\ub4e0 \uac83: \uc5f0\uacb0 \uc218 \u00b7 \uc2a4\ud0c0\ud3ec\uc778\ud2b8 \u00b7 \uc54c\ub9bc(prompt) \u00b7 \ub0a8\uc740 \uac70\ub9ac \uc54c\uc57d(trip). \uacc4\uc0b0\uc740 \ubaa8\ub450 \uc5ec\uae30\uc11c. */
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
    out.trip = { id: r.id, name: r.name, near: m != null && m <= ARR_M && fresh, dist: m == null ? '' : fmtDist(m), text: m == null ? r.name + '\uae4c\uc9c0 \uc704\uce58\ub97c \ud655\uc778\ud558\ub294 \uc911\uc774\uc5d0\uc694' : r.name + '\uae4c\uc9c0 ' + fmtDist(m), hint: m != null && m <= ARR_M && fresh ? '\ub3c4\ucc29\ud588\uc5b4\uc694! \ud655\uc778\uc744 \ub20c\ub7ec\uc694' : '\ub3c4\ucc29\ud558\uba74 \ud655\uc778\uc744 \ub20c\ub7ec\uc694' };
  }
  const cl = await DB.prepare("SELECT k,st FROM calls WHERE cid=? AND k IN ('sos','pick') AND st IN (0,1) AND t>? ORDER BY t DESC LIMIT 1").bind(cid, now - CALL_OPEN_MS).first();
  if (cl) out.call = { k: cl.k, st: cl.st, text: cl.st === 1 ? callAck(cl.k) : '\ubd80\ubaa8\ub2d8\uaed8 \uc54c\ub838\uc5b4\uc694' };
  out.cheers = ((await DB.prepare('SELECT x FROM cheers WHERE cid=? ORDER BY id LIMIT ?').bind(cid, MAX_CHEER).all()).results || []).map((r) => r.x);
  if (due) out.prompt = { id: due.r.id, name: due.r.name, text: hmTxt(due.r.hh, due.r.mm) + '\uae4c\uc9c0 ' + due.r.name + '\uc5d0 \uac00\uc57c\ud574\uc694!' };
  return out;
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \ud654\uba74 (\uc571\uc740 \uadf8\ub9ac\uae30\ub9cc \ud55c\ub2e4) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const b = (t, o) => Object.assign({ t }, o || {});
const item = (label, act, on) => b('i', { label, act, on });
function kst(t) {
  const d = new Date(t + KST), h = d.getUTCHours();
  return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + ' ' + (h < 12 ? '\uc624\uc804' : '\uc624\ud6c4') + ' ' + (h % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

async function chatScreen(DB, cid, now) {
  const rows = (await DB.prepare('SELECT id,f,x,t,pn FROM chat WHERE cid=? AND t>=? ORDER BY id ASC LIMIT ?').bind(cid, now - CHAT_KEEP, MAX_CHAT).all()).results || [];
  const rd = await rdMap(DB, cid);
  const a = [b('head', { text: '\uac00\uc871\ub300\ud654' })];
  const k1 = [b('text', { text: '\uae00\uc790\ub9cc \ubcf4\ub0bc \uc218 \uc788\uc5b4\uc694. \ub300\ud654\ub294 7\uc77c\uc774 \uc9c0\ub098\uba74 \uc9c0\uc6cc\uc838\uc694.', sub: '1', tight: '1' })];
  if (!rows.length) k1.push(b('text', { text: '\uc544\uc9c1 \ub300\ud654\uac00 \uc5c6\uc5b4\uc694. \ubd80\ubaa8\ub2d8\uc774 \uc5f0\uacb0\ub418\uba74 \uc5ec\uae30\uc11c \uc774\uc57c\uae30\ud560 \uc218 \uc788\uc5b4\uc694.', sub: '1', tight: '1' }));
  a.push(b('box', { flush: '1', kids: k1 }));
  const k2 = rows.map((m) => b('msg', Object.assign({ text: m.x, me: m.f === 'c' ? '1' : '0', time: (m.f === 'p' && m.pn ? m.pn + ' \u00b7 ' : '') + kst(m.t) }, m.f === 'c' && m.id > rd.p ? { un: '1' } : {})));      // \ub0b4 \uae00\uc744 \ubd80\ubaa8\uac00 \uc544\uc9c1 \uc548 \uc77d\uc5c8\uc73c\uba74 un
  k2.push(b('input', { hint: '\uba54\uc2dc\uc9c0\ub97c \uc785\ub825\ud574\uc694', act: 'chat.send' }));
  a.push(b('box', { fill: '1', flush: '1', kids: k2 }));
  return { mode: 'scroll', bottom: '1', blocks: a };
}

// \ud018\uc2a4\ud2b8 \ud654\uba74: \uc704(\uc81c\ubaa9 \u00b7 \uc2a4\ud0c0\ud3ec\uc778\ud2b8 \u00b7 \uce78 \ub450 \uac1c)\ub294 \uadf8\ub300\ub85c \uc788\uace0, \uce78 \uc544\ub798 \ubaa9\ub85d\ub9cc \uc88c\uc6b0\ub85c \ubc00\ub824 \ub3c8\ub2e4(\uc571\uc774 \uce78 \uc544\ub798\ub97c \ud55c \ub369\uc5b4\ub9ac\ub85c \ubbfc\ub2e4).
async function questScreen(DB, cid, tab) {
  const rows = (await DB.prepare('SELECT id,k,x,s,pt FROM quests WHERE cid=? ORDER BY t DESC LIMIT ?').bind(cid, MAX_QUEST).all()).results || [];
  const star = await starsOf(DB, cid);
  const kid = tab !== 'p';
  const nc = rows.filter((q) => q.k !== 'p').length, np = rows.length - nc;
  const act = rows.filter((q) => (q.k !== 'p' ? q.s === QS_WAIT || q.s === QS_ON : q.s === QS_REP)).length;          // \ub0b4\uac00 \ub20c\ub7ec\uc57c \ud558\ub294 \uac83
  const pend = rows.filter((q) => q.k === 'p' && q.s === QS_WAIT).length;
  const a = [b('head', { text: '\ud018\uc2a4\ud2b8' })];
  a.push(b('stars', { n: star, label: '\uc2a4\ud0c0\ud3ec\uc778\ud2b8', sub: act > 0 ? '\ub0b4\uac00 \ud560 \uc77c ' + act + '\uac1c' : '' }));
  a.push(b('chips', { eq: '1', loop: '1', items: [item('\uc790\ub140 \ubbf8\uc158 ' + nc, 'quest.tab:c', kid ? '1' : '0'), item('\ubd80\ubaa8\ub2d8 \ubbf8\uc158 ' + np, 'quest.tab:p', kid ? '0' : '1')] }));
  a.push(b('text', { text: kid ? '\ubd80\ubaa8\ub2d8\uc774 \ubcf4\ub0b4 \uc8fc\uc2e0 \ubbf8\uc158\uc774\uc5d0\uc694. \uc2b9\ub099\ud558\uace0 \ud574\ub0b8 \ub4a4 \uc644\ub8cc\ub97c \ub204\ub974\uba74 \ubd80\ubaa8\ub2d8\uc774 \ud655\uc778\ud558\uace0, \uadf8\ub7ec\uba74 \uc2a4\ud0c0\ud3ec\uc778\ud2b8\uac00 \uc62c\ub77c\uac00\uc694.' : '\ub0b4\uac00 \ubd80\ubaa8\ub2d8\uaed8 \ubcf4\ub0b4\ub294 \ubbf8\uc158\uc774\uc5d0\uc694(\ud55c \ubc88\uc5d0 \uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + SEND_COST + '). \ubd80\ubaa8\ub2d8\uc774 \uc2b9\ub099\ud558\uba74 ' + SEND_COST + '\uc774 \ucc28\uac10\ub418\uace0, \ubd80\ubaa8\ub2d8\uc774 \uc644\ub8cc\ud558\uba74 \ub0b4\uac00 \ud655\uc778\ud574\uc694.', sub: '1' }));
  if (!kid) a.push(b('input', { hint: '\ubd80\ubaa8\ub2d8\uaed8 \ubcf4\ub0bc \ubbf8\uc158\uc744 \uc801\uc5b4\uc694 (\uc2a4\ud0c0 ' + SEND_COST + ')', act: 'quest.send' }));
  let shown = 0;
  for (const q of rows) {
    if ((q.k === 'p') === kid) continue;
    const p = q.pt || 1;
    let st, tone = '0', btns = null;
    if (kid) {
      if (q.s === QS_WAIT) { st = '\uc0c8 \ubbf8\uc158\uc774\uc5d0\uc694 \u00b7 \ud574\ub0b4\uba74 \uc2a4\ud0c0 +' + p; tone = '1'; btns = [item('\uc2b9\ub099', 'quest.accept:' + q.id, '1'), item('\uac70\uc808', 'quest.reject:' + q.id, '0')]; }
      else if (q.s === QS_ON) { st = '\uc9c4\ud589 \uc911 \u00b7 \ub2e4 \ud588\uc73c\uba74 \uc644\ub8cc\ub97c \ub20c\ub7ec\uc694 (\uc2a4\ud0c0 +' + p + ')'; tone = '1'; btns = [item('\uc644\ub8cc', 'quest.fin:' + q.id, '1')]; }
      else if (q.s === QS_REP) { st = '\uc644\ub8cc\ud588\uc5b4\uc694 \u00b7 \ubd80\ubaa8\ub2d8 \ud655\uc778\uc744 \uae30\ub2e4\ub824\uc694'; tone = '1'; }
      else if (q.s === QS_DONE) st = '\uc644\ub8cc! \uc2a4\ud0c0 +' + p + ' \ubc1b\uc558\uc5b4\uc694';
      else st = '\uac70\uc808\ud55c \ubbf8\uc158\uc774\uc5d0\uc694';
    } else {
      if (q.s === QS_WAIT) { st = '\ub300\uae30 \uc911 \u00b7 \ubd80\ubaa8\ub2d8\uc774 \uc2b9\ub099\ud558\uba74 \uc2a4\ud0c0 -' + (q.pt || SEND_COST) + ' \ucc28\uac10\ub3fc\uc694'; tone = '1'; }
      else if (q.s === QS_ON) { st = '\uc2b9\ub099! \uc2a4\ud0c0 -' + (q.pt || SEND_COST) + ' \u00b7 \ubd80\ubaa8\ub2d8\uc774 \ud558\ub294 \uc911\uc774\uc5d0\uc694'; tone = '1'; }
      else if (q.s === QS_REP) { st = '\ubd80\ubaa8\ub2d8\uc774 \uc644\ub8cc\ud588\uc5b4\uc694 \u00b7 \ud655\uc778\ud574 \uc8fc\uc138\uc694'; tone = '1'; btns = [item('\ud655\uc778', 'quest.confirm:' + q.id, '1')]; }
      else if (q.s === QS_DONE) st = '\uc644\ub8cc\ud588\uc5b4\uc694';
      else st = '\ubd80\ubaa8\ub2d8\uc774 \uac70\uc808\ud588\uc5b4\uc694';
    }
    a.push(b('card', { title: q.x, text: st, thumb: '', act: '', tone }));
    if (btns) a.push(b('btns', { items: btns }));
    shown++;
  }
  if (!shown) a.push(b('card', { title: kid ? '\uc544\uc9c1 \ubc1b\uc740 \ubbf8\uc158\uc774 \uc5c6\uc5b4\uc694' : '\uc544\uc9c1 \ubcf4\ub0b8 \ubbf8\uc158\uc774 \uc5c6\uc5b4\uc694', text: kid ? '\ubd80\ubaa8\ub2d8\uc774 \uae38\ub3d9\ubb34 \uc571\uc5d0\uc11c \ubbf8\uc158\uc744 \ubcf4\ub0b4\uba74 \uc5ec\uae30\uc5d0 \ub098\ud0c0\ub098\uc694' : '\uc704 \uce78\uc5d0 \uc801\uc5b4\uc11c \ubd80\ubaa8\ub2d8\uaed8 \ubcf4\ub0b4 \ubcf4\uc138\uc694', thumb: '', act: '' }));
  return { mode: 'scroll', blocks: a };
}

async function screenOf(DB, cid, tab, qt, now) {
  if (tab === 'chat') return chatScreen(DB, cid, now);
  if (tab === 'quest') return questScreen(DB, cid, qt);
  return null;
}
/** \uc790\ub140 \uc571\uc774 \ud55c \ubc88\uc5d0 \ubc1b\ub294 \ubb36\uc74c: \uc0c1\ud0dc + (\ubcf4\ub294 \ud0ed\uc758) \ud654\uba74\ub4e4 + rev */
async function childBundle(DB, cid, tab, qt, now, rev) {
  const o = Object.assign({ ok: true, rev }, await childState(DB, cid, now));
  if (tab === 'quest') o.screens = { c: await questScreen(DB, cid, 'c'), p: await questScreen(DB, cid, 'p') };
  else if (tab === 'chat') o.screen = await chatScreen(DB, cid, now);
  return o;
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \ubd80\ubaa8(\uae38\ub3d9\ubb34 \uc571) \ud654\uba74: \uae38\ub3d9\ubb34\uc640 \uac19\uc740 \ud654\uba74 \uaddc\uaca9(ScreenCore v1) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
const dlg = () => ({ w: 460, maxh: 0.9, dim: 0.5, top: 0.5, r: 18, mx: 14, fit: false });      // \ubaa8\ub4e0 \ud31d\uc5c5\uc774 \uac19\uc740 \ub113\uc740 \ud3ed(\ub0b4\uc6a9\uc5d0 \ub9de\ucdb0 \uc904\uc9c0 \uc54a\ub294\ub2e4)

async function childrenOf(DB, pid) {
  return (await DB.prepare('SELECT l.cid cid, l.nm nm, COALESCE(s.n,0) stars FROM links l LEFT JOIN stars s ON s.cid=l.cid WHERE l.pid=? ORDER BY l.t ASC').bind(pid).all()).results || [];
}
const nmOf = (c) => (c && c.nm ? c.nm : '\uc790\ub140');

/** \uc9c0\ub3c4 \uc544\ub798 \uc54c\ub9bc \uae00: \uc9c0\uae08 \uc2dc\uac01\uc758 \uc77c\uc815\ub9c8\ub2e4 '\ub3c4\ucc29\ud588\uc5b4\uc694 / \uac00\uace0 \uc788\uc5b4\uc694 / \ub3c4\ucc29\ud558\uc9c0 \uc54a\uc558\uc5b4\uc694 / \uace7 \uac00\uc57c \ud574\uc694' \ub97c \uc5d4\uc9c4\uc774 \uc815\ud55c\ub2e4 */
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
    if (tr && tr.tc) out.push({ tone: 'ok', s: who + ' ' + pl.name + '\uc5d0 \ub3c4\ucc29\ud588\uc5b4\uc694 \u00b7 ' + clock(tr.tc) + ' (\uc2a4\ud0c0 +' + ARRIVE_PT + ')' });
    else if (d != null && d <= HERE_M) out.push({ tone: 'ok', s: who + ' ' + pl.name + '\uc5d0 \uc640 \uc788\uc5b4\uc694 \u00b7 ' + (tr && tr.ta ? clock(tr.ta) + ' \ub3c4\ucc29' : '\uc9c0\uae08') });
    else if (now >= eta) {
      const closer = d != null && dp != null && d < dp - 15;
      if ((tr && tr.st === 'go') || closer) out.push({ tone: 'go', s: who + ' ' + pl.name + '\uc5d0 \uac00\uace0 \uc788\uc5b4\uc694' + (d != null ? ' \u00b7 \ub0a8\uc740 ' + fmtDist(d) : '') });
      else out.push({ tone: 'warn', s: who + ' ' + pl.name + '\uc5d0 \ub3c4\ucc29\ud558\uc9c0 \uc54a\uc558\uc5b4\uc694 (' + hmS + ' \uc57d\uc18d)' });
    } else if (tr && tr.st === 'go') out.push({ tone: 'go', s: who + ' ' + pl.name + '\ub85c \ucd9c\ubc1c\ud588\uc5b4\uc694' + (d != null ? ' \u00b7 \ub0a8\uc740 ' + fmtDist(d) : '') });
    else out.push({ tone: 'info', s: hmS + '\uae4c\uc9c0 ' + pl.name + ' \u2014 ' + (tr && tr.st === 'seen' ? '\uc54c\ub9bc\uc744 \ud655\uc778\ud588\uc5b4\uc694' : '\uc790\ub140\uc5d0\uac8c \uc54c\ub9bc\uc744 \ubcf4\ub0c8\uc5b4\uc694') });
  }
  return out;
}

const EV_SHOW = 50, EV_VIS = 4, HUB_CHAT = 40, CHAT_BOX = 230;     // \ud5c8\ube0c \uc544\ub798 3\uce78\uc740 \uae00 \uc218\uc640 \uc0c1\uad00\uc5c6\uc774 \ud06c\uae30 \uace0\uc815: \ud65c\ub3d9 \uce78 = \uc0c1\ud0dc 2\uc904 + \ud65c\ub3d9 EV_VIS \uc904 \u00b7 \ud018\uc2a4\ud2b8 \uce78 = \ub2e8\ucd94\u00b7\uc2a4\ud0c0\ud3ec\uc778\ud2b8\u00b7\ubc14\ub85c\uac00\uae30 \u00b7 \ub300\ud654 \uce78 = \uae00 \uc601\uc5ed CHAT_BOX(dp). \ub118\uce58\ub294 \uae00\uc740 \uce78 \uc548\uc5d0\uc11c\ub9cc \uc704\uc544\ub798\ub85c \ubbfc\ub2e4                    
const KIDS_TAB = { label: '\ud0a4\uc988', icon: 'M12 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM6.8 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17.2 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 12.5c-3.9 0-7 2-7 4.5V22h14v-5c0-2.5-3.1-4.5-7-4.5z' };      // \ud0a4\uc988 \ubaa8\ub4dc\uc758 \uc544\ub798 \ud0ed(\ud648 \uce78\uc744 \ubc14\uafd4 \uadf8\ub9b0\ub2e4): \uc5b4\ub9b0\uc774 \ubaa8\uc591 + \uae00\uc790 \u2014 \uc571\uc740 \uc774\ub300\ub85c \uadf8\ub9b0\ub2e4
const evWhen = (t, now) => { if (kstParts(t).ds === kstParts(now).ds) return clock(t); const d = new Date(t + KST); return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + ' ' + clock(t); };
/** \ud65c\ub3d9 \ud55c \uc904\uc758 \uae00(\uc885\ub958 k \u00b7 x \ub294 \uc7a5\uc18c \u00b7 \ub3d9\ub124 \u00b7 \uce5c\uad6c \uc774\ub984). \uc790\ub140 \uc774\ub984 nm \uc740 \ubd80\ubaa8\uac00 \uc815\ud55c \uc774\ub984 */
function eul(w) { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? w + '\uc744' : w + '\ub97c'; }
function evText(e, nm) {
  const x = e.x;
  switch (e.k) {
    case 'loc': return '\ud604\uc7ac \uc704\uce58 \u00b7 ' + x;
    case 'mv': return '\uc774\ub3d9 \uc911 \u00b7 ' + x;
    case 'at': return x + ' \uadfc\ucc98\uc5d0 \uc654\uc5b4\uc694';
    case 'lv': return x + '\uc5d0\uc11c \uba40\uc5b4\uc84c\uc5b4\uc694';
    case 'odd': return '\ud3c9\uc18c\uc640 \ub2e4\ub978 \uacf3\uc5d0 \uba38\ubb3c\ub7ec\uc694 \u00b7 ' + x;
    case 'go': return x + '\ub85c \ucd9c\ubc1c\ud588\uc5b4\uc694';
    case 'done': return x + '\uc5d0 \ub3c4\ucc29\ud588\uc5b4\uc694 (\uc2a4\ud0c0 +' + ARRIVE_PT + ')';
    case 'feed': return ga(nm) + ' ' + x + '\uc5d0\uac8c \ubc25\uc744 \uc92c\uc5b4\uc694';
    case 'clean': return ga(nm) + ' ' + x + '\uc758 \uc751\uac00\ub97c \uce58\uc6cc \uc92c\uc5b4\uc694';
    case 'drop': return ga(nm) + ' ' + eul(x) + ' \uacf5\uc911\uc5d0\uc11c \ub5a8\uc5b4\ub728\ub838\uc5b4\uc694';
    case 'dress': return ga(nm) + ' ' + eul(x) + ' \uafb8\uba70 \uc92c\uc5b4\uc694';
    case 'psleep': return ga(nm) + ' ' + eul(x) + ' \uc7ac\uc6e0\uc5b4\uc694';
    case 'pstudy': return ga(nm) + ' ' + x + '\uc5d0\uac8c \uacf5\ubd80\ub97c \uc2dc\ucf30\uc5b4\uc694';
    case 'pplay': return ga(nm) + ' ' + eul(x) + ' \ub180\uac8c \ud588\uc5b4\uc694';
    case 'sos': return ga(nm) + ' \uae34\uae09 \ud638\ucd9c\uc744 \ud588\uc5b4\uc694' + (x ? ' \u00b7 ' + x + ' \uadfc\ucc98' : '');
    case 'pick': return ga(nm) + ' \ub370\ub9ac\ub7ec \uc640 \ub2ec\ub77c\uace0 \ud588\uc5b4\uc694' + (x ? ' \u00b7 ' + x + ' \uadfc\ucc98' : '');
    case 'arr': return ga(nm) + ' \uc548\uc804\ud558\uac8c \ub3c4\ucc29\ud588\ub2e4\uace0 \uc54c\ub838\uc5b4\uc694' + (x ? ' \u00b7 ' + x : '');
    default: return x;
  }
}
/** \uae38\ub3d9\ubb34 \ud655\uc778 \ud654\uba74(\ud648 \ubc84\ud2bc\uc744 3\ucd08 \ub204\ub974\uba74 \uc624\ub978\ucabd\uc5d0\uc11c \ubc00\ub824 \ub4e4\uc5b4\uc624\ub294 \ud654\uba74) */
async function hubScreen(DB, pid, cid, now) {
  const kids = await childrenOf(DB, pid);
  const cur = kids.find((k) => k.cid === cid) || kids[0];
  if (!cur) return scr('kids', [], [b('text', { t: 'text' })].slice(0, 0).concat([tx('\uc5f0\uacb0\ub41c \uc790\ub140\uac00 \uc5c6\uc5b4\uc694', { size: 15, bold: true, pad: [16, 24, 16, 6] }), tx('\uae38\ub3d9\ubb34 \ud0a4\uc988\uc758 \uc2dc\ud06c\ub9bf \ud0a4\ub098 QR \ub85c \uc5f0\uacb0\ud574 \uc8fc\uc138\uc694', { color: 'sub', pad: [16, 0, 16, 0] })]));
  cid = cur.cid;
  const nm = nmOf(cur);
  if (!(await gdOk(DB, pid))) return gdScreen(nm);                 // \ubc95\uc815\ub300\ub9ac\uc778 \ud655\uc778 \uc804\uc5d0\ub294 \uc790\ub140 \uc704\uce58\ub97c \ubcf4\uc5ec \uc8fc\uc9c0 \uc54a\ub294\ub2e4
  await tripsSync(DB, cid, now);
  const loc = await DB.prepare('SELECT la,lo,acc,t,pla,plo,plt,dn,bt,ch,hd,hdt,mt FROM loc WHERE cid=?').bind(cid).first();
  const watching = !!(await watchOf(DB, cid, now));
  const cs = (await DB.prepare('SELECT sh FROM cst WHERE cid=?').bind(cid).first()) || { sh: 1 };
  const pls = (await DB.prepare('SELECT id,name,la,lo,hh,mm,days FROM places WHERE cid=? ORDER BY hh,mm LIMIT ?').bind(cid, MAX_PLACES).all()).results || [];
  const trips = await todayTrips(DB, cid, now);
  const pins = [];
  const heading = loc && watching && loc.hd >= 0 && now - loc.mt < MOVE_REC_MS && now - loc.hdt < 90000 ? loc.hd : -1;       // \uc6c0\uc9c1\uc774\ub294 \uc911\uc77c \ub54c\ub9cc \uac00\ub294 \ubc29\ud5a5(\uc571\uc740 \ud654\uc0b4\ud45c\ub9cc \ub3cc\ub9b0\ub2e4)
  if (loc) pins.push({ la: loc.la, lo: loc.lo, k: 'm', l: nm, ...(heading >= 0 ? { h: heading } : {}) });
  pls.slice(0, 9).forEach((p, i) => pins.push({ la: p.la, lo: p.lo, k: 's', n: String(i + 1), l: p.name, v: 'kp.' + p.id }));
  const calls = (await DB.prepare("SELECT id,k,t,la,lo,pl,st FROM calls WHERE cid=? AND k IN ('sos','pick') AND st IN (0,1) AND t>? ORDER BY t DESC LIMIT 2").bind(cid, now - CALL_OPEN_MS).all()).results || [];
  let cpin = -1;                                                                  // \uae34\uae09 \ud638\ucd9c \u00b7 \ub370\ub9ac\ub7ec \uc640\uc918 \uac00 \uc788\uc73c\uba74 \uadf8 \uc790\ub9ac\ub97c \uc9c0\ub3c4\uc5d0 \ucc0d\uace0 \uac70\uae30\ub85c \ub9de\ucd98\ub2e4
  for (const c of calls) if ((c.la || c.lo) && cpin < 0) { cpin = pins.length; pins.push({ la: c.la, lo: c.lo, k: 's', n: '!', l: c.k === 'sos' ? '\uae34\uae09' : '\ub370\ub9ac\ub7ec' }); }
  const noLoc = !pins.length;
  if (noLoc) pins.push({ la: 37.5665, lo: 126.978, k: 's', n: '', l: '' });
  // \uc774\ub3d9 \uacbd\ub85c: \uc9c0\ub09c TRAIL_MS \ub3d9\uc548 \uc313\uc778 \uc810(\ucd5c\ub300 TRAIL_PTS \uac1c\ub85c \uc18e\uc74c) + \uc9c0\uae08 \uc704\uce58
  let trail = ((await DB.prepare('SELECT la,lo FROM locs WHERE cid=? AND t>=? ORDER BY id ASC LIMIT 1500').bind(cid, now - TRAIL_MS).all()).results || []).map((r) => [+r.la.toFixed(5), +r.lo.toFixed(5)]);
  if (loc && trail.length && hav(trail[trail.length - 1][0], trail[trail.length - 1][1], loc.la, loc.lo) >= 15) trail.push([+loc.la.toFixed(5), +loc.lo.toFixed(5)]);
  if (trail.length > TRAIL_PTS) { const st2 = (trail.length - 1) / (TRAIL_PTS - 1); trail = Array.from({ length: TRAIL_PTS }, (_, i) => trail[Math.round(i * st2)]); }
  // \uc9c0\ub09c \uacbd\ub85c \ubcf4\uae30(s391): \ubd80\ubaa8\uac00 \uace0\ub978 \uacbd\ub85c\uac00 \uc788\uace0 10\ubd84\uc774 \uc548 \uc9c0\ub0ac\uc73c\uba74 \uc9c0\ub3c4\uc5d0 \uadf8 \uacbd\ub85c\ub97c(\ucd9c\ubc1c \u00b7 \ub3c4\ucc29 \ud540) \uadf8\ub9b0\ub2e4 \u2014 \uace0\ub974\ub294 \uac83\ub3c4 \uadf8\ub9ac\ub294 \uac83\ub3c4 \uc5d4\uc9c4, \uc571\uc740 \ubc1b\uc740 \uc120\uacfc \ud540\uc744 \uadf8\ub9b4 \ubfd0
  const rts = ((await DB.prepare('SELECT id,t0,t1,m,sn,en FROM routes WHERE cid=? ORDER BY id DESC LIMIT ?').bind(cid, RT_KEEP).all()).results || []);
  const vs = await DB.prepare('SELECT rv,rvt FROM devices WHERE id=?').bind(pid).first();
  const rview = vs && vs.rv && vs.rvt > now - RT_VIEW_MS ? await DB.prepare('SELECT id,t0,t1,m,sn,en,pts FROM routes WHERE id=? AND cid=?').bind(vs.rv, cid).first() : null;
  let rpts = null;
  if (rview) { try { rpts = JSON.parse(rview.pts); } catch (e) { rpts = null; } }
  const viewing = !!(rview && rpts && rpts.length >= 2);
  if (viewing) {
    trail = rpts.slice(0, 400);
    pins.length = 0;
    pins.push({ la: rpts[0][0], lo: rpts[0][1], k: 's', n: '\ucd9c', l: rview.sn || '\ucd9c\ubc1c' }, { la: rpts[rpts.length - 1][0], lo: rpts[rpts.length - 1][1], k: 's', n: '\ub3c4', l: rview.en || '\ub3c4\ucc29' });
  }
  const follow = !viewing && cpin < 0 && !!loc && !noLoc && watching && now - loc.t < 60000;                  // \uc2e4\uc2dc\uac04 \ub530\ub77c\uac00\uae30(s393): \ubcf4\ub294 \uc911\uc774\uace0 \uc704\uce58\uac00 \ubc29\uae08 \uc628 \uac83\uc77c \ub54c\ub9cc \u2014 \uc571\uc740 \uc810\uc744 \ubd80\ub4dc\ub7fd\uac8c \uc62e\uae30\uace0 \uc9c0\ub3c4\uac00 \ub530\ub77c\uac04\ub2e4
  const head = [
    viewing ? { t: 'lth', s: nm + ' \uc9c0\ub09c \uacbd\ub85c', dot: '#8e8e93', live: false, pad: [16, 8, 16, 6] } : { t: 'lth', s: '\uc790\ub140 \uc704\uce58', dot: '#111111', live: true, pad: [16, 8, 16, 6] },
    { t: 'tmap', ...(trail.length >= 2 ? { line: trail } : {}), live: 1, h: 250, r: 14, pad: [12, 0, 12, 0], pts: pins, foc: viewing ? -1 : cpin >= 0 ? cpin : loc ? 0 : -1, ...(follow ? { fol: 1 } : {}), hint: viewing ? '\uc9c0\ub09c \uacbd\ub85c \u00b7 \uc544\ub798 \ub2e8\ucd94\ub85c \uc2e4\uc2dc\uac04\uc73c\ub85c \ub3cc\uc544\uac00\uc694' : noLoc ? '\uc790\ub140 \uc704\uce58\ub97c \uc544\uc9c1 \ubc1b\uc9c0 \ubabb\ud588\uc5b4\uc694' : follow ? '\uc2e4\uc2dc\uac04\uc73c\ub85c \ub530\ub77c\uac00\ub294 \uc911 \u00b7 \uc9c0\ub3c4\ub97c \ubc00\uba74 \uc7a0\uc2dc \uba48\ucdb0\uc694' : '\uc9c0\ub3c4\ub97c 3\ucd08 \ub204\ub974\uba74 \uc7a5\uc18c\ub97c \ub4f1\ub85d\ud574\uc694', lp: 'kpl.new', fp: 40, fz: 16 },
  ];
  for (const c of calls.slice().reverse()) head.unshift(panel([
    tx((c.k === 'sos' ? '\ud83d\udea8 ' + nm + ' \uae34\uae09 \ud638\ucd9c' : '\ud83d\ude97 ' + nm + ' \ub370\ub9ac\ub7ec \uc640 \ub2ec\ub77c\uace0 \ud574\uc694'), { size: 15, bold: true, color: 'orange', lines: 1 }),
    tx(clock(c.t) + (c.pl ? ' \u00b7 ' + c.pl + ' \uadfc\ucc98' : '') + (c.st === 1 ? ' \u00b7 \ubd80\ubaa8\ub2d8 \uc911 \ud55c \ubd84\uc774 \ud655\uc778\ud588\uc5b4\uc694' : '') + ((c.la || c.lo) ? ' \u00b7 \uc9c0\ub3c4\uc5d0 \ud45c\uc2dc\ud588\uc5b4\uc694' : ' \u00b7 \uc704\uce58\ub97c \uc544\uc9c1 \ubabb \ubc1b\uc558\uc5b4\uc694'), { size: 11.5, color: 'sub', lines: 2, pad: [0, 3, 0, 8] }),
    { t: 'row', gap: 8, kids: [c.st === 0 ? btn(c.k === 'sos' ? '\ud655\uc778\ud588\uc5b4\uc694' : '\uc9c0\uae08 \uac00\uc694', call('kx.ack', '', c.id), gold) : btn(c.k === 'sos' ? '\uc0c1\ud669\uc774 \ub05d\ub0ac\uc5b4\uc694' : '\ub9cc\ub0ac\uc5b4\uc694', call('kx.done', '', c.id), gold)] },
  ], { pad: [12, 8, 12, 0], ip: [14, 12, 14, 12] }));
  const body = [];
  if (viewing) body.push(panel([
    tx(rtTitle(rview, now), { size: 13, bold: true, lines: 1 }),
    tx(rtSub(rview), { size: 11.5, color: 'sub', lines: 1, pad: [0, 3, 0, 8] }),
    { t: 'row', gap: 8, kids: [btn('\uc2e4\uc2dc\uac04\uc73c\ub85c \ub3cc\uc544\uac00\uae30', call('kr.live'), { fill: 'card2', tc: 'text', line: 'border', h: 38, size: 12.5 }), btn('\ub2e4\ub978 \uacbd\ub85c \ubcf4\uae30', call('kr.open'), { fill: 'card2', tc: 'text', line: 'border', h: 38, size: 12.5 })] },
  ], { pad: [12, 10, 12, 0] }));
  if (kids.length > 1) body.push({ t: 'chips', pad: [12, 8, 12, 0], items: kids.map((k) => ({ label: nmOf(k), on: k.cid === cid, act: call('kc.' + k.cid) })) });
  // \ubb50\ud558\ub2c8?: \uc9c0\uae08 \uc0c1\ud0dc \ud55c\ub450 \uc904 + \ud65c\ub3d9 \uae30\ub85d(\ucc44\ud305\ucc98\ub7fc \uc544\ub798\ub85c \uac08\uc218\ub85d \ucd5c\uadfc \u2014 \uc9c0\ub09c \uc77c\uc740 '\uc9c0\ub09c \ud65c\ub3d9 \ubcf4\uae30'\ub85c \uc62c\ub824 \ubcf8\ub2e4)
  const lines = alertLines(nm, pls, trips, loc, now);
  if (loc && cs.sh === 0) lines.unshift({ tone: 'warn', s: nm + '\uac00 \uc704\uce58 \uacf5\uc720\ub97c \uaed0\uc5b4\uc694 \u00b7 \ub9c8\uc9c0\ub9c9 ' + clock(loc.t) });          // \uc548\uc804 \uc54c\ub9bc(s392): \uc704\uce58\uac00 \uc548 \uc624\ub294 \uc774\uc720\ub97c \ud654\uba74\uc5d0\uc11c\ub3c4 \ubc14\ub85c \uc54c\ub824 \uc900\ub2e4
  else if (loc && now - loc.t >= STALE_MS) lines.unshift({ tone: 'warn', s: '\uc704\uce58\uac00 ' + ago(now - loc.t).replace(' \uc804', '') + ' \ub3d9\uc548 \ub4e4\uc5b4\uc624\uc9c0 \uc54a\uc544\uc694 \u00b7 \ub9c8\uc9c0\ub9c9 ' + clock(loc.t) });
  if (loc && loc.bt >= 0 && loc.bt <= BATT_LOW && !loc.ch && now - loc.t < 30 * 60000) lines.unshift({ tone: 'warn', s: nm + ' \ud3f0 \ubc30\ud130\ub9ac ' + loc.bt + '%' });
  const st = [];                                                                   // \uc0c1\ud0dc \uae00: {s, bold, color, size} \u2014 \uce78\uc5d0\ub294 \uc815\ud655\ud788 2\uc904(\ud55c \uc904\uc529 \u00b7 \uae38\uba74 \u2026 \uc73c\ub85c \uc904\uc784), 3\uc9f8 \uc904\ubd80\ud130\ub294 \uc544\ub798 \ubaa9\ub85d \ub9e8 \uc704 \uc904\ub85c \ub118\uae34\ub2e4
  if (!loc) {
    st.push({ s: nm + '\uc758 \uc704\uce58\ub97c \uc544\uc9c1 \ubc1b\uc9c0 \ubabb\ud588\uc5b4\uc694', size: 13, bold: true, color: 'text' });
    if ((locAskAt.get(cid) || 0) > now - LOC_ASK_GAP) st.push({ s: '\uc790\ub140 \ud3f0\uc5d0 \uc704\uce58\ub97c \uc694\uccad\ud588\uc5b4\uc694 \u00b7 \uace7 \ub098\ud0c0\ub098\uc694', size: 11.5, bold: false, color: 'sub' });
  }
  else if (!lines.length) st.push({ s: locHead(nm, loc, now), size: 13, bold: true, color: 'text' }, { s: pls.length ? '\uc624\ub298\uc740 \ub3c4\ucc29\ud574\uc57c \ud560 \uc7a5\uc18c\uac00 \uc5c6\uc5b4\uc694' : '\uc7a5\uc18c\ub97c \ub4f1\ub85d\ud558\uba74 \ub3c4\ucc29 \uc5ec\ubd80\ub97c \uc54c\ub824 \ub4dc\ub824\uc694', size: 11.5, bold: false, color: 'sub' });
  for (const l of lines) st.push({ s: l.s, size: 13, bold: true, color: l.tone === 'warn' ? 'orange' : l.tone === 'ok' ? 'gold' : 'text' });
  const al = st.slice(0, 2).map((x, i) => tx(x.s, { size: x.size, bold: x.bold, color: x.color, lines: 1, pad: [0, i ? 4 : 0, 0, 0] }));
  while (al.length < 2) al.push(tx('\u00a0', { size: 11.5, lines: 1, pad: [0, 4, 0, 0] }));        // \ud56d\uc0c1 2\uc904 \u2014 \uae00\uc774 \uc801\uc5b4\ub3c4 \uce78 \ub192\uc774\uac00 \uac19\ub2e4
  const evr = ((await DB.prepare('SELECT k,x,t FROM evs WHERE cid=? AND t>=? AND k NOT IN ' + EV_HIDE + ' ORDER BY id DESC LIMIT ?').bind(cid, now - EV_KEEP, EV_SHOW + 1).all()).results || []);
  const evs = evr.slice(0, EV_SHOW).reverse();                                   // \uc544\ub798\ub85c \uac08\uc218\ub85d \ucd5c\uadfc
  // \ud65c\ub3d9 \uce78: \ub298 \uc0c1\ud0dc 2\uc904 + \ud65c\ub3d9 EV_VIS \uc904\uc774 \ubcf4\uc778\ub2e4(\uae00\uc774 \uc801\uc73c\uba74 \ube48 \uc904\ub85c \ucc44\uc6cc \uac19\uc740 \ub192\uc774) \u00b7 \ub354 \uc788\uc73c\uba74 \uce78 \uc548\uc5d0\uc11c \uc704\uc544\ub798\ub85c \ubc00\uc5b4 \uc9c0\ub09c \ud65c\ub3d9\uc744 \ubcf8\ub2e4(\ucc98\uc74c\uc5d4 \ub9e8 \uc544\ub798 = \uac00\uc7a5 \ucd5c\uadfc)
  const rows = st.slice(2).map((x) => ({ a: x.s })).concat(evs.map((e, i) => ({ a: evWhen(e.t, now) + '  ' + evText(e, nm), on: i === evs.length - 1, act: call('kd.open') })));
  if (!evs.length) rows.push({ a: '\uc544\uc9c1 \ud65c\ub3d9\uc774 \uc5c6\uc5b4\uc694. \uae38\ub3d9\ubb34 \ud0a4\uc988\uac00 \ucf1c\uc838 \uc788\uc73c\uba74 \uc5ec\uae30\uc5d0 \ub098\ud0c0\ub098\uc694', on: true });
  while (rows.length < EV_VIS) rows.unshift({ a: '\u00a0' });
  const fk = [{ t: 'pickl', key: 'kev' + cid, plain: true, h: 21, vis: EV_VIS, size: 12.5, pad: [0, 8, 0, 0], rows }];
  body.push({ t: 'lth', s: nm + ' \ubb50\ud558\ub2c8?', dot: '#ff3b30', live: true, pad: [16, 12, 16, 0] });
  const regBtn = { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('+ \uc7a5\uc18c \ub4f1\ub85d (\ub3c4\ucc29\u00b7\ucd9c\ubc1c \uc54c\ub9bc)', call('kpg.open', cid), { fill: 'card2', tc: 'text', line: 'border', h: 36, size: 12.5 })] };
  body.push(panel(al.concat(fk, [regBtn]), { pad: [12, 1, 12, 0], fill: lines.some((l) => l.tone === 'warn') ? 'card2' : 'card' }));
  // \ud018\uc2a4\ud2b8(\ub178\ub780 \uc810)
  const qs = (await DB.prepare('SELECT k,s FROM quests WHERE cid=?').bind(cid).all()).results || [];
  const nc = qs.filter((q) => q.k === 'c').length, np = qs.length - nc, wait = qs.filter((q) => (q.k === 'c' && q.s === QS_REP) || (q.k === 'p' && (q.s === QS_WAIT || q.s === QS_ON))).length;
  body.push({ t: 'lth', s: '\ud018\uc2a4\ud2b8', dot: '#f5b800', live: true, pad: [16, 12, 16, 0] });
  body.push(panel([
    { t: 'row', gap: 8, kids: [btn('\uc790\ub140 \ubbf8\uc158 ' + nc, call('kq.open', cid, 'c'), { fill: 'card2', tc: 'text', line: 'border', h: 40, size: 12.5 }), btn('\ubd80\ubaa8\ub2d8 \ubbf8\uc158 ' + np, call('kq.open', cid, 'p'), { fill: 'card2', tc: 'text', line: 'border', h: 40, size: 12.5 })] },
    tx('\uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + cur.stars + (wait ? ' \u00b7 \ub0b4\uac00 \ud560 \uc77c ' + wait + '\uac1c' : ''), { size: 13, bold: true, color: wait ? 'orange' : 'gold', lines: 1, pad: [0, 8, 0, 6] }),
    { t: 'navrow', title: '\ubbf8\uc158 \ubcf4\ub0b4\uae30 \u00b7 \ud655\uc778\ud558\uae30', sub: wait ? '\ucc98\ub9ac\ud560 \uc77c ' + wait : '', act: call('kq.open', cid, 'c'), size: 13, vp: 8 },
  ], { pad: [12, 1, 12, 0] }));
  // \uc9c0\ub09c \uacbd\ub85c(s391): 30\ubd84 \ub118\uac8c \uba38\ubb3c \ub54c\ub9c8\ub2e4 \uadf8 \uc804\uae4c\uc9c0\uc758 \uae38\uc774 \uc800\uc7a5\ub41c\ub2e4 \u2014 \uc790\ub140\ub2f9 RT_KEEP \uac1c
  if (!viewing) body.push(panel([{ t: 'navrow', title: '\uc9c0\ub09c \uacbd\ub85c', sub: rts.length ? rts.length + '\uac1c \u00b7 \ucd5c\uadfc ' + rtTitle(rts[0], now) : '\uc544\uc9c1 \uc5c6\uc5b4\uc694 \u00b7 \ud55c \uacf3\uc5d0 30\ubd84 \uba38\ubb3c\uba74 \uc800\uc7a5\ub3fc\uc694', act: call('kr.open'), size: 13, vp: 8 }], { pad: [12, 8, 12, 0], ip: [14, 6, 14, 6] }));
  // \uc7a5\uc18c\u00b7\uae30\ub85d
  if (pls.length) {
    const k = [tx('\ub4f1\ub85d\ud55c \uc7a5\uc18c', { size: 12, bold: true, color: 'sub', pad: [0, 0, 0, 4] })];
    pls.forEach((p, i) => k.push({ t: 'navrow', title: (i + 1) + '. ' + p.name, sub: p.days ? pad2(p.hh) + ':' + pad2(p.mm) + ' ' + daysTxt(p.days) : '\ucd9c\uc785 \uc54c\ub9bc \u00b7 \uc2dc\uac01 \uc5c6\uc74c', act: call('kp.' + p.id), size: 13, vp: 8 }));
    body.push(panel(k, { pad: [12, 8, 12, 0], ip: [14, 12, 14, 6] }));
  }
  const hist = (await DB.prepare('SELECT t.day day,t.st st,t.tn tn,t.td td,t.ta ta,t.tc tc,p.name name FROM trips t JOIN places p ON p.id=t.pl WHERE t.cid=? AND t.td>0 ORDER BY t.td DESC LIMIT 4').bind(cid).all()).results || [];
  if (hist.length) {
    const k = [tx('\ucd5c\uadfc \uc774\ub3d9 \uae30\ub85d', { size: 12, bold: true, color: 'sub', pad: [0, 0, 0, 4] })];
    for (const h of hist) {
      const dd = String(h.day).slice(4, 6) * 1 + '/' + String(h.day).slice(6) * 1;
      k.push(tx(dd + ' ' + h.name + ' \u00b7 ' + clock(h.td) + ' \ucd9c\ubc1c' + (h.tc ? ' \u2192 ' + clock(h.tc) + ' \ub3c4\ucc29 (\uc2a4\ud0c0 +' + ARRIVE_PT + ')' : h.ta ? ' \u2192 ' + clock(h.ta) + ' \ub3c4\ucc29(\ubbf8\ud655\uc778)' : ' \u2192 \ub3c4\ucc29 \uc804'), { size: 12, color: h.tc ? 'text' : 'sub', pad: [0, 2, 0, 2] }));
    }
    body.push(panel(k, { pad: [12, 8, 12, 0] }));
  }
  // \uac00\uc871 \uc2e4\uc2dc\uac04 \ub300\ud654(\ud30c\ub780 \uc810): \uc81c\ubaa9\uc740 \ub124\ubaa8\uce78 \ubc16(\uc704)\uc5d0 \u2014 \ub124\ubaa8\uce78 \uc548\uc740 \uc704\uac00 \ub300\ud654 \ub0b4\uc6a9(\ub0a8\ub294 \uc138\ub85c\ub97c \ucc98\uc74c\ubd80\ud130 \ub2e4 \ucc28\uc9c0 \u00b7 \uc544\ub798\uac00 \ucd5c\uadfc \u00b7 \uc9c0\ub09c \uae00\uc740 \uce78 \uc548\uc5d0\uc11c\ub9cc \ubc00\uc5b4 \ubd04), \ub9e8 \uc544\ub798\uac00 \uc785\ub825\uc904. \ubc15\uc2a4\ub97c \ub204\ub974\uba74 \uc804\uccb4 \ub300\ud654 \ud31d\uc5c5
  const msgs = ((await DB.prepare('SELECT id,f,x,t FROM chat WHERE cid=? AND t>=? ORDER BY id DESC LIMIT ?').bind(cid, now - CHAT_KEEP, HUB_CHAT).all()).results || []).reverse();
  const rd = await rdMap(DB, cid);
  const ck = [{ t: 'spacer', h: 0, ffill: 1, fk: 3, fdh: 42, ffmax: CHAT_BOX }];          // \ub0a8\ub294 \uc138\ub85c\ub97c \uba54\uc6b0\ub294 \ube48\uce78 \u2014 \uae00\uc740 \uc544\ub798(\ucd5c\uc2e0)\uc5d0 \ubd99\uace0 \uc704\ub85c \uacfc\uac70
  if (!msgs.length) ck.push(tx('\uc544\uc9c1 \ub300\ud654\uac00 \uc5c6\uc5b4\uc694. ' + nm + '\uc5d0\uac8c \uba3c\uc800 \ub9d0\uc744 \uac78\uc5b4 \ubcf4\uc138\uc694', { size: 12, color: 'sub', pad: [2, 6, 2, 2] }));
  msgs.forEach((m, i) => ck.push(Object.assign({ t: 'msg', s: m.x, mine: m.f === 'p', nick: m.f === 'p' ? '' : nm, time: clock(m.t), pad: [0, 4, 0, 0], fd: i + 1 }, m.f === 'p' && m.id > rd.c ? { un: true } : {})));
  ck.push({ t: 'inbar', key: 'khc', hint: '\uba54\uc2dc\uc9c0\ub97c \uc785\ub825\ud574\uc694', btn: '\ubcf4\ub0b4\uae30', act: call('kh.say', cid), pad: [0, 8, 0, 0], maxlen: 100 });
  const foot = [
    { t: 'lth', s: '\uac00\uc871 \uc2e4\uc2dc\uac04 \ub300\ud654', dot: '#2f7cf6', live: true, pad: [16, 8, 16, 0] },
    panel(ck, { pad: [10, 0, 10, 6], ip: [12, 8, 12, 4], fill: 'card', line: 'border', r: 16, act: call('kc.open') })      // \ubc15\uc2a4\ub97c \ub204\ub974\uba74 \uc804\uccb4 \ub300\ud654 \ud31d\uc5c5(\uc704\uc544\ub798\ub85c \ubc00\uc5b4 \ubd04)
  ];
  // \uc790\ub140\uac00 \uc5ec\ub7ff\uc774\uba74 \uc88c\uc6b0\ub85c \ubc00\uc5b4 \ub2e4\uc74c\u00b7\uc774\uc804 \uc790\ub140\ub85c(\ub05d\uc5d0\uc11c \ucc98\uc74c\uc73c\ub85c \ub3c8\ub2e4) \u2014 \uc5b4\ub290 \uc790\ub140\ub85c \uac08\uc9c0\ub294 \uc5d4\uc9c4\uc774 \uc815\ud574 sw \uc5d0 \ub2f4\uace0, \uc571\uc740 \uadf8 \ud589\ub3d9(kc.<cid>)\uc744 \uadf8\ub300\ub85c \ubcf4\ub0b8\ub2e4. \uc9c0\ub3c4\u00b7'OO \ubb50\ud558\ub2c8?'\u00b7\ud018\uc2a4\ud2b8\u00b7\ub300\ud654\uac00 \ubaa8\ub450 \uadf8 \uc790\ub140 \uac83\uc73c\ub85c \uc0c8\ub85c \uc628\ub2e4.
  const ki = Math.max(0, kids.findIndex((k) => k.cid === cid)), nk = kids.length;
  const sw = nk > 1 ? { k: cid, l: call('kc.' + kids[(ki + 1) % nk].cid), r: call('kc.' + kids[(ki - 1 + nk) % nk].cid) } : null;
  return scr('kids', head, body, Object.assign({ foot, fl: false }, sw ? { sw } : {}));
}

/** \uc9c0\ub09c \uacbd\ub85c \uc904 \uae00: '11/03 06:20 \u2192 06:48 \u00b7 3.2km' (\uac19\uc740 \ub0a0\uc774\uba74 \ub0a0\uc9dc \uc0dd\ub7b5) */
function rtTitle(r, now) { return evWhen(r.t0, now) + ' \u2192 ' + clock(r.t1) + ' \u00b7 ' + fmtDist(r.m); }
function rtSub(r) { const mi = Math.max(1, Math.round((r.t1 - r.t0) / 60000)); return (r.sn || '\ucd9c\ubc1c') + ' \u2192 ' + (r.en || '\ub3c4\ucc29') + ' \u00b7 ' + (mi >= 60 ? Math.floor(mi / 60) + '\uc2dc\uac04 ' + (mi % 60 ? mi % 60 + '\ubd84' : '') : mi + '\ubd84'); }
/** \uc9c0\ub09c \uacbd\ub85c \ubaa9\ub85d \ud31d\uc5c5(\ucd5c\uc2e0\uc774 \uc704) \u2014 \ub204\ub974\uba74 \uc9c0\ub3c4\uc5d0 \uadf8 \uacbd\ub85c\uac00 \uadf8\ub824\uc9c4\ub2e4 */
async function rtSheet(DB, pid, cid, now, notice) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid), nm = nmOf(cur);
  const rows = (await DB.prepare('SELECT id,t0,t1,m,sn,en FROM routes WHERE cid=? ORDER BY id DESC LIMIT ?').bind(cid, RT_KEEP).all()).results || [];
  const body = [tx(nm + ' \uc9c0\ub09c \uacbd\ub85c', { size: 15, bold: true, pad: [16, 14, 16, 4] }), tx('\ud55c \uacf3\uc5d0 30\ubd84 \ub118\uac8c \uba38\ubb3c\uba74 \uadf8 \uc804\uae4c\uc9c0\uc758 \uae38\uc774 \uc800\uc7a5\ub3fc\uc694 \u00b7 \ucd5c\ub300 ' + RT_KEEP + '\uac1c \u00b7 ' + RT_MIN_M + 'm \ubbf8\ub9cc\uc740 \uc800\uc7a5\ud558\uc9c0 \uc54a\uc544\uc694', { size: 11, color: 'sub', pad: [16, 0, 16, 8] })];
  if (notice) body.push(tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 0, 16, 6] }));
  if (!rows.length) body.push(tx('\uc544\uc9c1 \uc800\uc7a5\ub41c \uacbd\ub85c\uac00 \uc5c6\uc5b4\uc694', { size: 12.5, color: 'sub', pad: [16, 12, 16, 12] }));
  if (rows.length) body.push(panel(rows.map((r) => ({ t: 'navrow', title: rtTitle(r, now), sub: rtSub(r), act: call('kr.' + r.id), size: 13, vp: 8 })), { pad: [12, 0, 12, 0], ip: [14, 6, 14, 6] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('\ub2eb\uae30', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  return scr('kidrt', [], body, { dlg: dlg() });
}

/** \ud65c\ub3d9 \uae30\ub85d \uc804\uccb4(\uc704\uac00 \uc624\ub798\ub41c \uac83, \uc544\ub798\uac00 \ucd5c\uadfc) */
async function evSheet(DB, pid, cid, now) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid), nm = nmOf(cur);
  const rows = ((await DB.prepare('SELECT k,x,t FROM evs WHERE cid=? AND t>=? AND k NOT IN ' + EV_HIDE + ' ORDER BY id DESC LIMIT ?').bind(cid, now - EV_KEEP, MAX_EV).all()).results || []).reverse();
  const body = [tx(nm + ' \ud65c\ub3d9 \uae30\ub85d', { size: 15, bold: true, pad: [16, 14, 16, 4] }), tx('\ucd5c\uadfc 3\uc77c \u00b7 \uc544\ub798\ub85c \uac08\uc218\ub85d \ucd5c\uadfc\uc774\uc5d0\uc694', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (!rows.length) body.push(tx('\uc544\uc9c1 \ud65c\ub3d9\uc774 \uc5c6\uc5b4\uc694', { size: 12.5, color: 'sub', pad: [16, 12, 16, 12] }));
  rows.forEach((e) => body.push(tx(evWhen(e.t, now) + '  ' + evText(e, nm), { size: 12.5, pad: [16, 4, 16, 0] })));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('\ub2eb\uae30', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  return scr('kidev', [], body, { dlg: dlg() });
}

async function chatSheet(DB, pid, cid, now) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid);
  const rows = (await DB.prepare('SELECT id,f,x,t FROM chat WHERE cid=? AND t>=? ORDER BY id DESC LIMIT 40').bind(cid, now - CHAT_KEEP).all()).results || [];
  const rd = await rdMap(DB, cid);
  const body = [tx(nmOf(cur) + '\uc640\uc758 \uac00\uc871 \ub300\ud654', { size: 15, bold: true, pad: [16, 14, 16, 4] }), tx('\uae00\uc790\ub9cc \ubcf4\ub0bc \uc218 \uc788\uc5b4\uc694. \ub300\ud654\ub294 7\uc77c\uc774 \uc9c0\ub098\uba74 \uc9c0\uc6cc\uc838\uc694.', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (!rows.length) body.push(tx('\uc544\uc9c1 \ub300\ud654\uac00 \uc5c6\uc5b4\uc694. \uba3c\uc800 \ub9d0\uc744 \uac78\uc5b4 \ubcf4\uc138\uc694.', { size: 12.5, color: 'sub', pad: [16, 12, 16, 12] }));
  rows.slice().reverse().forEach((m) => body.push(Object.assign({ t: 'msg', s: m.x, mine: m.f === 'p', nick: m.f === 'p' ? '' : nmOf(cur), time: clock(m.t), pad: [12, 4, 12, 0] }, m.f === 'p' && m.id > rd.c ? { un: true } : {})));
  const foot = [{ t: 'inbar', key: 'kct', hint: '\uba54\uc2dc\uc9c0\ub97c \uc785\ub825\ud574\uc694', btn: '\ubcf4\ub0b4\uae30', act: call('kc.send', cid), pad: [12, 8, 12, 12], maxlen: 100 }];
  return scr('kidchat', [], body, { foot, anchor: 'bottom', dlg: dlg() });      // \uc544\ub798\uc5d0\uc11c \uc62c\ub77c\uc624\ub294 \ud31d\uc5c5: \ub300\ud654\ub294 \uc544\ub798\ub85c \uac08\uc218\ub85d \ucd5c\uadfc, \uc785\ub825\uc904\uc740 \ub9e8 \uc544\ub798\uc5d0 \ubd99\ub294\ub2e4
}

/** \ucee4\ubba4\ub2c8\ud2f0 \ub9e8 \uc55e '\uac00\uc871\ub300\ud654' \uce78(\uae38\ub3d9\ubb34 \ud655\uc778 \ud31d\uc5c5\uc774 \uc544\ub2c8\ub77c \ucee4\ubba4\ub2c8\ud2f0 \ud654\uba74 \ubcf8\ubb38): \ub9d0\ud48d\uc120\uc740 \uc704\uc5d0\uc11c \uc544\ub798\ub85c, \uc785\ub825\uc904\uc740 \uc544\ub798\uc5d0 \ubd99\ub294\ub2e4 */
async function famScreen(DB, pid, cid, now) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid);
  const rows = (await DB.prepare('SELECT id,f,x,t FROM chat WHERE cid=? AND t>=? ORDER BY id DESC LIMIT 60').bind(cid, now - CHAT_KEEP).all()).results || [];
  const rd = await rdMap(DB, cid);
  const body = [tx(nmOf(cur) + '\uc640\uc758 \uac00\uc871\ub300\ud654 \u00b7 \uae00\uc790\ub9cc, 7\uc77c \ub4a4 \uc9c0\uc6cc\uc838\uc694', { size: 11, color: 'sub', pad: [16, 10, 16, 4] })];
  if (!rows.length) body.push(tx('\uc544\uc9c1 \ub300\ud654\uac00 \uc5c6\uc5b4\uc694. ' + nmOf(cur) + '\uc5d0\uac8c \uba3c\uc800 \ub9d0\uc744 \uac78\uc5b4 \ubcf4\uc138\uc694.', { size: 12.5, color: 'sub', pad: [16, 28, 16, 12], align: 'center' }));
  rows.slice().reverse().forEach((m) => body.push(Object.assign({ t: 'msg', s: m.x, mine: m.f === 'p', nick: m.f === 'p' ? '' : nmOf(cur), time: clock(m.t), pad: [12, 4, 12, 0] }, m.f === 'p' && m.id > rd.c ? { un: true } : {})));
  const foot = [{ t: 'inbar', key: 'kct', hint: '\uba54\uc2dc\uc9c0\ub97c \uc785\ub825\ud574\uc694', btn: '\ubcf4\ub0b4\uae30', act: call('kf.send', cid), pad: [12, 8, 12, 10], maxlen: 100 }];
  return scr('kidfam', [], body, { foot, anchor: 'bottom' });
}

async function questSheet(DB, pid, cid, qt) {
  const cur = (await childrenOf(DB, pid)).find((k) => k.cid === cid);
  const rows = (await DB.prepare('SELECT id,k,x,s,pt FROM quests WHERE cid=? ORDER BY t DESC LIMIT ?').bind(cid, MAX_QUEST).all()).results || [];
  const star = await starsOf(DB, cid);
  const tab = qt === 'p' ? 'p' : 'c';
  const cRows = rows.filter((q) => q.k !== 'p'), pRows = rows.filter((q) => q.k === 'p');
  const nc = cRows.length, np = pRows.length;
  // \uc0c1\ud0dc(s): 0 \ub300\uae30 \u00b7 1 \uc2b9\ub099(\uc9c4\ud589 \uc911) \u00b7 2 \uc644\ub8cc \ubcf4\uace0(\ud655\uc778 \ub300\uae30) \u00b7 3 \uc885\ub8cc \u00b7 4 \uac70\uc808 \u2014 \uc790\uc138\ud55c \ud750\ub984\uc740 SEND_COST \uc704\uc758 \uc124\uba85
  const list = tab === 'c' ? cRows : pRows;
  const doneN = list.filter((q) => q.s === QS_DONE).length, ingN = list.filter((q) => q.s < QS_DONE).length;
  // \uc81c\ubaa9 \u00b7 \uc2a4\ud0c0\ud3ec\uc778\ud2b8 \u00b7 \uc54c\uc57d(\uc790\ub140 \ubbf8\uc158 / \ubd80\ubaa8\ub2d8 \ubbf8\uc158)\uc740 \uace0\uc815 \uba38\ub9ac \u2014 \uc88c\uc6b0\ub85c \ubc00\uc5b4\ub3c4 \uc548 \uc6c0\uc9c1\uc774\uace0 \uace0\ub978 \uc54c\uc57d \uc0c9\ub9cc \ubc14\ub010\ub2e4. \uadf8 \uc544\ub798(body)\ub9cc \ubc00\ub9b0\ub2e4.
  const head = [tx(nmOf(cur) + '\uc758 \ubbf8\uc158', { size: 15, bold: true, pad: [16, 14, 16, 2] }), tx('\uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + star, { size: 12, bold: true, color: 'gold', pad: [16, 0, 16, 6] }),
    { t: 'chips', pad: [12, 4, 12, 4], items: [{ label: '\uc790\ub140 \ubbf8\uc158 ' + nc, on: tab === 'c', act: call('kq.tab', cid, 'c') }, { label: '\ubd80\ubaa8\ub2d8 \ubbf8\uc158 ' + np, on: tab === 'p', act: call('kq.tab', cid, 'p') }] }];
  const body = [
    tx(tab === 'c' ? '\ubd80\ubaa8\ub2d8\uc774 \uc790\ub140\uc5d0\uac8c \uc900 \ubbf8\uc158\uc774\uc5d0\uc694. \uc790\ub140\uac00 \uc2b9\ub099\ud558\uace0 \ud574\ub0b8 \ub4a4 \uc644\ub8cc\ub97c \ub204\ub974\uba74, \ud655\uc778\uc744 \ub20c\ub7ec \uc2a4\ud0c0\ud3ec\uc778\ud2b8\ub97c \uc8fc\uc138\uc694.' : '\uc790\ub140\uac00 \ubd80\ubaa8\ub2d8\uaed8 \ubcf4\ub0b8 \ubbf8\uc158\uc774\uc5d0\uc694(\ud55c \ubc88\uc5d0 \uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + SEND_COST + '). \uc2b9\ub099\ud558\uba74 \uc790\ub140\uc758 \uc2a4\ud0c0\ud3ec\uc778\ud2b8\uac00 ' + SEND_COST + ' \ucc28\uac10\ub418\uace0, \ub05d\ub0b8 \ub4a4 \uc644\ub8cc\ub97c \ub204\ub974\uba74 \uc790\ub140\uac00 \ud655\uc778\ud574\uc694.', { size: 11, color: 'sub', pad: [16, 8, 16, 0] }),
    tx((tab === 'c' ? '\uc624\ub978\ucabd \ubd80\ubaa8\ub2d8 \ubbf8\uc158' : '\uc67c\ucabd \uc790\ub140 \ubbf8\uc158') + '\uc73c\ub85c \ud654\uba74\uc744 \ubc00\uc5b4\uc11c \ub118\uae38 \uc218 \uc788\uc5b4\uc694', { size: 10.5, color: 'sub', pad: [16, 2, 16, 4] }),
    tx('\uc9c4\ud589 \uc911 ' + ingN + ' \u00b7 \uc644\ub8cc ' + doneN, { size: 12.5, bold: true, color: ingN ? 'orange' : 'gold', pad: [16, 4, 16, 2] })];
  if (tab === 'c') {
    body.push(panel([tx('\uc790\ub140\uc5d0\uac8c \ubbf8\uc158 \ubcf4\ub0b4\uae30', { size: 12, bold: true, color: 'sub', pad: [0, 0, 0, 6] }), { t: 'field', key: 'kqx', hint: '\uc608) \ubc29 \uc815\ub9ac\ud558\uae30', maxlen: 60, h: 42 },
      tx('\ud574\ub0c8\uc744 \ub54c \ubc1b\ub294 \uc2a4\ud0c0\ud3ec\uc778\ud2b8', { size: 11.5, color: 'sub', pad: [0, 8, 0, 4] }),
      { t: 'row', gap: 6, kids: [1, 2, 3, 4, 5].map((n) => btn(String(n), call('kq.pt', cid, String(n)), Object.assign({ h: 38 }, n === 1 ? gold : { fill: 'card2', tc: 'text', line: 'border' }))) },
      tx('\uc2a4\ud0c0\ud3ec\uc778\ud2b8\ub97c \uace0\ub974\uace0 \uc544\ub798 \ud655\uc778\uc744 \ub20c\ub7ec\uc57c \ubcf4\ub0b4\uc838\uc694', { size: 10.5, color: 'sub', pad: [0, 6, 0, 8] }),
      btn('\ud655\uc778', call('kq.send', cid, '1'), Object.assign({ h: 42 }, gold))], { pad: [12, 8, 12, 0] }));
  }
  for (const q of list) {
    const k = [tx(q.x, { size: 13.5, bold: true })], p = q.pt || 1;
    const line = (txt, color, bold) => k.push(tx(txt, { size: 11.5, color, bold: !!bold, pad: [0, 4, 0, 4] }));
    if (tab === 'c') {
      if (q.s === QS_WAIT) line('\ub300\uae30 \uc911 \u00b7 \uc790\ub140\uac00 \uc2b9\ub099\ud558\uba74 \uc2dc\uc791\ub3fc\uc694 (\uc644\ub8cc\ud558\uba74 \uc2a4\ud0c0 +' + p + ')', 'sub');
      else if (q.s === QS_ON) line('\uc9c4\ud589 \uc911 \u00b7 \uc790\ub140\uac00 \uc644\ub8cc\ub97c \ub204\ub974\uba74 \ud655\uc778\ud560 \uc218 \uc788\uc5b4\uc694', 'sub');
      else if (q.s === QS_REP) { line('\uc790\ub140\uac00 \uc644\ub8cc\ud588\uc5b4\uc694 \u00b7 \ud655\uc778\ud574 \uc8fc\uc138\uc694', 'orange', true); k.push({ t: 'row', gap: 8, kids: [btn('\ud655\uc778 (\uc2a4\ud0c0 +' + p + ')', call('kq.ok', q.id, 'c'), gold), btn('\ub2e4\uc2dc \ud558\uae30', call('kq.redo', q.id, 'c'), { fill: 'card2', tc: 'text', line: 'border' })] }); }
      else if (q.s === QS_DONE) line('\uc644\ub8cc \u00b7 \uc2a4\ud0c0 +' + p + ' \uc9c0\uae09\ud588\uc5b4\uc694', 'gold');
      else line('\uc790\ub140\uac00 \uac70\uc808\ud588\uc5b4\uc694', 'sub');
    } else {
      if (q.s === QS_WAIT) { line('\uc790\ub140\uac00 \ubcf4\ub0c8\uc5b4\uc694 \u00b7 \uc2b9\ub099\ud558\uba74 \uc790\ub140 \uc2a4\ud0c0 -' + (q.pt || SEND_COST) + ' \ucc28\uac10\ub3fc\uc694', 'orange', true); k.push({ t: 'row', gap: 8, kids: [btn('\uc2b9\ub099', call('kq.accept', q.id, 'p'), gold), btn('\uac70\uc808', call('kq.reject', q.id, 'p'), { fill: 'card2', tc: 'text', line: 'border' })] }); }
      else if (q.s === QS_ON) { line('\uc2b9\ub099\ud588\uc5b4\uc694 (\uc2a4\ud0c0 -' + (q.pt || SEND_COST) + ') \u00b7 \ub05d\ub0c8\uc73c\uba74 \uc644\ub8cc\ub97c \ub20c\ub7ec\uc694', 'orange', true); k.push(btn('\uc644\ub8cc', call('kq.fin', q.id, 'p'), gold)); }
      else if (q.s === QS_REP) line('\uc644\ub8cc\ud588\uc5b4\uc694 \u00b7 \uc790\ub140\uc758 \ud655\uc778\uc744 \uae30\ub2e4\ub824\uc694', 'sub');
      else if (q.s === QS_DONE) line('\uc644\ub8cc \u00b7 \uc790\ub140\uac00 \ud655\uc778\ud588\uc5b4\uc694', 'gold');
      else line('\uac70\uc808\ud588\uc5b4\uc694', 'sub');
    }
    body.push(panel(k, { pad: [12, 8, 12, 0] }));
  }
  if (!list.length) body.push(tx(tab === 'c' ? '\uc544\uc9c1 \ubcf4\ub0b8 \ubbf8\uc158\uc774 \uc5c6\uc5b4\uc694' : '\uc790\ub140\uac00 \ubcf4\ub0b8 \ubbf8\uc158\uc774 \uc544\uc9c1 \uc5c6\uc5b4\uc694', { size: 12.5, color: 'sub', pad: [16, 14, 16, 8] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('\ub2eb\uae30', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  const sw = tab === 'c' ? { k: 'c', r: call('kq.tab', cid, 'p') } : { k: 'p', l: call('kq.tab', cid, 'c') };         // \uc88c\uc6b0\ub85c \ubc00\uc5b4 \uc790\ub140 \ubbf8\uc158 \u2194 \ubd80\ubaa8\ub2d8 \ubbf8\uc158
  return scr('kidquest', head, body, { dlg: dlg(), sw });
}

async function readDraft(DB, pid) { return DB.prepare('SELECT * FROM drafts WHERE pid=?').bind(pid).first(); }
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uc7a5\uc18c \ub4f1\ub85d(s392): \uc8fc\uc18c(\ub610\ub294 \uc7a5\uc18c \uc774\ub984)\ub97c \uc801\uc5b4 \ucc3e\uc73c\uba74 \uc9c0\ub3c4\uac00 \uadf8\ucabd\uc73c\ub85c \uc62e\uaca8\uac00\uace0, \uc774\ub984\uc744 \uc801\uc5b4 \ub4f1\ub85d\ud558\uba74 \ub3c4\ucc29 \u00b7 \ucd9c\ubc1c\uc744 \ubd80\ubaa8\uc5d0\uac8c \uc54c\ub9b0\ub2e4 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const GEO_BASE = 'https://gentle-lab-7e47subway-api.phg0643.workers.dev/kakao-local';
/** \uc8fc\uc18c \u00b7 \uc7a5\uc18c \uc774\ub984 \ucc3e\uae30(\uce74\uce74\uc624 \ub85c\uceec\uc744 \uae38\ub3d9\ubb34 \ud504\ub85d\uc2dc\ub85c) \u2014 \uc8fc\uc18c\ub85c \uba3c\uc800, \uc5c6\uc73c\uba74 \uc7a5\uc18c \uc774\ub984\uc73c\ub85c. \ub3cc\ub824\uc8fc\ub294 \uac12: [{n \uc774\ub984, a \uc8fc\uc18c, la, lo}] \ucd5c\ub300 5\uac1c */
async function geoFind(q, near, env) {
  let err = '';
  const T = () => (AbortSignal && AbortSignal.timeout ? { signal: AbortSignal.timeout(4500) } : undefined);
  const fail = (e) => { err = err || (e && e.name === 'TimeoutError' ? '\uc2dc\uac04 \ucd08\uacfc' : '\uc5f0\uacb0 \uc2e4\ud328'); };
  // \uce74\uce74\uc624 \uac80\uc0c9 \u2014 1) \uc11c\ube44\uc2a4 \ubc14\uc778\ub529 GEO(\uc6cc\ucee4\ub07c\ub9ac \uc9c1\uc811 \uc5f0\uacb0, \uac00\uc7a5 \ud655\uc2e4) 2) \uc911\uacc4 \uc6cc\ucee4 \uc8fc\uc18c 3) \ube44\ubc00\ud0a4 KAKAO_REST_KEY \ub85c \uc9c1\uc811
  const get = async (path, qs) => {
    const tries = [];
    const px = GEO_BASE + '?path=' + encodeURIComponent(path) + '&qs=' + encodeURIComponent(qs);
    if (env && env.GEO && typeof env.GEO.fetch === 'function') tries.push(() => env.GEO.fetch(px));
    tries.push(() => fetch(px, T()));
    if (env && env.KAKAO_REST_KEY) tries.push(() => fetch('https://dapi.kakao.com/v2/local/' + path + '?' + qs, Object.assign({ headers: { Authorization: 'KakaoAK ' + env.KAKAO_REST_KEY } }, T())));
    for (const f of tries) {
      try {
        const r = await f();
        if (!r.ok) { err = err || ('\uc751\ub2f5 ' + r.status); continue; }
        const j = await r.json();
        if (j && Array.isArray(j.documents)) { err = ''; return j.documents; }
      } catch (e) { fail(e); }
    }
    return [];
  };
  const ok = (d) => Number.isFinite(+d.x) && Number.isFinite(+d.y) && Math.abs(+d.y) <= 85 && Math.abs(+d.x) <= 180 && (+d.x || +d.y);
  // \uc8fc\uc18c \ucc3e\uae30\uc640 \uc7a5\uc18c \uc774\ub984 \ucc3e\uae30\ub97c \ub3d9\uc2dc\uc5d0 \ubb3b\ub294\ub2e4 \u2014 \uc8fc\uc18c \uacb0\uacfc\ub97c \uba3c\uc800, \uc5c6\uc73c\uba74 \uc7a5\uc18c \uc774\ub984 \uacb0\uacfc
  const [ad, kw] = await Promise.all([
    get('search/address.json', 'query=' + encodeURIComponent(q) + '&size=5'),
    get('search/keyword.json', 'query=' + encodeURIComponent(q) + '&size=5' + (near ? '&x=' + near[1].toFixed(5) + '&y=' + near[0].toFixed(5) : '')),
  ]);
  let out = ad.filter(ok).map((d) => ({ n: (d.road_address && d.road_address.building_name) || d.address_name || q, a: d.address_name || '', la: +d.y, lo: +d.x }));
  if (!out.length) out = kw.filter(ok).map((d) => ({ n: d.place_name || d.address_name || q, a: d.road_address_name || d.address_name || '', la: +d.y, lo: +d.x }));
  // \uce74\uce74\uc624\uac00 \ub9c9\ud614\uac70\ub098 \ubabb \ucc3e\uc73c\uba74 OpenStreetMap(Nominatim) \uc73c\ub85c \ud55c \ubc88 \ub354 \u2014 \uc8fc\uc18c\uc640 \ud559\uad50\u00b7\uac74\ubb3c \uc774\ub984 \ubaa8\ub450 \ubc1b\ub294\ub2e4
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
      } else err = err || ('\uc751\ub2f5 ' + r.status);
    } catch (e) { fail(e); }
  }
  out = out.slice(0, 5);
  if (!out.length && err) out.err = err;                      // \uac80\uc0c9 \uc11c\ubc84 \ubb38\uc81c\uc640 '\uc9c4\uc9dc \uc5c6\uc74c'\uc744 \uad6c\ubd84\ud574 \uc54c\ub9b0\ub2e4
  return out;
}
async function saveDraft(DB, pid, cid, la, lo, name, q, now) {
  await DB.prepare("INSERT INTO drafts(pid,cid,pl,la,lo,name,hh,mm,days,t,q) VALUES(?,?,'',?,?,?,16,0,0,?,?) ON CONFLICT(pid) DO UPDATE SET cid=excluded.cid,pl='',la=excluded.la,lo=excluded.lo,name=excluded.name,hh=16,mm=0,days=0,t=excluded.t,q=excluded.q").bind(pid, cid, la, lo, name, now, q).run();
}
function regSheet(d, results, notice) {
  const body = [tx('\uc7a5\uc18c \ub4f1\ub85d', { size: 15, bold: true, pad: [16, 14, 16, 2] }), tx('\uc8fc\uc18c\ub098 \uc7a5\uc18c \uc774\ub984\uc744 \ucc3e\uc73c\uba74 \uc9c0\ub3c4\uac00 \uadf8\ucabd\uc73c\ub85c \uc62e\uaca8\uac00\uc694. \uc774\ub984\uc744 \uc801\uc5b4 \ub4f1\ub85d\ud558\uba74 \uc790\ub140\uac00 \ub3c4\ucc29\ud558\uac70\ub098 \ubc97\uc5b4\ub0a0 \ub54c \uc54c\ub824 \ub4dc\ub824\uc694.', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (notice) body.push(tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 2, 16, 4] }));
  body.push(panel([{ t: 'field', key: 'kpa', hint: '\uc8fc\uc18c \ub610\ub294 \uac74\ubb3c\u00b7\ud559\uad50\u00b7\ud68c\uc0ac \uc774\ub984 (\uc608: \ub300\ub3d9\ucd08\ub4f1\ud559\uad50 \u00b7 \uac00\uc591\ub85c 12)', value: d.q || '', maxlen: 60, h: 44 },
    { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('\uc8fc\uc18c \ucc3e\uae30', call('kpg.find'), gold)] }], { pad: [12, 6, 12, 0] }));
  if (results && results.length > 1) body.push(panel(results.map((r, i) => ({ t: 'navrow', title: r.n, sub: r.a, act: call('kpg.pick', '', String(i)), size: 13, vp: 8 })), { pad: [12, 8, 12, 0], ip: [14, 6, 14, 6] }));
  body.push({ t: 'tmap', h: 190, r: 14, pad: [12, 8, 12, 0], pts: [{ la: d.la, lo: d.lo, k: 's', n: '', l: d.name || '\uc5ec\uae30' }], foc: 0, fz: 17 });          // \uace0\uc815 \uc9c0\ub3c4(live \uc544\ub2d8): \ud31d\uc5c5\uc5d0 MapLibre \ub97c \uc62c\ub9ac\uba74 \uc5f4 \ub54c\ub9c8\ub2e4 \ubc84\ubc85\uc778\ub2e4 \u00b7 \uc704\uce58\ub294 \ucc3e\uae30\ub85c \uc815\ud55c\ub2e4
  body.push(panel([{ t: 'field', key: 'kpn', hint: '\uc7a5\uc18c \uc774\ub984 (\uc608: \uc6b0\ub9ac\uc9d1 \u00b7 00\ud559\uad50)', value: d.name || '', maxlen: 20, h: 44 },
    tx('\uc704\uce58 ' + (+d.la).toFixed(4) + ', ' + (+d.lo).toFixed(4) + ' \u00b7 \uc2dc\uac01 \uc54c\ub9bc\uc740 \ub4f1\ub85d \ub4a4 \uc7a5\uc18c\ub97c \ub20c\ub7ec \uc815\ud560 \uc218 \uc788\uc5b4\uc694', { size: 10.5, color: 'sub', pad: [0, 8, 0, 0] })], { pad: [12, 8, 12, 0] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('\ucde8\uc18c', call('kpg.cancel'), { fill: 'card2', tc: 'text', line: 'border' }), btn('\ub4f1\ub85d', call('kpg.add'), gold)] });
  return scr('kidreg', [], body, { dlg: dlg() });
}
function placeSheet(d, edit, notice) {
  const body = [tx(edit ? '\uc7a5\uc18c \uace0\uce58\uae30' : '\uc7a5\uc18c \ub4f1\ub85d', { size: 15, bold: true, pad: [16, 14, 16, 2] }), tx('\uc694\uc77c\uc744 \uace0\ub974\uba74 \uadf8 \uc2dc\uac01\uc5d0 \uc790\ub140\uac00 \uc774 \uc7a5\uc18c\uc5d0 \uc788\uc5b4\uc57c \ud574\uc694(30\ubd84 \uc804\uc5d0 \uc790\ub140\uc5d0\uac8c \uc54c\ub824\uc694). \uc694\uc77c\uc744 \uc548 \uace0\ub974\uba74 \ub3c4\ucc29 \u00b7 \ucd9c\ubc1c \uc54c\ub9bc\ub9cc \uc640\uc694.', { size: 11, color: 'sub', pad: [16, 0, 16, 6] }),
    ...(notice ? [tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 4, 16, 2] })] : []),
    panel([{ t: 'field', key: 'kpn', hint: '\uc774\ub984 (\uc608: 00\ud559\uc6d0)', value: d.name || '', maxlen: 20, h: 44 },
      tx('\ub3c4\ucc29\ud574\uc57c \ud558\ub294 \uc2dc\uac01', { size: 11.5, color: 'sub', pad: [0, 10, 0, 2] }), tx(pad2(d.hh) + ':' + pad2(d.mm), { size: 30, bold: true, align: 'center', color: 'text', pad: [0, 2, 0, 8] }),
      { t: 'row', gap: 6, kids: [['\u22121\uc2dc\uac04', -60], ['\u221210\ubd84', -10], ['+10\ubd84', 10], ['+1\uc2dc\uac04', 60]].map((x) => btn(x[0], call('kpl.t', '', String(x[1])), { h: 36, size: 12, fill: 'card2', tc: 'text', line: 'border' })) },
      tx('\uc694\uc77c', { size: 11.5, color: 'sub', pad: [0, 12, 0, 4] }),
      { t: 'row', gap: 4, kids: WD.map((w, i) => btn(w, call('kpl.d', '', String(i)), Object.assign({ h: 38, size: 12 }, (d.days >> i) & 1 ? gold : { fill: 'card2', tc: 'text', line: 'border' }))) },
      tx('\uc704\uce58: \uc9c0\ub3c4\uc5d0\uc11c \uace0\ub978 \uacf3 (' + d.la.toFixed(4) + ', ' + d.lo.toFixed(4) + ')', { size: 10.5, color: 'sub', pad: [0, 10, 0, 0] })], { pad: [12, 6, 12, 0] }),
    { t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: (edit ? [btn('\uc0ad\uc81c', call('kpl.del'), { fill: 'card2', tc: 'orange', line: 'border' })] : []).concat([btn('\ucde8\uc18c', call('kpl.cancel'), { fill: 'card2', tc: 'text', line: 'border' }), btn('\uc800\uc7a5', call('kpl.save'), gold)]) }];
  return scr('kidplace', [], body, { dlg: dlg() });
}

async function cheerSheet(DB, pid, cid, notice) {
  const kids = await childrenOf(DB, pid);
  const cur = kids.find((k) => k.cid === cid) || kids[0];
  if (!cur) return scr('kidcheer', [], [tx('\uc5f0\uacb0\ub41c \uc790\ub140\uac00 \uc5c6\uc5b4\uc694', { size: 15, bold: true, pad: [16, 20, 16, 12] })], { dlg: dlg() });
  const rows = (await DB.prepare('SELECT id,x FROM cheers WHERE cid=? ORDER BY id LIMIT ?').bind(cur.cid, MAX_CHEER).all()).results || [];
  const body = [tx(nmOf(cur) + ' \uc751\uc6d0\ubb38\uad6c', { size: 15, bold: true, pad: [16, 14, 16, 2] }),
    tx('\ub9cc\ub4e4\uba74 \ud0a4\uc988 \uc571 \ub9e8 \uc704\uc5d0 \ud750\ub974\ub294 \uae00\uc774 \uc774 \ubb38\uad6c\ub85c \ubc14\ub00c\uc5b4\uc694. \ud558\ub098\ub3c4 \uc5c6\uc73c\uba74 \uae30\ubcf8 \ubb38\uad6c\uac00 \ub098\uc640\uc694. (' + rows.length + '/' + MAX_CHEER + ')', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (kids.length > 1) body.push({ t: 'chips', pad: [12, 4, 12, 0], items: kids.map((k) => ({ label: nmOf(k), on: k.cid === cur.cid, act: call('kh.cheer', k.cid) })) });
  if (notice) body.push(tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 6, 16, 2] }));
  if (rows.length) body.push(panel(rows.map((r) => ({ t: 'row', gap: 8, pad: [0, 4, 0, 4], kids: [tx(r.x, { size: 13, pad: [0, 8, 0, 0], flex: 1 }), btn('\uc0ad\uc81c', call('kh.cd', cur.cid, String(r.id)), { fill: 'card2', tc: 'orange', line: 'border', h: 32, size: 12 })] })), { pad: [12, 6, 12, 0] }));
  if (rows.length < MAX_CHEER) body.push(panel([{ t: 'field', key: 'kch', hint: '\uc751\uc6d0\ubb38\uad6c (\ucd5c\ub300 ' + CHEER_LEN + '\uc790)', maxlen: CHEER_LEN, h: 44 },
    { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('\ucd94\uac00', call('kh.ca', cur.cid), gold)] }], { pad: [12, 8, 12, 0] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('\ub2eb\uae30', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  return scr('kidcheer', [], body, { dlg: dlg() });
}

async function linkSheet(DB, pid, notice) {
  const kids = await childrenOf(DB, pid);
  const body = [tx('\uae38\ub3d9\ubb34 \ud0a4\uc988 \uc5f0\uacb0', { size: 15, bold: true, pad: [16, 14, 16, 2] }), tx('\uc790\ub140 \ud3f0\uc758 \uae38\ub3d9\ubb34 \ud0a4\uc988 \uc124\uc815\uc5d0\uc11c QR \uc774\ub098 \uc2dc\ud06c\ub9bf \ud0a4\ub97c \ub9cc\ub4e4\uc5b4 \uc8fc\uc138\uc694(10\ubd84 \ub3d9\uc548 \uc4f8 \uc218 \uc788\uc5b4\uc694).', { size: 11, color: 'sub', pad: [16, 0, 16, 6] })];
  if (notice) body.push(tx(notice, { size: 12, bold: true, color: 'orange', pad: [16, 2, 16, 4] }));
  for (const k of kids) {
    body.push(panel([tx(nmOf(k) + ' \u00b7 \uc5f0\uacb0\ub428', { size: 13.5, bold: true }), tx('\uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + k.stars, { size: 11.5, color: 'sub', pad: [0, 2, 0, 8] }),
      { t: 'field', key: 'kn_' + k.cid.slice(0, 12), hint: '\uc790\ub140 \uc774\ub984 (\uc608: \ubbfc\uc9c0)', value: k.nm || '', maxlen: 8, h: 40 },
      { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('\uc774\ub984 \uc800\uc7a5', call('kl.name', k.cid), gold), btn('\uc5f0\uacb0 \ub04a\uae30', call('kl.unlink', k.cid), { fill: 'card2', tc: 'orange', line: 'border' })] }], { pad: [12, 8, 12, 0] }));
  }
  const pnm = await pnOf(DB, pid);
  body.push(panel([tx('\ub0b4 \uc774\ub984 (\uc790\ub140\uc5d0\uac8c \ubcf4\uc5ec\uc694)', { size: 12, bold: true, color: 'sub', pad: [0, 0, 0, 6] }), { t: 'field', key: 'kpn', hint: '\uc608: \uc5c4\ub9c8 \u00b7 \uc544\ube60', value: pnm, maxlen: 8, h: 42 },
    { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('\uc774\ub984 \uc800\uc7a5', call('kl.pname'), gold)] }], { pad: [12, 8, 12, 0] }));
  body.push(panel([tx('\uc0c8 \uc790\ub140 \uc5f0\uacb0', { size: 12, bold: true, color: 'sub', pad: [0, 0, 0, 6] }), { t: 'field', key: 'klc', hint: '\uc2dc\ud06c\ub9bf \ud0a4 \uc785\ub825 (XXXXX-XXXXX)', maxlen: 12, h: 42, watch: true },
    { t: 'field', key: 'kln', hint: '\uc790\ub140 \uc774\ub984 (\uc120\ud0dd)', maxlen: 8, h: 42 },
    { t: 'row', gap: 8, pad: [0, 8, 0, 0], kids: [btn('QR \ucc0d\uae30', call('kl.scan'), { fill: 'card2', tc: 'text', line: 'border' }), btn('\ud0a4\ub85c \uc5f0\uacb0', call('kl.join'), gold)] }], { pad: [12, 8, 12, 0] }));
  body.push({ t: 'row', gap: 8, pad: [12, 12, 12, 14], kids: [btn('\ub2eb\uae30', call('kl.close'), { fill: 'card2', tc: 'text', line: 'border' })] });
  return scr('kidlink', [], body, { dlg: dlg() });
}

/** \uc124\uc815 \ud0ed \ub9e8 \uc704\uc5d0 \ub07c\uc6b8 \ud55c \uc904(\uc5f0\uacb0\ub418\uc5c8\uc744 \ub54c\ub9cc). \uc5f0\uacb0\uc774 \uc5c6\uc73c\uba74 null \u2014 \uae38\ub3d9\ubb34\ub294 \uc544\ubb34\uac83\ub3c4 \ubcf4\uc774\uc9c0 \uc54a\ub294\ub2e4. */
async function settingsRow(DB, pid) {          // \uc124\uc815 \ub9e8 \uc704\uc5d0 \ub07c\uc6b8 \ub178\ub4dc\ub4e4(\uc5f0\uacb0\ub41c \ubd80\ubaa8\uc5d0\uac8c\ub9cc). \uc544\ubb34\ub3c4 \uc5f0\uacb0 \uc548 \ud588\uc73c\uba74 null
  const kids = await childrenOf(DB, pid);
  if (!kids.length) return null;
  const names = kids.map(nmOf).join(', ');
  const kh = (await DB.prepare('SELECT kh FROM devices WHERE id=?').bind(pid).first())?.kh ? true : false;
  const nc = (await DB.prepare('SELECT COUNT(*) n FROM cheers WHERE cid=?').bind(kids[0].cid).first())?.n || 0;
  return [
    { t: 'panel', pad: [16, 12, 16, 0], ip: [16, 6, 16, 6], fill: 'card', line: 'border', r: 14, kids: [
      { t: 'navrow', title: '\uae38\ub3d9\ubb34 \ud0a4\uc988', sub: '\uae38\ub3d9\ubb34 \ud0a4\uc988\uc640 \uc5f0\ub3d9\ub418\uc5c8\uc2b5\ub2c8\ub2e4 \u00b7 ' + names, act: call('kl.open'), size: 14, top: true }] },
    tx('\ud0a4\uc988 \uad00\ub828 \uc124\uc815', { size: 12, bold: true, color: 'sub', pad: [20, 16, 16, 6] }),
    { t: 'panel', pad: [16, 0, 16, 0], ip: [16, 6, 16, 6], fill: 'card', line: 'border', r: 14, kids: [
      { t: 'toggle', key: 'kidsHome', title: '\ud0a4\uc988 \ud654\uba74\uc73c\ub85c \uc2dc\uc791', sub: '\ucf1c\uba74 \uc571\uc744 \uc5f4 \ub54c \ud0a4\uc988 \uac10\uc2dc \ud654\uba74\uc774 \uba3c\uc800 \ub098\uc640\uc694. \ub044\uba74 \uae38\ub3d9\ubb34 \ud648\uc73c\ub85c \uc2dc\uc791\ud574\uc694.', on: kh, top: false, vp: 9, size: 14, ssize: 11, onc: 'gold' },
      { t: 'navrow', title: '\uc790\ub140 \uc751\uc6d0\ubb38\uad6c \ub9cc\ub4e4\uae30', sub: kids.length > 1 ? '\uc790\ub140\ub9c8\ub2e4 \ucd5c\ub300 ' + MAX_CHEER + '\uac1c' : nc + '/' + MAX_CHEER + '\uac1c', act: call('kh.cheer'), size: 14, top: true }] },
  ];
}
async function startPref(DB, pid) {          // \uc571\uc774 \ucf1c\uc9c8 \ub54c \uba3c\uc800 \ubcfc \ud654\uba74(\uc5f0\uacb0\uc774 \uc788\uace0 \uc124\uc815\uc774 \ucf1c\uc84c\uc744 \ub54c\ub9cc 1)
  const kids = await childrenOf(DB, pid);
  if (!kids.length) return 0;
  return (await DB.prepare('SELECT kh FROM devices WHERE id=?').bind(pid).first())?.kh ? 1 : 0;
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uae38 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function newDraft(DB, pid, cid, la, lo, now) {
  await DB.prepare('INSERT INTO drafts(pid,cid,pl,la,lo,name,hh,mm,days,t) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(pid) DO UPDATE SET cid=excluded.cid,pl=excluded.pl,la=excluded.la,lo=excluded.lo,name=excluded.name,hh=excluded.hh,mm=excluded.mm,days=excluded.days,t=excluded.t')
    .bind(pid, cid, '', la, lo, '', 16, 0, 31, now).run();
}

/** \uae30\uae30 \ud478\uc2dc \ud1a0\ud070\uc744 \uc800\uc7a5\ud55c\ub2e4(\uac19\uc740 \ud1a0\ud070\uc774 \ub2e4\ub978 \uae30\uae30\uc5d0 \ub0a8\uc544 \uc788\uc73c\uba74 \uc9c0\uc6b4\ub2e4 \u2014 \uc571\uc744 \uc9c0\uc6e0\ub2e4 \uae54\uc558\uc744 \ub54c \uc54c\ub9bc\uc774 \uc5c9\ud0a4\uc9c0 \uc54a\uac8c) */
async function saveFt(DB, id, tk, now) {
  if (typeof tk !== 'string' || tk.length < 20 || tk.length > 400 || /[^\w:.\-]/.test(tk)) return { ok: false, err: '\ud1a0\ud070 \ubaa8\uc591\uc774 \ub9de\uc9c0 \uc54a\uc544\uc694' };
  await DB.batch([DB.prepare("UPDATE devices SET ft='' WHERE ft=? AND id<>?").bind(tk, id), DB.prepare('UPDATE devices SET ft=?,fa=? WHERE id=?').bind(tk, now, id)]);
  return { ok: true };
}
async function handle(req, env, url) {
  const DB = env.DB, now = Date.now(), p = url.pathname, m = req.method;
  await init(DB);
  if (p === '/' || p === '/health') return J({ ok: true, name: 'gildongmu-kids', t: now });
  if (p === '/q' && m === 'GET') {              // \uc790\ub140 \ud3f0 QR \uc744 \uae30\ubcf8 \uce74\uba54\ub77c\ub85c \ucc0d\uc73c\uba74 \uc5f4\ub9ac\ub294 \uc548\ub0b4 \ucabd: '\uae38\ub3d9\ubb34\ub85c \uc5f4\uae30' \ud55c \ubc88\uc774\uba74 \ubd80\ubaa8 \uc571\uc774 \ubc14\ub85c \uc5f0\uacb0\ud55c\ub2e4
    const k = String(url.searchParams.get('k') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 11);
    const deep = 'gildongmu-kids://pair?k=' + k;
    const intent = 'intent://pair?k=' + k + '#Intent;scheme=gildongmu-kids;package=com.dullyyj.subway;end';
    const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\uae38\ub3d9\ubb34 \ud0a4\uc988 \uc5f0\uacb0</title>'
      + '<style>body{font-family:sans-serif;background:#f3f6fb;margin:0;padding:28px 20px;color:#16202e;text-align:center}.c{max-width:420px;margin:40px auto;background:#fff;border-radius:18px;padding:28px 20px;box-shadow:0 2px 14px #0001}'
      + 'h1{font-size:19px;margin:0 0 8px}p{font-size:14px;color:#5b6778;margin:6px 0}.k{font-size:26px;font-weight:700;letter-spacing:2px;margin:18px 0;color:#1d8fe6}a.b{display:block;background:#1d8fe6;color:#fff;text-decoration:none;font-weight:700;border-radius:12px;padding:15px;margin-top:18px;font-size:16px}</style></head><body><div class="c">'
      + '<h1>\uae38\ub3d9\ubb34 \ud0a4\uc988 \uc5f0\uacb0</h1><p>\ubd80\ubaa8\ub2d8 \ud3f0\uc758 \uae38\ub3d9\ubb34 \uc571\uc5d0\uc11c \uc5f4\uc5b4 \uc8fc\uc138\uc694</p><div class="k">' + (k || '----- -----') + '</div>'
      + '<a class="b" href="' + intent + '">\uae38\ub3d9\ubb34\ub85c \uc5f4\uae30</a><p style="margin-top:16px">\uc571\uc774 \uc5f4\ub9ac\uc9c0 \uc54a\uc73c\uba74 \uae38\ub3d9\ubb34 \uc124\uc815 \u2192 \uae38\ub3d9\ubb34 \ud0a4\uc988 \uc5f0\uacb0\uc5d0\uc11c \uc704 \uc2dc\ud06c\ub9bf \ud0a4\ub97c \uc9c1\uc811 \ub123\uc5b4 \uc8fc\uc138\uc694</p></div></body></html>';
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const body = m === 'POST' ? await req.json().catch(() => ({})) : {};

  if (p === '/reg' && m === 'POST') {          // \uae30\uae30 \ub4f1\ub85d(\ucc98\uc74c \ud55c \ubc88). \uac19\uc740 \uc544\uc774\ub514\ub294 \uac19\uc740 \ube44\ubc00\ub9cc \ub2e4\uc2dc \uc4f8 \uc218 \uc788\ub2e4
    const id = body.id, sec = body.sec, role = body.role;
    if (!okId(id) || !okSec(sec) || (role !== 'c' && role !== 'p')) return bad('\ud615\uc2dd\uc774 \ub9de\uc9c0 \uc54a\uc544\uc694');
    const sh = await sha(sec);
    const ex = await DB.prepare('SELECT sh,role FROM devices WHERE id=?').bind(id).first();
    if (ex) return ex.sh === sh && ex.role === role ? J({ ok: true }) : bad('\uc774\ubbf8 \uc4f0\ub294 \uc544\uc774\ub514\uc608\uc694', 403);
    await DB.prepare('INSERT INTO devices(id,role,sh,t) VALUES(?,?,?,?)').bind(id, role, sh, now).run();
    return J({ ok: true });
  }

  if (p.startsWith('/c/')) {
    const cid = await auth(req, DB, 'c');
    if (!cid) return bad('\uc778\uc99d\uc774 \ud544\uc694\ud574\uc694', 401);
    if (p === '/c/ft' && m === 'POST') return J(await saveFt(DB, cid, body.tk, now));
    if (p === '/c/pair' && m === 'POST') {        // \uc5f0\uacb0 \ube44\ubc00\ud0a4(10\ubd84)
      let code = '';
      const r = crypto.getRandomValues(new Uint8Array(10));
      for (let i = 0; i < 10; i++) { if (i === 5) code += '-'; code += KEYS[r[i] % KEYS.length]; }
      await DB.batch([DB.prepare('DELETE FROM codes WHERE cid=?').bind(cid), DB.prepare('INSERT INTO codes(code,cid,exp) VALUES(?,?,?)').bind(code, cid, now + PAIR_TTL)]);
      return J({ ok: true, code, exp: now + PAIR_TTL });
    }
    if (p === '/c/consent' && m === 'POST') {       // \uc790\ub140 \uc571\uc5d0\uc11c \ubcf4\ud638\uc790 \u00b7 \ubcf8\uc778 \ub3d9\uc758\ub97c \ub9c8\ucce4\ub2e4(\uc99d\ube59\uc73c\ub85c \ubc84\uc804\uacfc \uc2dc\uac01\ub9cc \ub0a8\uae34\ub2e4)
      const cv = Math.round(+body.v) || 0;
      if (cv < 1 || cv > 99) return bad('\uc798\ubabb\ub41c \uc694\uccad\uc774\uc5d0\uc694');
      await DB.prepare('INSERT INTO cons(cid,v,t) VALUES(?,?,?) ON CONFLICT(cid) DO UPDATE SET v=excluded.v,t=excluded.t').bind(cid, cv, now).run();
      return J({ ok: true });
    }
    if (p === '/c/loc' && m === 'POST') {         // \uc704\uce58\ub294 \uc5f0\uacb0\ub41c \ubd80\ubaa8\uac00 \uc788\uc744 \ub54c\ub9cc, \uac00\uc7a5 \ucd5c\uadfc \ud55c \uac74\ub9cc \uc800\uc7a5(\ubc14\ub85c \uc55e \uc704\uce58\ub3c4 \ud558\ub098 \ub454\ub2e4: \uac00\ub294 \uc911\uc778\uc9c0 \ubcf4\ub824\uace0)
      const la = +body.la, lo = +body.lo, acc = +body.acc || 0;
      if (!(la >= -90 && la <= 90 && lo >= -180 && lo <= 180) || (la === 0 && lo === 0)) return bad('\uc704\uce58\uac00 \ub9de\uc9c0 \uc54a\uc544\uc694');
      const n = await linkedCount(DB, cid);
      const last = n > 0 ? await DB.prepare('SELECT la,lo,t,dn,hp,mva,mvo,mvt,bt,mt,ha,hb,hat FROM loc WHERE cid=?').bind(cid).first() : null;
      let mtNow = last ? last.mt : 0;
      const wch = n > 0 ? await watchOf(DB, cid, now) : null;                   // \uc2e4\uc2dc\uac04 \ubcf4\uae30(s393): \ubcf4\ub294 \uc911\uc774\uba74 \ubcf4\uace0\ub97c \ucd18\ucd18\ud788 \ubc1b\uace0 \uc751\ub2f5\uc5d0 \uc8fc\uae30 \uc885\ub958\ub97c \uc2e4\uc5b4 \uc900\ub2e4
      const bt = Number.isFinite(+body.bt) && +body.bt >= 0 && +body.bt <= 100 ? Math.round(+body.bt) : -1, ch = body.ch ? 1 : 0;
      if (last && now - last.t < (wch ? 1200 : 12000) && hav(last.la, last.lo, la, lo) < (wch ? 2 : 8)) return J({ ok: true, linked: n, same: 1, w: watchCode(wch, last.mt, now) });     // \uac70\uc758 \uac19\uc740 \uc790\ub9ac \u00b7 \ubc29\uae08 \ubcf4\ub0c8\ub2e4 \u2014 \uc4f0\uc9c0\ub3c4 \uc54c\ub9ac\uc9c0\ub3c4 \uc54a\ub294\ub2e4
      if (n > 0) {
        await DB.prepare('INSERT INTO loc(cid,la,lo,acc,t,bt,ch) VALUES(?,?,?,?,?,?,?) ON CONFLICT(cid) DO UPDATE SET bt=excluded.bt,ch=excluded.ch,pla=CASE WHEN excluded.t-loc.t>=20000 THEN loc.la ELSE loc.pla END, plo=CASE WHEN excluded.t-loc.t>=20000 THEN loc.lo ELSE loc.plo END, plt=CASE WHEN excluded.t-loc.t>=20000 THEN loc.t ELSE loc.plt END, la=excluded.la,lo=excluded.lo,acc=excluded.acc,t=excluded.t').bind(cid, la, lo, acc, now, bt, ch).run();
        if (acc <= 60) {                                                       // \uc6c0\uc9c1\uc784 \u00b7 \uac00\ub294 \ubc29\ud5a5: \uae30\uc900\uc810\uc5d0\uc11c max(8m, \uc624\ucc28) \ub118\uac8c \ubc97\uc5b4\ub098\uba74 \uc6c0\uc9c1\uc774\ub294 \uc911 + \ubc29\ud5a5 \uacc4\uc0b0(\uac77\ub294 \uc18d\ub3c4\ub85c 2.5\ucd08\ub9c8\ub2e4 \ubcf4\uace0\ud574\ub3c4 \uc7a1\ud78c\ub2e4). 25\ucd08 \ub118\uac8c \uc81c\uc790\ub9ac\uba74 \uae30\uc900\uc810\uc744 \uc0c8\ub85c \uc7a1\ub294\ub2e4
          if (!last || !last.hat) await DB.prepare('UPDATE loc SET ha=?,hb=?,hat=? WHERE cid=?').bind(la, lo, now, cid).run();
          else if (hav(last.ha, last.hb, la, lo) >= Math.max(8, acc)) { mtNow = now; await DB.prepare('UPDATE loc SET hd=?,hdt=?,mt=?,ha=?,hb=?,hat=? WHERE cid=?').bind(bearing(last.ha, last.hb, la, lo), now, now, la, lo, now, cid).run(); }
          else if (now - last.hat > 25000) await DB.prepare('UPDATE loc SET ha=?,hb=?,hat=? WHERE cid=?').bind(la, lo, now, cid).run();
        }
        if (bt >= 0 && bt <= BATT_LOW && !ch && (!last || last.bt < 0 || last.bt > BATT_LOW || now - last.t > 30 * 60000)) later(battAlert(env, DB, cid, bt, now));
        await tripsSync(DB, cid, now);
        const tr = (await todayTrips(DB, cid, now)).filter((r) => !r.ta && hav(la, lo, r.la, r.lo) <= HERE_M);   // \uc7a5\uc18c 150m \uc548\uc5d0 \ub4e4\uc5b4\uc130\ub2e4 \u2014 \ub3c4\ucc29 \uc2dc\uac01 \uae30\ub85d
        if (tr.length) await DB.batch(tr.map((r) => DB.prepare('UPDATE trips SET ta=? WHERE id=? AND ta=0').bind(now, r.id)));
        // '\ubb50\ud558\ub2c8?' \uae30\ub85d: \ub4f1\ub85d \uc7a5\uc18c 150m \uc548\uc5d0 \ub4e4\uc5b4\uc624\uac70\ub098(\uadfc\ucc98) \ubc97\uc5b4\ub098\uba74(210m \ubc16 \u2014 \ud754\ub4e4\ub9bc\uc73c\ub85c \ub4e4\ub77d\uac70\ub9ac\uc9c0 \uc54a\uac8c), \ub3d9\ub124 \uc774\ub984\uc774 \ubc14\ub00c\uba74 \ud55c \uc904
        const dn = String(body.dn || '').replace(/\s+/g, ' ').trim().slice(0, 20), ohp = last ? last.hp || '' : '', odn = last ? last.dn || '' : '';
        const pls2 = (await DB.prepare('SELECT id,name,la,lo FROM places WHERE cid=?').bind(cid).all()).results || [];
        let hp = '', hn = '', bd = HERE_M + 1;
        for (const q of pls2) { const dd = hav(la, lo, q.la, q.lo); if (dd <= HERE_M && dd < bd) { bd = dd; hp = q.id; hn = q.name; } }
        const oq = ohp ? pls2.find((q) => q.id === ohp) : null;
        if (oq && hav(la, lo, oq.la, oq.lo) <= HERE_M + 60) { hp = oq.id; hn = oq.name; }
        if (hp !== ohp || (dn && dn !== odn)) await DB.prepare('UPDATE loc SET dn=?,hp=? WHERE cid=?').bind(dn || odn, hp, cid).run();
        // \uc774\ub3d9 \uc774\ub825: \ud55c \uc810 \uc313\uae30(\uc624\ucc28\uac00 \ud070 \uc704\uce58\ub294 \uac74\ub108\ub700) + \ub9ce\uc774 \uc6c0\uc9c1\uc600\uc73c\uba74 '\uc774\ub3d9 \uc911' \ud65c\ub3d9 \uc904
        if (acc <= 150) {
          const cr = await DB.prepare('SELECT la,lo FROM locs WHERE cid=? ORDER BY id DESC LIMIT 1').bind(cid).first();
          if (!cr || hav(cr.la, cr.lo, la, lo) >= Math.max(CRUMB_M, acc)) await DB.prepare('INSERT INTO locs(cid,la,lo,t) VALUES(?,?,?,?)').bind(cid, la, lo, now).run();
        }
        let rtSaved = false;
        if (acc <= 150) { try { rtSaved = await routeStep(env, DB, cid, la, lo, now, last ? last.t : 0, hn || dn || odn); } catch (e) { /* \uacbd\ub85c \ubcf4\uad00\uc774 \uc704\uce58 \uc800\uc7a5\uc744 \ub9c9\uc9c0 \uc54a\ub294\ub2e4 */ } }
        let evd = false;
        if (hp !== ohp) {
          if (hp) { await ev(DB, cid, 'at', hn, now); evd = true; later(zoneAlert(env, DB, cid, 'at', hp, hn, now)); }
          else if (oq) { await ev(DB, cid, 'lv', oq.name, now); evd = true; later(zoneAlert(env, DB, cid, 'lv', oq.id, oq.name, now)); }
        }
        else if (last && dn && dn !== odn) { await ev(DB, cid, 'loc', dn, now); evd = true; }
        if (acc <= 150) {
          if (!last || !last.mvt) await DB.prepare('UPDATE loc SET mva=?,mvo=?,mvt=? WHERE cid=?').bind(la, lo, now, cid).run();
          else {
            const dm = hav(last.mva, last.mvo, la, lo);
            if (dm >= MV_EV_M && now - last.mvt >= MV_EV_GAP) {
              if (!evd) { await ev(DB, cid, 'mv', ((dn || odn) ? (dn || odn) + ' \u00b7 ' : '') + fmtDist(dm), now); evd = true; }
              await DB.prepare('UPDATE loc SET mva=?,mvo=?,mvt=? WHERE cid=?').bind(la, lo, now, cid).run();
            }
          }
        }
        if (rtSaved) { await bump(DB, cid); evd = true; }                 // \uc9c0\ub09c \uacbd\ub85c\uac00 \ud558\ub098 \ub298\uc5c8\ub2e4 \u2014 \ubd80\ubaa8 \ud654\uba74\uc758 '\uc9c0\ub09c \uacbd\ub85c' \uc904\uc774 \ubc14\ub85c \ubc14\ub010\ub2e4
        if (!evd) {                                  // \uc81c\uc790\ub9ac(15m \uc548)\uc5d0\uc11c \ubcf4\ub0b8 \uc704\uce58\ub294 1\ubd84\uc5d0 \ud55c \ubc88\ub9cc \ubd80\ubaa8 \ud654\uba74\uc744 \uae68\uc6b4\ub2e4 \u2014 \uac00\ub9cc\ud788 \uc788\uc744 \ub54c \ud654\uba74\uc774 \uacc4\uc18d \ub2e4\uc2dc \uadf8\ub824\uc9c0\uc9c0 \uc54a\uac8c
          const lb = locBumpAt.get(cid) || 0;
          if ((last ? hav(last.la, last.lo, la, lo) : 1e9) >= 15 || now - lb >= 60000 || (wch && now - lb >= 1500)) { locBumpAt.set(cid, now); await bump(DB, cid); }      // \ubcf4\ub294 \uc911\uc774\uba74 1.5\ucd08\ub9c8\ub2e4(\ubd80\ubaa8 \ud654\uba74\uc758 \uc810\uc774 \uacc4\uc18d \uc6c0\uc9c1\uc774\uac8c)
        }
      }
      return J({ ok: true, linked: n, w: watchCode(wch, mtNow, now) });
    }
    if (p === '/c/ev' && m === 'POST') {          // \uc790\ub140 \uc571\uc774 \uc54c\ub9ac\ub294 \ud65c\ub3d9(\ubc25 \u00b7 \ub180\uae30 \u00b7 \uacf5\ubd80 \u00b7 \uc7a0 \u00b7 \uc751\uac00) \u2014 \uc5f0\uacb0\ub41c \ubd80\ubaa8\uac00 \uc788\uc744 \ub54c\ub9cc, \uac19\uc740 \uc77c\uc740 60\ucd08\uc5d0 \ud55c \ubc88\ub9cc
      const k = String(body.k || ''), x = String(body.x || '').replace(/\s+/g, ' ').trim().slice(0, 12);
      if (['play', 'study', 'sleep', 'poop'].includes(k)) return J({ ok: true, linked: await linkedCount(DB, cid) });      // \uc61b \uc571: \uce5c\uad6c\ub4e4 \ud589\ub3d9\uc740 \ub354 \uc774\uc0c1 \uae30\ub85d\ud558\uc9c0 \uc54a\ub294\ub2e4
      if (!EVK.has(k) || !x) return bad('\ud615\uc2dd\uc774 \ub9de\uc9c0 \uc54a\uc544\uc694');
      const n = await linkedCount(DB, cid);
      if (n > 0 && !(await DB.prepare('SELECT 1 a FROM evs WHERE cid=? AND k=? AND x=? AND t>? LIMIT 1').bind(cid, k, x, now - 60000).first())) await ev(DB, cid, k, x, now);
      return J({ ok: true, linked: n });
    }
    if (p === '/c/call' && m === 'POST') {        // \uc790\ub140\uac00 \uae34\uae09 \ud638\ucd9c \u00b7 \uc548\uc804\ud558\uac8c \ub3c4\ucc29 \u00b7 \ub370\ub9ac\ub7ec \uc640\uc918 \ub97c \ub204\ub978\ub2e4(op:'cancel' \uc740 \uae34\uae09 \ud638\ucd9c \u00b7 \ub370\ub9ac\ub7ec \uc640\uc918 \ucde8\uc18c)
      const r = await callRequest(env, DB, cid, body, now);
      return r.err ? bad(r.err) : J(r);
    }
    if (p === '/c/share' && m === 'POST') {       // \uc790\ub140\uac00 \uc704\uce58 \uacf5\uc720\ub97c \ucf1c\uace0 \ub048\ub2e4\uace0 \uc54c\ub9b0\ub2e4 \u2014 \ub044\uba74 \ubd80\ubaa8\uc5d0\uac8c \uc54c\ub9ac\uace0, \ub048 \ub3d9\uc548\uc740 '\uc704\uce58 \ub04a\uae40' \uc54c\ub9bc\uc744 \ubcf4\ub0b4\uc9c0 \uc54a\ub294\ub2e4
      const on = body.on ? 1 : 0;
      await DB.prepare('INSERT OR IGNORE INTO cst(cid) VALUES(?)').bind(cid).run();
      const prev = ((await DB.prepare('SELECT sh FROM cst WHERE cid=?').bind(cid).first()) || { sh: 1 }).sh;
      await DB.prepare('UPDATE cst SET sh=?,stl=0 WHERE cid=?').bind(on, cid).run();
      if (prev !== on && (await linkedCount(DB, cid)) > 0) {
        await bump(DB, cid);
        later(notifyParents(env, DB, cid, (nm) => ({ k: 'share', title: '\uae38\ub3d9\ubb34', body: who(nm) + (on ? ' \uc704\uce58 \uacf5\uc720\ub97c \ub2e4\uc2dc \ucf30\uc5b4\uc694' : ' \uc704\uce58 \uacf5\uc720\ub97c \uaed0\uc5b4\uc694'), tag: 'share' })));
      }
      return J({ ok: true });
    }
    if (p === '/c/unlink' && m === 'POST') {      // \uc790\ub140\uac00 \ubaa8\ub4e0 \uc5f0\uacb0\uc744 \ub04a\ub294\ub2e4(\uc704\uce58\ub3c4 \ud568\uaed8 \uc9c0\uc6b4\ub2e4)
      await DB.batch([DB.prepare('DELETE FROM links WHERE cid=?').bind(cid), DB.prepare('DELETE FROM loc WHERE cid=?').bind(cid), DB.prepare('DELETE FROM locs WHERE cid=?').bind(cid), DB.prepare('DELETE FROM routes WHERE cid=?').bind(cid), DB.prepare('DELETE FROM rtst WHERE cid=?').bind(cid), DB.prepare('DELETE FROM cst WHERE cid=?').bind(cid), DB.prepare('DELETE FROM stops WHERE cid=?').bind(cid), DB.prepare('DELETE FROM zt WHERE k LIKE ?').bind(cid + ':%'), DB.prepare('DELETE FROM drafts WHERE cid=?').bind(cid), DB.prepare('DELETE FROM codes WHERE cid=?').bind(cid), DB.prepare('DELETE FROM places WHERE cid=?').bind(cid), DB.prepare('DELETE FROM trips WHERE cid=?').bind(cid), DB.prepare('DELETE FROM cheers WHERE cid=?').bind(cid), DB.prepare('DELETE FROM evs WHERE cid=?').bind(cid), DB.prepare('DELETE FROM calls WHERE cid=?').bind(cid)]);
      await bump(DB, cid);
      return J({ ok: true });
    }
    if (p === '/c/state' && m === 'GET') return J(Object.assign({ ok: true, rev: await revOf(DB, cid) }, await childState(DB, cid, now)));
    if (p === '/c/wait' && m === 'GET') {         // \ubc14\ub014 \ub54c\uae4c\uc9c0 \ubd99\ub4e4\uc5b4 \ub450\uc5c8\ub2e4\uac00 \uc0c8 \ubb36\uc74c\uc744 \uc900\ub2e4(\uc790\ub140 \uc571\uc774 \ub298 \uc774\uac78 \uac78\uc5b4 \ub454\ub2e4)
      const since = +url.searchParams.get('since') || 0, tab = url.searchParams.get('tab'), qt = url.searchParams.get('qt');
      if (tab === 'chat' && url.searchParams.get('fg') === '1') await markRd(DB, cid, 'c');      // \uc790\ub140 \uc571\uc774 \uc55e\uc5d0 \ub5a0\uc11c \ub300\ud654 \ud0ed\uc744 \ubcf4\ub294 \uc911(fg=1) = \ubd80\ubaa8 \uae00\uc744 \uc77d\ub294 \uc911
      const rev = await waitRev(DB, cid, since, now);
      return J(await childBundle(DB, cid, tab, qt, Date.now(), rev));
    }
    if (p === '/c/screen' && m === 'GET') {
      if (url.searchParams.get('tab') === 'chat' && url.searchParams.get('fg') === '1') await markRd(DB, cid, 'c');
      const s = await screenOf(DB, cid, url.searchParams.get('tab'), url.searchParams.get('qt'), now);
      return s ? J({ ok: true, screen: s, linked: await linkedCount(DB, cid), rev: await revOf(DB, cid) }) : bad('\uc5c6\ub294 \ud654\uba74\uc774\uc5d0\uc694', 404);
    }
    if (p === '/c/act' && m === 'POST') {         // \ub20c\ub9bc \u00b7 \ubcf4\ub0b4\uae30\ub97c \ucc98\ub9ac\ud558\uace0 \uc0c8 \ud654\uba74\uacfc \uc0c1\ud0dc\ub97c \ub3cc\ub824\uc900\ub2e4
      const v = typeof body.v === 'string' ? body.v : '', arg = txt(body.arg), tab = body.tab, qt = body.qt;
      await prune(DB, cid, now);
      let notice = '', changed = true;
      if (v === 'chat.send' && arg) {
        await DB.prepare('INSERT INTO chat(cid,f,x,t) VALUES(?,?,?,?)').bind(cid, 'c', arg, now).run();
        await markRd(DB, cid, 'c');
        later(notifyParents(env, DB, cid, (nm) => ({ k: 'chat', title: nm || '\uae38\ub3d9\ubb34 \ud0a4\uc988', body: cut(arg, 80), tag: 'chat' })));
      } else if (v === 'quest.send' && arg) {        // \ubd80\ubaa8\ub2d8 \ubbf8\uc158 \ubcf4\ub0b4\uae30: \uc2a4\ud0c0\ud3ec\uc778\ud2b8 SEND_COST \uac00 \uc788\uc5b4\uc57c \ud55c\ub2e4(\uc544\uc9c1 \ub300\uae30 \uc911\uc778 \uac83\uc758 \ubaab\uc740 \ubbf8\ub9ac \ube7c \ub454\ub2e4)
        const have = await starsOf(DB, cid);
        const waiting = (await DB.prepare("SELECT COUNT(*) n FROM quests WHERE cid=? AND k='p' AND s=?").bind(cid, QS_WAIT).first())?.n || 0;
        if (have - waiting * SEND_COST < SEND_COST) { notice = '\uc2a4\ud0c0\ud3ec\uc778\ud2b8\uac00 \ubaa8\uc790\ub77c\uc694 (\ud55c \ubc88\uc5d0 ' + SEND_COST + ' \ud544\uc694)'; changed = false; }
        else {
          await DB.prepare('INSERT INTO quests(id,cid,k,x,s,t,pt,fl) VALUES(?,?,?,?,0,?,?,1)').bind(rid(), cid, 'p', arg, now, SEND_COST).run();
          later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' \ubd80\ubaa8\ub2d8 \ubbf8\uc158\uc744 \ubcf4\ub0c8\uc5b4\uc694. \uc2b9\ub099\ud574 \uc8fc\uc138\uc694: ' + cut(arg, 40), tag: 'quest' })));
        }
      } else if (v.startsWith('quest.accept:') || v.startsWith('quest.reject:')) {      // \uc790\ub140 \ubbf8\uc158(\ubd80\ubaa8\uac00 \uc900 \uac83): \uc790\ub140\uac00 \uc2b9\ub099(\uc9c4\ud589) \ub610\ub294 \uac70\uc808
        const yes = v.startsWith('quest.accept:'), qid = v.slice(13);
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s=?").bind(yes ? QS_ON : QS_NO, qid, cid, QS_WAIT).run();
        if (r && r.meta && r.meta.changes > 0) later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '\uae38\ub3d9\ubb34', body: who(nm) + (yes ? ' \ubbf8\uc158\uc744 \uc2b9\ub099\ud588\uc5b4\uc694' : ' \ubbf8\uc158\uc744 \uac70\uc808\ud588\uc5b4\uc694'), tag: 'quest' })));
        else changed = false;
      } else if (v.startsWith('quest.fin:')) {      // \uc790\ub140 \ubbf8\uc158: \uc790\ub140\uac00 \ud574\ub0c8\ub2e4\uace0 \uc644\ub8cc\ub97c \ub204\ub978\ub2e4 \u2014 \ubd80\ubaa8\uac00 \ud655\uc778\ud558\uba74 \uc2a4\ud0c0\ud3ec\uc778\ud2b8\uac00 \uc62c\ub77c\uac04\ub2e4
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s=?").bind(QS_REP, v.slice(10), cid, QS_ON).run();
        if (r && r.meta && r.meta.changes > 0) later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' \ubbf8\uc158\uc744 \uc644\ub8cc\ud588\ub300\uc694. \ud655\uc778\ud574 \uc8fc\uc138\uc694', tag: 'quest' })));
        else changed = false;
      } else if (v.startsWith('quest.confirm:') || v.startsWith('quest.pdone:')) {      // \ubd80\ubaa8\ub2d8 \ubbf8\uc158: \ubd80\ubaa8\ub2d8\uc774 \uc644\ub8cc\ud55c \uac83\uc744 \uc790\ub140\uac00 \ud655\uc778\ud558\uba74 \ub05d(\uc644\ub8cc)
        const qid = v.startsWith('quest.confirm:') ? v.slice(14) : v.slice(12);
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_DONE, qid, cid, QS_REP).run();
        if (r && r.meta && r.meta.changes > 0) later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' \ubd80\ubaa8\ub2d8 \ubbf8\uc158 \uc644\ub8cc\ub97c \ud655\uc778\ud588\uc5b4\uc694', tag: 'quest' })));
        else changed = false;
      } else if (v.startsWith('quest.done:')) {   // \uc61b \uc790\ub140 \uc571: \uc790\ub140\uac00 \ud574\ub0c8\ub2e4\uace0 \uc54c\ub9b0\ub2e4 \u2014 \ubd80\ubaa8\uac00 \uae38\ub3d9\ubb34\uc5d0\uc11c \ud655\uc778\ud574\uc57c \uc2a4\ud0c0\ud3ec\uc778\ud2b8\uac00 \uc624\ub978\ub2e4
        const qd = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s IN (0,1)").bind(QS_REP, v.slice(11), cid).run();
        if (qd && qd.meta && qd.meta.changes > 0) later(notifyParents(env, DB, cid, (nm) => ({ k: 'quest', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' \ubbf8\uc158\uc744 \ud574\ub0c8\ub300\uc694. \ud655\uc778\ud574 \uc8fc\uc138\uc694', tag: 'quest' })));
      } else if (v.startsWith('trip.')) {         // \uc7a5\uc18c \uc54c\ub9bc: \ud655\uc778(\uadf8\ub0e5 \ub054) \u00b7 \ucd9c\ubc1c \u00b7 \ub3c4\ucc29 \ud655\uc778(100m \uc548\uc5d0\uc11c \uc2a4\ud0c0\ud3ec\uc778\ud2b8 50)
        const kind = v.slice(5, v.indexOf(':')), id = v.slice(v.indexOf(':') + 1);
        const tr = await DB.prepare('SELECT t.st st, p.name name, p.la la, p.lo lo FROM trips t JOIN places p ON p.id=t.pl WHERE t.id=? AND t.cid=?').bind(id, cid).first();
        if (!tr) changed = false;
        else if (kind === 'ok' && tr.st === 'due') await DB.prepare("UPDATE trips SET st='seen', tk=? WHERE id=? AND st='due'").bind(now, id).run();
        else if (kind === 'go' && (tr.st === 'due' || tr.st === 'seen')) { await DB.prepare("UPDATE trips SET st='go', td=? WHERE id=? AND st IN ('due','seen')").bind(now, id).run(); notice = tr.name + '\uc5d0 \ub3c4\ucc29\ud558\uba74 \ud3ec\uc778\ud2b8\uac00 \uc313\uc5ec\uc694'; const tid = id; later(ev(DB, cid, 'go', tr.name, now)); if (await once(DB, tid, 2)) { const tn = tr.name, kn = tn; later(notifyParents(env, DB, cid, (nm) => ({ k: 'go', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' ' + kn + '\ub85c \ucd9c\ubc1c\ud588\uc5b4\uc694', tag: 'trip' + tid }))); } }
        else if (kind === 'arrive' && tr.st === 'go') {
          const loc = await DB.prepare('SELECT la,lo,t FROM loc WHERE cid=?').bind(cid).first();
          if (!loc || now - loc.t > LOC_FRESH) { notice = '\uc704\uce58\ub97c \ud655\uc778\ud558\ub294 \uc911\uc774\uc5d0\uc694. \uc7a0\uc2dc \ub4a4\uc5d0 \ub2e4\uc2dc \ub20c\ub7ec\uc694'; changed = false; }
          else if (hav(loc.la, loc.lo, tr.la, tr.lo) > ARR_M) { notice = '\uc544\uc9c1 ' + tr.name + '\uc5d0 \ub3c4\ucc29\ud558\uc9c0 \uc54a\uc558\uc5b4\uc694'; changed = false; }
          else {
            const r = await DB.prepare("UPDATE trips SET st='done', tc=?, ta=CASE WHEN ta=0 THEN ? ELSE ta END WHERE id=? AND st='go'").bind(now, now, id).run();
            if (r && r.meta && r.meta.changes > 0) { await addStars(DB, cid, ARRIVE_PT); notice = tr.name + '\uc5d0 \ub3c4\ucc29\ud588\uc5b4\uc694! \uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + ARRIVE_PT + '\uc810\uc744 \ubc1b\uc558\uc5b4\uc694'; const tn = tr.name, tid = id; later(ev(DB, cid, 'done', tn, now)); if (await once(DB, tid, 4)) later(notifyParents(env, DB, cid, (nm) => ({ k: 'done', title: '\uae38\ub3d9\ubb34', body: who(nm) + ' ' + tn + '\uc5d0 \ub3c4\ucc29\ud588\uc5b4\uc694 (\uc2a4\ud0c0 +' + ARRIVE_PT + ')', tag: 'trip' + tid }))); }
          }
        } else changed = false;
      } else changed = false;
      if (changed) await bump(DB, cid);
      return J(Object.assign({ notice }, await childBundle(DB, cid, tab, qt, now, await revOf(DB, cid))));
    }
    return bad('\uc5c6\ub294 \uae38\uc774\uc5d0\uc694', 404);
  }

  if (p.startsWith('/p/')) {
    if (p === '/p/join' && m === 'POST') {        // \ubd80\ubaa8 \uae38\ub3d9\ubb34 \uc571\uc774 QR/\ube44\ubc00\ud0a4\ub85c \uc5f0\uacb0 (\uba3c\uc800 /reg \ub85c role p \ub4f1\ub85d)
      const pid = await auth(req, DB, 'p');
      if (!pid) return bad('\uc778\uc99d\uc774 \ud544\uc694\ud574\uc694', 401);
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      const row = await DB.prepare('SELECT cid,exp FROM codes WHERE code=?').bind(code).first();
      if (!row || row.exp < now) return bad('\ud0a4\uac00 \ub9de\uc9c0 \uc54a\uac70\ub098 \uc2dc\uac04\uc774 \uc9c0\ub0ac\uc5b4\uc694', 404);
      if (!(await isLinked(DB, row.cid, pid)) && (await linkedCount(DB, row.cid)) >= MAX_PARENTS) return bad('\uc5f0\uacb0\ud560 \uc218 \uc788\ub294 \ubd80\ubaa8 \uc218\ub97c \ub118\uc5c8\uc5b4\uc694', 409);
      const nm = typeof body.nm === 'string' ? body.nm.replace(/\s+/g, '').slice(0, 8) : '';
      await DB.batch([DB.prepare('INSERT OR IGNORE INTO links(cid,pid,t,nm) VALUES(?,?,?,?)').bind(row.cid, pid, now, nm), DB.prepare('DELETE FROM codes WHERE code=?').bind(code)]);
      if (nm) await DB.prepare('UPDATE links SET nm=? WHERE cid=? AND pid=?').bind(nm, row.cid, pid).run();
      await bump(DB, row.cid);                   // \uc790\ub140 \uc571\uc774 \uace7\ubc14\ub85c '\uc5f0\uacb0\ub410\uc5b4\uc694' \ub97c \ubc1b\ub294\ub2e4
      later(notifyChild(env, DB, row.cid, { k: 'link', title: '\uae38\ub3d9\ubb34 \ud0a4\uc988', body: '\ubd80\ubaa8\ub2d8\uacfc \uc5f0\uacb0\ub410\uc5b4\uc694', tag: 'link' }));
      locAskAt.set(row.cid, now);                                                       // \uc5f0\uacb0 \uc9c1\ud6c4\uc5d0\ub3c4 \uc704\uce58\ub97c \ud55c \ubc88 \ubc14\ub85c \ubc1b\uc544 \uc628\ub2e4(\ud5c8\ube0c\uac00 \ub610 \ubb3b\uc9c0 \uc54a\uac8c 3\ubd84 \ud45c\uc2dc)
      later(notifyChild(env, DB, row.cid, { k: 'locreq', tag: 'locreq' }));
      return J({ ok: true, cid: row.cid });
    }
    const pid = await auth(req, DB, 'p');
    if (!pid) return bad('\uc778\uc99d\uc774 \ud544\uc694\ud574\uc694', 401);
    if (p === '/p/ft' && m === 'POST') return J(await saveFt(DB, pid, body.tk, now));
    if (p === '/p/children' && m === 'GET') {
      const rows = (await DB.prepare('SELECT l.cid cid, l.nm nm, o.la la, o.lo lo, o.acc acc, o.t t, COALESCE(s.n,0) stars FROM links l LEFT JOIN loc o ON o.cid=l.cid LEFT JOIN stars s ON s.cid=l.cid WHERE l.pid=?').bind(pid).all()).results || [];
      if (!(await gdOk(DB, pid))) rows.forEach((r) => { r.la = null; r.lo = null; r.acc = null; r.t = null; });          // \ubc95\uc815\ub300\ub9ac\uc778 \ud655\uc778 \uc804\uc5d0\ub294 \uc704\uce58\ub97c \uc8fc\uc9c0 \uc54a\ub294\ub2e4
      return J({ ok: true, children: rows });
    }
    if (p === '/p/setrow' && m === 'GET') return J({ ok: true, nodes: await settingsRow(DB, pid), start: await startPref(DB, pid), tab: KIDS_TAB });     // \uc124\uc815 \ud0ed\uc5d0 \ub07c\uc6b8 \ud55c \uc904(\uc5f0\uacb0 \uc5c6\uc73c\uba74 null)
    if (p === '/p/screen' && m === 'GET') {       // \ubd80\ubaa8 \ud654\uba74 \ubb36\uc74c: v = hub \u00b7 chat \u00b7 quest \u00b7 link
      const v = url.searchParams.get('v') || 'hub', cid0 = url.searchParams.get('cid') || '';
      if (v === 'link') return J({ ok: true, screen: await linkSheet(DB, pid, '') });
      const kids = await childrenOf(DB, pid);
      const cid = kids.some((k) => k.cid === cid0) ? cid0 : kids[0] ? kids[0].cid : '';
      if (!cid) return J({ ok: true, linked: 0, screen: await hubScreen(DB, pid, '', now) });
      if (v === 'cheer') return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await cheerSheet(DB, pid, cid, '') });
      if (v === 'chat' || v === 'fam') await markRd(DB, cid, 'p');                    // \ub300\ud654\ubc29\uc744 \uc5f4\uc5c8\ub2e4 = \uc790\ub140 \uae00\uc744 \uc77d\uc5c8\ub2e4(\ud5c8\ube0c \ubbf8\ub9ac \ubc1b\uae30 v=hub \ub294 \uc77d\uc74c\uc774 \uc544\ub2c8\ub2e4)
      if (v === 'chat') return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await chatSheet(DB, pid, cid, now) });
      if (v === 'fam') return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await famScreen(DB, pid, cid, now) });
      if (v === 'quest') return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await questSheet(DB, pid, cid, url.searchParams.get('qt')) });
      if (v === 'hub' && await gdOk(DB, pid)) { await watchTouch(env, DB, pid, cid, now); await askLoc(env, DB, cid, now); await lbsLog(DB, cid, pid, 'v', now, 60000); }                // \ubcf4\ub294 \uc911 \ud45c\uc2dc(+ \uc0c8\ub85c \ubcf4\uae30 \uc2dc\uc791\ud558\uba74 \uc790\ub140 \ud3f0\uc5d0 watch \ud478\uc2dc) \u00b7 \uc704\uce58\uac00 \uc5c6\uac70\ub098 \uc624\ub798\ub410\uc73c\uba74 \uc790\ub140 \ud3f0\uc5d0 \ud55c \ubc88 \uc694\uccad
      return J({ ok: true, linked: kids.length, rev: await revOf(DB, cid), cid, screen: await hubScreen(DB, pid, cid, now) });
    }
    if (p === '/p/wait' && m === 'GET') {         // \ubc14\ub014 \ub54c\uae4c\uc9c0 \ubd99\ub4e4\uc5b4 \ub450\uc5c8\ub2e4\uac00 \uadf8 \ud654\uba74\uc744 \uc0c8\ub85c \uc900\ub2e4(\ubd80\ubaa8 \uc571\uc774 \ubcf4\ub294 \ud654\uba74\ub9c8\ub2e4 \uac74\ub2e4)
      const v = url.searchParams.get('v') || 'hub', cid0 = url.searchParams.get('cid') || '', since = +url.searchParams.get('since') || 0;
      const kids0 = await childrenOf(DB, pid);
      const cid = kids0.some((k) => k.cid === cid0) ? cid0 : kids0[0] ? kids0[0].cid : '';
      if (!cid) return J({ ok: true, linked: 0, rev: 0 });
      if (v === 'hub' || v === 'chat' || v === 'fam') await markRd(DB, cid, 'p');         // \ubd80\ubaa8 \uc571\uc774 \ud0a4\uc988 \ud654\uba74\uc744 \ubcf4\ub294 \ub3d9\uc548\uc5d0\ub9cc \uae34 \ub300\uae30\ub97c \uac74\ub2e4 \u2014 \uadf8\ub3d9\uc548\uc740 \uc790\ub140 \uae00\uc744 \uc77d\ub294 \uc911
      if (v === 'hub' && await gdOk(DB, pid)) { await watchTouch(env, DB, pid, cid, now); await lbsLog(DB, cid, pid, 'v', now, 60000); }                          // \uc2e4\uc2dc\uac04 \ubcf4\uae30(s393): \ub300\uae30\uac00 \uc774\uc5b4\uc838 \uc788\ub294 \ub3d9\uc548 '\ubcf4\ub294 \uc911'
      const rev = await waitRev(DB, cid, since, now);
      const t2 = Date.now(), kids = await childrenOf(DB, pid);
      if (!kids.some((k) => k.cid === cid)) return J({ ok: true, linked: kids.length, rev, gone: true });
      const screen = v === 'cheer' ? await cheerSheet(DB, pid, cid, '') : v === 'chat' ? await chatSheet(DB, pid, cid, t2) : v === 'fam' ? await famScreen(DB, pid, cid, t2) : v === 'quest' ? await questSheet(DB, pid, cid, url.searchParams.get('qt')) : await hubScreen(DB, pid, cid, t2);
      return J({ ok: true, linked: kids.length, rev, cid, screen });
    }
    if (p === '/p/act' && m === 'POST') {         // \ubd80\ubaa8\uac00 \ub204\ub978 \uac83 \u00b7 \ubcf4\ub0b8 \uac83. \ud654\uba74\uc740 \uc5d4\uc9c4\uc774 \ub2e4\uc2dc \uc9dc\uc11c \ub3cc\ub824\uc900\ub2e4
      const v = typeof body.v === 'string' ? body.v : '', id = typeof body.id === 'string' ? body.id : '', t = typeof body.t === 'string' ? body.t : '';
      const f = body.f && typeof body.f === 'object' ? body.f : {};
      const kids = await childrenOf(DB, pid);
      const cid1 = typeof body.cid === 'string' ? body.cid : '';
      const cid = kids.some((k) => k.cid === (id || cid1)) && v.startsWith('kl.') ? id : kids.some((k) => k.cid === cid1) ? cid1 : kids[0] ? kids[0].cid : '';
      const R = (o) => J(Object.assign({ ok: true }, o));
      // \ubc95\uc815\ub300\ub9ac\uc778 \ud655\uc778(s394): \ud558\uae30 \uc804\uc5d0\ub294 \uc704\uce58\uc640 \uad00\ub828\ub41c \ub3d9\uc791\uc744 \ubc1b\uc9c0 \uc54a\ub294\ub2e4
      if (v === 'kg.ok') {
        if (!cid) return R({ close: true });
        await DB.prepare('INSERT INTO gd(pid,v,t) VALUES(?,?,?) ON CONFLICT(pid) DO UPDATE SET v=excluded.v,t=excluded.t').bind(pid, GD_VER, now).run();
        await bump(DB, cid);
        return R({ screen: await hubScreen(DB, pid, cid, now), cid, hub: 1 });
      }
      if (/^k(r|pg|p|pl|d|x)\./.test(v) && !(await gdOk(DB, pid))) return R({ close: true, hub: 1 });
      if (v === 'kx.ack' || v === 'kx.done') {          // \ubd80\ubaa8\uac00 \uae34\uae09 \ud638\ucd9c \u00b7 \ub370\ub9ac\ub7ec \uc640\uc918 \ub97c \ud655\uc778\ud588\ub2e4 / \ub05d\ub0ac\ub2e4
        if (!cid || !t) return R({ hub: 1 });
        const ack = v === 'kx.ack';
        const r = await DB.prepare('UPDATE calls SET st=?,at=? WHERE id=? AND cid=? AND st=?').bind(ack ? 1 : 3, now, String(t), cid, ack ? 0 : 1).run();
        if (r && r.meta && r.meta.changes > 0) {
          const c = await DB.prepare('SELECT k FROM calls WHERE id=?').bind(String(t)).first();
          await bump(DB, cid);
          if (ack && c) later(notifyChild(env, DB, cid, { k: 'callack', title: '\uae38\ub3d9\ubb34 \ud0a4\uc988', body: callAck(c.k), tag: 'callack' }));
        }
        return R({ screen: await hubScreen(DB, pid, cid, now), cid, hub: 1 });
      }
      // \uc5f0\uacb0 \uad00\ub9ac
      if (v === 'kl.open') return R({ screen: await linkSheet(DB, pid, '') });
      if (v === 'kl.close') return R({ close: true });
      if (v === 'kl.start') {                      // \uc124\uc815 \ud1a0\uae00: \ud0a4\uc988 \ud654\uba74\uc73c\ub85c \uc2dc\uc791
        if (!kids.length) return R({ start: 0 });
        await DB.prepare('UPDATE devices SET kh=? WHERE id=?').bind(t === '1' ? 1 : 0, pid).run();
        return R({ start: t === '1' ? 1 : 0 });
      }
      if (v === 'kl.join') {
        let code = String(t || f.klc || '').trim().toUpperCase();
        { const raw = code.replace(/[^A-Z0-9]/g, ''); if (raw.length === 10) code = raw.slice(0, 5) + '-' + raw.slice(5); }          // \ud558\uc774\ud508 \uc5c6\uc774 10\uc790\ub9ac\ub85c \uc640\ub3c4 XXXXX-XXXXX \ub85c \ub9de\ucd98\ub2e4
        if (!code) return R({ screen: await linkSheet(DB, pid, '\uc2dc\ud06c\ub9bf \ud0a4\ub97c \uc785\ub825\ud574 \uc8fc\uc138\uc694') });
        const row = await DB.prepare('SELECT cid,exp FROM codes WHERE code=?').bind(code).first();
        if (!row || row.exp < now) return R({ screen: await linkSheet(DB, pid, '\ud0a4\uac00 \ub9de\uc9c0 \uc54a\uac70\ub098 \uc2dc\uac04\uc774 \uc9c0\ub0ac\uc5b4\uc694') });
        if (!(await isLinked(DB, row.cid, pid)) && (await linkedCount(DB, row.cid)) >= MAX_PARENTS) return R({ screen: await linkSheet(DB, pid, '\uc5f0\uacb0\ud560 \uc218 \uc788\ub294 \ubd80\ubaa8 \uc218\ub97c \ub118\uc5c8\uc5b4\uc694') });
        const nm = String(f.kln || '').replace(/\s+/g, '').slice(0, 8);
        await DB.batch([DB.prepare('INSERT OR IGNORE INTO links(cid,pid,t,nm) VALUES(?,?,?,?)').bind(row.cid, pid, now, nm), DB.prepare('DELETE FROM codes WHERE code=?').bind(code)]);
        if (nm) await DB.prepare('UPDATE links SET nm=? WHERE cid=? AND pid=?').bind(nm, row.cid, pid).run();
        const pn0 = String(f.kpn || '').replace(/\s+/g, ' ').trim().slice(0, 8);
        if (pn0) await DB.prepare('UPDATE links SET pnm=? WHERE pid=?').bind(pn0, pid).run();
        else { const old = await pnOf(DB, pid); if (old) await DB.prepare('UPDATE links SET pnm=? WHERE cid=? AND pid=?').bind(old, row.cid, pid).run(); }
        await bump(DB, row.cid);
        later(notifyChild(env, DB, row.cid, { k: 'link', title: '\uae38\ub3d9\ubb34 \ud0a4\uc988', body: '\ubd80\ubaa8\ub2d8\uacfc \uc5f0\uacb0\ub410\uc5b4\uc694', tag: 'link' }));
        return R({ screen: await linkSheet(DB, pid, '\uc5f0\uacb0\ub410\uc5b4\uc694'), linked: 1, notice: '\uae38\ub3d9\ubb34 \ud0a4\uc988\uc640 \uc5f0\ub3d9\ub418\uc5c8\uc2b5\ub2c8\ub2e4' });
      }
      if (v === 'kl.pname') {                      // \ubd80\ubaa8\uac00 \uc790\uae30 \uc774\ub984\uc744 \uc815\ud55c\ub2e4(\uc5f0\uacb0\ub41c \ubaa8\ub4e0 \uc790\ub140\uc5d0\uac8c \uac19\uc740 \uc774\ub984)
        const pn = String(f.kpn || '').replace(/\s+/g, ' ').trim().slice(0, 8);
        await DB.prepare('UPDATE links SET pnm=? WHERE pid=?').bind(pn, pid).run();
        for (const k of kids) await bump(DB, k.cid);
        return R({ screen: await linkSheet(DB, pid, pn ? '\uc774\ub984\uc744 \uc800\uc7a5\ud588\uc5b4\uc694' : '\uc774\ub984\uc744 \uc9c0\uc6e0\uc5b4\uc694'), notice: '\uc800\uc7a5\ud588\uc5b4\uc694' });
      }
      if (v === 'kl.name' && kids.some((k) => k.cid === id)) {
        const nm = String(f['kn_' + id.slice(0, 12)] || '').replace(/\s+/g, '').slice(0, 8);
        await DB.prepare('UPDATE links SET nm=? WHERE cid=? AND pid=?').bind(nm, id, pid).run();
        await bump(DB, id);
        return R({ screen: await linkSheet(DB, pid, '\uc774\ub984\uc744 \uc800\uc7a5\ud588\uc5b4\uc694'), notice: '\uc800\uc7a5\ud588\uc5b4\uc694' });
      }
      if (v === 'kl.unlink' && kids.some((k) => k.cid === id)) {
        await DB.prepare('DELETE FROM links WHERE cid=? AND pid=?').bind(id, pid).run();
        if ((await linkedCount(DB, id)) === 0) await DB.batch([DB.prepare('DELETE FROM loc WHERE cid=?').bind(id), DB.prepare('DELETE FROM locs WHERE cid=?').bind(id), DB.prepare('DELETE FROM routes WHERE cid=?').bind(id), DB.prepare('DELETE FROM rtst WHERE cid=?').bind(id), DB.prepare('DELETE FROM cst WHERE cid=?').bind(id), DB.prepare('DELETE FROM stops WHERE cid=?').bind(id), DB.prepare('DELETE FROM zt WHERE k LIKE ?').bind(id + ':%'), DB.prepare('DELETE FROM drafts WHERE cid=?').bind(id), DB.prepare('DELETE FROM places WHERE cid=?').bind(id), DB.prepare('DELETE FROM trips WHERE cid=?').bind(id), DB.prepare('DELETE FROM cheers WHERE cid=?').bind(id), DB.prepare('DELETE FROM evs WHERE cid=?').bind(id), DB.prepare('DELETE FROM calls WHERE cid=?').bind(id)]);
        await bump(DB, id);
        const left = await childrenOf(DB, pid);
        return R({ screen: await linkSheet(DB, pid, '\uc5f0\uacb0\uc744 \ub04a\uc5c8\uc5b4\uc694'), linked: left.length, notice: '\uc5f0\uacb0\uc744 \ub04a\uc5c8\uc5b4\uc694' });
      }
      if (!cid) return bad('\uc5f0\uacb0\ub41c \uc790\ub140\uac00 \uc5c6\uc5b4\uc694', 403);
      // \uac00\uc871 \ub300\ud654
      if (v === 'kh.cheer') return R({ screen: await cheerSheet(DB, pid, kids.some((k) => k.cid === id) ? id : cid, ''), cid: kids.some((k) => k.cid === id) ? id : cid, sheet: 'cheer' });
      if (v === 'kh.ca' || v === 'kh.cd') {
        const c2 = kids.some((k) => k.cid === id) ? id : cid;
        if (!c2) return R({ close: true });
        let note = '';
        if (v === 'kh.ca') {
          const x = (typeof f.kch === 'string' ? f.kch : '').replace(/\s+/g, ' ').trim().slice(0, CHEER_LEN);
          const n = (await DB.prepare('SELECT COUNT(*) n FROM cheers WHERE cid=?').bind(c2).first())?.n || 0;
          if (!x) note = '\ubb38\uad6c\ub97c \uc801\uc5b4 \uc8fc\uc138\uc694';
          else if (n >= MAX_CHEER) note = '\uc751\uc6d0\ubb38\uad6c\ub294 \ucd5c\ub300 ' + MAX_CHEER + '\uac1c\uae4c\uc9c0\uc608\uc694';
          else { await DB.prepare('INSERT INTO cheers(cid,x,t) VALUES(?,?,?)').bind(c2, x, now).run(); await bump(DB, c2); }
        } else { await DB.prepare('DELETE FROM cheers WHERE id=? AND cid=?').bind(Math.round(Number(t)) || 0, c2).run(); await bump(DB, c2); }
        return R({ screen: await cheerSheet(DB, pid, c2, note), cid: c2, sheet: 'cheer', clear: 'kch' });
      }
      if (v === 'kc.open') { await markRd(DB, cid, 'p'); return R({ screen: await chatSheet(DB, pid, cid, now), cid, sheet: 'chat' }); }
      if (v === 'kd.open') return R({ screen: await evSheet(DB, pid, cid, now), cid, sheet: 'ev' });
      // \uc7a5\uc18c \ub4f1\ub85d(s392)
      if (v === 'kpg.open') {
        if (((await DB.prepare('SELECT COUNT(*) n FROM places WHERE cid=?').bind(cid).first()) || { n: 0 }).n >= MAX_PLACES) return R({ notice: '\uc7a5\uc18c\ub294 ' + MAX_PLACES + '\uacf3\uae4c\uc9c0 \ub4f1\ub85d\ud560 \uc218 \uc788\uc5b4\uc694' });
        const l0 = await DB.prepare('SELECT la,lo FROM loc WHERE cid=?').bind(cid).first();
        const la0 = l0 ? l0.la : 37.5665, lo0 = l0 ? l0.lo : 126.978;
        await saveDraft(DB, pid, cid, la0, lo0, '', '', now);
        return R({ screen: regSheet({ la: la0, lo: lo0, name: '', q: '' }, null, l0 ? '' : '\uc790\ub140 \uc704\uce58\ub97c \uc544\uc9c1 \ubab0\ub77c\uc694. \uc8fc\uc18c\ub97c \ucc3e\uc544 \uc8fc\uc138\uc694'), cid, sheet: 'ev' });
      }
      if (v.startsWith('kpg.')) {
        const d = await readDraft(DB, pid);
        if (!d) return R({ close: true });
        const name = typeof f.kpn === 'string' ? f.kpn.replace(/\s+/g, ' ').trim().slice(0, 20) : d.name;
        if (v === 'kpg.cancel') { await DB.prepare('DELETE FROM drafts WHERE pid=?').bind(pid).run(); return R({ close: true }); }
        if (v === 'kpg.find') {
          const q = typeof f.kpa === 'string' ? f.kpa.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
          if (!q) { await saveDraft(DB, pid, cid, d.la, d.lo, name, '', now); return R({ screen: regSheet({ la: d.la, lo: d.lo, name, q: '' }, null, '\ucc3e\uc744 \uc8fc\uc18c\ub098 \uc7a5\uc18c\ub97c \uc801\uc5b4 \uc8fc\uc138\uc694'), cid, sheet: 'ev' }); }
          const res = await geoFind(q, [d.la, d.lo], env);
          if (!res.length) { await saveDraft(DB, pid, cid, d.la, d.lo, name, q, now); return R({ screen: regSheet({ la: d.la, lo: d.lo, name, q }, null, (res.err ? '\uac80\uc0c9 \uc11c\ubc84\uac00 \uc751\ub2f5\ud558\uc9c0 \uc54a\uc544\uc694 (' + res.err + '). \uc7a0\uc2dc \ub4a4 \ub2e4\uc2dc \ub20c\ub7ec \ubcf4\uc138\uc694' : '\ucc3e\uc9c0 \ubabb\ud588\uc5b4\uc694. \ub2e4\ub978 \ub9d0\ub85c \uc801\uc5b4 \ubcf4\uc138\uc694 (\uc608: \uc2dc\u00b7\uad6c\u00b7\ub3d9 + \uac74\ubb3c \uc774\ub984)')), cid, sheet: 'ev' }); }
          await saveDraft(DB, pid, cid, res[0].la, res[0].lo, name || (res.length === 1 ? res[0].n.slice(0, 20) : ''), q, now);
          const d2 = await readDraft(DB, pid);
          return R({ screen: regSheet(d2, res, res.length > 1 ? '\uc5ec\ub7ec \uacf3\uc774 \ub098\uc654\uc5b4\uc694. \uc544\ub798\uc5d0\uc11c \uace0\ub974\uc138\uc694' : ''), cid, sheet: 'ev' });
        }
        if (v === 'kpg.pick') {
          const res = d.q ? await geoFind(d.q, [d.la, d.lo], env) : [], i = Math.round(Number(t)), r = res[i];
          if (!r) return R({ screen: regSheet(d, null, '\ub2e4\uc2dc \ucc3e\uc544 \uc8fc\uc138\uc694'), cid, sheet: 'ev' });
          await saveDraft(DB, pid, cid, r.la, r.lo, name || r.n.slice(0, 20), d.q, now);
          return R({ screen: regSheet(await readDraft(DB, pid), res, ''), cid, sheet: 'ev' });
        }
        if (v === 'kpg.add') {
          if (!name) { await saveDraft(DB, pid, cid, d.la, d.lo, '', d.q || '', now); return R({ screen: regSheet(Object.assign({}, d, { name: '' }), null, '\uc7a5\uc18c \uc774\ub984\uc744 \uc801\uc5b4 \uc8fc\uc138\uc694'), cid, sheet: 'ev' }); }
          if (((await DB.prepare('SELECT COUNT(*) n FROM places WHERE cid=?').bind(cid).first()) || { n: 0 }).n >= MAX_PLACES) return R({ close: true, notice: '\uc7a5\uc18c\ub294 ' + MAX_PLACES + '\uacf3\uae4c\uc9c0 \ub4f1\ub85d\ud560 \uc218 \uc788\uc5b4\uc694' });
          await DB.batch([DB.prepare('INSERT INTO places(id,cid,name,la,lo,hh,mm,days,t) VALUES(?,?,?,?,?,0,0,0,?)').bind(rid(), cid, name, d.la, d.lo, now), DB.prepare('DELETE FROM drafts WHERE pid=?').bind(pid)]);
          plCache.delete(cid);
          await bump(DB, cid);
          return R({ close: true, hub: 1, notice: name + ' \ub4f1\ub85d\ud588\uc5b4\uc694 \u00b7 \ub3c4\ucc29\ud558\uac70\ub098 \ubc97\uc5b4\ub098\uba74 \uc54c\ub824 \ub4dc\ub824\uc694' });
        }
        return R({ close: true });
      }
      if (v === 'kr.open') return R({ screen: await rtSheet(DB, pid, cid, now, ''), cid, sheet: 'ev' });
      if (v === 'kr.live') { await DB.prepare('UPDATE devices SET rv=0,rvt=0 WHERE id=?').bind(pid).run(); return R({ screen: await hubScreen(DB, pid, cid, now), cid }); }
      if (/^kr\.\d{1,12}$/.test(v)) {                  // \uc9c0\ub09c \uacbd\ub85c \ud558\ub098\ub97c \uace8\ub790\ub2e4 \u2192 \uc9c0\ub3c4\uc5d0 \uadf8\ub9b0\ub2e4(10\ubd84 \ub3d9\uc548 \u00b7 \ud31d\uc5c5\uc740 \ub2eb\ub294\ub2e4)
        const rid_ = +v.slice(3), ok = await DB.prepare('SELECT 1 a FROM routes WHERE id=? AND cid=?').bind(rid_, cid).first();
        if (!ok) return R({ screen: await rtSheet(DB, pid, cid, now, '\uc774\ubbf8 \uc9c0\uc6cc\uc9c4 \uacbd\ub85c\uc608\uc694'), cid, sheet: 'ev' });
        await DB.prepare('UPDATE devices SET rv=?,rvt=? WHERE id=?').bind(rid_, now, pid).run();
        return R({ screen: await hubScreen(DB, pid, cid, now), cid, close: true });
      }
      if (v === 'kh.say') {                         // \uae38\ub3d9\ubb34 \ud655\uc778 \ud654\uba74 \uc544\ub798 \uc785\ub825\uc904\uc5d0\uc11c \ubcf4\ub0b8 \uae00
        const x = txt(f.khc);
        if (x) { await prune(DB, cid, now); const pn_ = await pnOf(DB, pid); await DB.prepare('INSERT INTO chat(cid,f,x,t,pn) VALUES(?,?,?,?,?)').bind(cid, 'p', x, now, pn_).run(); await bump(DB, cid); await markRd(DB, cid, 'p'); later(notifyChild(env, DB, cid, { k: 'chat', title: pn_ || '\ubd80\ubaa8\ub2d8', body: cut(x, 80), tag: 'chat' })); }
        return R({ cid, clear: 'khc', light: 1 });                  // \uac00\ubccd\uac8c: \uc0c8 \ud654\uba74\uc740 \uc571\uc774 \ubc29\uae08 \uadf8\ub9b0 \uae00(\ub099\uad00\uc801 \ud45c\uc2dc)\uacfc \uae34 \ub300\uae30(\ubc14\ub01c 0.6\ucd08 \uc548)\uac00 \uc774\uc5b4 \ubc1b\ub294\ub2e4
      }
      if (v === 'kf.send') {                        // \ucee4\ubba4\ub2c8\ud2f0 \uac00\uc871\ub300\ud654 \ubcf8\ubb38\uc5d0\uc11c \ubcf4\ub0b8 \uae00
        const x = txt(f.kct);
        if (x) { await prune(DB, cid, now); const pn_ = await pnOf(DB, pid); await DB.prepare('INSERT INTO chat(cid,f,x,t,pn) VALUES(?,?,?,?,?)').bind(cid, 'p', x, now, pn_).run(); await bump(DB, cid); await markRd(DB, cid, 'p'); later(notifyChild(env, DB, cid, { k: 'chat', title: pn_ || '\ubd80\ubaa8\ub2d8', body: cut(x, 80), tag: 'chat' })); }
        return R({ screen: await famScreen(DB, pid, cid, now), cid, clear: 'kct' });
      }
      if (v === 'kc.send') {
        const x = txt(f.kct);
        if (x) { await prune(DB, cid, now); const pn_ = await pnOf(DB, pid); await DB.prepare('INSERT INTO chat(cid,f,x,t,pn) VALUES(?,?,?,?,?)').bind(cid, 'p', x, now, pn_).run(); await bump(DB, cid); await markRd(DB, cid, 'p'); later(notifyChild(env, DB, cid, { k: 'chat', title: pn_ || '\ubd80\ubaa8\ub2d8', body: cut(x, 80), tag: 'chat' })); }
        return R({ screen: await chatSheet(DB, pid, cid, now), cid, clear: 'kct' });
      }
      // \ud018\uc2a4\ud2b8
      if (v === 'kq.open') return R({ screen: await questSheet(DB, pid, cid, t), cid, sheet: 'quest', qt: t === 'p' ? 'p' : 'c' });
      if (v === 'kq.pt') return R({ screen: await questSheet(DB, pid, cid, 'c'), cid });      // \uc61b \uc571 \ud638\ud658(\uc0c8 \uc571\uc740 \uc810\uc218 \uace0\ub974\uae30\ub97c \uae30\uae30\uc5d0\uc11c \ubc14\ub85c \ucc98\ub9ac\ud55c\ub2e4)
      if (v === 'kq.tab') return R({ screen: await questSheet(DB, pid, cid, t), cid, qt: t === 'p' ? 'p' : 'c' });
      if (v === 'kq.send') {
        const x = txt(f.kqx);
        if (!x) return R({ screen: await questSheet(DB, pid, cid, 'c'), cid, notice: '\ubbf8\uc158 \ub0b4\uc6a9\uc744 \uc801\uc5b4 \uc8fc\uc138\uc694' });
        await prune(DB, cid, now);
        await DB.prepare('INSERT INTO quests(id,cid,k,x,s,t,pt,fl) VALUES(?,?,?,?,0,?,?,1)').bind(rid(), cid, 'c', x, now, pts(t)).run();
        await bump(DB, cid);
        later(notifyChild(env, DB, cid, { k: 'quest', title: '\uc0c8 \ud018\uc2a4\ud2b8', body: cut(x, 80) + ' \u00b7 \uc2b9\ub099\ud574 \uc8fc\uc138\uc694', tag: 'quest' }));
        return R({ screen: await questSheet(DB, pid, cid, 'c'), cid, clear: 'kqx', notice: '\ubbf8\uc158\uc744 \ubcf4\ub0c8\uc5b4\uc694' });
      }
      if (v === 'kq.ok') {                          // \uc790\ub140 \ubbf8\uc158: \uc790\ub140\uac00 \uc644\ub8cc\ud588\ub2e4\uace0 \ud55c \uac83\uc744 \ubd80\ubaa8\uac00 \ud655\uc778 \u2192 \uc885\ub8cc + \uc2a4\ud0c0\ud3ec\uc778\ud2b8 \uc9c0\uae09
        const q = await DB.prepare("SELECT pt FROM quests WHERE id=? AND cid=? AND k='c' AND s=?").bind(id, cid, QS_REP).first();
        let notice = '\ud655\uc778\ud560 \uc218 \uc788\ub294 \uc0c1\ud0dc\uac00 \uc544\ub2c8\uc5d0\uc694';
        if (q) {
          const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s=?").bind(QS_DONE, id, cid, QS_REP).run();
          if (r && r.meta && r.meta.changes > 0) { await addStars(DB, cid, q.pt || 1); notice = '\uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + (q.pt || 1) + '\uc810\uc744 \uc92c\uc5b4\uc694'; await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'star', title: '\uc2a4\ud0c0\ud3ec\uc778\ud2b8', body: '\ubbf8\uc158\uc744 \ud574\ub0b4\uc11c \uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + (q.pt || 1) + '\uc810\uc744 \ubc1b\uc558\uc5b4\uc694', tag: 'quest' })); }
        }
        return R({ screen: await questSheet(DB, pid, cid, 'c'), cid, notice });
      }
      if (v === 'kq.redo') { const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='c' AND s=?").bind(QS_ON, id, cid, QS_REP).run(); if (r && r.meta && r.meta.changes > 0) { await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'quest', title: '\ubbf8\uc158', body: '\ubd80\ubaa8\ub2d8\uc774 \ub2e4\uc2dc \ud574 \ubcf4\ub798\uc694', tag: 'quest' })); } return R({ screen: await questSheet(DB, pid, cid, 'c'), cid, notice: '\ub2e4\uc2dc \ud558\uac8c \ub3cc\ub824\ubcf4\ub0c8\uc5b4\uc694' }); }
      if (v === 'kq.accept') {                      // \ubd80\ubaa8\ub2d8 \ubbf8\uc158: \ubd80\ubaa8\uac00 \uc2b9\ub099 \u2192 \uc790\ub140 \uc2a4\ud0c0\ud3ec\uc778\ud2b8 SEND_COST \ucc28\uac10(\ubaa8\uc790\ub77c\uba74 \uc2b9\ub099\ub418\uc9c0 \uc54a\ub294\ub2e4)
        const q = await DB.prepare("SELECT pt FROM quests WHERE id=? AND cid=? AND k='p' AND s=?").bind(id, cid, QS_WAIT).first();
        let notice = '\uc774\ubbf8 \ucc98\ub9ac\ud55c \ubbf8\uc158\uc774\uc5d0\uc694';
        if (q) {
          const cost = q.pt || SEND_COST;
          const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_ON, id, cid, QS_WAIT).run();
          if (r && r.meta && r.meta.changes > 0) {
            if (await takeStars(DB, cid, cost)) { notice = '\uc2b9\ub099\ud588\uc5b4\uc694 \u00b7 \uc790\ub140 \uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + cost + ' \ucc28\uac10'; await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'quest', title: '\ubbf8\uc158 \uc2b9\ub099', body: '\ubd80\ubaa8\ub2d8\uc774 \uc2b9\ub099\ud588\uc5b4\uc694 \u00b7 \uc2a4\ud0c0\ud3ec\uc778\ud2b8 ' + cost + ' \ucc28\uac10', tag: 'quest' })); }
            else { await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_WAIT, id, cid, QS_ON).run(); notice = '\uc790\ub140\uc758 \uc2a4\ud0c0\ud3ec\uc778\ud2b8\uac00 \ubaa8\uc790\ub77c\uc11c \uc2b9\ub099\ud560 \uc218 \uc5c6\uc5b4\uc694'; }
          }
        }
        return R({ screen: await questSheet(DB, pid, cid, 'p'), cid, notice });
      }
      if (v === 'kq.reject') {                      // \ubd80\ubaa8\ub2d8 \ubbf8\uc158: \uac70\uc808(\ucc28\uac10 \uc5c6\uc74c)
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_NO, id, cid, QS_WAIT).run();
        if (r && r.meta && r.meta.changes > 0) { await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'quest', title: '\ubbf8\uc158', body: '\ubd80\ubaa8\ub2d8\uc774 \uc774\ubc88 \ubbf8\uc158\uc740 \uc5b4\ub835\ub300\uc694', tag: 'quest' })); }
        return R({ screen: await questSheet(DB, pid, cid, 'p'), cid, notice: '\uac70\uc808\ud588\uc5b4\uc694' });
      }
      if (v === 'kq.fin') {                         // \ubd80\ubaa8\ub2d8 \ubbf8\uc158: \ubd80\ubaa8\uac00 \ud574\ub0c8\ub2e4\uace0 \uc644\ub8cc \u2192 \uc790\ub140\uac00 \ud655\uc778\ud574\uc57c \uc885\ub8cc
        const r = await DB.prepare("UPDATE quests SET s=? WHERE id=? AND cid=? AND k='p' AND s=?").bind(QS_REP, id, cid, QS_ON).run();
        if (r && r.meta && r.meta.changes > 0) { await bump(DB, cid); later(notifyChild(env, DB, cid, { k: 'quest', title: '\ubbf8\uc158 \uc644\ub8cc', body: '\ubd80\ubaa8\ub2d8\uc774 \ubbf8\uc158\uc744 \ud574\ub0c8\uc5b4\uc694. \ud655\uc778\ud574 \uc8fc\uc138\uc694', tag: 'quest' })); }
        return R({ screen: await questSheet(DB, pid, cid, 'p'), cid, notice: '\uc790\ub140\uac00 \ud655\uc778\ud558\uba74 \uc644\ub8cc\ub3fc\uc694' });
      }
      if (v === 'kq.done') return R({ screen: await questSheet(DB, pid, cid, 'p'), cid, notice: '\ubd80\ubaa8\ub2d8\uc774 \uc644\ub8cc\ub97c \ub204\ub974\uace0 \uc790\ub140\uac00 \ud655\uc778\ud574\uc694' });      // \uc61b \uc571 \ud638\ud658
      // \uc7a5\uc18c \ub4f1\ub85d(\uc9c0\ub3c4\ub97c 3\ucd08 \ub204\ub974\uba74 \uc0c8 \uc7a5\uc18c \u00b7 \ud540\uc744 \ub204\ub974\uba74 \uace0\uce58\uae30)
      if (v === 'kpl.new') {
        const [la, lo] = String(t).split(',').map(Number);
        if (!(la >= -85 && la <= 85 && lo >= -180 && lo <= 180) || (!la && !lo)) return bad('\uc704\uce58\uac00 \ub9de\uc9c0 \uc54a\uc544\uc694');
        if (((await DB.prepare('SELECT COUNT(*) n FROM places WHERE cid=?').bind(cid).first()) || { n: 0 }).n >= MAX_PLACES) return R({ notice: '\uc7a5\uc18c\ub294 ' + MAX_PLACES + '\uacf3\uae4c\uc9c0 \ub4f1\ub85d\ud560 \uc218 \uc788\uc5b4\uc694' });
        await newDraft(DB, pid, cid, la, lo, now);
        return R({ screen: placeSheet({ pid, cid, pl: '', la, lo, name: '', hh: 16, mm: 0, days: 31 }, false), cid, sheet: 'place', haptic: 1 });          // \ubc29\uae08 \ub9cc\ub4e0 \ucd08\uc548 \uac12\uc744 \uadf8\ub300\ub85c \uadf8\ub9b0\ub2e4(\ub2e4\uc2dc \uc77d\uc9c0 \uc54a\ub294\ub2e4)
      }
      if (v.startsWith('kp.')) {
        const pl = await DB.prepare('SELECT * FROM places WHERE id=? AND cid=?').bind(v.slice(3), cid).first();
        if (!pl) return R({ notice: '\uc5c6\ub294 \uc7a5\uc18c\uc608\uc694' });
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
          return R({ close: true, hub: 1, notice: '\uc7a5\uc18c\ub97c \uc9c0\uc6e0\uc5b4\uc694' });
        } else if (v === 'kpl.save') {
          // \uc571\uc774 \uc2dc\uac01 \u00b7 \uc694\uc77c\uc744 \ud31d\uc5c5 \uc548\uc5d0\uc11c \ubc14\ub85c \uace0\uce58\uace0 \uc800\uc7a5\ud560 \ub54c \ud568\uaed8 \ubcf4\ub0b8\ub2e4(kpm=\ubd84 0~1439 \u00b7 kpd=\uc694\uc77c \ube44\ud2b8 0~127). \uc5c6\uc73c\uba74 \uc11c\ubc84 \ucd08\uc548 \uac12.
          const km = Number(f.kpm), kd = Number(f.kpd), dd = Object.assign({}, d);
          if (f.kpm !== undefined && Number.isInteger(km) && km >= 0 && km < 1440) { dd.hh = Math.floor(km / 60); dd.mm = km % 60; }
          if (f.kpd !== undefined && Number.isInteger(kd) && kd >= 0 && kd < 128) dd.days = kd;
          if (!name) { await DB.prepare('UPDATE drafts SET name=?,hh=?,mm=?,days=? WHERE pid=?').bind('', dd.hh, dd.mm, dd.days, pid).run(); return R({ screen: placeSheet(Object.assign({}, dd, { name: '' }), !!d.pl, '\uc7a5\uc18c \uc774\ub984\uc744 \uc801\uc5b4 \uc8fc\uc138\uc694'), cid }); }
          if (d.pl) await DB.prepare('UPDATE places SET name=?,la=?,lo=?,hh=?,mm=?,days=? WHERE id=? AND cid=?').bind(name, dd.la, dd.lo, dd.hh, dd.mm, dd.days, d.pl, cid).run();
          else await DB.prepare('INSERT INTO places(id,cid,name,la,lo,hh,mm,days,t) VALUES(?,?,?,?,?,?,?,?,?)').bind(rid(), cid, name, dd.la, dd.lo, dd.hh, dd.mm, dd.days, now).run();
          await DB.prepare('DELETE FROM drafts WHERE pid=?').bind(pid).run();
          plCache.delete(cid);
          await tripsSync(DB, cid, now);
          await bump(DB, cid);
          return R({ close: true, hub: 1, notice: name + ' \uc77c\uc815\uc744 \uc800\uc7a5\ud588\uc5b4\uc694' });
        }
        return R({ screen: placeSheet(await readDraft(DB, pid), !!d.pl), cid });
      }
      if (v.startsWith('kc.') && kids.some((k) => k.cid === v.slice(3))) return R({ screen: await hubScreen(DB, pid, v.slice(3), now), cid: v.slice(3) });   // \uc790\ub140 \uce69
      return bad('\uc5c6\ub294 \ud589\ub3d9\uc774\uc5d0\uc694', 404);
    }
    const cid = body.cid || url.searchParams.get('cid');
    if (!okId(cid) || !(await isLinked(DB, cid, pid))) return bad('\uc5f0\uacb0\ub418\uc9c0 \uc54a\uc740 \uc790\ub140\uc608\uc694', 403);
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
      if (!x) return bad('\ub0b4\uc6a9\uc774 \uc5c6\uc5b4\uc694');
      await prune(DB, cid, now);
      const pn_ = await pnOf(DB, pid); await DB.prepare('INSERT INTO chat(cid,f,x,t,pn) VALUES(?,?,?,?,?)').bind(cid, 'p', x, now, pn_).run();
      await bump(DB, cid);
      later(notifyChild(env, DB, cid, { k: 'chat', title: pn_ || '\ubd80\ubaa8\ub2d8', body: cut(x, 80), tag: 'chat' }));
      return J({ ok: true });
    }
    if (p === '/p/quests' && m === 'GET') {       // s: \uc790\ub140 \ubbf8\uc158(k=c) 0 \ub300\uae30 \u00b7 1 \uc790\ub140\uac00 \ud574\ub0c8\ub2e4\uace0 \uc54c\ub9bc(\ud655\uc778 \ud544\uc694) \u00b7 2 \ud655\uc778\ud568 / \ubd80\ubaa8\ub2d8 \ubbf8\uc158(k=p) 0 \ub300\uae30 \u00b7 1 \ubd80\ubaa8\uac00 \ud574\ub0c8\ub2e4\uace0 \ud45c\uc2dc
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
    return bad('\uc5c6\ub294 \uae38\uc774\uc5d0\uc694', 404);
  }
  return bad('\uc5c6\ub294 \uae38\uc774\uc5d0\uc694', 404);
}

export default {
  async scheduled(event, env, ctx) {
    CTX = ctx;
    ctx.waitUntil(cron(env).catch(() => {}));
  },
  async fetch(req, env, ctx) {
    CTX = ctx;
    try {
      return await handle(req, env, new URL(req.url));
    } catch (e) {
      return J({ ok: false, err: 'server', msg: String((e && e.message) || e).slice(0, 200) }, 500);
    }
  },
};
