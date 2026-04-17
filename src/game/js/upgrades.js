/* ============================================
   VOID SURVIVORS — Upgrade / Progression System
   Level up choices, passive buffs, weapon unlocks
   ============================================ */

const WEAPON_DEFS = {
    voidWhip: { name: 'Void Whip', icon: '🗡️', desc: 'Slashes enemies in an arc', maxLevel: 5 },
    spiritOrbs: { name: 'Spirit Orbs', icon: '🔮', desc: 'Orbiting projectiles', maxLevel: 5 },
    lightning: { name: 'Lightning', icon: '⚡', desc: 'Chain lightning to nearby foes', maxLevel: 5 },
    flameRing: { name: 'Flame Ring', icon: '🔥', desc: 'Expanding ring of fire', maxLevel: 5 },
    frostNova: { name: 'Frost Nova', icon: '❄️', desc: 'Freezing area burst', maxLevel: 5 },
    shadowDaggers: { name: 'Shadow Daggers', icon: '🗡️', desc: 'Rapid-fire seeking daggers', maxLevel: 5 }
};

const PASSIVE_DEFS = {
    maxHp: { name: 'Vitality', icon: '❤️', desc: '+20 Max HP', perLevel: 20 },
    speed: { name: 'Swiftness', icon: '👟', desc: '+12% Move Speed', perLevel: 0.12 },
    armor: { name: 'Armor', icon: '🛡️', desc: '+1 Damage Reduction', perLevel: 1 },
    magnet: { name: 'Magnet', icon: '🧲', desc: '+30% Pickup Radius', perLevel: 0.3 },
    might: { name: 'Might', icon: '💪', desc: '+10% Damage', perLevel: 0.10 },
    area: { name: 'Area', icon: '🌀', desc: '+10% AOE Size', perLevel: 0.10 },
    cooldown: { name: 'Haste', icon: '⏱️', desc: '-8% Cooldowns', perLevel: 0.08 },
    regen: { name: 'Regen', icon: '💚', desc: '+0.5 HP/sec', perLevel: 0.5 }
};

class UpgradeSystem {
    constructor() {
        this.passiveLevels = {};
        Object.keys(PASSIVE_DEFS).forEach(k => this.passiveLevels[k] = 0);
    }

    reset() {
        Object.keys(PASSIVE_DEFS).forEach(k => this.passiveLevels[k] = 0);
    }

    getPassiveValue(key) {
        return (this.passiveLevels[key] || 0) * PASSIVE_DEFS[key].perLevel;
    }

    generateChoices(playerWeapons, count = 3) {
        const pool = [];

        // Add weapon upgrades for existing weapons
        playerWeapons.forEach(w => {
            if (w.level < WEAPON_DEFS[w.type].maxLevel) {
                pool.push({
                    type: 'weaponUpgrade',
                    weaponType: w.type,
                    name: WEAPON_DEFS[w.type].name + ' Lv.' + (w.level + 1),
                    icon: WEAPON_DEFS[w.type].icon,
                    desc: `Upgrade ${WEAPON_DEFS[w.type].name} to level ${w.level + 1}`,
                    rarity: w.level >= 3 ? 'legendary' : 'normal',
                    weight: 3
                });
            }
        });

        // Add new weapon unlocks (only weapons not yet equipped)
        const equipped = new Set(playerWeapons.map(w => w.type));
        if (playerWeapons.length < 6) {
            Object.keys(WEAPON_DEFS).forEach(key => {
                if (!equipped.has(key)) {
                    pool.push({
                        type: 'newWeapon',
                        weaponType: key,
                        name: 'NEW: ' + WEAPON_DEFS[key].name,
                        icon: WEAPON_DEFS[key].icon,
                        desc: WEAPON_DEFS[key].desc,
                        rarity: 'normal',
                        weight: 4
                    });
                }
            });
        }

        // Add passive upgrades (max 5 levels each)
        Object.keys(PASSIVE_DEFS).forEach(key => {
            if (this.passiveLevels[key] < 5) {
                pool.push({
                    type: 'passive',
                    passiveKey: key,
                    name: PASSIVE_DEFS[key].name,
                    icon: PASSIVE_DEFS[key].icon,
                    desc: PASSIVE_DEFS[key].desc,
                    rarity: 'normal',
                    weight: 2
                });
            }
        });

        // Weighted random selection
        if (pool.length === 0) return [];

        const choices = [];
        const available = [...pool];

        for (let i = 0; i < Math.min(count, available.length); i++) {
            const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
            let roll = Math.random() * totalWeight;
            let selected = 0;
            for (let j = 0; j < available.length; j++) {
                roll -= available[j].weight;
                if (roll <= 0) { selected = j; break; }
            }
            choices.push(available[selected]);
            available.splice(selected, 1);
        }

        return choices;
    }

    applyPassive(key) {
        if (this.passiveLevels[key] < 5) {
            this.passiveLevels[key]++;
        }
    }

    getXPForLevel(level) {
        return Math.floor(10 + level * 8 + level * level * 0.5);
    }
}

window.UpgradeSystem = UpgradeSystem;
window.WEAPON_DEFS = WEAPON_DEFS;
window.PASSIVE_DEFS = PASSIVE_DEFS;
