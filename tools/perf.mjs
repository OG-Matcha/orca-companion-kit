// Perf A/B for a companion: runs the same scripted session in an isolated Orca with and without the pet,
// and fails when the pet costs more than the budget. Never touches the Orca you are using.
//
//   npm run perf                       quick check (~3 min): Puff on vs off, budget enforced
//   node tools/perf.mjs --pet my-pet --theme my-theme     another companion (its theme must list it in @touches)
//   node tools/perf.mjs --study        full study: cases a/b/c × 3 runs, 5 min idle, writes JSON
//
// Options: --cases a,b,c  --reps N  --idle SEC  --type SEC  --pointer SEC  --burst SEC  --out FILE
//          --profile (CPU profile of case a while typing and moving the pointer)  --keep-work
//          --trace (Chromium trace of every case while typing and moving the pointer, with a summary of
//          where the renderer's main thread went: style, layout, paint, scripts)
//          --before DIR  also runs case a0: case a with the code of another checkout (e.g. before a fix)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { launch, sleep, themeTouches } from './perf-lib.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const study = flag('study')
const THEME = opt('theme', 'cotton-sky')
const PET = opt('pet', 'puff')

// What the A/B compares: the theme with every touch it lists, with (a) and without (b) the pet.
const allTouches = themeTouches(THEME)
const CASES = {
  a: { label: `主題＋全部 touch（含 ${PET}）`, touches: allTouches },
  b: { label: `主題＋全部 touch，關 ${PET}`, touches: allTouches.filter((t) => t !== PET) },
  c: { label: '主題，不開任何 touch', touches: [] }
}
if (opt('before')) CASES.a0 = { label: `同 a，程式碼取自 ${opt('before')}`, touches: allTouches, repo: path.resolve(opt('before')) }
const cases = opt('cases', (opt('before') ? 'a0,' : '') + (study ? 'a,b,c' : 'a,b')).split(',')
const reps = Number(opt('reps', study ? 3 : 1))
const dur = {
  idle: Number(opt('idle', study ? 300 : 30)),
  type: Number(opt('type', study ? 60 : 20)),
  pointer: Number(opt('pointer', study ? 60 : 15)),
  burst: Number(opt('burst', study ? 15 : 8))
}

// Budget for `npm run perf` (pet on minus pet off, same session). See docs/performance.md「量測」.
export const BUDGET = {
  // A regression guard set just above what Puff measured on 2026-10-28 after the layer work (a − b).
  // A single quick run swings a few s/min either way, hence the margin.
  idleCpuMsPerMin: 3000, // main-thread busy time per minute while nobody touches Orca
  idleLongTasks: 2, // long tasks (>50 ms) the pet may add while idle
  typeKeyP95Ms: 20, // extra keydown→paint at p95 while typing
  typeCpuMsPerMin: 13000,
  pointerCpuMsPerMin: 13000,
  heapGrowthMBPerHour: 15 // after GC, extrapolated from the idle stretch
}

const WORK = opt('work', path.join(process.env.ORCA_PERF_TEMP || os.tmpdir(), `orca-perf-${process.pid}`))
const SEED = path.join(WORK, 'seed-ud')
const SCRATCH_REPO = path.join(WORK, 'repo')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---------- in-page instrumentation ----------
// Installed before Orca's own scripts (see prepare()): counts timers and frames for the whole page.
const TIMER_WRAP = `(() => {
  if (window.__perfT) return
  const T = (window.__perfT = { ivLive: 0, ivMade: 0, toMade: 0, rafMade: 0, ivFired: 0, toFired: 0, rafFired: 0 })
  const live = new Set()
  const si = window.setInterval, ci = window.clearInterval, st = window.setTimeout, raf = window.requestAnimationFrame
  T.raf = raf.bind(window)
  window.setInterval = function (f, ...a) {
    T.ivMade++
    const g = typeof f === 'function' ? function (...x) { T.ivFired++; return f.apply(this, x) } : f
    const id = si.call(window, g, ...a)
    live.add(id); T.ivLive = live.size
    return id
  }
  window.clearInterval = function (id) { live.delete(id); T.ivLive = live.size; return ci.call(window, id) }
  window.setTimeout = function (f, ...a) {
    T.toMade++
    const g = typeof f === 'function' ? function (...x) { T.toFired++; return f.apply(this, x) } : f
    return st.call(window, g, ...a)
  }
  window.requestAnimationFrame = function (f) { T.rafMade++; return raf.call(window, (t) => { T.rafFired++; return f(t) }) }
})()`

