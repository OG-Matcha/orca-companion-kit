// The settings panel of a companion pet: each behaviour on or off, how often, a 「試試看」 button that
// plays it now, speech, quiet hours, sound volume, its size and home, and what it remembers. Drawn
// from the pet's catalog (T.companionConfig.catalog, in companion.js), so a pet's own `behaviors` show
// up here too. Opened from the Ctrl+Alt+T picker (「寵物設定」) or by right-clicking the pet; closed
// by ✕, a click outside, or Ctrl+Alt+T again. Esc is never bound (in a terminal it interrupts Claude
// Code). Changes apply at once (T.updateState) and the launcher saves them (settings.json "companions").
// Colors come from Orca's own variables, so the panel follows whatever theme is on.
;(() => {
  const T = window.__orcaThemer
  if (!T?.companionConfig || !T.registerPickerItem) return
  const C = T.companionConfig
  const ROOT_ID = 'oc-settings'
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  const pets = () => [...(T.companions?.values() ?? [])].filter((p) => p.panel)

  // ---------- look ----------
  const CSS = `
#${ROOT_ID}{position:fixed;inset:0;z-index:2147483000;pointer-events:auto;font:13px/1.5 var(--app-font-family,system-ui,sans-serif);color:var(--popover-foreground,#eee);
  --ocs-bg:var(--popover,#1b1b24);--ocs-fg:var(--popover-foreground,#eee);--ocs-muted:var(--muted-foreground,#9a9aa8);--ocs-line:color-mix(in srgb,var(--border,#444) 70%,transparent);
  --ocs-edge:var(--border,#444);--ocs-hover:color-mix(in srgb,var(--accent,#333) 70%,transparent);--ocs-primary:var(--primary,#8c8ff0);--ocs-on-primary:var(--primary-foreground,#fff);--ocs-ring:var(--ring,var(--primary,#8c8ff0))}
#${ROOT_ID} *{box-sizing:border-box}
#${ROOT_ID} .ocs-scrim{position:absolute;inset:0;background:color-mix(in srgb,var(--background,#000) 35%,transparent)}
#${ROOT_ID} .ocs-panel{position:absolute;top:12px;bottom:12px;width:min(640px,calc(100vw - 24px));display:flex;flex-direction:column;border-radius:14px;overflow:hidden;background:var(--ocs-bg);border:1px solid var(--ocs-edge);box-shadow:0 30px 80px -24px rgb(0 0 0 / .6)}
#${ROOT_ID}[data-side=right] .ocs-panel{right:12px}
#${ROOT_ID}[data-side=left] .ocs-panel{left:12px}
@keyframes ocs-in-r{from{opacity:0;transform:translateX(18px)}}
@keyframes ocs-in-l{from{opacity:0;transform:translateX(-18px)}}
@keyframes ocs-fade{from{opacity:0}}
#${ROOT_ID}[data-side=right] .ocs-panel{animation:ocs-in-r .22s cubic-bezier(.2,.8,.2,1)}
#${ROOT_ID}[data-side=left] .ocs-panel{animation:ocs-in-l .22s cubic-bezier(.2,.8,.2,1)}
#${ROOT_ID} .ocs-scrim{animation:ocs-fade .22s ease-out}
#${ROOT_ID}[data-closing] .ocs-panel,#${ROOT_ID}[data-closing] .ocs-scrim{transition:opacity .14s ease-in,transform .14s ease-in;opacity:0}
#${ROOT_ID}[data-closing][data-side=right] .ocs-panel{transform:translateX(10px)}
#${ROOT_ID}[data-closing][data-side=left] .ocs-panel{transform:translateX(-10px)}

#${ROOT_ID} .ocs-head{display:flex;align-items:center;gap:12px;padding:16px 14px 12px 18px;border-bottom:1px solid var(--ocs-line)}
#${ROOT_ID} .ocs-face{flex:none;width:34px;height:34px;display:grid;place-items:center}
#${ROOT_ID} .ocs-face svg{width:34px;height:34px;overflow:visible}
#${ROOT_ID} .ocs-title{margin:0;font-size:15px;font-weight:600;letter-spacing:.02em}
#${ROOT_ID} .ocs-sub{margin:1px 0 0;font-size:11.5px;color:var(--ocs-muted);min-height:1.5em}
#${ROOT_ID} .ocs-sub[data-saved]{color:var(--ocs-primary)}
#${ROOT_ID} .ocs-pets{display:inline-flex;gap:4px;margin-left:8px}
#${ROOT_ID} .ocs-x{all:unset;box-sizing:border-box;margin-left:auto;width:32px;height:32px;display:grid;place-items:center;border-radius:8px;color:var(--ocs-muted);cursor:pointer;font-size:15px}
#${ROOT_ID} .ocs-x:hover{background:var(--ocs-hover);color:var(--ocs-fg)}

#${ROOT_ID} .ocs-body{flex:1;min-height:0;display:flex}
#${ROOT_ID} .ocs-nav{flex:none;width:132px;padding:10px 8px;display:flex;flex-direction:column;gap:2px;border-right:1px solid var(--ocs-line);overflow:auto;scrollbar-width:none}
#${ROOT_ID} .ocs-tab{all:unset;box-sizing:border-box;position:relative;padding:7px 12px 7px 14px;border-radius:8px;color:var(--ocs-muted);cursor:pointer;font-size:13px}
#${ROOT_ID} .ocs-tab:hover{background:var(--ocs-hover);color:var(--ocs-fg)}
#${ROOT_ID} .ocs-tab[aria-selected=true]{background:color-mix(in srgb,var(--ocs-primary) 16%,transparent);color:var(--ocs-fg)}
#${ROOT_ID} .ocs-tab[aria-selected=true]::before{content:'';position:absolute;left:3px;top:8px;bottom:8px;width:2.5px;border-radius:2px;background:var(--ocs-primary)}

#${ROOT_ID} .ocs-pane{flex:1;min-width:0;overflow:auto;padding:14px 20px 24px;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--ocs-muted) 40%,transparent) transparent}
#${ROOT_ID} .ocs-h{margin:0;font-size:14px;font-weight:600}
#${ROOT_ID} .ocs-intro{margin:2px 0 6px;font-size:12px;color:var(--ocs-muted)}
#${ROOT_ID} .ocs-banner{margin:8px 0 4px;padding:8px 12px;border-radius:10px;font-size:12px;background:color-mix(in srgb,var(--ocs-primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--ocs-primary) 35%,transparent)}
#${ROOT_ID} .ocs-banner[hidden]{display:none}

#${ROOT_ID} .ocs-row{display:flex;gap:14px;align-items:flex-start;padding:11px 0;border-top:1px solid var(--ocs-line)}
#${ROOT_ID} .ocs-row:first-of-type{border-top:0}
#${ROOT_ID} .ocs-text{flex:1;min-width:0}
#${ROOT_ID} .ocs-label{font-size:13.5px;font-weight:500}
#${ROOT_ID} .ocs-desc{margin-top:2px;font-size:12px;line-height:1.6;color:var(--ocs-muted);text-wrap:pretty}
#${ROOT_ID} .ocs-side{flex:none;display:flex;align-items:center;gap:10px;min-height:22px}
#${ROOT_ID} .ocs-row.is-off .ocs-extra{opacity:.45}
#${ROOT_ID} .ocs-extra{margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--ocs-muted)}

#${ROOT_ID} .ocs-switch{all:unset;box-sizing:border-box;position:relative;flex:none;width:36px;height:20px;border-radius:999px;background:color-mix(in srgb,var(--ocs-muted) 25%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ocs-muted) 30%,transparent);cursor:pointer}
#${ROOT_ID} .ocs-knob{position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:var(--ocs-fg);opacity:.75;transition:transform .18s cubic-bezier(.3,.7,.4,1),opacity .18s}
#${ROOT_ID} .ocs-switch[aria-checked=true]{background:var(--ocs-primary);box-shadow:none}
#${ROOT_ID} .ocs-switch[aria-checked=true] .ocs-knob{transform:translateX(16px);background:var(--ocs-on-primary);opacity:1}
#${ROOT_ID} .ocs-switch:disabled{cursor:default;opacity:.4}

#${ROOT_ID} .ocs-try{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:999px;border:1px solid var(--ocs-line);color:var(--ocs-muted);font-size:11.5px;white-space:nowrap;cursor:pointer;opacity:.7;transition:opacity .15s}
#${ROOT_ID} .ocs-row:hover .ocs-try,#${ROOT_ID} .ocs-row:focus-within .ocs-try,#${ROOT_ID} .ocs-try[data-playing]{opacity:1}
#${ROOT_ID} .ocs-try:hover{border-color:var(--ocs-primary);color:var(--ocs-fg)}
#${ROOT_ID} .ocs-try[data-playing]{border-color:var(--ocs-primary);color:var(--ocs-fg);background:color-mix(in srgb,var(--ocs-primary) 14%,transparent)}
#${ROOT_ID} .ocs-try[data-busy]{color:var(--ocs-fg);border-style:dashed}
#${ROOT_ID} .ocs-try:disabled{opacity:.35;cursor:default}
#${ROOT_ID} .ocs-side:not(:has(.ocs-switch)) .ocs-try{margin-right:46px}

#${ROOT_ID} .ocs-seg{display:inline-flex;padding:2px;border-radius:999px;border:1px solid var(--ocs-line)}
#${ROOT_ID} .ocs-seg button{all:unset;box-sizing:border-box;padding:2px 10px;border-radius:999px;font-size:11.5px;color:var(--ocs-muted);cursor:pointer}
#${ROOT_ID} .ocs-seg button:hover{color:var(--ocs-fg)}
#${ROOT_ID} .ocs-seg button[aria-checked=true]{background:color-mix(in srgb,var(--ocs-primary) 22%,transparent);color:var(--ocs-fg);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ocs-primary) 50%,transparent)}
#${ROOT_ID} .ocs-seg button:disabled{cursor:default}

#${ROOT_ID} input{font:inherit;font-size:12.5px;color:var(--ocs-fg);background:color-mix(in srgb,var(--ocs-fg) 4%,transparent);border:1px solid var(--ocs-edge);border-radius:6px;height:26px;padding:0 8px;font-variant-numeric:tabular-nums}
#${ROOT_ID} input[type=number]{width:64px}
#${ROOT_ID} input[type=time]{width:92px;color-scheme:light dark}
#${ROOT_ID} input[type=text]{width:180px}
#${ROOT_ID} input:disabled{opacity:.45}
#${ROOT_ID} input[type=range]{all:unset;width:150px;height:20px;cursor:pointer}
#${ROOT_ID} input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(90deg,var(--ocs-primary) var(--fill,50%),color-mix(in srgb,var(--ocs-muted) 30%,transparent) var(--fill,50%))}
#${ROOT_ID} input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:var(--ocs-fg);box-shadow:0 0 0 3px color-mix(in srgb,var(--ocs-primary) 40%,transparent)}
#${ROOT_ID} input[type=range]:disabled{opacity:.4;cursor:default}
#${ROOT_ID} .ocs-val{min-width:40px;font-size:12px;font-variant-numeric:tabular-nums;text-align:right}
#${ROOT_ID} .ocs-num{display:inline-flex;align-items:center;gap:6px}
#${ROOT_ID} .ocs-unit{font-size:12px;color:var(--ocs-muted)}

#${ROOT_ID} .ocs-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--ocs-edge);font-size:12.5px;white-space:nowrap;cursor:pointer}
#${ROOT_ID} .ocs-btn:hover{background:var(--ocs-hover)}
#${ROOT_ID} .ocs-btn:disabled{opacity:.4;cursor:default;background:none}
#${ROOT_ID} .ocs-btn.is-danger{border-color:color-mix(in srgb,#e5484d 55%,transparent);color:color-mix(in srgb,#e5484d 70%,var(--ocs-fg))}
#${ROOT_ID} .ocs-btn.is-danger.is-solid{background:#d93a52;border-color:#d93a52;color:#fff}
#${ROOT_ID} .ocs-confirm{display:flex;align-items:center;gap:8px;font-size:12px}
#${ROOT_ID} .ocs-stats{margin-top:4px;font-size:12px;color:var(--ocs-muted)}
#${ROOT_ID} .ocs-stats b{margin:0 3px;font-weight:600;color:var(--ocs-fg);font-variant-numeric:tabular-nums}

#${ROOT_ID} .ocs-heart{display:block;padding:6px 0 14px}
#${ROOT_ID} .ocs-htop{display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:12px;background:color-mix(in srgb,var(--ocs-primary) 7%,transparent);border:1px solid var(--ocs-line)}
#${ROOT_ID} .ocs-hglyph{flex:none;width:42px;height:42px;display:grid;place-items:center;border-radius:50%;font-size:20px;background:radial-gradient(closest-side,color-mix(in srgb,var(--ocs-primary) 30%,transparent),transparent)}
#${ROOT_ID} .ocs-hk{font-size:11px;letter-spacing:.08em;color:var(--ocs-muted)}
#${ROOT_ID} .ocs-hmood{font-size:17px;font-weight:600;letter-spacing:.04em}
#${ROOT_ID} .ocs-spark{margin-left:auto;flex:none;width:132px;height:34px;overflow:visible}
#${ROOT_ID} .ocs-spark polyline{fill:none;stroke:var(--ocs-primary);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
#${ROOT_ID} .ocs-spark .ocs-sfill{fill:color-mix(in srgb,var(--ocs-primary) 14%,transparent);stroke:none}
#${ROOT_ID} .ocs-spark .ocs-sdot{fill:var(--ocs-fg)}
#${ROOT_ID} .ocs-spark text{font-size:9px;fill:var(--ocs-muted)}
#${ROOT_ID} .ocs-hgrid{display:grid;grid-template-columns:3.2em 1fr;gap:10px 12px;align-items:center;margin:14px 2px 0}
#${ROOT_ID} .ocs-hline{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}
#${ROOT_ID} .ocs-hearts{font-size:15px;letter-spacing:.1em;color:#e8789f}
#${ROOT_ID} .ocs-hearts span{color:color-mix(in srgb,#e8789f 30%,transparent)}
#${ROOT_ID} .ocs-hv{font-size:13px;font-weight:500}
#${ROOT_ID} .ocs-hnum{font-size:11.5px;color:var(--ocs-muted);font-variant-numeric:tabular-nums}
#${ROOT_ID} .ocs-hbar{position:relative;width:132px;height:5px;border-radius:3px;background:color-mix(in srgb,var(--ocs-muted) 20%,transparent);overflow:hidden}
#${ROOT_ID} .ocs-hbar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--ocs-primary)}
#${ROOT_ID} .ocs-htags{display:flex;flex-wrap:wrap;gap:8px;margin:12px 2px 0;min-height:22px}
#${ROOT_ID} .ocs-htag{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:999px;font-size:11.5px;color:color-mix(in srgb,#e0a64b 80%,var(--ocs-fg));background:color-mix(in srgb,#e0a64b 9%,transparent);border:1px solid color-mix(in srgb,#e0a64b 35%,transparent)}
#${ROOT_ID} .ocs-htag.is-lone{color:color-mix(in srgb,var(--ocs-primary) 75%,var(--ocs-fg));background:color-mix(in srgb,var(--ocs-primary) 9%,transparent);border-color:color-mix(in srgb,var(--ocs-primary) 35%,transparent)}
#${ROOT_ID} .ocs-htag.is-calm{color:var(--ocs-muted);background:none;border-color:transparent;padding:0}
#${ROOT_ID} .ocs-hlist{list-style:none;margin:6px 0 0;padding:0;font-size:12.5px}
#${ROOT_ID} .ocs-hlist li{display:flex;align-items:baseline;gap:8px;padding:4px 2px;border-top:1px solid var(--ocs-line)}
#${ROOT_ID} .ocs-hlist li:first-child{border-top:0}
#${ROOT_ID} .ocs-hlist li.is-empty{color:var(--ocs-muted);font-weight:400}
#${ROOT_ID} .ocs-hsign{flex:none;width:1.2em;text-align:center;font-weight:600;color:#e8789f}
#${ROOT_ID} .ocs-hlist li.is-neg .ocs-hsign{color:var(--ocs-muted)}
#${ROOT_ID} .ocs-hname{flex:1;min-width:0}
#${ROOT_ID} .ocs-hleft{font-size:11.5px;color:var(--ocs-muted);font-variant-numeric:tabular-nums}
#${ROOT_ID} .ocs-hhint{margin-top:10px;font-size:11px;color:var(--ocs-muted);opacity:.75}
#${ROOT_ID} .ocs-alt{display:none;font-size:11px;color:var(--ocs-muted);font-variant-numeric:tabular-nums}
#${ROOT_ID}[data-alt] .ocs-alt{display:inline}

#${ROOT_ID} .ocs-foot{display:flex;justify-content:space-between;gap:12px;padding:9px 18px 11px;border-top:1px solid var(--ocs-line);font-size:11.5px;color:var(--ocs-muted)}
#${ROOT_ID} kbd{font:11px var(--font-mono,ui-monospace,monospace);border:1px solid var(--ocs-edge);border-bottom-width:2px;border-radius:4px;padding:0 5px}

#${ROOT_ID} :focus{outline:none}
#${ROOT_ID} :focus-visible{outline:2px solid var(--ocs-ring);outline-offset:2px}
#${ROOT_ID} .ocs-tab:focus-visible,#${ROOT_ID} .ocs-seg button:focus-visible{outline-offset:-2px}
#${ROOT_ID} input:focus-visible{outline-offset:0;border-color:var(--ocs-ring)}
@media (prefers-reduced-motion:reduce){
  #${ROOT_ID} .ocs-panel,#${ROOT_ID} .ocs-scrim{animation:none!important;transition:none!important}
  #${ROOT_ID} .ocs-switch,#${ROOT_ID} .ocs-knob{transition:none}
}`

  function ensureStyle() {
    if (document.getElementById('ocs-style')) return
    const s = document.createElement('style')
    s.id = 'ocs-style'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  // ---------- building blocks ----------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }
  let uid = 0
  const nid = () => `ocs-${++uid}`

  let root = null
  let petId = null
  let updaters = [] // re-read the config into the controls of the section on screen
  const sync = () => updaters.forEach((u) => u())
  const pet = () => (petId ? T.companions?.get(petId) : null)
  const cfg = () => pet()?.panel.get()
  const base = () => pet()?.panel.defaults

  // ---------- saving ----------
  // One pending send per pet (the latest config wins); flushed when the panel closes or switches pets.
  const outbox = new Map() // pet id -> { timer, config }
  const sendNow = (id) => {
    const o = outbox.get(id)
    if (!o) return
    clearTimeout(o.timer)
    outbox.delete(id)
    T.send?.({ type: 'companion-config', id, config: o.config })
  }
  const flush = () => [...outbox.keys()].forEach(sendNow)
  let savedFlash = null
  const save = (next) => {
    const p = pet()
    if (!p) return
    const config = C.diff(next, base())
    T.updateState?.({ companions: { ...(T.state.companions ?? {}), [p.id]: config } })
    clearTimeout(outbox.get(p.id)?.timer)
    outbox.set(p.id, { config, timer: setTimeout(() => sendNow(p.id), 250) })
    savedFlash?.()
  }
  const setVal = (path, value) => cfg() && save(C.normalize(C.setPath(cfg(), path, value), base()))

  function switchFor(labelId, get, set) {
    const s = el('button', 'ocs-switch')
    s.type = 'button'
    s.setAttribute('role', 'switch')
    s.setAttribute('aria-labelledby', labelId)
    s.append(el('span', 'ocs-knob'))
    s.addEventListener('click', () => set(!get()))
    updaters.push(() => s.setAttribute('aria-checked', String(!!get())))
    return s
  }

  function tryButton(id, label, live) {
    const b = el('button', 'ocs-try', '試試看')
    b.type = 'button'
    b.setAttribute('aria-label', `試試看：${label}`)
    let reset = 0
    b.addEventListener('click', () => {
      const r = b.getBoundingClientRect()
      const ok = pet()?.panel.preview(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 })
      clearTimeout(reset)
      if (ok) {
        b.dataset.playing = ''
        reset = setTimeout(() => delete b.dataset.playing, 1200)
        live.textContent = `正在示範：${label}`
        return
      }
      b.dataset.busy = ''
      b.textContent = '牠在忙'
      live.textContent = '牠正在忙，等一下再試'
      reset = setTimeout(() => {
        delete b.dataset.busy
        b.textContent = '試試看'
      }, 1600)
    })
    updaters.push(() => (b.disabled = !pet()?.panel.has(id)))
    return b
  }

  function freqControl(id, label) {
    const g = el('div', 'ocs-seg')
    g.setAttribute('role', 'radiogroup')
    g.setAttribute('aria-label', `${label}：頻率`)
    const opts = C.FREQ_STEPS.map(([v, name]) => {
      const b = el('button', null, name)
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.dataset.v = String(v)
      b.addEventListener('click', () => setVal(`freq.${id}`, v))
      return b
    })
    g.append(...opts)
    g.addEventListener('keydown', (e) => {
      const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }
      if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return
      e.preventDefault()
      const i = opts.findIndex((o) => o.getAttribute('aria-checked') === 'true')
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1 : (i + keys[e.key] + opts.length) % opts.length
      opts[j].click()
      opts[j].focus()
    })
    updaters.push(() => {
      const cur = cfg()?.freq[id]
      for (const o of opts) {
        const on = Number(o.dataset.v) === cur
        o.setAttribute('aria-checked', String(on))
        o.tabIndex = on ? 0 : -1
      }
    })
    const wrap = el('div', 'ocs-extra')
    wrap.append(el('span', null, '頻率'), g)
    return wrap
  }

  // Dims a row (and disables its inputs) while the switch it depends on is off.
  function dependent(row, dependsOn, inputs = []) {
    if (!dependsOn) return
    updaters.push(() => {
      const off = cfg()?.features[dependsOn] === false
      row.classList.toggle('is-off', off)
      inputs.forEach((i) => (i.disabled = off))
    })
  }

  function baseRow(item) {
    const row = el('div', 'ocs-row')
    const text = el('div', 'ocs-text')
    const label = el('div', 'ocs-label', item.label)
    label.id = nid()
    text.append(label)
    if (item.desc) {
      const desc = el('div', 'ocs-desc', item.desc)
      desc.id = nid()
      text.append(desc)
      row.dataset.describedBy = desc.id
    }
    const side = el('div', 'ocs-side')
    row.dataset.row = item.id
    row.append(text, side)
    return { row, text, label, side }
  }

  // ---------- one row per kind of setting ----------
  function featureRow(item, live) {
    const { row, text, label, side } = baseRow(item)
    const get = () => cfg()?.features[item.id] !== false
    if (item.preview !== false) side.append(tryButton(item.id, item.label, live))
    const sw = switchFor(label.id, get, (v) => setVal(`features.${item.id}`, v))
    if (row.dataset.describedBy) sw.setAttribute('aria-describedby', row.dataset.describedBy)
    side.append(sw)
    if (item.freq) text.append(freqControl(item.id, item.label))
    updaters.push(() => row.classList.toggle('is-off', !get()))
    return row
  }

  function freqRow(item) {
    const { row, text } = baseRow(item)
    text.append(freqControl(item.id, item.label))
    dependent(row, item.dependsOn)
    return row
  }

  function numberRow(item) {
    const { row, label, side } = baseRow(item)
    const wrap = el('label', 'ocs-num')
    const input = el('input')
    input.type = 'number'
    Object.assign(input, { min: item.min, max: item.max, step: item.step ?? 1 })
    input.inputMode = 'numeric'
    input.setAttribute('aria-labelledby', label.id)
    const show = () => (input.value = String(C.getPath(cfg() ?? {}, item.path) ?? ''))
    input.addEventListener('change', () => {
      if (input.value.trim() !== '') setVal(item.path, Number(input.value))
      show()
    })
    updaters.push(() => document.activeElement !== input && show())
    wrap.append(input, el('span', 'ocs-unit', item.unit ?? ''))
    side.append(wrap)
    dependent(row, item.dependsOn, [input])
    return row
  }

  function rangeRow(item, live) {
    const { row, text, label, side } = baseRow(item)
    const wrap = el('div', 'ocs-num')
    const input = el('input')
    input.type = 'range'
    Object.assign(input, { min: item.min, max: item.max, step: item.step })
    input.setAttribute('aria-labelledby', label.id)
    const val = el('span', 'ocs-val')
    const paint = () => {
      const v = Number(input.value)
      val.textContent = item.percent ? `${Math.round(v * 100)}%` : String(v)
      input.style.setProperty('--fill', `${((v - item.min) / (item.max - item.min)) * 100}%`)
      input.setAttribute('aria-valuetext', val.textContent)
    }
    let timer = 0
    input.addEventListener('input', () => {
      paint()
      clearTimeout(timer)
      timer = setTimeout(() => setVal(item.path, Number(input.value)), 200)
    })
    updaters.push(() => {
      if (document.activeElement !== input) input.value = String(C.getPath(cfg() ?? {}, item.path) ?? item.min)
      paint()
    })
    side.append(tryButton(item.id, item.label, live))
    wrap.append(input, val)
    const line = el('div', 'ocs-extra')
    line.append(wrap)
    text.append(line)
    dependent(row, item.dependsOn, [input])
    return row
  }

  function quietRow(item) {
    const { row, text, label, side } = baseRow(item)
    side.append(switchFor(label.id, () => cfg()?.quiet.on, (v) => setVal('quiet.on', v)))
    const line = el('div', 'ocs-extra')
    const time = (path, aria) => {
      const i = el('input')
      i.type = 'time'
      i.setAttribute('aria-label', aria)
      i.addEventListener('change', () => i.value && setVal(path, i.value))
      updaters.push(() => document.activeElement !== i && (i.value = C.getPath(cfg() ?? {}, path) ?? ''))
      return i
    }
    const a = time('quiet.start', '安靜時段開始')
    const b = time('quiet.end', '安靜時段結束')
    const next = el('span')
    line.append('從', a, '到', b, next)
    text.append(line)
    updaters.push(() => {
      const q = cfg()?.quiet
      if (!q) return
      next.textContent = q.end <= q.start ? '（隔天）' : ''
      row.classList.toggle('is-off', !q.on)
    })
    return row
  }

  function nameRow(item, live) {
    const { row, text, label, side } = baseRow(item)
    const input = el('input')
    input.type = 'text'
    input.maxLength = 16
    input.placeholder = '留空就不叫'
    input.setAttribute('aria-labelledby', label.id)
    let timer = 0
    input.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(() => setVal('you.name', input.value), 500)
    })
    input.addEventListener('change', () => (clearTimeout(timer), setVal('you.name', input.value)))
    updaters.push(() => document.activeElement !== input && (input.value = cfg()?.you.name ?? ''))
    side.append(tryButton('name', item.label, live))
    const line = el('div', 'ocs-extra')
    line.append(input)
    text.append(line)
    return row
  }

  function sizeRow(item) {
    const { row, text, label } = baseRow(item)
    const line = el('div', 'ocs-extra')
    const input = el('input')
    input.type = 'range'
    Object.assign(input, { min: 50, max: 250, step: 5 })
    input.setAttribute('aria-labelledby', label.id)
    const val = el('span', 'ocs-val')
    const paint = () => {
      val.textContent = `${input.value}%`
      input.style.setProperty('--fill', `${((Number(input.value) - 50) / 200) * 100}%`)
      input.setAttribute('aria-valuetext', val.textContent)
    }
    input.addEventListener('input', () => {
      paint()
      pet()?.panel.setSize(Number(input.value) / 100)
    })
    const reset = el('button', 'ocs-btn', '恢復原大小')
    reset.type = 'button'
    reset.addEventListener('click', () => {
      pet()?.panel.setSize(1)
      sync()
    })
    updaters.push(() => {
      if (document.activeElement !== input) input.value = String(Math.round((pet()?.size ?? 1) * 100))
      paint()
    })
    line.append(input, val, reset)
    text.append(line)
    return row
  }

  function homeRow(item) {
    const { row, side } = baseRow(item)
    const b = el('button', 'ocs-btn', '送牠回家')
    b.type = 'button'
    b.addEventListener('click', () => pet()?.panel.resetHome())
    side.append(b)
    return row
  }

  function statsRow(item) {
    const { row, text } = baseRow(item)
    const line = el('div', 'ocs-stats')
    const parts = [['一起', ' 天'], ['摸摸', ' 次'], ['慶祝過', ' 個紀念日']]
    const tiles = parts.map(([before, after], i) => {
      const b = el('b', null, '—')
      line.append(i ? '・' + before : before, b, after.trim())
      return b
    })
    updaters.push(() => {
      const s = pet()?.panel.stats()
      const v = s ? [s.days, s.pets, s.celebrated] : ['—', '—', '—']
      tiles.forEach((b, i) => (b.textContent = String(v[i])))
    })
    text.append(line)
    return row
  }

  // ---------- how it feels right now (api.emotion.view(); companion_emotion.js) ----------
  // Words, not numbers, for its mood, worry and loneliness (numbers show while Alt is held); affection as
  // hearts and a tier, closeness as a stage with a bar; then what is on its mind, each with the time left.
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const svgEl = (tag, attrs = {}) => {
    const e = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
    return e
  }
  const leftText = (min) => (min >= 60 ? `還有 ${Math.floor(min / 60)} 小時${min % 60 ? ` ${min % 60} 分` : ''}` : `還有 ${min} 分`)
  const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1)
  function heartRow() {
    const row = el('div', 'ocs-row ocs-heart')
    row.dataset.row = 'heart'
    const top = el('div', 'ocs-htop')
    const glyph = el('div', 'ocs-hglyph')
    glyph.setAttribute('aria-hidden', 'true')
    const moodBox = el('div')
    const moodV = el('div', 'ocs-hmood', '—')
    const moodAlt = el('span', 'ocs-alt')
    moodBox.append(el('div', 'ocs-hk', '現在'), moodV, moodAlt)
    const spark = svgEl('svg', { class: 'ocs-spark', viewBox: '0 0 132 34', role: 'img', 'aria-label': '近 24 小時的心情' })
    const sFill = svgEl('path', { class: 'ocs-sfill', d: '' })
    const sLine = svgEl('polyline', { points: '' })
    const sDot = svgEl('circle', { class: 'ocs-sdot', r: 2, cx: 0, cy: 0 })
    const sText = svgEl('text', { x: 132, y: 33, 'text-anchor': 'end' })
    sText.textContent = '近 24 小時'
    spark.append(sFill, sLine, sDot, sText)
    top.append(glyph, moodBox, spark)
    const grid = el('div', 'ocs-hgrid')
    const affLine = el('div', 'ocs-hline')
    const hearts = el('span', 'ocs-hearts')
    hearts.setAttribute('aria-hidden', 'true')
    const affV = el('span', 'ocs-hv', '—')
    const affN = el('span', 'ocs-hnum')
    affLine.append(hearts, affV, affN)
    const closeLine = el('div', 'ocs-hline')
    const bar = el('span', 'ocs-hbar')
    const fill = el('i')
    bar.append(fill)
    const closeV = el('span', 'ocs-hv', '—')
    const closeN = el('span', 'ocs-hnum')
    const closeNext = el('span', 'ocs-hnum')
    closeLine.append(bar, closeV, closeN, closeNext)
    grid.append(el('span', 'ocs-hk', '好感'), affLine, el('span', 'ocs-hk', '親密'), closeLine)
    const tags = el('div', 'ocs-htags')
    const mindK = el('div', 'ocs-hk', '牠在想的事')
    mindK.style.marginTop = '14px'
    const list = el('ul', 'ocs-hlist')
    const hint = el('div', 'ocs-hhint', '按住 Alt 可以看數字。')
    row.append(top, grid, tags, mindK, list, hint)
    const paint = () => {
      const v = pet()?.emotion?.view()
      if (!v) return
      const W = v.words
      glyph.textContent = v.moodGlyph
      moodV.textContent = v.moodWord
      moodAlt.textContent = `心情 ${fmt(v.mood)}，正往 ${fmt(v.target)} 走`
      // The sparkline: 48 points over 24 hours, the newest at the right; fewer points start further right.
      const pts = [...v.history.map(([, m]) => m), Math.round(v.mood)].slice(-49)
      const step = 132 / 48
      const xy = pts.map((m, i) => [132 - (pts.length - 1 - i) * step, 2 + (1 - m / 100) * 22])
      sLine.setAttribute('points', xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '))
      sFill.setAttribute('d', xy.length > 1 ? `M${xy[0][0].toFixed(1)},26 ${xy.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L132,26Z` : '')
      sDot.setAttribute('cx', xy.at(-1)[0].toFixed(1))
      sDot.setAttribute('cy', xy.at(-1)[1].toFixed(1))
      hearts.replaceChildren(...Array.from({ length: 5 }, (_, i) => (i < v.hearts ? document.createTextNode('♥') : el('span', null, '♥'))))
      affV.textContent = v.tierName
      affN.textContent = `${fmt(v.aff)} / 100`
      fill.style.width = `${v.close}%`
      closeV.textContent = v.stageName
      closeN.textContent = `${fmt(v.close)} / 100`
      closeNext.textContent = v.nextStage ? `下一階：${v.nextStage[1]}` : ''
      const tagList = []
      if (v.anxWord) tagList.push(['!', v.anxWord, v.anx, ''])
      if (v.loneWord) tagList.push(['…', v.loneWord, v.lone, 'is-lone'])
      else if (v.awayDays >= 1) tagList.push(['…', W.missed, v.lone, 'is-lone'])
      tags.replaceChildren(
        ...(tagList.length
          ? tagList.map(([g, word, n, cls]) => {
              const tg = el('span', `ocs-htag ${cls}`)
              tg.dataset.tag = cls ? 'lone' : 'anx'
              tg.append(`${g} ${word}`, el('span', 'ocs-alt', fmt(n)))
              return tg
            })
          : [el('span', 'ocs-htag is-calm', v.mood >= 50 ? W.calm : W.tired)])
      )
      const items = v.moodlets.slice(0, 6)
      list.replaceChildren(
        ...(items.length
          ? items.map((m) => {
              const li = el('li', m.v < 0 ? 'is-neg' : '')
              li.dataset.kind = m.kind
              li.append(
                el('span', 'ocs-hsign', m.v < 0 ? '－' : '＋'),
                el('span', 'ocs-hname', m.count > 1 ? `${m.label} ×${m.count}` : m.label),
                el('span', 'ocs-alt', `${m.v > 0 ? '+' : ''}${m.v}`),
                el('span', 'ocs-hleft', leftText(m.leftMin))
              )
              return li
            })
          : [el('li', 'is-empty', W.nothing)])
      )
    }
    updaters.push(paint)
    // While this page is open, the clocks on its thoughts tick down.
    const timer = setInterval(() => (row.isConnected ? paint() : clearInterval(timer)), 5000)
    return row
  }

  // A button that asks once more, in place, before doing something that cannot be undone.
  function confirmRow(item, { button, question, yes, done, run }) {
    const { row, side } = baseRow(item)
    const ask = el('button', 'ocs-btn is-danger', button)
    ask.type = 'button'
    const show = (node) => side.replaceChildren(node)
    ask.addEventListener('click', () => {
      const box = el('div', 'ocs-confirm')
      box.setAttribute('role', 'group')
      box.setAttribute('aria-label', question)
      const ok = el('button', 'ocs-btn is-danger is-solid', yes)
      const no = el('button', 'ocs-btn', '算了')
      ok.type = no.type = 'button'
      ok.addEventListener('click', () => {
        run()
        const msg = el('span', 'ocs-confirm', done)
        msg.setAttribute('role', 'status')
        show(msg)
        setTimeout(() => {
          if (!msg.isConnected) return
          show(ask)
          sync()
        }, 2600)
        sync()
      })
      no.addEventListener('click', () => {
        show(ask)
        ask.focus()
      })
      box.append(el('span', null, question), ok, no)
      show(box)
      no.focus() // the safe choice gets the focus
    })
    side.append(ask)
    return row
  }

  const forgetRow = (item) =>
    confirmRow(item, { button: '忘掉回憶…', question: '真的要牠忘掉嗎？沒辦法復原。', yes: '忘掉', done: '牠把回憶收起來了。', run: () => pet()?.panel.forget() })
  const resetAllRow = (item) =>
    confirmRow(item, { button: '恢復預設…', question: '全部設定都回到預設？', yes: '恢復', done: '設定都回到預設了。', run: () => base() && save(C.normalize({ you: cfg()?.you }, base())) })

  const ROWS = { heart: heartRow, feature: featureRow, freq: freqRow, number: numberRow, range: rangeRow, quiet: quietRow, name: nameRow, size: sizeRow, home: homeRow, stats: statsRow, forget: forgetRow, resetAll: resetAllRow }

  // ---------- the panel ----------
  let previous = null
  let tabIndex = 0
  let altOff = null
  const TAB_KEY = 'orca-companion:settings-tab'
  // Rows a pet hid with `behaviors: [{ id, hidden: true }]` keep their default but are not drawn.
  const sections = () => (pet()?.panel.sections ?? []).map((s) => ({ ...s, items: s.items.filter((i) => !i.hidden) })).filter((s) => s.items.length)

  function renderSection(pane, live) {
    const section = sections()[tabIndex]
    updaters = []
    if (!section) return pane.replaceChildren()
    const head = el('h3', 'ocs-h', section.label)
    head.id = `ocs-h-${section.id}`
    const intro = el('p', 'ocs-intro', section.intro ?? '')
    const banner = el('div', 'ocs-banner')
    banner.setAttribute('role', 'note')
    updaters.push(() => {
      const off = reduced()
      banner.hidden = !off
      banner.textContent = off ? '系統開了「減少動態」，牠先休息。設定還是能改，關掉減少動態後就生效。' : ''
    })
    const rows = el('div')
    for (const item of section.items) {
      try {
        const make = ROWS[item.kind]
        if (make) rows.append(make(item, live))
      } catch (error) {
        console.warn('[companion settings] row failed', item.id, error)
      }
    }
    pane.replaceChildren(head, intro, banner, rows)
    pane.setAttribute('aria-labelledby', head.id)
    pane.scrollTop = 0
    sync()
  }

  const focusables = () => [...root.querySelectorAll('button, input')].filter((e) => !e.disabled && e.tabIndex >= 0 && e.offsetParent !== null)

  // A small copy of the pet's own drawing for the header.
  function face(p) {
    const box = el('div', 'ocs-face')
    box.innerHTML = p.drawing ?? ''
    const svg = box.querySelector('svg')
    if (svg) for (const a of ['width', 'height', 'style', 'class']) svg.removeAttribute(a)
    else box.replaceChildren()
    box.setAttribute('aria-hidden', 'true')
    return box
  }

  function open(id) {
    const list = pets()
    const chosen = list.find((p) => p.id === id) ?? list[0]
    if (!chosen) return
    if (root) close(false)
    flush()
    ensureStyle()
    petId = chosen.id
    previous ??= document.activeElement
    try {
      const saved = localStorage.getItem(TAB_KEY)
      tabIndex = Math.max(0, sections().findIndex((s) => s.id === saved))
    } catch {
      tabIndex = 0
    }
    const r = chosen.root?.getBoundingClientRect()
    root = el('div')
    root.id = ROOT_ID
    root.dataset.side = r && r.left + r.width / 2 > innerWidth / 2 ? 'left' : 'right'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-labelledby', 'ocs-title')
    const scrim = el('div', 'ocs-scrim')
    const panel = el('section', 'ocs-panel')
    const head = el('header', 'ocs-head')
    const titles = el('div')
    const petName = String(chosen.label ?? chosen.id)
    // A space between a Latin name and the Chinese after it (「棉花羊 Puff 的設定」).
    const title = el('h2', 'ocs-title', `${petName}${/[A-Za-z0-9)]$/.test(petName) ? ' ' : ''}的設定`)
    title.id = 'ocs-title'
    const SUB = '改了馬上生效，下次開 Orca 也記得。'
    const sub = el('p', 'ocs-sub', SUB)
    sub.setAttribute('aria-live', 'polite')
    titles.append(title, sub)
    head.append(face(chosen), titles)
    if (list.length > 1) {
      // More than one pet: switch between them here.
      const seg = el('div', 'ocs-seg ocs-pets')
      seg.setAttribute('aria-label', '選擇寵物')
      for (const p of list) {
        const b = el('button', null, p.label ?? p.id)
        b.type = 'button'
        b.setAttribute('aria-pressed', String(p.id === petId))
        b.setAttribute('aria-checked', String(p.id === petId))
        b.addEventListener('click', () => p.id !== petId && open(p.id))
        seg.append(b)
      }
      titles.append(seg)
    }
    const x = el('button', 'ocs-x', '✕')
    x.type = 'button'
    x.setAttribute('aria-label', '關閉設定')
    head.append(x)

    const body = el('div', 'ocs-body')
    const nav = el('div', 'ocs-nav')
    nav.setAttribute('role', 'tablist')
    nav.setAttribute('aria-orientation', 'vertical')
    nav.setAttribute('aria-label', '設定分類')
    const pane = el('div', 'ocs-pane')
    pane.setAttribute('role', 'tabpanel')
    pane.id = 'ocs-pane'
    const live = el('div')
    live.setAttribute('aria-live', 'polite')
    live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)'
    const tabs = sections().map((s, i) => {
      const b = el('button', 'ocs-tab', s.label)
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-controls', 'ocs-pane')
      b.dataset.tab = s.id
      b.addEventListener('click', () => select(i))
      return b
    })
    const select = (i, focus = false) => {
      tabIndex = i
      try {
        localStorage.setItem(TAB_KEY, sections()[i].id)
      } catch {}
      tabs.forEach((b, j) => {
        b.setAttribute('aria-selected', String(j === i))
        b.tabIndex = j === i ? 0 : -1
      })
      if (focus) tabs[i].focus()
      renderSection(pane, live)
    }
    nav.addEventListener('keydown', (e) => {
      const step = { ArrowUp: -1, ArrowDown: 1 }[e.key]
      if (step == null && e.key !== 'Home' && e.key !== 'End') return
      e.preventDefault()
      const n = tabs.length
      select(e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (tabIndex + step + n) % n, true)
    })
    nav.append(...tabs)
    body.append(nav, pane)

    const foot = el('footer', 'ocs-foot')
    const hint = el('span', null, '在牠身上按右鍵也能打開這裡')
    const keys = el('span')
    keys.append('再按 ', el('kbd', null, 'Ctrl'), ' ', el('kbd', null, 'Alt'), ' ', el('kbd', null, 'T'), ' 或點外面關閉')
    foot.append(hint, keys)
    panel.append(head, body, foot, live)
    root.append(scrim, panel)

    scrim.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      close()
    })
    x.addEventListener('click', () => close())
    // Keyboard: Tab stays inside (wraps at both ends); keys typed here do not reach Orca's shortcuts.
    // No Esc: in a terminal Esc interrupts Claude Code, so nothing here ever listens for it.
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const items = focusables()
        if (!items.length) return
        const i = items.indexOf(document.activeElement)
        if (i === -1 || (e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1)) {
          e.preventDefault()
          items[e.shiftKey ? items.length - 1 : 0].focus()
        }
      }
      // Alt held: the 心情 tab shows its numbers; released (or the window loses focus), words only.
      if (e.key === 'Alt') {
        e.preventDefault()
        root.dataset.alt = ''
      }
      e.stopPropagation()
    })
    const altUp = (e) => root && (e.type === 'blur' || e.key === 'Alt') && delete root.dataset.alt
    root.addEventListener('keyup', altUp)
    addEventListener('blur', altUp)
    altOff = () => removeEventListener('blur', altUp)
    root.addEventListener('focusout', (e) => {
      if (root && e.relatedTarget && !root.contains(e.relatedTarget)) tabs[tabIndex]?.focus()
    })

    let flashTimer = 0
    savedFlash = () => {
      clearTimeout(flashTimer)
      sub.textContent = '已儲存'
      sub.dataset.saved = ''
      flashTimer = setTimeout(() => {
        sub.textContent = SUB
        delete sub.dataset.saved
      }, 1400)
    }
    document.body.appendChild(root)
    select(Math.min(tabIndex, tabs.length - 1))
    tabs[tabIndex]?.focus({ focusVisible: false })
    addEventListener('orca-themer:state', onState)
    T.setOverlay?.({ isOpen: () => !!root, close })
  }

  // The pet went away (switched off, theme changed): the panel goes with it.
  const onState = () => (root && !pet() ? close() : sync())

  function close(restoreFocus = true) {
    if (!root) return
    flush()
    const r = root
    root = null
    savedFlash = null
    updaters = []
    altOff?.()
    altOff = null
    removeEventListener('orca-themer:state', onState)
    T.setOverlay?.(null)
    r.dataset.closing = ''
    if (reduced() || !restoreFocus) r.remove()
    else setTimeout(() => r.remove(), 150)
    if (restoreFocus) {
      if (previous?.isConnected) previous.focus?.()
      previous = null
    }
  }

  T.openCompanionSettings = (id) => (root && petId === id ? close() : open(id))
  T.registerPickerItem({
    id: 'companion-settings',
    label: '寵物設定',
    sub: '牠的每個小動作、說話、聲音和安靜時段',
    when: () => pets().length > 0,
    run: () => open()
  })
})()
