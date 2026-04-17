/* ============================================
   VOID SURVIVORS — Enemy System
   5 enemy types + Void Lord boss + Loot Drops
   ============================================ */

class XPGem {
    constructor(x, y, value) {
        this.x = x;
        this.y = y;
        this.value = value;
        this.radius = 4 + Math.min(value / 5, 4);
        this.collected = false;
        this.bobOffset = Math.random() * Math.PI * 2;
        this.color = value >= 10 ? '#00f0ff' : value >= 5 ? '#44ff88' : '#aaff00';
    }

    update(dt, player, time) {
        if (this.collected) return;
        this.bobOffset += dt * 3;
        // Magnet pull
        const dist = Math.hypot(this.x - player.x, this.y - player.y);
        const magnetRadius = player.magnetRadius;
        // Global magnet flag test
        if (player.hasSuperMagnet || dist < magnetRadius) {
            const pull = player.hasSuperMagnet ? 1500 : (1 - dist / Math.max(magnetRadius, 1)) * 600;
            const angle = Math.atan2(player.y - this.y, player.x - this.x);
            this.x += Math.cos(angle) * pull * dt;
            this.y += Math.sin(angle) * pull * dt;
        }
        // Collect
        if (dist < player.radius + this.radius + 5) {
            this.collected = true;
            return this.value;
        }
        return 0;
    }

    render(ctx, time) {
        if (this.collected) return;
        const bob = Math.sin(this.bobOffset) * 2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        
        ctx.save();
        ctx.translate(this.x, this.y + bob);
        ctx.rotate(time * 2 + this.bobOffset);
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.color;
        ctx.fillStyle = '#ffffff';
        
        ctx.beginPath();
        ctx.moveTo(0, -this.radius);
        ctx.lineTo(this.radius, 0);
        ctx.lineTo(0, this.radius);
        ctx.lineTo(-this.radius, 0);
        ctx.closePath();
        ctx.stroke();
        
        // inner core
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.restore();
    }
}

class LootItem {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 'bomb' or 'magnet'
        this.radius = 12;
        this.collected = false;
        this.timeOffset = Math.random() * 10;
        this.color = type === 'bomb' ? '#ff3300' : '#ffff00';
    }

    update(dt, player) {
        if (this.collected) return;
        this.timeOffset += dt;
        const dist = Math.hypot(this.x - player.x, this.y - player.y);
        if (dist < player.radius + this.radius + 10) {
            this.collected = true;
            return this.type;
        }
        return null;
    }

    render(ctx, time) {
        if (this.collected) return;
        const bob = Math.sin(this.timeOffset * 4) * 3;
        
        ctx.save();
        ctx.translate(this.x, this.y + bob);
        
        // Outer aura
        ctx.shadowBlur = 20 + Math.sin(this.timeOffset * 8) * 10;
        ctx.shadowColor = this.color;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        ctx.arc(0, 0, this.radius + Math.sin(this.timeOffset * 5) * 2, 0, Math.PI * 2);
        ctx.stroke();
        
        // Inner icon
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.type === 'bomb' ? '💣' : '🧲', 0, 0);
        
        ctx.restore();
    }
}

