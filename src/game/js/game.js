/* ============================================
   VOID SURVIVORS — Core Game Engine
   Game loop, camera, collisions, rendering,
   state management, HUD updates
   ============================================ */

(function () {
    'use strict';

    // --- Settings ---
    let gameSettings = {};
    try {
        gameSettings = JSON.parse(localStorage.getItem('void_survivors_settings') || '{}');
    } catch (e) { gameSettings = {}; }

    const SCREEN_SHAKE = gameSettings.screenShake !== false;
    const DMG_NUMBERS = gameSettings.dmgNumbers !== false;
    const PARTICLE_QUALITY = gameSettings.particles || 'high';

    // --- Game Class ---
    class Game {
        constructor() {
            this.canvas = document.getElementById('game-canvas');
            this.ctx = this.canvas.getContext('2d');
            this.resize();
            window.addEventListener('resize', () => this.resize());

            // Systems
            this.particles = new ParticleSystem();
            this.particles.setQuality(PARTICLE_QUALITY);
            this.upgradeSystem = new UpgradeSystem();
            this.spawner = new Spawner();

            // State
            this.state = 'charselect'; // charselect, playing, paused, levelup, gameover
            this.player = null;
            this.enemies = [];
            this.projectiles = [];
            this.xpGems = [];
            this.lootItems = [];
            this.gameTime = 0;
            this.kills = 0;
            this.pendingUpgradeChoices = [];

            // Background Parallax Stars
            this.stars = [];
            for (let i = 0; i < 200; i++) {
                this.stars.push({
                    x: Math.random() * window.innerWidth * 3 - window.innerWidth,
                    y: Math.random() * window.innerHeight * 3 - window.innerHeight,
                    size: Math.random() * 2 + 0.5,
                    depth: Math.random() * 0.8 + 0.2, // 0.2 is far, 1.0 is near
                    color: Math.random() > 0.8 ? '#88ccff' : Math.random() > 0.6 ? '#ffaaaa' : '#ffffff'
                });
            }

            // Camera
            this.camera = { x: 0, y: 0, shakeIntensity: 0, shakeX: 0, shakeY: 0 };

            // Input
            this.keys = {};
            this.setupInput();
            this.setupUI();

            // Timing
            this.lastTime = 0;
            this.running = false;

            // Init audio on first interaction
            this.audioInitialized = false;
        }

        resize() {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }

        setupInput() {
            window.addEventListener('keydown', (e) => {
                this.keys[e.key.toLowerCase()] = true;

                if (!this.audioInitialized) {
                    window.audioSystem.init();
                    this.audioInitialized = true;
                }

                if (e.key === 'Escape') {
                    if (this.state === 'playing') this.pause();
                    else if (this.state === 'paused') this.resume();
                }

                if (this.state === 'levelup') {
                    if (e.key === '1') this.selectUpgrade(0);
                    if (e.key === '2') this.selectUpgrade(1);
                    if (e.key === '3') this.selectUpgrade(2);
                }
            });
            window.addEventListener('keyup', (e) => {
                this.keys[e.key.toLowerCase()] = false;
            });
        }

        setupUI() {
            // Character Select
            document.querySelectorAll('.char-card').forEach(card => {
                card.addEventListener('click', () => {
                    if (!this.audioInitialized) {
                        window.audioSystem.init();
                        this.audioInitialized = true;
                    }
                    const cls = card.dataset.class;
                    this.startGame(cls);
                });
            });

            // Pause
            document.getElementById('btn-resume').addEventListener('click', () => this.resume());
            document.getElementById('btn-quit').addEventListener('click', () => {
                window.location.href = '../launcher/index.html';
            });

            // Game Over
            document.getElementById('btn-retry').addEventListener('click', () => {
                this.showScreen('charselect');
            });
            document.getElementById('btn-launcher').addEventListener('click', () => {
                window.location.href = '../launcher/index.html';
            });
        }

        showScreen(name) {
            document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
            document.getElementById('hud').style.display = 'none';
            document.getElementById('modal-pause').style.display = 'none';
            document.getElementById('modal-levelup').style.display = 'none';

            switch (name) {
                case 'charselect':
                    this.state = 'charselect';
                    this.running = false;
                    const cs = document.getElementById('screen-charselect');
                    cs.style.display = 'flex';
                    cs.classList.add('active');
                    break;
                case 'playing':
                    this.state = 'playing';
                    document.getElementById('hud').style.display = 'block';
                    break;
                case 'gameover':
                    this.state = 'gameover';
                    const go = document.getElementById('screen-gameover');
                    go.style.display = 'flex';
                    go.classList.add('active');
                    break;
            }
        }

        startGame(characterClass) {
            this.player = new Player(characterClass);
            this.enemies = [];
            this.projectiles = [];
            this.xpGems = [];
            this.lootItems = [];
            this.gameTime = 0;
            this.kills = 0;
            this.upgradeSystem.reset();
            this.spawner.reset();
            this.particles.clear();
            this.camera = { x: 0, y: 0, shakeIntensity: 0, shakeX: 0, shakeY: 0 };
            this.keys = {};

            this.showScreen('playing');
            this.running = true;
            this.lastTime = performance.now();

            window.audioSystem.startMusic();
            this.gameLoop(performance.now());
        }

        pause() {
            this.state = 'paused';
            document.getElementById('modal-pause').style.display = 'flex';
        }

        resume() {
            this.state = 'playing';
            document.getElementById('modal-pause').style.display = 'none';
            this.lastTime = performance.now();
        }

        gameOver() {
            this.state = 'gameover';
            this.running = false;
            window.audioSystem.stopMusic();
            window.audioSystem.gameOver();

            const mins = Math.floor(this.gameTime / 60);
            const secs = Math.floor(this.gameTime % 60);
            document.getElementById('go-time').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            document.getElementById('go-kills').textContent = this.kills.toString();
            document.getElementById('go-level').textContent = this.player.level.toString();
            document.getElementById('go-weapons').textContent = this.player.weapons.length.toString();

            this.saveStats();
            setTimeout(() => this.showScreen('gameover'), 800);
        }

        saveStats() {
            try {
                const saved = JSON.parse(localStorage.getItem('void_survivors_stats') || '{}');
                saved.bestTime = Math.max(saved.bestTime || 0, this.gameTime);
                saved.totalKills = (saved.totalKills || 0) + this.kills;
                saved.runs = (saved.runs || 0) + 1;
                saved.maxLevel = Math.max(saved.maxLevel || 0, this.player.level);
                localStorage.setItem('void_survivors_stats', JSON.stringify(saved));
            } catch (e) { }
        }

        triggerLevelUp() {
            this.state = 'levelup';
            this.pendingUpgradeChoices = this.upgradeSystem.generateChoices(this.player.weapons);
            window.audioSystem.levelUp();
            this.particles.levelUpBurst(this.player.x, this.player.y);

            this.screenFlash('#44ff88', 0.3);

            const container = document.getElementById('upgrade-cards');
            container.innerHTML = '';
            document.getElementById('levelup-level').textContent = `Level ${this.player.level}! Choose an upgrade:`;

            this.pendingUpgradeChoices.forEach((choice, idx) => {
                const card = document.createElement('div');
                card.className = 'upgrade-card' + (choice.rarity === 'legendary' ? ' legendary' : '');
                card.innerHTML = `
                    <div class="upgrade-card-key">${idx + 1}</div>
                    <div class="upgrade-icon">${choice.icon}</div>
                    <div class="upgrade-name">${choice.name}</div>
                    <div class="upgrade-desc">${choice.desc}</div>
                `;
                card.addEventListener('click', () => this.selectUpgrade(idx));
                container.appendChild(card);
            });

            document.getElementById('modal-levelup').style.display = 'flex';
        }

        selectUpgrade(index) {
            if (this.state !== 'levelup') return;
            if (index >= this.pendingUpgradeChoices.length) return;

            const choice = this.pendingUpgradeChoices[index];

            switch (choice.type) {
                case 'newWeapon':
                    this.player.weapons.push(window.createWeapon(choice.weaponType));
                    break;
                case 'weaponUpgrade':
                    const weapon = this.player.weapons.find(w => w.type === choice.weaponType);
                    if (weapon) weapon.upgrade();
                    break;
                case 'passive':
                    this.upgradeSystem.applyPassive(choice.passiveKey);
                    this.player.applyPassives(this.upgradeSystem);
                    break;
            }

            this.updateWeaponSlots();
            document.getElementById('modal-levelup').style.display = 'none';
            this.state = 'playing';
            this.lastTime = performance.now();
        }

        gameLoop(timestamp) {
            if (!this.running) return;
            const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
            this.lastTime = timestamp;

            if (this.state === 'playing') {
                this.update(dt);
            }
            this.render();

            requestAnimationFrame(t => this.gameLoop(t));
        }

        triggerBomb() {
            window.audioSystem.explosion();
            this.addScreenShake(15);
            this.screenFlash('#ffffff', 0.2);
            this.particles.addShockwave(this.player.x, this.player.y, '#ffffff', 800, 0.8);
            
            this.enemies.forEach(e => {
                if(!e.isBoss) {
                    e.takeDamage(9999);
                } else {
                    e.takeDamage(500 * this.player.damageMultiplier);
                }
            });
        }

        update(dt) {
            this.gameTime += dt;

            // Player
            this.player.update(dt, this.keys);

            // Camera
            this.updateCamera(dt);

            // Weapons
            this.player.weapons.forEach(w => {
                w.update(dt, this.player, this.enemies, this.projectiles, this.particles);
            });

            // Enemies
            this.spawner.update(dt, this.enemies, this.player);
            this.enemies.forEach(e => e.update(dt, this.player));

            // Projectiles
            this.projectiles.forEach(p => p.update(dt));

            // XP Gems
            this.xpGems.forEach(gem => {
                const xpGained = gem.update(dt, this.player, this.gameTime);
                if (xpGained > 0) {
                    this.player.addXP(xpGained);
                    this.particles.sparkle(gem.x, gem.y, gem.color, 3);
                    window.audioSystem.pickup();
                }
            });

            // Loot Items
            this.player.hasSuperMagnet = false;
            this.lootItems.forEach(loot => {
                const pickedUp = loot.update(dt, this.player);
                if (pickedUp) {
                    window.audioSystem.pickup();
                    if (pickedUp === 'bomb') {
                        this.triggerBomb();
                    } else if (pickedUp === 'magnet') {
                        this.player.hasSuperMagnet = true;
                        this.screenFlash('#ffff00', 0.1);
                        this.particles.addShockwave(this.player.x, this.player.y, '#ffff00', 400, 0.3);
                    }
                }
            });

            // Collisions
            this.checkCollisions();

            // Check level up
            if (this.player.checkLevelUp(this.upgradeSystem)) {
                this.triggerLevelUp();
                return; 
            }

            // Particles
            this.particles.update(dt);

            // Cleanup & Drops
            this.enemies = this.enemies.filter(e => {
                if (e.dead) {
                    this.kills++;
                    this.particles.explosion(e.x, e.y, e.color, e.isBoss ? 25 : 10);
                    if (DMG_NUMBERS) {
                        this.particles.addDamageNumber(e.x, e.y, e.xpValue + ' XP', '#aaff00');
                    }
                    window.audioSystem.enemyDeath();
                    // Drops
                    const gemCount = e.isBoss ? 10 : (e.xpValue >= 3 ? 2 : 1);
                    for (let i = 0; i < gemCount; i++) {
                        this.xpGems.push(new XPGem(
                            e.x + (Math.random() - 0.5) * 20,
                            e.y + (Math.random() - 0.5) * 20,
                            Math.ceil(e.xpValue / gemCount)
                        ));
                    }
                    // Loot Drops (2% chance for normies, 100% for boss)
                    if (e.isBoss || Math.random() < 0.02) {
                        this.lootItems.push(new LootItem(e.x, e.y, Math.random() > 0.5 ? 'bomb' : 'magnet'));
                    }
                    return false;
                }
                return true;
            });
            this.projectiles = this.projectiles.filter(p => !p.dead);
            this.xpGems = this.xpGems.filter(g => !g.collected);
            this.lootItems = this.lootItems.filter(l => !l.collected);

            // Check player death
            if (this.player.hp <= 0) {
                this.gameOver();
                return;
            }

            this.updateHUD();
        }

        checkCollisions() {
            // Projectiles vs Enemies
            this.projectiles.forEach(proj => {
                if (proj.dead) return;
                this.enemies.forEach(enemy => {
                    if (enemy.dead || proj.hitEnemies.has(enemy)) return;
                    const dist = Math.hypot(proj.x - enemy.x, proj.y - enemy.y);
                    if (dist < proj.radius + enemy.radius) {
                        const dmg = proj.damage * this.player.damageMultiplier;
                        enemy.takeDamage(dmg);
                        proj.hitEnemies.add(enemy);
                        proj.onHit();
                        if (DMG_NUMBERS) {
                            this.particles.addDamageNumber(enemy.x, enemy.y - 10, dmg, '#ffffff');
                        }
                        this.particles.sparkle(proj.x, proj.y, proj.color, 3);
                        window.audioSystem.hit();
                        if (SCREEN_SHAKE) this.addScreenShake(2);
                    }
                });
            });

            // Enemies vs Player (skip during dash invincible)
            this.enemies.forEach(enemy => {
                if (enemy.dead) return;
                const dist = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
                if (dist < enemy.radius + this.player.radius) {
                    if (this.player.takeDamage(enemy.damage)) {
                        if (SCREEN_SHAKE) this.addScreenShake(8);
                        this.screenFlash('#ff2244', 0.15);
                        if (DMG_NUMBERS) {
                            this.particles.addDamageNumber(
                                this.player.x, this.player.y - 20,
                                Math.max(1, enemy.damage - this.player.armor),
                                '#ff4466'
                            );
                        }
                        const angle = Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x);
                        enemy.knockbackVx = Math.cos(angle) * 200;
                        enemy.knockbackVy = Math.sin(angle) * 200;
                    }
                }
            });
        }

        updateCamera(dt) {
            this.camera.x += (this.player.x - this.camera.x) * 5 * dt;
            this.camera.y += (this.player.y - this.camera.y) * 5 * dt;

            if (this.camera.shakeIntensity > 0) {
                this.camera.shakeX = (Math.random() - 0.5) * this.camera.shakeIntensity * 2;
                this.camera.shakeY = (Math.random() - 0.5) * this.camera.shakeIntensity * 2;
                this.camera.shakeIntensity *= 0.88;
                if (this.camera.shakeIntensity < 0.3) this.camera.shakeIntensity = 0;
            } else {
                this.camera.shakeX = 0;
                this.camera.shakeY = 0;
            }
        }

        addScreenShake(intensity) {
            this.camera.shakeIntensity = Math.min(20, this.camera.shakeIntensity + intensity);
        }

        screenFlash(color, duration) {
            const flash = document.getElementById('screen-flash');
            flash.style.background = color;
            flash.classList.remove('active');
            void flash.offsetWidth; 
            flash.classList.add('active');
            setTimeout(() => flash.classList.remove('active'), duration * 1000);
        }

        render() {
            const ctx = this.ctx;
            const w = this.canvas.width;
            const h = this.canvas.height;

            // Clear Background
            ctx.globalCompositeOperation = 'source-over'; // Reset blending for clear
            ctx.fillStyle = '#03010b'; // Deep void color
            ctx.fillRect(0, 0, w, h);

            if (!this.player) return;

            // Overhaul Graphic Blending: Additive blending makes everything neon!
            ctx.globalCompositeOperation = 'lighter'; 

            ctx.save();
            const cx = -this.camera.x + w / 2 + this.camera.shakeX;
            const cy = -this.camera.y + h / 2 + this.camera.shakeY;
            
            // Draw Parallax Starfield (unscaled)
            this.renderStarfield(ctx, w, h);

            // Apply camera transform for world entities
            ctx.translate(cx, cy);

            this.xpGems.forEach(gem => gem.render(ctx, this.gameTime));
            this.lootItems.forEach(loot => loot.render(ctx, this.gameTime));
            this.enemies.forEach(e => e.render(ctx));

            this.player.weapons.forEach(w => {
                if (w.render) w.render(ctx, this.player);
            });

            this.player.render(ctx);
            this.projectiles.forEach(p => p.render(ctx));

            this.particles.render(ctx);

            // Damage numbers need standard blending so they are readable
            ctx.globalCompositeOperation = 'source-over';
            this.particles.renderDamageNumbers(ctx);

            ctx.restore();
            
            // UI Overlay always overlaps perfectly
            ctx.globalCompositeOperation = 'source-over';

            const boss = this.enemies.find(e => e.isBoss);
            if (boss) {
                this.renderBossHP(ctx, boss, w);
            }
        }

        renderStarfield(ctx, w, h) {
            this.stars.forEach(star => {
                // Parallax shift
                let sx = ((star.x - this.camera.x * star.depth) % w);
                let sy = ((star.y - this.camera.y * star.depth) % h);
                
                // Wrap around logic
                if (sx < 0) sx += w;
                if (sy < 0) sy += h;

                ctx.globalAlpha = star.depth;
                ctx.fillStyle = star.color;
                ctx.beginPath();
                ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalAlpha = 1;
        }

        renderBossHP(ctx, boss, screenW) {
            const barW = 300;
            const barH = 8;
            const x = (screenW - barW) / 2;
            const y = 60;

            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(x - 2, y - 2, barW + 4, barH + 4);

            ctx.fillStyle = '#ff0044';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ff0044';
            ctx.fillRect(x, y, barW * (boss.hp / boss.maxHp), barH);
            ctx.shadowBlur = 0;

            ctx.font = 'bold 11px Orbitron, monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffaa00';
            ctx.fillText('⚠ VOID LORD ⚠', screenW / 2, y - 8);
        }

        updateHUD() {
            const hpPct = Math.max(0, this.player.hp / this.player.maxHp * 100);
            document.getElementById('hp-bar').style.width = hpPct + '%';
            document.getElementById('hp-text').textContent =
                `${Math.ceil(this.player.hp)} / ${Math.ceil(this.player.maxHp)}`;

            const xpPct = this.player.getXPProgress(this.upgradeSystem) * 100;
            document.getElementById('xp-bar').style.width = xpPct + '%';
            document.getElementById('xp-text').textContent = `Lv. ${this.player.level}`;

            const mins = Math.floor(this.gameTime / 60);
            const secs = Math.floor(this.gameTime % 60);
            document.getElementById('timer').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            document.getElementById('kill-count').textContent = this.kills.toString();
        }

        updateWeaponSlots() {
            const container = document.getElementById('weapon-slots');
            container.innerHTML = '';
            this.player.weapons.forEach(w => {
                const def = WEAPON_DEFS[w.type];
                const slot = document.createElement('div');
                slot.className = 'weapon-slot';
                slot.innerHTML = `
                    ${def.icon}
                    <div class="weapon-slot-level">${w.level}</div>
                `;
                slot.title = `${def.name} Lv.${w.level}`;
                container.appendChild(slot);
            });
        }
    }

    const game = new Game();
    const origStart = game.startGame.bind(game);
    game.startGame = function(cls) {
        origStart(cls);
        game.updateWeaponSlots();
    };

})();
