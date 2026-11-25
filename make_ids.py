"""Run on YOUR computer (needs Python 3, no installs):
   1. Download https://images.dhan.co/api-data/api-scrip-master.csv  (save next to this file)
   2. python make_ids.py
   3. Open worker_ready.js - that is the file to paste into Cloudflare."""
import csv, json, re, sys
rows = csv.DictReader(open('api-scrip-master.csv', encoding='utf-8-sig', newline=''))
cols = rows.fieldnames or []
def pick(*needles):
    for n in needles:
        for c in cols:
            if n in c.upper(): return c
    sys.exit('Column not found: ' + '/'.join(needles) + '\nColumns are: ' + ', '.join(cols))
EXCH, SEG = pick('EXCH_ID'), pick('SEGMENT')
SID, SYM, SER = pick('SECURITY_ID'), pick('TRADING_SYMBOL', 'SYMBOL_NAME'), pick('SERIES')
ids = {}
for r in rows:
    if r[EXCH].strip() == 'NSE' and r[SEG].strip() == 'E' and r[SER].strip() == 'EQ':
        ids[r[SYM].strip().upper()] = r[SID].strip()
print('NSE equity symbols found:', len(ids))
src = open('worker.js', encoding='utf-8').read()
new = re.sub(r"/\*IDS\*/.*?/\*ENDIDS\*/", lambda m: '/*IDS*/' + json.dumps(ids, separators=(',', ':')) + '/*ENDIDS*/', src, flags=re.S)
open('worker_ready.js', 'w', encoding='utf-8').write(new)
for t in ['RELIANCE', 'HDFCBANK', 'M&M', 'BAJAJ-AUTO', 'TCS']:
    print(t, '->', ids.get(t, 'NOT FOUND'))
