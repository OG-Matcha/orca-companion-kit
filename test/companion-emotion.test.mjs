// How a pet feels (T.companionEmotion, src/touches/companion_emotion.js): 30-day simulations replayed
// hour by hour through the pure model (a heavy user, two weeks away, a day of red, a cold shoulder,
// weekends off), plus the words, a pet's own words, the save format and the catch-up after Orca was closed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ctx = { window: { __orcaThemer: { registerTouch() {} } } }
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(path.resolve(import.meta.dirname, '../src/touches/companion_emotion.js'), 'utf8'), ctx)
const E = ctx.window.__orcaThemer.companionEmotion
const H = 3600000
const DAY = 86400000
const T0 = new Date(2026, 9, 1, 5).getTime() // day 1 starts at 05:00 on a Thursday

// A day plan: { hours: [from, to], pets, played, ignores, agents, late } or null (not at Orca).
const heavy = (d) => ({ hours: [9, 23], pets: 15, played: 4, ignores: 1, agents: 6, late: d % 4 === 0 })
const profiles = {
  heavy,
  weekday: (d) => ((d + 3) % 7 >= 5 ? null : { hours: [9, 18], pets: 4, played: 1, ignores: 1, agents: 3 }), // day 1 is a Thursday
  away: (d) => (d >= 7 && d < 21 ? null : { hours: [10, 20], pets: 6, played: 2, ignores: 0, agents: 4 }),
  neglect: () => ({ hours: [9, 19], pets: 0, played: 0, ignores: 2, agents: 4 }),
  coldTurn: (d) => (d < 15 ? { ...heavy(d), late: false } : { hours: [9, 19], pets: 0, played: 0, ignores: 2, agents: 4 })
}

// Runs `days` days of a profile with an hourly tick, events spread evenly over the hours at Orca.
// fails: { day | days, pass } puts 10 failures and an agent failure at 14–15 h (pass: green at 16 h).
function run(profile, { days = 30, fails = null, start = null } = {}) {
  const s = start ?? E.create(T0)
  const rows = []
  const hourly = []
  for (let d = 0; d < days; d++) {
    const plan = profile(d)
    const events = []
    if (plan) {
      const [a, b] = plan.hours
      const spread = (n, kind) => {
        for (let i = 0; i < n; i++) events.push([a + Math.floor(((i + 0.5) / n) * (b - a)), kind])
      }
      spread(plan.pets, 'pet')
      spread(plan.played, 'played')
      spread(plan.ignores, 'ignored')
      spread(plan.agents, 'agentDone')
      if (plan.late) events.push([23, 'late'])
      if (fails && (fails.day === d || fails.days?.includes(d))) {
        for (let i = 0; i < 10; i++) events.push([14 + Math.floor(i / 5), 'fail'])
        events.push([15, 'agentFail'])
        if (fails.pass) events.push([16, 'pass'])
      }
    }
    let minMood = 100
    let maxAnx = 0
    let lastTouch = -Infinity
    for (let hr = 5; hr < 29; hr++) {
      const now = T0 + d * DAY + (hr - 5) * H
      const present = !!plan && hr >= plan.hours[0] && hr < plan.hours[1]
      for (const [eh, kind] of events)
        if (eh === hr) {
          E.event(s, kind, now)
          if (['pet', 'played'].includes(kind)) lastTouch = now
        }
      E.tick(s, now + 1, { present, sinceTouch: now - lastTouch }) // +1 ms: the 05:00 roll lands inside the tick
      minMood = Math.min(minMood, s.mood)
      maxAnx = Math.max(maxAnx, s.anx)
      hourly.push({ d, hr: hr % 24, mood: s.mood, anx: s.anx, lone: s.lone, aff: s.aff })
    }
    rows.push({ d: d + 1, present: !!plan, mood: s.mood, minMood, aff: s.aff, close: s.close, maxAnx, awayDays: s.awayDays })
  }
  return { rows, hourly, s }
}
const f1 = (x) => Math.round(x * 10) / 10

test('emotion: a heavy user stays under 80 for 30 days; 60 takes more than a month', () => {
  const { rows, s } = run(profiles.heavy)
  const aff30 = rows[29].aff
  assert.ok(aff30 >= 45 && aff30 < 80, `day 30 affection ${f1(aff30)}`)
  assert.ok(aff30 <= 60, `day 30 affection ${f1(aff30)} should be well short of 80`)
  assert.ok(rows.every((r) => r.aff < 80), 'never 80 inside 30 days')
  assert.ok(rows[6].aff >= 12 && rows[6].aff <= 22, `day 7 ${f1(rows[6].aff)}`)
  assert.ok(rows.every((r) => r.minMood > 40), 'a good day never drops the mood under 40')
  assert.ok(s.close >= 7 && s.close <= 14, `day 30 closeness ${f1(s.close)}`)
  const long = run(profiles.heavy, { days: 120 })
  const hit = (t) => long.rows.findIndex((r) => r.aff >= t) + 1
  assert.ok(hit(60) > 30 && hit(60) <= 45, `60 on day ${hit(60)}`)
  assert.ok(hit(80) > 60 && hit(80) <= 100, `80 on day ${hit(80)}`)
})

