// The pet's settings: the catalog the panel is drawn from (T.companionConfig), how saved values are
// cleaned and diffed, quiet hours, the launcher's check on what a page sends, and the panel's hygiene
// (no Esc, every window listener removed, a picker row). Pure parts only; no DOM.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { companionConfig, publicState } from '../src/themes.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8')
const picker = []
const ctx = { window: { __orcaThemer: { registerTouch() {}, registerPickerItem: (item) => picker.push(item) } }, matchMedia: () => ({ matches: false }) }
vm.createContext(ctx)
vm.runInContext(read('src', 'touches', 'companion.js'), ctx)
vm.runInContext(read('src', 'touches', 'companion_settings.js'), ctx)
const C = ctx.window.__orcaThemer.companionConfig
const plain = (v) => JSON.parse(JSON.stringify(v))

// A pet as the engine describes it to the catalog.
const petOf = (cfg, extra = {}) => ({
  cfg,
  acts: new Set(['wiggle', 'wander', ...Object.keys(cfg.acts ?? {})]),
  parts: new Set(['eyes']),
  speaks: true,
  sounds: true,
  song: Boolean(cfg.sing),
  songVolume: cfg.sing?.volume,
  glow: true,
  ...extra
})
const ids = (sections) => C.items(sections).map((i) => i.id)
const section = (sections, id) => sections.find((s) => s.id === id)

test('catalog: every built-in behaviour has a row; opt-in ones default to what the pet config says', () => {
  const full = petOf({ hideAndSeek: true, git: true, caught: { scenes: ['juggle'] }, nuzzle: true, readAlong: true, lantern: true, sing: { asset: 'lullaby', volume: 0.5 } })
  const sections = C.catalog(full)
  assert.deepEqual(plain(sections.map((s) => s.id)), ['touch', 'typing', 'daily', 'welcome', 'agent', 'speech', 'sound', 'you'])
  for (const id of ['gaze', 'pet', 'nuzzle', 'seek', 'drag', 'throw', 'wheel', 'follow', 'startle', 'sway', 'words', 'sing', 'gitCommit', 'gitPush', 'idle', 'sleep', 'read', 'lantern', 'welcome', 'caught', 'vigil', 'knock', 'speech', 'talk', 'quiet', 'sound', 'chime', 'song', 'name', 'forget'])
    assert.ok(ids(sections).includes(id), id)
  const on = C.defaults(sections, full).features
  for (const id of ['seek', 'nuzzle', 'gitCommit', 'gitPush', 'caught', 'read', 'lantern', 'gaze', 'knock', 'blink']) assert.equal(on[id], true, id)
  assert.equal(C.defaults(sections, full).sound.song, 0.5)

  const bare = petOf({ visitTabs: false, blink: false, hideAndSeek: { click: false } })
  const off = C.defaults(C.catalog(bare), bare).features
  for (const id of ['seek', 'nuzzle', 'gitCommit', 'caught', 'read', 'lantern', 'knock', 'blink']) assert.equal(off[id], false, id)
  assert.equal(off.gaze, true)
})

test('catalog: rows the pet cannot do are left out (no lines, no sounds, no song, no wander)', () => {
  const quiet = petOf({ acts: { wander: null } }, { speaks: false, sounds: false, glow: false, acts: new Set(['wiggle']) })
  const sections = C.catalog(quiet)
  const all = ids(sections)
  for (const id of ['speech', 'talk', 'dailyCap', 'quiet', 'name', 'late', 'sound', 'chime', 'song', 'wander', 'comboGlow', 'vigil']) assert.ok(!all.includes(id), id)
  assert.equal(section(sections, 'speech'), undefined)
  assert.equal(section(sections, 'sound'), undefined)
  assert.ok(!ids(C.catalog(petOf({}))).includes('song'), 'no sing asset, no song volume')
})

