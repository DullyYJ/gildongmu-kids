#!/usr/bin/env python3
"""engine/kids-worker.js -> engine/kids-worker.ascii.js (non-ASCII chars become \\uXXXX; paste this into the Cloudflare dashboard)."""
import sys
src = sys.argv[1] if len(sys.argv) > 1 else 'engine/kids-worker.js'
dst = sys.argv[2] if len(sys.argv) > 2 else 'engine/kids-worker.ascii.js'
out = []
for ch in open(src, encoding='utf-8').read():
    c = ord(ch)
    if c < 128: out.append(ch)
    elif c < 0x10000: out.append('\\u%04x' % c)
    else:
        c -= 0x10000
        out.append('\\u%04x\\u%04x' % (0xD800 + (c >> 10), 0xDC00 + (c & 0x3FF)))
open(dst, 'w', encoding='ascii').write(''.join(out))
