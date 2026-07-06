#!/usr/bin/env bash
set -euo pipefail
OUT="${1:-cover.png}"

# Brand palette
NAVY='#234262'
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
  -fill "$GREEN" -draw "roundrectangle 56,40 152,136 20,20" \
  \
  -fill "rgba(20,40,62,0.55)" -stroke "rgba(255,255,255,0.18)" -strokewidth 1 \
  -draw "roundrectangle 1440,46 1768,130 16,16" -stroke none \
  \
  -font "$DISP" -fill "$NAVY" -pointsize 78 -gravity NorthWest -annotate +72+34 '$' \
  -kerning 2 \
  -font "$DISP" -fill "#ffffff" -pointsize 66 -gravity West -annotate +196-16 'MEETING COST METER' \
  -kerning 0 \
  -font "$BODY" -fill "$SAGE" -pointsize 25 -gravity West -annotate +198+38 'See the live cost of every meeting — right on your video.' \
  \
  -font "$MONO" -fill "$GREEN" -pointsize 40 -gravity West -annotate +1476+0 '$1,240' \
  -font "$MONO" -fill "$SKY" -pointsize 20 -gravity West -annotate +1662+0 '$18/min' \
  -font "$BODY" -fill "rgba(255,255,255,0.65)" -pointsize 16 -gravity West -annotate +1478+32 'LIVE MEETING COST' \
  \
  -depth 8 -strip "$OUT"

magick identify "$OUT"
