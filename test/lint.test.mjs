// The performance rules (docs/performance.md) hold for every file in this repo, and the linter catches
// each trap it is meant to catch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { lintCss, lintTerminal, lintTouch } from '../src/lint.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const files = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(ext)).map((n) => path.join(dir, n)) : [])
const errors = (issues) => issues.filter((i) => i.level === 'error')

test('repo themes, snippets and examples pass the CSS rules', () => {
  for (const file of [...files(path.join(REPO, 'themes'), '.css'), ...files(path.join(REPO, 'examples', 'themes'), '.css'), ...files(path.join(REPO, 'examples', 'snippets'), '.css')])
    assert.deepEqual(lintCss(fs.readFileSync(file, 'utf8')), [], file)
})

test('repo touches and example touches parse and pass the touch rules', () => {
  for (const file of [...files(path.join(REPO, 'src', 'touches'), '.js'), ...files(path.join(REPO, 'examples', 'touches'), '.js')])
    assert.deepEqual(lintTouch(fs.readFileSync(file, 'utf8'), file), [], file)
})

test('example terminal palettes are valid', () => {
  for (const file of files(path.join(REPO, 'examples', 'terminal'), '.json')) assert.deepEqual(lintTerminal(fs.readFileSync(file, 'utf8')), [], file)
})

test('lint: catches a page-wide ::selection, allows one on a single element', () => {
  assert.equal(errors(lintCss('::selection{background:red}'))[0]?.rule, 'page-wide-selection')
  assert.equal(errors(lintCss('html, *::selection{background:red}'))[0]?.rule, 'page-wide-selection')
  assert.equal(errors(lintCss('.panel ::selection{background:red}'))[0]?.rule, 'page-wide-selection')
  assert.deepEqual(lintCss('.panel::selection{background:red}'), [])
  assert.deepEqual(lintCss('/* ::selection in a comment */ a{color:red}'), [])
})

test('lint: catches combinators inside :not(), ignores simple arguments and url()', () => {
  assert.equal(errors(lintCss('*:not(.a .b){color:red}'))[0]?.rule, 'not-combinator')
  assert.equal(errors(lintCss('*:not(.a > .b){color:red}'))[0]?.rule, 'not-combinator')
  assert.deepEqual(lintCss("*:not([role='separator'], .x, [class*='resize']){cursor:url(\"data:image/svg+xml,%3Csvg a b%3E\") 2 2, auto}"), [])
})

test('lint: warns about universal transitions and whole-window filters', () => {
  assert.equal(lintCss('* { transition: color .2s }')[0]?.rule, 'universal-motion')
  assert.equal(lintCss('body { backdrop-filter: blur(4px) }')[0]?.rule, 'window-filter')
})

test('lint: touch rules (syntax, Esc, IME, readback, cleanup)', () => {
  assert.equal(lintTouch('T.registerTouch("x", {')[0].rule, 'syntax')
  const esc =
    'T.registerTouch("x",{start(){const k=(e)=>{if(e.key==="Escape")stop()};addEventListener("keydown",k);addEventListener("compositionend",k);return()=>{removeEventListener("keydown",k);removeEventListener("compositionend",k)}}})'
  assert.ok(errors(lintTouch(esc)).some((i) => i.rule === 'esc-binding'))
  const rules = lintTouch('T.registerTouch("x",{start(){addEventListener("keydown",f);setInterval(f,9);c.getImageData(0,0,1,1)}})').map((i) => i.rule)
  for (const rule of ['ime', 'cleanup', 'canvas-readback']) assert.ok(rules.includes(rule), rule)
  assert.equal(lintTouch('// Escape is mentioned only in a comment\nT.registerTouch("x",{start(){}})').length, 0)
})

test('lint: terminal palettes need #hex colors', () => {
  assert.equal(lintTerminal('{"background":"red"}').some((i) => i.rule === 'terminal-color'), true)
  assert.equal(lintTerminal('nope')[0].rule, 'json')
})
