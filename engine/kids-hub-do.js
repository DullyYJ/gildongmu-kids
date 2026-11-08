// 길동무 패밀리 · 실시간 깨우기 허브(Durable Object, s425) — 별도 워커 'gildongmu-kids-hub' 로 한 번 배포한다(wrangler.hub.toml).
// 가족구성원(가족)마다 하나. 하는 일은 단 하나: 바뀌었다는 신호(/bump)를 받으면 기다리는 요청(/wait)들을 곧바로 깨운다.
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
    try { if (state && state.setWebSocketAutoResponse && typeof WebSocketRequestResponsePair !== 'undefined') state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) { /* 자동 응답이 없어도 초인종은 동작한다 */ }
  }
  // s426: WebSocket 초인종 — 앱이 연결을 붙들고 있어도 이 객체는 잠든다(절전 연결: 요금은 '깨어 있는 시간' 기준). 바뀌었다는 신호가 오면 연결된 앱들에게 {r:rev} 한 줄만 보낸다. 내용은 보내지 않는다 — 앱이 곧바로 평소 요청으로 새 화면을 받아 간다.
  ring() {
    let n = 0;
    try { for (const w of this.state.getWebSockets()) { try { w.send('{"r":' + this.known + '}'); n++; } catch (e) { /* 이미 끊긴 연결 */ } } } catch (e) { /* 절전 연결을 지원하지 않는 곳(시험) */ }
    return n;
  }
  webSocketMessage() { /* 앱이 보내는 건 없다(ping 은 자동 응답) */ }
  webSocketClose(ws, code) { try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, 'bye'); } catch (e) { /* 이미 닫힘 */ } }
  webSocketError(ws) { try { ws.close(1011, 'err'); } catch (e) { /* 이미 닫힘 */ } }
  wake() { const a = [...this.w]; this.w.clear(); for (const f of a) f(); }
  async fetch(req) {
    const u = new URL(req.url), p = u.pathname;
    if (p === '/bump') {                                     // 본 엔진이 D1 의 rev 를 올린 직후 알린다(rev = 올라간 값)
      const r = Math.floor(+u.searchParams.get('rev')) || 0;
      this.known = r > this.known ? r : this.known + 1;
      this.at = Date.now();
      this.wake();
      const rung = this.ring();
      return J({ ok: true, rev: this.known, rung });
    }
    if (p === '/ws') {                                       // s426: 앱의 WebSocket 연결을 받는다(본 엔진이 인증을 마친 뒤에만 여기로 넘긴다)
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const pair = new WebSocketPair(), cl = pair[0], sv = pair[1];
      this.state.acceptWebSocket(sv);
      try { sv.send('{"hi":1}'); } catch (e) { /* 곧 끊기면 앱이 다시 건다 */ }
      return new Response(null, { status: 101, webSocket: cl });
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