test('emotion: two weeks away loses at most 4, never below the tier reached, and recovers', () => {
  const { rows } = run(profiles.away)
  // Day 7 is scored at the 05:00 roll into day 8, the first day away: that is the value it waits with.
  const before = rows[7].aff
  const low = Math.min(...rows.slice(7, 21).map((r) => r.aff))
  assert.ok(before >= 20, `tier 熟悉 reached before leaving (${f1(before)})`)
  assert.ok(before - low <= 4, `drop ${f1(before - low)} ≤ 4`)
  assert.ok(low >= 20, `never below the tier floor 20 (${f1(low)})`)
  // The first three days away cost nothing; the fourth starts the −0.3 a day.
  assert.equal(rows[10].aff, before)
  assert.ok(rows[11].aff < before && before - rows[11].aff <= 0.31)
  // Loneliness is capped while away, so the mood floats around 40, not at the bottom.
  assert.ok(rows.slice(8, 21).every((r) => r.mood >= 38 && r.mood <= 45), 'mood ≈ 40 while away')
  assert.ok(rows[21].mood >= 50, `mood ${f1(rows[21].mood)} on the day back`)
  assert.ok(rows[29].aff > before, 'past the old value by day 30')
})

test('emotion: a long absence near a tier floor stops at the floor', () => {
  const s = E.create(T0)
  s.aff = 21
  s.peakTier = 1
  E.tick(s, T0 + 40 * DAY, { present: true })
  assert.equal(s.aff, 20)
  const t = E.create(T0)
  t.aff = 35
  t.peakTier = 1
  E.tick(t, T0 + 60 * DAY, { present: true })
  assert.equal(f1(t.aff), 31, 'a 60-day gap still costs only 4')
})

test('emotion: ten failures make it sad for the day, never less fond, and it is fine the next day', () => {
  const base = run(profiles.heavy)
  const red = run(profiles.heavy, { fails: { day: 10, pass: false } })
  const green = run(profiles.heavy, { fails: { day: 10, pass: true } })
  assert.equal(f1(red.rows[10].aff), f1(base.rows[10].aff), 'affection unchanged on the day')
  assert.equal(f1(red.rows[29].aff), f1(base.rows[29].aff), 'affection unchanged after 30 days')
  const at = (r, d, hr) => r.hourly.find((h) => h.d === d && h.hr === hr)
  assert.ok(at(red, 10, 15).mood < at(base, 10, 15).mood - 15, `mood drops (${f1(at(base, 10, 15).mood)} → ${f1(at(red, 10, 15).mood)})`)
  assert.ok(red.rows[10].minMood > 30, `lowest mood that day ${f1(red.rows[10].minMood)}`)
  assert.ok(at(red, 10, 15).anx > 30, `anxiety ${f1(at(red, 10, 15).anx)} at 15:00`)
  assert.ok(at(green, 10, 16).anx < at(red, 10, 16).anx / 1.5, 'a success halves the anxiety')
  assert.ok(at(green, 10, 21).mood > at(red, 10, 21).mood, 'the evening is better after the success')
  // Next day: back to normal, anxiety slept off.
  assert.ok(Math.abs(at(red, 11, 12).mood - at(base, 11, 12).mood) < 1.5, `next noon ${f1(at(red, 11, 12).mood)} vs ${f1(at(base, 11, 12).mood)}`)
  assert.ok(at(red, 11, 9).anx < 1, `anxiety ${f1(at(red, 11, 9).anx)} by morning`)
  // A whole week of red: still no change to affection.
  const week = run(profiles.heavy, { fails: { days: [9, 10, 11, 12, 13, 14, 15], pass: false } })
  assert.equal(f1(week.rows[29].aff), f1(base.rows[29].aff))
})

test('emotion: Orca open all day but never a touch is what really costs', () => {
  const { rows } = run(profiles.coldTurn)
  const peak = rows[14].aff
  assert.ok(peak >= 28 && peak <= 34, `day 15 ${f1(peak)}`)
  assert.ok(rows[29].aff < peak, 'it falls')
  assert.equal(rows[29].aff, 20, 'down to the floor of 熟悉, not below')
  assert.ok(rows.slice(15).every((r) => r.aff >= 20))
  assert.ok(rows.slice(20).every((r) => r.mood >= 28 && r.mood <= 40), 'mood sits low, not at the bottom')
  const n = run(profiles.neglect)
  assert.equal(n.rows[29].aff, 0)
  assert.ok(n.rows.every((r) => r.minMood > 20), `never sulks from neglect alone (${f1(Math.min(...n.rows.map((r) => r.minMood)))})`)
})

