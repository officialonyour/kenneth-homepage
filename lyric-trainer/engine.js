/**
 * Pure timing and analysis engine for Lyric Trainer.
 *
 * analyzeAudio(monoPCM, sampleRate) ->
 *   { bpm, offset, confidence, candidates, peaks, ambiguous, warnings }.
 * offset is the first observed onset aligned to the estimated BEAT grid, in
 * seconds. It is NOT a musically verified downbeat. The user should align the
 * first bar by ear. confidence and candidate scores range from 0 to 1.
 * Silence and audio shorter than four seconds throw an Error; a weak rhythmic
 * estimate is returned with low confidence rather than pretending certainty.
 * Work is bounded: at most 180 seconds are analyzed, at most 800 onset events
 * are used for tempo refinement, and the envelope runs at about 100 Hz.
 *
 * buildTargets(options) -> [{ target, start, end, bar }]. `bar` is one-based.
 * V3 uses fixed 4/4 time, BPM 40–240, and exactly one complete bar of pre-roll.
 * A target is offset + k * barSeconds, for a non-negative integer k. Every
 * target is strictly before duration, and its pre-roll starts at or after zero.
 * Playback always continues to the full audio duration; the last target may
 * therefore start in a partial final bar. Missing BPM defaults to 96.
 * Short audio without a viable target throws a descriptive RangeError.
 * offset is a first-bar anchor entered/confirmed by the user, not a promise
 * that an automatically detected onset is the first beat of a musical bar.
 *
 * pickTarget(plans, { lastTarget, weakTargets, random }) -> a plan or null.
 * weakTargets accepts numbers, { target, weight } objects, or a Map/object
 * mapping target seconds to weights. A weak target has weight 4 by default.
 * Whenever alternatives exist, the immediately previous target is excluded.
 */

const TWO_PI = 2 * Math.PI;
const DEFAULT_BPM = 96;
const MIN_BPM = 40;
const MAX_BPM = 240;
const MAX_TARGETS = 100000;

/** Every song once per cycle; keep the boundary from repeating a song. */
export function shuffleCycle(ids, { previous = null, random = Math.random } = {}) {
  const queue = [...new Set(ids)];
  const drawIndex = length => {
    const draw = Number(random());
    if (!Number.isFinite(draw)) throw new RangeError('Random source must return a finite number.');
    return Math.floor(Math.min(1 - Number.EPSILON, Math.max(0, draw)) * length);
  };
  for (let index = queue.length - 1; index > 0; index -= 1) {
    const other = drawIndex(index + 1);
    [queue[index], queue[other]] = [queue[other], queue[index]];
  }
  if (queue.length > 1 && queue[0] === previous) {
    const other = 1 + drawIndex(queue.length - 1);
    [queue[0], queue[other]] = [queue[other], queue[0]];
  }
  return queue;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
  return number;
}

function wholeNumber(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) throw new RangeError(`${name} must be an integer of at least ${minimum}.`);
  return number;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function validBpm(value = DEFAULT_BPM) {
  const bpm = Number(value);
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
    throw new RangeError(`BPM must be between ${MIN_BPM} and ${MAX_BPM}.`);
  }
  return bpm;
}

export function barSeconds(bpm = DEFAULT_BPM, beatsPerBar = 4) {
  if (wholeNumber(beatsPerBar, 'Beats per bar', 1) !== 4) {
    throw new RangeError('Lyric Trainer uses fixed 4/4 time (four beats per bar).');
  }
  return 240 / validBpm(bpm);
}

export function snapToBeat(time, bpm, offset = 0) {
  const period = 60 / validBpm(bpm);
  if (!Number.isFinite(Number(time)) || !Number.isFinite(Number(offset))) throw new RangeError('Time and offset must be finite.');
  return Math.max(0, Number(offset) + Math.round((Number(time) - Number(offset)) / period) * period);
}

