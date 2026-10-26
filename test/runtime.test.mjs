// How the injected script is put together, how bundled files reach the user folder, and the companion's
// own hygiene (every listener it adds is removed; it never binds Esc).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { buildRuntimeSource, touchFiles } from '../src/runtime-source.mjs'
import { exampleSources, seedBundled } from '../src/seed.mjs'
import { cursorCss, svgDataUri } from '../tools/cursor-css.mjs'
import { chimeWav } from '../tools/make-chime.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orca-companion-'))

test('touches load in a fixed order: repo first, then the user folder, each sorted by name', () => {
  const repo = tmp()
  const user = tmp()
  for (const n of ['b.js', 'a.js', 'notes.txt']) fs.writeFileSync(path.join(repo, n), '')
  for (const n of ['z.js', 'c.js']) fs.writeFileSync(path.join(user, n), '')
  assert.deepEqual(touchFiles(repo, user).map((f) => path.basename(f)), ['a.js', 'b.js', 'c.js', 'z.js'])
  assert.deepEqual(touchFiles(repo, path.join(user, 'missing')).map((f) => path.basename(f)), ['a.js', 'b.js'])
})

test('a user touch with a syntax error is left out; the rest still load, each in its own try block', () => {
  const user = tmp()
  fs.writeFileSync(path.join(user, 'good.js'), 'window.good = 1')
  fs.writeFileSync(path.join(user, 'broken.js'), 'window.bad = (')
  const built = buildRuntimeSource({ runtimeFile: path.join(REPO, 'src', 'page-runtime.js'), repoTouchesDir: path.join(REPO, 'src', 'touches'), userTouchesDir: user })
  assert.deepEqual(built.skipped.map((s) => path.basename(s.file)), ['broken.js'])
  assert.ok(built.source.includes('window.good = 1'))
  assert.ok(!built.source.includes('window.bad'))
  assert.ok(built.source.indexOf('registerCompanion') < built.source.indexOf('window.good'), 'companion engine loads before user touches')
  new vm.Script(built.source) // the whole script parses (compiled, not run)
})

test('seeding copies new files, follows bundled updates, and never overwrites an edit', () => {
  const from = tmp()
  const root = tmp()
  const src = [{ from, kind: 'themes' }]
  fs.writeFileSync(path.join(from, 'a.css'), 'v1')
  assert.deepEqual(seedBundled(root, src), [path.join('themes', 'a.css')])
  fs.writeFileSync(path.join(from, 'a.css'), 'v2')
  seedBundled(root, src)
  assert.equal(fs.readFileSync(path.join(root, 'themes', 'a.css'), 'utf8'), 'v2', 'untouched file follows the update')
  fs.writeFileSync(path.join(root, 'themes', 'a.css'), 'mine')
  fs.writeFileSync(path.join(from, 'a.css'), 'v3')
  seedBundled(root, src)
  assert.equal(fs.readFileSync(path.join(root, 'themes', 'a.css'), 'utf8'), 'mine', 'an edit is kept')
  fs.unlinkSync(path.join(root, 'themes', 'a.css'))
  seedBundled(root, src)
  assert.equal(fs.existsSync(path.join(root, 'themes', 'a.css')), false, 'a deletion is kept')
  seedBundled(root, src, { restoreDeleted: true })
  assert.equal(fs.readFileSync(path.join(root, 'themes', 'a.css'), 'utf8'), 'v3', 'npm run example brings it back')
})

test('the examples seed into every kind folder', () => {
  const root = tmp()
  const copied = seedBundled(root, exampleSources(REPO))
  for (const want of [path.join('themes', 'cotton-sky.css'), path.join('terminal', 'cotton-sky.json'), path.join('touches', 'puff.js')]) assert.ok(copied.includes(want), want)
})

test('companion: every window/document listener it adds is removed in stop(), and Esc is never bound', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'touches', 'companion.js'), 'utf8')
  const added = [...src.matchAll(/^\s*(document\.)?addEventListener\('([\w-]+)', (\w+)/gm)].map((m) => `${m[1] ?? ''}${m[2]}:${m[3]}`)
  const removed = new Set([...src.matchAll(/(document\.)?removeEventListener\('([\w-]+)', (\w+)/g)].map((m) => `${m[1] ?? ''}${m[2]}:${m[3]}`))
  assert.ok(added.length > 10)
  for (const a of added) assert.ok(removed.has(a), `not removed: ${a}`)
  // `for (const ev of activity) addEventListener(ev, wake ...)` is paired the same way.
  assert.match(src, /for \(const ev of activity\) removeEventListener\(ev, wake/)
  assert.doesNotMatch(src.replace(/\/\/[^\n]*/g, ''), /['"]Escape['"]|['"]Esc['"]/)
})

test('cursor tool: 1x and 2x data URIs with the hotspot, keyed on the touch attribute', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0" fill="#fff"/></svg>'
  const css = cursorCss(svg, { x: 3, y: 4 })
  assert.match(css, /html\[data-orca-touch-custom-cursor\]/)
  assert.match(css, /-webkit-image-set\(url\("data:image\/svg\+xml,[^"]+"\) 1x, url\("data:image\/svg\+xml,[^"]+"\) 2x\) 3 4/)
  assert.match(css, /width='48' height='48'/)
  assert.doesNotMatch(svgDataUri(svg), /[#<>"]/)
})

test('chime tool: a valid 16-bit mono WAV', () => {
  const wav = chimeWav([880])
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt32LE(40), wav.length - 44)
})
