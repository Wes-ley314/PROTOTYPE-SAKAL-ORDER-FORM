#!/usr/bin/env python3
"""
Reassemble the split project back into a single-file index.html.

Two uses:
  1. Proof.  Running this against a fresh split must reproduce the original
     monolith byte for byte.  That is how we know the split changed nothing.
  2. Fallback.  If you ever need to hand somebody one self-contained file
     (email it, drop it on a USB stick, open it with no web server), this
     makes it.

Usage:
    python3 tools/bundle.py              -> writes dist/index.html
    python3 tools/bundle.py --check FILE -> diffs the result against FILE
"""
import os, re, sys, difflib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def bundle():
    src = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    out = []
    for line in src.split('\n'):
        s = line.strip()
        m_css = re.fullmatch(r'<link rel="stylesheet" href="(css/[^"]+)">', s)
        m_js = re.fullmatch(r'<script src="(js/[^"]+)"></script>', s)
        if m_css:
            body = open(os.path.join(ROOT, m_css.group(1)), encoding='utf-8').read()
            out.append('<style>')
            out.append(body)
            out.append('</style>')
        elif m_js:
            path = m_js.group(1)
            body = open(os.path.join(ROOT, path), encoding='utf-8').read()
            # the boot file was carved out of the tail of 13-invoicing.js;
            # glue it back on rather than emitting a second <script>
            if path.endswith('13-invoicing.js'):
                boot = open(os.path.join(ROOT, 'js/99-boot.js'), encoding='utf-8').read()
                body = body.rstrip('\n') + '\n\n' + boot
            elif path.endswith('99-boot.js'):
                continue
            out.append('<script>')
            out.append(body.rstrip('\n') if not path.endswith('01-jacket-form.js') else body)
            out.append('</script>')
        else:
            out.append(line)
    return '\n'.join(out)


def main():
    text = bundle()
    if '--check' in sys.argv:
        ref = open(sys.argv[sys.argv.index('--check') + 1], encoding='utf-8').read()
        if text == ref:
            print('IDENTICAL — %d bytes, split is lossless' % len(text))
            return 0
        a, b = ref.split('\n'), text.split('\n')
        print('DIFFERS: original %d lines / %d bytes, rebuilt %d lines / %d bytes'
              % (len(a), len(ref), len(b), len(text)))
        n = 0
        for d in difflib.unified_diff(a, b, 'original', 'rebuilt', lineterm='', n=1):
            print(d[:160])
            n += 1
            if n > 40:
                print('... truncated')
                break
        return 1
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    p = os.path.join(ROOT, 'dist', 'index.html')
    open(p, 'w', encoding='utf-8').write(text)
    print('wrote %s (%.1f KB)' % (p, len(text) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
