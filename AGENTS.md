# AGENTS.md

You are helping someone build their own look for the **Orca** IDE: a theme (CSS variables), a terminal palette, a custom cursor, and a desktop companion pet, plus an optional notification sound. Reply in the user's language; the docs are written in Traditional Chinese, with English in the code.

## Where things go

- **The user's creations live in `~/.orca/themer/`** (themes/, snippets/, touches/, terminal/, sounds/, assets/). Write there, not into this repo, so `git pull` never touches their work. (`$ORCA_THEMER_ROOT` overrides the folder.)
- This repo is the engine: `src/themer.mjs` (launcher), `src/page-runtime.js` (in-window runtime, Ctrl+Alt+T picker), `src/touches/companion.js` (pet engine), `src/touches/power-mode.js`, `src/fixes/` (optional, off by default). Change the engine only when the user asks for an engine change, and run `npm test` afterwards.

## Workflow

Follow **[docs/ai-guide.md](docs/ai-guide.md)**: interview (reference images, palette, personality, signature motion), generate the files, then verify. The reference docs are:

- [docs/themes.md](docs/themes.md): theme header, Orca's CSS variables (full list: Orca repo `src/renderer/src/assets/main.css`, `.dark` block), DOM hooks, terminal palette, cursor, sound
- [docs/companion-api.md](docs/companion-api.md): `registerCompanion` reference; the worked example is `examples/touches/puff.js`
- [docs/touches.md](docs/touches.md): `registerTouch` and the runtime API
- [docs/performance.md](docs/performance.md): **read this before writing any CSS or JS**

## Hard rules

1. **Never stop Orca or the launcher process** (`orca-companion.exe`, or node running `src/themer.mjs`). Orca closes when the launcher's pipe closes, and the user's running agents go with it. When a restart is needed, ask the user to do it.
2. **Performance** (each rule comes from a slowdown measured in Orca):
   - no page-wide `::selection` (~800 ms per keystroke: the caret moving in xterm's hidden textarea is a selection change)
   - no combinators inside `:not()` in universal selectors (~70 ms per style recalc, which hits every IME keystroke)
   - no full-window canvases (re-composited every frame; they collide with terminal redraws on long IME commits); use a small canvas that moves, like power-mode
   - throttle per-keystroke work (≥150 ms between animations); never read layout or canvas pixels per keystroke
   - Windows IMEs send `keydown` only for the first composing key, so also listen to `compositionupdate`/`compositionend`
   - **never bind Esc**: in the terminal it interrupts Claude Code; use right-click or a click
   - animate only `transform`/`opacity` (WAAPI); respect `prefers-reduced-motion`; `stop()` removes every listener, timer, observer and element
   - do not use `::before`/`::after` on `[data-sonner-toast]` (sonner uses them for swipe and hover); decorate toasts with background layers
3. **Verify before saying "done"**: `npm run check` must report 0 errors, and `npm test` must pass if you touched the engine. Then ask the user to look at the result in Orca (Ctrl+Alt+T); saving a file hot-reloads it.
4. **Original art only.** Draw an original character inspired by what the user describes. Do not copy official game or anime art, and do not download images into this repo. Private images the user owns go in `~/.orca/themer/assets/<theme id>/`.
5. Keep the user's files out of git. Never commit anything from `~/.orca/themer`.

## Commands

```powershell
npm test                     # engine tests
npm run check                # lint ~/.orca/themer (perf traps, syntax, headers, palettes)
npm run check -- --repo      # lint this repo's themes and examples
npm run example              # copy the examples into ~/.orca/themer
npm run cursor -- c.svg 2 2  # cursor SVG -> CSS (1x/2x image-set, hotspot)
npm run chime -- out.wav 1046.5 1318.5
```
