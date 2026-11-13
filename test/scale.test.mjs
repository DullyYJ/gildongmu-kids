// 규모 대비 시험(s424): 서버가 새로 뜰 때의 준비 · 인증 캐시 · 대기 간격 · 크론 일괄 처리가 사람 수에 비례해 늘지 않는지 지킨다
// 실행: node --no-warnings test/scale.test.mjs
import fs from 'fs';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const file = new URL('../engine/kids-worker.js', import.meta.url).pathname;
const src = fs.readFileSync(file, 'utf8');
let ok = 0, bad = 0;
const chk = (c, msg) => { if (c) { ok++; console.log('  ok  ', msg); } else { bad++; console.log('  FAIL', msg); } };

// ── 지키는 장치: migrate 를 고쳤으면 SCHEMA_V 도 올려야 한다(안 올리면 이미 준비된 DB 에서 새 서버가 새 열을 만들지 않는다)
const mg = src.slice(src.indexOf('async function migrate(DB)'), src.indexOf('async function sha('));
const mgSha = crypto.createHash('sha256').update(mg).digest('hex').slice(0, 16);
const SV = (src.match(/const SCHEMA_V = '([^']+)'/) || [])[1];
const KNOWN = { 's431-1': '9a60b091d6ed5e6d', 's431-2': '202309974c97e329', 's453-1': '68360ae098faf083' };
chk(!!SV && KNOWN[SV] !== undefined, 'SCHEMA_V 가 있다: ' + SV);
chk(KNOWN[SV] === mgSha, 'migrate 를 고쳤으면 SCHEMA_V 를 올리고 이 시험의 KNOWN 을 바꾼다(지금 ' + SV + ' = ' + mgSha + ')');

const C = { n: 0 };
function mkD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, params) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { C.n++; const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
    first: async () => { C.n++; return db.prepare(sql).get(...params) || null; },
    all: async () => { C.n++; return { results: db.prepare(sql).all(...params) }; },
  });
  return { prepare: (sql) => stmt(sql, []), batch: async (arr) => { C.n++; db.exec('BEGIN'); try { for (const s of arr) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; }, _db: db };
}
const DB = mkD1();
const env = { DB };
let pend = [];
const ctx = { waitUntil: (p) => { pend.push(p); } };
const flush = async () => { await Promise.all(pend); pend = []; };
const cronRun = async (mod) => { await mod.scheduled({}, env, ctx); await flush(); };
const call = async (mod, path) => (await mod.fetch(new Request('https://k.test' + path), env, ctx)).json();

// 1) 서버가 새로 뜰 때: 처음 한 번만 준비하고, 그 뒤 새로 뜨는 서버는 버전 한 줄만 확인한다
const m1 = (await import(file + '?a')).default;
C.n = 0; await call(m1, '/health');
const first = C.n;
chk(first > 30, '처음 한 번은 표 · 열을 준비한다(' + first + '번)');
C.n = 0; await call(m1, '/health'); await call(m1, '/health');
chk(C.n === 0, '같은 서버는 다시 준비하지 않는다');
const m2 = (await import(file + '?b')).default;       // 서버가 새로 떴다(모듈이 새로 올라옴)
C.n = 0; await call(m2, '/health');
chk(C.n === 1, '새로 뜬 서버는 DB 를 한 번만 부른다(준비 확인) — 예전에는 약 70번 · 지금 ' + C.n + '번');
chk(DB._db.prepare("SELECT v FROM meta WHERE k='schema'").get().v === SV, '준비를 마친 버전이 기록된다');
// 버전이 다르면 다시 준비한다(열을 더한 새 코드가 옛 DB 를 만났을 때)
DB._db.prepare("UPDATE meta SET v='old' WHERE k='schema'").run();
const m3 = (await import(file + '?c')).default;
C.n = 0; await call(m3, '/health');
chk(C.n > 30 && DB._db.prepare("SELECT v FROM meta WHERE k='schema'").get().v === SV, '버전이 다르면 다시 준비하고 새 버전을 기록한다');

// 2) 인증 캐시: 가득 찼을 때 전부 지우지 않는다
chk(/const AUTH_MAX = 20000;/.test(src) && /authOk\.size >= AUTH_MAX/.test(src) && !/authOk\.clear\(\)/.test(src), '인증 캐시는 2만 개까지 · 가득 차면 오래된 1/8 만 지운다');

