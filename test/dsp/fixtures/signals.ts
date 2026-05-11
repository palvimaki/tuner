export function makePluckSignal(
  frequency: number,
  {
    sampleRate = 44_100,
    length = 4_096,
    harmonics = [1, 0.48, 0.2, 0.1],
  }: {
    sampleRate?: number;
    length?: number;
    harmonics?: number[];
  } = {},
): Float32Array {
  const signal = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 4.2);
    let sample = 0;
    harmonics.forEach((weight, index) => {
      sample += weight * Math.sin(2 * Math.PI * frequency * (index + 1) * t);
    });
    signal[i] = sample * envelope;
  }
  return signal;
}