// --- Base Enemy ---
class Enemy {
    constructor(x, y, type, timeScale = 1) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.invincible = 0;
        this.freezeTimer = 0;
        this.knockbackVx = 0;
        this.knockbackVy = 0;
        this.flashTimer = 0;
        this.dead = false;
        this.id = Math.random();
        this.timeAlive = 0;
        this.applyStats(timeScale);
    }

    applyStats(ts) {
        const defs = {
            zombie:   { hp: 20, speed: 50, radius: 12, color: '#44cc44', damage: 8, xp: 1 },
            bat:      { hp: 10, speed: 120, radius: 8, color: '#ff4444', damage: 5, xp: 1 },
            skeleton: { hp: 35, speed: 70, radius: 12, color: '#cccccc', damage: 10, xp: 2 },
            ghost:    { hp: 25, speed: 90, radius: 10, color: '#9966ff', damage: 7, xp: 2 },
            demon:    { hp: 80, speed: 45, radius: 16, color: '#ff8800', damage: 15, xp: 5 },
            boss:     { hp: 500, speed: 35, radius: 40, color: '#ff0044', damage: 25, xp: 50 }
        };
        const d = defs[this.type] || defs.zombie;
        this.maxHp = d.hp * (1 + ts * 0.3);
        this.hp = this.maxHp;
        this.speed = d.speed;
        this.baseSpeed = d.speed;
        this.radius = d.radius;
        this.color = d.color;
        this.damage = d.damage * (1 + ts * 0.15);
        this.xpValue = d.xp;
        this.isBoss = this.type === 'boss';
    }

    takeDamage(amount) {
        this.hp -= amount;
        this.flashTimer = 0.1;
        this.knockbackVx += (Math.random() - 0.5) * 30;
        this.knockbackVy += (Math.random() - 0.5) * 30;
        if (this.hp <= 0) this.dead = true;
    }

    freeze(duration) {
        this.freezeTimer = Math.max(this.freezeTimer, duration);
    }

    update(dt, player) {
        if (this.dead) return;
        this.timeAlive += dt;
        this.invincible = Math.max(0, this.invincible - dt);
        this.flashTimer = Math.max(0, this.flashTimer - dt);
        this.freezeTimer = Math.max(0, this.freezeTimer - dt);

        // Knockback decay
        this.knockbackVx *= 0.9;
        this.knockbackVy *= 0.9;
        this.x += this.knockbackVx * dt;
        this.y += this.knockbackVy * dt;

        if (this.freezeTimer > 0) return; // Frozen

        // Move toward player
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
            this.x += (dx / dist) * this.speed * dt;
            this.y += (dy / dist) * this.speed * dt;
        }

        // Bat special: erratic movement
        if (this.type === 'bat') {
            this.x += (Math.random() - 0.5) * 60 * dt;
            this.y += (Math.random() - 0.5) * 60 * dt;
        }

        // Ghost special: sine wave movement
        if (this.type === 'ghost') {
            this.x += Math.sin(this.timeAlive * 5 + this.id * 100) * 30 * dt;
        }
    }

    // Drastically upgraded vector rendering for enemies
    render(ctx) {
        if (this.dead) return;
        const frozen = this.freezeTimer > 0;
        const flashing = this.flashTimer > 0;
        const baseColor = frozen ? '#aaddff' : flashing ? '#ffffff' : this.color;
        
        ctx.save();
        ctx.translate(this.x, this.y);
        
        ctx.shadowBlur = this.isBoss ? 25 : 12;
        ctx.shadowColor = baseColor;
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 2;
        
        const pulse = 1 + Math.sin(this.timeAlive * 8 + this.id * 10) * 0.1;

        switch (this.type) {
            case 'zombie':
                // Box with rotating inner diamond
                ctx.scale(pulse, pulse);
                ctx.strokeRect(-this.radius, -this.radius, this.radius * 2, this.radius * 2);
                ctx.rotate(this.timeAlive * 2);
                ctx.globalAlpha = 0.5;
                ctx.strokeRect(-this.radius*0.6, -this.radius*0.6, this.radius*1.2, this.radius*1.2);
                break;
            case 'skeleton':
                // Octagon pulse
                ctx.beginPath();
                for (let i=0; i<8; i++) {
                    const ang = i * Math.PI / 4 + this.timeAlive;
                    const r = this.radius * pulse;
                    if(i===0) ctx.moveTo(Math.cos(ang)*r, Math.sin(ang)*r);
                    else ctx.lineTo(Math.cos(ang)*r, Math.sin(ang)*r);
                }
                ctx.closePath();
                ctx.stroke();
                // "eyes"
                ctx.fillStyle = '#ff0000';
                ctx.fillRect(-4, -4, 2, 2);
                ctx.fillRect(2, -4, 2, 2);
                break;
            case 'bat':
                // Double triangle wings
                const wingFlap = Math.cos(this.timeAlive * 15) * 0.5 + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, this.radius);
                ctx.lineTo(-this.radius - wingFlap*10, -this.radius);
                ctx.lineTo(this.radius + wingFlap*10, -this.radius);
                ctx.closePath();
                ctx.stroke();
                // inner core
                ctx.globalAlpha = 0.5;
                ctx.fill();
                break;
            case 'ghost':
                // Wavy circle
                ctx.beginPath();
                for (let i = 0; i <= 20; i++) {
                    const ang = (i / 20) * Math.PI * 2;
                    const wave = Math.sin(ang * 4 + this.timeAlive * 5) * 3;
                    const r = this.radius * pulse + wave;
                    if(i===0) ctx.moveTo(Math.cos(ang)*r, Math.sin(ang)*r);
                    else ctx.lineTo(Math.cos(ang)*r, Math.sin(ang)*r);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.globalAlpha = 0.3;
                ctx.fill();
                break;
            case 'demon':
                // Hexagon inside inverted triangle
                ctx.rotate(this.timeAlive * 3);
                ctx.beginPath();
                for(let i=0; i<3; i++){
                    const ang = i * Math.PI*2/3;
                    if(i===0) ctx.moveTo(Math.cos(ang)*this.radius*1.5*pulse, Math.sin(ang)*this.radius*1.5*pulse);
                    else ctx.lineTo(Math.cos(ang)*this.radius*1.5*pulse, Math.sin(ang)*this.radius*1.5*pulse);
                }
                ctx.closePath();
                ctx.stroke();
                // Hex
                ctx.beginPath();
                for(let i=0; i<6; i++){
                    const ang = i * Math.PI/3;
                    if(i===0) ctx.moveTo(Math.cos(ang)*this.radius*0.8, Math.sin(ang)*this.radius*0.8);
                    else ctx.lineTo(Math.cos(ang)*this.radius*0.8, Math.sin(ang)*this.radius*0.8);
                }
                ctx.closePath();
                ctx.stroke();
                break;
            case 'boss':
                // Massive complex rotating geometry
                ctx.scale(pulse, pulse);
                // Outer ring
                ctx.beginPath();
                ctx.arc(0, 0, this.radius, 0, Math.PI*2);
                ctx.stroke();
                // Geometries
                for(let j=0; j<3; j++) {
                    ctx.save();
                    ctx.rotate(this.timeAlive * (1 + j*0.5) * (j%2===0?1:-1));
                    ctx.beginPath();
                    for(let i=0; i<4; i++){
                        const ang = i * Math.PI/2;
                        const r = this.radius * (0.9 - j*0.2);
                        if(i===0) ctx.moveTo(Math.cos(ang)*r, Math.sin(ang)*r);
                        else ctx.lineTo(Math.cos(ang)*r, Math.sin(ang)*r);
                    }
                    ctx.closePath();
                    ctx.lineWidth = 3 - j;
                    ctx.stroke();
                    ctx.restore();
                }
                // Core
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(0,0, this.radius * 0.2, 0, Math.PI*2);
                ctx.fill();
                break;
        }

        ctx.restore();
    }
}

