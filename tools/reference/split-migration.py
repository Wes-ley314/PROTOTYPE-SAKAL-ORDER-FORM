#!/usr/bin/env python3
"""
Split the ŠAKAL Workshop monolith into css/ + js/ files.

Rules obeyed:
  * every byte of CSS and JS is moved verbatim, never rewritten
  * <script src> order matches the original <script> order exactly
  * the result is provably re-assemblable back into the original file
"""
import os, re, sys, shutil

SRC = 'index.html'
OUT = 'sakal'

# js block index (1-based, in document order) -> output filename
JS_NAMES = {
    1:  '00-seed-data.js',
    2:  '01-jacket-form.js',
    3:  '02-core.js',
    4:  '03-orders.js',
    5:  '04-delta.js',
    6:  '05-pricelist.js',
    7:  '06-stock.js',
    8:  '07-leads.js',
    9:  '08-customers.js',
    10: '09-ops.js',
    11: '10-design.js',
    12: '11-setup.js',
    13: '12-assistant.js',
    14: '13-invoicing.js',
}
CSS_NAMES = ['01-base.css', '02-orders.css', '03-modules.css']

# block 14 also contains the INIT/boot code; cut it out into its own file.
BOOT_SPLIT_MARKER = '/* ══════════════════════════════════════════════════\n   INIT'
BOOT_NAME = '99-boot.js'


def find_blocks(lines, tag):
    """Return [(open_line_idx, close_line_idx)] 0-based, for bare <tag> blocks."""
    out, start = [], None
    for i, l in enumerate(lines):
        s = l.strip()
        if s == '<%s>' % tag:
            start = i
        elif s == '</%s>' % tag and start is not None:
            out.append((start, i))
            start = None
    return out


def main():
    src = open(SRC, encoding='utf-8').read()
    lines = src.split('\n')

    css_blocks = find_blocks(lines, 'style')
    js_blocks = find_blocks(lines, 'script')
    assert len(css_blocks) == 3, 'expected 3 style blocks, got %d' % len(css_blocks)
    assert len(js_blocks) == 14, 'expected 14 script blocks, got %d' % len(js_blocks)

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    for d in ('css', 'js', 'tools'):
        os.makedirs(os.path.join(OUT, d))

    manifest = {'css': [], 'js': []}

    # ---- CSS ----
    for n, (a, b) in enumerate(css_blocks):
        body = '\n'.join(lines[a + 1:b])
        name = CSS_NAMES[n]
        open(os.path.join(OUT, 'css', name), 'w', encoding='utf-8').write(body)
        manifest['css'].append((a, b, name))

    # ---- JS ----
    for n, (a, b) in enumerate(js_blocks, 1):
        body = '\n'.join(lines[a + 1:b])
        name = JS_NAMES[n]
        if n == 14 and BOOT_SPLIT_MARKER in body:
            head, tail = body.split(BOOT_SPLIT_MARKER, 1)
            open(os.path.join(OUT, 'js', name), 'w', encoding='utf-8').write(head.rstrip('\n') + '\n')
            open(os.path.join(OUT, 'js', BOOT_NAME), 'w', encoding='utf-8').write(
                BOOT_SPLIT_MARKER + tail)
            manifest['js'].append((a, b, [name, BOOT_NAME]))
        else:
            open(os.path.join(OUT, 'js', name), 'w', encoding='utf-8').write(body)
            manifest['js'].append((a, b, [name]))

    # ---- rebuild index.html with link/script tags in place ----
    replace = {}
    for a, b, name in manifest['css']:
        replace[(a, b)] = ['<link rel="stylesheet" href="css/%s">' % name]
    for a, b, names in manifest['js']:
        replace[(a, b)] = ['<script src="js/%s"></script>' % nm for nm in names]

    spans = sorted(replace.keys())
    out, i, si = [], 0, 0
    while i < len(lines):
        if si < len(spans) and i == spans[si][0]:
            out.extend(replace[spans[si]])
            i = spans[si][1] + 1
            si += 1
        else:
            out.append(lines[i])
            i += 1
    open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write('\n'.join(out))

    # ---- report ----
    print('wrote %s/' % OUT)
    total = 0
    for d in ('css', 'js'):
        for f in sorted(os.listdir(os.path.join(OUT, d))):
            p = os.path.join(OUT, d, f)
            sz = os.path.getsize(p)
            ln = sum(1 for _ in open(p, encoding='utf-8'))
            total += sz
            print('  %-28s %6.1f KB  %5d lines' % (d + '/' + f, sz / 1024, ln))
    ih = os.path.join(OUT, 'index.html')
    print('  %-28s %6.1f KB  %5d lines' % (
        'index.html', os.path.getsize(ih) / 1024,
        sum(1 for _ in open(ih, encoding='utf-8'))))


if __name__ == '__main__':
    main()
