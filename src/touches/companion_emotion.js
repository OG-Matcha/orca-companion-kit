// companion_emotion.js: how a pet feels, as a pure model (no DOM, no timers). Every pet made with
// registerCompanion gets one (unless its config says `emotion: false`); companion.js drives it and the
// settings panel's first tab reads it. Five numbers on three time scales, the way life-sim games keep a
// character's mood and a relationship apart:
//   mood   0..100  hours:  pulled toward a target made of short-lived moodlets, anxiety and loneliness
//   anx    0..100  hours:  failures pile it up; half-life 90 min; a success right after halves it; a night ×0.3
//   lone   0..100  hours:  grows while you are here but not touching it (or slowly while you are away)
//   aff    0..100  weeks:  affection; rises and falls, never below the floor of the highest tier reached
//   close  0..100  months: closeness; only rises, once per day you two spent together
// The panel shows mood, anxiety and loneliness as words (numbers while Alt is held), affection as hearts
// and a tier name, closeness as a stage with a bar. Every word is the pet's to change (`emotion.words`).
// Failures make it sad and anxious, never fond of you any less. Days away cost nothing for three days,
// then 0.3 a day, 4 at most. What really costs affection is Orca open all day without a single touch.
// Time is Date.now() ms throughout; a day rolls over at 05:00, so a late night counts with the day before.
// Exposed as T.companionEmotion; test/companion-emotion.test.mjs replays 30-day simulations through it.
;(() => {
  const T = window.__orcaThemer
  if (!T) return
  const H = 3600000
  const ROLL_HOUR = 5
  const pad = (n) => String(n).padStart(2, '0')
  // YYYY-MM-DD of the logical day (05:00 to 05:00, local time).
  const dayKey = (date = new Date()) => {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() - ROLL_HOUR, date.getMinutes())
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  // The next 05:00 after `ms`.
  function nextRoll(ms) {
    const d = new Date(ms)
    const roll = new Date(d.getFullYear(), d.getMonth(), d.getDate(), ROLL_HOUR)
    if (roll.getTime() <= ms) roll.setDate(roll.getDate() + 1)
    return roll.getTime()
  }

  // The tuning. A heavy user (15 pets a day) reaches about 52 in 30 days, 60 in five to six weeks, 80 in
// about three months; someone at Orca on weekdays only, about 28 in a month.
  const P = Object.freeze({
    moodStart: 60,
    moodBase: 55,
    moodPullPerHour: 0.3, // about 2 h to close half the gap
    anxToMood: 0.5,
    loneToMood: 0.3,
    affBonusToMood: 8,
    affStart: 5,
    affMigrated: 60, // a pet that already knew you before it had feelings
    affK: 108, // gains × (1 − aff/108): the top is a long way off
    affDayCap: 2.5,
    tiers: [20, 40, 60, 80],
    pet: 0.4,
    petAfterN: 6,
    petTail: 0.05,
    asked: 0.8,
    played: 0.1,
    playedDayCap: 0.5,
    dayTogether: 0.5,
    milestone: 1,
    comfortBonus: 0.5, // petted while anxious: through thick and thin
    anxiousAt: 50,
    ignored: -0.8,
    ignoredDayCap: -1.6,
    quietDay: -0.6, // Orca open all day, never a touch
    awayGraceDays: 3,
    awayPerDay: -0.3,
    awayCapTotal: -4,
    closeLo: 0.25,
    closeHi: 0.6,
    anxHalfMin: 90,
    anxFail: 12,
    anxAgentFail: 8,
    anxBug: 4,
    anxPassMul: 0.5,
    anxSleepMul: 0.3,
    passWithinMs: H,
    lonePresentPerHour: 5,
    lonePresentCap: 70,
    loneIdleMs: 2 * H, // "not touching it" starts after this
    loneAwayPerHour: 1.2,
    loneAwayCap: 55,
    lonePet: 30,
    reunionDays: 3,
    sulkBelow: 20,
    lowBelow: 35,
    historyEveryMs: 30 * 60000,
    historyKeep: 48
  })
  // Moodlets: [value, hours, max layers]. Full: the oldest layer's clock restarts instead.
  const ML = Object.freeze({
    pet: [6, 2, 3],
    asked: [10, 4, 1],
    ignored: [-8, 3, 2],
    played: [3, 1, 4],
    fail: [-4, 1.5, 5],
    agentFail: [-4, 1.5, 5],
    passAfterFail: [9, 2, 1],
    rough: [-8, 8, 1],
    late: [-5, 6, 1],
    reunion: [15, 6, 1],
    back: [6, 2, 1],
    milestone: [20, 24, 1],
    agentDone: [3, 1, 3],
    thanks: [4, 2, 2],
    sing: [4, 1, 1],
    comforted: [12, 4, 1]
  })
  const FAILS = ['fail', 'agentFail']

  // ---------- how fast the mood moves (opt-in: registerCompanion({ emotion: { transitionSpeed } })) ----------
  // Joy shows quickly, frustration at an ordinary pace, sadness settles in slowly. Multipliers of
  // moodPullPerHour, picked by where the mood is heading: up → happy; down while anxious → angry; down → sad.
  // Not set: one speed for everything, as before.
  const TRANSITION = Object.freeze({ happy: 2, angry: 1, sad: 0.5 })
  const SPEED_MIN = 0.1
  const SPEED_MAX = 3
  // A pet's setting → frozen { happy, angry, sad } or null. true: the defaults; an object: its valid numbers
  // over the defaults (0.1..3; anything else keeps the default); anything else: null (the old single speed).
  function speed(custom) {
    if (custom === true) return TRANSITION
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) return null
    const out = { ...TRANSITION }
    for (const k of Object.keys(TRANSITION)) {
      const v = custom[k]
      if (typeof v === 'number' && Number.isFinite(v) && v >= SPEED_MIN && v <= SPEED_MAX) out[k] = v
    }
    return Object.freeze(out)
  }
  const transitionKind = (s) => (target(s) >= s.mood ? 'happy' : s.anx >= P.anxiousAt ? 'angry' : 'sad')
  const pullPerHour = (s, sp) => (sp ? Math.min(0.95, P.moodPullPerHour * sp[transitionKind(s)]) : P.moodPullPerHour)

  // ---------- words: every one can be replaced per pet (registerCompanion({ emotion: { words } })) ----------
  const WORDS = Object.freeze({
    tiers: ['初識', '熟悉', '信賴', '知心', '最要好'], // affection: < 20, 20, 40, 60, 80
    stages: [
      [75, '開花'],
      [50, '含苞'],
      [25, '長葉'],
      [10, '發芽'],
      [0, '種子']
    ], // closeness
    moods: [
      [85, '雀躍', '✧'],
      [70, '開心', '♡'],
      [50, '平靜', '～'],
      [35, '有點悶', '☁'],
      [20, '低落', '…'],
      [0, '消沉', '。。']
    ],
    anxious: [
      [70, '很不安'],
      [50, '有點擔心你'],
      [20, '有一點點緊張']
    ],
    lonely: [
      [60, '好想你'],
      [40, '有點想你'],
      [25, '想被摸摸']
    ],
    moodlets: {
      pet: '被摸頭了',
      asked: '討摸有回應',
      ignored: '討摸被晾著',
      played: '一起玩了',
      fail: '一直沒過',
      agentFail: 'Agent 出錯了',
      passAfterFail: '終於過了',
      rough: '今天好累',
      late: '熬夜了',
      reunion: '久別重逢',
      back: '你回來了',
      milestone: '紀念日',
      agentDone: 'Agent 做完了',
      thanks: '被謝謝了',
      sing: '唱了歌',
      comforted: '被哄好了'
    },
    calm: '牠很安心。',
    tired: '牠有點累，但不擔心什麼。',
    missed: '你不在的時候，牠有點想你',
    nothing: '沒什麼特別的事，就這樣安安靜靜的。'
  })
  const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 24
  const sameShape = (mine, base) => Array.isArray(mine) && mine.length === base.length && mine.every((m, i) => (Array.isArray(base[i]) ? Array.isArray(m) && isStr(m[1]) : isStr(m)))
  // A pet's own words over the defaults; anything malformed keeps the default. Thresholds stay the engine's.
  function words(custom) {
    const c = custom && typeof custom === 'object' ? custom : {}
    const out = { ...WORDS, moodlets: { ...WORDS.moodlets } }
    for (const k of ['tiers', 'stages', 'moods', 'anxious', 'lonely'])
      if (sameShape(c[k], WORDS[k])) out[k] = Array.isArray(WORDS[k][0]) ? WORDS[k].map((d, i) => [d[0], c[k][i][1], ...(d.length > 2 ? [isStr(c[k][i][2]) ? c[k][i][2] : d[2]] : [])]) : [...c[k]]
    if (c.moodlets && typeof c.moodlets === 'object') for (const k in ML) if (isStr(c.moodlets[k])) out.moodlets[k] = c.moodlets[k]
    for (const k of ['calm', 'tired', 'missed', 'nothing']) if (typeof c[k] === 'string' && c[k].length > 0 && c[k].length <= 60) out[k] = c[k]
    return Object.freeze(out)
  }
  const tierIndex = (aff) => P.tiers.filter((t) => aff >= t).length // 0..4
  const band = (list, v) => list.find(([min]) => v >= min) ?? null
  const tierName = (aff, W = WORDS) => W.tiers[tierIndex(aff)]
  const stageName = (close, W = WORDS) => band(W.stages, close)[1]
  const nextStage = (close, W = WORDS) => [...W.stages].reverse().find(([min]) => close < min) ?? null
  const moodBand = (mood, W = WORDS) => band(W.moods, mood)
  const moodWord = (mood, W = WORDS) => moodBand(mood, W)[1]
  const anxWord = (anx, W = WORDS) => band(W.anxious, anx)?.[1] ?? ''
  const loneWord = (lone, W = WORDS) => band(W.lonely, lone)?.[1] ?? ''

  // ---------- state ----------
  const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))
  const r2 = (v) => Math.round(v * 100) / 100
  const freshDay = (key) => ({ key, aff: 0, ign: 0, played: 0, pets: 0, present: false, interacted: false, sulked: false })
  function create(now = Date.now()) {
    return {
      v: 1,
      mood: P.moodStart,
      aff: P.affStart,
      close: 0,
      anx: 0,
      lone: 0,
      peakTier: 0,
      moodlets: [],
      awayDays: 0,
      awayLoss: 0,
      lastFail: 0,
      lastTick: now,
      lastHistory: now,
      history: [],
      today: freshDay(dayKey(new Date(now)))
    }
  }
  // A save from before there were feelings (bond: { days, pets }): the pet already knows you, affection
  // starts at 60 (one tier left to climb) and the days together count toward closeness as if scored then.
  function migrate(bond, now = Date.now()) {
    const s = create(now)
    const days = Number(bond?.days) || 0
    if (days <= 0 && !(Number(bond?.pets) > 0)) return s
    s.aff = P.affMigrated
    s.peakTier = tierIndex(s.aff)
    for (let i = 0; i < days; i++) s.close += (P.closeLo + (P.closeHi - P.closeLo) * (s.aff / 100)) * (1 - s.close / 100)
    s.close = r2(s.close)
    return s
  }
  // Whatever was saved (old, partial, hand-edited) → a complete, sane state.
  function normalize(raw, now = Date.now()) {
    const s = create(now)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s
    const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d)
    s.mood = num(raw.mood, 0, 100, s.mood)
    s.aff = num(raw.aff, 0, 100, s.aff)
    s.close = num(raw.close, 0, 100, s.close)
    s.anx = num(raw.anx, 0, 100, 0)
    s.lone = num(raw.lone, 0, 100, 0)
    s.peakTier = Math.max(Math.round(num(raw.peakTier, 0, P.tiers.length, 0)), tierIndex(s.aff))
    s.awayDays = Math.round(num(raw.awayDays, 0, 100000, 0))
    s.awayLoss = num(raw.awayLoss, P.awayCapTotal, 0, 0)
    s.lastFail = num(raw.lastFail, 0, Infinity, 0)
    s.lastTick = num(raw.lastTick, 0, now, now)
    s.lastHistory = num(raw.lastHistory, 0, now, now)
    s.moodlets = Array.isArray(raw.moodlets) ? raw.moodlets.filter((m) => m && ML[m.kind] && typeof m.until === 'number' && m.until > now).map((m) => ({ kind: m.kind, v: ML[m.kind][0], until: m.until })) : []
    s.history = Array.isArray(raw.history) ? raw.history.filter((h) => Array.isArray(h) && h.length === 2 && typeof h[0] === 'number' && typeof h[1] === 'number').slice(-P.historyKeep) : []
    if (raw.today && typeof raw.today === 'object' && typeof raw.today.key === 'string') {
      const d = freshDay(raw.today.key)
      for (const k of Object.keys(d)) if (k !== 'key' && typeof raw.today[k] === typeof d[k]) d[k] = raw.today[k]
      s.today = d
    }
    return s
  }
  // Compact for localStorage: two decimals, nothing expired.
  const serialize = (s, now = Date.now()) => ({
    v: 1,
    mood: r2(s.mood),
    aff: r2(s.aff),
    close: r2(s.close),
    anx: r2(s.anx),
    lone: r2(s.lone),
    peakTier: s.peakTier,
    moodlets: s.moodlets.filter((m) => m.until > now).map((m) => ({ kind: m.kind, until: m.until })),
    awayDays: s.awayDays,
    awayLoss: r2(s.awayLoss),
    lastFail: s.lastFail,
    lastTick: s.lastTick,
    lastHistory: s.lastHistory,
    history: s.history,
    today: { ...s.today, aff: r2(s.today.aff), ign: r2(s.today.ign), played: r2(s.today.played) }
  })

  // ---------- the model ----------
  const tierFloor = (s) => (s.peakTier ? P.tiers[s.peakTier - 1] : 0)
  function addMoodlet(s, kind, now, hours = ML[kind][1]) {
    const [v, , cap] = ML[kind]
    const same = s.moodlets.filter((m) => m.kind === kind)
    if (same.length >= cap) same.sort((a, b) => a.until - b.until)[0].until = now + hours * H
    else s.moodlets.push({ kind, v, until: now + hours * H })
  }
  // Positive: eased toward the top and capped per day. Either way never below the tier floor already reached.
  function gainAff(s, x) {
    if (x > 0) {
      x *= 1 - s.aff / P.affK
      x = Math.min(x, P.affDayCap - s.today.aff)
      if (x <= 0) return
      s.today.aff += x
    }
    s.aff = clamp(s.aff + x, tierFloor(s), 100)
    while (s.peakTier < P.tiers.length && s.aff >= P.tiers[s.peakTier]) s.peakTier++
  }
  const interact = (s) => (s.today.interacted = s.today.present = true)
  const target = (s) => clamp(P.moodBase + s.moodlets.reduce((a, m) => a + m.v, 0) - P.anxToMood * s.anx - P.loneToMood * s.lone + (s.aff / 100) * P.affBonusToMood)
  const bump = (s, k) => (s.anx = clamp(s.anx + k * (1 - s.anx / 100)))
  const failed = (s, now, kind, k) => {
    bump(s, k)
    addMoodlet(s, kind, now)
    s.lastFail = now
    if (s.anx >= P.anxiousAt) addMoodlet(s, 'rough', now)
  }

  // Something happened. `arg`: ms you were gone (back).
  const EVENTS = {
    pet(s, now) {
      interact(s)
      s.today.pets++
      if (s.anx >= P.anxiousAt) gainAff(s, P.comfortBonus)
      gainAff(s, s.today.pets <= P.petAfterN ? P.pet : P.petTail)
      addMoodlet(s, 'pet', now)
      s.lone = Math.max(0, s.lone - P.lonePet)
    },
    // It asked for something and you did (a pet of yours can call this; on top of the pet itself).
    asked(s, now) {
      interact(s)
      if (s.anx >= P.anxiousAt) gainAff(s, P.comfortBonus)
      gainAff(s, P.asked)
      addMoodlet(s, 'asked', now)
    },
    // It asked and you let it wait: one of the two things that really cost (capped per day).
    ignored(s, now) {
      const x = Math.max(P.ignored, P.ignoredDayCap - s.today.ign)
      if (x < 0) {
        s.today.ign += x
        gainAff(s, x)
      }
      addMoodlet(s, 'ignored', now)
    },
    // A game together (found it in hide-and-seek, and the like).
    played(s, now) {
      interact(s)
      if (s.today.played < P.playedDayCap) (s.today.played += P.played), gainAff(s, P.played)
      addMoodlet(s, 'played', now)
    },
    fail: (s, now) => failed(s, now, 'fail', P.anxFail),
    agentFail: (s, now) => failed(s, now, 'agentFail', P.anxAgentFail),
    bug(s) {
      bump(s, P.anxBug)
    },
    // Success within the hour after a failure: the red moodlets go, the anxiety halves.
    pass(s, now) {
      if (!s.lastFail || now - s.lastFail > P.passWithinMs) return false
      s.anx *= P.anxPassMul
      s.moodlets = s.moodlets.filter((m) => !FAILS.includes(m.kind))
      s.lastFail = 0
      addMoodlet(s, 'passAfterFail', now)
    },
    agentDone(s, now) {
      addMoodlet(s, 'agentDone', now)
    },
    thanks(s, now) {
      interact(s)
      addMoodlet(s, 'thanks', now)
    },
    sing(s, now) {
      interact(s)
      addMoodlet(s, 'sing', now)
    },
    // Up in the small hours: a cloud until the day rolls over (05:00), not a mark against you.
    late(s, now) {
      addMoodlet(s, 'late', now, Math.max(1, (nextRoll(now) - now) / H))
    },
    // Back after a while away (ms): loneliness is forgotten at once; a long gap is a small joy.
    back(s, now, gone = 0) {
      s.lone = 0
      if (gone > 2 * H) addMoodlet(s, 'back', now)
    },
    reunion(s, now) {
      s.lone = 0
      addMoodlet(s, 'reunion', now)
    },
    milestone(s, now) {
      interact(s)
      gainAff(s, P.milestone)
      addMoodlet(s, 'milestone', now)
    },
    // Won back from a sulk.
    comforted(s, now) {
      interact(s)
      addMoodlet(s, 'comforted', now)
    }
  }
  function event(s, kind, now = Date.now(), arg) {
    const fn = Object.hasOwn(EVENTS, kind) ? EVENTS[kind] : null
    if (!fn) return false
    return fn(s, now, arg) !== false
  }

  // Passive change over `h` hours. present: you are at Orca. idle: no touch for a long while.
  // speed: from speed() (null: the one default pace).
  function decay(s, now, h, { present, idle, speed: sp = null }) {
    s.moodlets = s.moodlets.filter((m) => m.until > now)
    s.anx *= Math.pow(0.5, (h * 60) / P.anxHalfMin)
    if (s.anx < 0.01) s.anx = 0
    if (present && idle) s.lone = Math.min(P.lonePresentCap, s.lone + P.lonePresentPerHour * h)
    if (!present && s.lone < P.loneAwayCap) s.lone = Math.min(P.loneAwayCap, s.lone + P.loneAwayPerHour * h)
    s.mood = clamp(s.mood + (target(s) - s.mood) * (1 - Math.pow(1 - pullPerHour(s, sp), h)))
  }
  // The day is over (05:00). present: Orca was open with you around that day; interacted: you touched it.
  function dayEnd(s, present, interacted) {
    if (present && interacted) {
      s.awayDays = 0
      s.awayLoss = 0
      gainAff(s, P.dayTogether)
      s.close = clamp(s.close + (P.closeLo + (P.closeHi - P.closeLo) * (s.aff / 100)) * (1 - s.close / 100))
    } else if (present) gainAff(s, P.quietDay)
    else {
      s.awayDays++
      if (s.awayDays > P.awayGraceDays && s.awayLoss > P.awayCapTotal) {
        const x = Math.max(P.awayPerDay, P.awayCapTotal - s.awayLoss)
        s.awayLoss += x
        gainAff(s, x)
      }
    }
    s.anx *= P.anxSleepMul
  }
  // Time passed: called every minute while the pet is on screen, and once at start-up to catch up on the
  // time Orca was closed (days are rolled one by one; a long gap counts as time away).
  // ctx.present: you are here now. ctx.sinceTouch: ms since you last touched it. ctx.speed: from speed().
  function tick(s, now = Date.now(), { present = false, sinceTouch = Infinity, speed: sp = null } = {}) {
    let cursor = s.lastTick
    const out = { rolled: 0, returned: false }
    if (now <= cursor) return out
    const wasAway = now - cursor > 10 * 60000 // nobody ticks for ten minutes while Orca is open
    const idle = sinceTouch > P.loneIdleMs
    for (let roll = nextRoll(cursor); roll <= now; roll = nextRoll(roll)) {
      decay(s, roll, (roll - cursor) / H, { present: !wasAway && present, idle, speed: sp })
      dayEnd(s, s.today.present, s.today.interacted)
      s.today = freshDay(dayKey(new Date(roll)))
      out.rolled++
      cursor = roll
    }
    decay(s, now, (now - cursor) / H, { present: !wasAway && present, idle, speed: sp })
    s.lastTick = now
    if (present) {
      // The first time today after a day or more away: it stops missing you; after three, a reunion.
      if (!s.today.present && s.awayDays >= 1) {
        out.returned = s.awayDays
        if (s.awayDays >= P.reunionDays) EVENTS.reunion(s, now)
        else s.lone = 0
      }
      s.today.present = true
    }
    if (now - s.lastHistory >= P.historyEveryMs) {
      s.lastHistory = now
      s.history.push([now, Math.round(s.mood)])
      if (s.history.length > P.historyKeep) s.history.splice(0, s.history.length - P.historyKeep)
    }
    return out
  }

  // ---------- what the engine and the panel read ----------
  // How the feelings lean the idle picks: added to the short-term mood levels.
  const lean = (s) => ({ happy: clamp((s.mood - 50) / 100, -0.5, 0.5), bored: clamp(s.lone / 200, 0, 0.5), worried: clamp(s.anx / 150, 0, 0.67) })
  function view(s, now = Date.now(), W = WORDS) {
    const groups = new Map()
    for (const m of s.moodlets) {
      if (m.until <= now) continue
      const g = groups.get(m.kind) ?? { kind: m.kind, label: W.moodlets[m.kind] ?? m.kind, v: 0, count: 0, until: 0 }
      g.v += m.v
      g.count++
      g.until = Math.max(g.until, m.until)
      groups.set(m.kind, g)
    }
    const moodlets = [...groups.values()].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).map((g) => ({ ...g, leftMin: Math.max(1, Math.round((g.until - now) / 60000)) }))
    const mb = moodBand(s.mood, W)
    return {
      mood: s.mood,
      aff: s.aff,
      close: s.close,
      anx: s.anx,
      lone: s.lone,
      target: target(s),
      moodWord: mb[1],
      moodGlyph: mb[2],
      tier: tierIndex(s.aff),
      tierName: tierName(s.aff, W),
      tierFloor: tierFloor(s),
      hearts: Math.round(s.aff / 20), // ♥ out of 5
      stageName: stageName(s.close, W),
      nextStage: nextStage(s.close, W),
      anxWord: anxWord(s.anx, W),
      loneWord: loneWord(s.lone, W),
      moodlets,
      history: s.history.slice(),
      awayDays: s.awayDays,
      sulkedToday: s.today.sulked,
      words: W
    }
  }

  T.companionEmotion = { P, ML, WORDS, TRANSITION, words, speed, transitionKind, create, migrate, normalize, serialize, event, tick, dayEnd, decay, view, lean, target, tierIndex, tierName, tierFloor, stageName, nextStage, moodWord, moodBand, anxWord, loneWord, nextRoll, dayKey, EVENTS: Object.keys(EVENTS) }
})()
