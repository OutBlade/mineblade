/* ============================================
   VOID SURVIVORS — Weapon System
   6 weapon types with upgrade levels
   ============================================ */

class Projectile {
    constructor(x, y, vx, vy, damage, radius, color, life = 2, pierce = 1) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.damage = damage;
        this.radius = radius;
        this.color = color;
        this.life = life;
        this.maxLife = life;
        this.pierce = pierce;
        this.hitEnemies = new Set();
        this.dead = false;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        if (this.life <= 0) this.dead = true;
    }

    render(ctx) {
        if (this.dead) return;
        const alpha = Math.min(1, this.life / this.maxLife * 2);
        ctx.globalAlpha = alpha;
        ctx.shadowBlur = this.radius * 2;
        ctx.shadowColor = this.color;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }

    onHit() {
        this.pierce--;
        if (this.pierce <= 0) this.dead = true;
    }
}

// --- Base Weapon ---
class Weapon {
    constructor(type, level = 1) {
        this.type = type;
        this.level = level;
        this.cooldownTimer = 0;
        this.stats = this.getStats();
    }

    getStats() { return { damage: 10, cooldown: 1, area: 1, count: 1 }; }

    upgrade() {
        this.level++;
        this.stats = this.getStats();
    }

    update(dt, player, enemies, projectiles, particles) {
        this.cooldownTimer -= dt;
        if (this.cooldownTimer <= 0) {
            this.fire(player, enemies, projectiles, particles);
            this.cooldownTimer = this.stats.cooldown * (player.cdMultiplier || 1);
        }
    }

    fire(player, enemies, projectiles, particles) {}

    findNearest(player, enemies, count = 1) {
        if (enemies.length === 0) return [];
        const sorted = enemies
            .map(e => ({ e, dist: Math.hypot(e.x - player.x, e.y - player.y) }))
            .sort((a, b) => a.dist - b.dist);
        return sorted.slice(0, count).map(s => s.e);
    }
}

// --- Void Whip ---
class VoidWhip extends Weapon {
    constructor(level) { super('voidWhip', level); }
    getStats() {
        const l = this.level;
        return { damage: 18 + l * 8, cooldown: Math.max(0.4, 1.2 - l * 0.12), area: 1 + l * 0.15, count: Math.min(l, 3), arc: 90 + l * 15 };
    }
    fire(player, enemies, projectiles, particles) {
        if (enemies.length === 0) return;
        const nearest = this.findNearest(player, enemies, 1)[0];
        const baseAngle = Math.atan2(nearest.y - player.y, nearest.x - player.x);
        const arcRad = (this.stats.arc / 2) * Math.PI / 180;
        const range = 80 * this.stats.area * (player.areaMultiplier || 1);
        const dmg = this.stats.damage * (player.damageMultiplier || 1);

        for (let i = 0; i < this.stats.count; i++) {
            const offset = this.stats.count > 1 ? (i / (this.stats.count - 1) - 0.5) * Math.PI : 0;
            // Damage enemies in arc
            enemies.forEach(e => {
                const dist = Math.hypot(e.x - player.x, e.y - player.y);
                if (dist > range) return;
                const angle = Math.atan2(e.y - player.y, e.x - player.x);
                let diff = angle - (baseAngle + offset);
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                if (Math.abs(diff) < arcRad) {
                    e.takeDamage(dmg);
                    particles.sparkle(e.x, e.y, '#b744ff', 4);
                    particles.addDamageNumber(e.x, e.y, dmg, '#cc88ff');
                }
            });
            // Visual
            for (let j = 0; j < 8; j++) {
                const a = baseAngle + offset - arcRad + (arcRad * 2 * j / 7);
                const r = range * (0.5 + Math.random() * 0.5);
                particles.trail(player.x + Math.cos(a) * r, player.y + Math.sin(a) * r, '#b744ff', 3);
            }
        }
        window.audioSystem.weaponFire();
    }
}

