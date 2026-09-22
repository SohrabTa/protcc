#!/usr/bin/env python
"""Flag dashboard prose that breaks the two writing rules in CLAUDE.md.

Every string the site prints is written in Simplified Technical English, and the repository also
bans the vocabulary that marks text as machine-written. Both rules are easy to keep while writing
one panel and easy to lose over a hundred of them, so this reads the source instead.

What it flags:

  LONG          an explanation sentence over 25 words
  WORD          a word from the discouraged list
  DASH          an em dash or a spaced hyphen, which STE does not use
  SEMICOLON     STE rule 8.1
  CONTRACTION   STE rule 4.2. A possessive is permitted, so those hits are noise.

It reads single-quoted literals of 24 characters or more, which are the prose and not the class
names. A few matches are code rather than text. Read the line before you change it.

Repro
-----
cd dashboard/web && python3 tools/prose_check.py
"""
import re, sys
from pathlib import Path

BANNED = [
    'delve','intricate','interplay','tapestry','testament','vibrant','meticulous','pivotal',
    'crucial','boast','underscore','showcase','foster','nestled','realm','landscape','leverage',
    'robust','comprehensive','seamless','serves as','stands as','represents','utilize',
    'facilitate','in order to','prior to','moreover','furthermore','additionally','however,',
    'therefore','ensure','verify','determine','perform','modify','terminate','attempt','obtain',
    'e.g.','i.e.','etc.',
]
CONTRACTIONS = re.compile(r"\b\w+(?:'|’)(?:s|t|re|ve|ll|d|m)\b")

def strings(text):
    # Single-quoted literals of more than 24 characters: the prose, not the class names.
    for m in re.finditer(r"'((?:[^'\\\n]|\\.){24,})'", text):
        yield m.start(), m.group(1)

def sentences(s):
    return [x.strip() for x in re.split(r'(?<=[.!?])\s+', s) if x.strip()]

def words(s):
    return len([w for w in re.split(r'\s+', s) if w])

for path in sorted(Path('src').rglob('*.ts')):
    text = path.read_text()
    # Join adjacent concatenated literals so a sentence split over two lines counts once.
    joined = re.sub(r"'\s*\+\s*\n?\s*'", '', text)
    for pos, s in strings(joined):
        line = joined[:pos].count('\n') + 1
        clean = s.replace('\\n', ' ')
        for sent in sentences(clean):
            n = words(sent)
            if n > 25:
                print(f'{path}:{line}  LONG {n}w: {sent[:110]}')
        low = clean.lower()
        for b in BANNED:
            if b in low:
                print(f'{path}:{line}  WORD "{b}": {clean[:100]}')
        if ' - ' in clean or '—' in clean:
            print(f'{path}:{line}  DASH: {clean[:100]}')
        if ';' in clean:
            print(f'{path}:{line}  SEMICOLON: {clean[:100]}')
        m = CONTRACTIONS.search(clean)
        if m and not clean.startswith('http'):
            print(f'{path}:{line}  CONTRACTION "{m.group(0)}": {clean[:100]}')
