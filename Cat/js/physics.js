(function (global) {
  'use strict';

  /**
   * Photo-mesh physics for the cat.
   *
   * The cat is a real photo mapped onto a deformable grid. This module owns all
   * simulation state and deforms each pose's grid vertices during rendering.
   *
   * Stage space: y in [-0.5, 0.5], x in [-0.5*aspect, 0.5*aspect], +y up.
   * Image aspect is 1.5, so stage x = (u - 0.5) * 1.5, stage y = 0.5 - vTop.
   */

  const IMG_ASPECT = 1.5;
  const NUM_KELVIN = 8;
  const FEED_POUR_TIME = 0.36;
  const FEED_LOWER_END = 1.22;
  const FEED_BITE_TIME = 0.38;
  const FEED_BITES = 5;
  const FEED_RAISE_START = FEED_LOWER_END + FEED_BITE_TIME * FEED_BITES;
  const FEED_RAISE_END = FEED_RAISE_START + 0.82;
  const FEED_END = FEED_RAISE_END + 0.26;
  const IDLE_DELAY = 8;
  const IDLE_ACTIONS = ['groom', 'roll', 'look'];

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  // 1 inside r0, smoothly 0 beyond r1
  function falloff(d, r0, r1) { return 1 - smooth01((d - r0) / Math.max(1e-5, r1 - r0)); }

  function toStage(pt) { return [(pt[0] - 0.5) * IMG_ASPECT, 0.5 - pt[1]]; }

  // Convert an authored layout (image fractions, y from top) into stage units.
  function buildPose(src) {
    const P = {};
    P.head = { c: toStage(src.head.c), rx: src.head.rx * IMG_ASPECT, ry: src.head.ry };
    P.neck = toStage(src.neck);
    P.mouth = toStage(src.mouth);
    P.ears = src.ears.map((e) => ({ base: toStage(e.base), r: e.r }));
    P.chest = { c: toStage(src.chest.c), r: src.chest.r, breathScale: src.chest.breathScale ?? 1 };
    P.body = { c: toStage(src.body.c), rx: src.body.rx * IMG_ASPECT, ry: src.body.ry };
    P.tail = { pts: src.tail.pts.map(toStage), r: src.tail.r };
    P.paws = src.paws.map((p) => ({ c: toStage(p.c), r: p.r }));
    return P;
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / Math.max(1e-6, vx * vx + vy * vy), 0, 1);
    const qx = ax + vx * t - px, qy = ay + vy * t - py;
    return { d: Math.hypot(qx, qy), t };
  }

  class CatPhysics {
    constructor(layout) {
      this.sit = buildPose(layout.sit);
      this.belly = buildPose(layout.belly);
      this.poses = {
        sit: this.sit,
        lean: buildPose(layout.lean),
        side: buildPose(layout.side),
        belly: this.belly,
        feedLean: buildPose(layout.feedLean),
        feedReach: buildPose(layout.feedReach),
        feedEat: buildPose(layout.feedEat),
        groomLift: buildPose(layout.groomLift),
        groom: buildPose(layout.groom)
      };
      this.rawLayout = layout;
      this.time = 0;
      this.breathPhase = 0;

      this.sizeScale = 1.0;
      this.chonkScale = 1.0;
      this.furLengthUser = 1.0;
      this.softness = 1.0;
      this.isBellyUp = false;
      this.rollMix = 0;
      this.rollVel = 0;
      this.feed = { time: -1, bend: 0, eaten: 0, nibble: 0, opacity: 0, pour: 0, fill: 0 };
      this.idle = { action: null, next: 0, wait: IDLE_DELAY, time: 0, groom: 0, lick: 0, look: 0 };
      this.onFeedCrunch = null;

      this.bloomTarget = 0;
      this.bloomTimer = 0;
      this.pawBloom = [0, 0, 0, 0];
      this.knead = [0, 0, 0, 0];
      this.pendingBloom = false;

      this.shakeTime = -1;

      this.head = { tilt: 0, vTilt: 0, lift: 0, vLift: 0 };
      this.ears = [
        { ang: 0, v: 0, timer: 3.5 },
        { ang: 0, v: 0, timer: 6.0 }
      ];
      this.tail = { ang: 0, v: 0, drag: 0, vDrag: 0, phase: 0 };

      this.eyeClose = 0;
      this.blinkTimer = 3.0;
      this.blinkPhase = 0;

      this.kelvin = [];
      for (let i = 0; i < NUM_KELVIN; i++) {
        this.kelvin.push({ cx: 0, cy: 0, dx: 0, dy: 0, vx: 0, vy: 0, r: 0.07 });
      }
      this.activeK = -1;

      this.pointer = { active: false, hover: false, isTouch: false, x: 0, y: -0.7 };
      this.hand = {
        x: 0.2, y: -0.7, smoothVx: 0, smoothVy: 0, speed: 0,
        visible: 0, pressure: 0, angle: 0.3, zone: 'none'
      };

      this.petEnergy = 0;
      this.purrIntensity = 0.2;
      this.onReflexMeow = null;

      this._frame = null;
    }

    pose() { return this.rollMix < 0.5 ? this.sit : this.belly; }

    get isRolling() { return this.rollMix !== Number(this.isBellyUp); }

    get isFeeding() { return this.feed.time >= 0; }

    startFeeding() {
      if (this.isFeeding) return false;
      this.stopIdle();
      if (this.isBellyUp) this.toggleRollOver();
      this.feed.time = 0;
      this.feed.eaten = 0;
      this.shakeTime = -1;
      return true;
    }

    stepFeeding(dt) {
      const feed = this.feed;
      if (!this.isFeeding || this.isRolling || this.idle.groom > 0) return;
      const t = feed.time += dt;
      const bite = clamp((t - FEED_LOWER_END) / FEED_BITE_TIME, 0, FEED_BITES);
      const eaten = Math.min(FEED_BITES, Math.floor(bite + 0.43));
      if (eaten > feed.eaten) {
        feed.eaten = eaten;
        this.onFeedCrunch?.();
      }
      feed.nibble = Math.sin((bite % 1) * Math.PI) ** 2;
      const lower = smooth01((t - FEED_POUR_TIME) / (FEED_LOWER_END - FEED_POUR_TIME));
      const raise = smooth01((t - FEED_RAISE_START) / (FEED_RAISE_END - FEED_RAISE_START));
      feed.bend = lower * (1 - raise);
      feed.pour = smooth01(t / FEED_POUR_TIME);
      feed.fill = feed.pour * (1 - feed.eaten / FEED_BITES);
      feed.opacity = smooth01(t / 0.19) * (1 - smooth01((t - FEED_RAISE_END) / (FEED_END - FEED_RAISE_END)));
      if (t >= FEED_END) feed.time = -1;
    }

    setCustomization({ size, chonk, softness, furLength }) {
      if (typeof size === 'number') this.sizeScale = size;
      if (typeof chonk === 'number') this.chonkScale = chonk;
      if (typeof softness === 'number') this.softness = softness;
      if (typeof furLength === 'number') this.furLengthUser = furLength;
    }

    setSoftness(s) { this.softness = s; }

    toggleRollOver() {
      if (this.isFeeding) return this.isBellyUp;
      this.stopIdle(false);
      this.setRollTarget(!this.isBellyUp);
      return this.isBellyUp;
    }

    setRollTarget(bellyUp) {
      this.isBellyUp = bellyUp;
      this.kelvin.forEach((k) => { k.dx = k.dy = k.vx = k.vy = 0; });
      if (!this.isBellyUp) {
        this.bloomTimer = 0;
        this.pendingBloom = false;
        this._pokePaw = null;
      }
    }

    stopIdle(returnToSit = true) {
      const idle = this.idle;
      if (returnToSit && idle.action === 'roll' && this.isBellyUp) this.setRollTarget(false);
      idle.action = null;
      idle.wait = IDLE_DELAY;
    }

    stepIdle(dt, allowed) {
      const idle = this.idle;
      const manualPose = idle.action !== 'roll' && (this.isBellyUp || this.isRolling);
      const blocked = !allowed || manualPose || this.pointer.active || this.pointer.hover ||
        this.isFeeding || this.shakeTime >= 0 || this.bloomTimer > 0;
      if (blocked) this.stopIdle();

      if (idle.action !== 'groom') {
        idle.groom = Math.max(0, idle.groom - dt / 0.32);
        idle.lick *= Math.exp(-dt * 18);
      }
      if (idle.action !== 'look') idle.look *= Math.exp(-dt * 14);
      if (blocked) return;

      if (idle.action === null) {
        idle.wait -= dt;
        if (idle.wait > 0) return;
        idle.action = IDLE_ACTIONS[idle.next];
        idle.next = (idle.next + 1) % IDLE_ACTIONS.length;
        idle.time = 0;
        if (idle.action === 'roll') this.setRollTarget(true);
      }

      let finished = false;
      if (idle.action === 'groom') {
        const t = idle.time += dt;
        idle.groom = smooth01(t / 0.92) * (1 - smooth01((t - 2.58) / 0.88));
        const stroke = (t - 0.92) / 0.55;
        idle.lick = stroke > 0 && stroke < 3 ? Math.sin(Math.PI * (stroke % 1)) ** 2 : 0;
        finished = t >= 3.46;
      } else if (idle.action === 'roll') {
        if (!this.isRolling && this.isBellyUp && (idle.time += dt) >= 1.15) this.setRollTarget(false);
        finished = !this.isBellyUp && !this.isRolling;
      } else if (idle.action === 'look') {
        const t = clamp((idle.time += dt) / 2.2, 0, 1);
        idle.look = Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI) ** 2 * 0.17;
        finished = t === 1;
      }
      if (finished) {
        this.stopIdle();
        idle.wait = 10 + Math.random() * 6;
      }
    }

    triggerPawBloom(duration) {
      if (this.isFeeding) return;
      this.stopIdle(false);
      if (!this.isBellyUp) {
        this.toggleRollOver();
      }
      if (this.isRolling) {
        // Start kneading after the cat has finished settling onto its back.
        this.pendingBloomDur = Math.max(this.pendingBloom ? this.pendingBloomDur : 0, duration || 3.2);
        this.pendingBloom = true;
        return;
      }
      this.bloomTimer = Math.max(this.bloomTimer, duration || 3.2);
    }

    triggerShimmyShake() {
      if (this.isFeeding) return;
      this.stopIdle();
      this.shakeTime = 0;
    }

    hitZone(x, y) {
      if (this.isRolling || this.isFeeding || this.idle.groom > 0) return { zone: 'none' };
      const P = this.pose();
      if (this.rollMix > 0.5) {
        for (let i = 0; i < P.paws.length; i++) {
          if (Math.hypot(x - P.paws[i].c[0], y - P.paws[i].c[1]) < P.paws[i].r) return { zone: 'paw', idx: i };
        }
      }
      const h = P.head;
      const hd = Math.hypot((x - h.c[0]) / h.rx, (y - h.c[1]) / h.ry);
      if (hd < 1.0) {
        if (y < h.c[1] - h.ry * 0.35) return { zone: 'chin' };
        return { zone: 'head' };
      }
      const t = P.tail.pts;
      for (let i = 0; i < t.length - 1; i++) {
        if (distToSeg(x, y, t[i][0], t[i][1], t[i + 1][0], t[i + 1][1]).d < P.tail.r) return { zone: 'tail' };
      }
      if (this.rollMix <= 0.5) {
        for (let i = 0; i < P.paws.length; i++) {
          if (Math.hypot(x - P.paws[i].c[0], y - P.paws[i].c[1]) < P.paws[i].r) return { zone: 'paw', idx: i };
        }
      }
      const b = P.body;
      if (Math.hypot((x - b.c[0]) / b.rx, (y - b.c[1]) / b.ry) < 1.0) return { zone: 'body' };
      return { zone: 'none' };
    }

    setPointer(x, y, active, hover, isTouch) {
      const wasShown = this.pointer.active || this.pointer.hover;
      const justPressed = active && !this.pointer.active;
      this.pointer.x = x; this.pointer.y = y;
      this.pointer.active = active; this.pointer.hover = hover; this.pointer.isTouch = !!isTouch;

      if (!wasShown && (active || hover)) {
        this.hand.x = x + 0.12;
        this.hand.y = Math.min(y - 0.25, -0.6);
      }
      if (justPressed && !this.isRolling && !this.isFeeding && this.idle.groom === 0) {
        const P = this.pose();
        const hit = this.hitZone(x, y);
        if (Math.hypot(x - P.mouth[0], y - P.mouth[1]) < 0.045 && this.onReflexMeow) this.onReflexMeow(0);
        if (hit.zone === 'paw') {
          if (this.rollMix > 0.5) {
            this.pawBloom[hit.idx] = Math.max(this.pawBloom[hit.idx], 0.01);
            this._pokePaw = { idx: hit.idx, t: 1.4 };
          }
          if (this.onReflexMeow) this.onReflexMeow(3);
        }
      }
    }

    step(rawDt, allowIdle = true) {
      const dt = clamp(rawDt, 0.001, 0.033);
      this.time += dt;
      const soft = this.softness;
      this.stepIdle(dt, allowIdle);

      // Limit acceleration when setting off, slowing down, or reversing mid-roll.
      if (this.isRolling && this.idle.groom === 0) {
        const remaining = Number(this.isBellyUp) - this.rollMix;
        const acceleration = 5;
        const cruise = this.isBellyUp ? 1.14 : 1.01;
        const desired = Math.sign(remaining) * Math.min(cruise, Math.sqrt(2 * acceleration * Math.abs(remaining)));
        this.rollVel += clamp(desired - this.rollVel, -acceleration * dt, acceleration * dt);
        this.rollMix = clamp(this.rollMix + this.rollVel * dt, 0, 1);
        if (this.rollMix === 0 || this.rollMix === 1) this.rollVel = 0;
      }
      if (this.pendingBloom && !this.isRolling && this.isBellyUp) {
        this.pendingBloom = false;
        this.bloomTimer = Math.max(this.bloomTimer, this.pendingBloomDur);
      }
      this.stepFeeding(dt);
      const P = this.pose();

      // ---------- Shake ----------
      if (this.shakeTime >= 0) {
        this.shakeTime += dt;
        if (this.shakeTime > 0.9) this.shakeTime = -1;
      }

      // ---------- Hand kinematics ----------
      const wantHand = !this.isFeeding && (this.pointer.active || (this.pointer.hover && !this.pointer.isTouch));
      const H = this.hand;
      H.visible += ((wantHand ? 1 : 0) - H.visible) * Math.min(1, dt * (wantHand ? 12 : 6));
      const tx = wantHand ? this.pointer.x : H.x + 0.1;
      const ty = wantHand ? this.pointer.y : -0.75;
      const px = H.x, py = H.y;
      const follow = 1 - Math.exp(-(this.pointer.active ? 26 : 18) * dt);
      H.x += (tx - H.x) * follow;
      H.y += (ty - H.y) * follow;
      const ivx = (H.x - px) / dt, ivy = (H.y - py) / dt;
      H.smoothVx += (ivx - H.smoothVx) * Math.min(1, dt * 14);
      H.smoothVy += (ivy - H.smoothVy) * Math.min(1, dt * 14);
      H.speed = Math.hypot(H.smoothVx, H.smoothVy);
      const shoulderX = 0.42 + H.x * 0.3;
      const rawAng = Math.atan2(shoulderX - H.x, H.y + 0.95) * 0.75 - H.smoothVx * 0.04;
      H.angle += (clamp(rawAng, -0.2, 0.7) - H.angle) * Math.min(1, dt * 12);

      const hit = this.hitZone(H.x, H.y);
      const onCat = hit.zone !== 'none';
      const engage = this.pointer.active ? 1 : (this.pointer.hover && !this.pointer.isTouch ? 0.35 : 0);
      H.pressure += ((onCat ? engage : 0) - H.pressure) * Math.min(1, dt * 15);
      H.zone = H.pressure > 0.08 ? hit.zone : 'none';

      // ---------- Bliss / purr ----------
      if (H.pressure > 0.08) {
        this.petEnergy = Math.min(1, this.petEnergy + dt * (0.35 + Math.min(1.5, H.speed) * 0.6) * H.pressure);
      } else {
        this.petEnergy = Math.max(0, this.petEnergy - dt * 0.15);
      }
      this.purrIntensity += ((0.2 + 0.8 * this.petEnergy) - this.purrIntensity) * Math.min(1, dt * 3);
      this.breathPhase = (this.breathPhase + dt * (0.34 - 0.04 * this.petEnergy)) % 1;

      // ---------- Eyes: blink + bliss squint ----------
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) { this.blinkTimer = 3 + Math.random() * 4.5; this.blinkPhase = 1; }
      if (this.blinkPhase > 0) this.blinkPhase = Math.max(0, this.blinkPhase - dt * 5);
      const blink = Math.sin(this.blinkPhase * Math.PI);
      const squint = clamp(this.petEnergy * 1.1 - 0.15 + ((H.zone === 'head' || H.zone === 'chin') ? 0.45 : 0), 0, 1);
      this.eyeClose += (Math.max(blink, squint) - this.eyeClose) * Math.min(1, dt * 10);

      // ---------- Head nuzzle / chin lift ----------
      let tTilt = 0, tLift = 0;
      if (H.pressure > 0.02 && (H.zone === 'head' || H.zone === 'chin')) {
        const w = H.pressure;
        tTilt = clamp(-(H.x - P.head.c[0]) * 1.6 - H.smoothVx * 0.12, -0.2, 0.2) * w;
        if (H.zone === 'chin') tLift = 0.012 * w;
      }
      this.head.vTilt = (this.head.vTilt + (tTilt - this.head.tilt) * 40 * dt) * Math.exp(-8 * dt);
      this.head.tilt += this.head.vTilt * dt;
      this.head.vLift = (this.head.vLift + (tLift - this.head.lift) * 40 * dt) * Math.exp(-8 * dt);
      this.head.lift += this.head.vLift * dt;

      // ---------- Ears: twitch + flatten under hand ----------
      for (let e = 0; e < 2; e++) {
        const ear = this.ears[e];
        const base = P.ears[e].base;
        const side = base[0] < P.head.c[0] ? 1 : -1; // rotate outward
        ear.timer -= dt;
        if (ear.timer <= 0) { ear.timer = 3 + Math.random() * 6; ear.v += side * 1.6; }
        let target = 0;
        if (H.visible > 0.2) {
          const d = Math.hypot(H.x - base[0], H.y - (base[1] + P.ears[e].r * 0.6));
          if (d < P.ears[e].r * 1.8) target = side * 0.32 * (1 - d / (P.ears[e].r * 1.8)) * Math.max(H.pressure, 0.4);
        }
        ear.v = (ear.v + (target - ear.ang) * 60 * dt) * Math.exp(-9 * dt);
        ear.ang += ear.v * dt;
      }

      // ---------- Tail: lazy wag + hand drag ----------
      {
        const T = this.tail;
        const wagAmp = 0.05 + this.petEnergy * 0.05;
        T.phase += dt * (1.3 + this.petEnergy);
        const wag = Math.sin(T.phase) * wagAmp;
        let tDrag = 0;
        if (H.zone === 'tail' && H.pressure > 0.05) {
          // drag along the tail rotates it around its base
          const b = P.tail.pts[0];
          const rx = H.x - b[0], ry = H.y - b[1];
          const r2 = Math.max(0.01, rx * rx + ry * ry);
          tDrag = clamp((rx * H.smoothVy - ry * H.smoothVx) / r2 * 0.06, -0.35, 0.35);
        }
        T.vDrag = (T.vDrag + (tDrag - T.drag) * 30 * dt) * Math.exp(-6 * dt);
        T.drag += T.vDrag * dt;
        T.v = (T.v + (wag - T.ang) * 20 * dt) * Math.exp(-5 * dt);
        T.ang += T.v * dt;
      }

      // ---------- Paw bloom (belly-up) + kneading ----------
      if (this.bloomTimer > 0) this.bloomTimer = Math.max(0, this.bloomTimer - dt);
      if (this._pokePaw) {
        this._pokePaw.t -= dt;
        if (this._pokePaw.t <= 0) this._pokePaw = null;
      }
      const autoBloom = !this.isRolling && this.isBellyUp && this.petEnergy > 0.75 && H.zone === 'body' && H.speed > 0.12;
      if (autoBloom) this.bloomTimer = Math.max(this.bloomTimer, 0.6);
      const bloomOn = this.bloomTimer > 0;
      for (let i = 0; i < 4; i++) {
        const phase = this.time * 4.2 + (i % 2 ? Math.PI : 0) + (i >= 2 ? 0.9 : 0);
        const kn = Math.max(0, Math.sin(phase));
        let target = bloomOn ? (0.55 + 0.45 * kn) : 0;
        if (this._pokePaw && this._pokePaw.idx === i) target = 1;
        if (this.rollMix < 0.6) target = 0;
        this.pawBloom[i] += (target - this.pawBloom[i]) * Math.min(1, dt * 12);
        this.knead[i] = bloomOn ? kn : this.knead[i] * Math.exp(-6 * dt);
      }

      // ---------- Viscoelastic skin kernels ----------
      if (H.pressure > 0.05 && onCat) {
        let k = this.activeK >= 0 ? this.kelvin[this.activeK] : null;
        if (!k || Math.hypot(H.x - (k.cx + k.dx), H.y - (k.cy + k.dy)) > 0.05) {
          this.activeK = (this.activeK + 1) % NUM_KELVIN;
          k = this.kelvin[this.activeK];
          k.cx = H.x; k.cy = H.y; k.dx = 0; k.dy = 0; k.vx = 0; k.vy = 0;
          k.r = 0.075;
        }
        // skin is dragged by friction toward hand, capped by tissue stretch
        const maxStretch = 0.028 * soft;
        let gx = (H.x - k.cx), gy = (H.y - k.cy);
        const gl = Math.hypot(gx, gy);
        if (gl > maxStretch) { gx *= maxStretch / gl; gy *= maxStretch / gl; }
        const grip = H.pressure;
        k.vx += (gx * grip - k.dx) * 220 * dt;
        k.vy += (gy * grip - k.dy) * 220 * dt;
      } else {
        this.activeK = -1;
      }
      const kOmega = 150 / (0.5 + 0.5 * soft);
      const kDamp = Math.exp(-7.5 * dt);
      for (let i = 0; i < NUM_KELVIN; i++) {
        const k = this.kelvin[i];
        if (i !== this.activeK) {
          k.vx -= k.dx * kOmega * dt;
          k.vy -= k.dy * kOmega * dt;
        }
        k.vx *= kDamp; k.vy *= kDamp;
        k.dx += k.vx * dt; k.dy += k.vy * dt;
      }

      this._prepareFrame();
    }

    // Cache per-frame constants for displace()
    _prepareFrame() {
      // The purr is acoustic. The chest follows one slow inhale/exhale cycle.
      const breath = (1 - Math.cos(this.breathPhase * 2 * Math.PI)) * 0.006;
      let shakeEnv = 0;
      if (this.shakeTime >= 0) shakeEnv = Math.sin((this.shakeTime / 0.9) * Math.PI);

      const hd = this.hand;
      // Compute 5 finger pad positions in stage coordinates for fur combing
      if (!this.fingerBuf) this.fingerBuf = new Float32Array(20);
      const ca = Math.cos(hd.angle), sa = Math.sin(hd.angle);
      const fOff = [
        [-0.058, 0.022, 0.018],
        [-0.036, 0.084, 0.017],
        [-0.011, 0.098, 0.018],
        [ 0.013, 0.090, 0.017],
        [ 0.034, 0.068, 0.015]
      ];
      for (let f = 0; f < 5; f++) {
        this.fingerBuf[f * 4 + 0] = hd.x + ca * fOff[f][0] - sa * fOff[f][1];
        this.fingerBuf[f * 4 + 1] = hd.y + sa * fOff[f][0] + ca * fOff[f][1];
        this.fingerBuf[f * 4 + 2] = fOff[f][2];
        this.fingerBuf[f * 4 + 3] = 1.0;
      }

      this._frame = {
        size: this.sizeScale,
        chonk: this.chonkScale,
        headTilt: this.head.tilt + this.idle.look + (shakeEnv ? Math.sin(this.shakeTime * 46) * shakeEnv * 0.1 : 0),
        headLift: this.head.lift - this.feed.nibble * 0.016,
        lick: this.idle.lick,
        breath,
        earAng: [this.ears[0].ang, this.ears[1].ang],
        tailAng: this.tail.ang + this.tail.drag,
        knead: this.knead.slice(),
        shakeEnv,
        shakeT: this.shakeTime,
        press: hd.pressure * (this.pointer.active ? 1 : 0.3),
        hx: hd.x, hy: hd.y,
        kelvin: this.kelvin
      };
    }

    /**
     * Displacement of the photo at rest stage position (x, y).
     * Returns new position via out array [nx, ny], smoothly pinned at outer image borders!
     */
    displace(x, y, out, P) {
      const F = this._frame;
      let nx = x, ny = y;

      // Smooth border lock so outer edges of the studio backdrop never pull inward!
      const edgeX = 0.5 * IMG_ASPECT - Math.abs(x);
      const edgeY = 0.5 - Math.abs(y);
      const borderPin = smooth01(Math.min(edgeX, edgeY) / 0.075);
      if (borderPin <= 0.0001) {
        out[0] = x;
        out[1] = y;
        return;
      }

      // Region weights
      const head = P.head;
      const dHead = Math.hypot((x - head.c[0]) / head.rx, (y - head.c[1]) / head.ry);
      const wHead = falloff(dHead, 0.85, 1.45);
      const body = P.body;
      const dBody = Math.hypot((x - body.c[0]) / body.rx, (y - body.c[1]) / body.ry);
      const wCat = Math.max(wHead, falloff(dBody, 0.9, 1.42));

      // User customization: Overall Size & Chonkiness (horizontal body plumpness)
      if (Math.abs(F.chonk - 1.0) > 0.002) {
        const wTorso = falloff(dBody, 0.75, 1.35) * (1.0 - wHead * 0.65);
        nx += (x - body.c[0]) * (F.chonk - 1.0) * 0.65 * wTorso;
      }
      if (Math.abs(F.size - 1.0) > 0.002) {
        // Keep the feet on the floor behind the bowl as it appears. At the
        // lowest pose, scale the head around its mouth to meet the same rim.
        const floorWeight = this.feed.opacity * smooth01((-0.28 - y) / 0.12);
        let sizePivotY = mix(body.c[1], -0.41, floorWeight);
        if (P === this.poses.feedEat) sizePivotY = mix(sizePivotY, P.mouth[1], wHead);
        nx += (x - body.c[0]) * (F.size - 1.0) * 0.75 * wCat;
        ny += (y - sizePivotY) * (F.size - 1.0) * 0.75 * wCat;
      }

      // Breathing: chest expands radially
      const ch = P.chest;
      const dCh = Math.hypot(x - ch.c[0], y - ch.c[1]);
      const breath = F.breath * ch.breathScale * falloff(dCh, ch.r * 0.3, ch.r * 1.4) * (1 - wHead * 0.8);
      nx += (x - ch.c[0]) * breath;
      ny += (y - ch.c[1]) * breath;

      // Kneading paws (sit: lift front paws; belly: push paws upward a touch)
      for (let i = 0; i < P.paws.length; i++) {
        if (F.knead[i] <= 0.001) continue;
        const pw = P.paws[i];
        const w = falloff(Math.hypot(x - pw.c[0], y - pw.c[1]), pw.r * 0.5, pw.r * 1.3);
        ny += F.knead[i] * 0.010 * w;
      }

      // Ears rotate around their bases
      for (let e = 0; e < 2; e++) {
        const a = F.earAng[e];
        if (Math.abs(a) < 1e-4) continue;
        const eb = P.ears[e];
        const d = Math.hypot(x - eb.base[0], y - (eb.base[1] + eb.r * 0.5));
        const w = falloff(d, eb.r * 0.55, eb.r * 1.15);
        if (w <= 0) continue;
        const ang = a * w;
        const rx = nx - eb.base[0], ry = ny - eb.base[1];
        const c = Math.cos(ang), s = Math.sin(ang);
        nx = eb.base[0] + rx * c - ry * s;
        ny = eb.base[1] + rx * s + ry * c;
      }

      // Head rotation around the neck pivot + chin lift
      if (wHead > 0) {
        const groomLift = P === this.poses.groom ? 1 - F.lick : 0;
        const ang = (F.headTilt + groomLift * 0.025) * wHead;
        const rx = nx - P.neck[0], ry = ny - P.neck[1];
        const c = Math.cos(ang), s = Math.sin(ang);
        nx = P.neck[0] + rx * c - ry * s;
        ny = P.neck[1] + rx * s + ry * c + (F.headLift + groomLift * 0.012) * wHead;
      }

      // Tail rotation around base, increasing toward the tip
      {
        const tp = P.tail.pts;
        let best = 1e9, bestT = 0, seg = 0;
        for (let i = 0; i < tp.length - 1; i++) {
          const r = distToSeg(x, y, tp[i][0], tp[i][1], tp[i + 1][0], tp[i + 1][1]);
          if (r.d < best) { best = r.d; bestT = r.t; seg = i; }
        }
        const w = falloff(best, P.tail.r * 0.8, P.tail.r * 1.6);
        if (w > 0) {
          const along = (seg + bestT) / (tp.length - 1);
          const ang = F.tailAng * w * smooth01(along * 1.3);
          const b = tp[0];
          const rx = nx - b[0], ry = ny - b[1];
          const c = Math.cos(ang), s = Math.sin(ang);
          nx = b[0] + rx * c - ry * s;
          ny = b[1] + rx * s + ry * c;
        }
      }

      // Viscoelastic skin: dragged + jiggling kernels
      const K = F.kelvin;
      for (let i = 0; i < K.length; i++) {
        const k = K[i];
        if (Math.abs(k.dx) + Math.abs(k.dy) < 1e-5) continue;
        const rx = x - k.cx, ry = y - k.cy;
        const e2 = k.r * k.r;
        const q = e2 / (rx * rx + ry * ry + e2);
        const w = q * Math.sqrt(q) * wCat;
        nx += k.dx * w;
        ny += k.dy * w;
      }

      // Palm pressure: flesh bulges outward around the contact point
      if (F.press > 0.02) {
        const rx = x - F.hx, ry = y - F.hy;
        const g = Math.exp(-(rx * rx + ry * ry) / 0.0045);
        nx += rx * g * 0.22 * F.press * wCat;
        ny += ry * g * 0.22 * F.press * wCat;
      }

      // Shimmy shake: lateral wave head -> tail
      if (F.shakeEnv > 0) {
        nx += Math.sin(F.shakeT * 46 - y * 9) * F.shakeEnv * 0.012 * wCat;
      }

      out[0] = x + (nx - x) * borderPin;
      out[1] = y + (ny - y) * borderPin;
    }
  }

  global.CatPhysics = CatPhysics;
  global.CAT_IMG_ASPECT = IMG_ASPECT;
})(window);