test('catalog: a pet registers its own behaviours, renames or hides built-in rows, adds a section', () => {
  const preview = () => true
  const cfg = {
    sections: [{ id: 'garden', label: '花園', intro: '牠的小花園。' }],
    behaviors: [
      { id: 'puffUp', label: '蓬起毛', desc: '偶爾把毛蓬起來。', freq: true, preview },
      { id: 'water', section: 'garden', label: '澆花', default: false },
      { id: 'startle', hidden: true },
      { id: 'wander', label: 'Stroll', desc: 'Walks off a little and comes back.' },
      { id: '../bad', label: 'x' },
      'junk'
    ]
  }
  const pet = petOf(cfg)
  const sections = C.catalog(pet)
  const puff = C.items(sections).find((i) => i.id === 'puffUp')
  assert.equal(section(sections, 'daily').items.at(-1).id, 'puffUp')
  assert.equal(puff.freq, true)
  assert.equal(puff.run, preview)
  assert.deepEqual(plain(section(sections, 'garden').items.map((i) => i.id)), ['water'])
  assert.equal(sections.at(-1).id, 'you', 'a new section goes before 「你和牠」')
  // A hidden row is not drawn, but keeps its default: a hidden opt-in stays off.
  assert.equal(C.items(sections).find((i) => i.id === 'startle').hidden, true)
  assert.ok(!ids(sections).includes('../bad'))
  assert.equal(C.items(sections).find((i) => i.id === 'wander').label, 'Stroll')
  const d = C.defaults(sections, pet)
  assert.equal(d.features.puffUp, true)
  assert.equal(d.features.water, false)
  assert.equal(d.freq.puffUp, 1)
  assert.equal(d.features.startle, true)
  const hiddenOptIn = petOf({ behaviors: [{ id: 'seek', hidden: true }] })
  assert.equal(C.defaults(C.catalog(hiddenOptIn), hiddenOptIn).features.seek, false)
})

test('normalize: junk, partial and out-of-range values become a complete, valid config', () => {
  const pet = petOf({ sing: { asset: 'x' } })
  const base = C.defaults(C.catalog(pet), pet)
  assert.deepEqual(plain(C.normalize(null, base)), plain(base))
  assert.deepEqual(plain(C.normalize('nope', base)), plain(base))
  const n = C.normalize(
    {
      features: { gaze: false, seek: 'yes', unknown: false },
      freq: { idle: 3, sleep: 0.3, talk: 'x' },
      speech: { dailyCap: 999 },
      quiet: { on: true, start: '25:00', end: '06:30' },
      sound: { chime: -1, song: '0.8' },
      you: { name: '  小明\u0007的名字超過十六個字元一二三四五六  ' }
    },
    base
  )
  assert.equal(n.features.gaze, false)
  assert.equal(n.features.seek, base.features.seek)
  assert.ok(!('unknown' in n.features))
  assert.deepEqual([n.freq.idle, n.freq.sleep, n.freq.talk], [2, 0.25, 1])
  assert.equal(n.speech.dailyCap, 60)
  assert.deepEqual(plain(n.quiet), { on: true, start: '23:00', end: '06:30' })
  assert.deepEqual([n.sound.chime, n.sound.song], [0, 0.8])
  assert.equal(n.you.name.length, 16)
  assert.ok(!/[\u0000-\u001f]/.test(n.you.name))
})

test('diff: saves only what differs from the defaults, and reads back the same', () => {
  const pet = petOf({ nuzzle: true })
  const base = C.defaults(C.catalog(pet), pet)
  assert.deepEqual(plain(C.diff(base, base)), { v: C.VERSION })
  let cfg = C.setPath(base, 'features.nuzzle', false)
  cfg = C.setPath(cfg, 'freq.idle', 0.5)
  cfg = C.setPath(cfg, 'quiet.on', true)
  const saved = C.diff(cfg, base)
  assert.deepEqual(plain(saved), { v: C.VERSION, features: { nuzzle: false }, freq: { idle: 0.5 }, quiet: { on: true } })
  assert.deepEqual(plain(C.normalize(saved, base)), plain(cfg))
  assert.equal(base.features.nuzzle, true, 'setPath never changes its input')
  assert.equal(C.getPath(cfg, 'quiet.on'), true)
})

test('quiet hours: a window past midnight, an ordinary one, and an empty one', () => {
  const at = (h, m = 0) => h * 60 + m
  assert.equal(C.inWindow(at(23, 30), '23:00', '07:00'), true)
  assert.equal(C.inWindow(at(6, 59), '23:00', '07:00'), true)
  assert.equal(C.inWindow(at(7), '23:00', '07:00'), false)
  assert.equal(C.inWindow(at(12), '09:00', '17:00'), true)
  assert.equal(C.inWindow(at(17), '09:00', '17:00'), false)
  assert.equal(C.inWindow(at(9), '09:00', '09:00'), false)
  const cfg = { quiet: { on: true, start: '22:00', end: '06:00' } }
  assert.equal(C.quietAt(cfg, new Date(2026, 0, 1, 23, 0)), true)
  assert.equal(C.quietAt({ quiet: { ...cfg.quiet, on: false } }, new Date(2026, 0, 1, 23, 0)), false)
})

