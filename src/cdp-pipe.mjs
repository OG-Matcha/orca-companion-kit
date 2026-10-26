// Minimal CDP client over Chromium's --remote-debugging-pipe (fd 3 = to browser, fd 4 = from browser).
// Messages are JSON terminated by a NUL byte. No network port is opened.
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

export function launchWithPipe(exe, args, options = {}) {
  const child = spawn(exe, ['--remote-debugging-pipe', ...args], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    windowsHide: false,
    ...options
  })
  return { child, cdp: new PipeCdp(child.stdio[3], child.stdio[4]) }
}

export class PipeCdp extends EventEmitter {
  #nextId = 1
  #pending = new Map()
  #buffer = ''

  constructor(writable, readable) {
    super()
    this.writable = writable
    readable.setEncoding('utf8')
    readable.on('data', (chunk) => this.#onData(chunk))
    readable.on('close', () => {
      for (const { reject } of this.#pending.values()) reject(new Error('CDP pipe closed'))
      this.#pending.clear()
      this.emit('close')
    })
  }

  #onData(chunk) {
    this.#buffer += chunk
    let end
    while ((end = this.#buffer.indexOf('\0')) !== -1) {
      const raw = this.#buffer.slice(0, end)
      this.#buffer = this.#buffer.slice(end + 1)
      let message
      try {
        message = JSON.parse(raw)
      } catch {
        continue
      }
      if (message.id !== undefined && this.#pending.has(message.id)) {
        const { resolve, reject } = this.#pending.get(message.id)
        this.#pending.delete(message.id)
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`))
        else resolve(message.result)
      } else if (message.method) {
        this.emit('event', message)
        this.emit(message.method, message.params, message.sessionId)
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) }
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.writable.write(`${JSON.stringify(payload)}\0`)
    })
  }
}
