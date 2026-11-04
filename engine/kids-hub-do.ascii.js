// \uae38\ub3d9\ubb34 \ud0a4\uc988 \u00b7 \uc2e4\uc2dc\uac04 \uae68\uc6b0\uae30 \ud5c8\ube0c(Durable Object, s425) \u2014 \ubcc4\ub3c4 \uc6cc\ucee4 'gildongmu-kids-hub' \ub85c \ud55c \ubc88 \ubc30\ud3ec\ud55c\ub2e4(wrangler.hub.toml).
// \uc790\ub140(\uac00\uc871)\ub9c8\ub2e4 \ud558\ub098. \ud558\ub294 \uc77c\uc740 \ub2e8 \ud558\ub098: \ubc14\ub00c\uc5c8\ub2e4\ub294 \uc2e0\ud638(/bump)\ub97c \ubc1b\uc73c\uba74 \uae30\ub2e4\ub9ac\ub294 \uc694\uccad(/wait)\ub4e4\uc744 \uace7\ubc14\ub85c \uae68\uc6b4\ub2e4.
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
  }
  wake() { const a = [...this.w]; this.w.clear(); for (const f of a) f(); }
  async fetch(req) {
    const u = new URL(req.url), p = u.pathname;
    if (p === '/bump') {                                     // \ubcf8 \uc5d4\uc9c4\uc774 D1 \uc758 rev \ub97c \uc62c\ub9b0 \uc9c1\ud6c4 \uc54c\ub9b0\ub2e4(rev = \uc62c\ub77c\uac04 \uac12)
      const r = Math.floor(+u.searchParams.get('rev')) || 0;
      this.known = r > this.known ? r : this.known + 1;
      this.at = Date.now();
      this.wake();
      return J({ ok: true, rev: this.known });
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
