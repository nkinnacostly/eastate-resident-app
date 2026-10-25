#!/bin/sh
# Render the five videos to out/. 1080x1350 (4:5), 30fps, 90s, H.264.
set -e
mkdir -p out
i=1
for id in Who What Why Where When; do
  name=$(echo "$id" | tr '[:upper:]' '[:lower:]')
  npx remotion render src/index.ts "$id" "out/0$i-$name.mp4" --codec=h264 --crf=18 --log=error
  i=$((i + 1))
done
