const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const startButton = document.getElementById("start");
const instrumentQqqSelect = document.getElementById("instrument-qqq");
const instrumentSpySelect = document.getElementById("instrument-spy");
const toggleQqq = document.getElementById("toggle-qqq");
const toggleSpy = document.getElementById("toggle-spy");
const toggleNoteLabels = document.getElementById("toggle-note-labels");
const sensitivitySlider = document.getElementById("sensitivity");
const sensitivityValueEl = document.getElementById("sensitivity-value");
const priceNoiseSlider = document.getElementById("price-noise");
const priceNoiseValueEl = document.getElementById("price-noise-value");
const sopranoRhythmSelect = document.getElementById("soprano-rhythm");
const sopranoEl = document.getElementById("soprano");
const bassEl = document.getElementById("bass");
const regimeEl = document.getElementById("regime");
const chordEl = document.getElementById("chord");
const rootOffsetEl = document.getElementById("root-offset");
const rootOffsetNoteEl = document.getElementById("root-offset-note");
const tickEl = document.getElementById("tick");
const rvolEl = document.getElementById("rvol");
const buildIdEl = document.getElementById("build-id");
const buildRuntimeEl = document.getElementById("build-runtime");
const qqqPriceEl = document.getElementById("qqq-price");
const spyPriceEl = document.getElementById("spy-price");

let socket = null;
let sopranoSampler = null;
let bassSampler = null;
let isPlaying = false;
let loadCounter = 0;
let transportLoop = null;
let transportStarted = false;

const SUB_STEP_COUNT = 16;
const SUB_STEP_SECONDS = 1 / SUB_STEP_COUNT;
const MAX_BUNDLE_QUEUE = 4;
const bundleQueue = [];
const DEBUG_BUNDLE = true;
let lastDebugTick = null;
let lastMessageLog = 0;
let buildAnnounced = false;

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
  minDisplayMidi: 24,
  maxDisplayMidi: 96,
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
  const firstChild = logEl.firstElementChild;
  if (firstChild && firstChild.classList.contains("log-title")) {
    logEl.insertBefore(line, firstChild.nextSibling);
  } else {
    logEl.prepend(line);
  }
};

const updateStatus = (message) => {
  statusEl.textContent = message;
};

const updateSensitivityDisplay = (value) => {
  if (sensitivityValueEl) {
    sensitivityValueEl.textContent = `${Number(value).toFixed(1)}x`;
  }
};

const updatePriceNoiseDisplay = (value) => {
  if (priceNoiseValueEl) {
    priceNoiseValueEl.textContent = `${Number(value).toFixed(1)}x`;
  }
};

const setConfig = async (sensitivityValue, priceNoiseValue, sopranoRhythmValue) => {
  updateSensitivityDisplay(sensitivityValue);
  updatePriceNoiseDisplay(priceNoiseValue);
  try {
    const response = await fetch("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sensitivity: Number(sensitivityValue),
        price_noise: Number(priceNoiseValue),
        soprano_rhythm: Number(sopranoRhythmValue ?? 16),
      }),
    });
    if (!response.ok) {
      logLine(`Config update failed (${response.status})`);
      return;
    }
    const data = await response.json();
    if (data?.sensitivity !== undefined) {
      const rhythmLabel = data.soprano_rhythm === 4 ? "1/4" : data.soprano_rhythm === 8 ? "1/8" : "1/16";
      logLine(
        `Sensitivity: ${Number(data.sensitivity).toFixed(2)}x | Price Noise: ${Number(
          data.price_noise ?? 0
        ).toFixed(2)}x | QQQ Rhythm: ${rhythmLabel}`
      );
    }
  } catch (error) {
    logLine(`Config update error: ${error.message}`);
  }
};

