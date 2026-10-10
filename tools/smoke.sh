#!/bin/sh
# 커밋 전 스모크: 전 모듈 문법 + ?v= 참조 일치
# 사용법: ./tools/smoke.sh
set -e
cd "$(dirname "$0")/.."
fail=0
for f in js/*.js; do
  cp "$f" "/tmp/smoke_$(basename "$f" .js).mjs" 2>/dev/null || true
  if ! node --check "/tmp/smoke_$(basename "$f" .js).mjs"; then
    echo "SYNTAX FAIL: $f"
    fail=1
  fi
done
python3 - <<'EOF'
import re, hashlib
files = ['js/track.js','js/race.js','js/voxel.js','js/world.js','js/net.js','js/sig.js','js/models.js','js/online.js','js/garage.js','js/hud.js','js/board.js','js/records.js','js/accounts.js','js/gacha.js','js/friends.js','js/relay-config.js','js/skids.js','js/main.js']
actual = {f[3:-3]: hashlib.md5(open(f,'rb').read()).hexdigest()[:6] for f in files}
bad = 0
for t in ['js/main.js','js/garage.js','js/online.js','js/board.js','index.html']:
    s = open(t).read()
    for m in re.finditer(r"\./([a-z-]+)\.js\?v=([0-9a-zA-Z]+)", s):
        name, v = m.group(1), m.group(2)
        if name in actual and actual[name] != v:
            print(f"STALE REF: {t}: {name} ref={v} actual={actual[name]}")
            bad = 1
raise SystemExit(bad)
EOF
if [ "$fail" -ne 0 ]; then exit 1; fi
echo "SMOKE OK"
