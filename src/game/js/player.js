/* ============================================
   VOID SURVIVORS — Player System
   4 character classes, movement, rendering
   ============================================ */

const CHARACTER_CLASSES = {
    warrior: {
        name: 'Warrior',
        hp: 120,
        speed: 180,
        armor: 2,
        color: '#ff6644',
        startWeapon: 'voidWhip',
        regen: 0
    },
    mage: {
        name: 'Mage',
        hp: 80,
        speed: 200,
        armor: 0,
        color: '#aa66ff',
        startWeapon: 'lightning',
        regen: 0
    },
    rogue: {
        name: 'Rogue',
        hp: 90,
        speed: 260,
        armor: 0,
        color: '#44ff88',
        startWeapon: 'shadowDaggers',
        regen: 0
    },
    cleric: {
        name: 'Cleric',
        hp: 100,
        speed: 190,
        armor: 1,
        color: '#ffdd44',
        startWeapon: 'spiritOrbs',
        regen: 1
    }
};

class Player {
    constructor(className) {
        const cls = CHARACTER_CLASSES[className] || CHARACTER_CLASSES.warrior;
        this.className = className;
        this.x = 0;
        this.y = 0;
        this.radius = 14;
        this.maxHp = cls.hp;
        this.hp = cls.hp;
        this.baseSpeed = cls.speed;
        this.speed = cls.speed;
        this.armor = cls.armor;
        this.color = cls.color;
        this.baseRegen = cls.regen;
        this.regen = cls.regen;
        this.magnetRadius = 80;
        this.baseMagnetRadius = 80;
        this.invincibleTimer = 0;
        this.damageMultiplier = 1;
        this.areaMultiplier = 1;
        this.cdMultiplier = 1;

        // Active Abilities
        this.isDashing = false;
        this.dashTimer = 0;
        this.dashCooldownTimer = 0;
        this.baseDashCooldown = 2.0;

        // XP / Level
        this.xp = 0;
        this.level = 1;

        // Weapons
        this.weapons = [window.createWeapon(cls.startWeapon)];

        // Visual
        this.trailPositions = [];
        this.angle = 0;
        this.bobTimer = 0;
    }

    applyPassives(upgradeSystem) {
        const get = (k) => upgradeSystem.getPassiveValue(k);
        this.maxHp = CHARACTER_CLASSES[this.className].hp + get('maxHp');
        this.speed = this.baseSpeed * (1 + get('speed'));
        this.armor = CHARACTER_CLASSES[this.className].armor + get('armor');
        this.magnetRadius = this.baseMagnetRadius * (1 + get('magnet'));
        this.damageMultiplier = 1 + get('might');
        this.areaMultiplier = 1 + get('area');
        this.cdMultiplier = 1 - get('cooldown');
        this.regen = this.baseRegen + get('regen');
    }

    update(dt, keys) {
        // Movement
        let mx = 0, my = 0;
        if (keys['w'] || keys['arrowup']) my = -1;
        if (keys['s'] || keys['arrowdown']) my = 1;
        if (keys['a'] || keys['arrowleft']) mx = -1;
        if (keys['d'] || keys['arrowright']) mx = 1;

        // Dash Mechanic
        if (this.dashCooldownTimer > 0) this.dashCooldownTimer -= dt;
        if (this.dashTimer > 0) {
            this.dashTimer -= dt;
            if (this.dashTimer <= 0) this.isDashing = false;
        }

        if ((keys[' '] || keys['shift']) && this.dashCooldownTimer <= 0 && (mx !== 0 || my !== 0)) {
            this.isDashing = true;
            this.dashTimer = 0.25; // 250ms dash dur
            this.dashCooldownTimer = this.baseDashCooldown * this.cdMultiplier;
            this.invincibleTimer = 0.3; // brief invincibility
            window.audioSystem.dash?.();
        }

        // Apply Speed
        let currentSpeed = this.speed;
        if (this.isDashing) currentSpeed *= 3.5;

        if (mx !== 0 || my !== 0) {
            const len = Math.hypot(mx, my);
            mx /= len;
            my /= len;
            this.x += mx * currentSpeed * dt;
            this.y += my * currentSpeed * dt;
            this.angle = Math.atan2(my, mx);
        }

        // Regen
        if (this.regen > 0) {
            this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
        }

        // Invincibility
        this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);

        // Trail
        this.bobTimer += dt * 5;
        this.trailPositions.unshift({ x: this.x, y: this.y });
        if (this.trailPositions.length > 8) this.trailPositions.pop();
    }

    takeDamage(amount) {
        if (this.invincibleTimer > 0) return false;
        const finalDmg = Math.max(1, amount - this.armor);
        this.hp -= finalDmg;
        this.invincibleTimer = 0.5;
        window.audioSystem.playerHit();
        return true;
    }

    addXP(amount) {
        this.xp += amount;
    }

    checkLevelUp(upgradeSystem) {
        const needed = upgradeSystem.getXPForLevel(this.level);
        if (this.xp >= needed) {
            this.xp -= needed;
            this.level++;
            return true;
        }
        return false;
    }

    getXPProgress(upgradeSystem) {
        const needed = upgradeSystem.getXPForLevel(this.level);
        return this.xp / needed;
    }

    render(ctx) {
        // Trail
        for (let i = this.trailPositions.length - 1; i >= 1; i--) {
            const t = this.trailPositions[i];
            const alpha = (1 - i / this.trailPositions.length) * 0.2;
            const size = this.radius * (1 - i / this.trailPositions.length) * 0.7;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(t.x, t.y, size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Render Dash Cooldown Ring
        if (this.dashCooldownTimer > 0) {
            ctx.strokeStyle = this.color;
            ctx.globalAlpha = 0.3;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 8, -Math.PI/2, -Math.PI/2 + (Math.PI * 2 * (1 - this.dashCooldownTimer / (this.baseDashCooldown * this.cdMultiplier))));
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Invincibility flash
        if (this.invincibleTimer > 0 && Math.floor(this.invincibleTimer * 10) % 2 === 0) {
            ctx.globalAlpha = 0.4;
        }

        // Player body - hexagon
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI * 2 * i) / 6 + this.angle;
            const px = this.x + Math.cos(a) * this.radius;
            const py = this.y + Math.sin(a) * this.radius;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // Inner glow
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }
}

window.Player = Player;
window.CHARACTER_CLASSES = CHARACTER_CLASSES;
