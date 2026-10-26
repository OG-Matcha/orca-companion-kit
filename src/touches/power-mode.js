// power-mode: typing in a terminal throws a few sparks from the cursor and keeps a combo count,
// in the spirit of VS Code's Power Mode. One small canvas, one rAF loop that stops when idle.
// Colors come from the theme: --oc-spark-1..4, falling back to --primary, --ring, --foreground, --ai-action-accent.
// xterm parks its helper <textarea> at the cursor, so its rect is the cursor position.
;(() => {
  const T = window.__orcaThemer
  if (!T) return

  const MAX_PARTICLES = 160
  const MAX_SPAWN_PER_FRAME = 24
  const COMBO_RESET_MS = 1500
  const SPRITE = 32 // px; each color is drawn once with its glow baked in
  // Why a small canvas that moves to the cursor: a full-window canvas is re-composited whole every frame
  // sparks fly, and on a long IME commit that collided with the terminal redraw and dropped frames.
  const BOX = 320 // px; sparks rarely fly farther than this from where they start

  T.registerTouch('power-mode', {
    label: '打字特效',
    description: '終端機打字時從游標迸出小火花，並計算連擊',
    start() {
      const canvas = document.createElement('canvas')
      canvas.id = 'orca-power-mode'
      canvas.setAttribute('aria-hidden', 'true')
      canvas.style.cssText = `position:fixed;left:0;top:0;width:${BOX}px;height:${BOX}px;pointer-events:none;z-index:2147482500`
      document.body.appendChild(canvas)
      const ctx = canvas.getContext('2d')
      const combo = document.createElement('div')
      combo.setAttribute('aria-hidden', 'true')
      combo.style.cssText =
        'position:fixed;left:0;top:0;pointer-events:none;z-index:2147482501;font:700 22px/1 var(--font-mono,ui-monospace,monospace);color:var(--oc-spark-1,var(--primary));text-shadow:0 0 12px color-mix(in srgb,var(--oc-spark-2,var(--ring)) 70%,transparent);opacity:0;font-variant-numeric:tabular-nums;will-change:transform,opacity'
      document.body.appendChild(combo)

      let particles = []
      let raf = 0
      let count = 0
      let comboTimer = 0
      let sprites = []
      let dirty = null // the area drawn last frame, the only part that needs clearing
      // Keystrokes queue up and are handled once per frame, so fast typing costs one layout read per frame.
      let pending = null

      // The canvas' top-left in the window. Drawing stays in window coordinates; the transform shifts it.
      let ox = 0
      let oy = 0
      function place() {
        const dpr = devicePixelRatio || 1
        ctx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr)
        canvas.style.transform = `translate(${ox}px,${oy}px)`
      }
      function resize() {
        const dpr = devicePixelRatio || 1
        canvas.width = canvas.height = Math.round(BOX * dpr)
        place()
        dirty = null
      }
      // Recenters on a new burst when nothing is flying or the burst lands near the edge.
      function aim(x, y) {
        const inside = x > ox + 60 && x < ox + BOX - 60 && y > oy + 60 && y < oy + BOX - 60
        if (particles.length && inside) return
        ctx.clearRect(ox, oy, BOX, BOX)
        ox = Math.round(x - BOX / 2)
        oy = Math.round(y - BOX * 0.6) // sparks mostly rise
        place()
        dirty = null
      }

      // Why sprites: shadowBlur re-blurs every particle every frame, which is what stuttered on fast typing.
      function makeSprite(color, draw) {
        const dpr = devicePixelRatio || 1
        const c = document.createElement('canvas')
        c.width = c.height = Math.round(SPRITE * dpr)
        const g = c.getContext('2d')
        g.scale(dpr, dpr)
        g.fillStyle = color
        g.shadowColor = color
        g.shadowBlur = 8
        g.beginPath()
        draw(g, SPRITE / 2)
        g.fill()
        return c
      }
      function readPalette() {
        const s = getComputedStyle(document.documentElement)
        const pick = (...names) => names.map((n) => s.getPropertyValue(n).trim()).find(Boolean)
        const colors = [pick('--oc-spark-1', '--primary'), pick('--oc-spark-2', '--ring'), pick('--oc-spark-3', '--foreground'), pick('--oc-spark-4', '--ai-action-accent')].filter(Boolean)
        if (!colors.length) colors.push('#d6e6ff')
        sprites = colors.map((color) => ({
          // A four-point sparkle.
          sparkle: makeSprite(color, (g, c) => {
            const r = 7
            g.moveTo(c, c - r)
            g.quadraticCurveTo(c, c, c + r, c)
            g.quadraticCurveTo(c, c, c, c + r)
            g.quadraticCurveTo(c, c, c - r, c)
            g.quadraticCurveTo(c, c, c, c - r)
          }),
          droplet: makeSprite(color, (g, c) => g.ellipse(c, c, 2.2, 3.4, 0, 0, Math.PI * 2))
        }))
      }
      resize()
      readPalette()

      function spawn(x, y, n) {
        aim(x, y)
        for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1
          const speed = 1.6 + Math.random() * 3.2
          const droplet = Math.random() < 0.35
          const sprite = sprites[(Math.random() * sprites.length) | 0]
          particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            decay: 0.022 + Math.random() * 0.025,
            size: SPRITE * (droplet ? 0.6 + Math.random() * 0.4 : 0.35 + Math.random() * 0.75),
            gravity: droplet ? 0.16 : 0.06,
            img: droplet ? sprite.droplet : sprite.sparkle
          })
        }
        if (!raf) raf = requestAnimationFrame(frame)
      }

      function frame() {
        raf = 0
        if (pending) flush()
        if (dirty) ctx.clearRect(dirty.x0, dirty.y0, dirty.x1 - dirty.x0, dirty.y1 - dirty.y0)
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        let alive = 0
        for (const p of particles) {
          p.vy += p.gravity
          p.vx *= 0.985
          p.x += p.vx
          p.y += p.vy
          p.life -= p.decay
          if (p.life <= 0) continue
          particles[alive++] = p
          const left = p.x - p.size / 2
          const top = p.y - p.size / 2
          ctx.globalAlpha = p.life
          ctx.drawImage(p.img, left, top, p.size, p.size)
          x0 = Math.min(x0, left)
          y0 = Math.min(y0, top)
          x1 = Math.max(x1, left + p.size)
          y1 = Math.max(y1, top + p.size)
        }
        particles.length = alive
        ctx.globalAlpha = 1
        dirty = alive ? { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 } : null
        if (alive || pending) raf = requestAnimationFrame(frame)
      }

      function bumpCombo(box, hits) {
        if (!hits) return
        const before = count
        count += hits
        clearTimeout(comboTimer)
        comboTimer = setTimeout(() => {
          count = 0
          combo.animate([{ opacity: combo.style.opacity || 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' })
        }, COMBO_RESET_MS)
        // Other touches (a companion, for one) can react to a hot streak.
        dispatchEvent(new CustomEvent('orca-themer:combo', { detail: count }))
        if (count < 5) return
        combo.textContent = `×${count}`
        combo.style.transform = `translate(${box.right - 90}px, ${box.top + 12}px)`
        combo.getAnimations().forEach((a) => a.cancel())
        combo.style.opacity = '0.85'
        combo.animate([{ scale: 1.35 }, { scale: 1 }], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' })
        if (Math.floor(count / 50) > Math.floor(before / 50)) {
          // Milestone: a bigger burst around the counter.
          for (let i = 0; i < 4; i++) spawn(box.right - 60 + (Math.random() - 0.5) * 80, box.top + 24, 10)
        }
      }

      const isTerminalInput = (t) => t instanceof HTMLTextAreaElement && t.classList.contains('xterm-helper-textarea')

      // Why cached: reading a rect right after the terminal wrote to the DOM forces a full layout,
      // once per keystroke. The pane moves rarely, so its rect is reused for a second.
      const paneRects = new WeakMap()
      function paneRect(pane) {
        const now = performance.now()
        let hit = paneRects.get(pane)
        if (!hit || now - hit.at > 1000) {
          hit = { rect: pane.getBoundingClientRect(), at: now }
          paneRects.set(pane, hit)
        }
        return hit.rect
      }

      // Runs inside the frame, after xterm has moved its textarea to the new cursor.
      // xterm positions that textarea with inline left/top inside the pane, so no layout is needed.
      function flush() {
        const { target, sparks, hits } = pending
        pending = null
        if (!target.isConnected) return
        const pane = target.closest('.xterm') ?? target.parentElement
        const box = paneRect(pane)
        const x = box.left + (parseFloat(target.style.left) || 0) + 2
        const y = box.top + (parseFloat(target.style.top) || 0) + (parseFloat(target.style.height) || 16) / 2
        spawn(x, y, Math.min(sparks, MAX_SPAWN_PER_FRAME))
        bumpCombo(box, hits)
      }

      function burst(target, sparks, hits) {
        if (document.hidden) return
        if (pending?.target === target) {
          pending.sparks += sparks
          pending.hits += hits
        } else {
          pending = { target, sparks, hits }
        }
        if (!raf) raf = requestAnimationFrame(frame)
      }

      const onKey = (e) => {
        if (!isTerminalInput(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
        // Why: while an IME composes (Zhuyin, Cangjie...), keydown reports "Process" and Windows IMEs send
        // it for the first key only; onCompositionUpdate sparks every key of the underlined text instead.
        if (e.isComposing || e.key === 'Process') return
        if (e.key.length !== 1 && e.key !== 'Backspace' && e.key !== 'Enter' && e.key !== 'Tab') return
        burst(e.target, e.key === 'Enter' ? 14 : e.key === 'Backspace' ? 3 : 6, 1)
      }

      // Committed IME text lands at once: one bigger burst, and every character counts toward the combo.
      const onCompositionEnd = (e) => {
        if (!isTerminalInput(e.target) || !e.data) return
        const chars = [...e.data].length
        burst(e.target, Math.min(6 + chars * 3, 24), chars)
      }

      const onCompositionUpdate = (e) => isTerminalInput(e.target) && burst(e.target, 3, 0)

      const onResize = () => {
        resize()
        readPalette()
      }
      const onThemeChange = new MutationObserver(readPalette)
      onThemeChange.observe(document.documentElement, { attributes: true, attributeFilter: ['data-orca-theme', 'class'] })
      addEventListener('keydown', onKey, true)
      addEventListener('compositionend', onCompositionEnd, true)
      addEventListener('compositionupdate', onCompositionUpdate, true)
      addEventListener('resize', onResize)
      return () => {
        removeEventListener('keydown', onKey, true)
        removeEventListener('compositionend', onCompositionEnd, true)
        removeEventListener('compositionupdate', onCompositionUpdate, true)
        removeEventListener('resize', onResize)
        onThemeChange.disconnect()
        cancelAnimationFrame(raf)
        clearTimeout(comboTimer)
        canvas.remove()
        combo.remove()
      }
    }
  })
})()
