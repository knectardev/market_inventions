const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const startButton = document.getElementById("start");
const instrumentQqqSelect = document.getElementById("instrument-qqq");
const instrumentSpySelect = document.getElementById("instrument-spy");
const toggleQqq = document.getElementById("toggle-qqq");
const toggleSpy = document.getElementById("toggle-spy");
const sopranoEl = document.getElementById("soprano");
const bassEl = document.getElementById("bass");
const regimeEl = document.getElementById("regime");
const chordEl = document.getElementById("chord");
const rootOffsetEl = document.getElementById("root-offset");
const tickEl = document.getElementById("tick");
const rvolEl = document.getElementById("rvol");
const qqqPriceEl = document.getElementById("qqq-price");
const spyPriceEl = document.getElementById("spy-price");

let socket = null;
let sopranoSampler = null;
let bassSampler = null;
let isPlaying = false;
let loadCounter = 0;

const regimeClassMap = {
  MAJOR: "regime-major",
  MINOR: "regime-minor",
  WHOLE_TONE: "regime-whole-tone",
  DIMINISHED: "regime-diminished",
};

const regimeBackgroundMap = {
  MAJOR: "regime-bg-major",
  MINOR: "regime-bg-minor",
  WHOLE_TONE: "regime-bg-whole-tone",
  DIMINISHED: "regime-bg-diminished",
};

const instrumentMap = {
  harpsichord: {
    label: "Harpsichord",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/harpsichord-mp3/",
  },
  pipe_organ: {
    label: "Pipe Organ",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/church_organ-mp3/",
  },
  strings: {
    label: "Strings",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/string_ensemble_1-mp3/",
  },
  electric_organ: {
    label: "Electric Organ",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/drawbar_organ-mp3/",
  },
  flute: {
    label: "Flute",
    baseUrl:
      "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/flute-mp3/",
  },
};

const canvas = document.getElementById("piano-roll");
const canvasCtx = canvas.getContext("2d");
const noteEvents = [];
const priceAnchors = {
  soprano: [],
  bass: [],
};
const noteConfig = {
  minMidi: 36,
  maxMidi: 84,
  pixelsPerSecond: 90,
  sopranoColor: "#7cffc2",
  bassColor: "#7aa7ff",
};
const playheadFraction = 0.5;
const playheadColors = {
  normal: "rgba(0, 255, 153, 0.6)",
  alert: "rgba(255, 68, 68, 0.85)",
};
const canvasBackground = {
  normal: "rgba(8, 9, 12, 0.7)",
  alert: "rgba(6, 6, 8, 0.85)",
};
let divergenceActive = false;

const scaleY = (value, min, max, top, bottom) => {
  if (max - min < 0.001) {
    return (top + bottom) / 2;
  }
  const ratio = (value - min) / (max - min);
  return bottom - ratio * (bottom - top);
};

const logLine = (message) => {
  const line = document.createElement("div");
  line.textContent = message;
  logEl.prepend(line);
};

const updateStatus = (message) => {
  statusEl.textContent = message;
};

const setButtonState = (label, disabled) => {
  startButton.textContent = label;
  startButton.disabled = disabled;
};

