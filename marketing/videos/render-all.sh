#!/bin/sh
# Render the intro and the five W's to out/: 1080x1350 (4:5), 30fps, H.264.
# Pass composition ids to render only those, e.g. `sh render-all.sh Intro`.
set -e
mkdir -p out
for id in ${*:-Intro Who What Why Where When}; do
  case $id in
    Intro) n=00 ;; Who) n=01 ;; What) n=02 ;; Why) n=03 ;; Where) n=04 ;; When) n=05 ;;
    *) echo "unknown composition: $id" >&2; exit 1 ;;
  esac
  name=$(echo "$id" | tr '[:upper:]' '[:lower:]')
  npx remotion render src/index.ts "$id" "out/$n-$name.mp4" --codec=h264 --crf=18 --log=error
done
