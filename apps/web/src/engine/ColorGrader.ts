// ─────────────────────────────────────────────────────────────────────────────
// ColorGrader — offscreen WebGL colour-grade pass that MATCHES FFmpeg `eq`.
//
// Why WebGL and not CSS `filter: brightness()/contrast()/saturate()`:
//   CSS filters use different math and operate in display-sRGB, so they diverge
//   visibly from FFmpeg `eq` — which breaks the "what you cut is what you get"
//   preview==export parity that is VideoForge's entire wedge. The fragment shader
//   below replicates `eq`'s model (vf_eq.c): contrast+brightness on BT.601 luma,
//   saturation on chroma — and uses the SAME UI→param mapping the export builder
//   uses (packages/ffmpeg-graph buildFilterComplex.colorGradeExtOf):
//
//     brightness ∈ [-100,100] → eq.brightness = clamp(b/100, -1, 1)   (luma offset)
//     contrast   ∈ [-100,100] → eq.contrast   = clamp(1+c/100, 0, 2)  (luma gain @0.5)
//     saturation ∈ [-100,100] → eq.saturation = clamp(1+s/100, 0, 3)  (chroma gain)
//
// eq math per channel (normalised 0..1):
//     Y      = dot(rgb, [0.299, 0.587, 0.114])            // BT.601 luma (yuv420p)
//     Y'     = (Y - 0.5) * contrast + 0.5 + brightness
//     chroma'= (rgb - Y) * saturation
//     rgb'   = Y' + chroma'
//
// apply() returns an offscreen canvas (a CanvasImageSource) the caller drawImages.
// Returns null if WebGL is unavailable — caller then draws the ungraded source.
// ─────────────────────────────────────────────────────────────────────────────

import type { ColorGrade } from "@videoforge/project-schema";

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_brightness; // eq brightness (luma offset)
uniform float u_contrast;   // eq contrast (luma gain @0.5)
uniform float u_saturation; // eq saturation (chroma gain)
const vec3 LUMA = vec3(0.299, 0.587, 0.114); // BT.601 (matches FFmpeg yuv420p)
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  float y = dot(c.rgb, LUMA);
  float yp = (y - 0.5) * u_contrast + 0.5 + u_brightness;
  vec3 chroma = (c.rgb - vec3(y)) * u_saturation;
  vec3 outc = clamp(vec3(yp) + chroma, 0.0, 1.0);
  gl_FragColor = vec4(outc, c.a);
}`;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** FFmpeg `eq` filter parameters (the shader's three uniforms). */
export interface EqParams {
  /** Luma offset, eq.brightness ∈ [-1, 1]. */
  brightness: number;
  /** Luma gain @0.5, eq.contrast ∈ [0, 2]. */
  contrast: number;
  /** Chroma gain, eq.saturation ∈ [0, 3]. */
  saturation: number;
}

/**
 * Map the UI-centred colour-grade values (−100..100) to FFmpeg `eq` parameters.
 *
 * This is the SINGLE source of the preview↔export parity mapping: it MUST stay
 * byte-identical to `colorGradeExtOf` in packages/ffmpeg-graph (which formats the
 * same three numbers into `eq=brightness=…:contrast=…:saturation=…`). The WebGL
 * shader feeds these straight into u_brightness/u_contrast/u_saturation, so the
 * canvas preview and the exported MP4 apply the same transform — "what you cut is
 * what you get". Keep this pure + dependency-free so it is unit-testable.
 */
export function eqParams(grade: ColorGrade): EqParams {
  const { brightness = 0, contrast = 0, saturation = 0 } = grade;
  return {
    brightness: clamp(brightness / 100, -1, 1),
    contrast: clamp(1 + contrast / 100, 0, 2),
    saturation: clamp(1 + saturation / 100, 0, 3),
  };
}

export class ColorGrader {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private uBrightness: WebGLUniformLocation | null = null;
  private uContrast: WebGLUniformLocation | null = null;
  private uSaturation: WebGLUniformLocation | null = null;
  private failed = false;

  private ensure(w: number, h: number): boolean {
    if (this.failed) return false;
    if (!this.gl) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const gl =
          canvas.getContext("webgl", { premultipliedAlpha: false }) ??
          (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
        if (!gl) { this.failed = true; return false; }
        this.canvas = canvas;
        this.gl = gl;
        this._initGL(gl);
      } catch {
        this.failed = true;
        return false;
      }
    }
    const canvas = this.canvas as HTMLCanvasElement;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return !!this.gl && !!this.program;
  }

  private _initGL(gl: WebGLRenderingContext): void {
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) ?? "shader compile failed");
      }
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
    }
    this.program = program;
    gl.useProgram(program);

    // Full-screen quad.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.uBrightness = gl.getUniformLocation(program, "u_brightness");
    this.uContrast = gl.getUniformLocation(program, "u_contrast");
    this.uSaturation = gl.getUniformLocation(program, "u_saturation");
  }

  /**
   * Grade `source` into the offscreen canvas and return it as a drawable.
   * `grade` values are the UI-centred (−100..100) values; mapped to eq params here.
   */
  apply(
    source: CanvasImageSource,
    w: number,
    h: number,
    grade: ColorGrade,
  ): CanvasImageSource | null {
    if (!this.ensure(w, h)) return null;
    const gl = this.gl!;
    try {
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.program);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);

      // Same mapping as packages/ffmpeg-graph colorGradeExtOf — parity by construction.
      const eq = eqParams(grade);
      gl.uniform1f(this.uBrightness, eq.brightness);
      gl.uniform1f(this.uContrast, eq.contrast);
      gl.uniform1f(this.uSaturation, eq.saturation);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this.canvas as CanvasImageSource;
    } catch {
      return null;
    }
  }

  destroy(): void {
    const gl = this.gl;
    if (gl) {
      if (this.tex) gl.deleteTexture(this.tex);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.program = null;
    this.tex = null;
    this.canvas = null;
  }
}
