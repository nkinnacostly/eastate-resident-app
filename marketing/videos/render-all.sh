#!/bin/sh
# Render the intro and the five W's, 30fps, H.264.
#   sh render-all.sh               9:16 for Reels and TikTok -> out/9x16/
#   FORMAT=4x5 sh render-all.sh    4:5 for feed posts        -> out/4x5/
# Pass composition ids to render only those, e.g. `sh render-all.sh Intro`.
set -e
format=${FORMAT:-9x16}
case $format in
  9x16) suffix= ;; 4x5) suffix=-4x5 ;;
  *) echo "unknown format: $format (9x16 or 4x5)" >&2; exit 1 ;;
esac
mkdir -p "out/$format"
for id in ${*:-Intro Who What Why Where When}; do
  case $id in
    Intro) n=00 ;; Who) n=01 ;; What) n=02 ;; Why) n=03 ;; Where) n=04 ;; When) n=05 ;;
    *) echo "unknown composition: $id" >&2; exit 1 ;;
  esac
  name=$(echo "$id" | tr '[:upper:]' '[:lower:]')
  npx remotion render src/index.ts "$id$suffix" "out/$format/$n-$name.mp4" --codec=h264 --crf=18 --log=error
done