test('emotion: weekends off cost nothing; Monday makes up the loneliness within hours', () => {
  const { rows, hourly } = run(profiles.weekday)
  assert.equal(rows.filter((r) => !r.present).length, 8)
  for (let i = 1; i < rows.length; i++) if (!rows[i].present && !rows[i - 1].present) assert.equal(rows[i].aff, rows[i - 1].aff, `day ${i + 1}`)
  assert.ok(rows[29].aff >= 22 && rows[29].aff <= 35, `day 30 ${f1(rows[29].aff)}`)
  const sun = rows.find((r, i) => !r.present && rows[i + 1]?.present)
  assert.ok(sun.mood >= 38 && sun.mood <= 44, `Sunday ${f1(sun.mood)}`)
  const mon = hourly.find((h) => h.d === sun.d && h.hr === 11)
  assert.ok(mon.mood >= 50, `Monday 11:00 ${f1(mon.mood)}`)
})

test('emotion: petting it while it is anxious counts for more; the daily cap holds', () => {
  const calm = E.create(T0)
  const anxious = E.create(T0)
  for (let i = 0; i < 6; i++) E.event(anxious, 'fail', T0)
  assert.ok(anxious.anx >= 50)
  E.event(calm, 'pet', T0)
  E.event(anxious, 'pet', T0)
  assert.ok(anxious.aff - calm.aff > 0.4, `${f1(anxious.aff)} vs ${f1(calm.aff)}`)
  for (let i = 0; i < 200; i++) E.event(anxious, 'pet', T0)
  assert.ok(anxious.aff <= 5 + 2.5 + 0.01)
})

test('emotion: ignoring is capped per day; moodlets stack to a limit and expire; a success clears the red', () => {
  const s = E.create(T0)
  s.aff = 30
  s.peakTier = 1
  for (let i = 0; i < 5; i++) E.event(s, 'ignored', T0)
  assert.equal(f1(s.aff), 28.4)
  assert.equal(s.moodlets.filter((m) => m.kind === 'ignored').length, 2)
  for (let i = 0; i < 9; i++) E.event(s, 'fail', T0 + i * 60000)
  assert.equal(s.moodlets.filter((m) => m.kind === 'fail').length, 5)
  E.tick(s, T0 + 2 * H, { present: true, sinceTouch: 0 })
  assert.equal(s.moodlets.filter((m) => m.kind === 'fail').length, 0)
  const t = E.create(T0)
  E.event(t, 'agentFail', T0)
  const anx = t.anx
  assert.equal(E.event(t, 'pass', T0 + 2 * H), false)
  assert.equal(E.event(t, 'pass', T0 + 30 * 60000), true)
  assert.equal(f1(t.anx), f1(anx / 2))
  assert.ok(t.moodlets.some((m) => m.kind === 'passAfterFail') && !t.moodlets.some((m) => m.kind === 'agentFail'))
  assert.equal(E.event(t, 'pass', T0 + 31 * 60000), false, 'one success per failure streak')
  assert.equal(E.event(t, 'nope', T0), false)
  assert.equal(E.event(t, 'constructor', T0), false)
})

test('emotion: catching up after Orca was closed for days', () => {
  const s = E.create(T0)
  s.aff = 25
  s.peakTier = 1
  s.lone = 10
  s.anx = 40
  s.today.present = s.today.interacted = true
  const back = T0 + 5 * DAY + 5 * H // closed for five days, opened at 10:00 on the sixth
  const out = E.tick(s, back, { present: true, sinceTouch: Infinity })
  assert.equal(out.rolled, 5)
  assert.equal(out.returned, 4) // the day you left counted as together; four whole days away
  assert.equal(f1(s.aff), f1(25 + 0.5 * (1 - 25 / 108) - 0.3))
  assert.ok(s.lone === 0 && s.moodlets.some((m) => m.kind === 'reunion'), 'reunion: loneliness gone, a glad moodlet')
  assert.ok(s.anx < 0.01, 'anxiety slept off')
  assert.equal(s.today.key, '2026-10-06')
  const t = E.create(T0)
  E.tick(t, T0 + 2 * DAY + 5 * H, { present: true })
  assert.equal(t.awayDays, 2)
  assert.equal(t.lone, 0)
  assert.ok(!t.moodlets.some((m) => m.kind === 'reunion'))
  const u = E.create(T0)
  E.tick(u, T0 + 2 * DAY + 5 * H, { present: false })
  assert.equal(u.lone, 55)
  assert.ok(u.mood > 38)
})

