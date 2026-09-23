// Noise gate on the audio thread: closes the microphone when its level stays
// under the threshold for a moment, and reports the level for the meter.
// Runs regardless of whether the page is visible, unlike page timers.
class MicGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'threshold', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.gain = 1;
    this.open = true;
    this.lastAbove = currentTime;
    this.peak = 0;
    this.lastPost = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;
    const threshold = parameters.threshold[0];
    const mono = input[0];
    let sum = 0;
    for (let i = 0; i < mono.length; i += 1) sum += mono[i] * mono[i];
    const rms = Math.sqrt(sum / mono.length);
    if (rms >= threshold) this.lastAbove = currentTime;
    const open = threshold === 0 || currentTime - this.lastAbove < 0.35;
    const target = open ? 1 : 0;
    this.gain += (target - this.gain) * (open ? 0.35 : 0.08); // fast attack, gentle release
    for (let c = 0; c < output.length; c += 1) {
      const from = input[c] || mono;
      const to = output[c];
      for (let i = 0; i < to.length; i += 1) to[i] = from[i] * this.gain;
    }
    this.peak = Math.max(this.peak, rms);
    if (currentTime - this.lastPost >= 0.05) {
      this.port.postMessage({ level: this.peak, open });
      this.peak = 0;
      this.lastPost = currentTime;
    }
    return true;
  }
}

registerProcessor('mic-gate', MicGate);
