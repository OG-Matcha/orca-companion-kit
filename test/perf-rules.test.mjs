// Static checks on the companion engine, from slowdowns measured with `npm run perf` (docs/performance.md,
// rules 14 and 15 and the 量測 section). They read the source: the engine keeps its always-on loops on the
// compositor by construction, and a change that drops one of these guards fails here before it costs frames.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const src = fs.readFileSync(path.join(REPO, 'src', 'touches', 'companion.js'), 'utf8')

// Every `.animate(` call with its receiver and argument text.
function animateCalls(text) {
  const calls = []
  const re = /([\w$.]+(?:\(\s*'[^']*'\s*\))?)\.animate\(/g
  for (let m; (m = re.exec(text)); ) {
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')' && --depth === 0) break
    }
    calls.push({ receiver: m[1], args: text.slice(m.index + m[0].length, i), line: text.slice(0, m.index).split('\n').length })
  }
  return calls
}
const isTransformLoop = (args) => /iterations:\s*Infinity/.test(args) && /transform/.test(args) && !/composite:\s*'add'/.test(args)

test('perf: the parts that loop or follow the pointer are lifted out of the SVG into HTML boxes', () => {
  // Chromium cannot run a transform animation on an SVG child on the compositor: every frame re-lays-out and
  // repaints the whole SVG (and its drop-shadow), ~10 s of main-thread time a minute while idle (rule 14).
  assert.match(src, /liftParts\(svg, P, \['flutter', 'ears', 'eyes'\], BOX\)/)
  // The head turn and the glance go to the lifted figure and boxes, never to the SVG or its groups.
  assert.ok(!/svg\.style\.transform\b/.test(src), 'no transform written on the <svg> itself')
  assert.match(src, /const head = figure \?\? svg/)
})

test('perf: every always-on loop is kept on the compositor', () => {
  // A loop that starts under another animation on the same element, or gets one later, stays on the main
  // thread for good (Chromium marks it incompatible); keepComposited swaps in a fresh copy once it is alone
  // (rule 15).
  assert.match(src, /loops\.forEach\(\(loop, i\) => keepComposited\(/, 'the bob, the breathing part and the ears')
  assert.match(src, /keepComposited\(glow,/, 'the vigil glow')
  assert.match(src, /keepComposited\(body,/, 'the lantern')
  assert.match(src, /keepComposited\(halo,/, 'the lantern halo')
  assert.match(src, /seats\.forEach\(reseat\)/, 'the periodic recheck')
  // A loop under a finished `fill: 'forwards'` animation of the same property never shows but still costs
  // a frame every frame. Nothing on the lantern's body or halo holds a transform that way while they loop.
  const lantern = src.slice(src.indexOf('const showLantern'), src.indexOf('const hideLantern'))
  const calls = animateCalls(lantern)
  const loopers = calls.filter((c) => isTransformLoop(c.args)).map((c) => c.receiver)
  assert.deepEqual(loopers, ['body', 'halo'])
  for (const r of loopers) {
    const holding = calls.filter((c) => c.receiver === r && /transform/.test(c.args) && /fill:\s*'(forwards|both)'/.test(c.args))
    assert.deepEqual(holding.map((c) => c.line), [], `lantern ${r}: a filling transform would hide its loop`)
  }
})

test('perf: additive reactions play in nested boxes, and the gaze is throttled and written only on change', () => {
  // composite: 'add' runs on the main thread (a style recalc every frame, and the loop under it with it):
  // ~10 s a minute while typing. stacked() gives each additive animation its own nested box instead.
  assert.match(src, /const bobInner = stacked\(bob\)/)
  assert.match(src, /for \(const name of \['flutter', 'ears', 'eyes'\]\) for \(const el of parts\(name\)\) if \(el instanceof HTMLElement\) stacked\(el\)/)
  // Following each pointer frame only restarted the .45 s / .25 s transitions for the same look.
  assert.match(src, /const GAZE_MS = 60/)
  assert.match(src, /if \(v === eyesNow\) return/)
  assert.match(src, /const turnHead = \(v\) => v !== headNow && /)
  assert.match(src, /if \(!gazeQueued && !\(far && !headNow && !eyesNow\)\)/, 'no frame is asked for when the pointer is far and the head is straight')
})

test('perf: the example companion has no always-on transform loop on an SVG group of its own', () => {
  for (const name of fs.readdirSync(path.join(REPO, 'examples', 'touches')).filter((n) => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(REPO, 'examples', 'touches', name), 'utf8')
    const groups = new Set([...text.matchAll(/<g class="([\w-]+)"/g)].map((m) => m[1]))
    for (const call of animateCalls(text)) {
      if (!isTransformLoop(call.args)) continue
      const cls = /querySelector\('\.([\w-]+)'\)$/.exec(call.receiver)?.[1]
      assert.ok(!(cls && groups.has(cls)), `${name}:${call.line} loops .${cls}, an SVG group`)
    }
  }
})
