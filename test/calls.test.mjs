// 긴급 호출(sos) · 안전하게 도착(arr) · 데리러 와줘(pick) 시험(s399)
// 실행: node --no-warnings test/calls.test.mjs
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


const sum = () => JSON.stringify;
const hubTxt = async () => JSON.stringify((await hubOf()).screen);
const pk = (k, from) => pushes.slice(from).filter((p) => p.data.k === k && p.token === PTK);

// ── 연결만 하고 확인 전: 긴급 호출 알림은 가도 위치는 안 보인다 ──
let a = pushes.length;
const s0 = await req('POST', '/c/call', 'c', { k: 'sos', la: 37.5, lo: 126.84 });
chk(s0.ok && s0.id && s0.linked === 1, '긴급 호출을 서버가 받는다');
const p0 = pk('sos', a);
chk(p0.length === 1 && /긴급 호출/.test(p0[0].data.title + p0[0].data.body) && !/37\.5|126\.8/.test(JSON.stringify(p0[0].data)), '확인 전인 부모에게도 긴급 알림이 간다(알림 글에 좌표는 없다)');
chk(p0.length === 1 && p0[0].data.la === undefined && p0[0].data.lo === undefined, '푸시 값에는 좌표가 없다(지도는 허브 응답으로만)');
const h0 = await hubOf();
chk(/kg\.ok/.test(JSON.stringify(h0.screen)) && !/kx\.ack/.test(JSON.stringify(h0.screen)), '확인 전에는 지도도 호출 카드도 안 보인다(보호자 확인이 먼저)');
await req('POST', '/p/act', 'p', { v: 'kg.ok', cid: CID });

// ── 확인 뒤: 카드 + 지도 핀 ──
const h1 = await hubOf(), t1 = JSON.stringify(h1.screen);
chk(/긴급 호출/.test(t1) && /kx\.open/.test(t1), '부모 화면 맨 위에 긴급 호출 줄(누르면 팝업)이 나온다');
chk(h1.pop && h1.pop.k === 'sos' && h1.pop.ka === 'kx.ack' && h1.pop.bt === '확인 완료' && h1.pop.au === 1 && /긴급 호출/.test(h1.pop.pt), '엔진이 호출 팝업(제목 · 단추 · 저절로 뜸)을 응답에 실어 준다(s415)');
const tm = h1.screen.head.find((n) => n.t === 'tmap');
const sosPin = tm.pts.findIndex((q) => q.n === '!');
chk(sosPin >= 0 && Math.abs(tm.pts[sosPin].la - 37.5) < 1e-6 && tm.foc === sosPin, '지도에 긴급 위치가 찍히고 거기로 맞춰진다');
chk(h1.screen.head[0].t === 'panel', '카드가 화면 맨 위다');
chk(tm.pts[sosPin].v === 'kx.o.' + s0.id, '긴급 마커를 누르면 그 호출의 확인 팝업(kx.o.<호출>)이 열린다');
chk(h1.pop.la === 37.5 && h1.pop.lo === 126.84 && h1.pop.mp === '긴급', '허브 응답의 팝업에는 지도용 좌표가 실린다(법정대리인 확인 뒤에만)');
const pkOpen = await req('POST', '/p/act', 'p', { v: 'kx.o.' + s0.id, cid: CID });
chk(pkOpen.ok && pkOpen.pop && pkOpen.pop.ci === s0.id && pkOpen.pop.la === 37.5 && pkOpen.pop.bt === '확인 완료' && pkOpen.pop.ka === 'kx.ack', '마커를 눌러 연 팝업: 좌표 + "확인 완료" 단추');
chk(rows("SELECT * FROM evs WHERE k='sos'").length === 1, '"뭐하니?" 활동에 긴급 호출이 남는다');

// ── 되풀이 방지 ──
a = pushes.length;
NOW += 20 * SEC;
const s1 = await req('POST', '/c/call', 'c', { k: 'sos' });
chk(s1.dup === 1 && s1.id === s0.id && pk('sos', a).length === 0 && rows("SELECT * FROM calls WHERE k='sos'").length === 1, '60초 안에 또 눌러도 새 알림 · 새 기록이 없다');
NOW += 50 * SEC;
const s2 = await req('POST', '/c/call', 'c', { k: 'sos' });
chk(s2.id === s0.id && pk('sos', a).length === 1 && rows("SELECT * FROM calls WHERE k='sos'").length === 1, '60초가 지나 또 누르면 같은 카드를 새로 올리고 다시 알린다(카드가 늘지 않는다)');