export function snapToBar(time, bpm, beatsPerBar = 4, offset = 0) {
  const period = barSeconds(bpm, beatsPerBar);
  if (!Number.isFinite(Number(time)) || !Number.isFinite(Number(offset))) throw new RangeError('Time and offset must be finite.');
  return Math.max(0, Number(offset) + Math.round((Number(time) - Number(offset)) / period) * period);
}

export function buildTargets({ duration, bpm = DEFAULT_BPM, beatsPerBar = 4, offset = 0 } = {}) {
  const total = positiveNumber(duration, 'Duration');
  const barLength = barSeconds(bpm, beatsPerBar);
  const firstBeat = Number(offset);
  if (!Number.isFinite(firstBeat) || firstBeat < 0) throw new RangeError('First bar must be a finite time at or after zero.');
  if (firstBeat >= total) throw new RangeError('First bar must be before the end of the audio.');
  // The floor estimate may include one unusable early or final boundary. Check
  // both against the actual calculated time: an epsilon could admit duration
  // itself, or incorrectly exclude a legitimate tiny final partial bar.
  const first = Math.max(0, Math.floor((barLength - firstBeat) / barLength));
  const last = Math.floor((total - firstBeat) / barLength);
  if (!Number.isSafeInteger(last) || last - first > MAX_TARGETS + 1) {
    throw new RangeError('The audio contains too many bars to generate training starts.');
  }
  const plans = [];
  for (let k = first; k <= last; k += 1) {
    const target = firstBeat + k * barLength;
    const start = target - barLength;
    if (start >= 0 && target < total) {
      if (start === target || (plans.length && target <= plans[plans.length - 1].target)) {
        throw new RangeError('Audio timing is too large to represent individual bars accurately.');
      }
      if (plans.length >= MAX_TARGETS) throw new RangeError('The audio contains too many bars to generate training starts.');
      plans.push({ target, start, end: total, bar: k + 1 });
    }
  }
  if (!plans.length) {
    throw new RangeError('The audio is too short for one complete bar of pre-roll before a training start. Choose longer audio or check BPM and first bar.');
  }
  return plans;
}

function weakEntries(weakTargets) {
  if (!weakTargets) return [];
  if (weakTargets instanceof Map) return Array.from(weakTargets, ([target, weight]) => ({ target: Number(target), weight: Number(weight) }));
  if (Array.isArray(weakTargets) || weakTargets instanceof Set) {
    return Array.from(weakTargets, entry => typeof entry === 'number' ? { target: entry, weight: 4 } : { target: Number(entry.target), weight: Number(entry.weight ?? 4) });
  }
  return Object.entries(weakTargets).map(([target, weight]) => ({ target: Number(target), weight: Number(weight) }));
}

export function pickTarget(plans, { lastTarget = null, weakTargets = [], random = Math.random } = {}) {
  if (!Array.isArray(plans) || !plans.length) return null;
  const previous = lastTarget && typeof lastTarget === 'object' ? Number(lastTarget.target) : Number(lastTarget);
  const alternatives = lastTarget === null || lastTarget === undefined ? plans : plans.filter(plan => Math.abs(plan.target - previous) > 1e-5);
  const choices = alternatives.length ? alternatives : plans;
  const weak = weakEntries(weakTargets);
  const weights = choices.map(plan => {
    const match = weak.find(entry => Number.isFinite(entry.target) && Math.abs(entry.target - plan.target) < 0.02);
    return match ? clamp(Number.isFinite(match.weight) ? match.weight : 4, 1, 20) : 1;
  });
  const draw = Number(random());
  if (!Number.isFinite(draw)) throw new RangeError('Random source must return a finite number.');
  let cursor = clamp(draw, 0, 1 - Number.EPSILON) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < choices.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) return choices[index];
  }
  return choices[choices.length - 1];
}