const fetchBuildId = async () => {
  if (!buildIdEl) {
    return;
  }
  try {
    const response = await fetch("/build");
    if (!response.ok) {
      logLine(`Build fetch failed (${response.status})`);
      return;
    }
    const data = await response.json();
    if (data?.build_id) {
      buildIdEl.textContent = data.build_id;
      if (buildRuntimeEl && data?.server_time) {
        buildRuntimeEl.textContent = data.server_time;
      }
      logLine(`Build (http): ${data.build_id}`);
    } else {
      logLine("Build (http): missing build_id");
    }
  } catch (error) {
    logLine(`Build fetch error: ${error.message}`);
  }
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

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const midiToNoteName = (midi) => {
  if (midi === undefined || midi === null || Number.isNaN(midi)) {
    return "--";
  }
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${noteNames[pitchClass]}${octave}`;
};

const formatRootOffset = (rootOffset) => {
  if (rootOffset === undefined || rootOffset === null) {
    return { offset: "--", note: "--" };
  }
  const rootMidi = 60 + Number(rootOffset);
  return { offset: rootOffset, note: midiToNoteName(rootMidi) };
};

const addNoteEvent = (midi, voice, price, tick, offset, eventTime, durationUnits = 1) => {
  noteEvents.push({
    midi,
    voice,
    price,
    tick,
    offset,
    time: eventTime ?? performance.now(),
    durationUnits, // How many 16th-note units this note lasts (1, 2, or 4)
  });
  if (noteEvents.length > 400) {
    noteEvents.splice(0, noteEvents.length - 400);
  }
};

const addAnchor = (voice, price, tick, eventTime) => {
  priceAnchors[voice].push({
    price,
    tick,
    time: eventTime ?? performance.now(),
  });
  if (priceAnchors[voice].length > 120) {
    priceAnchors[voice].splice(0, priceAnchors[voice].length - 120);
  }
};

const filterRecent = (events, now, maxMs = 15000) =>
  events.filter((event) => now - event.time <= maxMs);

const handleLegacyTick = ({
  soprano_midi,
  bass_midi,
  rvol,
  regime,
  divergence,
  chord,
  build_id,
  root_offset,
  tick,
  qqq_price,
  spy_price,
  qqq_note_offset,
  spy_note_offset,
}) => {
  const regimeKey = String(regime || "").toUpperCase();
  if (!buildAnnounced) {
    buildAnnounced = true;
    if (build_id) {
      logLine(`Build: ${build_id}`);
      updateStatus(`Connected (${build_id})`);
    } else {
      logLine("Build: missing (legacy payload)");
      updateStatus("Connected (build id missing)");
    }
  }

  sopranoEl.textContent = soprano_midi;
  bassEl.textContent = bass_midi;
  regimeEl.textContent = regimeKey || "--";
  chordEl.textContent = chord ?? "--";
  const rootDisplay = formatRootOffset(root_offset);
  rootOffsetEl.textContent = rootDisplay.offset;
  rootOffsetNoteEl.textContent = rootDisplay.note;
  tickEl.textContent = tick ?? "--";
  rvolEl.textContent = rvol;
  if (buildIdEl) {
    buildIdEl.textContent = build_id ?? "--";
  }
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

  if (tick % SUB_STEP_COUNT === 0) {
    if (qqq_price !== undefined) {
      addAnchor("soprano", qqq_price, tick);
    }
    if (spy_price !== undefined) {
      addAnchor("bass", spy_price, tick);
    }
  }
};

const addVisualBundle = (bundle, baseEventTimeMs) => {
  const baseTime = baseEventTimeMs ?? performance.now();
  let prevSopranoMidi = null;
  let prevBassMidi = null;
  
  // Get rhythm setting to determine note duration
  const sopranoRhythm = Number(sopranoRhythmSelect?.value ?? 16);
  const sopranoDurationUnits = 16 / sopranoRhythm; // 4 for quarter, 2 for eighth, 1 for sixteenth
  const bassDurationUnits = 4; // Bass always plays quarter notes
  
  for (let i = 0; i < bundle.soprano_bundle.length; i += 1) {
    const offsetSeconds = i * SUB_STEP_SECONDS;
    const eventTime = baseTime + offsetSeconds * 1000;
    const tick = (bundle.start_tick ?? 0) + i;

    const sopranoMidi = bundle.soprano_bundle[i];
    // Only add visual note when the pitch changes (matching audio behavior)
    if (sopranoMidi !== null && sopranoMidi !== undefined && sopranoMidi !== prevSopranoMidi) {
      const sopranoPrice = bundle.qqq_note_prices[i];
      addNoteEvent(
        sopranoMidi,
        "soprano",
        sopranoPrice,
        tick,
        0,
        eventTime,
        sopranoDurationUnits
      );
      prevSopranoMidi = sopranoMidi;
    }

    if (Array.isArray(bundle.bass_bundle)) {
      const bassMidi = bundle.bass_bundle[i];
      // Only add visual note when the pitch changes (matching audio behavior)
      if (bassMidi !== null && bassMidi !== undefined && bassMidi !== prevBassMidi) {
        const bassPrice = bundle.spy_note_prices[i];
        addNoteEvent(
          bassMidi,
          "bass",
          bassPrice,
          tick,
          0,
          eventTime,
          bassDurationUnits
        );
        prevBassMidi = bassMidi;
      }
    }

    if (tick % SUB_STEP_COUNT === 0) {
      if (bundle.qqq_prices[i] !== undefined) {
        addAnchor("soprano", bundle.qqq_prices[i], tick, eventTime);
      }
      if (bundle.spy_prices[i] !== undefined) {
        addAnchor("bass", bundle.spy_prices[i], tick, eventTime);
      }
    }
  }
};

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
  const visibleMidis = visibleEvents
    .map((event) => event.midi)
    .filter((value) => value !== null && value !== undefined);
  const rawMinMidi = visibleMidis.length
    ? Math.min(...visibleMidis)
    : noteConfig.minMidi;
  const rawMaxMidi = visibleMidis.length
    ? Math.max(...visibleMidis)
    : noteConfig.maxMidi;
  const midiPadding = 3;
  const noteMin = clamp(
    rawMinMidi - midiPadding,
    noteConfig.minDisplayMidi,
    noteConfig.maxDisplayMidi
  );
  const noteMax = clamp(
    rawMaxMidi + midiPadding,
    noteConfig.minDisplayMidi,
    noteConfig.maxDisplayMidi
  );
  const qqqAnchors = filterRecent(priceAnchors.soprano, now);
  const spyAnchors = filterRecent(priceAnchors.bass, now);

  const qqqPrices = [
    ...qqqAnchors.map((event) => event.price),
    ...qqqEvents.map((event) => event.price).filter((price) => price !== undefined),
  ];
  const spyPrices = [
    ...spyAnchors.map((event) => event.price),
    ...spyEvents.map((event) => event.price).filter((price) => price !== undefined),
  ];
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
    // Draw notes at PRICE position so they track the price line visually
    // The grey connectors are no longer needed since notes follow price directly
    const y = event.price
      ? (event.voice === "soprano"
          ? scaleY(event.price, qqqMin, qqqMax, qqqTop, qqqBottom)
          : scaleY(event.price, spyMin, spyMax, spyTop, spyBottom))
      : (event.voice === "soprano"
          ? scaleY(clamp(event.midi, noteMin, noteMax), noteMin, noteMax, qqqTop, qqqBottom)
          : scaleY(clamp(event.midi, noteMin, noteMax), noteMin, noteMax, spyTop, spyBottom));
    
    const color =
      event.voice === "soprano"
        ? noteConfig.sopranoColor
        : noteConfig.bassColor;
    canvasCtx.fillStyle = color;
    
    // Calculate width based on note duration (1, 2, or 4 units)
    // One 16th note unit = pixelsPerSecond / 16
    const durationUnits = event.durationUnits ?? 1;
    const noteWidth = (noteConfig.pixelsPerSecond / 16) * durationUnits;
    canvasCtx.fillRect(x, y - 3, noteWidth, 6);

    if (toggleNoteLabels?.checked) {
      canvasCtx.fillStyle =
        event.voice === "soprano"
          ? "rgba(124, 255, 194, 0.8)"
          : "rgba(122, 167, 255, 0.8)";
      canvasCtx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      canvasCtx.textAlign = "center";
      canvasCtx.textBaseline = "top";
      canvasCtx.fillText(midiToNoteName(event.midi), x + noteWidth / 2, y + 6);
    }
    // Connector lines removed - notes now directly track price position
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
    (event) => event.tick && event.tick % 16 === 0
  );
  canvasCtx.textAlign = "center";
  for (const event of labelEvents) {
    const secondsFromNow = (event.time - now) / 1000;
    const x = playheadX + secondsFromNow * noteConfig.pixelsPerSecond;
    if (x < 0 || x > width) {
      continue;
    }
    const seconds = Math.floor(event.tick / 16);
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
      soprano_bundle,
      bass_bundle,
      qqq_prices,
      spy_prices,
      qqq_note_prices,
      spy_note_prices,
      rvol,
      regime,
      divergence,
      chord,
      build_id,
      root_offset,
      tick,
      qqq_price,
      spy_price,
      qqq_note_offset,
      spy_note_offset,
      start_tick,
    } = data;

    const now = Date.now();
    if (DEBUG_BUNDLE && now - lastMessageLog > 1000) {
      lastMessageLog = now;
      const keys = Object.keys(data || {}).slice(0, 12).join(", ");
      logLine(`Message keys: ${keys}`);
    }

    if (
      Array.isArray(soprano_bundle) &&
      Array.isArray(qqq_prices) &&
      soprano_bundle.length === qqq_prices.length
    ) {
      const regimeKey = String(regime || "").toUpperCase();
      if (!buildAnnounced) {
        buildAnnounced = true;
        if (build_id) {
          logLine(`Build: ${build_id}`);
          updateStatus(`Connected (${build_id})`);
        } else {
          logLine("Build: missing (bundle payload)");
          updateStatus("Connected (build id missing)");
        }
      }
      const lastIndex = soprano_bundle.length - 1;
      const lastSoprano =
        lastIndex >= 0 ? soprano_bundle[lastIndex] : undefined;
      const lastBass =
        Array.isArray(bass_bundle) && lastIndex >= 0
          ? bass_bundle[lastIndex]
          : undefined;

      sopranoEl.textContent = lastSoprano ?? "--";
      bassEl.textContent = lastBass ?? "--";
      regimeEl.textContent = regimeKey || "--";
      chordEl.textContent = chord ?? "--";
      const rootDisplay = formatRootOffset(root_offset);
      rootOffsetEl.textContent = rootDisplay.offset;
      rootOffsetNoteEl.textContent = rootDisplay.note;
      tickEl.textContent = start_tick ?? "--";
      rvolEl.textContent = rvol;
      if (buildIdEl) {
        buildIdEl.textContent = build_id ?? "--";
      }
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

      const safeSpyPrices =
        Array.isArray(spy_prices) && spy_prices.length === qqq_prices.length
          ? spy_prices
          : new Array(qqq_prices.length).fill(undefined);
      const safeQqqNotePrices =
        Array.isArray(qqq_note_prices) &&
        qqq_note_prices.length === qqq_prices.length
          ? qqq_note_prices
          : qqq_prices;
      const safeSpyNotePrices =
        Array.isArray(spy_note_prices) &&
        spy_note_prices.length === qqq_prices.length
          ? spy_note_prices
          : new Array(qqq_prices.length).fill(undefined);
      addVisualBundle(
        {
          soprano_bundle,
          bass_bundle,
          qqq_prices,
          spy_prices: safeSpyPrices,
          qqq_note_prices: safeQqqNotePrices,
          spy_note_prices: safeSpyNotePrices,
          start_tick,
        },
        performance.now()
      );
      bundleQueue.push({
        soprano_bundle,
        bass_bundle,
        qqq_prices,
        spy_prices: safeSpyPrices,
        qqq_note_prices: safeQqqNotePrices,
        spy_note_prices: safeSpyNotePrices,
        start_tick,
        divergence,
      });
      if (DEBUG_BUNDLE && start_tick !== lastDebugTick) {
        lastDebugTick = start_tick;
        const sopranoPreview = soprano_bundle
          .slice(0, 8)
          .join(", ");
        const notePricePreview = safeQqqNotePrices
          .slice(0, 8)
          .map((value) =>
            value === undefined || value === null ? "--" : value.toFixed(2)
          )
          .join(", ");
        logLine(
          `Bundle ${start_tick ?? "?"}: [${sopranoPreview}] | prices [${notePricePreview}]`
        );
      }
      if (bundleQueue.length > MAX_BUNDLE_QUEUE) {
        bundleQueue.shift();
      }
      return;
    }

    if (soprano_midi !== undefined || bass_midi !== undefined) {
      handleLegacyTick({
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
      });
    } else if (DEBUG_BUNDLE) {
      logLine("Message missing bundle/legacy note fields.");
    }
  });
};

const scheduleBundle = (bundle, time) => {
  if (!sopranoSampler || !bassSampler) {
    return;
  }
  sopranoSampler.volume.mute = !toggleQqq.checked;
  bassSampler.volume.mute = !toggleSpy.checked;
  const detuneTarget = bundle.divergence ? -100 : 0;

  if (sopranoSampler.detune) {
    sopranoSampler.detune.rampTo(detuneTarget, 0.05);
  }
  if (bassSampler.detune) {
    bassSampler.detune.rampTo(detuneTarget, 0.05);
  }

  // Get soprano note duration based on rhythm setting
  const sopranoRhythm = Number(sopranoRhythmSelect?.value ?? 16);
  const sopranoDuration = sopranoRhythm === 4 ? "4n" : sopranoRhythm === 8 ? "8n" : "16n";
  const rhythmInterval = 16 / sopranoRhythm; // 4 for quarter, 2 for eighth, 1 for sixteenth

  let prevSopranoMidi = null;
  let prevBassMidi = null;

  for (let i = 0; i < bundle.soprano_bundle.length; i += 1) {
    const offsetSeconds = i * SUB_STEP_SECONDS;
    const scheduledTime = time + offsetSeconds;

    if (toggleQqq.checked) {
      const sopranoMidi = bundle.soprano_bundle[i];
      // Only trigger note when it changes or at rhythm boundaries
      // This prevents retriggering the same note multiple times
      const shouldTriggerSoprano = 
        sopranoMidi !== null && 
        sopranoMidi !== undefined && 
        sopranoMidi !== prevSopranoMidi;
      
      if (shouldTriggerSoprano) {
        sopranoSampler.triggerAttackRelease(
          Tone.Frequency(sopranoMidi, "midi"),
          sopranoDuration,
          scheduledTime
        );
        prevSopranoMidi = sopranoMidi;
      }
    }

    if (toggleSpy.checked && Array.isArray(bundle.bass_bundle)) {
      const bassMidi = bundle.bass_bundle[i];
      // Bass: only trigger on quarter note boundaries (every 4 ticks)
      // This prevents retriggering held notes
      const shouldTriggerBass = 
        bassMidi !== null && 
        bassMidi !== undefined && 
        bassMidi !== prevBassMidi;
      
      if (shouldTriggerBass) {
        bassSampler.triggerAttackRelease(
          Tone.Frequency(bassMidi, "midi"),
          "4n",
          scheduledTime
        );
        prevBassMidi = bassMidi;
      }
    }
  }
};

const stopPlayback = () => {
  loadCounter += 1;
  isPlaying = false;
  transportStarted = false;
  bundleQueue.length = 0;
  if (transportLoop) {
    transportLoop.stop();
    transportLoop.dispose();
    transportLoop = null;
  }
  Tone.Transport.stop();
  Tone.Transport.cancel();
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
  if (!transportLoop) {
    Tone.Transport.bpm.value = 60;
    transportLoop = new Tone.Loop((time) => {
      const bundle = bundleQueue.shift();
      if (!bundle) {
        return;
      }
      scheduleBundle(bundle, time);
    }, 1).start(0);
  }
  if (!transportStarted) {
    Tone.Transport.start();
    transportStarted = true;
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
if (sensitivitySlider) {
  updateSensitivityDisplay(sensitivitySlider.value);
  sensitivitySlider.addEventListener("input", (event) => {
    updateSensitivityDisplay(event.target.value);
  });
  sensitivitySlider.addEventListener("change", (event) => {
    setConfig(event.target.value, priceNoiseSlider?.value ?? 1.0, sopranoRhythmSelect?.value ?? 16);
  });
  sensitivitySlider.addEventListener("input", (event) => {
    setConfig(event.target.value, priceNoiseSlider?.value ?? 1.0, sopranoRhythmSelect?.value ?? 16);
  });
  setConfig(sensitivitySlider.value, priceNoiseSlider?.value ?? 1.0, sopranoRhythmSelect?.value ?? 16);
}
if (priceNoiseSlider) {
  updatePriceNoiseDisplay(priceNoiseSlider.value);
  priceNoiseSlider.addEventListener("input", (event) => {
    updatePriceNoiseDisplay(event.target.value);
  });
  priceNoiseSlider.addEventListener("change", (event) => {
    setConfig(sensitivitySlider?.value ?? 1.0, event.target.value, sopranoRhythmSelect?.value ?? 16);
  });
  priceNoiseSlider.addEventListener("input", (event) => {
    setConfig(sensitivitySlider?.value ?? 1.0, event.target.value, sopranoRhythmSelect?.value ?? 16);
  });
}
if (sopranoRhythmSelect) {
  sopranoRhythmSelect.addEventListener("change", (event) => {
    setConfig(sensitivitySlider?.value ?? 1.0, priceNoiseSlider?.value ?? 1.0, event.target.value);
  });
}
fetchBuildId();
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