const COLLECTOR = `(() => {
  if (!window.__perf) {
    const P = (window.__perf = { lt: [], ev: [], keys: [], frames: [], framing: false })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push(Math.round(e.duration)) }).observe({ type: 'longtask' })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown') P.ev.push(e.duration) }).observe({ type: 'event', durationThreshold: 16 })
    // keydown → the frame after it is presented (rAF, then a task after the frame).
    const mc = new MessageChannel()
    let pending = []
    mc.port1.onmessage = () => { const now = performance.now(); for (const t of pending) P.keys.push(now - t); pending = [] }
    addEventListener('keydown', (e) => {
      if (!e.isTrusted) return
      pending.push(e.timeStamp)
      if (pending.length === 1) (window.__perfT?.raf ?? requestAnimationFrame)(() => mc.port2.postMessage(0))
    }, true)
    const raf = window.__perfT?.raf ?? requestAnimationFrame
    let last = 0
    const frame = (t) => { if (!P.framing) return (last = 0); if (last) P.frames.push(t - last); last = t; raf(frame) }
    P.startFrames = () => { if (!P.framing) { P.framing = true; raf(frame) } }
    P.stopFrames = () => { P.framing = false }
  }
  const P = window.__perf
  P.lt = []; P.ev = []; P.keys = []; P.frames = []
  return true
})()`

const SNAP = `(() => {
  const P = window.__perf, T = window.__perfT ?? {}
  return {
    lt: P.lt.slice(), ev: P.ev.slice(), keys: P.keys.map((x) => Math.round(x * 10) / 10), frames: P.frames.map((x) => Math.round(x * 10) / 10),
    timers: { ivLive: T.ivLive, ivMade: T.ivMade, toMade: T.toMade, rafMade: T.rafMade, ivFired: T.ivFired, toFired: T.toFired, rafFired: T.rafFired },
    animations: document.getAnimations().length,
    nodes: document.getElementsByTagName('*').length,
    hidden: document.hidden
  }
})()`