/** A short-hop three-band energy flux keeps analysis inexpensive in a worker. */
function onsetEnvelope(samples, sampleRate, sampleCount) {
  const hop = Math.max(1, Math.round(sampleRate / 100));
  const count = Math.floor(sampleCount / hop);
  const bass = new Float64Array(count);
  const mid = new Float64Array(count);
  const high = new Float64Array(count);
  const bassAlpha = 1 - Math.exp(-TWO_PI * 180 / sampleRate);
  const trebleAlpha = 1 - Math.exp(-TWO_PI * Math.min(2000, sampleRate * 0.3) / sampleRate);
  let bassState = 0;
  let trebleState = 0;
  let energy = 0;
  for (let frame = 0; frame < count; frame += 1) {
    let bassEnergy = 0;
    let midEnergy = 0;
    let highEnergy = 0;
    const base = frame * hop;
    for (let i = 0; i < hop; i += 1) {
      const input = Number.isFinite(samples[base + i]) ? samples[base + i] : 0;
      bassState += bassAlpha * (input - bassState);
      trebleState += trebleAlpha * (input - trebleState);
      const upper = input - trebleState;
      const middle = trebleState - bassState;
      bassEnergy += bassState * bassState;
      midEnergy += middle * middle;
      highEnergy += upper * upper;
      energy += input * input;
    }
    bass[frame] = Math.sqrt(bassEnergy / hop);
    mid[frame] = Math.sqrt(midEnergy / hop);
    high[frame] = Math.sqrt(highEnergy / hop);
  }
  if (Math.sqrt(energy / Math.max(1, count * hop)) < 1e-5) throw new Error('No audible signal was found. Choose an audio file with music.');
  const envelope = new Float64Array(count);
  envelope[0] = Math.sqrt(bass[0] * 0.8 + mid[0] + high[0] * 1.2);
  let maximum = envelope[0];
  for (let i = 1; i < count; i += 1) {
    // Positive flux is resistant to sustained tones. The square root limits
    // the influence of an isolated loud hit on the overall tempo estimate.
    const previous = Math.max(0, i - 3);
    const novelty = Math.max(0, bass[i] - bass[previous]) * 0.8 + Math.max(0, mid[i] - mid[previous]) + Math.max(0, high[i] - high[previous]) * 1.2;
    envelope[i] = Math.sqrt(novelty);
    maximum = Math.max(maximum, envelope[i]);
  }
  if (maximum < 1e-7) throw new Error('No musical onsets were found. Enter the BPM and first beat manually.');
  for (let i = 0; i < count; i += 1) envelope[i] /= maximum;
  return { envelope, hop, hopSeconds: hop / sampleRate, rms: Math.sqrt(energy / (count * hop)) };
}

function extractPeaks(envelope, hopSeconds, samples, sampleRate, hop) {
  const events = [];
  const neighbourhood = Math.max(2, Math.round(0.08 / hopSeconds));
  let previous = -neighbourhood;
  let localSum = 0;
  const window = Math.round(1 / hopSeconds);
  for (let i = 0; i < envelope.length; i += 1) {
    localSum += envelope[i];
    if (i >= window) localSum -= envelope[i - window];
    const baseline = localSum / Math.min(i + 1, window);
    if (i >= envelope.length - 1 || envelope[i] < 0.09 || (i > 0 && envelope[i] < baseline * 1.35)) continue;
    if (envelope[i] < (envelope[i - 1] ?? 0) || envelope[i] <= envelope[i + 1]) continue;
    if (i - previous < neighbourhood) {
      if (events.length && envelope[i] > events[events.length - 1].strength) {
        events.pop();
      } else continue;
    }
    // Refine the event's time within a short raw-audio window. The result is
    // only an onset estimate: first-bar alignment remains a listening task.
    const begin = Math.max(0, (i - 1) * hop);
    const finish = Math.min(samples.length, (i + 1) * hop);
    let peak = 0;
    for (let s = begin; s < finish; s += 1) peak = Math.max(peak, Math.abs(samples[s]));
    const threshold = peak * 0.2;
    let onset = i * hop;
    for (let s = begin; s < finish; s += 1) {
      if (Math.abs(samples[s]) >= threshold && threshold > 0) { onset = s; break; }
    }
    events.push({ time: onset / sampleRate, strength: envelope[i] });
    previous = i;
  }
  if (events.length < 5) throw new Error('There are too few musical onsets to estimate BPM. Enter it manually.');
  return events;
}