test('your name: {you} in a line, or in front of a greeting', () => {
  assert.equal(C.withName('早安，{you}！', '小明'), '早安，小明！')
  assert.equal(C.withName('{you}，早安', ''), '早安')
  assert.equal(C.withName('早安', '小明', true), '小明，早安')
  assert.equal(C.withName('早安', '小明'), '早安')
  assert.equal(C.withName(null, '小明', true), null)
})

test('launcher: keeps a pet config only for a safe id and a modest plain object; public state carries it', () => {
  assert.deepEqual(companionConfig('puff', { v: 1, features: { gaze: false } }), { v: 1, features: { gaze: false } })
  for (const [id, value] of [['../x', {}], ['', {}], [1, {}], ['puff', []], ['puff', null], ['puff', 'x'], ['puff', { big: 'x'.repeat(20000) }]])
    assert.equal(companionConfig(id, value), null, `${id} ${typeof value}`)
  const state = publicState({ themes: [], snippets: [] }, { themeId: null, enabledSnippets: [], enabledTouches: [], companions: { puff: { v: 1 } } })
  assert.deepEqual(state.companions, { puff: { v: 1 } })
  assert.deepEqual(publicState({ themes: [], snippets: [] }, { themeId: null, enabledSnippets: [], enabledTouches: [] }).companions, {})
})

test('panel: a picker row, no Esc, and every window listener it adds is removed', () => {
  assert.equal(picker.length, 1)
  assert.equal(picker[0].label, '寵物設定')
  assert.equal(picker[0].when(), false, 'no pet running, no row')
  const src = read('src', 'touches', 'companion_settings.js').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(src, /['"]Escape['"]|['"]Esc['"]|keyCode\s*===?\s*27/)
  const added = [...src.matchAll(/(?:^|[^.\w])addEventListener\('([\w:-]+)', (\w+)/gm)].map((m) => `${m[1]}:${m[2]}`)
  assert.ok(added.length >= 1)
  for (const a of added) assert.ok(new RegExp(`removeEventListener\\('${a.split(':').slice(0, -1).join(':')}', ${a.split(':').at(-1)}\\)`).test(src), `not removed: ${a}`)
})

test('runtime: the picker closes a panel with Ctrl+Alt+T, and local changes reach the page at once', () => {
  const src = read('src', 'page-runtime.js')
  assert.match(src, /if \(overlay\?\.isOpen\?\.\(\)\) return overlay\.close\(\)/)
  assert.match(src, /updateState\(patch\)[\s\S]{0,600}dispatchEvent\(new CustomEvent\('orca-themer:state'\)\)/)
  assert.match(read('src', 'themer.mjs'), /message\.type === 'companion-config'/)
  // The engine follows a change at once and stops listening when the pet stops.
  const engine = read('src', 'touches', 'companion.js')
  assert.match(engine, /addEventListener\('orca-themer:state', refresh\)/)
  assert.match(engine, /removeEventListener\('orca-themer:state', refresh\)/)
})

test('runtime: a broadcast older than a change made here does not undo it (fast clicks keep every change)', () => {
  const events = []
  const noop = () => {}
  const win = {
    addEventListener: noop,
    dispatchEvent: (e) => events.push(e.type),
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    location: { href: 'file:///x/out/renderer/index.html' },
    orcaThemerSend: noop
  }
  const sandbox = {
    window: win,
    ...win,
    document: { head: null, body: null, addEventListener: noop, getElementById: () => null, documentElement: { dataset: {} } },
    MutationObserver: class { observe() {} },
    PerformanceObserver: class { observe() {} },
    CustomEvent: class { constructor(type) { this.type = type } },
    requestAnimationFrame: noop,
    setTimeout,
    clearTimeout
  }
  vm.createContext(sandbox)
  vm.runInContext(read('src', 'page-runtime.js'), sandbox)
  const R = sandbox.window.__orcaThemer
  const A = { v: 1, features: { gaze: false } }
  const AB = { v: 1, features: { gaze: false, pet: false } }
  R.updateState({ companions: { puff: A } })
  R.updateState({ companions: { puff: AB } })
  assert.ok(events.includes('orca-themer:state'))
  // The launcher's broadcast for A arrives after B was made here: B stays.
  R.apply({ state: { companions: { puff: A } } })
  assert.deepEqual(plain(R.state.companions.puff), AB)
  // Once the launcher echoes B, the broadcast is the truth again (another window may change it later).
  R.apply({ state: { companions: { puff: AB } } })
  const C2 = { v: 1, features: { pet: false } }
  R.apply({ state: { companions: { puff: C2 } } })
  assert.deepEqual(plain(R.state.companions.puff), C2)
})
