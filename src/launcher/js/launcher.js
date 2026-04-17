/* ============================================
   VOID SURVIVORS — Launcher Logic
   Tabs, settings, particle bg, play flow
   ============================================ */

(function () {
    'use strict';

    // --- Tab Navigation ---
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabs = document.querySelectorAll('.tab-content');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabs.forEach(t => {
                t.classList.remove('active');
                if (t.id === `tab-${target}`) t.classList.add('active');
            });
        });
    });

    // --- Settings Persistence ---
    const SETTINGS_KEY = 'void_survivors_settings';
    const defaultSettings = {
        masterVol: 70,
        sfxVol: 80,
        musicVol: 50,
        screenShake: true,
        dmgNumbers: true,
        particles: 'high'
    };

    function loadSettings() {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            return saved ? { ...defaultSettings, ...JSON.parse(saved) } : { ...defaultSettings };
        } catch (e) {
            return { ...defaultSettings };
        }
    }

    function saveSettings(settings) {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* silent */ }
    }

    const settings = loadSettings();

    // Apply to UI
    function applySettingsToUI() {
        const el = (id) => document.getElementById(id);
        el('setting-master-vol').value = settings.masterVol;
        el('val-master-vol').textContent = settings.masterVol + '%';
        el('setting-sfx-vol').value = settings.sfxVol;
        el('val-sfx-vol').textContent = settings.sfxVol + '%';
        el('setting-music-vol').value = settings.musicVol;
        el('val-music-vol').textContent = settings.musicVol + '%';
        el('setting-screenshake').checked = settings.screenShake;
        el('setting-dmgnumbers').checked = settings.dmgNumbers;
        el('setting-particles').value = settings.particles;
    }
    applySettingsToUI();

    // Range sliders
    ['master-vol', 'sfx-vol', 'music-vol'].forEach(id => {
        const input = document.getElementById(`setting-${id}`);
        const display = document.getElementById(`val-${id}`);
        const key = id === 'master-vol' ? 'masterVol' : id === 'sfx-vol' ? 'sfxVol' : 'musicVol';
        input.addEventListener('input', () => {
            const v = parseInt(input.value);
            display.textContent = v + '%';
            settings[key] = v;
            saveSettings(settings);
        });
    });

    // Toggles
    document.getElementById('setting-screenshake').addEventListener('change', function () {
        settings.screenShake = this.checked;
        saveSettings(settings);
    });
    document.getElementById('setting-dmgnumbers').addEventListener('change', function () {
        settings.dmgNumbers = this.checked;
        saveSettings(settings);
    });
    document.getElementById('setting-particles').addEventListener('change', function () {
        settings.particles = this.value;
        saveSettings(settings);
    });

    // --- Stats Display ---
    const STATS_KEY = 'void_survivors_stats';

    function loadStats() {
        try {
            const saved = localStorage.getItem(STATS_KEY);
            return saved ? JSON.parse(saved) : { bestTime: 0, totalKills: 0, runs: 0, maxLevel: 0 };
        } catch (e) {
            return { bestTime: 0, totalKills: 0, runs: 0, maxLevel: 0 };
        }
    }

    function displayStats() {
        const stats = loadStats();
        const minutes = Math.floor(stats.bestTime / 60);
        const seconds = Math.floor(stats.bestTime % 60);
        document.getElementById('stat-highscore').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        document.getElementById('stat-kills').textContent = stats.totalKills.toLocaleString();
        document.getElementById('stat-runs').textContent = stats.runs.toString();
        document.getElementById('stat-maxlevel').textContent = stats.maxLevel.toString();
    }
    displayStats();

    // --- Play Button ---
    const loadingMessages = [
        'Initializing void engine...',
        'Generating enemy swarms...',
        'Calibrating weapon systems...',
        'Opening dimensional rift...',
        'Loading particle effects...',
        'Preparing the void...',
        'Almost there...',
        'ENTERING THE VOID!'
    ];

    function startLoading() {
        const screen = document.getElementById('loading-screen');
        const bar = document.getElementById('loading-bar');
        const text = document.getElementById('loading-text');
        screen.classList.add('active');

        let progress = 0;
        let msgIdx = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15 + 5;
            if (progress > 100) progress = 100;
            bar.style.width = progress + '%';

            if (progress > (msgIdx + 1) * (100 / loadingMessages.length)) {
                msgIdx = Math.min(msgIdx + 1, loadingMessages.length - 1);
                text.textContent = loadingMessages[msgIdx];
            }

            if (progress >= 100) {
                clearInterval(interval);
                setTimeout(() => {
                    window.location.href = '../game/game.html';
                }, 600);
            }
        }, 200);
    }

    document.getElementById('btn-play').addEventListener('click', startLoading);
    document.getElementById('btn-play-library')?.addEventListener('click', startLoading);

    // --- Hero Particle Background ---
    function initHeroParticles() {
        const canvas = document.getElementById('hero-particles');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        function resize() {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
        }
        resize();
        window.addEventListener('resize', resize);

        const particles = [];
        const count = 80;
        const w = () => canvas.width / window.devicePixelRatio;
        const h = () => canvas.height / window.devicePixelRatio;

        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * 1200,
                y: Math.random() * 500,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                r: Math.random() * 2 + 0.5,
                alpha: Math.random() * 0.5 + 0.1,
                color: Math.random() > 0.5 ? '0, 240, 255' : '183, 68, 255'
            });
        }

        function drawParticles() {
            ctx.clearRect(0, 0, w(), h());
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0) p.x = w();
                if (p.x > w()) p.x = 0;
                if (p.y < 0) p.y = h();
                if (p.y > h()) p.y = 0;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
                ctx.fill();

                // Glow
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${p.color}, ${p.alpha * 0.15})`;
                ctx.fill();
            });

            // Draw connections
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(0, 240, 255, ${0.06 * (1 - dist / 120)})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }
            requestAnimationFrame(drawParticles);
        }
        drawParticles();
    }
    initHeroParticles();

    // --- Card Particles (Library) ---
    function initCardParticles() {
        const canvas = document.getElementById('card-particles');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = 220 * 2;
        canvas.height = 140 * 2;
        ctx.scale(2, 2);

        const dots = [];
        for (let i = 0; i < 20; i++) {
            dots.push({
                x: Math.random() * 220,
                y: Math.random() * 140,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                r: Math.random() * 1.5 + 0.5,
                color: Math.random() > 0.5 ? '0, 240, 255' : '183, 68, 255'
            });
        }

        function draw() {
            ctx.clearRect(0, 0, 220, 140);
            dots.forEach(d => {
                d.x += d.vx;
                d.y += d.vy;
                if (d.x < 0 || d.x > 220) d.vx *= -1;
                if (d.y < 0 || d.y > 140) d.vy *= -1;
                ctx.beginPath();
                ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${d.color}, 0.5)`;
                ctx.fill();
            });
            requestAnimationFrame(draw);
        }
        draw();
    }
    initCardParticles();

    // Refresh stats when page regains focus (returning from game)
    window.addEventListener('focus', displayStats);

})();
