import React, {
    useEffect, useRef, useState,
    forwardRef, useImperativeHandle
} from 'react'

/**
 * Arcadia — Neon Glide (SFX edition)
 * - WebAudio SFX: laser, explosion, pickup, power-up, hurt, click.
 * - Navbar SFX toggle (sfxEnabled prop).
 * - Audio unlock on first user gesture (exposed via ref.unlockAudio()).
 * - Everything else: full-height canvas, mobile controls, capped speed, landing input lock, etc.
 */

const DIFF = {
    chill: { speed: 220, spawn: 0.80, max: 650 },
    normal: { speed: 280, spawn: 1.00, max: 800 },
    hyper: { speed: 360, spawn: 1.30, max: 950 },
}
const MODE = {
    endless: { enemyBullets: 0.15, spawnMul: 1.0 },
    onslaught: { enemyBullets: 0.20, spawnMul: 1.6 },
    bullethell: { enemyBullets: 0.45, spawnMul: 1.2 },
    waves: { enemyBullets: 0.25, spawnMul: 0.9 },
    zen: { enemyBullets: 0.00, spawnMul: 0.7 },
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const rand = (a, b) => a + Math.random() * (b - a)

/* ---------- Tiny Sound Engine (no assets) ---------- */
class Sound {
    constructor() {
        this.ctx = null
        this.master = null
        this.enabled = true
        this.noiseBuf = null
    }
    unlock() {
        if (this.ctx && this.ctx.state !== 'suspended') return
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return
        if (!this.ctx) {
            this.ctx = new AC()
            this.master = this.ctx.createGain()
            this.master.gain.value = 0.25 // default
            this.master.connect(this.ctx.destination)
            this.noiseBuf = this._makeNoise()
        }
        if (this.ctx.state === 'suspended') this.ctx.resume()
    }
    setEnabled(on) { this.enabled = !!on; if (this.master) this.master.gain.value = on ? 0.25 : 0.0 }
    setVolume(v) { if (this.master) this.master.gain.value = v }
    _makeNoise() {
        const len = 0.3 * 44100
        const buf = this.ctx.createBuffer(1, len, 44100)
        const d = buf.getChannelData(0)
        for (let i = 0; i < len; i++) { d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2) }
        return buf
    }
    _env(duration = 0.15) {
        const g = this.ctx.createGain()
        const now = this.ctx.currentTime
        g.gain.setValueAtTime(0.0001, now)
        g.gain.exponentialRampToValueAtTime(1.0, now + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, now + duration)
        return { g, now }
    }
    laser() {
        if (!this.ctx || !this.enabled) return
        const { g, now } = this._env(0.12)
        const o = this.ctx.createOscillator()
        o.type = 'square'
        const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 400
        o.frequency.setValueAtTime(900, now)
        o.frequency.exponentialRampToValueAtTime(280, now + 0.12)
        o.connect(f); f.connect(g); g.connect(this.master)
        o.start(); o.stop(now + 0.13)
    }
    explosion() {
        if (!this.ctx || !this.enabled) return
        const { g, now } = this._env(0.5)
        const s = this.ctx.createBufferSource()
        s.buffer = this.noiseBuf
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(800, now)
        f.frequency.exponentialRampToValueAtTime(120, now + 0.45)
        s.connect(f); f.connect(g); g.connect(this.master)
        s.start(); s.stop(now + 0.5)
    }
    pickup() {
        if (!this.ctx || !this.enabled) return
        const { g, now } = this._env(0.12)
        const o = this.ctx.createOscillator()
        o.type = 'triangle'
        o.frequency.setValueAtTime(440, now)
        o.frequency.exponentialRampToValueAtTime(880, now + 0.12)
        o.connect(g); g.connect(this.master)
        o.start(); o.stop(now + 0.13)
    }
    power(type = 'generic') {
        if (!this.ctx || !this.enabled) return
        const { g, now } = this._env(0.25)
        const o = this.ctx.createOscillator()
        o.type = 'sawtooth'
        const base = type === 'aura' ? 300 : (type === 'stealth' ? 220 : 260)
        o.frequency.setValueAtTime(base, now)
        o.frequency.exponentialRampToValueAtTime(base * 2, now + 0.22)
        o.connect(g); g.connect(this.master)
        o.start(); o.stop(now + 0.25)
    }
    hurt() {
        if (!this.ctx || !this.enabled) return
        const { g, now } = this._env(0.2)
        const o = this.ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.setValueAtTime(160, now)
        o.frequency.exponentialRampToValueAtTime(80, now + 0.2)
        o.connect(g); g.connect(this.master)
        o.start(); o.stop(now + 0.21)
    }
    click() {
        if (!this.ctx || !this.enabled) return
        const { g, now } = this._env(0.05)
        const o = this.ctx.createOscillator()
        o.type = 'square'
        o.frequency.setValueAtTime(1200, now)
        o.frequency.exponentialRampToValueAtTime(600, now + 0.05)
        o.connect(g); g.connect(this.master)
        o.start(); o.stop(now + 0.051)
    }
}
const sharedSound = new Sound()
/* --------------------------------------------------- */

