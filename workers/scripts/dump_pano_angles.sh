#!/bin/sh
set -eu
dir="$1"
for f in "$dir"/PANO*.JPG "$dir"/PANO*.jpg; do
  [ -f "$f" ] || continue
  yaw=$(exiftool -s3 -n -GimbalYawDegree "$f" 2>/dev/null || true)
  pitch=$(exiftool -s3 -n -GimbalPitchDegree "$f" 2>/dev/null || true)
  roll=$(exiftool -s3 -n -GimbalRollDegree "$f" 2>/dev/null || true)
  printf '%s yaw=%s pitch=%s roll=%s\n' "$(basename "$f")" "$yaw" "$pitch" "$roll"
done
