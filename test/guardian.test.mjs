// 법정대리인 확인(확인 전에는 가족구성원 위치가 안 보인다) · 위치 제공 기록(제16조: 좌표 없이 일시 · 누가 · 누구) · 가족구성원 동의 기록 시험(s394)
// 실행: node --no-warnings test/guardian.test.mjs
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


const DAY = 86400000;
const hubOf = () => req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
const hasMap = (r) => /"t":"tmap"/.test(JSON.stringify(r.screen));

await req('POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req('POST', '/reg', null, { id: PID, sec: PS, role: 'p' });
const pr = await req('POST', '/c/pair', 'c', {});
await req('POST', '/p/join', 'p', { code: pr.code, nm: '쭈르' });
await req('POST', '/c/ft', 'c', { tk: CTK });
await req('POST', '/p/ft', 'p', { tk: PTK });
await req('POST', '/c/loc', 'c', { la: 37.5, lo: 126.84, acc: 8 });

// ── 확인 전 ──
let a = pushes.length;
const g1 = await hubOf();
chk(g1.ok && g1.screen.screen === 'kidgd' && g1.screen.dlg && g1.screen.dlg.w === 460 && /kg\.ok/.test(JSON.stringify(g1.screen)) && !hasMap(g1), '법정대리인 확인 전에는 확인 팝업(가운데)만 나오고 지도 · 위치가 없다(s415)');
chk(pushes.slice(a).filter((p) => p.data.k === 'watch').length === 0, '확인 전에는 가족구성원 폰에 "보는 중" 푸시도 보내지 않는다');
chk(rows('SELECT * FROM lbs').length === 0, '확인 전에는 위치 제공 기록도 없다(제공한 적이 없다)');
const lc = await req('GET', '/p/loc?cid=' + CID, 'p');
chk(lc.ok && lc.loc === null, '옛 위치 주소(/p/loc)도 확인 전에는 위치를 주지 않는다');
const ch = await req('GET', '/p/children', 'p');
chk(ch.ok && ch.children.length === 1 && ch.children[0].la === null && ch.children[0].lo === null, '옛 가족구성원 목록(/p/children)도 확인 전에는 좌표가 없다');
const rr = await req('POST', '/p/act', 'p', { v: 'kr.open', cid: CID });
chk(rr.ok && rr.close === true && !rr.screen, '지난 길 같은 위치 동작도 확인 전에는 받지 않는다');
const rp = await req('POST', '/p/act', 'p', { v: 'kpg.open', cid: CID });
chk(rp.ok && rp.close === true && rows('SELECT * FROM drafts').length === 0, '장소 등록도 확인 전에는 열리지 않는다');
a = pushes.length;
await req('POST', '/c/share', 'c', { on: 0 });
chk(pushes.slice(a).filter((p) => p.token === PTK).length === 0, '확인 전의 부모에게는 가족구성원 알림도 보내지 않는다');
await req('POST', '/c/share', 'c', { on: 1 });

// ── 확인 ──
NOW += 10 * 1000;
const ok1 = await req('POST', '/p/act', 'p', { v: 'kg.ok', cid: CID });
chk(ok1.ok && ok1.hub === 1 && hasMap(ok1) && rows('SELECT * FROM gd').length === 1 && rows('SELECT * FROM gd')[0].pid === PID, '확인하면 허브가 열리고 확인 기록(누가 · 언제)이 남는다');
a = pushes.length;
const g2 = await hubOf();
chk(!/kg\.ok/.test(JSON.stringify(g2.screen)) && hasMap(g2), '확인한 뒤에는 지도가 나온다');
chk(pushes.slice(a).filter((p) => p.data.k === 'watch' && p.token === CTK).length === 1, '확인한 뒤에야 "보는 중" 푸시가 간다');
const L1 = rows("SELECT * FROM lbs WHERE k='v'");
chk(L1.length === 1 && L1[0].cid === CID && L1[0].pid === PID, '위치를 보여 준 사실이 1건 기록된다(가족구성원 · 부모 · 시각)');
chk(!Object.keys(L1[0]).some((k) => /^(la|lo|acc|x|y)$/.test(k)), '기록에는 좌표가 들어 있지 않다');
NOW += 20 * 1000; await hubOf();
chk(rows("SELECT * FROM lbs WHERE k='v'").length === 1, '1분 안에 다시 보면 기록을 또 쌓지 않는다');
NOW += 70 * 1000; await hubOf();
chk(rows("SELECT * FROM lbs WHERE k='v'").length === 2, '1분이 지난 뒤 다시 보면 새로 기록된다');
const lc2 = await req('GET', '/p/loc?cid=' + CID, 'p');
chk(lc2.ok && lc2.loc && Math.abs(lc2.loc.la - 37.5) < 0.01, '확인 뒤에는 옛 위치 주소도 위치를 준다');

// ── 알림 기록 ──
a = pushes.length;
await req('POST', '/c/share', 'c', { on: 0 });
const nrows = rows("SELECT * FROM lbs WHERE k='n'");
chk(pushes.slice(a).some((p) => p.token === PTK) && nrows.length >= 1 && nrows[0].pid === PID, '부모에게 알림을 보내면 그 사실도 기록된다');

// ── 보관 ──
const mid = rows('SELECT COUNT(*) n FROM lbs')[0].n;
NOW += 100 * DAY;
await mod.scheduled({}, env, ctx); await flush();
chk(rows('SELECT COUNT(*) n FROM lbs')[0].n >= mid, '100일 뒤에도 제공 기록은 남아 있다(6개월 이상 보관)');
NOW += 120 * DAY;
await mod.scheduled({}, env, ctx); await flush();
chk(rows('SELECT COUNT(*) n FROM lbs WHERE t < ?', NOW - 200 * DAY)[0].n === 0, '200일이 지난 제공 기록은 크론이 지운다');

// ── 가족구성원 동의 기록 ──
const c1 = await req('POST', '/c/consent', 'c', { v: 2 });
chk(c1.ok && rows('SELECT * FROM cons')[0].v === 2 && rows('SELECT * FROM cons')[0].cid === CID, '가족구성원 앱의 동의 마침이 기록된다(버전 · 시각)');
const c2 = await req('POST', '/c/consent', 'c', { v: 0 });
chk(c2.ok === false, '이상한 버전은 받지 않는다');

// ── 연결 끊기 ──
await req('POST', '/c/share', 'c', { on: 1 }); await hubOf();
NOW += 2 * 60 * 1000; await hubOf();
const before = rows('SELECT COUNT(*) n FROM lbs')[0].n;
await req('POST', '/c/unlink', 'c', {});
chk(rows('SELECT COUNT(*) n FROM loc')[0].n === 0, '연결을 끊으면 위치는 지워진다');
chk(rows('SELECT COUNT(*) n FROM lbs')[0].n === before && before >= 1, '연결을 끊어도 법에서 정한 제공 기록은 남는다');

console.log(`\n${ok} 통과, ${bad} 실패`);
process.exit(bad ? 1 : 0);
