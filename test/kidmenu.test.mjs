// 설정 > 길동무 패밀리 팝업(s416): 새 앱은 설정에 '길동무 패밀리' 줄 하나 → 팝업(시작 화면 · 응원문구 · 마커 변경 · 연동 관리), 옛 앱은 예전 줄 그대로 + 가족구성원 마커 사진 열쇠
// 실행: node --no-warnings test/kidmenu.test.mjs
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
const MIN = 60000;
let NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
Date.now = () => NOW;
let pend = [];
const ctx = { waitUntil: (p) => { pend.push(p); } };
const flush = async () => { await Promise.all(pend); pend = []; };
const CID = 'child000001', PID = 'parent00001', CS = 'c'.repeat(20), PS = 'p'.repeat(20);
const req = async (method, path, who, body) => {
  const h = { 'content-type': 'application/json' };
  if (who === 'c') { h['x-id'] = CID; h['x-sec'] = CS; } else if (who === 'p') { h['x-id'] = PID; h['x-sec'] = PS; }
  const r = await mod.fetch(new Request('https://k.test' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const j = await r.json(); await flush(); return j;
};
await req('POST', '/reg', null, { id: CID, sec: CS, role: 'c' });
await req('POST', '/reg', null, { id: PID, sec: PS, role: 'p' });
const pr = await req('POST', '/c/pair', 'c', {});
await req('POST', '/p/join', 'p', { code: pr.code, nm: '쭈르' });
await req('POST', '/c/ft', 'c', { tk: 'child-token-1234567890abcdef' });


const flat = (ns, out = []) => { for (const n of ns || []) { out.push(n); if (n.kids) flat(n.kids, out); } return out; };
const acts = (sc) => flat(sc.body).filter((n) => n.act).map((n) => n.act.v);

// 설정 줄: kn=1(새 앱) → 줄 하나, 없으면(옛 앱) 예전 그대로
let s0 = await req('GET', '/p/setrow', 'p');
chk(s0.ok && !acts({ body: s0.nodes }).includes('kn.open') && acts({ body: s0.nodes }).includes('kl.open') && acts({ body: s0.nodes }).includes('kh.cheer') && flat(s0.nodes).some((n) => n.t === 'toggle' && n.key === 'kidsHome'), '옛 앱(kn 없음): 예전 줄 · 시작 화면 스위치 · 응원문구 그대로');
let s1 = await req('GET', '/p/setrow?kn=1', 'p');
chk(s1.ok && s1.nodes.length === 1 && acts({ body: s1.nodes }).join() === 'kn.open' && !flat(s1.nodes).some((n) => n.t === 'toggle'), '새 앱(kn=1): "길동무 패밀리" 줄 하나뿐, 누르면 kn.open');

// 팝업
let m = await req('POST', '/p/act', 'p', { v: 'kn.open' });
chk(m.ok && m.screen && m.screen.screen === 'kidmenu' && m.screen.dlg, '팝업: kidmenu 가운데 팝업');
chk(flat(m.screen.body).some((n) => n.t === 'toggle' && n.key === 'kidsHome' && n.on === false), '팝업: 가족 화면으로 시작 알약(꺼짐)');
chk(['kh.cheer', 'km.open', 'kl.open', 'kl.close'].every((v) => acts(m.screen).includes(v)), '팝업: 응원문구 · 마커 변경 · 연동 관리 · 닫기');
await req('POST', '/p/act', 'p', { v: 'kl.start', t: '1' });
m = await req('POST', '/p/act', 'p', { v: 'kn.open' });
chk(flat(m.screen.body).some((n) => n.t === 'toggle' && n.key === 'kidsHome' && n.on === true), '알약을 켜면 팝업이 켜진 모양으로');

// 마커 변경 팝업
let mk = await req('POST', '/p/act', 'p', { v: 'km.open' });
chk(mk.ok && mk.screen.screen === 'kidmk' && mk.screen.dlg, '마커 변경: kidmk 가운데 팝업');
const pick = flat(mk.screen.body).find((n) => n.act && n.act.v === 'km.pick'), clr = flat(mk.screen.body).find((n) => n.act && n.act.v === 'km.clr');
chk(pick && clr && pick.act.id === CID && clr.act.id === CID && pick.s === '사진 고르기' && clr.s === '기본으로', '마커 변경: 가족구성원마다 [사진 고르기] [기본으로] (가족구성원 열쇠를 싣는다)');
chk(acts(mk.screen).includes('kn.open') && acts(mk.screen).includes('kl.close'), '마커 변경: 뒤로(팝업) · 닫기');
let ch = await req('POST', '/p/act', 'p', { v: 'kh.cheer' });
chk(acts(ch.screen).includes('kn.open'), '응원문구 팝업에서도 뒤로(길동무 패밀리)로 돌아간다');

// 지도 핀: 가족구성원 마커에 사진 열쇠(g)
await req('POST', '/p/act', 'p', { v: 'kg.ok', cid: CID });
await req('POST', '/c/loc', 'c', { la: 37.5, lo: 127.0, acc: 20 });
const sc = await req('GET', '/p/screen?v=hub&cid=' + CID, 'p');
const tm = flat([...(sc.screen.head || []), ...(sc.screen.body || [])]).find((n) => n.t === 'tmap');
const me = tm && (tm.pts || []).find((p) => p.k === 'm');
chk(me && me.g === 'kid.' + CID && /^kid\.[A-Za-z0-9_-]{1,34}$/.test(me.g), '허브 지도: 가족구성원 마커 핀에 사진 열쇠 kid.<가족구성원열쇠> (' + (me && me.g) + ')');

// 허브 상태 줄: 위치를 받은 때(한국시간) "(00월00일00시00분 기준)"
const stl = flat(sc.screen.body.concat(sc.screen.head || [])).filter((n) => n.t === 'text').map((n) => n.s);
chk(stl.some((x) => /위치: .*\(\d\d월\d\d일\d\d시\d\d분 기준\)/.test(x)), '허브: 가족구성원 위치 줄에 (00월00일00시00분 기준) — ' + (stl.find((x) => /위치:/.test(x)) || ''));

console.log(`${ok} 통과, ${bad} 실패`);
process.exit(bad ? 1 : 0);