function autocorrelation(envelope, maximumLag) {
  const mean = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
  const centered = Float64Array.from(envelope, value => value - mean);
  const result = new Float64Array(maximumLag + 1);
  for (let lag = 1; lag <= maximumLag; lag += 1) {
    let product = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let i = lag; i < centered.length; i += 1) {
      const left = centered[i - lag];
      const right = centered[i];
      product += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    result[lag] = Math.max(0, product / Math.max(1e-12, Math.sqrt(leftEnergy * rightEnergy)));
  }
  return result;
}

function interpolate(array, position) {
  const lower = Math.floor(position);
  const fraction = position - lower;
  return (array[lower] ?? 0) * (1 - fraction) + (array[lower + 1] ?? 0) * fraction;
}

function gridFit(events, bpm, includePhase = false) {
  const angular = TWO_PI * bpm / 60;
  let cosine = 0;
  let sine = 0;
  let weight = 0;
  let squares = 0;
  const blocks = new Map();
  for (const event of events) {
    const amplitude = Math.sqrt(event.strength);
    const phase = event.time * angular;
    const x = Math.cos(phase) * amplitude;
    const y = Math.sin(phase) * amplitude;
    cosine += x;
    sine += y;
    weight += amplitude;
    squares += amplitude * amplitude;
    const key = Math.floor(event.time / 12);
    let block = blocks.get(key);
    if (!block) { block = [0, 0, 0, 0]; blocks.set(key, block); }
    block[0] += x; block[1] += y; block[2] += amplitude; block[3] += amplitude * amplitude;
  }
  const corrected = (x, y, w, w2) => {
    const noise = Math.sqrt(w2) / Math.max(1e-9, w);
    return clamp((Math.hypot(x, y) / Math.max(1e-9, w) - noise) / Math.max(0.1, 1 - noise), 0, 1);
  };
  const global = corrected(cosine, sine, weight, squares);
  let segmented = 0;
  let segmentWeight = 0;
  for (const block of blocks.values()) {
    // Very short final blocks provide little rhythmic evidence.
    if (block[2] < 4) continue;
    segmented += corrected(...block) * block[2];
    segmentWeight += block[2];
  }
  const score = global * 0.6 + (segmentWeight ? segmented / segmentWeight : global) * 0.4;
  return includePhase ? { score, phase: Math.atan2(sine, cosine), global } : score;
}

