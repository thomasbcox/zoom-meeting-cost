#!/usr/bin/env bash
# Zoom Marketplace app icon. Companion to marketplace-cover.sh — same palette and the
# same DIN Condensed '$' logomark, scaled to fill a square icon canvas.
#
# Usage: marketplace-icon.sh [OUT] [SIZE]
# Zoom requires 160x160 as a MINIMUM (1:1 preferred, under 1 MB), so we render larger
# by default to stay crisp on high-DPI displays. Geometry is derived from SIZE, using
# the original 160px design as the reference proportions.
set -euo pipefail
OUT="${1:-icon.png}"
SIZE="${2:-512}"

# Brand palette
NAVY='#234262'
GREEN='#a3d28b'

DISP="/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"

# Proportions from the 160px reference: 34px corner radius, 132pt glyph, -6px optical
# centring nudge (DIN's '$' sits low in its em box).
RADIUS=$((SIZE * 34 / 160))
POINT=$((SIZE * 132 / 160))
OFFY=$((SIZE * 6 / 160))
MAX=$((SIZE - 1))

# The '$' logomark is an intentional single-quoted ImageMagick literal, not a
# shell expansion — silence SC2016 for this command.
# shellcheck disable=SC2016
magick -size "${SIZE}x${SIZE}" xc:none \
  -fill "$GREEN" -draw "roundrectangle 0,0 ${MAX},${MAX} ${RADIUS},${RADIUS}" \
  -font "$DISP" -fill "$NAVY" -pointsize "$POINT" -gravity center -annotate "+0-${OFFY}" '$' \
  -depth 8 -strip "$OUT"

magick identify "$OUT"