test('emotion: a pet that knew you before it had feelings starts at 60; a new one is shy', () => {
  assert.equal(E.migrate(null, T0).aff, 5)
  const old = E.migrate({ days: 40, pets: 380 }, T0)
  assert.equal(old.aff, 60)
  assert.equal(old.peakTier, 3)
  assert.equal(E.tierName(old.aff), '知心')
  assert.ok(old.close > 10 && old.close < 25, `closeness ${old.close} from 40 days`)
  assert.equal(E.tierFloor(old), 60)
  assert.equal(run(profiles.neglect, { start: old }).rows[29].aff, 60, 'even neglect never drops it out of the tier')
  assert.equal(E.migrate({ days: 0, pets: 0 }, T0).aff, 5)
  assert.equal(E.migrate({ days: 0, pets: 3 }, T0).aff, 60)
})

test('emotion: words at every threshold, and a pet can bring its own', () => {
  const w = (fn, xs) => xs.map((x) => fn(x))
  assert.deepEqual(w(E.tierName, [0, 19.9, 20, 39.9, 40, 59.9, 60, 79.9, 80, 100]), ['初識', '初識', '熟悉', '熟悉', '信賴', '信賴', '知心', '知心', '最要好', '最要好'])
  assert.deepEqual(w(E.stageName, [0, 9.9, 10, 25, 50, 75, 100]), ['種子', '種子', '發芽', '長葉', '含苞', '開花', '開花'])
  assert.deepEqual(w(E.moodWord, [0, 19.9, 20, 34.9, 35, 49.9, 50, 69.9, 70, 84.9, 85, 100]), ['消沉', '消沉', '低落', '低落', '有點悶', '有點悶', '平靜', '平靜', '開心', '開心', '雀躍', '雀躍'])
  assert.deepEqual(w(E.anxWord, [0, 19, 20, 49, 50, 69, 70]), ['', '', '有一點點緊張', '有一點點緊張', '有點擔心你', '有點擔心你', '很不安'])
  assert.deepEqual(w(E.loneWord, [0, 24, 25, 39, 40, 59, 60]), ['', '', '想被摸摸', '想被摸摸', '有點想你', '有點想你', '好想你'])
  const W = E.words({
    tiers: ['a', 'b', 'c', 'd', 'e'],
    moods: [[0, 'x', '!'], [0, 'y'], [0, 'z'], [0, 'q'], [0, 'r'], [0, 's']], // thresholds stay the engine's; a missing glyph keeps the default
    stages: ['too', 'short'],
    moodlets: { pet: '摸摸', nope: 'x' },
    calm: '很好。'
  })
  assert.equal(E.tierName(45, W), 'c')
  assert.deepEqual([...E.moodBand(90, W)], [85, 'x', '!'])
  assert.deepEqual([...E.moodBand(75, W)], [70, 'y', '♡'])
  assert.equal(E.stageName(80, W), '開花', 'a malformed list keeps the default')
  assert.equal(W.moodlets.pet, '摸摸')
  assert.equal(W.moodlets.nope, undefined)
  assert.equal(W.calm, '很好。')
  for (const bad of [null, 7, 'x', [], { tiers: 'abc' }, { tiers: [1, 2, 3, 4, 5] }]) assert.equal(E.words(bad).tiers[0], '初識')
  // Every moodlet has a default label; mixed CJK/Latin text keeps its space.
  for (const k of Object.keys(E.ML)) assert.ok(E.WORDS.moodlets[k], k)
  const all = [...E.WORDS.tiers, ...E.WORDS.stages.map((s) => s[1]), ...E.WORDS.moods.map((m) => m[1]), ...Object.values(E.WORDS.moodlets)]
  for (const text of all) assert.doesNotMatch(text, /[一-鿿][A-Za-z]|[A-Za-z][一-鿿]/, text)
})