export function analyzeAudio(samples, sampleRate) {
  const rate = positiveNumber(sampleRate, 'Sample rate');
  if (!samples || !Number.isFinite(samples.length) || samples.length < rate * 4) throw new Error('Use an audio file at least four seconds long, or enter the BPM manually.');
  // The worker should downsample mono PCM to about 11025 Hz beforehand. The
  // cap also protects callers passing a long original-rate recording.
  const sampleCount = Math.min(samples.length, Math.round(rate * 180), 8_000_000);
  const { envelope, hop, hopSeconds } = onsetEnvelope(samples, rate, sampleCount);
  const peaks = extractPeaks(envelope, hopSeconds, samples, rate, hop);
  const tempoEvents = peaks.length <= 800 ? peaks : peaks.filter((_, index) => index % Math.ceil(peaks.length / 800) === 0);
  const minLag = 60 / 220 / hopSeconds;
  const maxLag = 60 / 40 / hopSeconds;
  const correlation = autocorrelation(envelope, Math.ceil(maxLag) + 1);
  const seeds = [];
  for (let lag = Math.ceil(minLag); lag <= Math.floor(maxLag); lag += 1) {
    if (correlation[lag] >= correlation[lag - 1] && correlation[lag] >= correlation[lag + 1]) {
      const bpm = 60 / (lag * hopSeconds);
      seeds.push({ bpm, score: correlation[lag] * 0.35 + gridFit(tempoEvents, bpm) * 0.65 });
    }
  }
  // Search the interval boundaries, too: 40 and 220 BPM are valid tempos.
  for (const bpm of [40, 220]) seeds.push({ bpm, score: interpolate(correlation, 60 / bpm / hopSeconds) * 0.35 + gridFit(tempoEvents, bpm) * 0.65 });
  seeds.sort((left, right) => right.score - left.score);
  const refinements = [];
  const evaluate = bpm => gridFit(tempoEvents, bpm) * 0.97 + interpolate(correlation, 60 / bpm / hopSeconds) * 0.03;
  for (const seed of seeds.slice(0, 12)) {
    const span = seed.bpm * 0.035;
    let best = { bpm: seed.bpm, score: evaluate(seed.bpm) };
    for (let bpm = Math.max(40, seed.bpm - span); bpm <= Math.min(220, seed.bpm + span); bpm += 0.1) {
      const score = evaluate(bpm);
      if (score > best.score) best = { bpm, score };
    }
    const center = best.bpm;
    for (let bpm = Math.max(40, center - 0.12); bpm <= Math.min(220, center + 0.12); bpm += 0.01) {
      const score = evaluate(bpm);
      if (score > best.score) best = { bpm, score };
    }
    // Autocorrelation identifies a plausible beat interval; event phase then
    // refines it without pulling long-term timing toward a whole hop length.
    best.score = gridFit(tempoEvents, best.bpm) * 0.65 + interpolate(correlation, 60 / best.bpm / hopSeconds) * 0.35;
    refinements.push(best);
  }
  refinements.sort((left, right) => right.score - left.score);
  const candidates = [];
  for (const entry of refinements) {
    if (candidates.every(candidate => Math.abs(Math.log(entry.bpm / candidate.bpm)) > 0.025)) candidates.push({ bpm: Math.round(entry.bpm * 100) / 100, score: clamp(entry.score, 0, 1) });
    if (candidates.length === 5) break;
  }
  if (!candidates.length) throw new Error('A tempo could not be estimated. Enter the BPM manually.');
  const best = candidates[0];
  const fit = gridFit(tempoEvents, best.bpm, true);
  const period = 60 / best.bpm;
  const phaseOffset = ((fit.phase / TWO_PI) * period + period) % period;
  const strong = peaks.filter(event => event.strength >= 0.25);
  const aligned = strong.find(event => {
    const nearest = phaseOffset + Math.round((event.time - phaseOffset) / period) * period;
    return Math.abs(nearest - event.time) < Math.min(0.06, period * 0.15);
  }) ?? strong[0] ?? peaks[0];
  const offset = Math.max(0, phaseOffset + Math.round((aligned.time - phaseOffset) / period) * period);
  const octave = candidates.find(candidate => candidate !== best && (Math.abs(candidate.bpm / best.bpm - 2) < 0.055 || Math.abs(candidate.bpm / best.bpm - 0.5) < 0.025) && candidate.score > best.score * 0.7);
  const runner = candidates[1];
  const nearTie = !!runner && runner.score > best.score * 0.92;
  const ambiguous = !!octave || nearTie;
  const evidence = clamp((peaks.length - 3) / 20, 0.15, 1);
  let confidence = clamp(best.score * 1.05 * evidence, 0, 0.96);
  if (ambiguous) confidence *= 0.8;
  if (fit.global < 0.3) confidence = Math.min(confidence, 0.45);
  const warnings = [];
  if (octave) warnings.push('The tempo may be half or double the estimate. Compare the candidate BPM values by ear.');
  if (nearTie) warnings.push('Several tempos fit similarly. Confirm the BPM with the metronome.');
  if (confidence < 0.55) warnings.push('Rhythm detection has low confidence. Confirm the BPM and first bar manually.');
  warnings.push('The first beat is an onset estimate, not a verified downbeat. Align the first bar by ear.');
  return { bpm: best.bpm, offset, confidence, candidates, peaks: peaks.map(event => ({ time: event.time, strength: event.strength })), ambiguous, octaveAmbiguous: !!octave, warnings, analysisDuration: sampleCount / rate, resolution: hopSeconds };
}