// 3) 크론: 장소가 있는 가족구성원이 많아도 DB 호출 수가 늘지 않고, 오늘 일정 줄은 예전 규칙(요일 · 30분 전 ~ 2시간) 그대로 만든다
{
  const NOW = Date.UTC(2026, 10, 3, 23, 30, 0);          // 한국 시각 2026-11-04(수) 08:30
  const realNow = Date.now; Date.now = () => NOW;
  const mod = (await import(file + '?cron')).default;
  await call(mod, '/health');
  const db = DB._db;
  const ins = db.prepare('INSERT INTO places(id,cid,name,la,lo,hh,mm,days,t) VALUES(?,?,?,?,?,?,?,?,?)');
  const WED = 1 << 2;                                      // 요일 칸(엔진 규칙): 월0 화1 수2 목3 …
  let expectIn = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const cid = 'kid' + String(i).padStart(6, '0');
    // i%4==0: 8시 45분(30분 전 창 안) · 1: 14시(창 밖) · 2: 6시(2시간 넘게 지남) · 3: 9시지만 목요일만(요일 아님)
    const spec = [[8, 45, 127], [14, 0, 127], [6, 0, 127], [9, 0, 1 << 3]][i % 4];
    ins.run('pl' + i, cid, '학교', 37.5, 127.0, spec[0], spec[1], spec[2], NOW);
    if (i % 4 === 0) expectIn++;
  }
  ins.run('plw', 'kid000000', '학원', 37.5, 127.0, 8, 0, WED, NOW);       // 8시 정각 · 수요일 · 30분 지남 → 창 안
  expectIn++;
  C.n = 0;
  await cronRun(mod);
  const n1 = C.n;
  const tr = db.prepare('SELECT COUNT(*) n FROM trips').get().n;
  chk(tr === expectIn, '오늘 일정 줄은 창 안 · 요일이 맞는 장소만 만든다(' + tr + '/' + expectIn + ')');
  chk(db.prepare('SELECT COUNT(*) n FROM rev').get().n === 100, '새 일정이 생긴 가족구성원의 화면만 깨운다(rev 100명)');
  chk(db.prepare("SELECT COUNT(*) n FROM trips WHERE day<>(SELECT day FROM trips LIMIT 1)").get().n === 0, '모두 오늘 날짜');
  // 가족구성원이 10배로 늘어도 크론의 DB 호출은 그대로(일괄 처리)
  for (let i = N; i < N * 10; i++) ins.run('pl' + i, 'kid' + String(i).padStart(6, '0'), '학교', 37.5, 127.0, 8, 45, 127, NOW);
  db.prepare('DELETE FROM trips').run();
  C.n = 0;
  await cronRun(mod);
  const n2 = C.n;
  chk(n2 <= n1 + 2, '가족구성원 ' + N + '명 → ' + N * 10 + '명: 크론 DB 호출 ' + n1 + '번 → ' + n2 + '번(사람 수와 무관)');
  const again = db.prepare('SELECT COUNT(*) n FROM trips').get().n;
  C.n = 0;
  await cronRun(mod);
  chk(db.prepare('SELECT COUNT(*) n FROM trips').get().n === again, '같은 크론을 또 돌려도 일정 줄이 늘지 않는다');
  chk(C.n < 20, '이미 만든 뒤의 크론은 DB 를 거의 부르지 않는다(' + C.n + '번)');
  Date.now = realNow;
}

// 4) 앱 재시도: 처음 두 번은 예전 그대로, 길게 끊기면 늘리고 흩는다(엔진에서만 무작위)
{
  const en = fs.readFileSync(new URL('../app/src/main/java/com/dullyyj/kids/Engine.java', import.meta.url).pathname, 'utf8');
  chk(/if \(fails <= 2\) return 500L \* Math\.max\(1, fails\);/.test(en) && /Math\.min\(500L << Math\.min\(fails - 1, 6\), 12000L\)/.test(en) && /srnd\.nextInt\(\(int\) \(base \/ 3\) \+ 1\)/.test(en) && /Thread\.sleep\(backoffMs\(fails\)\)/.test(en), '가족구성원 앱: 끊김 재시도 0.5초 · 1초(그대로) → 길게 끊기면 최대 12초까지 늘리고 기기마다 흩는다');
}

console.log('\n' + ok + ' 통과, ' + bad + ' 실패');
process.exit(bad ? 1 : 0);
