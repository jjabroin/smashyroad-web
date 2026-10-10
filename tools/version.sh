#!/bin/sh
# 에셋 내용 해시 기반 ?v= 일괄 갱신 (수동 누락 방지)
# 사용법: ./tools/version.sh
set -e
cd "$(dirname "$0")/.."
# 참조를 고치면 참조하는 파일 해시가 바뀌므로 수렴까지 반복
for pass in 1 2 3; do
for f in js/track.js js/race.js js/voxel.js js/world.js js/net.js js/sig.js js/models.js js/online.js js/garage.js js/hud.js js/board.js js/records.js js/accounts.js js/gacha.js js/friends.js js/relay-config.js js/skids.js js/main.js; do
  h=$(md5 -q "$f" | cut -c1-6)
  base=$(basename "$f")
  grep -rl --include="*.js" --include="*.html" -E "\./${base%.*}\.js\?v=[0-9a-zA-Z]+" js index.html 2>/dev/null | while read -r t; do
    sed -i '' -E "s|\./${base%.*}\.js\?v=[0-9a-zA-Z]+|./${base%.*}.js?v=$h|g" "$t"
  done
done
done
M=$(md5 -q js/main.js | cut -c1-6)
sed -i '' -E "s|main\.js\?v=[0-9a-f]+|main.js?v=$M|" index.html
S=$(md5 -q css/style.css | cut -c1-6)
sed -i '' -E "s|style\.css\?v=[0-9a-f]+|style.css?v=$S|" index.html
echo "versions synced. main=$M style=$S"