test('emotion: the panel view, the idle lean, and the save format read back the same', () => {
  const s = E.create(T0)
  s.aff = 43.2
  s.close = 30
  for (let i = 0; i < 3; i++) E.event(s, 'pet', T0)
  for (let i = 0; i < 4; i++) E.event(s, 'fail', T0)
  const v = E.view(s, T0 + 60000)
  assert.equal(v.tierName, '信賴')
  assert.equal(v.hearts, 2)
  assert.equal(v.stageName, '長葉')
  assert.deepEqual([...v.nextStage], [50, '含苞'])
  const pet = v.moodlets.find((m) => m.kind === 'pet')
  assert.deepEqual([pet.label, pet.v, pet.count, pet.leftMin], ['被摸頭了', 18, 3, 119])
  assert.equal(v.moodlets.find((m) => m.kind === 'fail').v, -16)
  assert.ok(v.target < 55)
  const lean = (x) => Object.fromEntries(Object.entries(E.lean(x)).map(([k, n]) => [k, Math.round(n * 100) / 100]))
  assert.deepEqual(lean({ mood: 90, lone: 60, anx: 60 }), { happy: 0.4, bored: 0.3, worried: 0.4 })
  assert.deepEqual(lean({ mood: 30, lone: 0, anx: 0 }), { happy: -0.2, bored: 0, worried: 0 })
  E.tick(s, T0 + 31 * 60000, { present: true, sinceTouch: 0 })
  const saved = JSON.parse(JSON.stringify(E.serialize(s, T0 + 31 * 60000)))
  const back = E.normalize(saved, T0 + 31 * 60000)
  assert.equal(back.aff, Math.round(s.aff * 100) / 100)
  assert.equal(back.moodlets.length, s.moodlets.length)
  assert.equal(back.history.length, 1)
  assert.equal(back.today.key, s.today.key)
  assert.equal(back.today.pets, 3)
  assert.ok(JSON.stringify(saved).length < 1500)
  for (const raw of [null, 7, 'x', [], { mood: 'high', moodlets: 'none', today: { key: 'k', pets: 'many' } }]) {
    const n = E.normalize(raw, T0)
    assert.equal(n.mood, 60)
    assert.equal(n.moodlets.length, 0)
    assert.equal(typeof n.today.pets, 'number')
  }
  assert.equal(E.normalize({ aff: 999 }, T0).aff, 100)
})

// Ticks every minute from `from` for `mins` minutes (as companion.js does); `each(m, now)` runs before each
// tick. Returns the lowest mood seen.
function minutes(s, from, mins, { present = true, sinceTouch = 0, each = null, speed = null, fade = null } = {}) {
  let lowest = s.mood
  for (let m = 1; m <= mins; m++) {
    const now = from + m * 60000
    each?.(m, now)
    E.tick(s, now, { present, sinceTouch, speed, fade })
    lowest = Math.min(lowest, s.mood)
  }
  return lowest
}
const NINE = new Date(2026, 9, 1, 9).getTime() // 09:00: twenty hours before the next 05:00 roll

test('emotion: transitionSpeed: joy fast, frustration medium, sadness slow; unset keeps the one pace', () => {
  // One hour of drift, no moodlets: how much of the gap to the target closes.
  const closed = (mood, anx, sp) => {
    const s = E.create(NINE)
    s.mood = mood
    s.anx = anx
    const t0 = E.target({ ...s, anx: anx * Math.pow(0.5, 60 / E.P.anxHalfMin) }) // decay eases the anxiety first
    E.decay(s, NINE, 1, { present: true, idle: false, speed: sp })
    return (s.mood - mood) / (t0 - mood)
  }
  const p = E.P.moodPullPerHour // 0.3
  // Not set (or set to something meaningless): the old single pace, in every direction.
  for (const sp of [undefined, null, false, 0, 'fast', [1, 2, 3]]) assert.equal(E.speed(sp), null, String(sp))
  for (const [mood, anx] of [[20, 0], [95, 0], [95, 80]]) assert.equal(f1(closed(mood, anx, null)), f1(p))
  // true: the defaults. Rising → happy ×2; falling while anxious → angry ×1; falling → sad ×0.5.
  const def = E.speed(true)
  assert.deepEqual({ ...def }, { happy: 2, angry: 1, sad: 0.5 })
  assert.equal(closed(20, 0, def).toFixed(4), (p * 2).toFixed(4), 'happy: 60 % of the gap in an hour')
  assert.equal(closed(95, 80, def).toFixed(4), (p * 1).toFixed(4), 'angry: 30 %, as before')
  assert.equal(closed(95, 0, def).toFixed(4), (p * 0.5).toFixed(4), 'sad: 15 %')
  const kind = (mood, anx) => E.transitionKind(Object.assign(E.create(NINE), { mood, anx }))
  assert.deepEqual([kind(20, 0), kind(95, 80), kind(95, 0)], ['happy', 'angry', 'sad'])
  // A pet's own numbers over the defaults; out of 0.1..3 or not a number keeps the default.
  const own = E.speed({ happy: 3, sad: 0.2, angry: 9 })
  assert.deepEqual({ ...own }, { happy: 3, angry: 1, sad: 0.2 })
  assert.deepEqual({ ...E.speed({ happy: NaN, angry: '2', sad: 0.05 }) }, { ...E.TRANSITION })
  assert.ok(Object.isFrozen(own) && Object.isFrozen(E.TRANSITION))
  assert.equal(closed(95, 0, own).toFixed(4), (p * 0.2).toFixed(4))
  // Through tick (as companion.js calls it): a happy pet climbs faster and a sad one sinks slower than before.
  const climb = (sp) => {
    const s = E.create(NINE)
    s.mood = 20
    minutes(s, NINE, 60, { speed: sp })
    return s.mood
  }
  const sink = (sp) => {
    const s = E.create(NINE)
    s.mood = 95
    minutes(s, NINE, 60, { speed: sp })
    return s.mood
  }
  assert.ok(climb(def) > climb(null) + 5, `climb ${f1(climb(def))} vs ${f1(climb(null))}`)
  assert.ok(sink(def) > sink(null) + 3, `sink ${f1(sink(def))} vs ${f1(sink(null))}`)
  for (const v of [climb(def), sink(def)]) assert.ok(v >= 0 && v <= 100)
})

