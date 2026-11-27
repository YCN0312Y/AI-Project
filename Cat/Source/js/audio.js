(function (global) {
  'use strict';

  /**
   * Dual-Engine Feline Acoustic Synthesizer (Web Audio API)
   * 1. Continuous Two-Phase Breathing Laryngeal Purr (25-28 Hz glottal pulse + chest resonance)
   * 2. Plush Fur-Stroking ASMR Whisper
   * 3. Formant-Filtered Feline Vocal-Tract Meow & Trill Synthesizer ("喵喵叫"):
   *    Uses glottal harmonic excitation sculpted through 3 moving feline vowel formants
   *    (/m/ -> /i/ -> /a/ -> /o/ -> /u/) + soft breath aspiration + live mouthOpen envelope!
   */
  class CatAudio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.hapticsEnabled = false;
      this.initialized = false;
      this.breathPhase = 0;
      this.hapticAccum = 0;

      // Live mouth opening (0..1) driven by active meow envelope for visual lip/tongue sync!
      this.mouthOpen = 0.0;
      this.meowActiveUntil = 0;
      this.meowStart = 0;
      this.meowDuration = 0;
      this.meowVariant = 0;

      this.masterGain = null;
      this.purrVoiceGain = null;
      this.purrBreathGain = null;
      this.chestFilter = null;
      this.oscFund = null;
      this.oscSub = null;
      this.lfoRate = null;
      this.brushGain = null;
      this.brushFilter = null;
      this.noiseBuf = null;
    }

    ensureContext() {
      if (this.initialized) {
        if (this.ctx && this.ctx.state === 'suspended' && this.enabled) {
          this.ctx.resume().catch(() => {});
        }
        return;
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.enabled ? 0.88 : 0.0;
      master.connect(ctx.destination);
      this.masterGain = master;

      // 1. Feline Glottal Purr Periodic Wave
      const real = new Float32Array(12);
      const imag = new Float32Array(12);
      imag[1] = 1.00;
      imag[2] = 0.78;
      imag[3] = 0.56;
      imag[4] = 0.38;
      imag[5] = 0.24;
      imag[6] = 0.15;
      imag[7] = 0.09;
      imag[8] = 0.05;
      const purrWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

      const osc1 = ctx.createOscillator();
      osc1.setPeriodicWave(purrWave);
      osc1.frequency.value = 25.8;

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 51.9;
      const osc2Gain = ctx.createGain();
      osc2Gain.gain.value = 0.26;
      osc2.connect(osc2Gain);

      const chestFilter = ctx.createBiquadFilter();
      chestFilter.type = 'lowpass';
      chestFilter.frequency.value = 185.0;
      chestFilter.Q.value = 1.65;

      const purrVoiceGain = ctx.createGain();
      purrVoiceGain.gain.value = 0.0;

      osc1.connect(chestFilter);
      osc2Gain.connect(chestFilter);

      // 3-second warm pink noise buffer
      const bufLen = ctx.sampleRate * 3;
      const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const out = noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
      }
      this.noiseBuf = noiseBuf;

      // Breathy purr airflow gated at 26 Hz
      const purrNoise = ctx.createBufferSource();
      purrNoise.buffer = noiseBuf;
      purrNoise.loop = true;

      const throatBand = ctx.createBiquadFilter();
      throatBand.type = 'bandpass';
      throatBand.frequency.value = 145.0;
      throatBand.Q.value = 1.2;

      const gateGain = ctx.createGain();
      gateGain.gain.value = 0.5;
      const lfoGate = ctx.createOscillator();
      lfoGate.type = 'sine';
      lfoGate.frequency.value = 25.8;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.46;
      lfoGate.connect(lfoDepth);
      lfoDepth.connect(gateGain.gain);

      const purrBreathGain = ctx.createGain();
      purrBreathGain.gain.value = 0.0;

      purrNoise.connect(throatBand);
      throatBand.connect(gateGain);
      gateGain.connect(purrBreathGain);

      chestFilter.connect(purrVoiceGain);
      purrVoiceGain.connect(master);
      purrBreathGain.connect(master);

      // Plush fur-stroking ASMR rustle
      const brushNoise = ctx.createBufferSource();
      brushNoise.buffer = noiseBuf;
      brushNoise.loop = true;
      const brushFilter = ctx.createBiquadFilter();
      brushFilter.type = 'bandpass';
      brushFilter.frequency.value = 680.0;
      brushFilter.Q.value = 0.75;
      const brushGain = ctx.createGain();
      brushGain.gain.value = 0.0;
      brushNoise.connect(brushFilter);
      brushFilter.connect(brushGain);
      brushGain.connect(master);

      // Rich feline glottal vocal wave with warm odd and even harmonics.
      const mReal = new Float32Array(20);
      const mImag = new Float32Array(20);
      for (let h = 1; h < 20; h++) {
        mImag[h] = Math.pow(h, -1.18) * (h % 2 === 1 ? 1.0 : 0.82);
      }
      this.meowWave = ctx.createPeriodicWave(mReal, mImag, { disableNormalization: false });

      osc1.start();
      osc2.start();
      lfoGate.start();
      purrNoise.start();
      brushNoise.start();

      this.oscFund = osc1;
      this.oscSub = osc2;
      this.lfoRate = lfoGate;
      this.chestFilter = chestFilter;
      this.purrVoiceGain = purrVoiceGain;
      this.purrBreathGain = purrBreathGain;
      this.brushFilter = brushFilter;
      this.brushGain = brushGain;
      this.initialized = true;
    }

    /**
     * Trigger a synthesized meow.
     * @param {number} variant 0 = classic sweet "喵~", 1 = happy trill "咕噜喵~", 2 = soft baby "喵呜~", 3 = short cute "咪~"
     */
    playMeow(variant) {
      this.ensureContext();
      const v = typeof variant === 'number' ? variant : Math.floor(Math.random() * 3);
      const presets = [
        // 0: Classic "m-i-a-o-u~" (0.72s)
        { dur: 0.74, f0: [510, 665, 620, 445], f1: [480, 760, 1080, 540], f2: [1350, 2450, 1620, 980], trill: 0.0 },
        // 1: Affectionate trill-meow "mrr-iaow~" (0.68s)
        { dur: 0.68, f0: [470, 690, 640, 490], f1: [460, 820, 1040, 580], f2: [1400, 2380, 1680, 1050], trill: 28.0 },
        // 2: Soft sleepy/belly-up baby "mia-u~" (0.82s)
        { dur: 0.82, f0: [545, 640, 560, 410], f1: [500, 790, 1020, 510], f2: [1420, 2320, 1500, 920], trill: 0.0 },
        // 3: Short cute paw-bloom chirp "mii~" (0.42s)
        { dur: 0.42, f0: [560, 740, 690, 580], f1: [520, 880, 960, 640], f2: [1550, 2550, 2100, 1450], trill: 24.0 }
      ];
      const p = presets[v % presets.length];

      // Always drive visual mouth opening even if audio is muted!
      const nowPerf = performance.now() * 0.001;
      this.meowStart = nowPerf;
      this.meowDuration = p.dur;
      this.meowActiveUntil = nowPerf + p.dur;
      this.meowVariant = v;

      if (!this.enabled || !this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      const ctx = this.ctx;
      const t0 = ctx.currentTime + 0.01;
      const dur = p.dur;

      // Glottal source + natural feline vibrato / optional initial purr-trill!
      const vox = ctx.createOscillator();
      vox.setPeriodicWave(this.meowWave);
      const pitchJitter = 0.96 + Math.random() * 0.08;
      vox.frequency.setValueAtTime(p.f0[0] * pitchJitter, t0);
      vox.frequency.exponentialRampToValueAtTime(p.f0[1] * pitchJitter, t0 + dur * 0.24);
      vox.frequency.exponentialRampToValueAtTime(p.f0[2] * pitchJitter, t0 + dur * 0.58);
      vox.frequency.exponentialRampToValueAtTime(p.f0[3] * pitchJitter, t0 + dur);

      // Subtle natural vocal vibrato (6.2 Hz) + optional initial trill
      const vib = ctx.createOscillator();
      vib.type = 'sine';
      vib.frequency.setValueAtTime(p.trill > 0 ? p.trill : 6.2, t0);
      if (p.trill > 0) {
        vib.frequency.setValueAtTime(p.trill, t0 + dur * 0.22);
        vib.frequency.linearRampToValueAtTime(6.4, t0 + dur * 0.32);
      }
      const vibGain = ctx.createGain();
      vibGain.gain.setValueAtTime(p.trill > 0 ? 22.0 : 5.5, t0);
      if (p.trill > 0) {
        vibGain.gain.linearRampToValueAtTime(6.5, t0 + dur * 0.30);
      }
      vib.connect(vibGain);
      vibGain.connect(vox.frequency);

      // Soft airy feline breath aspiration mixed into vocal cord source
      const asp = ctx.createBufferSource();
      asp.buffer = this.noiseBuf;
      asp.loop = true;
      const aspGain = ctx.createGain();
      aspGain.gain.value = 0.16;
      asp.connect(aspGain);

      // Parallel 3-Formant Feline Vocal Tract Filter Bank (/m-i-a-o-u/!)
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.Q.value = 4.2;
      f1.frequency.setValueAtTime(p.f1[0], t0);
      f1.frequency.exponentialRampToValueAtTime(p.f1[1], t0 + dur * 0.22);
      f1.frequency.exponentialRampToValueAtTime(p.f1[2], t0 + dur * 0.52);
      f1.frequency.exponentialRampToValueAtTime(p.f1[3], t0 + dur);

      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.Q.value = 5.0;
      f2.frequency.setValueAtTime(p.f2[0], t0);
      f2.frequency.exponentialRampToValueAtTime(p.f2[1], t0 + dur * 0.24);
      f2.frequency.exponentialRampToValueAtTime(p.f2[2], t0 + dur * 0.58);
      f2.frequency.exponentialRampToValueAtTime(p.f2[3], t0 + dur);

      const f3 = ctx.createBiquadFilter();
      f3.type = 'bandpass';
      f3.Q.value = 5.5;
      f3.frequency.setValueAtTime(3250, t0);

      const g1 = ctx.createGain(); g1.gain.value = 0.72;
      const g2 = ctx.createGain(); g2.gain.value = 0.48;
      const g3 = ctx.createGain(); g3.gain.value = 0.16;

      // Warm low-pass smoothing so there's zero harshness
      const postLP = ctx.createBiquadFilter();
      postLP.type = 'lowpass';
      postLP.frequency.value = 4200;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.30, t0 + dur * 0.16);
      env.gain.setValueAtTime(0.28, t0 + dur * 0.48);
      env.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);

      vox.connect(f1); vox.connect(f2); vox.connect(f3);
      aspGain.connect(f1); aspGain.connect(f2);
      f1.connect(g1); f2.connect(g2); f3.connect(g3);
      g1.connect(postLP); g2.connect(postLP); g3.connect(postLP);
      postLP.connect(env);
      env.connect(this.masterGain);

      vox.start(t0);
      vib.start(t0);
      asp.start(t0);
      vox.stop(t0 + dur + 0.04);
      vib.stop(t0 + dur + 0.04);
      asp.stop(t0 + dur + 0.04);
    }

    playFeedCrunch() {
      if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const crunch = ctx.createBufferSource();
      crunch.buffer = this.noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1300 + Math.random() * 750;
      filter.Q.value = 0.8;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.001, t);
      envelope.gain.linearRampToValueAtTime(0.20, t + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.012, t + 0.035);
      envelope.gain.linearRampToValueAtTime(0.10, t + 0.049);
      envelope.gain.exponentialRampToValueAtTime(0.001, t + 0.105);
      crunch.connect(filter);
      filter.connect(envelope);
      envelope.connect(this.masterGain);
      crunch.start(t, Math.random() * 2);
      crunch.stop(t + 0.11);
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (this.enabled) {
        this.ensureContext();
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      }
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(this.enabled ? 0.88 : 0.0, this.ctx.currentTime, 0.06);
      }
    }

    toggleAudio() {
      this.setEnabled(!this.enabled);
      return this.enabled;
    }

    setHaptics(on) {
      this.hapticsEnabled = !!on;
      if (this.hapticsEnabled && navigator.vibrate) {
        try { navigator.vibrate(18); } catch (_) {}
      } else if (!this.hapticsEnabled && navigator.vibrate) {
        try { navigator.vibrate(0); } catch (_) {}
      }
      return this.hapticsEnabled;
    }

    toggleHaptics() {
      return this.setHaptics(!this.hapticsEnabled);
    }

    unlockOnGesture() {
      if (this.enabled) {
        this.ensureContext();
      }
    }

    update(physics, rawDt) {
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      const nowPerf = performance.now() * 0.001;

      // Update live visual mouth-open curve for "喵喵叫" (/m/ closed -> /i-a/ wide open -> /u/ close!)
      if (nowPerf < this.meowActiveUntil && this.meowDuration > 0.05) {
        const u = (nowPerf - this.meowStart) / this.meowDuration;
        const arch = Math.sin(Math.min(1, Math.max(0, (u - 0.06) / 0.88)) * Math.PI);
        const targetMouth = Math.max(0, arch) * (this.meowVariant === 3 ? 0.68 : 0.95);
        this.mouthOpen += (targetMouth - this.mouthOpen) * Math.min(1.0, dt * 26.0);
      } else {
        this.mouthOpen += (0.0 - this.mouthOpen) * Math.min(1.0, dt * 18.0);
      }

      // Two-phase breathing laryngeal purr cycle (~0.47 Hz)
      const rateScale = 0.94 + physics.purrIntensity * 0.18;
      this.breathPhase = (this.breathPhase + dt * 0.47 * rateScale) % 1.0;

      let breathEnv = 0.0;
      let isInhale = false;
      if (this.breathPhase < 0.44) {
        isInhale = true;
        breathEnv = Math.sin((this.breathPhase / 0.44) * Math.PI);
      } else {
        breathEnv = Math.sin(((this.breathPhase - 0.44) / 0.56) * Math.PI) * 0.92;
      }
      const shapedEnv = 0.34 + 0.66 * Math.pow(Math.max(0, breathEnv), 0.72);

      if (this.initialized && this.ctx && this.ctx.state === 'running' && this.enabled) {
        const now = this.ctx.currentTime;
        const pInt = physics.purrIntensity;

        const baseFreq = (isInhale ? 26.9 : 24.8) + pInt * 1.6;
        this.oscFund.frequency.setTargetAtTime(baseFreq, now, 0.08);
        this.oscSub.frequency.setTargetAtTime(baseFreq * 2.005, now, 0.08);
        this.lfoRate.frequency.setTargetAtTime(baseFreq, now, 0.08);

        const cutoff = 155.0 + pInt * 180.0 + breathEnv * 38.0;
        this.chestFilter.frequency.setTargetAtTime(cutoff, now, 0.07);

        // Dip purr slightly during loud peak of a meow (anatomically real!)
        const meowDip = 1.0 - this.mouthOpen * 0.45;
        const voiceLevel = (0.055 + pInt * 0.25) * shapedEnv * meowDip;
        const breathLevel = (0.035 + pInt * 0.19) * shapedEnv * meowDip;
        this.purrVoiceGain.gain.setTargetAtTime(voiceLevel, now, 0.05);
        this.purrBreathGain.gain.setTargetAtTime(breathLevel, now, 0.05);

        const strokeSpeed = Math.min(2.2, physics.hand.speed);
        const brushLevel = physics.hand.pressure * Math.min(1.0, strokeSpeed * 0.65) * 0.095;
        this.brushFilter.frequency.setTargetAtTime(520.0 + strokeSpeed * 320.0, now, 0.04);
        this.brushGain.gain.setTargetAtTime(brushLevel, now, 0.04);
      }

      if (this.hapticsEnabled && navigator.vibrate && (physics.hand.pressure > 0.12 || this.mouthOpen > 0.2)) {
        this.hapticAccum += dt;
        if (this.hapticAccum >= 0.09) {
          this.hapticAccum = 0;
          const pulseMs = Math.round(8 + physics.purrIntensity * 14 * shapedEnv);
          try { navigator.vibrate(pulseMs); } catch (_) {}
        }
      }
    }
  }

  global.CatAudio = CatAudio;
})(window);