// ── 부모 확인 → 가족구성원에게 알림 ──
a = pushes.length;
const ack = await req('POST', '/p/act', 'p', { v: 'kx.ack', cid: CID, t: s2.id });
const h2 = await hubOf();
chk(ack.ok && ack.hub === 1 && h2.pop && h2.pop.ka === 'kx.done' && h2.pop.bt === '상황이 끝났어요' && h2.pop.au === 0, '확인했어요 → 팝업이 "상황이 끝났어요" 로 바뀌고 저절로는 안 뜬다(s415)');
chk(!h2.screen.head.find((n) => n.t === 'tmap').pts.some((q) => q.n === '!'), '"확인 완료" 뒤에는 지도에서 긴급 마커가 사라진다');
chk(h2.pop && h2.pop.la === 37.5, '확인 뒤에도 호출 줄 팝업(상황이 끝났어요)에는 위치가 있어 지도를 보인다');
const cp = pushes.slice(a).filter((p) => p.data.k === 'callack' && p.token === CTK);
chk(cp.length === 1 && /확인했어요/.test(cp[0].data.body), '가족구성원 폰에 "부모님이 확인했어요" 가 간다');
const cs = await req('GET', '/c/state', 'c');
chk(cs.call && cs.call.k === 'sos' && cs.call.st === 1 && /확인했어요/.test(cs.call.text), '가족구성원 상태에 부모가 확인했다는 글이 있다');
const ack2 = await req('POST', '/p/act', 'p', { v: 'kx.ack', cid: CID, t: s2.id });
chk(ack2.ok && pushes.slice(a).filter((p) => p.data.k === 'callack').length === 1, '이미 확인한 것을 또 눌러도 가족구성원에게 또 가지 않는다');
a = pushes.length;
const dn = await req('POST', '/p/act', 'p', { v: 'kx.done', cid: CID, t: s2.id });
chk(dn.ok && dn.hub === 1 && !dn.screen, '만났어요/끝났어요는 화면을 다시 짜지 않고 바로 답한다(앱이 누르자마자 팝업을 닫는다, s415)');
const dp = pushes.slice(a).filter((p) => p.data.k === 'calldone' && p.token === CTK);
chk(dp.length === 1 && /끝났다고/.test(dp[0].data.body), '끝났어요 → 가족구성원 폰에도 알림이 간다(s415)');
const after = await hubTxt();
chk(!/kx\.done|kx\.ack/.test(after), '끝났어요 하면 그 호출 카드가 사라진다');
chk(rows("SELECT st FROM calls WHERE id=?", s2.id)[0].st === 3, '기록은 끝남(3)으로 바뀐다');

// ── 취소 ──
a = pushes.length;
NOW += 2 * MIN;
const s3 = await req('POST', '/c/call', 'c', { k: 'sos' });
chk(s3.ok && !s3.dup && s3.id !== s2.id, '끝난 뒤 새 긴급 호출은 새 카드로 받는다');
const cx = await req('POST', '/c/call', 'c', { k: 'sos', op: 'cancel' });
chk(cx.ok && rows('SELECT st FROM calls WHERE id=?', s3.id)[0].st === 2 && pk('callx', a).length === 1 && /취소/.test(pk('callx', a)[0].data.body), '가족구성원이 취소하면 부모에게 "취소했어요" 가 간다');
const s4 = await req('POST', '/c/call', 'c', { k: 'sos' });
chk(s4.ok && !s4.dup && s4.id !== s3.id, '취소한 직후 다시 누르면 곧바로 새로 받는다(60초를 기다리지 않는다)');

