#!/usr/bin/env python3
"""nodejs-mobile is built without ICU, so V8 rejects \\p{L} and \\p{N} in regexes.
Rewrites them (they only appear inside [...] with the u flag) into explicit code point ranges."""
import sys
import unicodedata


def ranges(categories):
    out, start, prev = [], None, None
    for cp in range(0x110000):
        if unicodedata.category(chr(cp)) in categories:
            if start is None:
                start = cp
            prev = cp
        elif start is not None:
            out.append((start, prev))
            start = None
    if start is not None:
        out.append((start, prev))
    esc = lambda cp: '\\u{%X}' % cp
    return ''.join(esc(a) if a == b else esc(a) + '-' + esc(b) for a, b in out)


LETTERS = ranges({'Lu', 'Ll', 'Lt', 'Lm', 'Lo'})
NUMBERS = ranges({'Nd', 'Nl', 'No'})

for path in sys.argv[1:]:
    src = open(path, encoding='utf8').read()
    if '\\p{' not in src:
        continue
    out = src.replace('\\p{L}', LETTERS).replace('\\p{N}', NUMBERS)
    if '\\p{' in out:
        sys.exit(f'{path}: unsupported Unicode property escape left')
    open(path, 'w', encoding='utf8').write(out)
    print(f'rewrote Unicode property escapes in {path}')
