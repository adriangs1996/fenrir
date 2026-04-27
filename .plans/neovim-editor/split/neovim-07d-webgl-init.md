---
depends_on:
  - neovim-07b-canvas-renderer-cursor
---

# Plan 07d: WebGLCompositor Initialization

## Goal

Create `WebGLCompositor` class with WebGL2 context acquisition, shader program for textured-quad rendering, vertex/UV buffers, Canvas2D fallback path.

## Scope

- New file: `apps/web/src/modules/neovim-editor/renderer/WebGLCompositor.ts` (constructor + shader init; composite logic in 07e)

## Steps

### Step 1. Layer interface + types

```typescript
export interface CompositeLayer {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
  zindex: number;
  blend: number; // 0..100
}
```

### Step 2. Class scaffold

```typescript
export class WebGLCompositor {
  protected gl: WebGL2RenderingContext | null;
  protected canvas: HTMLCanvasElement;
  protected fallback2d: CanvasRenderingContext2D | null = null;

  protected program: WebGLProgram | null = null;
  protected posBuffer: WebGLBuffer | null = null;
  protected texBuffer: WebGLBuffer | null = null;
  protected texture: WebGLTexture | null = null;
  protected uPositionLoc: WebGLUniformLocation | null = null;
  protected uSizeLoc: WebGLUniformLocation | null = null;
  protected uViewportLoc: WebGLUniformLocation | null = null;
  protected uAlphaLoc: WebGLUniformLocation | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      antialias: false,
      desynchronized: true,
    }) as WebGL2RenderingContext | null;

    if (this.gl) {
      this.initShaders();
      this.initBuffers();
    } else {
      console.warn(
        "[WebGLCompositor] WebGL2 unavailable; falling back to Canvas2D",
      );
      this.fallback2d = canvas.getContext("2d");
    }
  }
}
```

### Step 3. Shader program

Append in class:

```typescript
private initShaders(): void {
  const gl = this.gl!;
  const vsSource = `#version 300 es
    in vec2 a_pos;
    in vec2 a_uv;
    uniform vec2 u_position;
    uniform vec2 u_size;
    uniform vec2 u_viewport;
    out vec2 v_uv;
    void main() {
      vec2 pixel = u_position + a_pos * u_size;
      // Map pixel space [0..viewport] → clip space [-1..1], y-flipped
      vec2 clip = (pixel / u_viewport) * 2.0 - 1.0;
      clip.y = -clip.y;
      gl_Position = vec4(clip, 0.0, 1.0);
      v_uv = a_uv;
    }
  `;
  const fsSource = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform sampler2D u_tex;
    uniform float u_alpha;
    out vec4 fragColor;
    void main() {
      vec4 sampled = texture(u_tex, v_uv);
      fragColor = vec4(sampled.rgb, sampled.a * u_alpha);
    }
  `;

  const program = compileProgram(gl, vsSource, fsSource);
  this.program = program;

  this.uPositionLoc = gl.getUniformLocation(program, "u_position");
  this.uSizeLoc = gl.getUniformLocation(program, "u_size");
  this.uViewportLoc = gl.getUniformLocation(program, "u_viewport");
  this.uAlphaLoc = gl.getUniformLocation(program, "u_alpha");
}
```

### Step 4. `compileProgram` helper (module scope)

```typescript
function compileProgram(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vs);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL: createProgram failed");
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.bindAttribLocation(program, 1, "a_uv");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`WebGL link failed: ${log}`);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL: createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WebGL compile failed: ${log}`);
  }
  return shader;
}
```

### Step 5. `initBuffers`

```typescript
private initBuffers(): void {
  const gl = this.gl!;

  // Quad: 2 triangles, 6 verts. Positions in [0,1] unit square.
  const positions = new Float32Array([
    0, 0,  1, 0,  0, 1,
    0, 1,  1, 0,  1, 1,
  ]);
  const uvs = new Float32Array([
    0, 0,  1, 0,  0, 1,
    0, 1,  1, 0,  1, 1,
  ]);

  this.posBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  this.texBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

  this.texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this.texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
```

### Step 6. Note for 07e

`composite`, `compositeWebGL`, `compositeFallback`, `resize`, `dispose` come in 07e. This sub-plan establishes the GL state.

## Validation

- `bun typecheck`
- Browser smoke: `new WebGLCompositor(canvas)` should not throw on machines with WebGL2; should fall back gracefully without it.

## Done Criteria

- `WebGLCompositor` class exported with constructor
- WebGL2 context acquired with correct attribs (`alpha: false`, `premultipliedAlpha: false`)
- Vertex + fragment shader compile and link
- Quad position + UV buffers populated
- NEAREST filtering + CLAMP_TO_EDGE on the texture
- Fallback to `getContext("2d")` when WebGL2 absent
- Uniform locations cached