// ── 데리러 와줘 · 안전하게 도착 ──
await req('POST', '/p/act', 'p', { v: 'kx.done', cid: CID, t: s4.id });      // (ack 없이 done 은 무시)
await req('POST', '/p/act', 'p', { v: 'kx.ack', cid: CID, t: s4.id }); await req('POST', '/p/act', 'p', { v: 'kx.done', cid: CID, t: s4.id });
await req('POST', '/p/act', 'p', { v: 'kpg.open', cid: CID });
// 등록 장소: 가족구성원 위치 바로 옆
await req('POST', '/p/act', 'p', { v: 'kpg.add', cid: CID, f: { kpn: '학원' } });
a = pushes.length;
const pc = await req('POST', '/c/call', 'c', { k: 'pick', la: 37.5, lo: 126.84 });
const pp = pk('pick', a);
chk(pc.ok && pp.length === 1 && /데리러/.test(pp[0].data.body) && /학원 근처/.test(pp[0].data.body), '데리러 와줘: 등록한 장소 이름이 알림에 들어간다(서버가 계산)');
const hp = await hubOf(); const tp = JSON.stringify(hp.screen);
chk(/데리러 와 달라고/.test(tp) && hp.pop && /데리러 와 달라고/.test(hp.pop.pt) && hp.pop.bt === '지금 가요' && hp.pop.ka === 'kx.ack', '부모 줄 + 팝업: "데리러 와 달라고 해요" + "지금 가요"');
chk(pp[0].data.ka === 'kx.ack' && pp[0].data.ci === pc.id && pp[0].data.bt === '지금 가요' && /데리러/.test(pp[0].data.pt) && pp[0].data.pk.startsWith(pc.id + ':0:'), '푸시에도 같은 팝업 값이 실려 가족 탭 밖에서도 팝업이 뜬다(s415)');
a = pushes.length;
await req('POST', '/p/act', 'p', { v: 'kx.ack', cid: CID, t: pc.id });
const pcs = pushes.slice(a).filter((p) => p.data.k === 'callack');
chk(pcs.length === 1 && /데리러 가고 있어요/.test(pcs[0].data.body), '"지금 가요" → 가족구성원에게 "부모님이 데리러 가고 있어요"');
a = pushes.length;
const ar = await req('POST', '/c/call', 'c', { k: 'arr', la: 37.5, lo: 126.84 });
const ap = pk('arr', a);
chk(ap.length === 1 && ap[0].data.ka === '' && ap[0].data.bt === '확인' && /안전하게 도착/.test(ap[0].data.pt), '안전 도착 푸시에도 팝업 값(확인 단추만)이 실린다(s415)');
chk(ar.ok && ap.length === 1 && /안전하게 도착/.test(ap[0].data.body) && /학원/.test(ap[0].data.body), '안전하게 도착: 부모에게 알림(장소 이름 포함)');
chk(rows("SELECT la,lo FROM calls WHERE id=?", ar.id)[0].la === 0 && rows("SELECT la,lo FROM calls WHERE id=?", ar.id)[0].lo === 0, '도착 기록에는 좌표를 남기지 않는다');
chk(!/안전하게 도착/.test(JSON.stringify((await hubOf()).screen.head)), '도착 알림은 맨 위 카드가 되지 않는다(활동 줄에만 남는다)');
chk(/안전하게 도착했다고 알렸어요/.test(await hubTxt()), '"뭐하니?" 활동에 도착이 남는다');
const arDup = await req('POST', '/c/call', 'c', { k: 'arr' });
chk(arDup.dup === 1, '도착을 2분 안에 또 눌러도 알림이 또 가지 않는다');

// ── 위치 없이 · 잘못된 입력 · 연결 없음 ──
const bad1 = await req('POST', '/c/call', 'c', { k: 'zzz' });
chk(bad1.ok === false || bad1.err, '모르는 종류는 받지 않는다');
const bad2 = await req('POST', '/c/call', 'c', { k: 'arr', op: 'cancel' });
chk(bad2.ok === false || bad2.err, '도착은 취소 대상이 아니다');

// ── 보관 · 해제 ──
NOW += 8 * DAY;
await mod.scheduled({}, env, ctx); await flush();
chk(rows('SELECT * FROM calls').length === 0, '7일이 지나면 크론이 호출 기록(좌표)을 지운다');
await req('POST', '/c/call', 'c', { k: 'pick', la: 37.5, lo: 126.84 });
await req('POST', '/c/unlink', 'c', {});
chk(rows('SELECT * FROM calls').length === 0, '가족구성원이 연결을 끊으면 호출 기록도 지워진다');
const lone = await req('POST', '/c/call', 'c', { k: 'sos' });
chk(lone.ok && lone.linked === 0 && rows('SELECT * FROM calls').length === 0, '연결된 부모가 없으면 기록도 알림도 없다(가족구성원에게는 linked:0 으로 알린다)');

console.log(ok + ' 통과, ' + bad + ' 실패');
process.exit(bad ? 1 : 0);
