"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { loadParsedLut } from "@/lib/luts/client-cache";
import type { ParsedCubeLut } from "@/lib/luts/cube-parse";
import { cn } from "@/lib/utils";

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  // Flip Y so video/image top matches canvas top.
  vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
uniform sampler2D uSource;
uniform sampler3D uLut;
uniform float uSize;
out vec4 fragColor;
void main() {
  vec4 src = texture(uSource, vUv);
  float scale = (uSize - 1.0) / uSize;
  float offset = 0.5 / uSize;
  vec3 coord = clamp(src.rgb, 0.0, 1.0) * scale + offset;
  vec3 graded = texture(uLut, coord).rgb;
  fragColor = vec4(graded, src.a);
}`;

type SourceEl = HTMLVideoElement | HTMLImageElement;

function createProgram(gl: WebGL2RenderingContext) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  gl.shaderSource(vs, VERT);
  gl.shaderSource(fs, FRAG);
  gl.compileShader(vs);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(vs));
    return null;
  }
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(fs));
    return null;
  }
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function uploadLutTexture(
  gl: WebGL2RenderingContext,
  lut: ParsedCubeLut,
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  // 8-bit 3D texture is widely supported; float 3D + LINEAR is flaky.
  const bytes = new Uint8Array(lut.data.length);
  for (let i = 0; i < lut.data.length; i++) {
    bytes[i] = Math.max(0, Math.min(255, Math.round(lut.data[i]! * 255)));
  }
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGB8,
    lut.size,
    lut.size,
    lut.size,
    0,
    gl.RGB,
    gl.UNSIGNED_BYTE,
    bytes,
  );
  return tex;
}

export function LutGradeCanvas({
  sourceRef,
  lutId,
  className,
  onFallback,
}: {
  sourceRef: RefObject<SourceEl | null>;
  lutId: string;
  className?: string;
  onFallback?: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      onFallback?.("WebGL2 unavailable — showing ungraded preview");
      return;
    }

    let disposed = false;
    let raf = 0;
    let vfcHandle: number | null = null;
    let program: WebGLProgram | null = null;
    let sourceTex: WebGLTexture | null = null;
    let lutTex: WebGLTexture | null = null;
    let uSource: WebGLUniformLocation | null = null;
    let uLut: WebGLUniformLocation | null = null;
    let uSize: WebGLUniformLocation | null = null;
    let size = 33;

    const draw = () => {
      if (disposed) return;
      const source = sourceRef.current;
      if (!source || !program) return;

      const width =
        source instanceof HTMLVideoElement
          ? source.videoWidth
          : source.naturalWidth;
      const height =
        source instanceof HTMLVideoElement
          ? source.videoHeight
          : source.naturalHeight;
      if (!width || !height) return;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
      if (uSource) gl.uniform1i(uSource, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTex);
      if (uLut) gl.uniform1i(uLut, 1);
      if (uSize) gl.uniform1f(uSize, size);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const tickVideo = () => {
      draw();
      const video = sourceRef.current;
      if (
        video instanceof HTMLVideoElement &&
        "requestVideoFrameCallback" in video
      ) {
        vfcHandle = video.requestVideoFrameCallback(() => tickVideo());
      } else {
        raf = requestAnimationFrame(tickVideo);
      }
    };

    void (async () => {
      try {
        const lut = await loadParsedLut(lutId);
        if (disposed) return;
        size = lut.size;

        program = createProgram(gl);
        if (!program) {
          onFallback?.("WebGL shader failed — showing ungraded preview");
          return;
        }

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([
            -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
          ]),
          gl.STATIC_DRAW,
        );
        const aPos = gl.getAttribLocation(program, "aPos");
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        sourceTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, sourceTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        lutTex = uploadLutTexture(gl, lut);
        if (!lutTex) {
          onFallback?.("Failed to upload LUT — showing ungraded preview");
          return;
        }

        uSource = gl.getUniformLocation(program, "uSource");
        uLut = gl.getUniformLocation(program, "uLut");
        uSize = gl.getUniformLocation(program, "uSize");

        setReady(true);
        tickVideo();
      } catch (error) {
        onFallback?.(
          error instanceof Error
            ? error.message
            : "Failed to load LUT — showing ungraded preview",
        );
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      const video = sourceRef.current;
      if (
        vfcHandle != null &&
        video instanceof HTMLVideoElement &&
        "cancelVideoFrameCallback" in video
      ) {
        video.cancelVideoFrameCallback(vfcHandle);
      }
      if (sourceTex) gl.deleteTexture(sourceTex);
      if (lutTex) gl.deleteTexture(lutTex);
      if (program) gl.deleteProgram(program);
      setReady(false);
    };
  }, [lutId, onFallback, sourceRef]);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "pointer-events-none max-h-full max-w-full object-contain",
        !ready && "opacity-0",
        className,
      )}
    />
  );
}