const resizeCanvas = () => {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  canvasCtx.setTransform(scale, 0, 0, scale, 0, 0);
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const addNoteEvent = (midi, voice, price, tick, offset) => {
  noteEvents.push({
    midi,
    voice,
    price,
    tick,
    offset,
    time: performance.now(),
  });
  if (noteEvents.length > 400) {
    noteEvents.splice(0, noteEvents.length - 400);
  }
};

const addAnchor = (voice, price, tick) => {
  priceAnchors[voice].push({
    price,
    tick,
    time: performance.now(),
  });
  if (priceAnchors[voice].length > 120) {
    priceAnchors[voice].splice(0, priceAnchors[voice].length - 120);
  }
};

const filterRecent = (events, now, maxMs = 15000) =>
  events.filter((event) => now - event.time <= maxMs);

const drawPriceLine = (events, min, max, top, bottom, color) => {
  if (events.length < 2) {
    return;
  }
  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = 2;
  canvasCtx.beginPath();
  events.forEach((event, index) => {
    const secondsFromNow = (event.time - performance.now()) / 1000;
    const x = (canvas.clientWidth * playheadFraction) +
      secondsFromNow * noteConfig.pixelsPerSecond;
    const y = scaleY(event.price, min, max, top, bottom);
    if (index === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
  });
  canvasCtx.stroke();
};
const drawVisualizer = () => {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvasCtx.clearRect(0, 0, width, height);
  canvasCtx.fillStyle = divergenceActive
    ? canvasBackground.alert
    : canvasBackground.normal;
  canvasCtx.fillRect(0, 0, width, height);

  const now = performance.now();
  const playheadX = width * playheadFraction;
  const visibleEvents = filterRecent(noteEvents, now);
  const qqqEvents = visibleEvents.filter((event) => event.voice === "soprano");
  const spyEvents = visibleEvents.filter((event) => event.voice === "bass");
  const qqqAnchors = filterRecent(priceAnchors.soprano, now);
  const spyAnchors = filterRecent(priceAnchors.bass, now);

  const qqqPrices = qqqAnchors.map((event) => event.price);
  const spyPrices = spyAnchors.map((event) => event.price);
  const qqqMin = qqqPrices.length ? Math.min(...qqqPrices) : 420;
  const qqqMax = qqqPrices.length ? Math.max(...qqqPrices) : 440;
  const spyMin = spyPrices.length ? Math.min(...spyPrices) : 500;
  const spyMax = spyPrices.length ? Math.max(...spyPrices) : 520;

  const lanePadding = 16;
  const mid = height / 2;
  const qqqTop = lanePadding;
  const qqqBottom = mid - lanePadding;
  const spyTop = mid + lanePadding;
  const spyBottom = height - lanePadding;

  drawPriceLine(
    qqqAnchors,
    qqqMin,
    qqqMax,
    qqqTop,
    qqqBottom,
    "rgba(124, 255, 194, 0.35)"
  );
  drawPriceLine(
    spyAnchors,
    spyMin,
    spyMax,
    spyTop,
    spyBottom,
    "rgba(122, 167, 255, 0.35)"
  );

  for (const event of visibleEvents) {
    const secondsFromNow = (event.time - now) / 1000;
    const x = playheadX + secondsFromNow * noteConfig.pixelsPerSecond;
    if (x < -20 || x > width + 20) {
      continue;
    }
    const midi = clamp(event.midi, noteConfig.minMidi, noteConfig.maxMidi);
    const y =
      event.voice === "soprano"
        ? scaleY(event.price ?? midi, qqqMin, qqqMax, qqqTop, qqqBottom)
        : scaleY(event.price ?? midi, spyMin, spyMax, spyTop, spyBottom);
    const color =
      event.voice === "soprano"
        ? noteConfig.sopranoColor
        : noteConfig.bassColor;
    canvasCtx.fillStyle = color;
    canvasCtx.fillRect(x, y - 3, 8, 6);

    if (event.price) {
      const anchorY =
        event.voice === "soprano"
          ? scaleY(event.price, qqqMin, qqqMax, qqqTop, qqqBottom)
          : scaleY(event.price, spyMin, spyMax, spyTop, spyBottom);
      canvasCtx.strokeStyle = divergenceActive
        ? "rgba(255, 68, 68, 0.4)"
        : "rgba(255, 255, 255, 0.12)";
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, anchorY);
      canvasCtx.lineTo(x, y);
      canvasCtx.stroke();
    }
  }

  canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, mid);
  canvasCtx.lineTo(width, mid);
  canvasCtx.stroke();

  canvasCtx.fillStyle = "rgba(255, 255, 255, 0.6)";
  canvasCtx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  canvasCtx.textAlign = "left";
  canvasCtx.fillText(`SPY ${spyMin.toFixed(2)}`, 8, spyBottom - 4);
  canvasCtx.fillText(`SPY ${spyMax.toFixed(2)}`, 8, spyTop + 12);
  canvasCtx.textAlign = "right";
  canvasCtx.fillText(`QQQ ${qqqMin.toFixed(2)}`, width - 8, qqqBottom - 4);
  canvasCtx.fillText(`QQQ ${qqqMax.toFixed(2)}`, width - 8, qqqTop + 12);

  const labelEvents = qqqAnchors.filter(
    (event) => event.tick && event.tick % 4 === 0
  );
  canvasCtx.textAlign = "center";
  for (const event of labelEvents) {
    const secondsFromNow = (event.time - now) / 1000;
    const x = playheadX + secondsFromNow * noteConfig.pixelsPerSecond;
    if (x < 0 || x > width) {
      continue;
    }
    const seconds = Math.floor(event.tick / 4);
    canvasCtx.fillText(`${seconds}s`, x, height - 6);
  }

  canvasCtx.strokeStyle = divergenceActive
    ? playheadColors.alert
    : playheadColors.normal;
  canvasCtx.beginPath();
  canvasCtx.moveTo(playheadX, 0);
  canvasCtx.lineTo(playheadX, height);
  canvasCtx.stroke();

  for (let i = noteEvents.length - 1; i >= 0; i -= 1) {
    if (now - noteEvents[i].time > 15000) {
      noteEvents.splice(0, i + 1);
      break;
    }
  }

  requestAnimationFrame(drawVisualizer);
};

