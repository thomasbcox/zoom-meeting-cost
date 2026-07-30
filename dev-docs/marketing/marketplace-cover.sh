#!/usr/bin/env bash
# Zoom Marketplace cover banner, 1824x176 (that thin size is exactly what Zoom requires).
#
# KEEP THE LEFT ~600px CLEAR. Zoom composites the app icon over the cover's left side — measured
# 2026-07-30 on the live listing at roughly x=451..579 — so anything drawn there is hidden. An
# earlier version put the green '$' logomark at x=56 and started the title at x=196, which left
# the word "meeting" in the tagline sitting underneath Zoom's icon. The logomark was also dropped
# entirely: the app icon Zoom overlays IS the same green tile with a navy '$'
# (see marketplace-icon.sh), so drawing a second one duplicated it.
#
# Right edge is bounded too: the live-cost chip starts at x=1440, so text must end before ~1420.
set -euo pipefail
OUT="${1:-cover.png}"

# Brand palette (NAVY dropped with the logomark — the app icon supplies it now)
DEEPTEAL='#063a3f'
TEAL='#07a496'
SKY='#31b5e9'
GREEN='#a3d28b'
SAGE='#dde2c9'

DISP="/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"
BODY="/System/Library/Fonts/Avenir Next.ttc"
MONO="/System/Library/Fonts/SFNSMono.ttf"

# The '$1,240' / '$18/min' price labels are intentional single-quoted ImageMagick
# literals, not shell expansions — silence SC2016 for this command.
# shellcheck disable=SC2016
magick -size 1824x176 -define gradient:angle=90 "gradient:${DEEPTEAL}-${TEAL}" \
  \( -size 1824x176 xc:none \
  -fill "rgba(49,181,233,0.10)" -draw "circle 1610,20 1610,150" \
  -fill "rgba(163,210,139,0.10)" -draw "circle 1780,150 1780,250" \
  \) -compose over -composite \
  \
  -fill "rgba(20,40,62,0.55)" -stroke "rgba(255,255,255,0.18)" -strokewidth 1 \
  -draw "roundrectangle 1440,46 1768,130 16,16" -stroke none \
  \
  -kerning 2 \
  -font "$DISP" -fill "#ffffff" -pointsize 66 -gravity West -annotate +620-16 'MEETING COST METER' \
  -kerning 0 \
  -font "$BODY" -fill "$SAGE" -pointsize 25 -gravity West -annotate +622+38 'See the live cost of every meeting — right on your video.' \
  \
  -font "$MONO" -fill "$GREEN" -pointsize 40 -gravity West -annotate +1476+0 '$1,240' \
  -font "$MONO" -fill "$SKY" -pointsize 20 -gravity West -annotate +1662+0 '$18/min' \
  -font "$BODY" -fill "rgba(255,255,255,0.65)" -pointsize 16 -gravity West -annotate +1478+32 'LIVE MEETING COST' \
  \
  -depth 8 -strip "$OUT"

magick identify "$OUT"