// --- Spirit Orbs ---
class SpiritOrbs extends Weapon {
    constructor(level) { super('spiritOrbs', level); this.angle = 0; }
    getStats() {
        const l = this.level;
        return { damage: 12 + l * 5, cooldown: 0, area: 1 + l * 0.1, count: 2 + Math.floor(l / 2), orbitRadius: 70 + l * 10, orbSpeed: 2.5 + l * 0.3 };
    }
    update(dt, player, enemies, projectiles, particles) {
        this.angle += this.stats.orbSpeed * dt;
        const orbCount = this.stats.count;
        for (let i = 0; i < orbCount; i++) {
            const a = this.angle + (Math.PI * 2 * i) / orbCount;
            const ox = player.x + Math.cos(a) * this.stats.orbitRadius * this.stats.area;
            const oy = player.y + Math.sin(a) * this.stats.orbitRadius * this.stats.area;
            // Check enemy collisions
            enemies.forEach(e => {
                if (e.invincible > 0) return;
                const dist = Math.hypot(e.x - ox, e.y - oy);
                if (dist < e.radius + 10) {
                    e.takeDamage(this.stats.damage * (player.damageMultiplier || 1) * dt * 3);
                    e.invincible = 0.15;
                    particles.trail(ox, oy, '#00f0ff', 2);
                }
            });
        }
    }
    render(ctx, player) {
        const orbCount = this.stats.count;
        for (let i = 0; i < orbCount; i++) {
            const a = this.angle + (Math.PI * 2 * i) / orbCount;
            const ox = player.x + Math.cos(a) * this.stats.orbitRadius * this.stats.area;
            const oy = player.y + Math.sin(a) * this.stats.orbitRadius * this.stats.area;
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#00f0ff';
            ctx.fillStyle = '#00f0ff';
            ctx.beginPath();
            ctx.arc(ox, oy, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

// --- Lightning ---
class Lightning extends Weapon {
    constructor(level) { super('lightning', level); this.chains = []; }
    getStats() {
        const l = this.level;
        return { damage: 25 + l * 12, cooldown: Math.max(0.6, 1.8 - l * 0.2), area: 1, count: 1 + Math.floor(l / 2), chainRange: 120 + l * 20 };
    }
    fire(player, enemies, projectiles, particles) {
        if (enemies.length === 0) return;
        const nearest = this.findNearest(player, enemies, 1)[0];
        const dmg = this.stats.damage * (player.damageMultiplier || 1);
        this.chains = [{ x1: player.x, y1: player.y, x2: nearest.x, y2: nearest.y, life: 0.2 }];
        nearest.takeDamage(dmg);
        particles.sparkle(nearest.x, nearest.y, '#88ddff', 6);
        particles.addDamageNumber(nearest.x, nearest.y, dmg, '#88ddff');
        window.audioSystem.weaponFire();

        // Chain to nearby enemies
        let lastTarget = nearest;
        const hit = new Set([nearest]);
        for (let c = 0; c < this.stats.count; c++) {
            let best = null, bestDist = this.stats.chainRange;
            enemies.forEach(e => {
                if (hit.has(e)) return;
                const d = Math.hypot(e.x - lastTarget.x, e.y - lastTarget.y);
                if (d < bestDist) { bestDist = d; best = e; }
            });
            if (best) {
                this.chains.push({ x1: lastTarget.x, y1: lastTarget.y, x2: best.x, y2: best.y, life: 0.2 });
                best.takeDamage(dmg * 0.8);
                particles.sparkle(best.x, best.y, '#88ddff', 4);
                hit.add(best);
                lastTarget = best;
            }
        }
    }
    update(dt, player, enemies, projectiles, particles) {
        this.cooldownTimer -= dt;
        if (this.cooldownTimer <= 0) {
            this.fire(player, enemies, projectiles, particles);
            this.cooldownTimer = this.stats.cooldown * (player.cdMultiplier || 1);
        }
        this.chains = this.chains.filter(c => { c.life -= dt; return c.life > 0; });
    }
    render(ctx) {
        this.chains.forEach(c => {
            const alpha = c.life / 0.2;
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = '#88ddff';
            ctx.lineWidth = 2;
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#88ddff';
            ctx.beginPath();
            // Jagged lightning
            const dx = c.x2 - c.x1, dy = c.y2 - c.y1;
            const steps = 6;
            ctx.moveTo(c.x1, c.y1);
            for (let i = 1; i < steps; i++) {
                const t = i / steps;
                ctx.lineTo(
                    c.x1 + dx * t + (Math.random() - 0.5) * 15,
                    c.y1 + dy * t + (Math.random() - 0.5) * 15
                );
            }
            ctx.lineTo(c.x2, c.y2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        });
    }
}

// --- Flame Ring ---
class FlameRing extends Weapon {
    constructor(level) { super('flameRing', level); this.rings = []; }
    getStats() {
        const l = this.level;
        return { damage: 15 + l * 6, cooldown: Math.max(1, 3 - l * 0.3), area: 1 + l * 0.15, count: 1, maxRadius: 120 + l * 25 };
    }
    fire(player, enemies, projectiles, particles) {
        this.rings.push({ x: player.x, y: player.y, radius: 10, maxRadius: this.stats.maxRadius * this.stats.area, hitEnemies: new Set(), damage: this.stats.damage });
        window.audioSystem.weaponFire();
    }
    update(dt, player, enemies, projectiles, particles) {
        this.cooldownTimer -= dt;
        if (this.cooldownTimer <= 0) {
            this.fire(player, enemies, projectiles, particles);
            this.cooldownTimer = this.stats.cooldown * (player.cdMultiplier || 1);
        }
        this.rings = this.rings.filter(ring => {
            ring.radius += 200 * dt;
            enemies.forEach(e => {
                if (ring.hitEnemies.has(e)) return;
                const dist = Math.hypot(e.x - ring.x, e.y - ring.y);
                if (Math.abs(dist - ring.radius) < 20) {
                    e.takeDamage(ring.damage * (player.damageMultiplier || 1));
                    ring.hitEnemies.add(e);
                    particles.trail(e.x, e.y, '#ff6622', 3);
                }
            });
            return ring.radius < ring.maxRadius;
        });
    }
    render(ctx) {
        this.rings.forEach(ring => {
            const alpha = 1 - ring.radius / ring.maxRadius;
            ctx.globalAlpha = alpha * 0.7;
            ctx.strokeStyle = '#ff6622';
            ctx.lineWidth = 4;
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#ff6622';
            ctx.beginPath();
            ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        });
    }
}

// --- Frost Nova ---
class FrostNova extends Weapon {
    constructor(level) { super('frostNova', level); this.novas = []; }
    getStats() {
        const l = this.level;
        return { damage: 20 + l * 8, cooldown: Math.max(1.5, 4 - l * 0.4), area: 1 + l * 0.15, count: 1, radius: 100 + l * 20, freezeDuration: 0.5 + l * 0.2 };
    }
    fire(player, enemies, projectiles, particles) {
        const r = this.stats.radius * this.stats.area;
        this.novas.push({ x: player.x, y: player.y, radius: r, life: 0.3 });
        const dmg = this.stats.damage * (player.damageMultiplier || 1);
        enemies.forEach(e => {
            const dist = Math.hypot(e.x - player.x, e.y - player.y);
            if (dist < r) {
                e.takeDamage(dmg);
                e.freeze(this.stats.freezeDuration);
                particles.sparkle(e.x, e.y, '#aaddff', 5);
            }
        });
        particles.burst(player.x, player.y, '#88ccff', 15);
        window.audioSystem.weaponFire();
    }
    update(dt, player, enemies, projectiles, particles) {
        this.cooldownTimer -= dt;
        if (this.cooldownTimer <= 0) {
            this.fire(player, enemies, projectiles, particles);
            this.cooldownTimer = this.stats.cooldown * (player.cdMultiplier || 1);
        }
        this.novas = this.novas.filter(n => { n.life -= dt; return n.life > 0; });
    }
    render(ctx) {
        this.novas.forEach(n => {
            const alpha = n.life / 0.3;
            ctx.globalAlpha = alpha * 0.3;
            ctx.fillStyle = '#88ccff';
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#88ccff';
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        });
    }
}

// --- Shadow Daggers ---
class ShadowDaggers extends Weapon {
    constructor(level) { super('shadowDaggers', level); }
    getStats() {
        const l = this.level;
        return { damage: 8 + l * 4, cooldown: Math.max(0.15, 0.5 - l * 0.06), area: 1, count: 1 + Math.floor(l / 3), pierce: Math.floor(l / 2), speed: 400 + l * 50 };
    }
    fire(player, enemies, projectiles, particles) {
        if (enemies.length === 0) return;
        const targets = this.findNearest(player, enemies, this.stats.count);
        targets.forEach(target => {
            const angle = Math.atan2(target.y - player.y, target.x - player.x);
            projectiles.push(new Projectile(
                player.x, player.y,
                Math.cos(angle) * this.stats.speed,
                Math.sin(angle) * this.stats.speed,
                this.stats.damage * (player.damageMultiplier || 1),
                4,
                '#aa44ff',
                1.5,
                1 + this.stats.pierce
            ));
        });
        window.audioSystem.weaponFire();
    }
}

// Weapon factory
function createWeapon(type, level = 1) {
    switch (type) {
        case 'voidWhip': return new VoidWhip(level);
        case 'spiritOrbs': return new SpiritOrbs(level);
        case 'lightning': return new Lightning(level);
        case 'flameRing': return new FlameRing(level);
        case 'frostNova': return new FrostNova(level);
        case 'shadowDaggers': return new ShadowDaggers(level);
        default: return new VoidWhip(level);
    }
}

window.createWeapon = createWeapon;
window.Projectile = Projectile;
window.VoidWhip = VoidWhip;
window.SpiritOrbs = SpiritOrbs;
window.Lightning = Lightning;
window.FlameRing = FlameRing;
window.FrostNova = FrostNova;
window.ShadowDaggers = ShadowDaggers;