test('emotion: fadeBias: a bad moment wears off sooner than a good one, and the mood is back sooner', () => {
  const fd = E.fade(true)
  assert.deepEqual({ ...fd }, { negative: 1.5, positive: 1 })
  assert.ok(Object.isFrozen(fd) && Object.isFrozen(E.FADE))
  // One ignored (−8, 3 h) and one asked (+10, 4 h) at 09:00, then a minute tick.
  const after = (fade, mins) => {
    const s = E.create(NINE)
    s.mood = E.P.moodBase
    E.event(s, 'ignored', NINE)
    E.event(s, 'asked', NINE)
    minutes(s, NINE, mins, { fade })
    return s
  }
  const has = (s, kind) => s.moodlets.some((m) => m.kind === kind)
  // 2 h 10 min in: on the faster clock the ignored one is gone (3 h ÷ 1.5 = 2 h); the asked one is untouched.
  assert.ok(!has(after(fd, 130), 'ignored') && has(after(fd, 130), 'asked'))
  assert.ok(has(after(null, 130), 'ignored'))
  assert.equal(after(fd, 130).moodlets.find((m) => m.kind === 'asked').until, NINE + 4 * H)
  // The panel's minutes left are real minutes.
  const v = E.view(after(fd, 60), NINE + 60 * 60000, E.WORDS, fd)
  assert.equal(v.moodlets.find((m) => m.kind === 'ignored').leftMin, 60)
  assert.equal(v.moodlets.find((m) => m.kind === 'asked').leftMin, 180)
  // A sad pet climbs back toward its usual mood faster.
  const back = (fade) => {
    const s = E.create(NINE)
    s.mood = E.P.moodBase
    for (let i = 0; i < 2; i++) E.event(s, 'ignored', NINE)
    minutes(s, NINE, 60, { sinceTouch: 0 })
    const low = s.mood
    minutes(s, NINE + H, 150, { fade })
    return { low, end: s.mood }
  }
  const [slow, quick] = [back(null), back(fd)]
  assert.ok(quick.end > slow.end + 2, `quick ${f1(quick.end)} vs ${f1(slow.end)} (from ${f1(slow.low)})`)
  // Over a long catch-up (Orca closed) the faster clock is exact too: nothing lingers past its share.
  const s = E.create(NINE)
  E.event(s, 'late', NINE) // −5 until 05:00: 20 h, 13 h 20 min on the faster clock
  E.tick(s, NINE + 13 * H, { fade: fd })
  assert.ok(has(s, 'late'))
  E.tick(s, NINE + 14 * H, { fade: fd })
  assert.ok(!has(s, 'late'))
  // A pet's own numbers over the defaults (0.1..3, anything else keeps the default).
  assert.deepEqual({ ...E.fade({ negative: 2, positive: 0.5 }) }, { negative: 2, positive: 0.5 })
  assert.deepEqual({ ...E.fade({ negative: 9, positive: 'x' }) }, { ...E.FADE })
})

test('emotion: fadeBias not set: every moodlet lasts its own hours, exactly as before', () => {
  for (const f of [undefined, null, false, 0, 'fast', [1.5, 1]]) assert.equal(E.fade(f), null, String(f))
  const day = (fade) => {
    const s = E.create(NINE)
    for (const k of ['ignored', 'fail', 'asked', 'pet', 'late']) E.event(s, k, NINE)
    const trace = []
    minutes(s, NINE, 6 * 60, { each: (m) => m % 30 === 0 && trace.push(s.mood), ...(fade === undefined ? {} : { fade }) })
    return { trace, saved: E.serialize(s, NINE + 6 * H), view: E.view(s, NINE + 6 * H, E.WORDS, fade ?? null).moodlets }
  }
  const before = day(undefined)
  assert.deepEqual(day(null), before)
  // Rates of 1 on both sides are the same as not set.
  assert.deepEqual(day(E.fade({ negative: 1, positive: 1 })), before)
})

