/* ============================================
   VOID SURVIVORS — Audio System & Multi-Track Synths
   ============================================ */

class AudioSystem {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.sfxGain = null;
        this.musicGain = null;
        this.initialized = false;
        
        // Sequencer state
        this.isPlaying = false;
        this.nextNoteTime = 0;
        this.current16thNote = 0;
        this.tempo = 130;
        this.lookahead = 25.0; 
        this.scheduleAheadTime = 0.1;
        this.timerID = null;

        this.loadSettings();
    }

    loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem('void_survivors_settings') || '{}');
            this.masterVol = (s.masterVol ?? 70) / 100;
            this.sfxVol = (s.sfxVol ?? 80) / 100;
            this.musicVol = (s.musicVol ?? 50) / 100;
        } catch (e) {
            this.masterVol = 0.7;
            this.sfxVol = 0.8;
            this.musicVol = 0.5;
        }
    }

    init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.masterVol;
            this.masterGain.connect(this.ctx.destination);

            this.sfxGain = this.ctx.createGain();
            this.sfxGain.gain.value = this.sfxVol;
            this.sfxGain.connect(this.masterGain);

            this.musicGain = this.ctx.createGain();
            this.musicGain.gain.value = this.musicVol;
            this.musicGain.connect(this.masterGain);

            this.initialized = true;
        } catch (e) {
            console.warn('Audio init failed:', e);
        }
    }

    // --- SFX Generators ---
    playTone(freq, duration, type = 'square', volume = 0.3, detune = 0) {
        if (!this.initialized) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        osc.detune.value = detune;
        gain.gain.setValueAtTime(volume * this.sfxVol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playNoise(duration, volume = 0.2) {
        if (!this.initialized) return;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * volume;
        }
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume * this.sfxVol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        
        // Simple lowpass filter for noise to sound punchier
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 3000;

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        source.start();
    }

    // --- Specific SFX Triggers ---
    hit() { this.playNoise(0.08, 0.15); this.playTone(200, 0.08, 'square', 0.1); }
    playerHit() { this.playTone(120, 0.2, 'sawtooth', 0.2); this.playNoise(0.1, 0.2); }
    pickup() { this.playTone(600, 0.08, 'sine', 0.15); this.playTone(900, 0.1, 'sine', 0.1); }
    dash() { this.playNoise(0.2, 0.3); this.playTone(300, 0.2, 'sine', 0.2, 500); }
    explosion() { this.playNoise(0.3, 0.4); this.playTone(100, 0.3, 'sawtooth', 0.3, -500); }
    levelUp() {
        this.playTone(523, 0.15, 'sine', 0.2);
        setTimeout(() => this.playTone(659, 0.15, 'sine', 0.2), 100);
        setTimeout(() => this.playTone(784, 0.2, 'sine', 0.25), 200);
        setTimeout(() => this.playTone(1047, 0.3, 'sine', 0.2), 300);
    }
    enemyDeath() { this.playTone(300, 0.1, 'square', 0.08); this.playNoise(0.06, 0.1); }
    weaponFire() { this.playTone(440, 0.05, 'square', 0.06, Math.random() * 200 - 100); }
    bossAlert() {
        for (let i = 0; i < 4; i++) {
            setTimeout(() => this.playTone(80, 0.3, 'sawtooth', 0.2), i * 300);
        }
    }
    gameOver() {
        this.playTone(440, 0.3, 'sawtooth', 0.2);
        setTimeout(() => this.playTone(330, 0.3, 'sawtooth', 0.2), 200);
        setTimeout(() => this.playTone(220, 0.5, 'sawtooth', 0.25), 400);
        setTimeout(() => this.playTone(110, 0.8, 'sawtooth', 0.2), 600);
    }

    // --- Music Synthesizers ---
    playKick(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
        gain.gain.setValueAtTime(0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start(time);
        osc.stop(time + 0.5);
    }

    playBass(time, note) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        
        osc.type = 'sawtooth';
        osc.frequency.value = note;
        
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, time);
        filter.frequency.exponentialRampToValueAtTime(100, time + 0.2);

        gain.gain.setValueAtTime(0.2, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
        
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.musicGain);
        
        osc.start(time);
        osc.stop(time + 0.2);
    }

    playArp(time, note) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'square';
        osc.frequency.value = note;
        // Delay node for echo effect
        const delay = this.ctx.createDelay();
        delay.delayTime.value = 0.2;
        const feedback = this.ctx.createGain();
        feedback.gain.value = 0.4;
        
        gain.gain.setValueAtTime(0.05, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
        
        osc.connect(gain);
        gain.connect(this.musicGain);
        
        // Connect to delay line
        gain.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(this.musicGain);
        
        osc.start(time);
        osc.stop(time + 0.1);
    }

    // --- Music Sequencer ---
    nextNote() {
        // Advance current note and time by a 16th note...
        const secondsPerBeat = 60.0 / this.tempo;
        this.nextNoteTime += 0.25 * secondsPerBeat;
        this.current16thNote++;
        if (this.current16thNote === 16) {
            this.current16thNote = 0;
        }
    }

    scheduleNote(beatNumber, time) {
        // Multi-track programming
        
        // 1. Kick on every quarter note (0, 4, 8, 12)
        if (beatNumber % 4 === 0) {
            this.playKick(time);
        }
        
        // 2. Bassline off-beats (2, 6, 10, 14)
        const bassProgression = [55.00, 55.00, 43.65, 49.00]; // G1, G1, F1, G1
        const bar = Math.floor((this.current16thNote + (Date.now() / 1000 * (this.tempo/60))) / 16) % 4; // pseudo-progression
        
        if (beatNumber % 4 === 2) {
            this.playBass(time, bassProgression[bar]);
        }
        
        // 3. Arpeggiator on 8th notes (0, 2, 4, 6, 8, 10, 12, 14)
        if (beatNumber % 2 === 0) {
            const arpScale = [196.00, 293.66, 392.00, 440.00, 523.25, 587.33]; // G Min Pentatonic
            const randomNote = arpScale[Math.floor(Math.random() * arpScale.length)];
            // Only play arp 60% of the time to give it air
            if (Math.random() > 0.4) {
               this.playArp(time, randomNote);
            }
        }
    }

    scheduler() {
        while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
            this.scheduleNote(this.current16thNote, this.nextNoteTime);
            this.nextNote();
        }
        this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
    }

    startMusic() {
        if (!this.initialized || this.isPlaying) return;
        
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        
        this.isPlaying = true;
        this.current16thNote = 0;
        this.nextNoteTime = this.ctx.currentTime + 0.1;
        this.scheduler();
    }

    stopMusic() {
        this.isPlaying = false;
        if (this.timerID) {
            clearTimeout(this.timerID);
        }
    }
}

// Global instance
window.audioSystem = new AudioSystem();
