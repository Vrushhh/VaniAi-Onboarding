import { useEffect, useRef } from "react";

interface WaveLayer {
  colorLight: string;
  strokeLight: string;
  colorDark: string;
  strokeDark: string;
  speed: number;
  amp: number;
  freq: number;
  phase: number;
  yRatio: number;
  width: number;
}

export function WaveBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;
    let step = 0;

    // Exact layer properties matching kzuno.in design
    const waveLayers: WaveLayer[] = [
      {
        colorLight: "rgba(24, 90, 58, 0.035)",
        strokeLight: "rgba(24, 90, 58, 0.16)",
        colorDark: "rgba(52, 211, 153, 0.04)",
        strokeDark: "rgba(52, 211, 153, 0.22)",
        speed: 0.028,
        amp: 55,
        freq: 0.003,
        phase: 0,
        yRatio: 0.35,
        width: 1.5,
      },
      {
        colorLight: "rgba(242, 168, 29, 0.025)",
        strokeLight: "rgba(242, 168, 29, 0.15)",
        colorDark: "rgba(251, 191, 36, 0.03)",
        strokeDark: "rgba(251, 191, 36, 0.20)",
        speed: 0.042,
        amp: 65,
        freq: 0.002,
        phase: 2.2,
        yRatio: 0.55,
        width: 1.5,
      },
      {
        colorLight: "rgba(13, 59, 38, 0.030)",
        strokeLight: "rgba(13, 59, 38, 0.15)",
        colorDark: "rgba(16, 185, 129, 0.04)",
        strokeDark: "rgba(16, 185, 129, 0.22)",
        speed: 0.022,
        amp: 45,
        freq: 0.004,
        phase: 4.1,
        yRatio: 0.25,
        width: 2.0,
      },
      {
        colorLight: "rgba(24, 90, 58, 0.025)",
        strokeLight: "rgba(24, 90, 58, 0.14)",
        colorDark: "rgba(52, 211, 153, 0.03)",
        strokeDark: "rgba(52, 211, 153, 0.18)",
        speed: 0.035,
        amp: 70,
        freq: 0.0025,
        phase: 1.5,
        yRatio: 0.75,
        width: 1.5,
      },
    ];

    let width = parent.clientWidth || 300;
    let height = parent.clientHeight || 300;

    const updateSize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = parent.clientWidth || 300;
      height = parent.clientHeight || 300;

      canvas.width = width * dpr;
      canvas.height = height * dpr;

      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.scale(dpr, dpr);
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(parent);

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      step += 0.8;

      const isDark = document.documentElement.classList.contains("dark");
      // Pendulum oscillation shift across whole canvas
      const pendulum = Math.sin(step * 0.008) * 35;

      waveLayers.forEach((layer) => {
        ctx.beginPath();
        ctx.fillStyle = isDark ? layer.colorDark : layer.colorLight;
        ctx.strokeStyle = isDark ? layer.strokeDark : layer.strokeLight;
        ctx.lineWidth = layer.width || 1.5;

        const baseCenterY = height * layer.yRatio + pendulum;
        ctx.moveTo(0, height);

        for (let x = 0; x <= width; x += 5) {
          const y =
            baseCenterY +
            Math.sin(x * layer.freq + step * layer.speed + layer.phase) * layer.amp +
            Math.cos(x * layer.freq * 0.6 + step * layer.speed * 0.8 + layer.phase) *
              (layer.amp * 0.5);
          ctx.lineTo(x, y);
        }

        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });

      animFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animFrameId);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-0"
      style={{ pointerEvents: "none" }}
    />
  );
}
