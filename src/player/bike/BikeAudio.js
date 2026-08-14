/**
 * BROKEN ROAD — ENGINE AUDIO
 * ============================================================================
 * A parallel twin, synthesised. No samples, same rule as the rest of the audio
 * in this project.
 *
 * WHAT MAKES AN ENGINE SOUND LIKE AN ENGINE
 * Not the pitch. A four-stroke twin at 3000 rpm fires 50 times a second, which
 * is down at the bottom of hearing — you do not perceive it as a note, you
 * perceive it as a *rate*. Everything audible above that is harmonics of the
 * firing rate shaped by the pipe. So the synth is built as:
 *
 *   FIRING     a sawtooth at the firing frequency (rpm/60 for a twin, because
 *              each of two cylinders fires once every two revolutions). This
 *              carries the rate and almost none of the loudness.
 *   LOPE       a second sawtooth an OCTAVE DOWN. A 270-degree-crank twin fires
 *              unevenly — bang-bang ... bang-bang — and that half-rate beat is
 *              the entire difference between a big twin and a scooter. It is
 *              the single most important oscillator here.
 *   HARMONIC   a square at 2x, quiet, for the metallic edge of the header.
 *   INTAKE     filtered noise, gain driven by THROTTLE rather than by rpm, so
 *              the engine audibly strains when it is working and goes quiet on
 *              a trailing throttle even though the revs have not changed. That
 *              distinction is what makes the bike feel like it has load on it.
 *
 * All four go through one resonant lowpass whose cutoff tracks rpm, which is
 * what produces the sense of the engine "opening up" rather than just getting
 * louder, and then a soft clipper for the ragged edge of an old motor.
 *
 * PITCH IS NEVER SET DIRECTLY. Every parameter is driven with
 * setTargetAtTime, so a gear change or a stall glides over its own time
 * constant instead of stepping — a stepped frequency on a sustained oscillator
 * is heard as a click, and there are a lot of gear changes in a session.
 * ============================================================================
 */

export class BikeAudio {
  /** @param {object} audio the `audio` system, for its AudioContext and buses */
  constructor(audio) {
    this.audio = audio || null;
    this.started = false;
    this.nodes = null;
    this._lastRpm = 900;
  }

  /**
   * Build the graph. Deferred until the engine first runs, because the audio
   * context does not exist until the player has interacted with the page and
   * there is no point holding four oscillators open for a bike nobody has
   * touched yet.
   */
  start() {
    const A = this.audio;
    if (this.started || !A || !A.actx || !A.bus) return false;
    const ac = A.actx;
    if (ac.state === 'suspended') return false;
    const dest = A.bus.foley || A.bus.sfx;
    if (!dest) return false;

    const now = ac.currentTime;
    const out = ac.createGain();
    out.gain.value = 0;
    out.connect(dest);

    /* Soft clipper. A 3rd-order odd curve: linear when quiet, compressing as
       it is driven, which adds harmonics in proportion to how hard the engine
       is working rather than uniformly. */
    const shaper = ac.createWaveShaper();
    const N = 1024, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) * 0.86;
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    shaper.connect(out);

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 4.2;
    lp.connect(shaper);

    const mk = (type, gain) => {
      const o = ac.createOscillator();
      o.type = type;
      const g = ac.createGain();
      g.gain.value = gain;
      o.connect(g); g.connect(lp);
      o.start(now);
      return { o, g };
    };
    /* Detune between the two sawtooths beats slowly against itself, which is
       what stops a synthesised engine sounding like a held organ chord. */
    const fire = mk('sawtooth', 0.30);
    const lope = mk('sawtooth', 0.62);
    const harm = mk('square', 0.10);
    lope.o.detune.value = -9;

    /* Intake / mechanical noise. One second of noise on a loop is long enough
       that the period is inaudible under everything else. */
    const len = ac.sampleRate | 0;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    /* Deterministic — CONTRACTS §1.4, no Math.random anywhere in this project. */
    let seed = 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2545f491) + 0x6d2b79f5) | 0;
      d[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nbp = ac.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 700;
    nbp.Q.value = 0.9;
    const ngain = ac.createGain();
    ngain.gain.value = 0;
    noise.connect(nbp); nbp.connect(ngain); ngain.connect(lp);
    noise.start(now);

    this.nodes = { ac, out, lp, fire, lope, harm, noise, nbp, ngain };
    this.started = true;
    return true;
  }

  /**
   * @param {number} rpm      crank speed
   * @param {number} throttle 0..1 how much load the rider is asking for
   * @param {number} volume   0..1 overall, faded by distance / mounted state
   */
  update(rpm, throttle, volume) {
    if (!this.started) {
      if (volume > 0.001) this.start();
      if (!this.started) return;
    }
    const n = this.nodes;
    const t = n.ac.currentTime;
    /* Two cylinders, four-stroke: one firing event per crank revolution. */
    const f = Math.max(6, rpm / 60);
    const set = (p, v, tau) => p.setTargetAtTime(v, t, tau);

    set(n.fire.o.frequency, f, 0.035);
    set(n.lope.o.frequency, f * 0.5, 0.035);
    set(n.harm.o.frequency, f * 2, 0.035);
    /* Cutoff opens with revs AND with load — a motor on a closed throttle is
       muffled at the same rpm at which it is raucous on an open one. */
    set(n.lp.frequency, 260 + f * 5.2 + throttle * 620, 0.05);
    set(n.nbp.frequency, 420 + f * 6.5, 0.05);
    set(n.ngain.gain, throttle * 0.20 + 0.015, 0.09);
    set(n.harm.g.gain, 0.05 + throttle * 0.13, 0.09);
    set(n.out.gain, Math.max(0, Math.min(1, volume)) * 0.42, 0.06);
    this._lastRpm = rpm;
  }

  /** One-shot: the starter turning over and catching. */
  kick() {
    if (!this.started) this.start();
    if (!this.started) return;
    const n = this.nodes, t = n.ac.currentTime;
    n.out.gain.cancelScheduledValues(t);
    n.out.gain.setValueAtTime(0.0, t);
    n.out.gain.linearRampToValueAtTime(0.30, t + 0.10);
    n.lp.frequency.cancelScheduledValues(t);
    n.lp.frequency.setValueAtTime(180, t);
    n.lp.frequency.linearRampToValueAtTime(900, t + 0.42);
  }

  dispose() {
    if (!this.started) return;
    const n = this.nodes;
    try {
      n.fire.o.stop(); n.lope.o.stop(); n.harm.o.stop(); n.noise.stop();
      n.out.disconnect();
    } catch (e) { /* context already gone */ }
    this.started = false;
    this.nodes = null;
  }
}
