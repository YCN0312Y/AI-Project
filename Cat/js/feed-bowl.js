(function (global) {
  'use strict';

  // Distribute grains once so they stay put between bites.
  const grains = Array.from({ length: 25 }, (_, i) => {
    const radius = Math.sqrt((i + 0.6) / 25);
    const angle = i * 2.399963;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      angle: i * 0.73,
      size: 0.78 + (i % 5) * 0.08,
      shade: i % 3,
      order: (i * 16) % 25
    };
  }).sort((a, b) => a.y - b.y);

  const KIBBLE = [
    ['#a0643a', '#50301f'],
    ['#815330', '#382116'],
    ['#bb8051', '#533322']
  ];

  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }

  function grain(ctx, x, y, size, item) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(item.angle);
    const color = ctx.createLinearGradient(0, -size, 0, size);
    color.addColorStop(0, KIBBLE[item.shade][0]);
    color.addColorStop(1, KIBBLE[item.shade][1]);
    ctx.fillStyle = color;
    ellipse(ctx, 0, 0, size, size * 0.70);
    ctx.fill();
    ctx.restore();
  }

  class CatFeedBowl {
    constructor(canvas, stage) {
      this.canvas = canvas;
      this.stage = stage;
      this.ctx = canvas.getContext('2d');
      this.interior = document.createElement('canvas');
      this.interiorCtx = this.interior.getContext('2d');
      this.bounds = new Float32Array(4);
    }

    draw(feed, nightMix) {
      const front = this.ctx;
      const ctx = this.interiorCtx;
      const visible = feed.opacity > 0.003;
      this.canvas.hidden = !visible;
      if (!visible || !front || !ctx) return false;

      const w = this.stage.width, h = this.stage.height;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      const [mouthX, mouthY] = global.CAT_PHOTO_LAYOUT.feedEat.mouth;
      const photoWidth = h * global.CAT_IMG_ASPECT;
      const x = w * 0.5 + (mouthX - 0.5) * photoWidth;
      const y = h * (mouthY + 0.034);
      const rx = photoWidth * 0.091, ry = h * 0.024;
      const depth = h * 0.043;

      const left = Math.floor(x - rx * 1.32);
      const top = Math.floor(y - h * 0.106);
      const width = Math.ceil(x + rx * 1.26) - left;
      const height = Math.ceil(y + depth + ry * 1.25) - top;
      if (this.interior.width !== width || this.interior.height !== height) {
        this.interior.width = width;
        this.interior.height = height;
      }
      this.bounds.set([left / w, top / h, width / w, height / h]);
      const lighting = 'brightness(' + (1 - nightMix * 0.38) + ')';

      // The studio pass draws the contents and shadow behind the cat's matte.
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(-left, -top);
      ctx.globalAlpha = feed.opacity;
      ctx.filter = lighting;

      ctx.save();
      ctx.translate(x - rx * 0.06, y + depth * 0.91);
      ctx.scale(rx * 1.23, ry * 1.20);
      const shadow = ctx.createRadialGradient(0, 0, 0.03, 0, 0, 1);
      shadow.addColorStop(0, 'rgba(23,18,14,.48)');
      shadow.addColorStop(1, 'rgba(23,18,14,0)');
      ctx.fillStyle = shadow;
      ellipse(ctx, 0, 0, 1, 1);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#c5cfc0';
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, Math.PI, 2 * Math.PI);
      ctx.closePath();
      ctx.fill();
      const inside = ctx.createLinearGradient(x, y - ry, x, y + ry);
      inside.addColorStop(0, '#50665d');
      inside.addColorStop(1, '#92a397');
      ctx.fillStyle = inside;
      ellipse(ctx, x, y, rx * 0.91, ry * 0.77);
      ctx.fill();

      ctx.save();
      ctx.clip();
      const count = Math.round(feed.fill * grains.length);
      for (const item of grains) {
        if (item.order >= count) continue;
        grain(ctx, x + item.x * rx * 0.78, y + (0.09 + item.y * 0.55) * ry, photoWidth * 0.006 * item.size, item);
      }
      ctx.restore();

      if (feed.pour < 1) {
        for (let i = 0; i < 7; i++) {
          const p = feed.pour * 1.55 - i * 0.075;
          if (p <= 0 || p >= 1) continue;
          const item = grains[i];
          grain(ctx, x + item.x * rx * (0.24 + p * 0.49), y - (1 - p * p) * h * 0.095, photoWidth * 0.006 * item.size, item);
        }
      }
      ctx.restore();

      // Only the wall and the near rim can cover the muzzle in front.
      front.clearRect(0, 0, w, h);
      front.save();
      front.globalAlpha = feed.opacity;
      front.filter = lighting;
      const glaze = front.createLinearGradient(x, y, x + rx * 0.35, y + depth);
      glaze.addColorStop(0, '#b8c4b1');
      glaze.addColorStop(0.55, '#879d91');
      glaze.addColorStop(1, '#4c625b');
      front.beginPath();
      front.moveTo(x - rx, y);
      front.bezierCurveTo(x - rx * 0.94, y + depth * 0.45, x - rx * 0.85, y + depth * 0.84, x - rx * 0.69, y + depth);
      front.bezierCurveTo(x - rx * 0.32, y + depth * 1.19, x + rx * 0.37, y + depth * 1.19, x + rx * 0.69, y + depth);
      front.bezierCurveTo(x + rx * 0.88, y + depth * 0.82, x + rx * 0.94, y + depth * 0.42, x + rx, y);
      front.ellipse(x, y, rx, ry, 0, 0, Math.PI);
      front.closePath();
      front.fillStyle = glaze;
      front.fill();

      front.beginPath();
      front.ellipse(x, y, rx, ry, 0, 0, Math.PI);
      front.ellipse(x, y, rx * 0.91, ry * 0.77, 0, Math.PI, 0, true);
      front.closePath();
      front.fillStyle = '#c5cfc0';
      front.fill();
      front.restore();
      return true;
    }
  }

  global.CatFeedBowl = CatFeedBowl;
})(window);
