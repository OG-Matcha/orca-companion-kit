import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { prepareFixes } from '../src/fixes/index.mjs'
import { DOM_HOOKS, checkupDue, lastCheckedVersion, pageProbeExpression, readOrcaVersion, recordChecked, summarizeCheckup } from '../src/checkup.mjs'

test('checkup: due on a new Orca version (and the first run), once per version', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orca-checkup-')), 'orca-version.json')
  assert.equal(lastCheckedVersion(file), null)
  assert.equal(checkupDue(lastCheckedVersion(file), '1.4.240'), true, 'first run')
  recordChecked(file, '1.4.240', true)
  assert.equal(lastCheckedVersion(file), '1.4.240')
  assert.equal(checkupDue(lastCheckedVersion(file), '1.4.240'), false, 'same version again')
  assert.equal(checkupDue(lastCheckedVersion(file), '1.4.241'), true, 'updated')
  assert.equal(checkupDue('1.4.240', null), false, 'unknown version never triggers')
  fs.writeFileSync(file, '{not json')
  assert.equal(lastCheckedVersion(file), null, 'a broken state file reads as never checked')
})

test('checkup: reads the version from app.asar, null when unreadable', () => {
  const fake = { extractFile: (_, name) => Buffer.from(name === 'package.json' ? '{"version":"9.9.9"}' : '') }
  assert.equal(readOrcaVersion(fake, 'x'), '9.9.9')
  assert.equal(readOrcaVersion({ extractFile: () => { throw new Error('no') } }, 'x'), null)
})

test('checkup: silent when all is well, one notice listing each problem otherwise', () => {
  const ok = summarizeCheckup({ version: '2.0.0', hooks: DOM_HOOKS.map((h) => ({ ...h, status: 'ok' })) })
  assert.equal(ok.ok, true)
  assert.equal(ok.notice, null)
  assert.match(ok.details[0], /all good/)

  const bad = summarizeCheckup({
    version: '2.0.0',
    fixWarnings: ['換帳號後重開 session：沒有套上'],
    hooks: [
      { selector: '.a', label: 'worktree 側欄', status: 'missing' },
      { selector: '.b', label: '分頁', status: 'skipped' }
    ],
    touchErrors: [{ id: 'power-mode', error: 'TypeError: x' }, { id: 'power-mode', error: 'again' }],
    runtimeError: null
  })
  assert.equal(bad.ok, false)
  assert.match(bad.notice, /2\.0\.0/)
  assert.match(bad.notice, /worktree 側欄/)
  assert.doesNotMatch(bad.notice, /分頁/, 'a skipped hook is not a problem')
  assert.match(bad.notice, /換帳號後重開/)
  assert.equal(bad.notice.match(/power-mode/g).length, 1, 'a touch is named once')
  assert.ok(bad.details.some((l) => l.includes('missing') && l.includes('.a')))

  assert.match(summarizeCheckup({ version: '2.0.0', hooks: null }).notice, /沒辦法檢查/)
})

test('checkup: the page probe reports hooks and touch errors', async () => {
  const present = new Set(['.bg-worktree-sidebar[data-os-file-drop-owner]', '.xterm', '[data-testid="sortable-tab"][data-tab-id]'])
  const context = {
    document: { querySelector: (s) => (s.split(',').some((part) => present.has(part.trim())) ? {} : null) },
    window: { __orcaThemer: { touchErrors: [{ id: 't', error: 'boom' }] } },
    setTimeout: (fn) => fn(),
    Date
  }
  const result = await vm.runInNewContext(pageProbeExpression(), context)
  const status = Object.fromEntries(result.hooks.map((h) => [h.label, h.status]))
  assert.deepEqual(status, { 'worktree 側欄': 'ok', '側欄拖曳邊': 'missing', 分頁: 'ok', 終端機輸入框: 'missing' })
  assert.deepEqual(result.touchErrors, [{ id: 't', error: 'boom' }])
})

test('checkup: an enabled fix that cannot apply leaves a warning; a disabled one stays quiet', async () => {
  const missing = path.join(os.tmpdir(), 'no-orca-here', 'app.asar')
  const warnings = []
  assert.equal((await prepareFixes(missing, ['claude-restart-after-switch'], () => {}, warnings)).size, 0)
  assert.equal(warnings.length, 1)
  const none = []
  await prepareFixes(missing, [], () => {}, none)
  assert.deepEqual(none, [])
})
