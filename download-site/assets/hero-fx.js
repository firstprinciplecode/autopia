// The hero's machine backdrop, one WebGL fragment shader: a mint dot lattice that twinkles,
// steel-blue data falling down a few of its columns, faint scanlines and a dark vignette.
// Without WebGL the canvas is removed and the CSS glow underneath stays.

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dpr;

const vec3 MINT = vec3(0.855, 0.965, 0.792);
const vec3 STEEL = vec3(0.251, 0.498, 0.655);
const vec3 STEEL_L = vec3(0.498, 0.702, 0.839);
const vec3 LILAC = vec3(0.953, 0.792, 0.965);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 px = gl_FragCoord.xy / u_dpr;
  vec2 size = u_res / u_dpr;
  float cell = 22.0;
  vec2 id = floor(px / cell);
  vec2 local = px - (id + 0.5) * cell;

  // Dots: dim everywhere, with the odd one blinking on.
  float h = hash(id);
  float blink = pow(0.5 + 0.5 * sin(u_time * (0.4 + h * 0.9) + h * 40.0), 14.0);
  float dot = smoothstep(1.3, 0.4, length(local));
  vec3 dotColor = mix(MINT, LILAC, step(0.93, hash(id + 7.0)));
  float dots = dot * (0.07 + blink * 0.55);

  // Data rain: a lit head falling down one column in six, trailing off above it.
  float col = hash(vec2(id.x, 3.0));
  float lane = step(0.83, col);
  float speed = 0.035 + col * 0.05;
  float head = 1.0 - fract(u_time * speed + col * 9.0);
  float y = 1.0 - px.y / size.y;
  float behind = head - y;
  float trail = behind > 0.0 ? exp(-behind * 9.0) : 0.0;
  float line = smoothstep(0.9, 0.2, abs(local.x));
  float rain = lane * line * trail * 0.5;
  float spark = lane * dot * smoothstep(0.03, 0.0, abs(behind)) * 0.9;

  vec3 color = dotColor * dots + mix(STEEL, STEEL_L, trail) * rain + STEEL_L * spark;
  float alpha = clamp(dots + rain + spark, 0.0, 1.0);

  // Scanlines and a vignette, calmest behind the headline.
  color *= 0.94 + 0.06 * sin(px.y * 3.14159);
  vec2 uv = (px / size - 0.5) * vec2(size.x / size.y, 1.0);
  float vignette = smoothstep(1.05, 0.25, length(uv * vec2(0.9, 1.2)));
  float calm = mix(0.45, 1.0, smoothstep(0.15, 0.55, length(uv * vec2(0.8, 1.6))));
  float k = vignette * calm;
  gl_FragColor = vec4(color * k, alpha * k);
}`;

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

function initHeroFx() {
  const canvas = document.querySelector("[data-hero-fx]");
  if (!canvas) return;
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return canvas.remove();

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs) return canvas.remove();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return canvas.remove();
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uDpr = gl.getUniformLocation(prog, "u_dpr");

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const t0 = performance.now();
  let frame = 0;
  let visible = false;

  const draw = (now) => {
    gl.uniform1f(uTime, reduceMotion ? 12 : (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const resize = () => {
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h || (canvas.width === w && canvas.height === h)) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uDpr, dpr);
    draw(performance.now());
  };
  const loop = (now) => {
    draw(now);
    frame = requestAnimationFrame(loop);
  };
  const sync = () => {
    cancelAnimationFrame(frame);
    if (visible && !document.hidden && !reduceMotion) frame = requestAnimationFrame(loop);
  };

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }).observe(canvas);
  document.addEventListener("visibilitychange", sync);
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(frame); canvas.remove(); });
  resize();
  canvas.classList.add("is-on");
}

initHeroFx();
