// 길동무 키즈 · 실시간 깨우기 허브(Durable Object, s425) — 별도 워커 'gildongmu-kids-hub' 로 한 번 배포한다(wrangler.hub.toml).
// 자녀(가족)마다 하나. 하는 일은 단 하나: 바뀌었다는 신호(/bump)를 받으면 기다리는 요청(/wait)들을 곧바로 깨운다.
// DB 를 읽지 않는다 — 기다리는 동안 DB 를 0.6초마다 읽던 것을 없애려는 것. 판단 · 저장은 모두 본 엔진(kids-worker)과 D1 이 하고, 여기는 신호만 전한다.
// 이 허브가 없거나 죽어도 본 엔진은 예전 방식(DB 를 보며 기다림)으로 그대로 돈다.
const J = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
const FRESH_MS = 10000;          // 방금 바뀐 신호만 '이미 바뀌었다' 로 믿는다(옛 신호가 남아 계속 즉시 돌려주는 일 방지)

export class FamHub {
  constructor(state) {
    this.state = state;
    this.known = 0;             // 마지막으로 안 rev(본 엔진 D1 의 값)
    this.at = 0;                // 마지막으로 바뀐 신호를 받은 시각
    this.w = new Set();         // 기다리는 요청들의 깨우기 함수
  }
  wake() { const a = [...this.w]; this.w.clear(); for (const f of a) f(); }
  async fetch(req) {
    const u = new URL(req.url), p = u.pathname;
    if (p === '/bump') {                                     // 본 엔진이 D1 의 rev 를 올린 직후 알린다(rev = 올라간 값)
      const r = Math.floor(+u.searchParams.get('rev')) || 0;
      this.known = r > this.known ? r : this.known + 1;
      this.at = Date.now();
      this.wake();
      return J({ ok: true, rev: this.known });
    }
    if (p === '/wait') {                                     // rev = 기다리는 쪽이 아는 값, ms = 최대 기다림
      const n = Math.floor(+u.searchParams.get('rev')) || 0, ms = Math.max(0, Math.min(25000, Math.floor(+u.searchParams.get('ms')) || 0));
      if (n > this.known) this.known = n;
      if (this.known > n && Date.now() - this.at < FRESH_MS) return J({ ok: true, rev: this.known, woke: 1 });
      await new Promise((res) => {
        let done = false, tm = null;
        const fin = () => { if (done) return; done = true; clearTimeout(tm); this.w.delete(fin); res(); };
        tm = setTimeout(fin, ms);
        this.w.add(fin);
      });
      return J({ ok: true, rev: this.known, woke: this.known > n ? 1 : 0 });
    }
    return J({ ok: true, name: 'gildongmu-kids-hub' });
  }
}
export default { fetch() { return new Response('gildongmu-kids-hub', { status: 200 }); } };
