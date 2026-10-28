// Agent-like terminal output for the perf A/B: colored log lines, a spinner redrawn in place, and a
// few long wrapped lines, as fast as an agent streams a tool result.
// Usage: node tools/perf-burst.mjs [seconds=10]
const seconds = Number(process.argv[2]) || 10
const until = Date.now() + seconds * 1000
const spin = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const words = 'read edit grep build test lint diff patch commit token stream render layout terminal agent'.split(' ')
let n = 0
const line = () => {
  const w = Array.from({ length: 6 + (n % 9) }, (_, i) => words[(n * 7 + i * 3) % words.length]).join(' ')
  const color = [32, 33, 36, 35, 90][n % 5]
  return `\x1b[${color}m●\x1b[0m ${String(n).padStart(5)} ${w}${n % 23 === 0 ? ' ' + 'x'.repeat(260) : ''}`
}
const tick = () => {
  let out = ''
  for (let i = 0; i < 25; i++) out += line() + '\n', n++
  out += `\r\x1b[2K\x1b[36m${spin[n % spin.length]}\x1b[0m working… ${n} lines`
  process.stdout.write(out + '\n')
  if (Date.now() < until) setTimeout(tick, 20)
  else process.stdout.write(`\x1b[32m✔ done\x1b[0m ${n} lines\n`)
}
tick()
