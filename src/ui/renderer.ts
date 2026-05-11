import { computeStringXs, type RenderState } from "./scene";

export class Renderer {
  private readonly context: CanvasRenderingContext2D;
  private state: RenderState = {
    mode: "idle",
    strings: [],
    dimmed: false,
    pulsePicker: false,
    celebrationProgress: 0,
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas2D unavailable");
    this.context = context;
    this.resize();
    window.addEventListener("resize", this.resize);
    requestAnimationFrame(this.render);
  }

  setState(state: RenderState): void {
    this.state = state;
  }

  private resize = (): void => {
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * ratio);
    this.canvas.height = Math.floor(window.innerHeight * ratio);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  private render = (timestamp: number): void => {
    const { context } = this;
    const width = window.innerWidth;
    const height = window.innerHeight;

    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#120b08");
    gradient.addColorStop(0.5, "#1c130f");
    gradient.addColorStop(1, "#090606");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const xs = computeStringXs(width, this.state.strings.length || 6);
    const railWidth = 28;
    context.fillStyle = "rgba(171, 118, 72, 0.18)";
    context.fillRect(xs[0] - railWidth, 36, railWidth, height - 72);
    context.fillRect(xs[xs.length - 1], 36, railWidth, height - 72);

    this.state.strings.forEach((stringState, index) => {
      const x = xs[index];
      const amp = Math.min(30, stringState.amplitude * 260);
      const cents = stringState.cents ?? 0;
      const hue = stringState.locked ? "rgba(200, 180, 120, 0.95)" : stringState.active ? "rgba(249, 233, 179, 0.96)" : "rgba(198, 189, 170, 0.72)";
      const guideShift = Math.max(-32, Math.min(32, (cents / 50) * 32));

      context.strokeStyle = hue;
      context.lineWidth = stringState.active ? 3 : 2;
      context.shadowBlur = stringState.active || stringState.locked ? 18 : 8;
      context.shadowColor = stringState.locked ? "rgba(234, 203, 99, 0.72)" : "rgba(255, 234, 180, 0.55)";
      context.beginPath();
      for (let y = 48; y <= height - 48; y += 12) {
        const t = (y / height) * Math.PI * 4 + timestamp * 0.01;
        const dx = stringState.active ? Math.sin(t) * amp * Math.exp(-y / height) : Math.sin(t) * amp * 0.2;
        if (y === 48) context.moveTo(x + dx, y);
        else context.lineTo(x + dx, y);
      }
      context.stroke();
      context.shadowBlur = 0;

      if (stringState.active) {
        context.fillStyle = "rgba(255, 228, 171, 0.78)";
        context.beginPath();
        context.arc(x + guideShift, height * 0.5, 8, 0, Math.PI * 2);
        context.fill();
      }
    });

    if (this.state.celebrationProgress > 0) {
      const shimmerY = (1 - this.state.celebrationProgress) * height;
      context.strokeStyle = `rgba(255, 230, 178, ${this.state.celebrationProgress})`;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(24, shimmerY);
      context.lineTo(width - 24, shimmerY);
      context.stroke();
    }

    if (this.state.dimmed) {
      context.fillStyle = "rgba(7, 5, 4, 0.46)";
      context.fillRect(0, 0, width, height);
    }

    requestAnimationFrame(this.render);
  };
}
