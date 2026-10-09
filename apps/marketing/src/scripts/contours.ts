/*
 * The hero background: a slowly drifting landscape drawn only as contour lines.
 * Domain-warped noise gives the terrain; thin zinc height lines warm to orange on the
 * peaks, every fifth line a little brighter, like a survey map. The pointer raises a
 * soft hill so the lines bend around it. Pauses off screen; a still frame for
 * reduced motion; without WebGL2 the hero simply stays plain.
 */

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 R;     // resolution, pixels
uniform float T;    // time, seconds
uniform vec2 M;     // pointer in uv space (eased)
uniform float A;    // pointer presence, 0..1
uniform float W;    // 1 on wide screens: keep the left side quiet for the text

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / R;                 // 0..1
  vec2 p = (gl_FragCoord.xy - 0.5 * R) / R.y;    // aspect-correct
  float t = T * 0.035;

  // Terrain: noise warped by noise, drifting slowly.
  vec2 q = 1.15 * p;
  vec2 w1 = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, 1.3) - t));
  vec2 w2 = vec2(fbm(q + 1.6 * w1 + vec2(1.7, 9.2) + t * 0.6), fbm(q + 1.6 * w1 + vec2(8.3, 2.8) - t * 0.4));
  float h = fbm(q + 1.8 * w2);

  // A soft hill under the pointer.
  vec2 mp = (M - 0.5) * vec2(R.x / R.y, 1.0);
  float near = exp(-dot(p - mp, p - mp) * 7.0);
  h += A * 0.16 * near;

  // Contour lines, anti-aliased with screen-space derivatives.
  float bands = 18.0;
  float f = h * bands;
  float d = abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1e-4);
  float lineA = 1.0 - clamp(d - 0.15, 0.0, 1.0);
  // Every fifth line is an index line, slightly stronger.
  float major = step(abs(mod(floor(f + 0.5), 5.0)), 0.5);

  // Warmth: the highest ground, a slow light sweeping across every ~14s, and the pointer.
  float peak = smoothstep(0.56, 0.7, h);
  float sweepPos = mod(T * 0.22, 3.2) - 1.6;
  float sweep = exp(-pow(p.x * 0.85 + p.y * 0.35 - sweepPos, 2.0) * 7.0);
  peak = max(peak, max(sweep * 0.85, A * near * 0.9));
  vec3 zinc = vec3(0.3, 0.3, 0.33);
  vec3 orange = vec3(0.957, 0.376, 0.212);
  vec3 lineCol = mix(zinc, orange, peak);
  float strength = mix(0.55, 1.0, major) * mix(0.75, 1.15, peak);

  vec3 bg = vec3(0.035, 0.035, 0.043);
  vec3 col = bg;
  // A faint warm glow on the highest ground.
  col += orange * pow(peak, 2.0) * 0.06;
  col = mix(col, lineCol, lineA * strength * 0.85);

  // Keep the text side calm, and fade every edge into the page.
  // Phones: the text covers the whole width, so the terrain stays faint everywhere.
  float side = mix(0.4, smoothstep(0.18, 0.62, uv.x), W);
  float edge = smoothstep(0.0, 0.18, uv.y) * smoothstep(1.0, 0.82, uv.y) * smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x);
  col = mix(bg, col, side * edge);

  col += (h2(gl_FragCoord.xy + fract(T)) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;

export function mountContours(canvas: HTMLCanvasElement, host: HTMLElement) {
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
    console.warn("Hero background unavailable:", err);
    return false;
  }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const uR = u("R"), uT = u("T"), uM = u("M"), uA = u("A"), uW = u("W");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let w = 1;
  let h = 1;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width * dpr));
    h = Math.max(1, Math.round(r.height * dpr));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  };

  // Pointer in the canvas's own 0..1 space, eased; fades out when the pointer leaves.
  const target = { x: 0.7, y: 0.5, a: 0 };
  const mouse = { x: 0.7, y: 0.5, a: 0 };
  if (!reduced) {
    host.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      target.x = (e.clientX - r.left) / r.width;
      target.y = 1 - (e.clientY - r.top) / r.height;
      target.a = 1;
    });
    host.addEventListener("pointerleave", () => (target.a = 0));
  }

  const draw = (time: number) => {
    mouse.x += (target.x - mouse.x) * 0.06;
    mouse.y += (target.y - mouse.y) * 0.06;
    mouse.a += (target.a - mouse.a) * 0.04;
    gl.uniform2f(uR, w, h);
    gl.uniform1f(uT, time);
    gl.uniform2f(uM, mouse.x, mouse.y);
    gl.uniform1f(uA, mouse.a);
    gl.uniform1f(uW, w / h > 1.1 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  resize();
  new ResizeObserver(() => {
    resize();
    if (reduced) draw(20);
  }).observe(canvas);
  canvas.dataset.ready = "";
  if (reduced) {
    draw(20);
    return true;
  }

  let visible = true;
  let raf = 0;
  const start = performance.now();
  const loop = (now: number) => {
    draw((now - start) / 1000 + 20);
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
  return true;
}
