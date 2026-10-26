// Turns a cursor SVG into the CSS a theme pastes in: a data URI at 1x and 2x (`-webkit-image-set`, so the
// cursor stays sharp on HiDPI screens), the hotspot, and a fallback keyword.
//   node tools/cursor-css.mjs <cursor.svg> [hotspotX hotspotY] [--touch custom-cursor]
// The SVG should be 24x24 (width/height attributes); the 2x copy is the same drawing at 48x48.
// The rule is keyed on html[data-orca-touch-<touch>] so the picker can switch the cursor off.
import fs from 'node:fs'

/** Percent-encodes an SVG for a url("data:image/svg+xml,...") inside CSS. */
export function svgDataUri(svg) {
  const compact = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/"/g, "'")
  return `data:image/svg+xml,${compact.replace(/[%#<>{}\n\r]/g, (c) => encodeURIComponent(c))}`
}

/** The same SVG at another pixel size (the viewBox keeps the drawing identical). */
export function resized(svg, px) {
  return svg.replace(/<svg\b([^>]*)>/, (whole, attrs) => {
    const rest = attrs.replace(/\s(width|height)="[^"]*"/g, '')
    return `<svg${rest} width="${px}" height="${px}">`
  })
}

// Cursors that tell you what a drag will do (panel resize edges) keep their system shape.
const KEEP_SYSTEM = `[data-panel-resize-handle-id], [data-resize-handle], [role='separator'], [class*='resize']`

export function cursorCss(svg, { x = 2, y = 2, touch = 'custom-cursor', fallback = 'default' } = {}) {
  const one = svgDataUri(resized(svg, 24))
  const two = svgDataUri(resized(svg, 48))
  return `/* ${touch}: hotspot ${x} ${y} (in the 24px drawing). Made by tools/cursor-css.mjs. */
html[data-orca-touch-${touch}],
html[data-orca-touch-${touch}] *:not(${KEEP_SYSTEM}) {
  cursor:
    -webkit-image-set(url("${one}") 1x, url("${two}") 2x) ${x} ${y},
    url("${one}") ${x} ${y},
    ${fallback} !important;
}
`
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`) {
  const args = process.argv.slice(2)
  const file = args.find((a) => a.endsWith('.svg'))
  if (!file) {
    console.error('usage: node tools/cursor-css.mjs <cursor.svg> [hotspotX hotspotY] [--touch custom-cursor]')
    process.exit(1)
  }
  const nums = args.filter((a) => /^\d+(\.\d+)?$/.test(a)).map(Number)
  const touchAt = args.indexOf('--touch')
  process.stdout.write(
    cursorCss(fs.readFileSync(file, 'utf8'), { x: nums[0] ?? 2, y: nums[1] ?? 2, touch: touchAt >= 0 ? args[touchAt + 1] : 'custom-cursor' })
  )
}
