#!/usr/bin/env python3
"""docs/legal/01,02 (마크다운) -> engine/kids-worker.js 의 // LEGAL-BEGIN ~ // LEGAL-END 사이에 문자열로 끼워 넣는다.
운영자가 채울 자리는 {{OP_NAME}} 같은 토큰으로 바꾸고(워커 변수로 채운다), 검토용 메모([사실이면 유지] 등)는 공개 글에서 뺀다.
실행: python3 tools/embed-legal.py && python3 tools/to-ascii.py"""
import json, re
MAP = [('[운영자 성명 또는 상호]', '{{OP_NAME}}'), ('[운영자]', '{{OP_NAME}}'), ('[성명 · 직책]', '{{OP_MGR}}'), ('[이메일 · 전화]', '{{OP_CONTACT}}'),
       ('[연락처]', '{{OP_CONTACT}}'), ('[YYYY-MM-DD]', '{{LEGAL_DATE}}'), ('[시행일]', '{{LEGAL_DATE}}'), ('[웹 주소]', '{{LEGAL_URL}}'), ('[30일]', '30일')]
NOTES = ['[실제 수집 항목과 일치하는지 출시 전에 다시 확인]', '[사실이면 유지]', '[각 사업자의 이전 국가·시기는 출시 전 확인]', '[법률 검토 필요]',
         '[위치정보법 제19조 통보 방식으로 충분한지 확인]', '[접근 통제, 관리자 접속 기록 보관 등 추가 조치를 실제에 맞게 기재]']
def clean(md):
    out = []
    for ln in md.split('\n'):
        if ln.startswith('> **초안입니다.**') or ln.startswith('> **초안'): continue
        for a, b in MAP: ln = ln.replace(a, b)
        for n in NOTES: ln = ln.replace(' ' + n, '').replace(n, '')
        if ln.strip() in ('-', '- '): continue
        out.append(ln.replace(' (초안)', ''))
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip() + '\n'
docs = {}
for key, f in (('privacy', 'docs/legal/01_개인정보처리방침.md'), ('terms', 'docs/legal/02_위치기반서비스_이용약관.md')):
    docs[key] = clean(open(f, encoding='utf-8').read())
left = [m for d in docs.values() for m in re.findall(r'\[[^\]\n]{1,40}\]', d)]
assert not left, left
blk = '// LEGAL-BEGIN (tools/embed-legal.py 가 만든다 — 직접 고치지 말고 docs/legal 을 고친 뒤 다시 실행)\nconst LEGAL_DOCS = ' + json.dumps(docs, ensure_ascii=False) + ';\n// LEGAL-END'
p = 'engine/kids-worker.js'
s = open(p, encoding='utf-8').read()
a, b = s.index('// LEGAL-BEGIN'), s.index('// LEGAL-END') + len('// LEGAL-END')
open(p, 'w', encoding='utf-8').write(s[:a] + blk + s[b:])
print('ok', {k: len(v) for k, v in docs.items()})
