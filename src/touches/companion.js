// companion.js: a reusable desktop pet for Orca. A character file calls
//   window.__orcaThemer.registerCompanion({ id, label, svg, parts, words, acts, ... })
// and gets a pet that can be dragged and thrown, resized with the wheel, follows you on double-click
// (right-click stops it), looks at your pointer, sways while you type, has moods, idles without repeating
// itself, startles, welcomes you back, watches Orca's agent tabs, reacts to the line you send, likes
// being petted, says a short line now and then, and remembers the days you spent together.
// Full reference: docs/companion-api.md.
//
// Rules this file keeps (and character files should too):
// - Motion is WAAPI on transform/opacity only; one rAF loop runs only while thrown or following.
// - Per-keystroke work is throttled (150 ms) and never reads layout or canvas pixels.
// - IME: Windows IMEs send keydown only for the first composing key, so typing also listens to compositionupdate.
// - Never binds Esc: in a terminal Esc interrupts Claude Code and other agents. Right-click ends follow mode.
// - The typed line lives only in memory and is dropped on Enter. Nothing is stored or sent anywhere.
// - Every listener, timer, observer and element is removed in stop().
// The runtime does not start touches at all under prefers-reduced-motion.
;(() => {
  const T = window.__orcaThemer
  if (!T) return

  const LAYER_ID = 'oc-companion-layer'
  function layer() {
    let el = document.getElementById(LAYER_ID)
    if (!el) {
      el = document.createElement('div')
      el.id = LAYER_ID
      el.setAttribute('aria-hidden', 'true')
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147482000;overflow:hidden'
      document.body.appendChild(el)
    }
    return el
  }

  const DEFAULT_COLORS = {
    sparkle: '#fff7e0',
    heart: '#f5b8cf',
    note: '#e6ebff',
    alert: '#f3d48e',
    calm: '#dfe6ff',
    dim: '#b9c0dc',
    trail: '#fff7e0'
  }
  // Short sine chimes made in the page; no sound files. Frequencies in Hz.
  const DEFAULT_SOUNDS = { gain: 1, pet: [1318.5, 1760], welcome: [1046.5, 1318.5, 1568], follow: [1108.7, 1318.5], star: [1760] }
  const DEFAULT_ORIGIN = { ears: 'center bottom', flutter: 'center', eyes: 'center', happyEyes: 'center', sleepEyes: 'center' }

  // Checked in order after the character's own words. "沒有 bug" is good news, so it comes before "bug".
  const DEFAULT_WORDS = [
    { re: /(沒有?|不是|沒|no|not an?)\s*(bug|錯誤?|問題|error|壞)|完成|搞定|成功|好耶|太棒|超棒|讚|\b(done|yay|nice|lgtm|fixed|works)\b/i, react: 'goodNews' },
    { re: /謝謝|感謝|\b(thanks?|thx|ty)\b/i, react: 'thanks' },
    { re: /晚安|好睏|好累|想睡|\b(good ?night|sleepy|tired)\b/i, react: 'sleepy' },
    { re: /bug|錯誤|壞了|失敗|卡住|\b(error|fail(ed)?|broken|crash)/i, react: 'worried' },
    { re: /[?？]\s*$|為什麼|怎麼|\b(why|how)\b/i, react: 'curious' }
  ]

  let audio = null
  function chime(freqs, gain = 0.06, gap = 0.12) {
    try {
      audio ??= new AudioContext()
      const now = audio.currentTime
      freqs.forEach((freq, i) => {
        const t0 = now + i * gap
        for (const [ratio, amp, decay] of [[1, 1, 1], [2, 0.3, 1.6], [2.76, 0.18, 2.3]]) {
          const osc = audio.createOscillator()
          const env = audio.createGain()
          osc.frequency.value = freq * ratio
          env.gain.setValueAtTime(0, t0)
          env.gain.linearRampToValueAtTime(gain * amp, t0 + 0.005)
          env.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8 / decay)
          osc.connect(env).connect(audio.destination)
          osc.start(t0)
          osc.stop(t0 + 1.9)
        }
      })
    } catch {}
  }

  const isTerminal = (t) => t instanceof HTMLTextAreaElement && t.classList.contains('xterm-helper-textarea')
  const t = (x, y, deg = 0, sx = 1, sy = sx) => ({ transform: `translate(${x}px,${y}px) rotate(${deg}deg) scale(${sx},${sy})` })
  const at = (frames, offsets) => frames.map((k, i) => ({ ...k, offset: offsets[i] }))
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  T.companions ??= new Map()

  T.registerCompanion = function registerCompanion(cfg) {
    if (!cfg?.id || typeof cfg.svg !== 'string') throw new Error('registerCompanion needs { id, svg }')
    T.registerTouch(cfg.id, {
      label: cfg.label ?? cfg.id,
      description:
        cfg.description ??
        '拖曳、甩出去、滾輪縮放、摸摸牠；雙擊跟著你、右鍵停下；會看游標、跟著打字晃、聽得懂你送出的幾句話',
      start: () => startCompanion(cfg)
    })
  }

  function startCompanion(cfg) {
    const id = cfg.id
    const BOX = cfg.size ?? 64
    const HALF = BOX / 2
    const C = { ...DEFAULT_COLORS, ...cfg.colors }
    const S = cfg.sounds === false ? null : { ...DEFAULT_SOUNDS, ...(typeof cfg.sounds === 'object' ? cfg.sounds : {}) }
    const sound = (name, gain = 0.05, gap) => S?.[name] && chime(S[name], gain * (S.gain ?? 1), gap)
    const host = layer()

    // ---------- the element ----------
    const home = document.createElement('div')
    home.dataset.companion = id
    home.title = cfg.title ?? cfg.label ?? id
    home.style.cssText = `position:absolute;left:0;top:0;width:${BOX}px;height:${BOX}px;pointer-events:auto;cursor:pointer;touch-action:none;will-change:transform`
    const glowColor = cfg.glow === false ? null : cfg.glow ?? 'color-mix(in srgb, var(--primary, #c8d2ff) 55%, transparent)'
    const glow = document.createElement('div')
    glow.style.cssText = `position:absolute;inset:-${Math.round(BOX * 0.22)}px;border-radius:50%;background:radial-gradient(closest-side,${glowColor ?? 'transparent'},transparent);opacity:.3;pointer-events:none`
    if (!glowColor) glow.style.display = 'none'
    const bob = document.createElement('div')
    bob.style.cssText = `position:relative;width:${BOX}px;height:${BOX}px`
    bob.innerHTML = cfg.svg
    const svg = bob.querySelector('svg')
    if (!svg) throw new Error(`companion ${id}: svg markup has no <svg>`)
    svg.setAttribute('width', String(BOX))
    svg.setAttribute('height', String(BOX))
    svg.setAttribute('aria-hidden', 'true')
    svg.style.overflow = 'visible'
    home.append(glow, bob)
    host.appendChild(home)

    // Named parts of the drawing, found by CSS selector: { eyes: '.my-eyes' } or { ears: { sel, origin } }.
    const P = {}
    for (const [name, spec] of Object.entries(cfg.parts ?? {})) {
      const { sel, origin } = typeof spec === 'string' ? { sel: spec } : spec ?? {}
      P[name] = sel ? [...svg.querySelectorAll(sel)] : []
      for (const el of P[name]) {
        el.style.transformBox = 'fill-box'
        // data-origin on an element wins, so a left and a right ear can each pivot where they attach.
        el.style.transformOrigin = el.dataset?.origin ?? origin ?? DEFAULT_ORIGIN[name] ?? 'center'
      }
    }
    const parts = (name) => P[name] ?? []
    const animateParts = (name, keyframes, options) => parts(name).forEach((el) => el.animate(keyframes, options))

    // Faces: swap the open eyes for the happy or sleeping ones, when the drawing has them.
    for (const el of [...parts('happyEyes'), ...parts('sleepEyes')]) el.style.opacity = '0'
    let faceTimer = 0
    const setFace = (face, ms = 0) => {
      clearTimeout(faceTimer)
      const want = face === 'happy' ? 'happyEyes' : face === 'sleep' ? 'sleepEyes' : 'eyes'
      if (!parts(want).length) return
      for (const name of ['eyes', 'happyEyes', 'sleepEyes']) for (const el of parts(name)) el.style.opacity = name === want ? '' : '0'
      if (ms) faceTimer = setTimeout(() => !stopped && setFace(mode === 'asleep' ? 'sleep' : null), ms)
    }

    const loops = [
      bob.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-BOX * 0.07}px)` }], { duration: 3200, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }),
      ...parts('flutter').map((el) => el.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(.88)' }], { duration: 1400, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' })),
      ...parts('ears').map((el, i) => el.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${i % 2 ? 3 : -3}deg)` }], { duration: 2600, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }))
    ]

    // ---------- where it is and how big ----------
    const SPOT_KEY = `orca-companion:${id}:spot`
    const SIZE_KEY = `orca-companion:${id}:size`
    const store = (key, value) => {
      try {
        localStorage.setItem(key, value)
      } catch {}
    }
    let saved = null
    let size = 1
    try {
      saved = JSON.parse(localStorage.getItem(SPOT_KEY) || 'null')
      size = Math.min(2.5, Math.max(0.5, Number(localStorage.getItem(SIZE_KEY)) || 1))
    } catch {}
    // The box scales from its center, so a bigger pet reaches `edge` past it on every side.
    const edge = () => HALF * size - HALF
    const clamp = (p) => ({ x: Math.min(Math.max(p.x, edge()), innerWidth - BOX - edge()), y: Math.min(Math.max(p.y, edge()), innerHeight - BOX - edge()) })
    let spot = { x: 24, y: innerHeight - 100 }
    const center = () => ({ x: spot.x + HALF, y: spot.y + HALF })
    const homeSpot = () => {
      if (saved) return clamp({ x: saved.fx * innerWidth, y: saved.fy * innerHeight })
      if (typeof cfg.home === 'function') return clamp(cfg.home({ width: innerWidth, height: innerHeight, box: BOX }))
      const bar = document.querySelector('.bg-worktree-sidebar[data-os-file-drop-owner]')?.getBoundingClientRect()
      return bar && bar.width > 140 ? clamp({ x: bar.right - BOX - 20, y: bar.bottom - BOX - 48 }) : clamp({ x: 18, y: innerHeight - BOX - 46 })
    }
    const place = (p, tilt = 0) => {
      spot = p
      home.style.transform = `translate(${p.x}px, ${p.y}px)` + (tilt ? ` rotate(${tilt}deg)` : '') + (size !== 1 ? ` scale(${size})` : '')
    }
    const saveSpot = () => {
      saved = { fx: spot.x / innerWidth, fy: spot.y / innerHeight }
      store(SPOT_KEY, JSON.stringify(saved))
    }
    const flyTo = (p, ms = 700) => {
      const from = home.style.transform
      place(p)
      return home.animate([{ transform: from }, { transform: home.style.transform }], { duration: ms, easing: 'cubic-bezier(.45,.05,.3,1)' }).finished.catch(() => {})
    }
    place(homeSpot())

    // Animations that keep their end state (dim while asleep) are tracked here: once finished, Chromium
    // may drop them from getAnimations() while they still apply, so they could not be found to cancel.
    const held = new Set()
    const hold = (keyframes, options) => {
      const a = home.animate(keyframes, options)
      held.add(a)
      return a
    }
    const release = () => {
      held.forEach((a) => a.cancel())
      held.clear()
    }

    let stopped = false // late timers check this after stop()
    let mode = 'home' // home | asleep | flying | following | visiting
    let busy = null // the action playing now; idle picks wait for it
    let drag = null
    let roaming = false // out for a little stroll: don't snap it home
    const onResize = () => mode === 'home' && !drag && !roaming && place(homeSpot())
    addEventListener('resize', onResize)
    const reposition = setInterval(() => {
      onResize() // the sidebar can be dragged wider or collapsed
      if (mode === 'home' && !held.size && getComputedStyle(home).opacity !== '1') hold([{ opacity: 1 }, { opacity: 1 }], { duration: 1, fill: 'forwards' })
    }, 5000)

    // ---------- small effects ----------
    const floatUp = (glyph, color, { x = center().x, y = spot.y + BOX * 0.1, rise = 30, ms = 1100 } = {}) => {
      const el = document.createElement('div')
      el.textContent = glyph
      el.style.cssText = `position:absolute;left:${x}px;top:${y}px;font:600 ${Math.round(12 * Math.max(1, size * 0.8))}px/1 system-ui;color:${color};text-shadow:0 0 6px ${color};pointer-events:none`
      host.appendChild(el)
      const dx = (Math.random() - 0.5) * 24
      el.animate(
        [
          { transform: 'translate(0,0) scale(.6)', opacity: 0 },
          { transform: `translate(${dx * 0.4}px,${-rise * 0.4}px) scale(1)`, opacity: 1, offset: 0.25 },
          { transform: `translate(${dx}px,${-rise}px) scale(.8)`, opacity: 0 }
        ],
        { duration: ms, easing: 'ease-out' }
      ).onfinish = () => el.remove()
    }
    const sparkle = (count, radius = BOX * 0.53) => {
      const c = center()
      for (let i = 0; i < count; i++) {
        const s = document.createElement('div')
        const a = (i / count) * Math.PI * 2
        s.style.cssText = `position:absolute;left:${c.x - 2.5}px;top:${c.y - 6}px;width:5px;height:5px;border-radius:50%;background:${C.sparkle};box-shadow:0 0 6px ${C.sparkle};pointer-events:none`
        host.appendChild(s)
        s.animate(
          [
            { transform: 'translate(0,0) scale(1)', opacity: 1 },
            { transform: `translate(${Math.cos(a) * radius * size}px,${(Math.sin(a) * radius - 6) * size}px) scale(.3)`, opacity: 0 }
          ],
          { duration: 700, easing: 'cubic-bezier(.2,.7,.3,1)' }
        ).onfinish = () => s.remove()
      }
    }
    const act = (keyframes, duration, easing = 'ease-in-out') => {
      busy = bob.animate(keyframes, { duration, easing, composite: 'add' })
      busy.onfinish = busy.oncancel = () => (busy = null)
      return busy
    }

    // ---------- mood: what happened lately colors what it does ----------
    // Each mood is a level 0..1 that fades over minutes; the strongest leans the idle picks and now and
    // then shows as a small sign over its head.
    const mood = { happy: 0, curious: 0, bored: 0, sleepy: 0, worried: 0 }
    const feel = (name, amount) => name in mood && (mood[name] = Math.max(0, Math.min(1, mood[name] + amount)))
    const topMood = () => {
      let best = null
      for (const [k, v] of Object.entries(mood)) if (v > 0.35 && (!best || v > mood[best])) best = k
      return best
    }
    const SIGNS = {
      happy: ['♡', C.heart],
      curious: ['?', C.calm],
      bored: ['…', C.dim],
      sleepy: ['z', C.calm],
      worried: ['!?', C.alert],
      surprised: ['!', C.alert],
      ...cfg.emotes
    }
    const emote = (name) => {
      const sign = SIGNS[name]
      if (sign) floatUp(sign[0], sign[1], { x: center().x + BOX * 0.28 * size, y: center().y - BOX * 0.53 * size, rise: 20, ms: 1500 })
    }
    let lastTouch = Date.now()
    const touched = () => {
      lastTouch = Date.now()
      mood.bored *= 0.3
    }
    const moodTimer = setInterval(() => {
      for (const k in mood) mood[k] *= 0.9 // every 30 s: halves in about 3 minutes
      const hour = new Date().getHours()
      if (hour >= 23 || hour < 6) feel('sleepy', 0.08)
      if (Date.now() - lastTouch > 8 * 60000 && !document.hidden) feel('bored', 0.06)
    }, 30000)

    // ---------- speech: now and then a short line in a bubble over its head ----------
    // Few and far between: idle lines at least 6 minutes apart, any line at least 45 s apart, at most 12 a
    // day. Milestones, greetings and late-night worry skip the spacing (they are rare by nature).
    // A character with no `lines` never speaks.
    const L = { idle: [], night: [], done: [], failed: [], welcome: [], name: [], late: [], milestone: [], ...cfg.lines }
    const pick = (list) => (Array.isArray(list) && list.length ? list[(Math.random() * list.length) | 0] : null)
    const today = () => new Date().toLocaleDateString('sv') // YYYY-MM-DD, local time
    const BOND_KEY = `orca-companion:${id}:bond`
    let bond = { met: today(), days: 0, last: '', hours: Array(24).fill(0), celebrated: [], lateWarned: '', said: { date: today(), n: 0 } }
    try {
      bond = { ...bond, ...JSON.parse(localStorage.getItem(BOND_KEY) || 'null') }
    } catch {}
    const saveBond = () => store(BOND_KEY, JSON.stringify(bond))
    let bubble = null
    let bubbleTimer = 0
    let lastSaid = 0
    let lastIdleSaid = 0
    const hush = () => {
      clearTimeout(bubbleTimer)
      if (!bubble) return
      const el = bubble
      bubble = null
      el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, -4px)' }], { duration: 260, easing: 'ease-in' }).onfinish = () => el.remove()
    }
    const say = (text, { idle = false, force = false } = {}) => {
      const now = Date.now()
      if (!text || stopped || document.hidden || !['home', 'visiting'].includes(mode)) return false
      if (bond.said.date !== today()) bond.said = { date: today(), n: 0 }
      if (!force && (now - lastSaid < 45000 || bond.said.n >= 12 || (idle && now - lastIdleSaid < 6 * 60000))) return false
      bond.said.n++
      saveBond()
      lastSaid = now
      if (idle) lastIdleSaid = now
      hush()
      const el = document.createElement('div')
      bubble = el
      el.setAttribute('role', 'status')
      const cx = Math.min(Math.max(center().x, 120), innerWidth - 120)
      const top = Math.max(8, center().y - HALF * size - 40)
      el.style.cssText =
        `position:absolute;left:${cx}px;top:${top}px;transform:translateX(-50%);max-width:240px;padding:6px 12px;border-radius:12px;` +
        'background:color-mix(in srgb,var(--popover,#1b1b24) 94%,transparent);color:var(--popover-foreground,#eee);border:1px solid var(--border,#444);' +
        'box-shadow:0 10px 24px -10px rgb(0 0 0 / .7);font:13px/1.55 var(--app-font-family,system-ui);letter-spacing:.02em;white-space:nowrap;pointer-events:none;' +
        (cfg.bubbleStyle ?? '')
      host.appendChild(el)
      el.animate([{ opacity: 0, transform: 'translate(-50%, 6px) scale(.96)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.3,1)' })
      // Typed out a character at a time, the way someone talks.
      const chars = [...String(text)]
      let i = 0
      const type = () => {
        if (bubble !== el) return
        el.textContent = chars.slice(0, ++i).join('')
        if (i < chars.length) bubbleTimer = setTimeout(type, 55)
        else bubbleTimer = setTimeout(hush, 2400 + chars.length * 110)
      }
      type()
      return true
    }
    const later = (ms, fn) => setTimeout(() => !stopped && fn(), ms)

    // ---------- bond: remembers the days you spent together and when you usually work ----------
    // Kept only in this Orca profile's localStorage; nothing leaves the machine.
    const MILESTONES = cfg.milestones ?? [7, 30, 100, 200, 365, 500, 1000]
    const greetLine = () => {
      const h = new Date().getHours()
      const g = L.greeting ?? {}
      return pick(h >= 5 && h < 11 ? g.morning : h >= 5 && h < 14 ? g.noon : h >= 5 && h < 18 ? g.afternoon : h >= 5 && h < 23 ? g.evening : g.night)
    }
    const celebrate = (n) => {
      busy?.cancel()
      busy = null
      twirl()
      sparkle(14, BOX * 0.62)
      sound('welcome', 0.06, 0.13)
      for (let i = 0; i < 8; i++) later(i * 120, () => floatUp(i % 2 ? '♡' : '✦', i % 2 ? C.heart : C.sparkle, { x: spot.x + Math.random() * BOX, y: spot.y + 6, rise: 44, ms: 1600 }))
      feel('happy', 0.6)
      const line = pick(L.milestone)
      if (line) later(900, () => say(line.replaceAll('{n}', String(n)), { force: true }))
    }
    const greet = () => {
      const h = new Date().getHours()
      emote(h >= 23 || h < 5 ? 'sleepy' : 'happy')
      act([t(0, 0), t(-3, -8, -10), t(0, 0), t(3, -8, 10), t(0, 0)], 1300, 'cubic-bezier(.3,.7,.4,1)')
      const line = greetLine()
      if (line) later(500, () => say(line, { force: true }))
    }
    // Counts a new day the first time it sees you that day (also past midnight with Orca open).
    let meetTimer = 0
    const meetToday = () => {
      if (bond.last === today()) return
      bond.days++
      bond.last = today()
      saveBond()
      const meet = () => {
        if (stopped) return
        if (document.hidden || !document.hasFocus() || mode !== 'home') return (meetTimer = setTimeout(meet, 5000))
        const n = bond.days
        if (MILESTONES.includes(n) && !bond.celebrated.includes(n)) {
          bond.celebrated.push(n)
          saveBond()
          ;(reactions.milestone ?? celebrate)(n, api)
        } else if (n > 1) (reactions.greet ?? greet)(api)
      }
      meetTimer = setTimeout(meet, 4500)
    }
    const bondTimer = setInterval(() => !stopped && meetToday(), 60000)
    // Notes the hour you send things at, and worries when it is much later than you are usually around.
    const noteSent = () => {
      const h = new Date().getHours()
      bond.hours[h]++
      const total = bond.hours.reduce((a, b) => a + b, 0)
      if ((h >= 23 || h < 5) && total >= 60 && bond.hours[h] / total < 0.03 && bond.lateWarned !== today()) {
        bond.lateWarned = today()
        emote('worried')
        feel('worried', 0.15)
        later(600, () => say(pick(L.late), { force: true }))
      }
      saveBond()
    }

    // ---------- moves ----------
    const twirl = () => {
      if (busy || !['home', 'visiting'].includes(mode)) return
      busy = bob.animate(
        [
          { transform: 'translateY(0) rotate(0deg) scale(1)' },
          { transform: `translateY(${-BOX * 0.22}px) rotate(200deg) scale(1.12)`, offset: 0.55 },
          { transform: 'translateY(0) rotate(360deg) scale(1)' }
        ],
        { duration: 900, easing: 'cubic-bezier(.3,.7,.3,1)', composite: 'add' }
      )
      sparkle(7)
      busy.onfinish = busy.oncancel = () => (busy = null)
    }
    const happy = () => {
      setFace('happy', 1700)
      bob.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-7px) scale(1.06)' }, { transform: 'translateY(0)' }], { duration: 420, easing: 'ease-out', composite: 'add' })
      for (let i = 0; i < 5; i++)
        setTimeout(() => !stopped && floatUp(i % 2 ? '♡' : '✦', i % 2 ? C.heart : C.sparkle, { x: spot.x + BOX * 0.3 + Math.random() * BOX * 0.4 }), i * 110)
      sound('pet', 0.07, 0.1)
      feel('happy', 0.5)
      touched()
    }
    const ears = (keyframes, duration, easing) => animateParts('ears', keyframes, { duration, easing, composite: 'add' })
    const deg = (...ds) => ds.map((d) => ({ transform: `rotate(${d}deg)` }))

    const builtInActs = {
      // A quick float up-left, then up-right, wriggling. The default signature move.
      wiggle: {
        weight: (c) => 3 + c.mood.happy * 2,
        run: () => {
          act(
            at([t(0, 0), t(-10, -12, -16), t(-3, -16, 4), t(10, -13, 16), t(3, -7, -7), t(-2, -2, 3), t(0, 0)], [0, 0.2, 0.35, 0.55, 0.72, 0.86, 1]),
            1300
          )
          animateParts('flutter', [{ transform: 'scaleX(1)' }, { transform: 'scaleX(.8)' }, { transform: 'scaleX(1.04)' }, { transform: 'scaleX(1)' }], { duration: 1300, composite: 'add' })
        }
      },
      lookAround: {
        weight: (c) => 3 + c.mood.curious * 3 + c.mood.worried * 2,
        run: () => {
          act(at([t(0, 0), t(-2, 0, -11), t(-2, 0, -11), t(2, -1, 10), t(2, -1, 10), t(0, 0)], [0, 0.2, 0.42, 0.62, 0.84, 1]), 2600)
          ears(deg(0, -6, 5, 0), 2600)
        }
      },
      stretch: {
        weight: (c) => 2 + c.mood.bored * 2,
        run: () => act(at([t(0, 0), t(0, 4, 0, 1.08, 0.9), t(0, -6, 0, 0.92, 1.14), t(0, -6, 0, 0.92, 1.14), t(0, 1, 0, 1.05, 0.95), t(0, 0)], [0, 0.18, 0.4, 0.62, 0.82, 1]), 1900)
      },
      earFlick: {
        weight: (c) => (parts('ears').length ? 2 + c.mood.worried * 2 : 0),
        run: () => {
          act([t(0, 0), t(0, -2), t(0, 0)], 700)
          ears(deg(0, -12, 9, -7, 4, 0), 700, 'ease-out')
        }
      },
      loop: {
        weight: (c) => 2 + c.mood.happy * 2,
        run: () => {
          const ring = Array.from({ length: 9 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2
            return { ...t(Math.sin(a) * 14, -Math.sin(a / 2) * 22, (i / 8) * 360), offset: i / 8 }
          })
          act(ring, 1500)
          sparkle(5, BOX * 0.38)
        }
      },
      doze: {
        weight: (c) => (c.night ? 3 : 0.5) + c.mood.sleepy * 4,
        run: () => {
          setFace('sleep', 2600)
          act(at([t(0, 0), t(0, 4, 8), t(0, 1, 2), t(0, 6, 12), t(0, -3, -4), t(0, 0)], [0, 0.25, 0.4, 0.68, 0.84, 1]), 2800)
        }
      },
      hum: {
        weight: (c) => 2 + c.mood.happy * 3,
        run: () => {
          act([t(0, 0), t(-3, -2, -6), t(3, -2, 6), t(-3, -2, -6), t(0, 0)], 2400)
          for (let i = 0; i < 4; i++) setTimeout(() => !stopped && floatUp(i % 2 ? '♪' : '♫', C.note, { x: center().x + (i % 2) * 10, y: spot.y + 4, rise: 34, ms: 1600 }), i * 450)
        }
      },
      chaseStar: {
        weight: (c) => 2 + c.mood.happy * 2 + c.mood.curious,
        run: () => {
          const dx = (Math.random() < 0.5 ? -1 : 1) * (36 + Math.random() * 20)
          const dy = -18 - Math.random() * 16
          const star = document.createElement('div')
          star.textContent = '✦'
          star.style.cssText = `position:absolute;left:${center().x + dx}px;top:${center().y - 6 + dy}px;font:600 11px/1 system-ui;color:${C.alert};text-shadow:0 0 8px ${C.alert};pointer-events:none`
          host.appendChild(star)
          star.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1) rotate(90deg)' }, { opacity: 0, transform: 'scale(2.2) rotate(140deg)' }], { duration: 1700, easing: 'ease-out' }).onfinish = () => star.remove()
          act(at([t(0, 0), t(dx * 0.15, dy * 0.15, -dx / 6), t(dx * 0.7, dy * 0.7, dx / 5), t(dx * 0.7, dy * 0.7, 0), t(0, 0)], [0, 0.2, 0.5, 0.62, 1]), 1800)
          setTimeout(() => !stopped && sound('star', 0.03), 900)
        }
      },
      peek: {
        weight: (c) => (c.near ? 4 + c.mood.curious * 2 : 0),
        run: () => {
          if (!pointer) return
          const dx = pointer.x - center().x
          const dy = pointer.y - center().y
          const lean = Math.max(-1, Math.min(1, dx / 200))
          act(at([t(0, 0), t(lean * 8, Math.sign(dy) * 3, lean * 14), t(lean * 8, Math.sign(dy) * 3, lean * 14), t(0, 0)], [0, 0.3, 0.75, 1]), 2000)
        }
      },
      cheer: {
        weight: (c) => (c.working ? 3 : 0),
        run: () => {
          act([t(0, 0), t(0, -9, -6), t(0, 0), t(0, -9, 6), t(0, 0)], 1100, 'cubic-bezier(.3,.7,.4,1)')
          sparkle(4, BOX * 0.34)
        }
      },
      sigh: {
        weight: (c) => c.mood.bored * 4 + c.mood.sleepy,
        run: () => {
          act(at([t(0, 0), t(0, -3, 0, 0.97, 1.04), t(0, 6, 0, 1.05, 0.93), t(0, 6, 0, 1.05, 0.93), t(0, 0)], [0, 0.25, 0.55, 0.78, 1]), 2600)
          setTimeout(() => !stopped && emote('bored'), 900)
        }
      },
      // Wanders off a little way, looks around there, and drifts back home.
      wander: {
        weight: (c) => 1.5 + c.mood.bored * 3 + c.mood.curious * 3,
        run: async () => {
          const from = { ...spot }
          const dx = (Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 80)
          const there = clamp({ x: from.x + dx, y: from.y + (Math.random() - 0.5) * 60 })
          roaming = true
          busy = { cancel() {}, playState: 'running' } // a placeholder so nothing else starts meanwhile
          bob.animate([t(0, 0), t(0, -4, Math.sign(dx) * 10), t(0, 0)], { duration: 1800, composite: 'add' })
          await flyTo(there, 1800)
          busy = null
          if (stopped || drag || mode !== 'home') return (roaming = false)
          acts.lookAround()
          await wait(3000 + Math.random() * 2500)
          if (stopped || drag || mode !== 'home' || spot.x !== there.x || spot.y !== there.y) return (roaming = false)
          bob.animate([t(0, 0), t(0, -4, -Math.sign(dx) * 10), t(0, 0)], { duration: 1800, composite: 'add' })
          await flyTo(homeSpot(), 1800)
          roaming = false
        }
      }
    }

    // The character's own acts join (or replace, or with null remove) the built-in ones.
    const actTable = { ...builtInActs }
    for (const [name, spec] of Object.entries(cfg.acts ?? {})) {
      if (spec === null) delete actTable[name]
      else if (typeof spec === 'function') actTable[name] = { weight: 2, run: spec }
      else actTable[name] = { weight: 2, ...spec }
    }
    const signatureName = cfg.signature && actTable[cfg.signature] ? cfg.signature : 'wiggle'
    const acts = {}
    for (const [name, spec] of Object.entries(actTable)) {
      acts[name] = () => {
        try {
          return spec.run(api)
        } catch (error) {
          console.warn(`[companion ${id}] act ${name} failed`, error)
        }
      }
    }
    const signature = () => {
      if (busy || drag || mode !== 'home') return
      ;(acts[signatureName] ?? acts.wiggle)?.()
    }

    // Reactions: what words, clicks and events trigger. A character may replace any of them.
    const reactions = {
      happy,
      twirl,
      signature,
      goodNews: () => (twirl(), feel('happy', 0.3), setTimeout(() => !stopped && emote('happy'), 500)),
      thanks: () => (signature(), emote('happy'), feel('happy', 0.2)),
      sleepy: () => (emote('sleepy'), acts.doze?.(), feel('sleepy', 0.3)),
      worried: () => (emote('worried'), (acts.earFlick ?? acts.lookAround)?.(), feel('worried', 0.2)),
      curious: () => (emote('curious'), acts.lookAround?.(), feel('curious', 0.2)),
      name: () => (happy(), later(700, () => say(pick(L.name)))),
      poke: () => {
        act([t(0, 0), t(0, -8, 0, 1.06, 0.94), t(0, 0)], 420, 'cubic-bezier(.3,.7,.4,1)')
        emote(topMood() ?? 'happy')
        feel('happy', 0.1)
        touched()
      },
      ...cfg.reactions
    }
    const play = (name) => {
      const fn = reactions[name] ?? acts[name]
      if (!fn) return false
      busy?.cancel()
      busy = null // a cancelled action clears itself only on the next tick
      fn(api)
      return true
    }

    // ---------- idle repertoire: something small every so often, never the same twice in a row ----------
    let pointer = null
    let vigil = null
    let lastAct = ''
    const pickAct = () => {
      const hour = new Date().getHours()
      const ctx = {
        mood,
        hour,
        night: hour >= 22 || hour < 6,
        near: Boolean(pointer && Math.hypot(pointer.x - center().x, pointer.y - center().y) < 260),
        working: Boolean(vigil)
      }
      const weights = {}
      for (const [name, spec] of Object.entries(actTable)) {
        if (name === lastAct) continue
        const w = typeof spec.weight === 'function' ? spec.weight(ctx) : spec.weight
        if (w > 0) weights[name] = w
      }
      let r = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0)
      for (const [name, w] of Object.entries(weights)) if ((r -= w) <= 0) return name
      return signatureName
    }
    const [idleMin, idleMax] = cfg.idleEvery ?? [12000, 30000]
    let idleTimer = 0
    const scheduleIdle = () => {
      idleTimer = setTimeout(() => {
        if (!document.hidden && mode === 'home' && !busy && !drag) {
          lastAct = pickAct()
          const feeling = topMood()
          if (feeling && lastAct !== 'sigh' && Math.random() < 0.4) emote(feeling)
          acts[lastAct]?.()
          const h = new Date().getHours()
          if (Math.random() < 0.15) later(1200, () => say(pick(h >= 22 || h < 5 ? (L.night.length ? L.night : L.idle) : L.idle), { idle: true }))
        }
        scheduleIdle()
      }, idleMin + Math.random() * (idleMax - idleMin))
    }
    scheduleIdle()

    // ---------- blinking ----------
    let blinkTimer = 0
    const blink = () => {
      blinkTimer = setTimeout(() => {
        if (mode !== 'asleep' && !document.hidden) animateParts('eyes', [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.12)' }, { transform: 'scaleY(1)' }], { duration: 170, composite: 'add' })
        blink()
      }, 2500 + Math.random() * 4500)
    }
    if (cfg.blink !== false) blink()

    // ---------- startle: the pointer whips past close by ----------
    let lastPointer = null
    let startleCooldown = 0
    const startle = (fromX) => {
      busy?.cancel()
      const dir = Math.sign(center().x - fromX) || 1
      act(at([t(0, 0), t(dir * 10, -9, dir * 14, 0.94, 1.06), t(dir * 6, -2, dir * 4), t(0, 0)], [0, 0.22, 0.6, 1]), 650, 'cubic-bezier(.2,.8,.3,1)')
      ears(deg(0, -10, 0), 650)
      emote('surprised')
      feel('worried', 0.12)
      feel('curious', 0.25)
    }

    // ---------- gaze: eyes and body turn toward the pointer when it comes near ----------
    svg.style.transformOrigin = '50% 85%'
    svg.style.transition = 'transform .45s cubic-bezier(.3,.7,.4,1)'
    for (const el of parts('eyes')) el.style.transition = 'transform .25s ease-out'
    const eyeReach = cfg.eyeTravel ?? [2.2, 1.6] // px in the drawing's own units, roughly
    let gazeQueued = 0
    const gaze = () => {
      gazeQueued = 0
      if (stopped) return
      const awake = mode === 'home' || mode === 'following'
      const dx = pointer ? pointer.x - center().x : 0
      const dy = pointer ? pointer.y - center().y : 0
      const dist = Math.hypot(dx, dy)
      const reach = 360 * size
      if (!awake || drag || !pointer || dist < 8 || dist > reach) {
        svg.style.transform = ''
        for (const el of parts('eyes')) el.style.transform = ''
        return
      }
      const pull = Math.min(1, (reach - dist) / (reach * 0.5)) // full attention when close, fading far away
      const ux = dx / dist
      const uy = dy / dist
      for (const el of parts('eyes')) el.style.transform = `translate(${(ux * eyeReach[0] * pull).toFixed(2)}px,${(uy * eyeReach[1] * pull).toFixed(2)}px)`
      svg.style.transform = `rotate(${(ux * 7 * pull).toFixed(2)}deg) translate(${(ux * 2 * pull).toFixed(2)}px,${(Math.min(0, uy) * 1.5 * pull).toFixed(2)}px)`
    }
    const onPointer = (e) => {
      const now = performance.now()
      const p = { x: e.clientX, y: e.clientY, t: now }
      if (lastPointer && mode === 'home' && !drag && now > startleCooldown && now - lastPointer.t < 50) {
        const speed = Math.hypot(p.x - lastPointer.x, p.y - lastPointer.y) / Math.max(1, now - lastPointer.t)
        const near = Math.hypot(p.x - center().x, p.y - center().y) < BOX * 1.1 * size
        if (near && speed > 3) {
          startleCooldown = now + 20000
          startle(p.x)
        }
      }
      lastPointer = p
      pointer = p
      if (!gazeQueued) gazeQueued = requestAnimationFrame(gaze)
    }
    addEventListener('pointermove', onPointer, { capture: true, passive: true })

    // ---------- typing: sways along with your rhythm ----------
    // keydown plus compositionupdate: Windows IMEs send keydown only for the first composing key, while
    // compositionupdate fires on every key that changes the underlined text. Throttled to one sway per 150 ms.
    let swaySide = 1
    let lastSway = 0
    const onTypeSway = (e) => {
      if (!isTerminal(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
      if (mode !== 'home' || busy || drag || document.hidden) return
      const now = performance.now()
      if (now - lastSway < 150) return
      lastSway = now
      swaySide = -swaySide
      bob.animate([t(0, 0), t(swaySide * 1.2, -2, swaySide * 4, 1.02, 0.98), t(0, 0)], { duration: 260, easing: 'ease-out', composite: 'add' })
    }
    addEventListener('keydown', onTypeSway, { capture: true, passive: true })
    addEventListener('compositionupdate', onTypeSway, { capture: true, passive: true })

    // ---------- what you type: reacts to the line you send, and to a run of deletions ----------
    // The line lives only in memory and is dropped on Enter; nothing is stored or sent anywhere.
    // Its own name comes first: a happy hop and, maybe, an answer.
    const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const names = [].concat(cfg.names ?? []).filter(Boolean)
    const nameWord = names.length ? [{ re: new RegExp(names.map(escapeRe).join('|'), 'i'), react: 'name' }] : []
    const words = [...nameWord, ...(cfg.words ?? []), ...(cfg.defaultWords === false ? [] : DEFAULT_WORDS)]
    let line = ''
    let lastWord = -Infinity // performance.now() starts near 0 on a fresh window
    let erased = []
    let lastPuzzled = -Infinity
    const onTypedChar = (e) => {
      if (!isTerminal(e.target) || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.key === 'Process') return
      if (e.key === 'Enter') {
        const sent = line
        line = ''
        noteSent()
        const now = performance.now()
        if (mode !== 'home' || drag || now - lastWord < 8000) return
        const hit = words.find((w) => w.re.test(sent))
        if (!hit) return
        lastWord = now
        busy?.cancel()
        busy = null
        try {
          typeof hit.react === 'function' ? hit.react(api) : play(hit.react)
        } catch (error) {
          console.warn(`[companion ${id}] word reaction failed`, error)
        }
      } else if (e.key === 'Backspace') {
        line = line.slice(0, -1)
        const now = performance.now()
        erased = erased.filter((t0) => now - t0 < 2500)
        erased.push(now)
        // Erasing and erasing: it tilts its head at you.
        if (erased.length >= 8 && now - lastPuzzled > 20000 && mode === 'home' && !busy && !drag) {
          lastPuzzled = now
          erased = []
          act(at([t(0, 0), t(1, 1, 14), t(1, 1, 14), t(0, 0)], [0, 0.25, 0.75, 1]), 1800)
          emote('curious')
        }
      } else if (e.key.length === 1) line = (line + e.key).slice(-200)
    }
    const onTypedIme = (e) => isTerminal(e.target) && e.data && (line = (line + e.data).slice(-200))
    addEventListener('keydown', onTypedChar, { capture: true, passive: true })
    addEventListener('compositionend', onTypedIme, { capture: true, passive: true })

    // ---------- petting: rub the pointer back and forth over it ----------
    let petDir = 0
    let petFlips = 0
    let petReset = 0
    let petCooldown = 0
    const onHover = (e) => {
      if (drag || e.buttons || !['home', 'asleep'].includes(mode)) return
      const dir = Math.sign(e.movementX)
      if (!dir || dir === petDir) return
      petDir = dir
      petFlips++
      clearTimeout(petReset)
      petReset = setTimeout(() => (petFlips = 0), 600)
      if (petFlips < 5 || performance.now() < petCooldown) return
      petFlips = 0
      petCooldown = performance.now() + 2500
      if (mode === 'asleep') wake()
      reactions.happy()
    }
    home.addEventListener('pointermove', onHover)

    // ---------- the typing streak from power-mode brightens the glow ----------
    let baseGlow = 0.3
    let glowTimer = 0
    const onCombo = (e) => {
      if (mode !== 'home' || !glowColor) return
      glow.style.opacity = String(baseGlow + Math.min(1, e.detail / 60) * (1 - baseGlow))
      clearTimeout(glowTimer)
      glowTimer = setTimeout(
        () => glow.animate([{ opacity: glow.style.opacity }, { opacity: baseGlow }], { duration: 900 }).finished.then(() => (glow.style.opacity = String(baseGlow))).catch(() => {}),
        1600
      )
      if (e.detail % 50 === 0) twirl()
    }
    addEventListener('orca-themer:combo', onCombo)

    // ---------- toasts: a twirl ----------
    const seenToasts = new WeakSet()
    const toasts = new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes) {
          if (!(n instanceof HTMLElement)) continue
          const toast = n.matches?.('[data-sonner-toast]') ? n : n.querySelector?.('[data-sonner-toast]')
          if (toast && !seenToasts.has(toast)) {
            seenToasts.add(toast)
            twirl()
          }
        }
    })
    toasts.observe(document.body, { childList: true, subtree: true })

    // ---------- agents: keeps vigil while they work, knocks on the tab that waits for you ----------
    // Orca tabs: [data-testid="sortable-tab"] with data-agent-activity-status = working | permission | done | failed.
    const setVigil = (on) => {
      if (on && !vigil && glowColor) vigil = glow.animate([{ opacity: 0.35 }, { opacity: 0.9 }], { duration: 2200, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' })
      else if (on && !vigil) vigil = { cancel() {} }
      if (!on && vigil) {
        vigil.cancel()
        vigil = null
      }
    }
    const droop = () => {
      if (mode !== 'home') return
      bob.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(9px) rotate(-6deg)', offset: 0.4 }, { transform: 'translateY(0)' }], { duration: 1800, easing: 'ease-in-out', composite: 'add' })
      if (glowColor) glow.animate([{ opacity: baseGlow }, { opacity: 0.06, offset: 0.4 }, { opacity: baseGlow }], { duration: 1800 })
    }
    let visitingTab = null
    let knock = null
    const visit = async (tab) => {
      if (tab && mode === 'home' && !busy && !drag) {
        mode = 'visiting'
        visitingTab = tab
        const r = tab.getBoundingClientRect()
        await flyTo(clamp({ x: r.left + r.width / 2 - HALF, y: r.bottom + 2 + edge() }), 800)
        if (mode !== 'visiting' || stopped) return
        knock = bob.animate(deg(0, -9, 7, 0), { duration: 900, iterations: Infinity, composite: 'add' })
        floatUp('!', C.alert, { x: center().x + 8, y: spot.y, rise: 18, ms: 900 })
      } else if (!tab && mode === 'visiting') {
        leaveVisit()
      }
    }
    const leaveVisit = async () => {
      knock?.cancel()
      knock = null
      visitingTab = null
      mode = 'flying'
      await flyTo(homeSpot(), 800)
      if (!stopped) mode = 'home'
    }
    const lastStatus = new WeakMap()
    const readStatus = () => {
      if (stopped) return
      let working = false
      let waiting = null
      let finished = false
      let failed = false
      for (const tab of document.querySelectorAll('[data-testid="sortable-tab"]')) {
        const s = tab.getAttribute('data-agent-activity-status')
        const prev = lastStatus.get(tab)
        lastStatus.set(tab, s)
        if (s === 'working') working = true
        if (s === 'permission' && !waiting) waiting = tab
        if (prev === 'working' && s === 'done') finished = true
        if (prev && prev !== s && s === 'failed') failed = true
      }
      setVigil(working)
      if (finished) twirl(), feel('happy', 0.2), later(900, () => say(pick(L.done)))
      if (failed) droop(), feel('worried', 0.45), later(900, () => say(pick(L.failed)))
      if (cfg.visitTabs !== false && waiting !== visitingTab) visit(waiting)
    }
    let statusQueued = 0
    const statusObserver = new MutationObserver(() => {
      if (!statusQueued) statusQueued = requestAnimationFrame(() => ((statusQueued = 0), readStatus()))
    })
    statusObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-agent-activity-status'] })
    const statusTimer = setInterval(readStatus, 3000) // tabs that appear or close
    readStatus()

    // ---------- away and back: a welcome after more than 10 minutes ----------
    const away = () => document.hidden || !document.hasFocus()
    let awaySince = 0
    const onLeave = () => (awaySince ||= Date.now())
    const welcome = () => {
      wake()
      if (mode !== 'home') return
      busy?.cancel()
      emote('surprised')
      setFace('happy', 1400)
      act([t(0, 0), t(0, -12, -8), t(0, 0), t(0, -8, 8), t(0, 0)], 1200, 'cubic-bezier(.3,.7,.4,1)')
      ears(deg(0, -8, 6, 0), 1200)
      sparkle(8)
      sound('welcome', 0.05, 0.11)
      feel('happy', 0.4)
      mood.bored = 0
      later(1000, () => say(pick(L.welcome)))
    }
    let welcomeTimer = 0
    const onBack = () => {
      if (away()) return onLeave()
      const gone = awaySince ? Date.now() - awaySince : 0
      awaySince = 0
      if (gone > (cfg.welcomeAfter ?? 10 * 60000)) welcomeTimer = setTimeout(() => !stopped && reactions.welcome?.(), 300)
    }
    reactions.welcome ??= welcome
    addEventListener('blur', onLeave)
    addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)

    // ---------- sleep after a while without input ----------
    let sleepTimer = 0
    let zTimer = 0
    let dozing = null
    const sleepAfter = () => {
      const hour = new Date().getHours()
      return cfg.sleepAfter ?? (hour >= 18 || hour < 6 ? 120000 : 90000)
    }
    const sleep = () => {
      if (mode !== 'home' || document.hidden || busy) return
      mode = 'asleep'
      setFace('sleep')
      hold([{ opacity: 1 }, { opacity: 0.75 }], { duration: 1600, fill: 'forwards' })
      dozing = bob.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-10deg) translateY(4px)' }], { duration: 1800, easing: 'ease-in-out', fill: 'forwards', composite: 'add' })
      const z = () => {
        floatUp('z', C.calm, { x: center().x + BOX * 0.22, y: spot.y + BOX * 0.12, rise: 24, ms: 2400 })
        zTimer = setTimeout(z, 2600)
      }
      z()
    }
    const wake = () => {
      clearTimeout(sleepTimer)
      sleepTimer = setTimeout(sleep, sleepAfter())
      if (mode !== 'asleep') return
      mode = 'home'
      clearTimeout(zTimer)
      release()
      dozing?.cancel()
      dozing = null
      setFace(null)
      home.animate([{ opacity: 0.75 }, { opacity: 1 }], { duration: 300 })
    }
    const activity = ['pointermove', 'keydown', 'wheel', 'pointerdown']
    for (const ev of activity) addEventListener(ev, wake, { capture: true, passive: true })
    wake()

    // ---------- size: the wheel over it (0.5x to 2.5x, remembered) ----------
    const onWheel = (e) => {
      e.preventDefault()
      size = Math.min(2.5, Math.max(0.5, size * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
      if (Math.abs(size - 1) < 0.04) size = 1
      place(clamp(spot))
      store(SIZE_KEY, String(size))
    }
    home.addEventListener('wheel', onWheel, { passive: false })

    // ---------- drag, and throw with inertia ----------
    let justDragged = false
    let flightRaf = 0
    let landTimer = 0
    const throwIt = (vx, vy) => {
      mode = 'flying'
      const back = homeSpot()
      const p = { ...spot }
      let last = performance.now()
      const step = (now) => {
        const dt = Math.min(32, now - last)
        last = now
        p.x += vx * dt
        p.y += vy * dt
        const min = edge()
        const maxX = innerWidth - BOX - min
        const maxY = innerHeight - BOX - min
        if (p.x < min || p.x > maxX) {
          vx = -vx * 0.6
          p.x = Math.min(Math.max(p.x, min), maxX)
          sparkle(5, BOX * 0.3)
        }
        if (p.y < min || p.y > maxY) {
          vy = -vy * 0.6
          p.y = Math.min(Math.max(p.y, min), maxY)
          sparkle(5, BOX * 0.3)
        }
        const k = Math.pow(0.94, dt / 16)
        vx *= k
        vy *= k
        place(p, Math.max(-28, Math.min(28, vx * 26)))
        if (Math.hypot(vx, vy) > 0.03) {
          flightRaf = requestAnimationFrame(step)
          return
        }
        flightRaf = 0
        place(p)
        // A short dizzy wobble, then it drifts back to where it lives.
        bob.animate(deg(0, 12, -10, 0), { duration: 700, composite: 'add' })
        emote('surprised')
        landTimer = setTimeout(async () => {
          if (stopped) return
          await flyTo(back, 1100)
          if (stopped) return
          mode = 'home'
          signature()
        }, 700)
      }
      flightRaf = requestAnimationFrame(step)
    }
    const onDown = (e) => {
      hush()
      touched()
      if (e.button !== 0 || !['home', 'asleep', 'visiting'].includes(mode)) return
      busy?.cancel()
      wake()
      drag = { dx: e.clientX - spot.x, dy: e.clientY - spot.y, startX: e.clientX, startY: e.clientY, moved: false, lastX: e.clientX, samples: [] }
      try {
        home.setPointerCapture(e.pointerId) // keeps the drag even when the pointer outruns it
      } catch {}
    }
    const onMove = (e) => {
      if (!drag) return
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return
      if (!drag.moved) {
        drag.moved = true
        loops.slice(1).forEach((a) => (a.playbackRate = 3))
        if (mode === 'visiting') {
          knock?.cancel()
          visitingTab = null
          mode = 'home'
        }
      }
      const tilt = Math.max(-18, Math.min(18, (e.clientX - drag.lastX) * 1.5))
      drag.lastX = e.clientX
      drag.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() })
      if (drag.samples.length > 6) drag.samples.shift()
      place(clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }), tilt)
    }
    const onUp = () => {
      if (!drag) return
      const { moved, samples } = drag
      drag = null
      if (!moved) return
      justDragged = true
      setTimeout(() => (justDragged = false), 0)
      loops.slice(1).forEach((a) => (a.playbackRate = 1))
      const first = samples[0]
      const last = samples[samples.length - 1]
      const dt = last && first ? last.t - first.t : 0
      const vx = dt > 0 ? (last.x - first.x) / dt : 0
      const vy = dt > 0 ? (last.y - first.y) / dt : 0
      // A flick (fast release) throws it; a calm drop moves its home.
      if (dt > 0 && performance.now() - last.t < 80 && Math.hypot(vx, vy) > 0.8) return throwIt(vx, vy)
      place(spot)
      saveSpot()
      signature()
    }
    home.addEventListener('pointerdown', onDown)
    home.addEventListener('pointermove', onMove)
    home.addEventListener('pointerup', onUp)
    home.addEventListener('pointercancel', onUp)

    // ---------- follow mode: double-click it; right-click anywhere stops (never Esc) ----------
    let cursor = null
    let lastMove = 0
    let followRaf = 0
    let trailAt = 0
    const trail = (x, y) => {
      if (cfg.trail === false) return
      const d = document.createElement('div')
      d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:5px;height:5px;border-radius:50%;background:${C.trail};box-shadow:0 0 8px 2px ${C.trail};pointer-events:none`
      host.appendChild(d)
      d.animate([{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'translateY(6px) scale(.3)' }], { duration: 2200, easing: 'ease-out' }).onfinish = () => d.remove()
    }
    const followStep = (now) => {
      followRaf = 0
      if (mode !== 'following' || !cursor) return
      // Resting the pointer on it lets you catch it (to double-click it home).
      const over = Math.abs(cursor.x - center().x) <= HALF * size && Math.abs(cursor.y - center().y) <= HALF * size
      if (over) return
      const target = clamp({ x: cursor.x + 18 + edge(), y: cursor.y + 14 + edge() })
      const nx = spot.x + (target.x - spot.x) * 0.14
      const ny = spot.y + (target.y - spot.y) * 0.14
      place({ x: nx, y: ny }, Math.max(-14, Math.min(14, (nx - spot.x) * 1.2)))
      const far = Math.hypot(target.x - nx, target.y - ny)
      if (now - trailAt > 40 && far > 3) {
        trailAt = now
        trail(nx + HALF - 2, ny + BOX * 0.7)
      }
      if (far > 0.5 || now - lastMove < 300) followRaf = requestAnimationFrame(followStep)
      else place(spot)
    }
    const onFollowMove = (e) => {
      cursor = { x: e.clientX, y: e.clientY }
      lastMove = performance.now()
      if (!followRaf) followRaf = requestAnimationFrame(followStep)
    }
    const stopFollow = () => {
      if (mode !== 'following') return
      mode = 'home'
      removeEventListener('pointermove', onFollowMove, true)
      place(spot)
      saveSpot()
      signature()
    }
    // Why right-click and not Esc: in the terminal Esc interrupts Claude Code, and a double-click can't land
    // on a pet that keeps moving away from the pointer.
    const onRightFollow = (e) => {
      if (mode !== 'following') return
      e.preventDefault()
      e.stopPropagation()
      stopFollow()
    }
    addEventListener('contextmenu', onRightFollow, true)
    const toggleFollow = () => {
      feel('happy', 0.25)
      if (mode === 'following') return stopFollow()
      if (!['home', 'asleep'].includes(mode)) return
      wake()
      mode = 'following'
      addEventListener('pointermove', onFollowMove, true)
      twirl()
      sound('follow', 0.05)
    }

    // ---------- clicks: one = a poke (or go answer the waiting tab), two = follow ----------
    let clickTimer = 0
    const singleClick = () => {
      if (mode === 'visiting') {
        visitingTab?.click()
        return leaveVisit()
      }
      if (mode === 'asleep') return wake()
      if (mode !== 'home' || busy) return
      reactions.poke()
    }
    const onClick = (e) => {
      e.stopPropagation()
      if (justDragged) return
      clearTimeout(clickTimer)
      clickTimer = setTimeout(singleClick, 260)
    }
    const onDblClick = (e) => {
      e.stopPropagation()
      clearTimeout(clickTimer)
      toggleFollow()
    }
    home.addEventListener('click', onClick)
    home.addEventListener('dblclick', onDblClick)

    // ---------- what character files and dev tools can use ----------
    const api = {
      id,
      host,
      root: home,
      svg,
      parts,
      colors: C,
      mood,
      acts,
      reactions,
      get spot() {
        return { ...spot }
      },
      get size() {
        return size
      },
      get mode() {
        return mode
      },
      get busy() {
        return Boolean(busy)
      },
      center,
      act,
      t,
      at,
      feel,
      emote,
      sparkle,
      floatUp,
      setFace,
      say,
      lines: L,
      get bond() {
        return bond
      },
      chime: (freqs, gain = 0.05, gap) => S && chime(freqs, gain * (S.gain ?? 1), gap),
      play,
      animateParts
    }
    T.companions.set(id, api)
    meetToday()
    try {
      cfg.onStart?.(api)
    } catch (error) {
      console.warn(`[companion ${id}] onStart failed`, error)
    }

    return () => {
      stopped = true
      if (T.companions.get(id) === api) T.companions.delete(id)
      loops.forEach((a) => a.cancel())
      setVigil(false)
      knock?.cancel()
      dozing?.cancel()
      release()
      cancelAnimationFrame(flightRaf)
      cancelAnimationFrame(followRaf)
      cancelAnimationFrame(gazeQueued)
      cancelAnimationFrame(statusQueued)
      for (const timer of [faceTimer, glowTimer, sleepTimer, zTimer, clickTimer, idleTimer, blinkTimer, petReset, landTimer, welcomeTimer]) clearTimeout(timer)
      for (const timer of [reposition, moodTimer, statusTimer, bondTimer]) clearInterval(timer)
      clearTimeout(meetTimer)
      hush()
      saveBond()
      toasts.disconnect()
      statusObserver.disconnect()
      removeEventListener('resize', onResize)
      removeEventListener('orca-themer:combo', onCombo)
      removeEventListener('blur', onLeave)
      removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
      removeEventListener('pointermove', onFollowMove, true)
      removeEventListener('contextmenu', onRightFollow, true)
      removeEventListener('pointermove', onPointer, { capture: true })
      removeEventListener('keydown', onTypeSway, { capture: true })
      removeEventListener('compositionupdate', onTypeSway, { capture: true })
      removeEventListener('keydown', onTypedChar, { capture: true })
      removeEventListener('compositionend', onTypedIme, { capture: true })
      for (const ev of activity) removeEventListener(ev, wake, { capture: true })
      try {
        cfg.onStop?.(api)
      } catch {}
      home.remove()
      if (!T.companions.size) host.remove() // leftover sparkles go with it
    }
  }
})()
