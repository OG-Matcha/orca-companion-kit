// Send one dev command to a running themer (ORCA_THEMER_DEV=1) and print the result.
// node tools/dev.mjs <root> '{"cmd":"eval","expr":"1+1"}'
import fs from 'node:fs'
import path from 'node:path'

const [root, json] = process.argv.slice(2)
const dir = path.join(root, 'dev')
const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, `${id}.cmd.json`), json)
const out = path.join(dir, `${id}.result.json`)
const until = Date.now() + 20000 + (JSON.parse(json).ms ?? 0)
while (!fs.existsSync(out)) {
  if (Date.now() > until) {
    console.error('timeout')
    process.exit(1)
  }
  await new Promise((r) => setTimeout(r, 100))
}
await new Promise((r) => setTimeout(r, 50))
console.log(fs.readFileSync(out, 'utf8'))
fs.unlinkSync(out)
