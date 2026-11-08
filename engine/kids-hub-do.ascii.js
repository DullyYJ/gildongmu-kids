// \uae38\ub3d9\ubb34 \ud328\ubc00\ub9ac \u00b7 \uc2e4\uc2dc\uac04 \uae68\uc6b0\uae30 \ud5c8\ube0c(Durable Object, s425) \u2014 \ubcc4\ub3c4 \uc6cc\ucee4 'gildongmu-kids-hub' \ub85c \ud55c \ubc88 \ubc30\ud3ec\ud55c\ub2e4(wrangler.hub.toml).
// \uac00\uc871\uad6c\uc131\uc6d0(\uac00\uc871)\ub9c8\ub2e4 \ud558\ub098. \ud558\ub294 \uc77c\uc740 \ub2e8 \ud558\ub098: \ubc14\ub00c\uc5c8\ub2e4\ub294 \uc2e0\ud638(/bump)\ub97c \ubc1b\uc73c\uba74 \uae30\ub2e4\ub9ac\ub294 \uc694\uccad(/wait)\ub4e4\uc744 \uace7\ubc14\ub85c \uae68\uc6b4\ub2e4.
// DB \ub97c \uc77d\uc9c0 \uc54a\ub294\ub2e4 \u2014 \uae30\ub2e4\ub9ac\ub294 \ub3d9\uc548 DB \ub97c 0.6\ucd08\ub9c8\ub2e4 \uc77d\ub358 \uac83\uc744 \uc5c6\uc560\ub824\ub294 \uac83. \ud310\ub2e8 \u00b7 \uc800\uc7a5\uc740 \ubaa8\ub450 \ubcf8 \uc5d4\uc9c4(kids-worker)\uacfc D1 \uc774 \ud558\uace0, \uc5ec\uae30\ub294 \uc2e0\ud638\ub9cc \uc804\ud55c\ub2e4.
// \uc774 \ud5c8\ube0c\uac00 \uc5c6\uac70\ub098 \uc8fd\uc5b4\ub3c4 \ubcf8 \uc5d4\uc9c4\uc740 \uc608\uc804 \ubc29\uc2dd(DB \ub97c \ubcf4\uba70 \uae30\ub2e4\ub9bc)\uc73c\ub85c \uadf8\ub300\ub85c \ub3c8\ub2e4.
const J = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
const FRESH_MS = 10000;          // \ubc29\uae08 \ubc14\ub010 \uc2e0\ud638\ub9cc '\uc774\ubbf8 \ubc14\ub00c\uc5c8\ub2e4' \ub85c \ubbff\ub294\ub2e4(\uc61b \uc2e0\ud638\uac00 \ub0a8\uc544 \uacc4\uc18d \uc989\uc2dc \ub3cc\ub824\uc8fc\ub294 \uc77c \ubc29\uc9c0)