test('emotion: every number stays inside 0..100, however hard it is pushed', () => {
  const inRange = (s, why) => {
    for (const k of ['mood', 'aff', 'close', 'anx', 'lone']) assert.ok(Number.isFinite(s[k]) && s[k] >= 0 && s[k] <= 100, `${why}: ${k} = ${s[k]}`)
    const t = E.target(s)
    assert.ok(t >= 0 && t <= 100, `${why}: target ${t}`)
  }
  // Everything bad at once: the target bottoms out at 0, never below.
  const bad = E.create(NINE)
  for (let i = 0; i < 200; i++) for (const k of ['fail', 'agentFail', 'ignored', 'bug', 'late']) E.event(bad, k, NINE)
  assert.ok(bad.anx > 99 && bad.anx <= 100, `anxiety ${bad.anx}`)
  assert.equal(E.target(bad), 0)
  minutes(bad, NINE, 16 * 60, { sinceTouch: Infinity })
  inRange(bad, 'all bad')
  assert.equal(bad.lone, E.P.lonePresentCap, 'loneliness stops at its cap while you are here')
  // Everything good at once: the target tops out at 100.
  const good = E.create(NINE)
  good.aff = 99.5
  good.peakTier = 4
  for (let i = 0; i < 50; i++) for (const k of E.EVENTS) if (!['fail', 'agentFail', 'ignored', 'bug', 'late', 'pass'].includes(k)) E.event(good, k, NINE, 3 * H)
  assert.equal(E.target(good), 100)
  minutes(good, NINE, 6 * 60)
  inRange(good, 'all good')
  // A gap of years, away the whole time.
  const gone = E.create(NINE)
  E.tick(gone, NINE + 1000 * DAY, { present: false })
  inRange(gone, 'years away')
  assert.equal(gone.lone, E.P.loneAwayCap)
  // Hand-edited saves are pulled back into range.
  const n = E.normalize({ mood: -50, anx: 500, lone: NaN, close: 1e9, aff: -3, awayLoss: -99 }, NINE)
  assert.deepEqual([n.mood, n.anx, n.lone, n.close, n.aff, n.awayLoss], [0, 100, 0, 100, 0, E.P.awayCapTotal])
})

test('emotion: left alone, the mood drifts back to its usual level from either end', () => {
  const usual = (s) => E.P.moodBase + (s.aff / 100) * E.P.affBonusToMood
  for (const start of [0, 100]) {
    const s = E.create(NINE)
    s.mood = start
    assert.ok(Math.abs(E.target(s) - usual(s)) < 1e-9, 'no moodlets, no worries: the target is the usual level')
    const gap = Math.abs(start - usual(s))
    minutes(s, NINE, 120)
    const left = Math.abs(s.mood - usual(s)) / gap
    assert.ok(left > 0.45 && left < 0.55, `from ${start}: about half the gap closes in two hours (${f1(left)} left)`)
    assert.ok(start ? s.mood > usual(s) : s.mood < usual(s), 'it approaches without overshooting')
    minutes(s, NINE + 120 * 60000, 14 * 60)
    assert.ok(Math.abs(s.mood - usual(s)) < 0.5, `from ${start}: back to ${f1(usual(s))} by night (${f1(s.mood)})`)
  }
  // Anxiety halves every 90 minutes.
  const calm = E.create(NINE)
  calm.anx = 80
  minutes(calm, NINE, 90)
  assert.equal(f1(calm.anx), 40)
  // A moodlet lifts it for its hours; afterwards both settle at the same usual level.
  const twins = [E.create(NINE), E.create(NINE)]
  for (const s of twins) (s.anx = 80), (s.mood = E.target(s))
  E.event(twins[0], 'thanks', NINE)
  for (const s of twins) minutes(s, NINE, 60)
  assert.ok(twins[0].mood > twins[1].mood + 0.8, `thanked ${f1(twins[0].mood)} vs ${f1(twins[1].mood)}`)
  for (const s of twins) minutes(s, NINE + H, 18 * 60)
  assert.equal(twins[0].moodlets.length, 0, 'the moodlet has expired')
  for (const s of twins) assert.ok(s.anx < 0.5 && Math.abs(s.mood - usual(s)) < 0.5, `settled at ${f1(s.mood)}`)
  assert.ok(Math.abs(twins[0].mood - twins[1].mood) < 0.05)
})

