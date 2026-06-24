#!/usr/bin/env bash
#
# Batch-convert recorded figure clips to presentation-ready video.
#
# The in-browser recorder (js/capture.js, ?record=1) downloads WebM (or
# MP4 on Safari). MediaRecorder cannot emit ProRes, so for a projected
# talk run those clips through real ffmpeg here.
#
# Usage:
#   tools/convert.sh [INPUT_DIR] [FORMAT]
#
#   INPUT_DIR   folder with the recorded .webm/.mp4 (default: current dir)
#   FORMAT      prores | mp4 | both          (default: prores)
#
# Output lands in INPUT_DIR/converted/.  Examples:
#   tools/convert.sh ~/Downloads prores
#   tools/convert.sh . both
#
set -euo pipefail

IN_DIR="${1:-.}"
FORMAT="${2:-prores}"
OUT_DIR="$IN_DIR/converted"

command -v ffmpeg >/dev/null || { echo "error: ffmpeg not found" >&2; exit 1; }
mkdir -p "$OUT_DIR"

shopt -s nullglob nocaseglob
files=("$IN_DIR"/*.webm "$IN_DIR"/*.mp4)
shopt -u nocaseglob
[ ${#files[@]} -gt 0 ] || { echo "no .webm/.mp4 files in $IN_DIR" >&2; exit 1; }

to_prores() {
  # ProRes 422 HQ (profile 3), 10-bit 4:2:2 — clean on a projector, edits
  # losslessly in Keynote. -profile:v 4 (4444) if you need alpha later.
  ffmpeg -y -loglevel warning -i "$1" \
    -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le -vendor apl0 \
    "$2.mov"
  echo "  -> $2.mov"
}

to_mp4() {
  # H.264, near-lossless (crf 16), faststart for slide playback.
  ffmpeg -y -loglevel warning -i "$1" \
    -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart \
    "$2.mp4"
  echo "  -> $2.mp4"
}

for f in "${files[@]}"; do
  base="$(basename "${f%.*}")"
  out="$OUT_DIR/$base"
  echo "converting $(basename "$f")"
  case "$FORMAT" in
    prores) to_prores "$f" "$out" ;;
    mp4)    to_mp4    "$f" "$out" ;;
    both)   to_prores "$f" "$out"; to_mp4 "$f" "$out" ;;
    *) echo "unknown FORMAT '$FORMAT' (use prores|mp4|both)" >&2; exit 1 ;;
  esac
done

echo "done — $OUT_DIR"