export class FamHub {
  constructor(state) {
    this.state = state;
    this.known = 0;             // \ub9c8\uc9c0\ub9c9\uc73c\ub85c \uc548 rev(\ubcf8 \uc5d4\uc9c4 D1 \uc758 \uac12)
    this.at = 0;                // \ub9c8\uc9c0\ub9c9\uc73c\ub85c \ubc14\ub010 \uc2e0\ud638\ub97c \ubc1b\uc740 \uc2dc\uac01
    this.w = new Set();         // \uae30\ub2e4\ub9ac\ub294 \uc694\uccad\ub4e4\uc758 \uae68\uc6b0\uae30 \ud568\uc218
    try { if (state && state.setWebSocketAutoResponse && typeof WebSocketRequestResponsePair !== 'undefined') state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) { /* \uc790\ub3d9 \uc751\ub2f5\uc774 \uc5c6\uc5b4\ub3c4 \ucd08\uc778\uc885\uc740 \ub3d9\uc791\ud55c\ub2e4 */ }
  }
  // s426: WebSocket \ucd08\uc778\uc885 \u2014 \uc571\uc774 \uc5f0\uacb0\uc744 \ubd99\ub4e4\uace0 \uc788\uc5b4\ub3c4 \uc774 \uac1d\uccb4\ub294 \uc7a0\ub4e0\ub2e4(\uc808\uc804 \uc5f0\uacb0: \uc694\uae08\uc740 '\uae68\uc5b4 \uc788\ub294 \uc2dc\uac04' \uae30\uc900). \ubc14\ub00c\uc5c8\ub2e4\ub294 \uc2e0\ud638\uac00 \uc624\uba74 \uc5f0\uacb0\ub41c \uc571\ub4e4\uc5d0\uac8c {r:rev} \ud55c \uc904\ub9cc \ubcf4\ub0b8\ub2e4. \ub0b4\uc6a9\uc740 \ubcf4\ub0b4\uc9c0 \uc54a\ub294\ub2e4 \u2014 \uc571\uc774 \uace7\ubc14\ub85c \ud3c9\uc18c \uc694\uccad\uc73c\ub85c \uc0c8 \ud654\uba74\uc744 \ubc1b\uc544 \uac04\ub2e4.
  ring() {
    let n = 0;
    try { for (const w of this.state.getWebSockets()) { try { w.send('{"r":' + this.known + '}'); n++; } catch (e) { /* \uc774\ubbf8 \ub04a\uae34 \uc5f0\uacb0 */ } } } catch (e) { /* \uc808\uc804 \uc5f0\uacb0\uc744 \uc9c0\uc6d0\ud558\uc9c0 \uc54a\ub294 \uacf3(\uc2dc\ud5d8) */ }
    return n;
  }
  webSocketMessage() { /* \uc571\uc774 \ubcf4\ub0b4\ub294 \uac74 \uc5c6\ub2e4(ping \uc740 \uc790\ub3d9 \uc751\ub2f5) */ }
  webSocketClose(ws, code) { try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, 'bye'); } catch (e) { /* \uc774\ubbf8 \ub2eb\ud798 */ } }
  webSocketError(ws) { try { ws.close(1011, 'err'); } catch (e) { /* \uc774\ubbf8 \ub2eb\ud798 */ } }
  wake() { const a = [...this.w]; this.w.clear(); for (const f of a) f(); }
  async fetch(req) {
    const u = new URL(req.url), p = u.pathname;
    if (p === '/bump') {                                     // \ubcf8 \uc5d4\uc9c4\uc774 D1 \uc758 rev \ub97c \uc62c\ub9b0 \uc9c1\ud6c4 \uc54c\ub9b0\ub2e4(rev = \uc62c\ub77c\uac04 \uac12)
      const r = Math.floor(+u.searchParams.get('rev')) || 0;
      this.known = r > this.known ? r : this.known + 1;
      this.at = Date.now();
      this.wake();
      const rung = this.ring();
      return J({ ok: true, rev: this.known, rung });
    }
    if (p === '/ws') {                                       // s426: \uc571\uc758 WebSocket \uc5f0\uacb0\uc744 \ubc1b\ub294\ub2e4(\ubcf8 \uc5d4\uc9c4\uc774 \uc778\uc99d\uc744 \ub9c8\uce5c \ub4a4\uc5d0\ub9cc \uc5ec\uae30\ub85c \ub118\uae34\ub2e4)
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const pair = new WebSocketPair(), cl = pair[0], sv = pair[1];
      this.state.acceptWebSocket(sv);
      try { sv.send('{"hi":1}'); } catch (e) { /* \uace7 \ub04a\uae30\uba74 \uc571\uc774 \ub2e4\uc2dc \uac74\ub2e4 */ }
      return new Response(null, { status: 101, webSocket: cl });
    }
    if (p === '/wait') {                                     // rev = \uae30\ub2e4\ub9ac\ub294 \ucabd\uc774 \uc544\ub294 \uac12, ms = \ucd5c\ub300 \uae30\ub2e4\ub9bc
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