// Global Spawner class
class Spawner {
    constructor() {
        this.reset();
    }
    
    reset() {
        this.timer = 0;
        this.waveTimer = 0;
        this.wave = 1;
        this.bossSpawned = false;
    }
    
    update(dt, enemies, playerContext) {
        this.timer -= dt;
        this.waveTimer += dt;
        
        // Increase wave difficulty every 30 seconds
        if (this.waveTimer > 30) {
            this.waveTimer = 0;
            this.wave++;
            window.audioSystem.pickup(); // signal wave change
        }

        // Win condition: 5 minutes = Boss
        if (this.wave >= 10 && !this.bossSpawned) {
            this.bossSpawned = true;
            window.audioSystem.bossAlert();
            this.spawnBoss(playerContext, enemies);
            return;
        }

        if (this.bossSpawned) return; // Stop normies

        // Spawn logic
        const spawnDelay = Math.max(0.1, 1.0 - (this.wave * 0.08));
        
        if (this.timer <= 0 && enemies.length < 300) {
            this.timer = spawnDelay;
            const angle = Math.random() * Math.PI * 2;
            // Spawn just outside view
            const r = 800; 
            const ex = playerContext.x + Math.cos(angle) * r;
            const ey = playerContext.y + Math.sin(angle) * r;

            let type = 'zombie';
            const roll = Math.random();
            if (this.wave >= 2 && roll < 0.2) type = 'bat';
            if (this.wave >= 4 && roll < 0.15) type = 'skeleton';
            if (this.wave >= 6 && roll < 0.1) type = 'ghost';
            if (this.wave >= 8 && roll < 0.05) type = 'demon';

            // Scale enemy hp/damage based on wave
            const scale = (this.wave - 1) * 0.5;
            enemies.push(new Enemy(ex, ey, type, scale));
        }
    }

    spawnBoss(p, enemies) {
        // Kill all normal enemies instantly
        enemies.forEach(e => e.hp = 0);
        
        const angle = Math.random() * Math.PI * 2;
        const ex = p.x + Math.cos(angle) * 600;
        const ey = p.y + Math.sin(angle) * 600;
        
        enemies.push(new Enemy(ex, ey, 'boss', this.wave));
    }
}

window.XPGem = XPGem;
window.LootItem = LootItem;
window.Enemy = Enemy;
window.Spawner = Spawner;
