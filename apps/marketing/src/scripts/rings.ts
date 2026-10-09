/*
 * The hero: ten turning rings of runes around a burning core, drawn by one fragment
 * shader. Rings drift with the pointer (deeper rings more, for depth) and open up and
 * speed up as the page scrolls. Pauses when off screen; one still frame for visitors
 * who prefer less motion. Without WebGL2 the static SVG underneath stays visible.
 */

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 R;      // resolution in pixels
uniform float T;     // time, seconds
uniform vec2 M;      // pointer, -1..1 (eased)
uniform float S;     // scroll progress through the hero, 0..1
uniform vec2 C;      // centre of the rings, in height units
uniform float Z;     // scale

#define PI 3.14159265359
#define TAU 6.28318530718

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// Anti-aliased line at distance d from a shape, half-width w.
float line(float d, float w, float px) { return 1.0 - smoothstep(w, w + px * 1.5, abs(d)); }
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * R) / R.y;
  float px = 1.0 / R.y / Z;
  vec3 orange = vec3(0.957, 0.376, 0.212);
  vec3 gold = vec3(1.0, 0.74, 0.42);
  vec3 col = vec3(0.0);
  float open = 1.0 + S * 0.25;
  float speed = 1.0 + S * 2.0;

  // ---- Ten rings ----
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    vec2 q = (uv - C - M * (0.006 + 0.011 * fi)) / Z;
    float r = length(q);
    float a = atan(q.y, q.x);
    float r0 = (0.10 + fi * 0.054) * open;
    float dir = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;
    float ang = a / TAU + T * (0.012 + 0.018 * h1(fi)) * dir * speed + h1(fi + 7.0);
    float kind = mod(fi + 1.0, 4.0);
    float v = 0.0;

    if (kind < 1.0) {
      // A plain, thin circle.
      v = line(r - r0, 0.0009, px);
    } else if (kind < 2.0) {
      // Dashes.
      float n = 36.0 + floor(h1(fi) * 60.0);
      v = line(r - r0, 0.0014, px) * step(0.42, fract(ang * n));
    } else if (kind < 3.0) {
      // Runes: ticks of different lengths, some missing, on a guide line.
      float n = 110.0 + floor(h1(fi + 3.0) * 120.0);
      float cell = floor(ang * n);
      float len = 0.005 + 0.02 * h1(cell + fi * 13.0);
      float on = step(0.3, h1(cell * 1.7 + fi));
      float tick = 1.0 - smoothstep(0.1, 0.22, abs(fract(ang * n) - 0.5));
      v = tick * on * (1.0 - smoothstep(len, len + px * 1.5, abs(r - r0)));
      v += 0.45 * line(r - (r0 + 0.024), 0.0007, px);
    } else {
      // A double line broken into arcs.
      float segs = 3.0 + floor(h1(fi + 5.0) * 5.0);
      float f = fract(ang * segs);
      float g = smoothstep(0.015, 0.025, f) * (1.0 - smoothstep(0.84, 0.85, f));
      v = (line(r - r0, 0.0008, px) + line(r - r0 - 0.009, 0.0008, px)) * g;
    }
    // Inner rings burn gold, outer ones orange; outermost fade out.
    vec3 c = mix(gold, orange, smoothstep(0.1, 0.5, r));
    col += c * v * (0.75 - fi * 0.045);
  }

  // ---- Core frame: spokes, a turning star of two triangles, the glow ----
  vec2 q = (uv - C - M * 0.004) / Z;
  float r = length(q);
  float a = atan(q.y, q.x);

  float s = fract(a / TAU * 24.0 + T * 0.004 * speed);
  float arc = min(s, 1.0 - s) * (TAU / 24.0) * r;
  float spokes = line(arc, 0.0005, px) * smoothstep(0.17, 0.19, r / open) * (1.0 - smoothstep(0.36, 0.42, r / open));
  col += orange * spokes * 0.45;

  vec2 qs = rot(T * 0.06 * speed) * q;
  float star = line(sdTri(qs, 0.055 * open), 0.0009, px) + line(sdTri(-qs, 0.055 * open), 0.0009, px);
  col += gold * star * 0.9;
  col += gold * line(r - 0.028 * open, 0.0008, px);

  // Aura: turbulent fire around the core, and a faint halo at the outer rings.
  float n = fbm(vec2(a * 1.6 + T * 0.04, r * 7.0 - T * 0.35 * speed));
  float aura = exp(-pow(max(r - 0.02, 0.0) * 3.4, 1.35)) * (0.25 + 0.75 * n);
  col += orange * aura * 0.45;
  col += gold * exp(-r * 24.0) * 1.0;
  float halo = exp(-abs(r - 0.6 * open) * 10.0) * fbm(vec2(a * 3.0 - T * 0.03, T * 0.1)) * 0.12;
  col += orange * halo;

  // Sparks spiralling outwards.
  vec2 g = vec2(a / TAU * 140.0, r * 70.0 - T * 1.2 * speed);
  vec2 id = floor(g);
  float spark = step(0.988, h2(id)) * (1.0 - smoothstep(0.0, 0.16, length(fract(g) - 0.5)));
  col += vec3(1.0, 0.85, 0.7) * spark * smoothstep(0.7, 0.12, r) * (0.6 + 0.4 * sin(T * 3.0 + h2(id) * 40.0));

  // Tone, fade at the edges of the square so it melts into the page, and sit on zinc-950.
  col = 1.0 - exp(-col * 1.25);
  col *= 1.0 - smoothstep(0.36, 0.5, length(uv));
  col *= 1.0 - S * 0.4;
  col += vec3(0.035, 0.035, 0.043);
  col += (h2(gl_FragCoord.xy + fract(T)) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;

export function mountRings(canvas: HTMLCanvasElement, host: HTMLElement) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!gl) return false;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  let prog: WebGLProgram;
  try {
    prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  } catch (err) {
    console.warn("Hero effect unavailable:", err);
    return false;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const uR = u("R"), uT = u("T"), uM = u("M"), uS = u("S"), uC = u("C"), uZ = u("Z");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width * dpr));
    h = Math.max(1, Math.round(r.height * dpr));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  };

  // Eased pointer and scroll, so movement feels weighty.
  const target = { x: 0, y: 0 };
  const mouse = { x: 0, y: 0 };
  let scroll = 0;
  if (!reduced) {
    addEventListener(
      "pointermove",
      (e) => {
        target.x = (e.clientX / innerWidth) * 2 - 1;
        target.y = -((e.clientY / innerHeight) * 2 - 1);
      },
      { passive: true },
    );
  }

  const draw = (t: number) => {
    // The emblem fills its own square canvas.
    const cx = 0;
    const cy = 0;
    const z = 0.78;
    mouse.x += (target.x - mouse.x) * 0.05;
    mouse.y += (target.y - mouse.y) * 0.05;
    const s = Math.min(1, Math.max(0, -host.getBoundingClientRect().top / host.offsetHeight));
    scroll += (s - scroll) * 0.12;
    gl.uniform2f(uR, w, h);
    gl.uniform1f(uT, t);
    gl.uniform2f(uM, mouse.x, mouse.y);
    gl.uniform1f(uS, scroll);
    gl.uniform2f(uC, cx, cy);
    gl.uniform1f(uZ, z);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  resize();
  new ResizeObserver(() => {
    resize();
    if (reduced) draw(14);
  }).observe(canvas);

  if (reduced) {
    draw(14);
    canvas.dataset.ready = "";
    return true;
  }

  let visible = true;
  let raf = 0;
  const start = performance.now();
  const loop = (now: number) => {
    draw((now - start) / 1000 + 6);
    raf = requestAnimationFrame(loop);
  };
  const run = () => {
    cancelAnimationFrame(raf);
    if (visible && !document.hidden) raf = requestAnimationFrame(loop);
  };
  new IntersectionObserver(([e]) => {
    visible = Boolean(e?.isIntersecting);
    run();
  }).observe(host);
  document.addEventListener("visibilitychange", run);
  run();
  canvas.dataset.ready = "";
  return true;
}
