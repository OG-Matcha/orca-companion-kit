// Little scenes for how a pet feels (T.companionEmotion): instead of one event at a time, a short stretch of
// time together, ticked every minute the way companion.js does it, and then the shape of the mood checked:
// does it rise, peak, and come back down, the way a character would, rather than sticking at the top or
// jumping around. Only the pure model is used; nothing here changes it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ctx = { window: { __orcaThemer: { registerTouch() {} } } }
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(path.resolve(import.meta.dirname, '../src/touches/companion_emotion.js'), 'utf8'), ctx)
const E = ctx.window.__orcaThemer.companionEmotion
const M = 60000
const H = 60 * M
const NINE = new Date(2026, 9, 1, 9).getTime() // 09:00: twenty hours before the next 05:00 roll
const f1 = (x) => Math.round(x * 10) / 10

// A fresh pet at 09:00, settled at its usual level (no moodlets, no worries).
function settled() {
  const s = E.create(NINE)
  s.mood = E.target(s)
  return s
}

// Plays a scene: `script(m, now, touch)` runs at the start of each minute (m = 0 .. mins) and may send
// events at any ms inside that minute; `touch(at)` marks a touch for sinceTouch. The model is ticked at the
// end of every minute, as companion.js does while you are at Orca. Returns the mood after each minute.
function scene(s, mins, script, { start = NINE, lastTouch = start, speed = null } = {}) {
  let touched = lastTouch
  const touch = (at) => (touched = at)
  const out = [{ m: 0, mood: s.mood }]
  for (let m = 0; m < mins; m++) {
    const now = start + m * M
    script?.(m, now, touch)
    const end = now + M
    E.tick(s, end, { present: true, sinceTouch: end - touched, speed })
    out.push({ m: m + 1, mood: s.mood, target: E.target(s), anx: s.anx, lone: s.lone })
  }
  return out
}
const peakOf = (rows) => rows.reduce((a, r) => (r.mood > a.mood ? r : a))
const at = (rows, m) => rows[m].mood
// No minute moves the mood by a lurch: it drifts.
function smooth(rows, why, step = 1) {
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(rows[i].mood - rows[i - 1].mood)
    assert.ok(d < step, `${why}: minute ${rows[i].m} moved ${f1(d)}`)
  }
}
// Never goes down from `a` to `b` (inclusive), or never goes up.
function rises(rows, a, b, why) {
  for (let i = a + 1; i <= b; i++) assert.ok(rows[i].mood >= rows[i - 1].mood - 1e-9, `${why}: dipped at minute ${i}`)
}
function falls(rows, a, b, why) {
  for (let i = a + 1; i <= b; i++) assert.ok(rows[i].mood <= rows[i - 1].mood + 1e-9, `${why}: rose again at minute ${i}`)
}

test('scene: praised twice, then left alone — it brightens, peaks as the words wear off, and sinks back lonely', () => {
  const s = settled()
  const usual = s.mood
  // 「謝謝」 typed in the terminal twice, five minutes apart; nobody touches it afterwards.
  const rows = scene(s, 8 * 60, (m, now) => (m === 0 || m === 5) && E.event(s, 'thanks', now + 1000))
  const peak = peakOf(rows)
  assert.ok(peak.m >= 90 && peak.m <= 150, `peak at minute ${peak.m}, when the two thanks run out`)
  assert.ok(peak.mood > usual + 3, `it does brighten (${f1(usual)} → ${f1(peak.mood)})`)
  assert.ok(peak.mood < 70, `two kind words are not euphoria (${f1(peak.mood)})`)
  rises(rows, 0, peak.m, 'climbing while the words are fresh')
  falls(rows, peak.m, rows.length - 1, 'after the peak, left alone')
  // Not stuck at the top: an hour later it is clearly lower, and by evening the loneliness shows.
  assert.ok(at(rows, peak.m + 60) < peak.mood - 1, `an hour after the peak ${f1(at(rows, peak.m + 60))}`)
  assert.ok(at(rows, 8 * 60) < usual, `eight hours untouched: under its usual ${f1(usual)} (${f1(at(rows, 8 * 60))})`)
  assert.ok(s.lone > 20, `it misses you (${f1(s.lone)})`)
  assert.equal(s.moodlets.length, 0, 'the thanks have expired')
  smooth(rows, 'praised')
})