test('emotion: a red afternoon sinks it under the sulk line; once a day; consoled, it climbs back', () => {
  // A failure and an agent failure every 15 minutes, six hours long; you stay near (no loneliness).
  const red = () => {
    const s = E.create(NINE)
    s.aff = 30
    s.peakTier = 1
    const lowest = minutes(s, NINE, 6 * 60, { each: (m, now) => m % 15 === 0 && (E.event(s, 'fail', now), E.event(s, 'agentFail', now)) })
    return { s, lowest }
  }
  const sulkEnd = NINE + 6 * H
  const { s, lowest } = red()
  assert.ok(lowest < E.P.sulkBelow, `lowest ${f1(lowest)} under ${E.P.sulkBelow}`)
  assert.equal(E.view(s, sulkEnd).sulkedToday, false)
  assert.equal(s.aff, 30, 'failures never cost affection')
  // companion.js books the day's sulk on the state; it survives a save and is cleared at 05:00.
  s.today.sulked = true
  const saved = E.normalize(JSON.parse(JSON.stringify(E.serialize(s, sulkEnd))), sulkEnd)
  assert.equal(saved.today.sulked, true, 'reopening Orca the same day does not allow a second sulk')
  assert.equal(E.view(saved, sulkEnd).sulkedToday, true)
  // Three pats win it back; the model only hears 「comforted」 on the third.
  const twin = red().s
  twin.today.sulked = true
  assert.equal(E.event(s, 'comforted', sulkEnd), true)
  assert.ok(s.moodlets.some((m) => m.kind === 'comforted' && m.v === E.ML.comforted[0]))
  assert.ok(s.today.interacted && !twin.today.interacted, 'being consoled counts as time together')
  minutes(s, sulkEnd, 3.5 * 60)
  minutes(twin, sulkEnd, 3.5 * 60)
  assert.ok(s.mood > twin.mood + 4, `consoled ${f1(s.mood)} vs left alone ${f1(twin.mood)}`)
  assert.ok(s.mood > E.P.sulkBelow, `back above the sulk line (${f1(s.mood)})`)
  // Next morning: a fresh day may sulk again; the consoled day was a day together, the other a quiet one.
  const morning = NINE + 21 * H // 06:00
  E.tick(s, morning, { present: true })
  E.tick(twin, morning, { present: true })
  assert.equal(s.today.sulked, false)
  assert.equal(twin.today.sulked, false)
  assert.ok(s.aff > 30 && s.close > 0, `consoled: ${f1(s.aff)}`)
  assert.equal(f1(twin.aff), 29.4, 'Orca open all day without a touch: the quiet-day cost')
})

test('emotion: a pet that leaves out a field (or gets one wrong) keeps the default for it', () => {
  const same = (W, keys) => {
    for (const k of keys) assert.deepEqual(JSON.parse(JSON.stringify(W[k])), JSON.parse(JSON.stringify(E.WORDS[k])), k)
  }
  const all = ['tiers', 'stages', 'moods', 'anxious', 'lonely', 'moodlets', 'calm', 'tired', 'missed', 'nothing']
  same(E.words({}), all)
  same(E.words(undefined), all)
  // Only tiers given: everything else stays the engine's.
  const onlyTiers = E.words({ tiers: ['一', '二', '三', '四', '五'] })
  assert.equal(E.tierName(85, onlyTiers), '五')
  same(onlyTiers, all.filter((k) => k !== 'tiers'))
  assert.equal(E.moodWord(60, onlyTiers), '平靜')
  // Only some moodlets: the rest keep their labels; too long or not a string keeps the default.
  const some = E.words({ moodlets: { pet: '呼嚕', fail: 'x'.repeat(25), thanks: 3 } })
  assert.equal(some.moodlets.pet, '呼嚕')
  for (const k of ['fail', 'thanks', 'reunion']) assert.equal(some.moodlets[k], E.WORDS.moodlets[k], k)
  // Wrong length, a hole in a list, a blank or over-long sentence: each field falls back on its own.
  const W = E.words({
    anxious: [[0, '怕']],
    lonely: [[0, '想'], [0, ''], [0, '摸']],
    stages: [[0, 'a'], [0, 'b'], [0, 'c'], [0, 'd'], [0, 'e']],
    calm: '',
    tired: 'y'.repeat(61),
    missed: '想你。'
  })
  same(W, ['anxious', 'lonely', 'calm', 'tired', 'nothing', 'tiers', 'moods', 'moodlets'])
  assert.equal(E.stageName(80, W), 'a', 'a complete list is used, with the engine thresholds')
  assert.equal(W.missed, '想你。')
  assert.equal(E.anxWord(80, W), '很不安')
  assert.equal(E.loneWord(65, W), '好想你')
  assert.ok(Object.isFrozen(W) && Object.isFrozen(E.WORDS))
  // The view labels with the pet's words and falls back for the rest.
  const s = E.create(NINE)
  E.event(s, 'pet', NINE)
  E.event(s, 'thanks', NINE)
  const labels = Object.fromEntries(E.view(s, NINE, some).moodlets.map((m) => [m.kind, m.label]))
  assert.deepEqual(labels, { pet: '呼嚕', thanks: E.WORDS.moodlets.thanks })
})
