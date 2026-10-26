import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { claudeRestartFix } from '../src/fixes/claude-restart.mjs'
import { composeCss, loadLibrary, publicState } from '../src/themes.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const ORIGINAL = 'x;function vt(e,t){let n=e.agentStatusByPaneKey[t];return n?.agentType===`claude`&&n.state!==`done`};y'

test('fix: patched function waits on prompts and the main agent, not background work', () => {
  const patched = claudeRestartFix.patch(ORIGINAL)
  assert.ok(claudeRestartFix.partial, 'the permission part is reported as missing')
  assert.ok(patched)
  const ctx = {}
  vm.runInNewContext(patched.replace(/^x;/, '').replace(/;y$/, '') + ';this.vt=vt', ctx)
  const midTurn = (state, mainAgent) =>
    ctx.vt({ agentStatusByPaneKey: { k: { agentType: 'claude', state, ...(mainAgent ? { mainAgent: { state: mainAgent } } : {}) } } }, 'k')
  assert.deepEqual([midTurn('working'), midTurn('blocked'), midTurn('waiting'), midTurn('done')], [true, true, true, false])
  assert.deepEqual([midTurn('working', 'done'), midTurn('working', 'working'), midTurn('waiting', 'done')], [false, true, true])
  assert.equal(ctx.vt({ agentStatusByPaneKey: { k: { agentType: 'codex', state: 'working' } } }, 'k'), false)
})

test('fix: Claude restarts keep the permission chosen in Orca (default args, bare command dropped)', () => {
  const resume = 'q={agentArgs:c===void 0?f?D(a,s.settings):null:c.agentArgs,...c?.agentCommand?{agentCommand:c.agentCommand}:{}}'
  const patched = claudeRestartFix.patch(`${ORIGINAL};${resume}`)
  assert.equal(claudeRestartFix.partial, null)
  assert.ok(patched)
  const obj = patched.slice(patched.indexOf('q={') + 2)
  const run = (a, c) => vm.runInNewContext(`(${obj})`, { a, c, f: false, D: () => '--full-access', s: { settings: {} } })
  assert.equal(run('claude', { agentArgs: '' }).agentArgs, '--full-access')
  assert.equal(run('claude', { agentArgs: '  ' }).agentArgs, '--full-access')
  assert.equal(run('claude', undefined).agentArgs, '--full-access')
  assert.equal(run('claude', { agentArgs: '--model x' }).agentArgs, '--model x')
  assert.equal(run('codex', { agentArgs: '' }).agentArgs, '')
  // A bare recorded "claude" would make resume ignore agentArgs; it is dropped so Orca rebuilds it.
  assert.equal(run('claude', { agentCommand: 'claude', agentArgs: '--x' }).agentCommand, undefined)
  assert.equal(run('claude', { agentCommand: 'claude --y', agentArgs: '' }).agentCommand, 'claude --y')
  assert.equal(run('codex', { agentCommand: 'codex', agentArgs: '' }).agentCommand, 'codex')
})

test('fix: leaves unknown or ambiguous builds alone', () => {
  assert.equal(claudeRestartFix.patch('function vt(e,t){return 1}'), null)
  assert.equal(claudeRestartFix.patch(ORIGINAL + ORIGINAL), null)
})

test('themes: header meta, composition order and public state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-companion-'))
  fs.mkdirSync(path.join(root, 'themes'))
  fs.mkdirSync(path.join(root, 'snippets'))
  fs.writeFileSync(path.join(root, 'themes', 'a.css'), '/**\n * @name Alpha\n * @touches one, two\n */\nhtml.dark{--background:#000}')
  fs.writeFileSync(path.join(root, 'snippets', 's.css'), '/** @name Round */\n.x{border-radius:9px}')
  const lib = loadLibrary(root)
  assert.equal(lib.themes[0].name, 'Alpha')
  assert.deepEqual(lib.themes[0].touches, ['one', 'two'])
  const css = composeCss(lib, { themeId: 'a', enabledSnippets: ['s'] })
  assert.ok(css.indexOf('--background') < css.indexOf('border-radius'))
  assert.equal(composeCss(lib, { themeId: null, enabledSnippets: [] }), '')
  const state = publicState(lib, { themeId: 'a', enabledSnippets: [], enabledTouches: [] })
  assert.equal(state.themes[0].css, undefined)
  assert.equal(state.themes[0].file, undefined)
})

test('bundled and example themes parse and override the core tokens', () => {
  const themes = [...loadLibrary(REPO).themes, ...loadLibrary(path.join(REPO, 'examples')).themes]
  assert.ok(themes.length >= 4)
  for (const t of themes) {
    assert.ok(t.name && t.name !== t.id, `${t.id} has a @name`)
    for (const token of ['--background', '--foreground', '--card', '--primary', '--border', '--sidebar'])
      assert.match(t.css, new RegExp(`${token}\\s*:`), `${t.id} sets ${token}`)
  }
  // The example theme ships a terminal palette next to it.
  assert.ok(loadLibrary(path.join(REPO, 'examples')).themes.find((t) => t.id === 'cotton-sky').terminal)
})