test('scene: poked over and over — it cheers up, but more pokes stop adding, and it comes back down', () => {
  const s = settled()
  const usual = s.mood
  const aff0 = s.aff
  // A pat every 3 s for ten minutes (companion.js lets one through every 2.5 s at most): 200 pats.
  let pats = 0
  let afterThird = null
  let affAfterSix = null
  const rows = scene(s, 8 * 60, (m, now, touch) => {
    if (m >= 10) return
    for (let k = 0; k < 20; k++) {
      E.event(s, 'pet', now + k * 3000)
      touch(now + k * 3000)
      pats++
      if (pats === 3) afterThird = E.target(s)
      if (pats === 6) affAfterSix = s.aff
      assert.ok(s.moodlets.filter((x) => x.kind === 'pet').length <= E.ML.pet[2], 'pat moodlets stack to their limit')
    }
  })
  assert.equal(pats, 200)
  // The lift stops growing after the third pat: the target at the end of the pokes is where it was then.
  assert.ok(rows[10].target - afterThird < 0.3, `target ${f1(afterThird)} after 3 pats, ${f1(rows[10].target)} after 200`)
  // Affection: the first few pats count; the rest barely, and the day's cap holds.
  assert.ok(affAfterSix - aff0 > 1.5, `six pats: +${f1(affAfterSix - aff0)}`)
  assert.ok(s.aff - affAfterSix < 0.3, `194 more: +${f1(s.aff - affAfterSix)}`)
  assert.ok(s.aff - aff0 <= E.P.affDayCap + 1e-9)
  const peak = peakOf(rows)
  assert.ok(peak.m >= 100 && peak.m <= 180, `peak at minute ${peak.m}, when the last pats wear off`)
  assert.ok(peak.mood > usual + 5, `cheered up (${f1(usual)} → ${f1(peak.mood)})`)
  assert.ok(peak.mood < 85, `never 雀躍 from pokes alone (${f1(peak.mood)})`)
  rises(rows, 0, peak.m, 'climbing')
  falls(rows, peak.m, rows.length - 1, 'after the peak')
  assert.ok(at(rows, 8 * 60) < peak.mood - 8, `not stuck at the top (${f1(at(rows, 8 * 60))} vs ${f1(peak.mood)})`)
  smooth(rows, 'poked')
})

test('scene: sulking after a red afternoon, then won back and petted — it climbs out slowly and settles', () => {
  const s = E.create(NINE)
  s.aff = 30
  s.peakTier = 1
  // A failure and an agent failure every 15 minutes for six hours, you nearby: it sinks under the sulk line.
  // (touch() each minute only keeps loneliness out of it, as in the sulk test of companion-emotion.test.mjs.)
  const red = scene(s, 6 * 60, (m, now, touch) => {
    touch(now)
    if (m % 15 === 14) E.event(s, 'fail', now), E.event(s, 'agentFail', now)
  })
  const T = NINE + 6 * H
  const low = s.mood
  assert.ok(low < E.P.sulkBelow, `sulking at ${f1(low)}`)
  smooth(red, 'the red afternoon')
  // Three pats in its corner win it back (the model hears 「comforted」); a few minutes later two ordinary pats.
  const rows = scene(
    s,
    12 * 60,
    (m, now, touch) => {
      if (m === 0) E.event(s, 'comforted', now + 5000), touch(now + 5000)
      if (m === 5 || m === 8) E.event(s, 'pet', now), touch(now)
    },
    { start: T }
  )
  const cross = rows.find((r) => r.mood >= E.P.sulkBelow)
  assert.ok(cross && cross.m <= 4 * 60, `back over the sulk line at minute ${cross?.m}`)
  assert.ok(cross.m >= 30, `not in an instant (minute ${cross.m})`)
  assert.ok(at(rows, 3 * 60) > low + 10, `three hours later ${f1(at(rows, 3 * 60))} (from ${f1(low)})`)
  // No whiplash from 消沉 to 開心: the whole evening stays under 70.
  const peak = peakOf(rows)
  assert.ok(peak.mood < 70, `highest ${f1(peak.mood)}`)
  // Twelve hours on, everything has worn off: it sits at its target, somewhere between 有點悶 and 平靜.
  const end = rows.at(-1)
  assert.ok(Math.abs(end.mood - end.target) < 3, `settled: ${f1(end.mood)} vs target ${f1(end.target)}`)
  assert.ok(end.mood >= 35 && end.mood < 70, `ends at ${f1(end.mood)}`)
  assert.ok(s.anx < 5, `the worry is gone (${f1(s.anx)})`)
  smooth(rows, 'consoled')
})

test('scene: the same praise with transitionSpeed — the joy shows sooner, the letdown comes slower, and it still ends', () => {
  const play = (speed) => {
    const s = settled()
    const rows = scene(s, 10 * 60, (m, now) => (m === 0 || m === 5) && E.event(s, 'thanks', now + 1000), { speed })
    return { rows, peak: peakOf(rows), usual: rows[0].mood }
  }
  const one = play(null)
  const three = play(E.speed(true))
  assert.ok(at(three.rows, 30) > at(one.rows, 30) + 0.5, `half an hour in: ${f1(at(three.rows, 30))} vs ${f1(at(one.rows, 30))}`)
  assert.ok(three.peak.mood > one.peak.mood, `a higher peak (${f1(three.peak.mood)} vs ${f1(one.peak.mood)})`)
  assert.ok(Math.abs(three.peak.m - one.peak.m) <= 15, `both peak when the words wear off (${three.peak.m} / ${one.peak.m})`)
  const drop = (r) => r.peak.mood - at(r.rows, r.peak.m + 60)
  assert.ok(drop(three) < drop(one), `the first hour after the peak: −${f1(drop(three))} vs −${f1(drop(one))}`)
  // Slower is not never: ten hours on it has come down too, below where it started.
  falls(three.rows, three.peak.m, three.rows.length - 1, 'after the peak')
  assert.ok(at(three.rows, 10 * 60) < three.usual, `ten hours untouched: ${f1(at(three.rows, 10 * 60))}`)
  smooth(three.rows, 'with transitionSpeed')
})
