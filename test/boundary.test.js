// 계산 ↔ 그림 경계 점검(키즈 앱, s388): "계산은 엔진, 앱은 그림만".
//   ① 그림 클래스(뷰·그리기 도우미)는 무작위 · 기기 저장소 · 직접 네트워크 · Engine/Store 호출을 하지 않는다 — 예외는 ALLOW 에 이유와 함께
//   ② 엔진/계산 클래스(Engine · Wardrobe · Art · Dress · Poke · Wander · Kid · Wire/Net)는 android.* 를 모른다(JVM 에서 시험 가능)
//   ③ 앱 어디서든 시드 없는 무작위는 엔진(Engine.java)에서만
//   ④ 장면 패치(kids-patch/*.txt)에는 Math.random / new Random() 이 없다(난수는 장면 코어의 시드 난수 S.rnd())
//   ⑤ ALLOW 에 적은 예외가 이미 사라졌다면 실패 — 예외 목록이 거짓말하지 않게 한다
// 실행: node test/boundary.test.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'app/src/main/java/com/dullyyj/kids'), PATCH = path.join(ROOT, 'app/kids-patch');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, '')).join('\n');
const code = f => strip(fs.readFileSync(path.join(DIR, f), 'utf8'));
const all = fs.readdirSync(DIR).filter(f => f.endsWith('.java'));

const DRAW = ['VillageView', 'AvatarView', 'DressView', 'ThumbView', 'WearDraw', 'TabBar', 'Renderer', 'QuestStars'];
const RULES = {
  random: { re: /Math\.random\(|new (java\.util\.)?Random\(\s*\)/g, why: '무작위' },
  prefs: { re: /SharedPreferences/g, why: '기기 저장소' },
  net: { re: /HttpURLConnection|openConnection\(|new URL\(|\bNet\.|\bWire\.(?!EX)/g, why: '직접 네트워크' },
  logic: { re: /\bCore\.engine\b|\bStore\.|\bnew Engine\(/g, why: '엔진/저장소 직접 호출' },
};
const ALLOW = {
  // 'AvatarView:net' 는 Wire.EX(뒤 스레드 실행기)만 쓰는데 위 정규식이 EX 를 빼므로 필요 없음 — 스프라이트를 assets 에서 읽는 일뿐
};
for (const d of DRAW) {
  if (!all.includes(d + '.java')) { ok(false, d + '.java 가 없다 — DRAW 목록을 갱신하라'); continue; }
  const src = code(d + '.java');
  for (const [k, r] of Object.entries(RULES)) {
    const n = (src.match(r.re) || []).length, a = ALLOW[d + ':' + k];
    ok(n === 0 || (a && n <= a.max), `그림 ${d}: ${r.why} 사용 ${n}곳`);
  }
}
for (const k of Object.keys(ALLOW)) { const [d, r] = k.split(':'); ok((code(d + '.java').match(RULES[r].re) || []).length > 0, `예외 ${k} 가 아직 쓰인다`); }

const PURE = ['Engine', 'Wardrobe', 'Art', 'Dress', 'Poke', 'Wander', 'Kid', 'Pal', 'Wire', 'Net'];
const bad = PURE.filter(c => !all.includes(c + '.java') || /^import (android|androidx)\./m.test(code(c + '.java')) || /\b(Handler|Looper|Context|SharedPreferences)\b/.test(code(c + '.java').replace(/^import .*$/gm, '')));
ok(bad.length === 0, `엔진/계산 클래스 ${PURE.length}개는 android·Handler·Looper·Context·SharedPreferences 를 모른다` + (bad.length ? ' ← ' + bad.join(', ') : ''));

const rb = all.filter(f => f !== 'Engine.java' && (code(f).match(RULES.random.re) || []).length > 0);
ok(rb.length === 0, '시드 없는 무작위는 Engine.java 에서만' + (rb.length ? ' ← ' + rb.join(', ') : ''));
ok((code('Engine.java').match(RULES.random.re) || []).length > 0, '엔진 안의 무작위 예외가 아직 쓰인다(낡은 예외 아님)');

const pt = fs.readdirSync(PATCH).filter(f => f.endsWith('.txt') && f !== 'swaps.txt');
const pb = pt.filter(f => RULES.random.re.test(strip(fs.readFileSync(path.join(PATCH, f), 'utf8'))) || (RULES.random.re.lastIndex = 0, false));
RULES.random.re.lastIndex = 0;
ok(pb.length === 0, `장면 패치 ${pt.length}개에는 시드 없는 무작위가 없다` + (pb.length ? ' ← ' + pb.join(', ') : ''));

// 마을 화면은 뷰가 난수·타이머로 자리를 정하지 않고 엔진 함수(Wander)에 걸은 시간만 건넨다
const vv = code('VillageView.java');
ok(/Wander\.at\(/.test(vv) && !/\.nextFloat\(|\.nextInt\(|\bRandom\b/.test(vv), '마을 화면: 자리·방향·걷는 중은 Wander 가 정하고 뷰는 난수를 안 쓴다');

// 장면이 새로 만들어지면 시간(S.t)이 0 부터 다시 간다 — 장면 시간으로 적어 둔 값은 register 에서 모두 비우고, 화남은 10초를 넘기지 못한다
// (옛 angryUntil 이 남아 아침에 켜면 친구들이 몇십 분 동안 "깨우지 마!" 하던 일 — s390)
const ka = strip(fs.readFileSync(path.join(PATCH, 'KidsActs3.java.txt'), 'utf8'));
const reg = ka.slice(ka.indexOf('static void register(final SceneCore S) {'), ka.indexOf('SceneActs.A_(S, "kstudy"'));
const timeMaps = [...ka.matchAll(/static final HashMap<String, (?:Double|Integer|String)> (\w+) = new HashMap/g)].map(m => m[1]).filter(n => n !== 'STICKY');
const noClear = timeMaps.filter(n => !new RegExp('\\b' + n + '\\.clear\\(\\)').test(reg));
ok(timeMaps.length >= 8 && noClear.length === 0, `장면 패치의 장면 시간 값 ${timeMaps.length}개를 새 장면마다 비운다` + (noClear.length ? ' ← ' + noClear.join(', ') : ''));
ok(/au - S\.t <= ANGRY_SEC/.test(ka) && /angryUntil\.put\(a\.id, S\.t \+ ANGRY_SEC\)/.test(ka), '화남은 건드린 뒤 ANGRY_SEC 를 넘겨 이어지지 않는다(옛 값이 남아도)');

console.log(`\n${pass} 통과, ${fail} 실패`); process.exit(fail ? 1 : 0);
