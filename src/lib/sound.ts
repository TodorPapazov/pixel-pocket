let ctx: AudioContext | null = null;
const voiceCache = new Map<string, HTMLAudioElement>();
const captured = new Set<AudioContext>();

function NativeAudioContext(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ||
    null
  );
}

function remember(c: AudioContext | null | undefined) {
  if (!c || typeof c.state !== "string") return;
  captured.add(c);
}

function hookPrototype(Native: typeof AudioContext) {
  const proto = Native.prototype as AudioContext & { __pocketHook?: boolean };
  if (proto.__pocketHook) return;
  const createBufferSource = proto.createBufferSource;
  proto.createBufferSource = function (this: AudioContext, ...args: unknown[]) {
    remember(this);
    return createBufferSource.apply(this, args as []);
  };
  const resume = proto.resume;
  proto.resume = function (this: AudioContext, ...args: unknown[]) {
    remember(this);
    return resume.apply(this, args as []);
  };
  const dest = Object.getOwnPropertyDescriptor(proto, "destination");
  if (dest?.get) {
    Object.defineProperty(proto, "destination", {
      configurable: true,
      enumerable: dest.enumerable,
      get: function (this: AudioContext) {
        remember(this);
        return dest.get!.call(this);
      },
    });
  }
  proto.__pocketHook = true;
}

/** RetroArch rwebaudio keeps AudioContext in a closure — capture every instance. */
export function patchAudioCapture() {
  if (typeof window === "undefined") return;
  const Native = NativeAudioContext();
  if (!Native) return;
  hookPrototype(Native);
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
    __pocketAudioPatched?: boolean;
  };
  if (w.__pocketAudioPatched) return;
  const Wrapped = function (this: AudioContext, opts?: AudioContextOptions) {
    const created = new Native(opts);
    remember(created);
    return created;
  } as unknown as typeof AudioContext;
  Wrapped.prototype = Native.prototype;
  Object.setPrototypeOf(Wrapped, Native);
  try {
    w.AudioContext = Wrapped;
    if (w.webkitAudioContext) w.webkitAudioContext = Wrapped;
    w.__pocketAudioPatched = true;
  } catch {
    w.__pocketAudioPatched = true;
  }
  (window as unknown as { __pocketAudio?: () => AudioSessionSnapshot }).__pocketAudio =
    audioSessionSnapshot;
}

function getCtx(): AudioContext | null {
  patchAudioCapture();
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = NativeAudioContext();
    if (!AC) return null;
    ctx = new AC();
    remember(ctx);
  }
  return ctx;
}

export type AudioSessionSnapshot = {
  driver: "rwebaudio";
  patched: boolean;
  protoHook: boolean;
  count: number;
  suspended: number;
  running: number;
  contexts: {
    i: number;
    state: string;
    sampleRate: number;
    currentTime: number;
    baseLatency: number | null;
  }[];
};

export function audioSessionSnapshot(): AudioSessionSnapshot {
  const Native = NativeAudioContext();
  const list = [...captured].map((c, i) => ({
    i,
    state: c.state,
    sampleRate: c.sampleRate,
    currentTime: Math.round(c.currentTime * 1000) / 1000,
    baseLatency: typeof c.baseLatency === "number" ? c.baseLatency : null,
  }));
  return {
    driver: "rwebaudio",
    patched: Boolean(
      typeof window !== "undefined" &&
        (window as unknown as { __pocketAudioPatched?: boolean }).__pocketAudioPatched,
    ),
    protoHook: Boolean(Native && (Native.prototype as { __pocketHook?: boolean }).__pocketHook),
    count: list.length,
    suspended: list.filter((x) => x.state === "suspended").length,
    running: list.filter((x) => x.state === "running").length,
    contexts: list,
  };
}

export async function resumeAllAudio() {
  patchAudioCapture();
  const c = getCtx();
  remember(c);
  const jobs: Promise<unknown>[] = [];
  for (const x of captured) {
    if (x.state === "suspended" || x.state === "interrupted") {
      jobs.push(x.resume().catch(() => undefined));
    }
  }
  await Promise.all(jobs);
  if (typeof window !== "undefined") {
    (window as unknown as { __pocketAudio?: () => AudioSessionSnapshot }).__pocketAudio =
      audioSessionSnapshot;
  }
}

export async function unlockAudio() {
  patchAudioCapture();
  await resumeAllAudio();
  const c = getCtx();
  if (!c) return;
  const buffer = c.createBuffer(1, 1, 22050);
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.connect(c.destination);
  try {
    src.start(0);
  } catch {
    /* ignore */
  }
}

export function playVoice(src: string) {
  try {
    let audio = voiceCache.get(src);
    if (!audio) {
      audio = new Audio(src);
      audio.preload = "auto";
      voiceCache.set(src, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export function tapHaptic(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

function beep(freq: number, dur = 0.07, gain = 0.045, type: OscillatorType = "square") {
  const c = getCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(c.destination);
  const now = c.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.start(now);
  o.stop(now + dur + 0.02);
}

export function clickBeep() {
  beep(196, 0.05, 0.03);
}

export function bootJingle() {
  const c = getCtx();
  if (!c) return;
  const notes = [262, 330, 392, 523];
  notes.forEach((n, i) => {
    window.setTimeout(() => beep(n, 0.12, 0.05), i * 90);
  });
}
