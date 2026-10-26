// Makes a short bell-like notification sound as a 16-bit mono WAV, from nothing but sine waves, so a theme
// can ship a sound you own outright.
//   node tools/make-chime.mjs <out.wav> [freq Hz ...]      e.g. node tools/make-chime.mjs ~/.orca/themer/sounds/my-theme.wav 1046.5 1318.5 1568
// Name the file sounds/<theme id>.wav and list `theme-sound` in the theme's @touches: while that touch is
// on, the launcher sets it as Orca's notification sound, and puts the old one back when it is off.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function chimeWav(freqs = [1046.5, 1318.5, 1568], { rate = 44100, gap = 0.11, length = 1.6, gain = 0.28 } = {}) {
  const total = Math.ceil(rate * (length + gap * (freqs.length - 1)))
  const samples = new Float32Array(total)
  freqs.forEach((freq, n) => {
    const start = Math.round(n * gap * rate)
    // A struck bell: the fundamental plus two inharmonic partials that die away faster.
    for (const [ratio, amp, decay] of [[1, 1, 3], [2, 0.3, 5], [2.76, 0.16, 7]]) {
      for (let i = 0; start + i < total; i++) {
        const t = i / rate
        const attack = Math.min(1, t / 0.004)
        samples[start + i] += Math.sin(2 * Math.PI * freq * ratio * t) * amp * attack * Math.exp(-decay * t)
      }
    }
  })
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1
  const data = Buffer.alloc(total * 2)
  for (let i = 0; i < total; i++) data.writeInt16LE(Math.round((samples[i] / peak) * gain * 32767), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`) {
  const [out, ...rest] = process.argv.slice(2)
  if (!out) {
    console.error('usage: node tools/make-chime.mjs <out.wav> [freq Hz ...]')
    process.exit(1)
  }
  const file = out.replace(/^~(?=[\\/])/, os.homedir())
  const freqs = rest.map(Number).filter((f) => f > 20 && f < 20000)
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(file, chimeWav(freqs.length ? freqs : undefined))
  console.log(`wrote ${file}`)
}
