import React, { useEffect, useRef, useState } from 'react'
import Arcadia from './widgets/Arcadia.jsx'

export default function App() {
  const [difficulty, setDifficulty] = useState('normal')
  const [mode, setMode] = useState('endless')
  const [showHelp, setShowHelp] = useState(false)
  const [best, setBest] = useState(() => Number(localStorage.getItem('arcadia:best:' + mode) || 0))
  const [running, setRunning] = useState(false)     // lock selectors mid-run
  const [showLanding, setShowLanding] = useState(true) // start on the home screen

  const headerRef = useRef(null)
  const gameRef = useRef(null)

  // True 100vh + header height CSS vars
  useEffect(() => {
    const setVhVars = () => {
      const vh = window.innerHeight * 0.01
      document.documentElement.style.setProperty('--vh', `${vh}px`)
      const h = headerRef.current?.offsetHeight || 64
      document.documentElement.style.setProperty('--header-h', `${h}px`)
    }
    setVhVars()
    window.addEventListener('resize', setVhVars)
    window.addEventListener('orientationchange', setVhVars)
    return () => {
      window.removeEventListener('resize', setVhVars)
      window.removeEventListener('orientationchange', setVhVars)
    }
  }, [])

  // While Landing is open, block Space/Enter from starting the game
  useEffect(() => {
    if (!showLanding) return
    const h = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', h, { capture: true })
    return () => window.removeEventListener('keydown', h, true)
  }, [showLanding])

  function handleGameOver(score) {
    const key = 'arcadia:best:' + mode
    const prev = Number(localStorage.getItem(key) || 0)
    if (score > prev) {
      localStorage.setItem(key, String(score))
      setBest(score)
    }
  }

  return (
    <div className="min-h-screen bg-aurora">
      {/* NAVBAR */}
      <header ref={headerRef} className="sticky top-0 z-10 backdrop-blur bg-slate-950/70 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500/70 to-sky-400/70 flex items-center justify-center shadow-glow">
              <span className="text-xl font-bold">🚀</span>
            </div>
            <h1 className="text-base sm:text-lg font-semibold tracking-tight">Neon Glide</h1>
          </div>

          {/* Right side controls */}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="text-xs opacity-80">Mode</label>
            <select
              value={mode}
              disabled={running}
              onChange={e => {
                setMode(e.target.value)
                const s = Number(localStorage.getItem('arcadia:best:' + e.target.value) || 0)
                requestAnimationFrame(() => setBest(s))
              }}
              className={"px-2 py-1 rounded-md bg-slate-950 border text-xs sm:text-sm " + (running ? "opacity-50 cursor-not-allowed border-slate-800" : "border-slate-800")}
            >
              <option value="endless">Endless</option>
              <option value="onslaught">Onslaught</option>
              <option value="bullethell">Bullet Hell</option>
              <option value="waves">Waves</option>
              <option value="zen">Zen</option>
            </select>

            <label className="text-xs opacity-80">Difficulty</label>
            <select
              value={difficulty}
              disabled={running}
              onChange={e => setDifficulty(e.target.value)}
              className={"px-2 py-1 rounded-md bg-slate-950 border text-xs sm:text-sm " + (running ? "opacity-50 cursor-not-allowed border-slate-800" : "border-slate-800")}
            >
              <option value="chill">Chill</option>
              <option value="normal">Normal</option>
              <option value="hyper">Hyper</option>
            </select>

            {/* NEW GAME -> go to Landing */}
            <button
              onClick={() => {
                // pause if currently running, then show landing
                gameRef.current?.pause?.()
                setShowLanding(true)
              }}
              className="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs sm:text-sm"
            >
              New Game
            </button>

            <button onClick={() => setShowHelp(true)} className="px-2.5 py-1 rounded-md border border-slate-700 hover:border-slate-500 bg-slate-900/70 text-xs sm:text-sm">
              How to play
            </button>

            <span className="hidden md:inline text-sm opacity-80">
              Best ({mode}): <strong className="tabular-nums">{best}</strong>
            </span>
          </div>
        </div>
      </header>

      {/* GAME AREA — 100vh minus navbar */}
      <main
        className="relative w-full"
        style={{ minHeight: 'calc(var(--vh, 1vh) * 100 - var(--header-h, 64px))' }}
      >
        <Arcadia
          ref={gameRef}
          difficulty={difficulty}
          mode={mode}
          compactControls
          inputLock={showLanding}          // prevent Space/Enter auto-start behind the landing
          onGameOver={handleGameOver}
          onRunningChange={(r) => setRunning(r)}
        />

        {/* LANDING (HOME) OVERLAY */}
        {showLanding && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500/70 to-sky-400/70 flex items-center justify-center shadow-glow">
                  <span className="text-xl font-bold">🚀</span>
                </div>
                <h2 className="text-lg font-semibold">Neon Glide</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs opacity-80">Mode</label>
                  <select
                    value={mode}
                    onChange={e => {
                      setMode(e.target.value)
                      const s = Number(localStorage.getItem('arcadia:best:' + e.target.value) || 0)
                      requestAnimationFrame(() => setBest(s))
                    }}
                    className="mt-1 w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800"
                  >
                    <option value="endless">Endless (classic)</option>
                    <option value="onslaught">Onslaught (heavy spawn)</option>
                    <option value="bullethell">Bullet Hell (enemies shoot)</option>
                    <option value="waves">Waves (ramps up)</option>
                    <option value="zen">Zen (no damage)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs opacity-80">Difficulty</label>
                  <select
                    value={difficulty}
                    onChange={e => setDifficulty(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800"
                  >
                    <option value="chill">Chill</option>
                    <option value="normal">Normal</option>
                    <option value="hyper">Hyper</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button
                  onClick={() => {
                    setShowLanding(false)
                    requestAnimationFrame(() => gameRef.current?.start()) // start after overlay hides
                  }}
                  className="px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white"
                >
                  Start Game
                </button>
                <button
                  onClick={() => setShowHelp(true)}
                  className="px-3 py-2 rounded-md border border-slate-700 hover:border-slate-500"
                >
                  How to play
                </button>
                <span className="ml-auto text-sm opacity-80">
                  Best ({mode}): <strong className="tabular-nums">{best}</strong>
                </span>
              </div>
            </div>
          </div>
        )}
      </main>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

function HelpModal({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="max-w-lg w-full rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl text-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">How to play</h3>
          <button onClick={onClose} className="px-2 py-1 rounded-md border border-slate-700">✕</button>
        </div>
        <ul className="list-disc pl-5 space-y-2 mt-3">
          <li><strong>Move:</strong> ← → or A/D. Mobile: on-screen arrows.</li>
          <li><strong>Fire:</strong> Hold Space, tap the canvas, or tap the center button.</li>
          <li><strong>Start/Resume:</strong> Space/Enter. <strong>Pause:</strong> P.</li>
          <li>Collect orbs (+10), shoot fighters (+25). Power-ups: ❤️ heal, 🕶 stealth, ✴ aura.</li>
        </ul>
      </div>
    </div>
  )
}