// ---------- one isolated Orca ----------
function makeSeed() {
  if (fs.existsSync(SEED)) return
  fs.mkdirSync(SCRATCH_REPO, { recursive: true })
  if (!fs.existsSync(path.join(SCRATCH_REPO, '.git'))) {
    const git = (...a) => execFileSync('git', ['-C', SCRATCH_REPO, ...a], { stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    fs.writeFileSync(path.join(SCRATCH_REPO, 'README.md'), 'perf scratch repo\n')
    git('add', 'README.md')
    git('-c', 'user.name=perf', '-c', 'user.email=perf@example.invalid', 'commit', '-q', '-m', 'init')
  }
}

const EXTRA_ARGS = [
  // The test window may sit behind other windows; without these Chromium would stop painting it and
  // throttle its timers, and nothing would be measured.
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows'
]

// Orca's first-run tips (feature dialogs, toasts) would take the keyboard focus from the terminal.
const CLOSE_POPUPS = `async () => {
  for (let i = 0; i < 3 && document.querySelector('[role="dialog"], [data-sonner-toast]'); i++) {
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      const bs = [...d.querySelectorAll('button')]
      const close = bs.find((b) => /^(close|dismiss|not now|skip|maybe later)$/i.test(b.textContent.trim()) || /^(close|dismiss)/i.test(b.getAttribute('aria-label') || ''))
      // Never the dialog's last button: on Orca's tips that is the feature's own action.
      if (close) close.click()
      else d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    }
    document.querySelectorAll('[data-sonner-toast] [data-close-button]').forEach((b) => b.click())
    await new Promise((r) => setTimeout(r, 500))
  }
  document.querySelector('.xterm-helper-textarea')?.focus()
  return document.querySelectorAll('[role="dialog"]').length
}`

const PREP =  (repo) => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const o = window.api?.onboarding
  const s0 = await o?.get?.()
  if (s0 && !s0.closedAt) { await o.update({ closedAt: Date.now(), outcome: 'skipped', lastCompletedStep: 3, checklist: { dismissed: true } }); return 'reload' }
  const u = [...document.querySelectorAll('script,link')].map((e) => e.src || e.href).find((s) => s && s.includes('/store-'))
  const st = (await import(u)).n
  if (!st.getState().allWorktrees().length) await st.getState().addRepoPath(${JSON.stringify(repo)})
  for (let i = 0; i < 30 && !st.getState().allWorktrees().length; i++) await wait(500)
  const wt = st.getState().allWorktrees()[0]
  if (!wt) return JSON.stringify({ error: 'no worktree' })
  // Same layout in every run: Orca's defaults (sidebars open at their default widths).
  st.getState().setSidebarOpen?.(true); st.getState().setSidebarWidth?.(280)
  st.getState().setRightSidebarOpen?.(true); st.getState().setRightSidebarWidth?.(350)
  if (st.getState().activeWorktreeId !== wt.id) { st.getState().setActiveWorktree(wt.id); await wait(1500) }
  // A restored terminal mounts a few seconds after the sidebar; opening one before that splits the tab.
  const tabsBefore = document.querySelectorAll('[data-testid="sortable-tab"]').length
  for (let i = 0; i < 40 && !document.querySelector('.xterm'); i++) await wait(500)
  window.__perfPrep = { tabsBefore, xtermsAfterWait: document.querySelectorAll('.xterm').length }
  if (!document.querySelector('.xterm')) { st.getState().openNewTerminalTabInActiveWorkspace?.(); await wait(4000) }

  // A fresh profile sometimes restores its first terminal as two panes; keep one so every run has the same layout.
  for (let i = 0; i < 5 && document.querySelectorAll('.pane[data-pane-id]').length > 1; i++) {
    const b = [...document.querySelectorAll('[aria-label="Close Pane"]')].at(-1)
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) b?.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, button: 0 }))
    b?.click()
    await wait(1500)
  }
  await (${CLOSE_POPUPS})()
  const ta = document.querySelector('.xterm-helper-textarea')
  ta?.focus()
  const x = document.querySelector('.xterm')?.getBoundingClientRect()
  return JSON.stringify({ xterms: document.querySelectorAll('.xterm').length, xterm: x && [x.x, x.y, x.width, x.height], focused: document.activeElement === ta, w: innerWidth, h: innerHeight, dialogs: document.querySelectorAll('[role="dialog"]').length, pet: !!document.querySelector('[data-companion]'), visible: document.visibilityState, prep: window.__perfPrep })
})()`

async function prepare(inst) {
  for (let i = 0; i < 4; i++) {
    const r = await inst.eval(PREP(SCRATCH_REPO), 60000)
    if (r !== 'reload') return JSON.parse(r)
    await inst.cdp('Page.reload', {})
    await waitUi(inst)
  }
  throw new Error('could not prepare the window')
}

async function waitUi(inst) {
  const until = Date.now() + 60000
  while (Date.now() < until) {
    await sleep(1000)
    const ok = await inst.eval(`!!document.querySelector('.bg-worktree-sidebar') && !!window.__orcaThemer`, 5000).catch(() => false)
    if (ok) return
  }
  throw new Error('window did not come back')
}

async function startInstance(caseId, run) {
  const work = path.join(WORK, `${caseId}-${run}`)
  fs.rmSync(work, { recursive: true, force: true })
  const inst = await launch({ work, repo: CASES[caseId].repo, themeId: THEME, touches: CASES[caseId].touches, seedUserData: fs.existsSync(SEED) ? SEED : undefined, extraArgs: EXTRA_ARGS })
  try {
    return await setUp(inst, caseId, run)
  } catch (e) {
    await inst.stop()
    throw e
  }
}

async function setUp(inst, caseId, run) {
  // Timer counting has to run before Orca's own code: register it, have the themer re-register its own
  // script after it (a theme save triggers that), then reload.
  await inst.cdp('Page.enable') // scripts added for new documents only run once Page is enabled
  await inst.cdp('Page.addScriptToEvaluateOnNewDocument', { source: TIMER_WRAP })
  const themeFile = path.join(inst.root, 'themes', `${THEME}.css`)
  fs.writeFileSync(themeFile, fs.readFileSync(themeFile, 'utf8'))
  await sleep(1500)
  await inst.cdp('Page.reload', {})
  await waitUi(inst)
  const info = await prepare(inst)
  await inst.dev({ cmd: 'screenshot', out: path.join(WORK, `shot-${caseId}-${run}.png`) })
  if (!info.xterm || !info.focused || info.xterms !== 1) throw new Error(`no terminal: ${JSON.stringify(info)}`)
  await inst.cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
  await inst.cdp('Performance.enable', { timeDomain: 'timeTicks' })
  const wrapped = await inst.eval('!!window.__perfT && window.__perfT.ivLive')
  return { inst, info, wrapped }
}

// ---------- measuring ----------
async function snapshot(inst, gc = false) {
  if (gc) await inst.cdp('HeapProfiler.collectGarbage', {})
  const [{ metrics }, heap, page] = await Promise.all([inst.cdp('Performance.getMetrics'), inst.cdp('Runtime.getHeapUsage'), inst.eval(SNAP)])
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
  return { at: Date.now(), m, heapMB: heap.usedSize / 1048576, page }
}

const pct = (arr, p) => {
  if (!arr.length) return 0
  const s = [...arr].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p + 0.5))]
}

function summarize(a, b) {
  const min = (b.at - a.at) / 60000
  const d = (k) => (b.m[k] ?? 0) - (a.m[k] ?? 0)
  const t = (k) => (b.page.timers[k] ?? 0) - (a.page.timers[k] ?? 0)
  const lt = b.page.lt
  const keys = b.page.keys
  const frames = b.page.frames
  return {
    minutes: +min.toFixed(2),
    cpuMsPerMin: +((d('TaskDuration') * 1000) / min).toFixed(0),
    scriptMsPerMin: +((d('ScriptDuration') * 1000) / min).toFixed(0),
    styleMsPerMin: +((d('RecalcStyleDuration') * 1000) / min).toFixed(0),
    layoutMsPerMin: +((d('LayoutDuration') * 1000) / min).toFixed(0),
    recalcPerMin: +(d('RecalcStyleCount') / min).toFixed(0),
    layoutsPerMin: +(d('LayoutCount') / min).toFixed(0),
    longTasks: lt.length,
    longTaskMs: lt.reduce((s, x) => s + x, 0),
    longTaskMax: lt.length ? Math.max(...lt) : 0,
    keys: keys.length,
    keyP50: +pct(keys, 0.5).toFixed(1),
    keyP95: +pct(keys, 0.95).toFixed(1),
    keyMax: keys.length ? +Math.max(...keys).toFixed(1) : 0,
    keyEvt16: b.page.ev.length, // keydown event-timing entries ≥16 ms (input → next paint)
    keyEvtMax: b.page.ev.length ? Math.max(...b.page.ev) : 0,
    frameP95: +pct(frames, 0.95).toFixed(1),
    framesOver50: frames.filter((x) => x > 50).length,
    frames: frames.length,
    timeoutsPerMin: +(t('toFired') / min).toFixed(0),
    intervalsFiredPerMin: +(t('ivFired') / min).toFixed(0),
    rafPerMin: +(t('rafFired') / min).toFixed(0),
    liveIntervals: b.page.timers.ivLive,
    animations: b.page.animations,
    nodes: b.page.nodes,
    heapStartMB: +a.heapMB.toFixed(2),
    heapEndMB: +b.heapMB.toFixed(2),
    listeners: b.m.JSEventListeners,
    hidden: b.page.hidden
  }
}

async function measure(inst, name, body, { gc = false } = {}) {
  await inst.eval(`(${CLOSE_POPUPS})()`)
  await inst.eval(COLLECTOR)
  const a = await snapshot(inst, gc)
  const extra = (await body()) ?? {}
  const b = await snapshot(inst, gc)
  return { ...summarize(a, b), ...extra }
}

// Scenario bodies. Input goes through the themer's cdp-seq, so it reaches Orca as real input events.
async function idle(inst, seconds) {
  const samples = []
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) {
    await sleep(Math.min(60000, until - Date.now()))
    const h = await inst.cdp('Runtime.getHeapUsage')
    samples.push(+(h.usedSize / 1048576).toFixed(2))
  }
  return { heapSamples: samples }
}

const LINES = ['echo perf line one two three', 'echo the moon is up tonight', 'echo abcdefghij klmnop 12345', 'echo quiet typing test here']
function typingSteps(seconds, cps = 8) {
  const steps = []
  let elapsed = 0
  let li = 0
  while (elapsed < seconds * 1000) {
    const text = LINES[li++ % LINES.length]
    for (const ch of text) {
      const vk = /[a-z0-9]/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : ch === ' ' ? 32 : 0
      steps.push({ method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: ch, code: '', windowsVirtualKeyCode: vk, text: ch } })
      steps.push({ method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: ch, code: '', windowsVirtualKeyCode: vk } })
      const gap = Math.round((1000 / cps) * (0.6 + ((li * 7 + ch.charCodeAt(0)) % 9) / 10))
      steps.push({ wait: gap })
      elapsed += gap
    }
    steps.push({ method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' } })
    steps.push({ method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 } })
    steps.push({ wait: 400 })
    elapsed += 400
  }
  return steps
}

function pointerSteps(seconds, w, h, pet) {
  const steps = []
  const n = Math.round((seconds * 1000) / 16)
  for (let i = 0; i < n; i++) {
    const t = i / 60
    // A Lissajous sweep over the window, pulled toward the pet every few seconds so it reacts.
    let x = w / 2 + (w / 2 - 20) * Math.sin(t * 0.9)
    let y = h / 2 + (h / 2 - 20) * Math.sin(t * 1.3 + 1)
    const pull = pet ? Math.max(0, Math.sin(t * 0.5)) ** 4 : 0
    if (pet) (x = x + (pet.x - x) * pull), (y = y + (pet.y - y) * pull)
    steps.push({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) } })
    steps.push({ wait: 16 })
  }
  return steps
}

async function seq(inst, steps) {
  const r = await inst.dev({ cmd: 'cdp-seq', steps }, 15 * 60000)
  if (!r.ok) throw new Error(`cdp-seq: ${r.error}`)
}

async function typeLine(inst, text) {
  const steps = []
  for (const ch of text) steps.push({ method: 'Input.insertText', params: { text: ch } })
  steps.push({ method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' } })
  steps.push({ method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 } })
  await seq(inst, steps)
}

// With --trace: a Chromium trace over the middle of a scenario, summarized as main-thread time by event.
async function traced(inst, name, seconds, body) {
  if (!flag('trace')) return body()
  const out = path.join(WORK, `trace-${name}.json`)
  const ms = Math.max(1000, (seconds - 2) * 1000)
  const tracing = inst.dev({ cmd: 'trace', ms, out, categories: ['devtools.timeline', 'blink.animations', 'disabled-by-default-devtools.timeline'] }, ms + 120000)
  // The themer handles one batch of dev commands per tick; a second command in the same batch would wait
  // behind the trace (or be picked up twice), so the scenario starts once the trace has.
  await sleep(800)
  const [r] = await Promise.all([tracing, body()])
  if (!r.ok) throw new Error(`trace: ${r.error}`)
  log(name, 'trace', out, JSON.stringify(traceSummary(JSON.parse(fs.readFileSync(out, 'utf8')), ms)))
}

// Self time per event name on the renderer's main thread, in ms per minute.
export function traceSummary(events, ms) {
  const threads = new Map(events.filter((e) => e.name === 'thread_name').map((e) => [`${e.pid}:${e.tid}`, e.args.name]))
  const main = events.filter((e) => threads.get(`${e.pid}:${e.tid}`) === 'CrRendererMain' && e.ph === 'X' && e.dur != null)
  const byThread = new Map()
  for (const e of main) {
    const k = `${e.pid}:${e.tid}`
    if (!byThread.has(k)) byThread.set(k, [])
    byThread.get(k).push(e)
  }
  // The busiest renderer is the Orca window.
  const list = [...byThread.values()].sort((x, y) => y.reduce((s, e) => s + e.dur, 0) - x.reduce((s, e) => s + e.dur, 0))[0] ?? []
  list.sort((x, y) => x.ts - y.ts || y.dur - x.dur)
  const self = new Map()
  const stack = []
  for (const e of list) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop()
    const parent = stack.at(-1)
    if (parent) self.set(parent.name, (self.get(parent.name) ?? 0) - e.dur)
    self.set(e.name, (self.get(e.name) ?? 0) + e.dur)
    stack.push(e)
  }
  const perMin = 60000 / ms
  return Object.fromEntries([...self].filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => [k, Math.round((v / 1000) * perMin)]))
}

async function runOnce(caseId, run, { profile = false } = {}) {
  const t0 = Date.now()
  const { inst, info, wrapped } = await startInstance(caseId, run)
  log(`case ${caseId} run ${run}: up in ${((Date.now() - t0) / 1000).toFixed(0)} s`, JSON.stringify(info), 'live intervals', wrapped)
  const out = { case: caseId, run, info, scenarios: {} }
  try {
    await inst.eval(`document.querySelector('.xterm-helper-textarea')?.focus()`)
    await typeLine(inst, 'cls')
    await sleep(Number(opt('settle', study ? 20 : 8)) * 1000)
    out.scenarios.idle = await measure(inst, 'idle', () => idle(inst, dur.idle), { gc: true })
    log(caseId, run, 'idle', JSON.stringify(pick(out.scenarios.idle)))
    await inst.eval(`document.querySelector('.xterm-helper-textarea')?.focus()`)
    if (profile) await inst.cdp('Profiler.enable'), await inst.cdp('Profiler.setSamplingInterval', { interval: 250 }), await inst.cdp('Profiler.start')
    out.scenarios.type = await measure(inst, 'type', () => traced(inst, `${caseId}-${run}-type`, dur.type, () => seq(inst, typingSteps(dur.type))))
    log(caseId, run, 'type', JSON.stringify(pick(out.scenarios.type)))
    const pet = await inst.eval(`(() => { const r = document.querySelector('[data-companion]')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`)
    out.scenarios.pointer = await measure(inst, 'pointer', async () => {
      await inst.eval('window.__perf.startFrames()')
      await traced(inst, `${caseId}-${run}-pointer`, dur.pointer, () => seq(inst, pointerSteps(dur.pointer, info.w, info.h, pet ?? { x: 300, y: info.h - 80 })))
      await inst.eval('window.__perf.stopFrames()')
    })
    log(caseId, run, 'pointer', JSON.stringify(pick(out.scenarios.pointer)))
    if (profile) {
      const { profile: p } = await inst.cdp('Profiler.stop', {}, 120000)
      const file = path.join(WORK, `profile-${caseId}-${run}.cpuprofile`)
      fs.writeFileSync(file, JSON.stringify(p))
      out.profile = file
    }
    await inst.eval(`document.querySelector('.xterm-helper-textarea')?.focus()`)
    out.scenarios.burst = await measure(inst, 'burst', async () => {
      await inst.eval('window.__perf.startFrames()')
      await typeLine(inst, `node "${path.join(REPO, 'tools', 'perf-burst.mjs')}" ${dur.burst}`)
      await sleep(dur.burst * 1000 + 2500)
      await inst.eval('window.__perf.stopFrames()')
    })
    log(caseId, run, 'burst', JSON.stringify(pick(out.scenarios.burst)))
  } finally {
    await inst.stop()
    if (!flag('keep-work')) fs.rmSync(inst.work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
  return out
}

const pick = (s) => ({ cpu: s.cpuMsPerMin, style: s.recalcPerMin, lt: s.longTasks, ltMax: s.longTaskMax, keyP50: s.keyP50, keyP95: s.keyP95, fr95: s.frameP95, fr50: s.framesOver50, heap: `${s.heapStartMB}→${s.heapEndMB}`, iv: s.liveIntervals, anim: s.animations })

// ---------- report ----------
const median = (a) => pct(a, 0.5)
function table(results) {
  const metrics = ['cpuMsPerMin', 'scriptMsPerMin', 'styleMsPerMin', 'recalcPerMin', 'layoutsPerMin', 'longTasks', 'longTaskMax', 'keyP50', 'keyP95', 'keyMax', 'frameP95', 'framesOver50', 'timeoutsPerMin', 'intervalsFiredPerMin', 'rafPerMin', 'liveIntervals', 'animations', 'heapStartMB', 'heapEndMB']
  const rows = []
  for (const sc of ['idle', 'type', 'pointer', 'burst']) {
    for (const m of metrics) {
      const row = [sc, m]
      for (const c of cases) {
        const vals = results.filter((r) => r.case === c && r.scenarios[sc]).map((r) => r.scenarios[sc][m])
        row.push(vals.length ? `${median(vals)} [${Math.min(...vals)}–${Math.max(...vals)}]` : '-')
      }
      rows.push(row)
    }
  }
  const head = ['scenario', 'metric', ...cases.map((c) => `${c}: ${CASES[c].label}`)]
  return [head, ...rows].map((r) => r.join(' | ')).join('\n')
}

function heapSlopeMBPerHour(s) {
  return ((s.heapEndMB - s.heapStartMB) / s.minutes) * 60
}

function verdict(results) {
  const get = (c, sc, m) => median(results.filter((r) => r.case === c).map((r) => r.scenarios[sc][m]))
  const on = 'a'
  const off = 'b'
  const checks = [
    ['閒置 CPU（ms/分鐘）', get(on, 'idle', 'cpuMsPerMin') - get(off, 'idle', 'cpuMsPerMin'), BUDGET.idleCpuMsPerMin],
    ['閒置長任務（個）', get(on, 'idle', 'longTasks') - get(off, 'idle', 'longTasks'), BUDGET.idleLongTasks],
    ['打字 按鍵→畫面 p95（ms）', get(on, 'type', 'keyP95') - get(off, 'type', 'keyP95'), BUDGET.typeKeyP95Ms],
    ['打字 CPU（ms/分鐘）', get(on, 'type', 'cpuMsPerMin') - get(off, 'type', 'cpuMsPerMin'), BUDGET.typeCpuMsPerMin],
    ['游標 CPU（ms/分鐘）', get(on, 'pointer', 'cpuMsPerMin') - get(off, 'pointer', 'cpuMsPerMin'), BUDGET.pointerCpuMsPerMin],
    ['閒置堆積成長（MB/小時，GC 後）', median(results.filter((r) => r.case === on).map((r) => heapSlopeMBPerHour(r.scenarios.idle))), BUDGET.heapGrowthMBPerHour]
  ]
  let ok = true
  for (const [name, delta, budget] of checks) {
    const pass = delta <= budget
    ok &&= pass
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${PET} 多花 ${delta.toFixed(1)}，預算 ${budget}`)
  }
  return ok
}