const Arcadia = forwardRef(function Arcadia({
    difficulty = 'normal',
    mode = 'endless',
    compactControls = false,
    inputLock = false,       // block starting when landing shown
    sfxEnabled = true,       // navbar toggle
    onGameOver,
    onStart,
    onRunningChange
}, ref) {
    const canvasRef = useRef(null)
    const rafRef = useRef(0)

    const [running, setRunning] = useState(false)
    const [paused, setPaused] = useState(false)

    const [score, setScore] = useState(0)
    const [hp, setHp] = useState(3)
    const [stealthUI, setStealthUI] = useState(0)

    const keyRef = useRef({ left: false, right: false, fire: false })
    const pointerRef = useRef({ x: null, firing: false })
    const S = useRef(null)

    // keep SFX toggle in sync
    useEffect(() => { sharedSound.setEnabled(!!sfxEnabled) }, [sfxEnabled])

    // Resize (true full height)
    useEffect(() => {
        const c = canvasRef.current
        if (!c) return
        const ro = new ResizeObserver(() => {
            const dpr = devicePixelRatio || 1
            c.width = Math.floor(c.clientWidth * dpr)
            c.height = Math.floor(c.clientHeight * dpr)
            if (S.current) {
                S.current.w = c.clientWidth
                S.current.h = c.clientHeight
                S.current.dpr = dpr
                if (S.current.player) S.current.player.y = c.clientHeight - 90
                if (S.current.maxSpeedFromH) {
                    S.current.maxSpeedFromH = Math.min(S.current.diffMax, c.clientHeight * 1.5)
                }
            }
        })
        ro.observe(c)
        return () => ro.disconnect()
    }, [])

    // Block page scroll & capture keys
    useEffect(() => {
        const blockKeys = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', 'Home', 'End'])
        const onKeyDown = (e) => {
            if (blockKeys.has(e.code)) e.preventDefault()
            if (e.repeat) return

            if (inputLock) {
                if (['Space', 'Enter', 'KeyP'].includes(e.code)) return
            }

            if (e.code === 'ArrowLeft' || e.code === 'KeyA') keyRef.current.left = true
            if (e.code === 'ArrowRight' || e.code === 'KeyD') keyRef.current.right = true
            if (e.code === 'Space') {
                if (!running) { start(); return }
                if (paused) { setPaused(false); return }
                keyRef.current.fire = true
            }
            if (e.code === 'Enter') { if (!running) { start(); return } if (paused) { setPaused(false); return } }
            if (e.code === 'KeyP') { if (running) setPaused(p => !p) }
        }
        const onKeyUp = (e) => {
            if (blockKeys.has(e.code)) e.preventDefault()
            if (e.code === 'ArrowLeft' || e.code === 'KeyA') keyRef.current.left = false
            if (e.code === 'ArrowRight' || e.code === 'KeyD') keyRef.current.right = false
            if (e.code === 'Space') keyRef.current.fire = false
        }
        window.addEventListener('keydown', onKeyDown, { capture: true })
        window.addEventListener('keyup', onKeyUp, { capture: true })
        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('keyup', onKeyUp, true)
        }
    }, [running, paused, inputLock])

    // Pointer / touch
    useEffect(() => {
        const c = canvasRef.current
        if (!c) return
        const pos = (ev) => {
            const r = c.getBoundingClientRect()
            pointerRef.current.x = (ev.touches?.[0]?.clientX ?? ev.clientX) - r.left
        }
        const fireDown = (ev) => { ev.preventDefault(); pointerRef.current.firing = true; pos(ev); sharedSound.unlock() }
        const fireUp = () => { pointerRef.current.firing = false; pointerRef.current.x = null }
        c.addEventListener('pointerdown', fireDown, { passive: false })
        c.addEventListener('pointermove', pos)
        c.addEventListener('pointerup', fireUp)
        c.addEventListener('pointerleave', fireUp)
        return () => {
            c.removeEventListener('pointerdown', fireDown)
            c.removeEventListener('pointermove', pos)
            c.removeEventListener('pointerup', fireUp)
            c.removeEventListener('pointerleave', fireUp)
        }
    }, [])

    // Main loop
    useEffect(() => {
        let last = performance.now()
        let accumUI = 0
        function loop(now) {
            rafRef.current = requestAnimationFrame(loop)
            if (!running) return
            const st = S.current
            if (!st) return

            if (paused) {
                drawPaused(st)
                last = now
                return
            }

            const dt = Math.min(0.033, (now - last) / 1000)
            last = now
            st.t += dt

            step(st, dt)
            draw(st)

            // UI sync
            accumUI += dt
            if (accumUI > 0.1) {
                setScore(Math.round(st.score))
                setHp(st.player.hp)
                setStealthUI(Math.max(0, st.player.stealth))
                accumUI = 0
            }

            if (!st.alive) {
                cancelAnimationFrame(rafRef.current)
                setRunning(false)
                onRunningChange?.(false)
                document.body.style.overflow = '' // restore scroll
                onGameOver?.(Math.round(st.score))
            }
        }
        rafRef.current = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(rafRef.current)
    }, [running, paused, difficulty, mode])

    // Start (and restart)
    function start() {
        if (inputLock) return
        const c = canvasRef.current
        if (!c) return
        const diff = DIFF[difficulty] || DIFF.normal
        const m = MODE[mode] || MODE.endless

        sharedSound.unlock()
        sharedSound.click()

        const maxFromH = Math.min(diff.max, c.clientHeight * 1.5)
        const px = c.clientWidth * 0.5

        S.current = {
            t: 0,
            w: c.clientWidth, h: c.clientHeight, dpr: (devicePixelRatio || 1),
            mode,
            diffMax: diff.max,
            maxSpeedFromH: maxFromH,
            baseSpeed: diff.speed,
            speed: diff.speed,
            spawnMul: diff.spawn * (m.spawnMul || 1),
            enemyBulletRate: (m.enemyBullets ?? 0.15),
            waveLevel: 0,
            nextSpawn: 0,
            score: 0,
            alive: true,
            shake: 0,
            player: {
                x: px, y: c.clientHeight - 90, vx: 0, r: 18,
                hp: 3, maxHp: 3,
                fireCooldown: 0, fireRate: 0.12,
                stealth: 0
            },
            enemies: [], orbs: [], bullets: [], ebullets: [], powers: [], particles: []
        }

        document.body.style.overflow = 'hidden'
        c.tabIndex = 0; c.style.outline = 'none'; c.focus()

        setStealthUI(0); setHp(3); setScore(0)
        setRunning(true); setPaused(false)
        onRunningChange?.(true)
        onStart?.()
    }

    // expose API to parent
    useImperativeHandle(ref, () => ({
        start: () => start(),
        restart: () => start(),
        pause: () => setPaused(true),
        resume: () => setPaused(false),
        isRunning: () => running,
        unlockAudio: () => sharedSound.unlock()
    }), [running, paused, inputLock])

    // Core game step
    function step(st, dt) {
        const p = st.player

        // speed ramp (clamped)
        const maxSpeed = st.maxSpeedFromH || 800
        st.speed = Math.min(st.baseSpeed + st.t * 10, maxSpeed)
        if (st.mode === 'waves') {
            const lvl = Math.floor(st.t / 20)
            if (lvl !== st.waveLevel) {
                st.waveLevel = lvl
                st.spawnMul *= 1.12
                st.baseSpeed = Math.min(st.baseSpeed * 1.06, maxSpeed)
            }
        }

        // controls
        const accel = 3600, fric = 0.84, maxVX = 560
        if (keyRef.current.left && !keyRef.current.right) p.vx = Math.max(p.vx - accel * dt, -maxVX)
        else if (keyRef.current.right && !keyRef.current.left) p.vx = Math.min(p.vx + accel * dt, maxVX)
        else p.vx *= fric
        if (pointerRef.current.x != null) {
            const dx = pointerRef.current.x - p.x
            p.vx += clamp(dx, -900, 900) * 3.2 * dt
        }
        p.x = clamp(p.x + p.vx * dt, 24, st.w - 24)

        // shooting
        const firing = keyRef.current.fire || pointerRef.current.firing
        p.fireCooldown -= dt
        if (firing && p.fireCooldown <= 0) {
            p.fireCooldown = p.fireRate
            st.bullets.push({ x: p.x - 10, y: p.y - 16, vy: -720, r: 3.5 })
            st.bullets.push({ x: p.x + 10, y: p.y - 16, vy: -720, r: 3.5 })
            for (let k = 0; k < 6; k++) {
                st.particles.push({ x: p.x + (Math.random() < 0.5 ? -10 : 10), y: p.y - 16, vx: (Math.random() - 0.5) * 60, vy: -120 - (Math.random() * 80), life: 0.15 + Math.random() * 0.2, color: 'rgba(148,163,184,0.9)' })
            }
            sharedSound.laser()
        }

        // spawns
        st.nextSpawn -= dt * st.spawnMul
        if (st.nextSpawn <= 0) {
            st.nextSpawn = rand(0.55, 0.9)
            const laneW = st.w / 6
            const lane = Math.floor(Math.random() * 6)
            const ex = 30 + lane * laneW + laneW * 0.5 + (Math.random() - 0.5) * laneW * 0.4
            const lead = Math.min(160, 40 + st.speed * 0.18)
            const evy = st.speed * rand(0.95, 1.12)
            st.enemies.push({ x: ex, y: -lead, vx: rand(-30, 30), vy: evy, r: 18, hp: 2, t: 0 })
            if (Math.random() < 0.6) st.orbs.push({ x: ex + rand(-60, 60), y: -lead * 1.2, r: 9, vy: st.speed * 0.95 })
            if (Math.random() < 0.18) {
                const types = ['heal', 'stealth', 'aura']
                const type = types[Math.floor(Math.random() * types.length)]
                st.powers.push({ x: ex + rand(-40, 40), y: -lead * 1.4, type, vy: st.speed * 0.9 })
            }
        }

        // enemy fire
        if (st.mode !== 'zen') {
            for (const e of st.enemies) {
                if (Math.random() < ((st.enemyBulletRate || 0.15) * dt)) {
                    st.ebullets.push({ x: e.x, y: e.y + 10, vy: st.speed * 1.3, r: 3.5 })
                }
            }
        }

        // move entities
        for (const e of st.enemies) { e.t += dt; e.y += e.vy * dt; e.x += Math.sin((e.t + e.x * 0.01) * 3) * 40 * dt }
        for (const o of st.orbs) { o.y += o.vy * dt }
        for (const b of st.bullets) { b.y += b.vy * dt }
        for (const eb of st.ebullets) { eb.y += eb.vy * dt }
        for (const pw of st.powers) { pw.y += pw.vy * dt }

        // collisions
        // bullets vs enemies
        for (let i = st.enemies.length - 1; i >= 0; i--) {
            const e = st.enemies[i]
            for (let j = st.bullets.length - 1; j >= 0; j--) {
                const b = st.bullets[j]
                if (circleHit(e.x, e.y, e.r, b.x, b.y, b.r)) {
                    st.bullets.splice(j, 1); e.hp -= 1
                    for (let k = 0; k < 10; k++) {
                        st.particles.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 180, vy: (Math.random() - 0.5) * 180, life: 0.25 + Math.random() * 0.25, color: 'rgba(56,189,248,0.9)' })
                    }
                    if (e.hp <= 0) {
                        st.enemies.splice(i, 1); st.score += 25; boom(st, e.x, e.y); sharedSound.explosion(); break
                    }
                }
            }
        }
        // collect orbs
        for (let i = st.orbs.length - 1; i >= 0; i--) {
            const o = st.orbs[i]
            if (o.y > st.h + 40) { st.orbs.splice(i, 1); continue }
            if (circleHit(p.x, p.y, p.r + 4, o.x, o.y, o.r)) {
                st.orbs.splice(i, 1); st.score += 10
                for (let k = 0; k < 12; k++) {
                    st.particles.push({ x: o.x, y: o.y, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160, life: 0.4 + Math.random() * 0.3, color: 'rgba(56,189,248,0.8)' })
                }
                sharedSound.pickup()
            }
        }
        // power-ups
        for (let i = st.powers.length - 1; i >= 0; i--) {
            const pw = st.powers[i]
            if (pw.y > st.h + 60) { st.powers.splice(i, 1); continue }
            if (circleHit(p.x, p.y, p.r + 6, pw.x, pw.y, 12)) {
                st.powers.splice(i, 1)
                if (pw.type === 'heal') { p.hp = Math.min(p.maxHp, p.hp + 1) }
                else if (pw.type === 'stealth') { p.stealth = 3.0 }
                else if (pw.type === 'aura') { auraBoom(st, p.x, p.y, 120); st.score += 15 }
                sharedSound.power(pw.type)
            }
        }
        // damage
        if (st.mode !== 'zen' && p.stealth <= 0) {
            for (let i = st.ebullets.length - 1; i >= 0; i--) {
                const eb = st.ebullets[i]
                if (circleHit(p.x, p.y, p.r, eb.x, eb.y, eb.r)) { st.ebullets.splice(i, 1); hurt(st, 1); sharedSound.hurt(); break }
            }
            for (let i = st.enemies.length - 1; i >= 0; i--) {
                const e = st.enemies[i]
                if (circleHit(p.x, p.y, p.r, e.x, e.y, e.r)) { st.enemies.splice(i, 1); boom(st, e.x, e.y); sharedSound.explosion(); hurt(st, 1); break }
            }
        }

        // particles + cleanup
        for (let i = st.particles.length - 1; i >= 0; i--) {
            const q = st.particles[i]
            q.x += (q.vx || 0) * dt; q.y += (q.vy || 0) * dt; q.life -= dt
            if (q.life <= 0) st.particles.splice(i, 1)
        }
        st.enemies = st.enemies.filter(e => e.y < st.h + 120)
        st.bullets = st.bullets.filter(b => b.y > -60)
        st.ebullets = st.ebullets.filter(b => b.y < st.h + 60)

        // distance score & timers
        st.score += st.speed * dt * 0.35
        if (p.stealth > 0) p.stealth -= dt
    }

    // Draw
    function draw(st) {
        const c = canvasRef.current
        const ctx = c.getContext('2d')
        const dpr = st.dpr
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        if (st.shake > 0) { st.shake -= 1.2; ctx.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake) }
        ctx.clearRect(0, 0, c.width, c.height)

        // lane lines
        ctx.globalAlpha = 0.25
        for (let i = 1; i < 6; i++) { const x = (st.w / 6) * i; ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, st.h); ctx.stroke() }
        ctx.globalAlpha = 1

        // orbs
        for (const o of st.orbs) {
            const g = ctx.createRadialGradient(o.x, o.y, 1, o.x, o.y, o.r * 2)
            g.addColorStop(0, 'rgba(56,189,248,0.9)'); g.addColorStop(1, 'rgba(56,189,248,0.0)')
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill()
            ctx.strokeStyle = 'rgba(165,243,252,0.7)'; ctx.lineWidth = 1.5; ctx.stroke()
        }

        // power-ups
        for (const pw of st.powers) {
            ctx.save(); ctx.translate(pw.x, pw.y); ctx.font = '600 16px system-ui,-apple-system,Segoe UI'; ctx.textAlign = 'center'
            const ring = (color) => { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke() }
            if (pw.type === 'heal') { ring('rgba(74,222,128,0.9)'); ctx.fillStyle = 'rgba(74,222,128,0.9)'; ctx.fillText('❤️', 0, 6) }
            if (pw.type === 'stealth') { ring('rgba(248,113,113,0.9)'); ctx.fillStyle = 'rgba(248,113,113,0.9)'; ctx.fillText('🕶', 0, 6) }
            if (pw.type === 'aura') { ring('rgba(250,204,21,0.95)'); ctx.fillStyle = 'rgba(250,204,21,0.95)'; ctx.fillText('✴', 0, 6) }
            ctx.restore()
        }

        // enemies
        for (const e of st.enemies) { drawFighter(ctx, e.x, e.y, 18) }

        // bullets
        ctx.fillStyle = 'rgba(248,113,113,0.9)'
        for (const b of st.ebullets) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill() }
        ctx.fillStyle = 'rgba(148,163,184,0.95)'
        for (const b of st.bullets) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill() }

        // particles
        for (const p of S.current.particles) { ctx.fillStyle = p.color || 'rgba(56,189,248,0.7)'; ctx.fillRect(p.x, p.y, 2, 2) }

        // player
        drawWarship(ctx, st.player)

        // HUD
        ctx.fillStyle = 'rgba(226,232,240,0.95)'
        ctx.font = '600 16px system-ui,-apple-system,Segoe UI'
        ctx.textAlign = 'left'; ctx.fillText(`Score ${Math.round(st.score)}`, 12, 22)
        ctx.textAlign = 'right'; ctx.fillText(`Speed ${Math.round(st.speed)}`, st.w - 12, 22)
        if (st.player.stealth > 0) { ctx.textAlign = 'center'; ctx.fillText(`Stealth ${st.player.stealth.toFixed(1)}s`, st.w / 2, 22) }
    }

    function drawPaused(st) {
        const c = canvasRef.current
        const ctx = c.getContext('2d')
        const dpr = st?.dpr || (devicePixelRatio || 1)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = 'rgba(2,6,23,0.6)'; ctx.fillRect(0, 0, c.width, c.height)
        ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'center'; ctx.font = '600 28px system-ui,-apple-system,Segoe UI'
        ctx.fillText('Paused — press Space or P to resume', c.clientWidth / 2, c.clientHeight / 2)
    }

    // helpers
    function circleHit(x1, y1, r1, x2, y2, r2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy <= (r1 + r2) * (r1 + r2) }
    function boom(st, x, y) { st.shake = 18; for (let k = 0; k < 28; k++) st.particles.push({ x, y, vx: (Math.random() - 0.5) * 280, vy: (Math.random() - 0.5) * 280, life: 0.4 + Math.random() * 0.5, color: 'rgba(14,165,233,0.9)' }) }
    function auraBoom(st, x, y, R) { for (let i = st.enemies.length - 1; i >= 0; i--) { const e = st.enemies[i]; if (circleHit(x, y, R, e.x, e.y, e.r)) { st.enemies.splice(i, 1); st.score += 25; boom(st, e.x, e.y); sharedSound.explosion() } } }
    function hurt(st, dmg) { const p = st.player; p.hp -= dmg; st.shake = 14; if (p.hp <= 0) { st.alive = false } else { p.stealth = 1.0 } }
    function drawWarship(ctx, p) {
        ctx.save(); ctx.translate(p.x, p.y)
        if (p.stealth > 0) { const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 38); g.addColorStop(0, 'rgba(234,179,8,0.5)'); g.addColorStop(1, 'rgba(234,179,8,0.0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill() }
        ctx.fillStyle = 'rgba(14,165,233,0.9)'; ctx.strokeStyle = 'rgba(226,232,240,0.9)'; ctx.lineWidth = 1.6
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(18, 12); ctx.lineTo(6, 12); ctx.lineTo(0, 4); ctx.lineTo(-6, 12); ctx.lineTo(-18, 12); ctx.closePath(); ctx.fill(); ctx.stroke()
        ctx.fillStyle = 'rgba(2,132,199,0.8)'; ctx.beginPath(); ctx.ellipse(0, -6, 6, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        ctx.globalAlpha = 0.75; const flame = 12 + Math.random() * 10; const g2 = ctx.createLinearGradient(0, 12, 0, 22 + flame); g2.addColorStop(0, 'rgba(56,189,248,0.9)'); g2.addColorStop(1, 'rgba(56,189,248,0.0)'); ctx.fillStyle = g2
        ctx.beginPath(); ctx.moveTo(-8, 12); ctx.lineTo(8, 12); ctx.lineTo(0, 24 + flame); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; ctx.restore()
    }
    function drawFighter(ctx, x, y, r) {
        ctx.save(); ctx.translate(x, y); const t = performance.now() / 1000; const hue = 200 + Math.sin((t + x * 0.01) * 3) * 40
        ctx.fillStyle = `hsla(${hue}, 90%, 60%, 0.18)`; ctx.strokeStyle = `hsla(${hue}, 95%, 65%, 0.85)`; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.85, r); ctx.lineTo(0, r * 0.45); ctx.lineTo(-r * 0.85, r); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore()
    }

    // cleanup
    useEffect(() => () => { document.body.style.overflow = '' }, [])

    // Render
    return (
        <div className="relative w-full"
            style={{ height: 'calc(var(--vh, 1vh) * 100 - var(--header-h, 64px))' }}>
            {/* canvas fills container */}
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

            {/* HUD: hearts + stealth (below Score/Speed on ≥sm) */}
            <div className="absolute left-3 top-3 sm:top-12 flex items-center gap-1.5 pointer-events-none select-none">
                {Array.from({ length: 3 }).map((_, i) => (
                    <span key={i} className={"text-lg " + (i < hp ? "" : "opacity-30")}>❤️</span>
                ))}
            </div>
            {stealthUI > 0 && (
                <div className="absolute right-3 top-3 sm:top-12 text-xs px-2 py-1 rounded bg-yellow-500/20 border border-yellow-400/30 text-yellow-200 select-none">
                    Stealth {stealthUI.toFixed(1)}s
                </div>
            )}

            {/* Floating Start/Pause (hidden when landing is open) */}
            {!inputLock && (
                <div className="absolute right-3 bottom-3 sm:top-12 sm:bottom-auto">
                    <button
                        onClick={() => { if (!running) { sharedSound.unlock(); sharedSound.click() }; running ? setPaused(p => !p) : start() }}
                        className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-900/70 hover:border-slate-500 text-sm"
                        aria-label={running ? (paused ? 'Resume' : 'Pause') : 'Start'}
                    >
                        {running ? (paused ? 'Resume' : 'Pause') : 'Start'}
                    </button>
                </div>
            )}

            {/* MOBILE gamepad */}
            <div className="sm:hidden absolute inset-x-0 bottom-2 flex justify-between px-3 gap-3 select-none">
                <PadButton label="◀"
                    onDown={() => { sharedSound.unlock(); keyRef.current.left = true }}
                    onUp={() => { keyRef.current.left = false }}
                />
                <PadButton label="●"
                    onDown={() => { sharedSound.unlock(); keyRef.current.fire = true; pointerRef.current.firing = true }}
                    onUp={() => { keyRef.current.fire = false; pointerRef.current.firing = false }}
                />
                <PadButton label="▶"
                    onDown={() => { sharedSound.unlock(); keyRef.current.right = true }}
                    onUp={() => { keyRef.current.right = false }}
                />
            </div>

            {/* Start hint */}
            {!running && !inputLock && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <div className="px-4 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200 text-sm shadow-glow">
                        Press <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 rounded">Space</kbd> / <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 rounded">Enter</kbd> or tap <em>Start</em>
                    </div>
                </div>
            )}
        </div>
    )
})

export default Arcadia

/* Mobile pad button */
function PadButton({ label, onDown, onUp }) {
    return (
        <button
            className="flex-1 max-w-[33%] py-3 rounded-xl bg-slate-900/70 border border-slate-700 text-slate-200 text-2xl active:scale-95"
            onPointerDown={(e) => { e.preventDefault(); onDown?.() }}
            onPointerUp={() => onUp?.()}
            onPointerCancel={() => onUp?.()}
            onPointerLeave={() => onUp?.()}
            aria-label={label}
        >
            {label}
        </button>
    )
}
