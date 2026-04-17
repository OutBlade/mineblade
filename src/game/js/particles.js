/* ============================================
   VOID SURVIVORS — Particle System
   Lightweight particle engine with presets
   ============================================ */

class Particle {
    constructor(x, y, vx, vy, life, size, color, shrink = true, gravity = 0, glow = false) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.life = life;
        this.maxLife = life;
        this.size = size;
        this.startSize = size;
        this.color = color;
        this.shrink = shrink;
        this.gravity = gravity;
        this.glow = glow;
        this.dead = false;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vy += this.gravity * dt;
        this.life -= dt;
        if (this.shrink) {
            this.size = this.startSize * (this.life / this.maxLife);
        }
        if (this.life <= 0) this.dead = true;
    }

    render(ctx) {
        if (this.dead) return;
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.globalAlpha = alpha;
        if (this.glow) {
            ctx.shadowBlur = this.size * 3;
            ctx.shadowColor = this.color;
        }
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, Math.max(0.5, this.size), 0, Math.PI * 2);
        ctx.fill();
        if (this.glow) {
            ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
    }
}

class DamageNumber {
    constructor(x, y, text, color = '#ffffff') {
        this.x = x;
        this.y = y;
        this.text = text;
        this.color = color;
        this.life = 0.8;
        this.maxLife = 0.8;
        this.vy = -80;
        this.dead = false;
    }

    update(dt) {
        this.x += (this.vx || 0) * dt;
        this.y += this.vy * dt;
        this.vy *= 0.95;
        this.life -= dt;
        if (this.life <= 0) this.dead = true;
    }

    render(ctx) {
        if (this.dead) return;
        const alpha = Math.max(0, this.life / this.maxLife);
        const scale = 0.8 + (1 - this.life / this.maxLife) * 0.4;
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${Math.round(14 * scale)}px Orbitron, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(this.text, this.x + 1, this.y + 1);
        // Text
        ctx.fillStyle = this.color;
        ctx.fillText(this.text, this.x, this.y);
        ctx.globalAlpha = 1;
    }
}

class ParticleSystem {
    constructor() {
        this.particles = [];
        this.damageNumbers = [];
        this.shockwaves = [];
        this.maxParticles = 500;
    }

    setQuality(quality) {
        switch (quality) {
            case 'low': this.maxParticles = 100; break;
            case 'medium': this.maxParticles = 300; break;
            case 'high': default: this.maxParticles = 500; break;
        }
    }

    add(p) {
        if (this.particles.length < this.maxParticles) {
            this.particles.push(p);
        }
    }

    addDamageNumber(x, y, amount, color) {
        const text = typeof amount === 'string' ? amount : Math.round(amount).toString();
        const dn = new DamageNumber(x, y - 15, text, color);
        dn.vx = (Math.random() - 0.5) * 40; // float outward
        this.damageNumbers.push(dn);
    }

    addShockwave(x, y, color = '#ffffff', maxRadius = 300, duration = 0.5) {
        this.shockwaves.push({ x, y, maxRadius, duration, life: duration, color });
    }

    // Presets
    explosion(x, y, color = '#ff6644', count = 12) {
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
            const speed = 80 + Math.random() * 120;
            this.add(new Particle(
                x, y,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                0.3 + Math.random() * 0.3,
                3 + Math.random() * 3,
                color, true, 0, true
            ));
        }
    }

    sparkle(x, y, color = '#aaff00', count = 6) {
        for (let i = 0; i < count; i++) {
            this.add(new Particle(
                x + (Math.random() - 0.5) * 10,
                y + (Math.random() - 0.5) * 10,
                (Math.random() - 0.5) * 40,
                (Math.random() - 0.5) * 40 - 20,
                0.3 + Math.random() * 0.2,
                1.5 + Math.random() * 2,
                color, true, 30, true
            ));
        }
    }

    trail(x, y, color = '#00f0ff', size = 3) {
        this.add(new Particle(
            x + (Math.random() - 0.5) * 4,
            y + (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            0.2 + Math.random() * 0.15,
            size,
            color, true, 0, true
        ));
    }

    burst(x, y, color = '#ffdd44', count = 20) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 50 + Math.random() * 200;
            this.add(new Particle(
                x, y,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                0.5 + Math.random() * 0.5,
                2 + Math.random() * 4,
                color, true, 50, true
            ));
        }
    }

    levelUpBurst(x, y) {
        const colors = ['#44ff88', '#00f0ff', '#ffdd44', '#b744ff'];
        for (let i = 0; i < 40; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 100 + Math.random() * 300;
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.add(new Particle(
                x, y,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                0.6 + Math.random() * 0.6,
                3 + Math.random() * 5,
                color, true, -20, true
            ));
        }
    }

    update(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update(dt);
            if (this.particles[i].dead) {
                this.particles.splice(i, 1);
            }
        }
        for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
            this.damageNumbers[i].update(dt);
            if (this.damageNumbers[i].dead) {
                this.damageNumbers.splice(i, 1);
            }
        }
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            this.shockwaves[i].life -= dt;
            if (this.shockwaves[i].life <= 0) {
                this.shockwaves.splice(i, 1);
            }
        }
    }

    render(ctx) {
        this.particles.forEach(p => p.render(ctx));
        
        // Render shockwaves
        this.shockwaves.forEach(sw => {
            const progress = 1 - (sw.life / sw.duration);
            const r = sw.maxRadius * progress;
            const alpha = Math.max(0, 1 - Math.pow(progress, 2.0));
            ctx.globalAlpha = alpha;
            ctx.shadowBlur = 20;
            ctx.shadowColor = sw.color;
            ctx.strokeStyle = sw.color;
            ctx.lineWidth = 4 * (1 - progress) + 1;
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        });
    }

    renderDamageNumbers(ctx) {
        this.damageNumbers.forEach(d => d.render(ctx));
    }

    clear() {
        this.particles = [];
        this.damageNumbers = [];
        this.shockwaves = [];
    }
}

window.ParticleSystem = ParticleSystem;