// ---------- main ----------
fs.mkdirSync(WORK, { recursive: true })
makeSeed()
const results = []
const plan = []
for (let r = 1; r <= reps; r++) for (const c of cases) plan.push([c, r]) // interleaved, so system load drifts evenly
log(`work ${WORK}; plan ${plan.map((p) => p.join('')).join(' ')}; durations ${JSON.stringify(dur)}`)
let failed = false
try {
  for (const [c, r] of plan) {
    try {
      results.push(await runOnce(c, r, { profile: flag('profile') && c === 'a' }))
    } catch (e) {
      log(`case ${c} run ${r} failed:`, e.stack ?? e.message)
      failed = true
    }
    const outFile = opt('out', path.join(WORK, 'results.json'))
    fs.writeFileSync(outFile, JSON.stringify({ when: new Date().toISOString(), host: os.hostname(), cpus: os.cpus().length, dur, results }, null, 1))
  }
} finally {
  if (!flag('keep-work')) for (const n of fs.readdirSync(WORK)) if (/^[abc]\d?-\d+$/.test(n)) fs.rmSync(path.join(WORK, n), { recursive: true, force: true })
}
console.log('\n' + table(results))
if (cases.includes('a') && cases.includes('b') && results.some((r) => r.case === 'a') && results.some((r) => r.case === 'b')) {
  const ok = verdict(results)
  if (!flag('study') && !flag('keep-work') && !opt('work')) fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  process.exitCode = ok && !failed ? 0 : 1
} else process.exitCode = failed ? 1 : 0
