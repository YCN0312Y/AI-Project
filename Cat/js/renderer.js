(function (global) {
  'use strict';

  /**
   * Ultra-Fast WebGL2 Deformable Photo-Mesh Renderer (< 0.4ms GPU frame time, 60-120 FPS!)
   *
   * Maps the studio Maine Coon photographs onto a physics-driven mesh, with:
   * - Pass 1: Lightweight 256x170 2nd-order spring-damper fur-combing FBO
   * - Pass 2: Hardware-bilinear deformable photo-mesh with real-time fur strand combing,
   *           per-region blinking/squinting ("sit_happy" / "belly_happy"),
   *           lip-synced meowing ("sit_meow" / "belly_meow"),
   *           per-paw independent toe-spreading ("belly_bloom" 猫爪开花),
   *           soft contact shadows, night-lamp warmth, and bounding-boxed 3D petting hand!
   */

  const IMG_ASPECT = global.CAT_IMG_ASPECT || 1.5;
  const ROLL_FRAMES = global.CAT_ROLL_FRAMES;
  const FEED_FRAMES = global.CAT_FEED_FRAMES;
  const GROOM_FRAMES = global.CAT_GROOM_FRAMES;
  const POSE_FRAMES = [...ROLL_FRAMES, ...FEED_FRAMES, ...GROOM_FRAMES];
  const ROLL_TRACK = ROLL_FRAMES.map(({ time }, index) => ({ time, index }));
  const FEED_TRACK = [
    ROLL_TRACK[0],
    ...FEED_FRAMES.map(({ time }, index) => ({ time, index: ROLL_FRAMES.length + index }))
  ];
  const GROOM_TRACK = [
    ROLL_TRACK[0],
    ...GROOM_FRAMES.map(({ time }, index) => ({ time, index: ROLL_FRAMES.length + FEED_FRAMES.length + index }))
  ];
  const LICK_POSE = GROOM_TRACK[GROOM_TRACK.length - 1].index;
  const PHOTO_LAYOUT = global.CAT_PHOTO_LAYOUT;
  const PAW_CENTERS = new Float32Array(PHOTO_LAYOUT.belly.paws.flatMap(paw => paw.c));
  // Subdivide each authored triangle so petting still deforms a fine mesh.
  const CELL_STEPS = 7;
  const GRID_X = (ROLL_FRAMES[0].rows[0].length - 1) * CELL_STEPS;
  const GRID_Y = (ROLL_FRAMES[0].rows.length - 1) * CELL_STEPS;

  function expandPoseUvs(rows) {
    const uvs = new Float32Array((GRID_X + 1) * (GRID_Y + 1) * 2);
    let i = 0;
    for (let y = 0; y <= GRID_Y; y++) {
      const row = Math.min(Math.floor(y / CELL_STEPS), rows.length - 2);
      const v = y / CELL_STEPS - row;
      for (let x = 0; x <= GRID_X; x++) {
        const col = Math.min(Math.floor(x / CELL_STEPS), rows[row].length - 2);
        const u = x / CELL_STEPS - col;
        const a = rows[row][col];
        const b = rows[row][col + 1];
        const c = rows[row + 1][col];
        const d = rows[row + 1][col + 1];
        for (let axis = 0; axis < 2; axis++) {
          uvs[i++] = u + v <= 1
            ? a[axis] * (1 - u - v) + b[axis] * u + c[axis] * v
            : d[axis] * (u + v - 1) + b[axis] * (1 - v) + c[axis] * (1 - u);
        }
      }
    }
    return uvs;
  }

  const QUAD_VERT = `#version 300 es
  precision mediump float;
  const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  out vec2 vUv;
  void main() {
    vec2 p = P[gl_VertexID];
    vUv = p * 0.5 + 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
  }
  `;

  const STUDIO_GLSL = `
  vec2 tileUv(int tile, vec2 uv, ivec2 atlasSize, float rows) {
    vec2 grid = vec2(2.0, rows);
    vec2 margin = (grid * 0.5) / vec2(atlasSize);
    vec2 cell = vec2(float(tile % 2), float(tile / 2));
    return (cell + clamp(uv, margin, 1.0 - margin)) / grid;
  }

  vec2 tileUv(int tile, vec2 uv, ivec2 atlasSize) {
    return tileUv(tile, uv, atlasSize, 2.0);
  }

  vec3 lightStudio(vec3 col, vec2 stage, float night) {
    if (night <= 0.002) return col;
    float lamp = 1.0 - smoothstep(0.05, 1.15, length(stage - vec2(-0.18, 0.18)));
    vec3 tint = mix(vec3(0.28, 0.31, 0.42), vec3(0.76, 0.68, 0.58), lamp);
    return col * mix(vec3(1.0), tint, night);
  }
  `;

  const ORBIT_FRAG = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uOrbitCardinal;
  uniform sampler2D uOrbitDiagonal;
  uniform int uOrbitFrom;
  uniform float uOrbitMix;
  uniform float uNightMix;

  ${STUDIO_GLSL}

  // Left edge, feature center, right edge for the face, chest and lower body.
  // Align adjacent photographs before blending so the head and body track the drag.
  const vec3 PROFILE[24] = vec3[24](
    vec3(.398,.512,.625), vec3(.369,.512,.638), vec3(.346,.513,.667),
    vec3(.358,.412,.549), vec3(.344,.467,.636), vec3(.351,.523,.705),
    vec3(.319,.334,.536), vec3(.333,.461,.670), vec3(.376,.563,.709),
    vec3(.342,.437,.557), vec3(.342,.516,.665), vec3(.365,.564,.729),
    vec3(.379,.482,.586), vec3(.372,.483,.603), vec3(.330,.484,.633),
    vec3(.450,.544,.651), vec3(.376,.497,.653), vec3(.303,.460,.642),
    vec3(.463,.666,.696), vec3(.392,.567,.667), vec3(.312,.487,.652),
    vec3(.482,.623,.674), vec3(.391,.557,.679), vec3(.312,.488,.664)
  );

  const vec2 EYES[8] = vec2[8](
    vec2(.483,.542), vec2(.396,.451), vec2(.327,.370), vec2(.394,.493),
    vec2(.436,.528), vec2(.498,.598), vec2(.629,.677), vec2(.576,.637)
  );

  // Eye line, chin and floor contact. Rear views use the same height on the head.
  const vec3 HEIGHTS[8] = vec3[8](
    vec3(.229,.339,.91), vec3(.241,.351,.908), vec3(.242,.346,.914), vec3(.232,.352,.908),
    vec3(.229,.344,.919), vec3(.230,.345,.919), vec3(.230,.339,.914), vec3(.215,.332,.916)
  );

  vec3 profileAt(int i, float y) {
    int row = i * 3;
    vec3 head = mix(vec3(.35,.50,.65), PROFILE[row], smoothstep(0.0, 0.13, y));
    vec3 upper = mix(head, PROFILE[row+1], smoothstep(.25, .50, y));
    vec3 body = mix(upper, PROFILE[row+2], smoothstep(.51, .78, y));
    return mix(body, vec3(.27,.50,.73), smoothstep(.94, 1.0, y));
  }

  float remap(float x, vec3 target, vec3 source) {
    if (x < target.x) return x * source.x / target.x;
    if (x < target.y) return mix(source.x, source.y, (x-target.x)/(target.y-target.x));
    if (x < target.z) return mix(source.y, source.z, (x-target.y)/(target.z-target.y));
    return mix(source.z, 1.0, (x-target.z)/(1.0-target.z));
  }

  vec2 eyesAt(int i, float y, vec3 shape) {
    vec2 middle = vec2(mix(shape.x, shape.y, .56), mix(shape.y, shape.z, .42));
    float eyeWeight = smoothstep(.12, .18, y) * (1.0 - smoothstep(.27, .37, y));
    vec2 nearEye = clamp(EYES[i], shape.xy + .004, shape.yz - .004);
    return mix(middle, nearEye, eyeWeight);
  }

  float remapHead(float x, vec3 target, vec2 targetEyes, vec3 source, vec2 sourceEyes) {
    if (x < target.x) return x * source.x / target.x;
    if (x < targetEyes.x) return mix(source.x, sourceEyes.x, (x-target.x)/(targetEyes.x-target.x));
    if (x < target.y) return mix(sourceEyes.x, source.y, (x-targetEyes.x)/(target.y-targetEyes.x));
    if (x < targetEyes.y) return mix(source.y, sourceEyes.y, (x-target.y)/(targetEyes.y-target.y));
    if (x < target.z) return mix(sourceEyes.y, source.z, (x-targetEyes.y)/(target.z-targetEyes.y));
    return mix(source.z, 1.0, (x-target.z)/(1.0-target.z));
  }

  vec3 orbitPhoto(int i, vec2 uv) {
    if (i % 2 == 0) return texture(uOrbitCardinal, tileUv(i / 2, uv, textureSize(uOrbitCardinal, 0))).rgb;
    return texture(uOrbitDiagonal, tileUv(i / 2, uv, textureSize(uOrbitDiagonal, 0))).rgb;
  }

  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    int to = (uOrbitFrom + 1) % 8;
    vec3 height = mix(HEIGHTS[uOrbitFrom], HEIGHTS[to], uOrbitMix);
    float yA = remap(uv.y, height, HEIGHTS[uOrbitFrom]);
    float yB = remap(uv.y, height, HEIGHTS[to]);
    vec3 a = profileAt(uOrbitFrom, yA);
    vec3 b = profileAt(to, yB);
    vec3 shape = mix(a, b, uOrbitMix);
    vec2 eyesA = eyesAt(uOrbitFrom, yA, a);
    vec2 eyesB = eyesAt(to, yB, b);
    vec2 eyes = mix(eyesA, eyesB, uOrbitMix);
    float blend = smoothstep(.34, .66, uOrbitMix);
    vec3 col = blend < 1.0 ? orbitPhoto(uOrbitFrom, vec2(remapHead(uv.x, shape, eyes, a, eyesA), yA)) : vec3(0.0);
    if (blend > 0.0) {
      vec3 next = orbitPhoto(to, vec2(remapHead(uv.x, shape, eyes, b, eyesB), yB));
      if (blend < 1.0) {
        // A high-contrast seam usually has fur or an ear in only one view.
        // Keep that detail in a single view during the texture handoff.
        float mismatch = smoothstep(0.025, 0.13, length(col - next));
        blend = mix(blend, step(0.5, uOrbitMix), mismatch);
      }
      col = mix(col, next, blend);
    }
    vec2 stage = (vUv - 0.5) * vec2(1.5, 1.0);
    fragColor = vec4(lightStudio(col, stage, uNightMix), 1.0);
  }
  `;

  // Lightweight 256x170 2nd-order fur-combing dynamics shader
  const FUR_SIM_FRAG = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform sampler2D uPrev;
  uniform float uDt;
  uniform float uReset;
  uniform float uShakeTime;
  uniform vec2 uHandPos;
  uniform vec2 uHandVel;
  uniform float uHandPressure;
  uniform float uHandVisible;
  uniform vec4 uFingers[5];

  void main() {
    if (uReset > 0.5) {
      fragColor = vec4(0.5, 0.5, 0.5, 0.5);
      return;
    }

    vec4 prev = texture(uPrev, vUv);
    vec2 comb = (prev.rg - 0.5) * 2.0;
    vec2 vel  = (prev.ba - 0.5) * 8.0;

    float dt = clamp(uDt, 0.001, 0.033);
    // Natural slow elastic settling of combed fur tracks
    vec2 restTarget = comb * exp(-dt * 0.18);

    // Stage coords corresponding to this texel
    vec2 sp = vec2((vUv.x - 0.5) * 1.5, vUv.y - 0.5);

    if (uShakeTime >= 0.0) {
      float env = sin(clamp(uShakeTime / 0.9, 0.0, 1.0) * 3.14159);
      vel.x += sin(uShakeTime * 46.0 - sp.y * 9.0) * env * 18.0 * dt;
      restTarget *= exp(-dt * 6.0);
    }

    float speed = length(uHandVel);
    if (uHandVisible > 0.15 && speed > 0.03) {
      float engage = max(uHandPressure, 0.25 * uHandVisible);
      float w = smoothstep(0.13, 0.02, length(sp - uHandPos)) * engage * 0.75;

      vec2 partPush = vec2(0.0);
      for (int f = 0; f < 5; f++) {
        vec2 df = sp - uFingers[f].xy;
        float fd = length(df);
        float fr = uFingers[f].z * 2.1;
        if (fd < fr && fd > 0.0001) {
          float fw = smoothstep(fr, fr * 0.15, fd) * engage;
          w = max(w, fw);
          partPush += (df / fd) * fw * 0.32;
        }
      }

      vec2 stroke = clamp(uHandVel * 0.55, vec2(-1.0), vec2(1.0));
      vel += (stroke * 18.0 + partPush * 12.0) * w * dt;
      restTarget = mix(restTarget, clamp(stroke * 0.95 + partPush * 0.45, vec2(-0.95), vec2(0.95)), clamp(w * dt * 11.0, 0.0, 0.8));
    }

    vec2 force = (restTarget - comb) * 54.0;
    vel = (vel + force * dt) * exp(-5.8 * dt);
    comb = clamp(comb + vel * dt, vec2(-0.98), vec2(0.98));
    vel  = clamp(vel, vec2(-3.95), vec2(3.95));

    fragColor = vec4(comb * 0.5 + 0.5, vel / 8.0 + 0.5);
  }
  `;

  // Deformable Photo-Mesh Vertex Shader
  const MESH_VERT = `#version 300 es
  precision highp float;

  layout(location = 0) in vec2 aStagePos; // Displaced stage position (x in [-0.75, 0.75], y in [-0.5, 0.5])
  layout(location = 1) in vec2 aImgUv;
  layout(location = 2) in vec2 aNextUv;

  uniform float uViewAspect;
  out vec2 vImgUv;
  out vec2 vNextUv;
  out vec2 vStagePos;

  void main() {
    vImgUv = aImgUv;
    vNextUv = aNextUv;
    vStagePos = aStagePos;
    // Cover/fit 3:2 stage cleanly into canvas aspect
    float scaleX = 2.0 / max(uViewAspect, 0.01);
    float scaleY = 2.0;
    gl_Position = vec4(aStagePos.x * scaleX, aStagePos.y * scaleY, 0.0, 1.0);
  }
  `;

  // Single-Pass Photorealistic Cat + Fur Combing + Multi-Expression + Paw-Bloom + Hand Shader
  const MESH_FRAG = `#version 300 es
  precision highp float;

  in vec2 vImgUv;
  in vec2 vNextUv;
  in vec2 vStagePos;
  out vec4 fragColor;

  uniform vec2 uResolution;
  uniform float uViewAspect;
  uniform float uNightMix;
  uniform int uPoseFrom;
  uniform int uPoseTo;
  uniform float uPoseMix;
  uniform float uEyeClose;
  uniform float uMouthOpen;
  uniform float uGroomLick;
  uniform vec4 uPawBloom;          // (b0, b1, b2, b3)
  uniform float uFurLengthUser;
  uniform vec4 uSitEyes;
  uniform vec4 uSitMuzzle;
  uniform vec4 uBellyEyes;
  uniform vec4 uBellyMuzzle;
  uniform vec2 uPawCenters[4];

  // Textures: Sitting (open, happy, meow) & Belly-Up (open, happy, meow, bloom)
  uniform sampler2D uSitOpen;
  uniform sampler2D uSitHappy;
  uniform sampler2D uSitMeow;
  uniform sampler2D uBellyUp;
  uniform sampler2D uBellyHappy;
  uniform sampler2D uBellyMeow;
  uniform sampler2D uBellyBloom;
  uniform sampler2D uRollLean;
  uniform sampler2D uRollSide;
  uniform sampler2D uFurDyn;
  uniform sampler2D uStudioMatte;
  uniform sampler2D uStudioBackdrop;
  uniform sampler2D uFeedPoses;
  uniform sampler2D uFeedMatte;
  uniform sampler2D uFeedBackdrop;
  uniform sampler2D uBowlInterior;
  uniform vec4 uBowlBounds;

  // Hand uniforms
  uniform float uShowHand;
  uniform float uHandVisible;
  uniform vec2 uHandPos;
  uniform float uHandAngle;
  uniform float uHandPressure;

  ${STUDIO_GLSL}

  float softEllipse(vec2 uv, vec2 center, vec2 radii, float feather) {
    float d = length((uv - center) / radii);
    return 1.0 - smoothstep(1.0 - feather, 1.0 + feather, d);
  }

  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  float sdSeg(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    return length(pa - ba * h) - mix(ra, rb, h);
  }

  vec3 sampleSittingCat(vec2 uv) {
    vec3 col = texture(uSitOpen, uv).rgb;
    float eyeW = smoothstep(0.28, 0.72, uEyeClose);
    float mouthW = smoothstep(0.12, 0.68, uMouthOpen);
    if (eyeW > 0.005) {
      float mEye = softEllipse(uv, uSitEyes.xy, uSitEyes.zw, 0.30);
      float keepMouth = softEllipse(uv, uSitMuzzle.xy, uSitMuzzle.zw * 0.80, 0.28) * step(0.05, mouthW);
      col = mix(col, texture(uSitHappy, uv).rgb, clamp(eyeW * mEye * (1.0 - keepMouth), 0.0, 1.0));
    }
    if (mouthW > 0.005) {
      float mMouth = softEllipse(uv, uSitMuzzle.xy, uSitMuzzle.zw, 0.32);
      col = mix(col, texture(uSitMeow, uv).rgb, clamp(mouthW * mMouth, 0.0, 1.0));
    }
    return col;
  }

  float pawBloomMask(vec2 uv) {
    float bloomMask = 0.0;
    for (int i = 0; i < 4; i++) {
      float b = smoothstep(0.15, 0.80, uPawBloom[i]);
      if (b > 0.005) {
        float mp = softEllipse(uv, uPawCenters[i], vec2(0.083, 0.108), 0.30);
        bloomMask = max(bloomMask, mp * b);
      }
    }
    return bloomMask;
  }

  vec3 sampleBellyCat(vec2 uv, float bloom) {
    vec3 col = texture(uBellyUp, uv).rgb;
    if (bloom > 0.005) col = mix(col, texture(uBellyBloom, uv).rgb, bloom);

    float eyeW = smoothstep(0.28, 0.72, uEyeClose);
    float mouthW = smoothstep(0.12, 0.68, uMouthOpen);
    if (eyeW > 0.005) {
      float mEye = softEllipse(uv, uBellyEyes.xy, uBellyEyes.zw, 0.32);
      float keepMouth = softEllipse(uv, uBellyMuzzle.xy, uBellyMuzzle.zw * 0.80, 0.28) * step(0.05, mouthW);
      col = mix(col, texture(uBellyHappy, uv).rgb, clamp(eyeW * mEye * (1.0 - keepMouth), 0.0, 1.0));
    }
    if (mouthW > 0.005) {
      float mMouth = softEllipse(uv, uBellyMuzzle.xy, uBellyMuzzle.zw, 0.32);
      col = mix(col, texture(uBellyMeow, uv).rgb, clamp(mouthW * mMouth, 0.0, 1.0));
    }
    return col;
  }

  vec2 groomMuzzleUv(vec2 uv) {
    const float base = 0.362, tip = 0.383, lower = 0.408;
    if (uv.y <= base || uv.y >= lower || abs(uv.x - 0.547) >= 0.026) return uv;
    // Keep the upper lip fixed while the tongue retracts between strokes.
    float tipNow = mix(0.367, tip, uGroomLick);
    float v = uv.y < tipNow
      ? mix(base, tip, (uv.y - base) / (tipNow - base))
      : mix(tip, lower, (uv.y - tipNow) / (lower - tipNow));
    uv.y = mix(v, uv.y, smoothstep(0.015, 0.026, abs(uv.x - 0.547)));
    return uv;
  }

  vec3 samplePose(int pose, vec2 uv, float bloom) {
    uv = clamp(uv, vec2(0.002), vec2(0.998));
    if (pose == ${LICK_POSE}) uv = groomMuzzleUv(uv);
    if (pose >= 4) return texture(uFeedPoses, tileUv(pose - 4, uv, textureSize(uFeedPoses, 0), 3.0)).rgb;
    if (pose == 0) return sampleSittingCat(uv);
    if (pose == 1) return texture(uRollLean, uv).rgb;
    if (pose == 2) return texture(uRollSide, uv).rgb;
    return sampleBellyCat(uv, bloom);
  }

  vec3 backdrop(int pose, vec2 uv) {
    if (pose >= 4) return texture(uFeedBackdrop, tileUv(pose - 4, uv, textureSize(uFeedBackdrop, 0), 3.0)).rgb;
    return texture(uStudioBackdrop, tileUv(pose, uv, textureSize(uStudioBackdrop, 0))).rgb;
  }

  vec2 coatMatte(int pose, vec2 uv) {
    if (pose >= 4) {
      float alpha = texture(uFeedMatte, tileUv(pose - 4, uv, textureSize(uFeedMatte, 0), 3.0)).r;
      return vec2(alpha);
    }
    return texture(uStudioMatte, tileUv(pose, uv, textureSize(uStudioMatte, 0))).rg;
  }

  vec4 foreground(int pose, vec2 uv, vec2 comb, float combMag) {
    float bloom = pose == 3 ? pawBloomMask(uv) : 0.0;
    vec2 mattes = coatMatte(pose, uv);
    float alpha = mix(mattes.r, mattes.g, bloom);
    if (alpha <= 0.002) return vec4(0.0);

    // Keep the silhouette fixed in photo space while detail inside it follows the fingertips.
    float fur = smoothstep(0.36, 0.95, alpha);
    vec2 direction = vec2(-comb.x, comb.y);
    float streak = 0.0;
    if (combMag > 0.015 && fur > 0.0) {
      vec2 perp = normalize(vec2(-comb.y, comb.x) + vec2(1e-5, 0.0));
      streak = sin(dot(uv, perp) * 520.0) * combMag * fur;
    }
    vec2 shift = direction * (0.0085 * uFurLengthUser * fur + streak * 0.0018);
    vec3 col = samplePose(pose, uv + shift, bloom);
    vec3 plate = backdrop(pose, uv);
    if (alpha < 0.999) {
      // Unmix the studio color at the coat edge. Keep enough coverage for
      // thin dark hairs and bright whiskers without extending the matte.
      vec3 contrast = col - plate;
      vec3 needed = max(contrast / max(1.0 - plate, vec3(0.02)),
                        -contrast / max(plate, vec3(0.02)));
      float support = smoothstep(0.06, 0.46, alpha);
      alpha = max(alpha, support * clamp(max(needed.r, max(needed.g, needed.b)), 0.0, 1.0));
      col = clamp(col - plate * (1.0 - alpha), 0.0, alpha);
    }
    col *= 1.0 + streak * 0.045 - comb.y * fur * 0.035;
    return vec4(col, alpha);
  }

  void main() {
    // Screen-space stage coordinate (unwarped, for crisp hand & cast shadow!)
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    vec2 pScreen = vec2((screenUv.x - 0.5) * uViewAspect, screenUv.y - 0.5);

    // Sample 2nd-order fur-combing field
    vec2 furFboUv = clamp(vec2(vStagePos.x / 1.5 + 0.5, vStagePos.y + 0.5), 0.01, 0.99);
    vec2 comb = (texture(uFurDyn, furFboUv).rg - 0.5) * 2.0;
    float combMag = length(comb);

    // Only the premultiplied coat follows the mesh. The clean studio is sampled
    // in screen space, including where a moving paw, ear or tail exposes it.
    float poseCross = smoothstep(0.28, 0.72, uPoseMix);
    bool seatedStudio = uPoseFrom >= 4 || uPoseTo >= 4;
    vec2 photoUv = vec2(pScreen.x / 1.5 + 0.5, 1.0 - screenUv.y);
    vec4 cat = vec4(0.0);
    vec3 back = vec3(0.0);
    if (poseCross < 1.0) {
      cat = foreground(uPoseFrom, vImgUv, comb, combMag);
      if (!seatedStudio) back = backdrop(uPoseFrom, photoUv);
    }
    if (poseCross > 0.0) {
      vec4 next = foreground(uPoseTo, vNextUv, comb, combMag);
      // Use one pose for details that the meshes cannot line up, such as a
      // paw that was behind the body in one of the photos.
      float mismatch = smoothstep(0.15, 0.55, length(cat - next));
      float edgeCross = mix(poseCross, smoothstep(0.485, 0.515, uPoseMix), mismatch);
      cat = mix(cat, next, edgeCross);
      if (!seatedStudio) back = mix(back, backdrop(uPoseTo, photoUv), poseCross);
    }
    if (seatedStudio) back = backdrop(0, photoUv);
    float catMask = cat.a;
    vec3 col = lightStudio(clamp(cat.rgb + back * (1.0 - catMask), 0.0, 1.0), pScreen, uNightMix);
    if (uBowlBounds.z > 0.0 && catMask < 0.999) {
      vec2 bowlUv = (vec2(screenUv.x, 1.0 - screenUv.y) - uBowlBounds.xy) / uBowlBounds.zw;
      if (all(greaterThanEqual(bowlUv, vec2(0.0))) && all(lessThan(bowlUv, vec2(1.0)))) {
        vec4 bowl = texture(uBowlInterior, bowlUv);
        col += (bowl.rgb - lightStudio(back, pScreen, uNightMix) * bowl.a) * (1.0 - catMask);
      }
    }

    // Fast bounding-boxed 3D-shaded Petting Hand & Soft Contact Shadow!
    if (uShowHand > 0.5 && uHandVisible > 0.005) {
      if (abs(pScreen.x - uHandPos.x) < 0.65) {
        float c = cos(uHandAngle), s = sin(uHandAngle);
        float lift = (1.0 - uHandPressure) * 0.020 + (1.0 - uHandVisible) * 0.05;
        float hScale = 1.05;

        // The hand casts a contact shadow onto the cat layer.
        vec2 sRel = ((pScreen - vec2(0.015 + lift * 0.45, -0.020 - lift * 0.55)) - uHandPos) / hScale;
        vec2 ps = vec2(sRel.x * c + sRel.y * s, -sRel.x * s + sRel.y * c);
        if (abs(ps.x) < 0.18 && ps.y < 0.18 && ps.y > -1.25) {
          float dShad = smin(
            sdSeg(ps, vec2(0.002, -0.06), vec2(0.0, 0.095), 0.056, 0.042),
            sdSeg(ps, vec2(0.006, -0.07), vec2(0.016, -1.15), 0.050, 0.068),
            0.030
          );
          float shad = smoothstep(0.035 + lift * 0.7, -0.022, dShad) * uHandVisible;
          col *= 1.0 - shad * catMask * (0.24 - 0.07 * uNightMix);
        }

        // Crisp 3D-lit Right Hand + 5 Relaxed Fingers + Striped Knit Sleeve
        vec2 pr = (pScreen - uHandPos) / hScale;
        vec2 hp = vec2(pr.x * c + pr.y * s, -pr.x * s + pr.y * c);
        if (abs(hp.x) < 0.16 && hp.y < 0.16 && hp.y > -1.25) {
          float flex = 1.0 - uHandPressure * 0.035;
          float dPalm   = sdSeg(hp, vec2(0.003, -0.058), vec2(0.0, 0.014), 0.047, 0.056);
          float dIndex  = sdSeg(hp, vec2(-0.037, 0.012), vec2(-0.038, 0.096 * flex), 0.0168, 0.0130);
          float dMiddle = sdSeg(hp, vec2(-0.012, 0.018), vec2(-0.013, 0.110 * flex), 0.0174, 0.0134);
          float dRing   = sdSeg(hp, vec2( 0.013, 0.015), vec2( 0.012, 0.101 * flex), 0.0168, 0.0128);
          float dPinky  = sdSeg(hp, vec2( 0.036, 0.005), vec2( 0.038, 0.078 * flex), 0.0148, 0.0114);
          float dFingers = smin(smin(dIndex, dMiddle, 0.0045), smin(dRing, dPinky, 0.0045), 0.0045);

          float dThumb = smin(
            sdSeg(hp, vec2(-0.032, -0.044), vec2(-0.058, -0.004), 0.022, 0.0165),
            sdSeg(hp, vec2(-0.058, -0.004), vec2(-0.066, 0.044 * flex), 0.0165, 0.0130),
            0.012
          );
          float dWrist = sdSeg(hp, vec2(0.004, -0.054), vec2(0.006, -0.098), 0.044, 0.044);
          float dSkin = smin(smin(dPalm, dFingers, 0.016), smin(dThumb, dWrist, 0.018), 0.016);

          float cuffCurve = hp.y + 0.086 - 0.007 * cos((hp.x - 0.005) * 28.0);
          float dSleeve = max(sdSeg(hp, vec2(0.006, -0.088), vec2(0.018, -1.18), 0.049, 0.070), cuffCurve);
          float dAll = min(dSkin, dSleeve);

          float aa = 1.5 / uResolution.y;
          float hAlpha = smoothstep(aa, -aa, dAll) * uHandVisible;
          if (hAlpha > 0.002) {
            float sleeveMask = smoothstep(aa, -aa, dSleeve);
            float skinDepth = clamp(-dSkin / 0.046, 0.0, 1.0);
            float skinZ = sqrt(max(0.0, 1.0 - (1.0 - skinDepth) * (1.0 - skinDepth)));
            float radGrad = clamp(0.54 - (hp.x * 4.2 - hp.y * 1.1), 0.0, 1.0);
            float crease = (exp(-abs(dIndex - dMiddle) * 280.0) + exp(-abs(dMiddle - dRing) * 280.0) + exp(-abs(dRing - dPinky) * 280.0)) * smoothstep(0.01, 0.055, hp.y);

            vec3 skinCol = mix(vec3(0.62, 0.54, 0.50), vec3(0.90, 0.83, 0.79), clamp(0.32 + 0.50 * skinZ + 0.22 * radGrad, 0.0, 1.0));
            skinCol = mix(skinCol, vec3(0.84, 0.70, 0.67), smoothstep(0.045, 0.105, hp.y) * 0.26);
            skinCol *= 1.0 - clamp(crease, 0.0, 1.0) * 0.16 * smoothstep(-0.012, 0.002, dFingers);

            float armCenter = mix(0.006, 0.016, clamp((-hp.y - 0.088) / 0.96, 0.0, 1.0));
            float armX = (hp.x - armCenter) / 0.058;
            float armZ = sqrt(max(0.06, 1.0 - clamp(armX * armX, 0.0, 0.95)));
            float stripeCoord = (-hp.y - 0.086) + 0.0075 * (1.0 - armZ);
            float isWhite = smoothstep(-0.22, 0.22, -sin(stripeCoord * (3.14159 / 0.0165))) * smoothstep(0.014, 0.020, stripeCoord);
            vec3 sleeveCol = mix(vec3(0.41, 0.52, 0.70), vec3(0.82, 0.86, 0.92), isWhite) * (0.60 + 0.42 * armZ);

            vec3 handCol = mix(skinCol, sleeveCol, sleeveMask);
            handCol *= mix(vec3(1.0), vec3(0.64, 0.61, 0.58), uNightMix);

            // Soft fingertip feathering when pressing into the long coat.
            float tipSink = smoothstep(0.03, 0.105, hp.y) * smoothstep(-0.007, 0.0, dSkin) * uHandPressure * catMask;
            col = mix(col, handCol, hAlpha * (1.0 - tipSink * 0.38));
          }
        }
      }
    }

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
  `;

  class CatRenderer {
    constructor(canvas, feedBowl) {
      this.canvas = canvas;
      this.feedBowl = feedBowl;
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance'
      });
      if (!gl) {
        throw new Error('当前浏览器不支持 WebGL2');
      }
      this.gl = gl;

      this.nightMode = false;
      this.nightMix = 0.0;
      this.showHand = true;
      this.needsReset = true;

      this.initPrograms();
      this.initFurSimFBO();
      this.initMeshBuffers();
      this.initPhotoTextures();
      this.bowlTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.bowlTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    compileShader(type, src) {
      const gl = this.gl;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error('GLSL compile error:\n' + info);
      }
      return sh;
    }

    createProgram(vsSrc, fsSrc) {
      const gl = this.gl;
      const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc);
      const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error('GLSL link error:\n' + info);
      }
      return prog;
    }

    getUniforms(prog, list) {
      const gl = this.gl;
      const m = {};
      for (const n of list) m[n] = gl.getUniformLocation(prog, n);
      return m;
    }

    initPrograms() {
      this.simProg = this.createProgram(QUAD_VERT, FUR_SIM_FRAG);
      this.meshProg = this.createProgram(MESH_VERT, MESH_FRAG);
      this.orbitProg = this.createProgram(QUAD_VERT, ORBIT_FRAG);

      this.simU = this.getUniforms(this.simProg, [
        'uPrev', 'uDt', 'uReset', 'uShakeTime',
        'uHandPos', 'uHandVel', 'uHandPressure', 'uHandVisible', 'uFingers'
      ]);

      this.meshU = this.getUniforms(this.meshProg, [
        'uResolution', 'uViewAspect', 'uNightMix', 'uPoseFrom', 'uPoseTo', 'uPoseMix',
        'uEyeClose', 'uMouthOpen', 'uGroomLick', 'uPawBloom', 'uFurLengthUser',
        'uSitEyes', 'uSitMuzzle', 'uBellyEyes', 'uBellyMuzzle', 'uPawCenters[0]',
        'uSitOpen', 'uSitHappy', 'uSitMeow',
        'uBellyUp', 'uBellyHappy', 'uBellyMeow', 'uBellyBloom',
        'uFurDyn', 'uRollLean', 'uRollSide', 'uStudioMatte', 'uStudioBackdrop',
        'uFeedPoses', 'uFeedMatte', 'uFeedBackdrop', 'uBowlInterior', 'uBowlBounds',
        'uShowHand', 'uHandVisible', 'uHandPos', 'uHandAngle', 'uHandPressure'
      ]);

      const gl = this.gl;
      const setRegion = (uniform, region) => gl.uniform4f(this.meshU[uniform], region.c[0], region.c[1], region.rx, region.ry);
      gl.useProgram(this.meshProg);
      setRegion('uSitEyes', PHOTO_LAYOUT.sit.face);
      setRegion('uSitMuzzle', PHOTO_LAYOUT.sit.mouthMask);
      setRegion('uBellyEyes', PHOTO_LAYOUT.belly.face);
      setRegion('uBellyMuzzle', PHOTO_LAYOUT.belly.mouthMask);
      gl.uniform2fv(this.meshU['uPawCenters[0]'], PAW_CENTERS);

      this.orbitU = this.getUniforms(this.orbitProg, [
        'uOrbitCardinal', 'uOrbitDiagonal', 'uOrbitFrom', 'uOrbitMix', 'uNightMix'
      ]);
    }

    initFurSimFBO() {
      const gl = this.gl;
      this.simW = 256;
      this.simH = 170;
      this.simIdx = 0;
      this.furTex = [null, null];
      this.furFbo = [null, null];

      const init = new Uint8Array(this.simW * this.simH * 4);
      init.fill(128);

      for (let i = 0; i < 2; i++) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.simW, this.simH, 0, gl.RGBA, gl.UNSIGNED_BYTE, init);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);

        this.furTex[i] = t;
        this.furFbo[i] = fbo;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.emptyVao = gl.createVertexArray();
    }

    initMeshBuffers() {
      const gl = this.gl;
      const cols = GRID_X + 1;
      const rows = GRID_Y + 1;
      const vertCount = cols * rows;

      this.dynStage  = new Float32Array(vertCount * 2);

      const indices = new Uint16Array(GRID_X * GRID_Y * 6);
      let ip = 0;
      for (let iy = 0; iy < GRID_Y; iy++) {
        for (let ix = 0; ix < GRID_X; ix++) {
          const a = iy * cols + ix;
          const b = a + cols;
          indices[ip++] = a;
          indices[ip++] = b;
          indices[ip++] = a + 1;
          indices[ip++] = a + 1;
          indices[ip++] = b;
          indices[ip++] = b + 1;
        }
      }
      this.indexCount = indices.length;

      this.meshVao = gl.createVertexArray();
      gl.bindVertexArray(this.meshVao);

      this.posVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.dynStage.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.poseMeshes = POSE_FRAMES.map(({ pose, rows }) => {
        const uvs = expandPoseUvs(rows);
        const stage = uvs.map((uv, i) => i % 2 === 0 ? (uv - 0.5) * IMG_ASPECT : 0.5 - uv);
        const uvVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uvVbo);
        gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
        return { pose, stage, uvVbo };
      });
      gl.enableVertexAttribArray(1);
      gl.enableVertexAttribArray(2);

      const ebo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

      gl.bindVertexArray(null);
      this._tmpOut = [0, 0];
      this._nextOut = [0, 0];
    }

    initPhotoTextures() {
      const gl = this.gl;
      const assets = global.CAT_PHOTO_ASSETS || {};
      const keys = [
        'sit_open', 'sit_happy', 'sit_meow', 'belly_up', 'belly_happy', 'belly_meow', 'belly_bloom',
        'roll_lean', 'roll_side'
      ];
      const atlases = [
        'studio_matte', 'studio_backdrop', 'orbit_cardinal', 'orbit_diagonal',
        'feed_poses', 'feed_matte', 'feed_backdrop'
      ];
      this.textures = {};
      this.loadedPhotos = new Set();

      // Neutral studio grey 1x1 placeholder until data-URL decodes (~4ms)
      const placeholder = new Uint8Array([188, 190, 194, 255]);

      for (const k of [...keys, ...atlases]) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, placeholder);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.textures[k] = tex;

        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
          // No mipmaps on sheets. Their adjacent tiles have unrelated pixels.
          if (!atlases.includes(k)) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          }
          this.loadedPhotos.add(k);
        };
        const extension = k.endsWith('_matte') ? '.png' : '.jpg';
        img.src = assets[k] || ('assets/' + k + extension);
      }
    }

    get orbitReady() {
      return this.loadedPhotos.has('orbit_cardinal') && this.loadedPhotos.has('orbit_diagonal');
    }

    get feedReady() {
      return this.loadedPhotos.has('feed_poses') && this.loadedPhotos.has('feed_matte') && this.loadedPhotos.has('feed_backdrop');
    }

    bindTexture(unit, texture, uniform) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniform, unit);
    }

    resetGroom() {
      this.needsReset = true;
    }

    setNightMode(night) {
      this.nightMode = !!night;
    }

    setShowHand(show) {
      this.showHand = !!show;
    }

    resize() {
      // Cap DPR at 1.5 for razor-sharp photography at ultra-high 120fps speed!
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(rect.width * dpr));
      const h = Math.max(2, Math.round(rect.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    renderOrbit(angle) {
      const gl = this.gl;
      const step = angle / 45;
      const from = Math.floor(step);
      const u = this.orbitU;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.orbitProg);
      gl.bindVertexArray(this.emptyVao);
      this.bindTexture(0, this.textures.orbit_cardinal, u.uOrbitCardinal);
      this.bindTexture(1, this.textures.orbit_diagonal, u.uOrbitDiagonal);
      gl.uniform1i(u.uOrbitFrom, from);
      gl.uniform1f(u.uOrbitMix, step - from);
      gl.uniform1f(u.uNightMix, this.nightMix);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    render(physics, audio, rawDt, orbitAngle = null) {
      this.resize();
      const gl = this.gl;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));

      this.nightMix += ((this.nightMode ? 1.0 : 0.0) - this.nightMix) * Math.min(1.0, dt * 6.5);
      const bowlVisible = this.feedBowl?.draw(physics.feed, this.nightMix);

      if (orbitAngle !== null && this.orbitReady) {
        this.renderOrbit(orbitAngle);
        return;
      }
      if (!this.loadedPhotos.has('studio_matte') || !this.loadedPhotos.has('studio_backdrop')) {
        gl.clearColor(0.74, 0.75, 0.77, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }

      // 1. Morph corresponding photo vertices, including each pose's local deformation.
      let fromIndex = 0;
      let toIndex = 0;
      let poseMix = 0;
      const feeding = physics.feed.bend > 0;
      const grooming = physics.idle.groom > 0;
      const track = feeding ? FEED_TRACK : grooming ? GROOM_TRACK : ROLL_TRACK;
      const progress = feeding ? physics.feed.bend : grooming ? physics.idle.groom : physics.rollMix;
      if (progress === 1) {
        fromIndex = toIndex = track[track.length - 1].index;
      } else if (progress > 0) {
        const next = track.findIndex(frame => frame.time > progress);
        const a = track[next - 1], b = track[next];
        fromIndex = a.index;
        toIndex = b.index;
        const t = (progress - a.time) / (b.time - a.time);
        // Slow slightly through the authored poses without stopping motion there.
        poseMix = t * 0.65 + t * t * (3 - 2 * t) * 0.35;
      }

      const from = this.poseMeshes[fromIndex];
      const to = this.poseMeshes[toIndex];
      const fromPose = physics.poses[from.pose];
      const toPose = physics.poses[to.pose];
      const rest = from.stage;
      const dyn  = this.dynStage;
      const out  = this._tmpOut;
      const next = this._nextOut;
      for (let i = 0; i < rest.length; i += 2) {
        physics.displace(rest[i], rest[i + 1], out, fromPose);
        if (poseMix > 0) {
          physics.displace(to.stage[i], to.stage[i + 1], next, toPose);
          out[0] += (next[0] - out[0]) * poseMix;
          out[1] += (next[1] - out[1]) * poseMix;
        }
        dyn[i] = out[0];
        dyn[i + 1] = out[1];
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.posVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn);

      // 2. Pass 1: Update 256x170 Fur-Combing FBO
      const src = this.simIdx;
      const dst = 1 - src;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.furFbo[dst]);
      gl.viewport(0, 0, this.simW, this.simH);
      gl.useProgram(this.simProg);
      gl.bindVertexArray(this.emptyVao);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.furTex[src]);
      gl.uniform1i(this.simU.uPrev, 0);
      gl.uniform1f(this.simU.uDt, dt);
      gl.uniform1f(this.simU.uReset, this.needsReset ? 1.0 : 0.0);
      gl.uniform1f(this.simU.uShakeTime, physics.shakeTime);
      gl.uniform2f(this.simU.uHandPos, physics.hand.x, physics.hand.y);
      gl.uniform2f(this.simU.uHandVel, physics.hand.smoothVx, physics.hand.smoothVy);
      gl.uniform1f(this.simU.uHandPressure, physics.hand.pressure);
      gl.uniform1f(this.simU.uHandVisible, this.showHand && !physics.isRolling ? physics.hand.visible : 0.0);
      gl.uniform4fv(this.simU.uFingers, physics.fingerBuf);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.simIdx = dst;
      this.needsReset = false;

      // 3. Pass 2: Render the cat, stationary studio and hand.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0.74, 0.75, 0.77, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.meshProg);
      gl.bindVertexArray(this.meshVao);
      if (this.fromIndex !== fromIndex || this.toIndex !== toIndex) {
        gl.bindBuffer(gl.ARRAY_BUFFER, from.uvVbo);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, to.uvVbo);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
        this.fromIndex = fromIndex;
        this.toIndex = toIndex;
      }

      const u = this.meshU;
      const viewAspect = this.canvas.width / Math.max(1, this.canvas.height);
      gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(u.uViewAspect, viewAspect);
      gl.uniform1f(u.uNightMix, this.nightMix);
      gl.uniform1i(u.uPoseFrom, fromIndex);
      gl.uniform1i(u.uPoseTo, toIndex);
      gl.uniform1f(u.uPoseMix, poseMix);
      gl.uniform1f(u.uEyeClose, physics.eyeClose);
      gl.uniform1f(u.uMouthOpen, audio ? audio.mouthOpen : 0.0);
      gl.uniform1f(u.uGroomLick, physics.idle.lick);
      gl.uniform4f(
        u.uPawBloom,
        physics.pawBloom[0],
        physics.pawBloom[1],
        physics.pawBloom[2],
        physics.pawBloom[3]
      );
      gl.uniform1f(u.uFurLengthUser, physics.furLengthUser);

      this.bindTexture(0, this.textures.sit_open,        u.uSitOpen);
      this.bindTexture(1, this.textures.sit_happy,       u.uSitHappy);
      this.bindTexture(2, this.textures.sit_meow,        u.uSitMeow);
      this.bindTexture(3, this.textures.belly_up,        u.uBellyUp);
      this.bindTexture(4, this.textures.belly_happy,     u.uBellyHappy);
      this.bindTexture(5, this.textures.belly_meow,      u.uBellyMeow);
      this.bindTexture(6, this.textures.belly_bloom,     u.uBellyBloom);
      this.bindTexture(7, this.furTex[this.simIdx],     u.uFurDyn);
      this.bindTexture(8, this.textures.roll_lean,       u.uRollLean);
      this.bindTexture(9, this.textures.roll_side,       u.uRollSide);
      this.bindTexture(10, this.textures.studio_matte,   u.uStudioMatte);
      this.bindTexture(11, this.textures.studio_backdrop,u.uStudioBackdrop);
      this.bindTexture(12, this.textures.feed_poses,    u.uFeedPoses);
      this.bindTexture(13, this.textures.feed_matte,    u.uFeedMatte);
      this.bindTexture(14, this.textures.feed_backdrop, u.uFeedBackdrop);
      this.bindTexture(15, this.bowlTexture, u.uBowlInterior);
      if (bowlVisible) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.feedBowl.interior);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.uniform4fv(u.uBowlBounds, this.feedBowl.bounds);
      } else {
        gl.uniform4f(u.uBowlBounds, 0, 0, 0, 0);
      }

      gl.uniform1f(u.uShowHand, this.showHand ? 1.0 : 0.0);
      gl.uniform1f(u.uHandVisible, physics.hand.visible);
      gl.uniform2f(u.uHandPos, physics.hand.x, physics.hand.y);
      gl.uniform1f(u.uHandAngle, physics.hand.angle);
      gl.uniform1f(u.uHandPressure, physics.hand.pressure);

      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    }
  }

  global.CatRenderer = CatRenderer;
})(window);
