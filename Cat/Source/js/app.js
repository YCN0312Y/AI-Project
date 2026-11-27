(function () {
  'use strict';

  const STORAGE_KEY = 'persianCatSim.schemeB.v1';

  const ICON_SUN = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4.2"></circle>
      <line x1="12" y1="2.2" x2="12" y2="4.6"></line>
      <line x1="12" y1="19.4" x2="12" y2="21.8"></line>
      <line x1="4.9" y1="4.9" x2="6.6" y2="6.6"></line>
      <line x1="17.4" y1="17.4" x2="19.1" y2="19.1"></line>
      <line x1="2.2" y1="12" x2="4.6" y2="12"></line>
      <line x1="19.4" y1="12" x2="21.8" y2="12"></line>
      <line x1="4.9" y1="19.1" x2="6.6" y2="17.4"></line>
      <line x1="17.4" y1="6.6" x2="19.1" y2="4.9"></line>
    </svg>
  `;

  const ICON_MOON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.4 14.6A8.5 8.5 0 0 1 9.4 3.6a8.5 8.5 0 1 0 11 11z"></path>
    </svg>
  `;

  const ICON_SPEAKER_ON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M15.2 8.8a4.8 4.8 0 0 1 0 6.4"></path>
      <path d="M18.4 5.8a9 9 0 0 1 0 12.4"></path>
    </svg>
  `;

  const ICON_SPEAKER_OFF = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <line x1="22" y1="9" x2="16" y2="15"></line>
      <line x1="16" y1="9" x2="22" y2="15"></line>
    </svg>
  `;

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function savePrefs(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function init() {
    const canvas = document.getElementById('catCanvas');
    const stageWrap = document.getElementById('stageWrap');
    const errorBox = document.getElementById('webglError');
    const btnLight = document.getElementById('btnLight');
    const btnOrbit = document.getElementById('btnOrbit');
    const orbitControls = document.getElementById('orbitControls');
    const orbitSlider = document.getElementById('orbitAngle');
    const orbitReadout = document.getElementById('orbitReadout');

    const btnRoll = document.getElementById('btnRoll');
    const labelRoll = document.getElementById('labelRoll');
    const btnAudio = document.getElementById('btnAudio');
    const iconAudio = document.getElementById('iconAudio');
    const labelPurr = document.getElementById('labelPurr');
    const btnMeow = document.getElementById('btnMeow');
    const btnBloom = document.getElementById('btnBloom');
    const btnFeed = document.getElementById('btnFeed');
    const labelFeed = document.getElementById('labelFeed');

    const btnSettings = document.getElementById('btnSettings');
    const btnShake = document.getElementById('btnShake');
    const btnVibrate = document.getElementById('btnVibrate');
    const settingsDrawer = document.getElementById('settingsDrawer');

    const sliderChonk = document.getElementById('sliderChonk');
    const sliderSize = document.getElementById('sliderSize');
    const sliderFur = document.getElementById('sliderFur');
    const sliderSoft = document.getElementById('sliderSoft');
    const valChonk = document.getElementById('valChonk');
    const valSize = document.getElementById('valSize');
    const valFur = document.getElementById('valFur');
    const valSoft = document.getElementById('valSoft');
    const btnToggleHand = document.getElementById('btnToggleHand');
    const btnBrushReset = document.getElementById('btnBrushReset');
    const btnResetAll = document.getElementById('btnResetAll');

    const physics = new window.CatPhysics(window.CAT_PHOTO_LAYOUT);
    const audio = new window.CatAudio();
    const feedBowl = new window.CatFeedBowl(document.getElementById('feedCanvas'), canvas);
    physics.onFeedCrunch = () => audio.playFeedCrunch();

    // Connect reflexive meow events (tapping nose/face or tickling paws!)
    physics.onReflexMeow = (variant) => {
      audio.playMeow(variant);
    };

    let renderer;
    try {
      renderer = new window.CatRenderer(canvas, feedBowl);
    } catch (err) {
      errorBox.style.display = 'flex';
      errorBox.textContent = '无法初始化 WebGL2 渲染器：' + err.message;
      return;
    }

    const saved = loadPrefs() || {};
    const state = {
      nightMode: !!saved.nightMode,
      audioOn: saved.audioOn !== undefined ? !!saved.audioOn : true,
      hapticsOn: !!saved.hapticsOn,
      showHand: saved.showHand !== undefined ? !!saved.showHand : true,
      chonk: typeof saved.chonk === 'number' ? saved.chonk : 1.0,
      size: typeof saved.size === 'number' ? saved.size : 1.0,
      furLength: typeof saved.furLength === 'number' ? saved.furLength : 1.0,
      softness: typeof saved.softness === 'number' ? saved.softness : 1.0
    };

    let activePointerId = null;
    let isPressing = false;
    let isHovering = false;
    let lastIsTouch = false;
    const heldKeys = new Set();
    let orbiting = false;
    let orbitAngle = 0;
    let orbitDragX = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function setOrbitAngle(angle) {
      orbitAngle = ((angle % 360) + 360) % 360;
      const degree = Math.round(orbitAngle) % 360;
      orbitSlider.value = degree;
      orbitReadout.value = degree + '°';
    }

    function clearStageDrag() {
      const id = activePointerId;
      activePointerId = null;
      isPressing = false;
      stageWrap.classList.remove('is-dragging');
      if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }

    function releaseStagePointer() {
      clearStageDrag();
      isHovering = false;
      physics.setPointer(physics.pointer.x, physics.pointer.y, false, false, lastIsTouch);
    }

    function setOrbitMode(enabled) {
      if (enabled === orbiting || (enabled && (!renderer.orbitReady || physics.isFeeding))) return;
      orbiting = enabled;
      if (orbiting) physics.stopIdle();
      heldKeys.clear();
      releaseStagePointer();
      btnOrbit.setAttribute('aria-pressed', String(orbiting));
      btnOrbit.textContent = orbiting ? '返回抚摸' : '360° 查看';
      stageWrap.classList.toggle('is-orbiting', orbiting);
      orbitControls.hidden = !orbiting;
    }

    btnOrbit.addEventListener('click', () => setOrbitMode(!orbiting));
    orbitSlider.addEventListener('input', () => setOrbitAngle(orbitSlider.valueAsNumber));
    document.getElementById('btnOrbitReset').addEventListener('click', () => setOrbitAngle(0));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) physics.stopIdle();
    });

    function syncRollControl() {
      const label = physics.isBellyUp ? '翻回端坐' : '翻身';
      if (labelRoll.textContent === label) return;
      labelRoll.textContent = label;
      btnRoll.classList.toggle('active', physics.isBellyUp);
    }

    function applyStateToSystems() {
      renderer.setNightMode(state.nightMode);
      renderer.setShowHand(state.showHand);
      physics.setCustomization({
        chonk: state.chonk,
        size: state.size,
        furLength: state.furLength,
        softness: state.softness
      });
      audio.setEnabled(state.audioOn);
      audio.hapticsEnabled = state.hapticsOn;

      btnLight.innerHTML = state.nightMode ? ICON_MOON : ICON_SUN;
      btnLight.title = state.nightMode ? '切换为柔光摄影棚 (L)' : '切换为夜晚暖光房间 (L)';

      iconAudio.innerHTML = state.audioOn ? ICON_SPEAKER_ON : ICON_SPEAKER_OFF;
      btnAudio.classList.toggle('active', state.audioOn);
      labelPurr.textContent = state.audioOn ? '打呼噜' : '已静音';

      syncRollControl();

      btnVibrate.classList.toggle('active', state.hapticsOn);
      btnToggleHand.classList.toggle('active', state.showHand);
      btnToggleHand.textContent = state.showHand ? '手部显示：开' : '手部显示：关';
      stageWrap.classList.toggle('hide-cursor', state.showHand);

      sliderChonk.value = Math.round(state.chonk * 100);
      sliderSize.value = Math.round(state.size * 100);
      sliderFur.value = Math.round(state.furLength * 100);
      sliderSoft.value = Math.round(state.softness * 100);

      valChonk.textContent = Math.round(state.chonk * 100) + '%';
      valSize.textContent = Math.round(state.size * 100) + '%';
      valFur.textContent = Math.round(state.furLength * 100) + '%';
      valSoft.textContent = Math.round(state.softness * 100) + '%';
    }

    applyStateToSystems();

    const unlockOnce = () => { audio.unlockOnGesture(); };
    window.addEventListener('pointerdown', unlockOnce, { passive: true });
    window.addEventListener('keydown', unlockOnce, { passive: true });

    // ==================== CORE FEATURE BUTTONS ====================
    function doRollOver() {
      if (physics.isFeeding) return;
      setOrbitMode(false);
      physics.toggleRollOver();
      renderer.resetGroom();
      applyStateToSystems();
    }

    function doMeow() {
      if (physics.isFeeding) return;
      setOrbitMode(false);
      physics.stopIdle();
      audio.unlockOnGesture();
      audio.playMeow(Math.random() < 0.6 ? 0 : 1);
      btnMeow.classList.add('active');
      setTimeout(() => btnMeow.classList.remove('active'), 650);
    }

    function doPawBloom() {
      if (physics.isFeeding) return;
      setOrbitMode(false);
      audio.unlockOnGesture();
      if (!physics.isBellyUp) renderer.resetGroom();
      physics.triggerPawBloom(3.2);
      audio.playMeow(3);
      applyStateToSystems();
    }

    function syncFeedingControls() {
      const busy = physics.isFeeding;
      if (btnRoll.disabled !== busy) {
        btnRoll.disabled = busy;
        btnMeow.disabled = busy;
        btnBloom.disabled = busy;
        btnShake.disabled = busy;
        btnFeed.classList.toggle('active', busy);
        stageWrap.classList.toggle('is-feeding', busy);
      }
      btnOrbit.disabled = busy || !renderer.orbitReady;
      btnFeed.disabled = busy || !renderer.feedReady;
      let label = '喂猫粮';
      if (busy) {
        if (physics.isRolling) label = '等猫坐稳';
        else if (physics.feed.eaten > 0 && physics.feed.fill === 0) label = '吃完啦';
        else if (physics.feed.bend >= 0.98) label = '正在吃';
        else label = '准备吃';
      }
      if (labelFeed.textContent !== label) labelFeed.textContent = label;
    }

    function doFeed() {
      if (!renderer.feedReady || !physics.startFeeding()) return;
      if (orbiting) setOrbitMode(false);
      else {
        heldKeys.clear();
        releaseStagePointer();
      }
      audio.unlockOnGesture();
      renderer.resetGroom();
      applyStateToSystems();
      syncFeedingControls();
    }

    btnRoll.addEventListener('click', doRollOver);
    btnMeow.addEventListener('click', doMeow);
    btnBloom.addEventListener('click', doPawBloom);
    btnFeed.addEventListener('click', doFeed);

    btnAudio.addEventListener('click', () => {
      state.audioOn = audio.toggleAudio();
      applyStateToSystems();
      savePrefs(state);
    });

    btnLight.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.unlockOnGesture();
      state.nightMode = !state.nightMode;
      applyStateToSystems();
      savePrefs(state);
    });

    btnSettings.addEventListener('click', () => {
      audio.unlockOnGesture();
      const open = settingsDrawer.classList.toggle('open');
      btnSettings.classList.toggle('active', open);
    });

    btnShake.addEventListener('click', () => {
      setOrbitMode(false);
      audio.unlockOnGesture();
      physics.triggerShimmyShake();
    });

    btnVibrate.addEventListener('click', () => {
      audio.unlockOnGesture();
      state.hapticsOn = audio.toggleHaptics();
      applyStateToSystems();
      savePrefs(state);
    });

    function onSliderInput() {
      state.chonk = Number(sliderChonk.value) / 100;
      state.size = Number(sliderSize.value) / 100;
      state.furLength = Number(sliderFur.value) / 100;
      state.softness = Number(sliderSoft.value) / 100;
      applyStateToSystems();
      savePrefs(state);
    }

    sliderChonk.addEventListener('input', onSliderInput);
    sliderSize.addEventListener('input', onSliderInput);
    sliderFur.addEventListener('input', onSliderInput);
    sliderSoft.addEventListener('input', onSliderInput);

    btnToggleHand.addEventListener('click', () => {
      state.showHand = !state.showHand;
      applyStateToSystems();
      savePrefs(state);
    });

    btnBrushReset.addEventListener('click', () => {
      setOrbitMode(false);
      physics.triggerShimmyShake();
    });

    btnResetAll.addEventListener('click', () => {
      state.chonk = 1.0;
      state.size = 1.0;
      state.furLength = 1.0;
      state.softness = 1.0;
      state.showHand = true;
      renderer.resetGroom();
      physics.triggerShimmyShake();
      applyStateToSystems();
      savePrefs(state);
    });

    // ==================== STAGE POINTER INTERACTION ====================
    function clientToStage(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const aspect = w / h;
      const uvX = (clientX - rect.left) / w;
      const uvY = 1.0 - (clientY - rect.top) / h;
      return {
        x: (uvX - 0.5) * aspect,
        y: uvY - 0.5
      };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if ((activePointerId !== null && activePointerId !== e.pointerId) || e.button !== 0) return;
      audio.unlockOnGesture();
      activePointerId = e.pointerId;
      isPressing = true;
      isHovering = true;
      lastIsTouch = e.pointerType === 'touch';
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      if (orbiting) {
        orbitDragX = e.clientX;
        stageWrap.classList.add('is-dragging');
        return;
      }
      const pt = clientToStage(e.clientX, e.clientY);
      physics.setPointer(pt.x, pt.y, true, true, lastIsTouch);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (orbiting) {
        if (activePointerId === e.pointerId) {
          const delta = (e.clientX - orbitDragX) * 360 / Math.max(1, canvas.clientWidth);
          setOrbitAngle(orbitAngle - delta);
          orbitDragX = e.clientX;
        }
        return;
      }
      lastIsTouch = e.pointerType === 'touch';
      isHovering = true;
      const pt = clientToStage(e.clientX, e.clientY);
      physics.setPointer(pt.x, pt.y, isPressing, !lastIsTouch, lastIsTouch);
    });

    function endPointer(e) {
      if (e.pointerId !== activePointerId) return;
      if (orbiting || e.type !== 'pointerup' || e.pointerType === 'touch') {
        releaseStagePointer();
        return;
      }
      clearStageDrag();
      const pt = clientToStage(e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      isHovering = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      physics.setPointer(pt.x, pt.y, false, isHovering, false);
    }

    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('lostpointercapture', endPointer);
    canvas.addEventListener('pointerleave', () => {
      if (!isPressing) releaseStagePointer();
    });

    // ==================== KEYBOARD SHORTCUTS ====================
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (orbiting && key === 'escape') {
        setOrbitMode(false);
        btnOrbit.focus();
        return;
      }
      const target = e.target?.tagName;
      if (target === 'INPUT' || target === 'TEXTAREA' || (target === 'BUTTON' && key === ' ')) return;
      if (key === 'v') {
        if (!e.repeat) setOrbitMode(!orbiting);
      } else if (orbiting && (key === 'arrowleft' || key === 'arrowright')) {
        e.preventDefault();
        setOrbitAngle(orbitAngle + (key === 'arrowleft' ? -15 : 15));
      } else if (!orbiting && !physics.isFeeding && key === ' ') {
        e.preventDefault();
        heldKeys.add('space');
      } else if (!orbiting && !physics.isFeeding && key === 'h') {
        heldKeys.add('h');
      } else if (!orbiting && !physics.isFeeding && key === 't') {
        heldKeys.add('t');
      } else if (key === 'r') {
        if (!e.repeat) doRollOver();
      } else if (key === 'c') {
        doMeow();
      } else if (key === 'p') {
        doPawBloom();
      } else if (key === 'f') {
        if (!e.repeat) doFeed();
      } else if (key === 's') {
        setOrbitMode(false);
        physics.triggerShimmyShake();
      } else if (key === 'l') {
        state.nightMode = !state.nightMode;
        applyStateToSystems();
        savePrefs(state);
      } else if (key === 'm') {
        state.audioOn = audio.toggleAudio();
        applyStateToSystems();
        savePrefs(state);
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (key === ' ') heldKeys.delete('space');
      if (key === 'h') heldKeys.delete('h');
      if (key === 't') heldKeys.delete('t');
      if (!orbiting && heldKeys.size === 0 && !isPressing && !isHovering) {
        physics.setPointer(physics.pointer.x, physics.pointer.y, false, false, true);
      }
    });

    // ==================== MAIN 60/120FPS LOOP ====================
    let lastTime = performance.now();

    function frame(now) {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
      lastTime = now;

      if (heldKeys.size > 0 && !isPressing) {
        const t = physics.time;
        const sz = physics.sizeScale;
        if (heldKeys.has('space')) {
          const phase = (t * 0.72) % 1.0;
          physics.setPointer(Math.sin(t * 2.2) * 0.06 * sz, (0.08 - phase * 0.30) * sz, true, true, false);
        } else if (heldKeys.has('h')) {
          physics.setPointer(Math.cos(t * 4.0) * 0.09 * sz, (0.18 + Math.sin(t * 4.0) * 0.06) * sz, true, true, false);
        } else if (heldKeys.has('t')) {
          const dir = physics.isBellyUp ? 1.0 : -1.0;
          const phase = (t * 0.75) % 1.0;
          physics.setPointer(dir * (0.14 + phase * 0.22) * sz, (-0.27 - Math.sin(phase * Math.PI) * 0.03) * sz, true, true, false);
        }
      }

      physics.step(dt, !orbiting && !document.hidden && !reducedMotion.matches && renderer.feedReady);
      audio.update(physics, dt);
      renderer.render(physics, audio, dt, orbiting ? orbitAngle : null);
      syncRollControl();
      syncFeedingControls();

      btnBloom.classList.toggle('active', physics.bloomTimer > 0.05);
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
