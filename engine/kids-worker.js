// 길동무 키즈 엔진 — Cloudflare Worker + D1 (바인딩 이름: DB)
// 길동무 엔진(route-v2)과 따로 돌아간다. 자녀 앱은 화면을 받아 그리기만 하고, 계산·저장·판단은 모두 여기서 한다.
// 인증: 요청 머리글 x-id / x-sec (기기가 처음 정한 아이디와 비밀. 서버에는 SHA-256 만 저장).
// 자녀 앱 = 역할 c, 부모(길동무 앱) = 역할 p.
const DAY = 86400000, CHAT_KEEP = 7 * DAY, PAIR_TTL = 10 * 60000, MAX_PARENTS = 4, MAX_TXT = 300, MAX_CHAT = 300, MAX_QUEST = 100;
const KEYS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (m, s) => J({ ok: false, err: m }, s || 400);

let ready = false;
async function init(DB) {
  if (ready) return;
  await DB.batch([
    DB.prepare('CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, role TEXT NOT NULL, sh TEXT NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY, cid TEXT NOT NULL, exp INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS links(cid TEXT NOT NULL, pid TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY(cid, pid))'),
    DB.prepare('CREATE TABLE IF NOT EXISTS loc(cid TEXT PRIMARY KEY, la REAL NOT NULL, lo REAL NOT NULL, acc REAL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS chat(id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, f TEXT NOT NULL, x TEXT NOT NULL, t INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS chat_c ON chat(cid, t)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS quests(id TEXT PRIMARY KEY, cid TEXT NOT NULL, k TEXT NOT NULL, x TEXT NOT NULL, s INTEGER NOT NULL DEFAULT 0, t INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS quests_c ON quests(cid, t)'),
  ]);
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

async function auth(req, DB, role) {
  const id = req.headers.get('x-id'), sec = req.headers.get('x-sec');
  if (!okId(id) || !okSec(sec)) return null;
  const r = await DB.prepare('SELECT sh FROM devices WHERE id=? AND role=?').bind(id, role).first();
  if (!r) return null;
  return r.sh === (await sha(sec)) ? id : null;
}

async function linkedCount(DB, cid) {
  const r = await DB.prepare('SELECT COUNT(*) n FROM links WHERE cid=?').bind(cid).first();
  return r ? r.n : 0;
}
async function isLinked(DB, cid, pid) {
  return !!(await DB.prepare('SELECT 1 x FROM links WHERE cid=? AND pid=?').bind(cid, pid).first());
}

async function prune(DB, cid, now) {
  await DB.batch([
    DB.prepare('DELETE FROM chat WHERE cid=? AND t<?').bind(cid, now - CHAT_KEEP),
    DB.prepare('DELETE FROM chat WHERE cid=? AND id NOT IN (SELECT id FROM chat WHERE cid=? ORDER BY id DESC LIMIT ?)').bind(cid, cid, MAX_CHAT),
    DB.prepare('DELETE FROM quests WHERE cid=? AND id NOT IN (SELECT id FROM quests WHERE cid=? ORDER BY t DESC LIMIT ?)').bind(cid, cid, MAX_QUEST),
    DB.prepare('DELETE FROM codes WHERE exp<?').bind(now),
  ]);
}

// ───────── 화면 (자녀 앱이 그리기만 한다) ─────────
const b = (t, o) => Object.assign({ t }, o || {});
const item = (label, act, on) => b('i', { label, act, on });
function kst(t) {
  const d = new Date(t + 9 * 3600000), h = d.getUTCHours();
  return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + ' ' + (h < 12 ? '오전' : '오후') + ' ' + (h % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

async function chatScreen(DB, cid, now) {
  const rows = (await DB.prepare('SELECT f,x,t FROM chat WHERE cid=? AND t>=? ORDER BY id ASC LIMIT ?').bind(cid, now - CHAT_KEEP, MAX_CHAT).all()).results || [];
  const a = [b('head', { text: '가족대화' })];
  const k1 = [b('text', { text: '글자만 보낼 수 있어요. 대화는 7일이 지나면 지워져요.', sub: '1', tight: '1' })];
  if (!rows.length) k1.push(b('text', { text: '아직 대화가 없어요. 부모님이 연결되면 여기서 이야기할 수 있어요.', sub: '1', tight: '1' }));
  a.push(b('box', { flush: '1', kids: k1 }));
  const k2 = rows.map((m) => b('msg', { text: m.x, me: m.f === 'c' ? '1' : '0', time: kst(m.t) }));
  k2.push(b('input', { hint: '메시지를 입력해요', act: 'chat.send' }));
  a.push(b('box', { fill: '1', flush: '1', kids: k2 }));
  return { mode: 'scroll', bottom: '1', blocks: a };
}

async function questScreen(DB, cid, tab) {
  const rows = (await DB.prepare('SELECT id,k,x,s FROM quests WHERE cid=? ORDER BY t DESC LIMIT ?').bind(cid, MAX_QUEST).all()).results || [];
  const kid = tab !== 'p';
  const nc = rows.filter((q) => q.k !== 'p').length, np = rows.length - nc;
  const a = [b('head', { text: '퀘스트' })];
  a.push(b('chips', { eq: '1', loop: '1', items: [item('자녀 미션 ' + nc, 'quest.tab:c', kid ? '1' : '0'), item('부모님 미션 ' + np, 'quest.tab:p', kid ? '0' : '1')] }));
  a.push(b('text', { text: kid ? '부모님이 길동무 앱에서 보내 주신 미션이에요. 해냈으면 눌러서 알려요.' : '내가 부모님께 보내는 미션이에요. 부모님이 해내면 여기에 표시돼요.', sub: '1' }));
  if (!kid) a.push(b('input', { hint: '부모님께 보낼 미션을 적어요', act: 'quest.send' }));
  let shown = 0;
  for (const q of rows) {
    if ((q.k === 'p') === kid) continue;
    const done = q.s === 1;
    const st = kid ? (done ? '✅ 해냈어요' : '눌러서 해냈다고 알려요') : (done ? '✅ 부모님이 해냈어요' : '⏳ 부모님을 기다리는 중이에요');
    a.push(b('card', { title: q.x, text: st, thumb: '', act: kid && !done ? 'quest.done:' + q.id : '', tone: done ? '0' : '1' }));
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

// ───────── 길 ─────────
async function handle(req, env, url) {
  const DB = env.DB, now = Date.now(), p = url.pathname, m = req.method;
  await init(DB);
  if (p === '/' || p === '/health') return J({ ok: true, name: 'gildongmu-kids', t: now });
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
    if (p === '/c/pair' && m === 'POST') {        // 연결 비밀키(10분)
      let code = '';
      const r = crypto.getRandomValues(new Uint8Array(10));
      for (let i = 0; i < 10; i++) { if (i === 5) code += '-'; code += KEYS[r[i] % KEYS.length]; }
      await DB.batch([DB.prepare('DELETE FROM codes WHERE cid=?').bind(cid), DB.prepare('INSERT INTO codes(code,cid,exp) VALUES(?,?,?)').bind(code, cid, now + PAIR_TTL)]);
      return J({ ok: true, code, exp: now + PAIR_TTL });
    }
    if (p === '/c/loc' && m === 'POST') {         // 위치는 연결된 부모가 있을 때만, 가장 최근 한 건만 저장
      const la = +body.la, lo = +body.lo, acc = +body.acc || 0;
      if (!(la >= -90 && la <= 90 && lo >= -180 && lo <= 180) || (la === 0 && lo === 0)) return bad('위치가 맞지 않아요');
      const n = await linkedCount(DB, cid);
      if (n > 0) await DB.prepare('INSERT INTO loc(cid,la,lo,acc,t) VALUES(?,?,?,?,?) ON CONFLICT(cid) DO UPDATE SET la=excluded.la,lo=excluded.lo,acc=excluded.acc,t=excluded.t').bind(cid, la, lo, acc, now).run();
      return J({ ok: true, linked: n });
    }
    if (p === '/c/unlink' && m === 'POST') {      // 자녀가 모든 연결을 끊는다(위치도 함께 지운다)
      await DB.batch([DB.prepare('DELETE FROM links WHERE cid=?').bind(cid), DB.prepare('DELETE FROM loc WHERE cid=?').bind(cid), DB.prepare('DELETE FROM codes WHERE cid=?').bind(cid)]);
      return J({ ok: true });
    }
    if (p === '/c/state' && m === 'GET') return J({ ok: true, linked: await linkedCount(DB, cid) });
    if (p === '/c/screen' && m === 'GET') {
      const s = await screenOf(DB, cid, url.searchParams.get('tab'), url.searchParams.get('qt'), now);
      return s ? J({ ok: true, screen: s, linked: await linkedCount(DB, cid) }) : bad('없는 화면이에요', 404);
    }
    if (p === '/c/act' && m === 'POST') {         // 눌림 · 보내기를 처리하고 새 화면을 돌려준다
      const v = typeof body.v === 'string' ? body.v : '', arg = txt(body.arg), tab = body.tab, qt = body.qt;
      await prune(DB, cid, now);
      if (v === 'chat.send' && arg) {
        await DB.prepare('INSERT INTO chat(cid,f,x,t) VALUES(?,?,?,?)').bind(cid, 'c', arg, now).run();
      } else if (v === 'quest.send' && arg) {
        await DB.prepare('INSERT INTO quests(id,cid,k,x,s,t) VALUES(?,?,?,?,0,?)').bind(rid(), cid, 'p', arg, now).run();
      } else if (v.startsWith('quest.done:')) {
        await DB.prepare("UPDATE quests SET s=1 WHERE id=? AND cid=? AND k='c'").bind(v.slice(11), cid).run();
      }
      const s = await screenOf(DB, cid, tab, qt, now);
      return J({ ok: true, screen: s, linked: await linkedCount(DB, cid) });
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
      await DB.batch([DB.prepare('INSERT OR IGNORE INTO links(cid,pid,t) VALUES(?,?,?)').bind(row.cid, pid, now), DB.prepare('DELETE FROM codes WHERE code=?').bind(code)]);
      return J({ ok: true, cid: row.cid });
    }
    const pid = await auth(req, DB, 'p');
    if (!pid) return bad('인증이 필요해요', 401);
    if (p === '/p/children' && m === 'GET') {
      const rows = (await DB.prepare('SELECT l.cid cid, o.la la, o.lo lo, o.acc acc, o.t t FROM links l LEFT JOIN loc o ON o.cid=l.cid WHERE l.pid=?').bind(pid).all()).results || [];
      return J({ ok: true, children: rows });
    }
    const cid = body.cid || url.searchParams.get('cid');
    if (!okId(cid) || !(await isLinked(DB, cid, pid))) return bad('연결되지 않은 자녀예요', 403);
    if (p === '/p/loc' && m === 'GET') {
      const r = await DB.prepare('SELECT la,lo,acc,t FROM loc WHERE cid=?').bind(cid).first();
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
      await DB.prepare('INSERT INTO chat(cid,f,x,t) VALUES(?,?,?,?)').bind(cid, 'p', x, now).run();
      return J({ ok: true });
    }
    if (p === '/p/quests' && m === 'GET') {
      const rows = (await DB.prepare('SELECT id,k,x,s,t FROM quests WHERE cid=? ORDER BY t DESC LIMIT ?').bind(cid, MAX_QUEST).all()).results || [];
      return J({ ok: true, quests: rows });
    }
    if (p === '/p/quest' && m === 'POST') {       // 부모가 자녀에게 미션 보내기 (자녀 미션 칸에 나타난다)
      const x = txt(body.x);
      if (!x) return bad('내용이 없어요');
      await prune(DB, cid, now);
      await DB.prepare('INSERT INTO quests(id,cid,k,x,s,t) VALUES(?,?,?,?,0,?)').bind(rid(), cid, 'c', x, now).run();
      return J({ ok: true });
    }
    if (p === '/p/quest/done' && m === 'POST') {  // 자녀가 보낸 미션(부모님 미션)을 부모가 해냈다고 표시
      await DB.prepare("UPDATE quests SET s=1 WHERE id=? AND cid=? AND k='p'").bind(String(body.id || ''), cid).run();
      return J({ ok: true });
    }
    if (p === '/p/unlink' && m === 'POST') {
      await DB.batch([DB.prepare('DELETE FROM links WHERE cid=? AND pid=?').bind(cid, pid)]);
      if ((await linkedCount(DB, cid)) === 0) await DB.prepare('DELETE FROM loc WHERE cid=?').bind(cid).run();
      return J({ ok: true });
    }
    return bad('없는 길이에요', 404);
  }
  return bad('없는 길이에요', 404);
}

export default {
  async fetch(req, env) {
    try {
      return await handle(req, env, new URL(req.url));
    } catch (e) {
      return J({ ok: false, err: 'server', msg: String((e && e.message) || e).slice(0, 200) }, 500);
    }
  },
};