const connectSocket = () => {
  if (socket) {
    socket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

  socket.addEventListener("open", () => {
    updateStatus("Connected");
    logLine("WebSocket connected");
  });

  socket.addEventListener("close", () => {
    updateStatus("Disconnected");
    logLine("WebSocket disconnected");
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    const {
      soprano_midi,
      bass_midi,
      rvol,
      regime,
      divergence,
      chord,
      root_offset,
      tick,
      qqq_price,
      spy_price,
      qqq_note_offset,
      spy_note_offset,
    } = data;

    const regimeKey = String(regime || "").toUpperCase();

    sopranoEl.textContent = soprano_midi;
    bassEl.textContent = bass_midi;
    regimeEl.textContent = regimeKey || "--";
    chordEl.textContent = chord ?? "--";
    rootOffsetEl.textContent = root_offset ?? "--";
    tickEl.textContent = tick ?? "--";
    rvolEl.textContent = rvol;
    qqqPriceEl.textContent = qqq_price ? `$${qqq_price}` : "--";
    spyPriceEl.textContent = spy_price ? `$${spy_price}` : "--";

    regimeEl.classList.remove(...Object.values(regimeClassMap));
    if (regimeClassMap[regimeKey]) {
      regimeEl.classList.add(regimeClassMap[regimeKey]);
    }

    document.body.classList.remove(...Object.values(regimeBackgroundMap));
    if (regimeBackgroundMap[regimeKey]) {
      document.body.classList.add(regimeBackgroundMap[regimeKey]);
    }

    divergenceActive = Boolean(divergence);

    if (sopranoSampler && bassSampler && isPlaying) {
      const now = Tone.now();
      const detuneTarget = divergence ? -100 : 0;
      if (sopranoSampler.detune) {
        sopranoSampler.detune.rampTo(detuneTarget, 0.1);
      }
      if (bassSampler.detune) {
        bassSampler.detune.rampTo(detuneTarget, 0.1);
      }
      if (!toggleQqq.checked) {
        sopranoSampler.volume.mute = true;
      } else {
        sopranoSampler.volume.mute = false;
        sopranoSampler.triggerAttackRelease(
          Tone.Frequency(soprano_midi, "midi"),
          "16n",
          now
        );
      }
      if (!toggleSpy.checked) {
        bassSampler.volume.mute = true;
      } else {
        bassSampler.volume.mute = false;
        bassSampler.triggerAttackRelease(
          Tone.Frequency(bass_midi, "midi"),
          "8n",
          now
        );
      }
    }

    if (toggleQqq.checked) {
      addNoteEvent(soprano_midi, "soprano", qqq_price, tick, qqq_note_offset);
    }
    if (toggleSpy.checked) {
      addNoteEvent(bass_midi, "bass", spy_price, tick, spy_note_offset);
    }

    if (tick % 4 === 0) {
      if (qqq_price !== undefined) {
        addAnchor("soprano", qqq_price, tick);
      }
      if (spy_price !== undefined) {
        addAnchor("bass", spy_price, tick);
      }
    }
  });
};

const stopPlayback = () => {
  loadCounter += 1;
  isPlaying = false;
  if (socket) {
    socket.close();
    socket = null;
  }
  if (sopranoSampler) {
    sopranoSampler.releaseAll?.();
    sopranoSampler.dispose();
    sopranoSampler = null;
  }
  if (bassSampler) {
    bassSampler.releaseAll?.();
    bassSampler.dispose();
    bassSampler = null;
  }
  setButtonState("Start Audio", false);
  updateStatus("Disconnected");
};

const loadSampler = async (instrumentKey) => {
  const config = instrumentMap[instrumentKey] || instrumentMap.harpsichord;
  let sampler = null;

  const loadPromise = new Promise((resolve) => {
    sampler = new Tone.Sampler({
      urls: {
        C2: "C2.mp3",
        C3: "C3.mp3",
        C4: "C4.mp3",
        C5: "C5.mp3",
      },
      baseUrl: config.baseUrl,
      release: 1,
      onload: () => resolve(sampler),
    }).toDestination();
  });

  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve("timeout"), 7000)
  );

  const result = await Promise.race([loadPromise, timeoutPromise]);
  if (result === "timeout") {
    if (sampler) {
      sampler.dispose();
    }
    throw new Error(`Sample load timed out for ${config.label}.`);
  }
  return result;
};

const startPlayback = async () => {
  await Tone.start();

  const loadToken = (loadCounter += 1);
  const shouldReconnect = !isPlaying;
  setButtonState("Loading Samples...", true);

  try {
    const [qqqSampler, spySampler] = await Promise.all([
      loadSampler(instrumentQqqSelect.value),
      loadSampler(instrumentSpySelect.value),
    ]);

    if (loadToken !== loadCounter) {
      qqqSampler.dispose();
      spySampler.dispose();
      return;
    }

    if (sopranoSampler) {
      sopranoSampler.dispose();
    }
    if (bassSampler) {
      bassSampler.dispose();
    }

    sopranoSampler = qqqSampler;
    bassSampler = spySampler;
  } catch (error) {
    logLine(error.message);
    updateStatus("Sample load timed out");
    setButtonState("Start Audio", false);
    return;
  }
  isPlaying = true;

  if (shouldReconnect) {
    connectSocket();
  }
  setButtonState("Stop Audio", false);
};

startButton.addEventListener("click", async () => {
  if (isPlaying) {
    stopPlayback();
    return;
  }
  await startPlayback();
});

updateStatus("Disconnected");
resizeCanvas();
window.addEventListener("resize", resizeCanvas);
requestAnimationFrame(drawVisualizer);

instrumentQqqSelect.addEventListener("change", () => {
  if (isPlaying) {
    startPlayback();
  }
});

instrumentSpySelect.addEventListener("change", () => {
  if (isPlaying) {
    startPlayback();
  }
});
