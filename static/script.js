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

// Separate WebSockets for architectural decoupling
let priceSocket = null;  // Always connected - streams price data only
let musicSocket = null;  // Connected only when audio is playing
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
  const startTime = eventTime ?? performance.now();
  // Calculate end time based on duration (durationUnits * 62.5ms per 16th note at base tempo)
  const durationMs = durationUnits * SUB_STEP_SECONDS * 1000;
  const endTime = startTime + durationMs;
  
  noteEvents.push({
    midi,
    voice,
    price,
    tick,
    offset,
    time: startTime,
    endTime, // When this note stops playing
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
  let sopranoStartIndex = -1;
  let bassStartIndex = -1;
  
  for (let i = 0; i < bundle.soprano_bundle.length; i += 1) {
    const offsetSeconds = i * SUB_STEP_SECONDS;
    const eventTime = baseTime + offsetSeconds * 1000;
    const tick = (bundle.start_tick ?? 0) + i;

    const sopranoMidi = bundle.soprano_bundle[i];
    // When soprano note changes, calculate duration until next change
    if (sopranoMidi !== null && sopranoMidi !== undefined && sopranoMidi !== prevSopranoMidi) {
      // If there was a previous note, we now know its actual duration
      if (prevSopranoMidi !== null && sopranoStartIndex >= 0) {
        const duration = i - sopranoStartIndex;
        // Update the last added soprano note with correct duration
        const lastSopranoNote = noteEvents.filter(e => e.voice === "soprano").pop();
        if (lastSopranoNote) {
          lastSopranoNote.durationUnits = duration;
        }
      }
      
      const sopranoPrice = bundle.qqq_note_prices[i];
      addNoteEvent(
        sopranoMidi,
        "soprano",
        sopranoPrice,
        tick,
        0,
        eventTime,
        1  // Start with 1 unit, will be updated when note changes
      );
      prevSopranoMidi = sopranoMidi;
      sopranoStartIndex = i;
    }

    if (Array.isArray(bundle.bass_bundle)) {
      const bassMidi = bundle.bass_bundle[i];
      // When bass note changes, calculate duration until next change
      if (bassMidi !== null && bassMidi !== undefined && bassMidi !== prevBassMidi) {
        // If there was a previous note, we now know its actual duration
        if (prevBassMidi !== null && bassStartIndex >= 0) {
          const duration = i - bassStartIndex;
          // Update the last added bass note with correct duration
          const lastBassNote = noteEvents.filter(e => e.voice === "bass").pop();
          if (lastBassNote) {
            lastBassNote.durationUnits = duration;
          }
        }
        
        const bassPrice = bundle.spy_note_prices[i];
        addNoteEvent(
          bassMidi,
          "bass",
          bassPrice,
          tick,
          0,
          eventTime,
          1  // Start with 1 unit, will be updated when note changes
        );
        prevBassMidi = bassMidi;
        bassStartIndex = i;
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
  
  // Handle the last notes in the bundle - extend to end of bundle
  if (sopranoStartIndex >= 0) {
    const duration = bundle.soprano_bundle.length - sopranoStartIndex;
    const lastSopranoNote = noteEvents.filter(e => e.voice === "soprano").pop();
    if (lastSopranoNote) {
      lastSopranoNote.durationUnits = duration;
    }
  }
  if (bassStartIndex >= 0) {
    const duration = bundle.bass_bundle.length - bassStartIndex;
    const lastBassNote = noteEvents.filter(e => e.voice === "bass").pop();
    if (lastBassNote) {
      lastBassNote.durationUnits = duration;
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
  const bottomAxisReserve = 56; // Reserve space for X-axis time labels and bottom border
  const mid = height / 2;
  const qqqTop = lanePadding;
  const qqqBottom = mid - lanePadding;
  const spyTop = mid + lanePadding;
  const spyBottom = height - bottomAxisReserve;

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
    
    // Only show notes that are within 0.25 seconds of playing (just-in-time display)
    // This creates a smooth appearance as notes emerge right before playing
    if (secondsFromNow > 0.25) {
      continue;
    }
    
    const x = playheadX + secondsFromNow * noteConfig.pixelsPerSecond;
    if (x < -20 || x > width + 20) {
      continue;
    }
    
    // CRITICAL: Notes MUST be positioned by MIDI pitch for musical consistency
    // Same pitch = same vertical position (fundamental music notation principle)
    // Each voice (soprano/bass) has its own lane
    const y = event.voice === "soprano"
      ? scaleY(clamp(event.midi, noteMin, noteMax), noteMin, noteMax, qqqTop, qqqBottom)
      : scaleY(clamp(event.midi, noteMin, noteMax), noteMin, noteMax, spyTop, spyBottom);
    
    // Check if note is currently playing (for highlight effect)
    const isPlaying = event.endTime && now >= event.time && now <= event.endTime;
    
    const baseColor =
      event.voice === "soprano"
        ? noteConfig.sopranoColor
        : noteConfig.bassColor;
    
    // Highlight playing notes with brighter color and glow
    if (isPlaying) {
      canvasCtx.fillStyle = event.voice === "soprano"
        ? "rgba(124, 255, 194, 1.0)" // Full opacity green
        : "rgba(122, 167, 255, 1.0)"; // Full opacity blue
      
      // Add glow effect
      canvasCtx.shadowColor = event.voice === "soprano"
        ? "rgba(231, 10, 10, 0.8)"
        : "rgba(255, 0, 0, 0.8)";
      canvasCtx.shadowBlur = 12;
    } else {
      canvasCtx.fillStyle = baseColor;
      canvasCtx.shadowBlur = 0;
    }
    
    // Calculate width based on note duration (1, 2, or 4 units)
    // One 16th note unit = pixelsPerSecond / 16
    const durationUnits = event.durationUnits ?? 1;
    const noteWidth = (noteConfig.pixelsPerSecond / 16) * durationUnits;
    
    // Draw note with larger height if playing
    const noteHeight = isPlaying ? 8 : 6;
    const noteYOffset = isPlaying ? 4 : 3;
    canvasCtx.fillRect(x, y - noteYOffset, noteWidth, noteHeight);
    
    // Reset shadow
    canvasCtx.shadowBlur = 0;

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
  }

  canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, mid);
  canvasCtx.lineTo(width, mid);
  canvasCtx.stroke();

  // Y-axis price labels - Color-coded with graduated increments
  canvasCtx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  
  // Helper to round to "nice" increment values
  const getNiceIncrement = (rawIncrement) => {
    // Nice values: 0.01, 0.02, 0.025, 0.05, 0.10, 0.20, 0.25, 0.50, 1.0, 2.0, 2.5, 5.0, 10.0, etc.
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawIncrement)));
    const normalized = rawIncrement / magnitude;
    
    let nice;
    if (normalized < 1.5) {
      nice = 1;
    } else if (normalized < 2.25) {
      nice = 2;
    } else if (normalized < 3.5) {
      nice = 2.5;
    } else if (normalized < 7.5) {
      nice = 5;
    } else {
      nice = 10;
    }
    
    return nice * magnitude;
  };
  
  // Helper function to draw graduated price labels with constant pixel spacing
  const drawPriceLabels = (min, max, top, bottom, color, side, ticker) => {
    canvasCtx.fillStyle = color;
    canvasCtx.textAlign = side;
    
    // Calculate available vertical space and target spacing
    const verticalHeight = Math.abs(bottom - top);
    const targetSpacing = 40; // Target 40px between labels
    const maxLabels = Math.floor(verticalHeight / targetSpacing);
    
    // If range is too small, just show min and max prices
    if (maxLabels < 2) {
      const xPos = side === "left" ? 8 : width - 8;
      canvasCtx.fillText(min.toFixed(2), xPos, bottom - 4);
      canvasCtx.fillText(max.toFixed(2), xPos, top + 12);
      return;
    }
    
    // Calculate raw increment and round to nice value
    const range = max - min;
    const rawIncrement = range / (maxLabels - 1);
    const increment = getNiceIncrement(rawIncrement);
    
    // Round min/max to nearest increment for clean labels
    const startPrice = Math.floor(min / increment) * increment;
    const endPrice = Math.ceil(max / increment) * increment;
    
    // Draw price labels at each increment (no ticker on individual labels)
    for (let price = startPrice; price <= endPrice; price += increment) {
      if (price < min - increment * 0.1 || price > max + increment * 0.1) continue;
      
      const y = scaleY(price, min, max, top, bottom);
      const xPos = side === "left" ? 8 : width - 8;
      
      canvasCtx.fillText(price.toFixed(2), xPos, y + 4);
    }
    
    // Draw fixed ticker label at top of range (above all price labels)
    canvasCtx.font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const tickerXPos = side === "left" ? 8 : width - 8;
    canvasCtx.fillText(ticker, tickerXPos, top - 6);
    canvasCtx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  };
  
  // Helper function to draw current price highlight with dotted line
  const drawCurrentPriceHighlight = (currentPrice, min, max, top, bottom, color, side, ticker) => {
    if (!currentPrice || currentPrice < min || currentPrice > max) return;
    
    const y = scaleY(currentPrice, min, max, top, bottom);
    const labelWidth = 60;
    const labelHeight = 18;
    const padding = 4;
    
    // Clamp label Y position to stay within visible bounds
    const labelY = Math.max(top + labelHeight / 2, Math.min(bottom - labelHeight / 2, y));
    
    // Draw dotted horizontal line from edge to playhead (at actual price level)
    const lineStart = side === "left" ? labelWidth + 8 : width - labelWidth - 8;
    const lineEnd = playheadX;
    
    canvasCtx.strokeStyle = color;
    canvasCtx.setLineDash([4, 4]);
    canvasCtx.lineWidth = 1;
    canvasCtx.beginPath();
    canvasCtx.moveTo(lineStart, y); // Line at actual price
    canvasCtx.lineTo(lineEnd, y);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]);
    
    // Draw background box for current price label (clamped position)
    const boxX = side === "left" ? 8 : width - labelWidth - 8;
    canvasCtx.fillStyle = color;
    canvasCtx.fillRect(boxX, labelY - labelHeight / 2, labelWidth, labelHeight);
    
    // Draw price text in dark color on colored background
    canvasCtx.fillStyle = "#0a0b0d";
    canvasCtx.font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    canvasCtx.textAlign = "center";
    canvasCtx.fillText(currentPrice.toFixed(2), boxX + labelWidth / 2, labelY + 4);
    canvasCtx.textAlign = side;
  };
  
  // SPY labels (right side) - Blue to match SPY line
  drawPriceLabels(spyMin, spyMax, spyTop, spyBottom, noteConfig.bassColor, "right", "SPY");
  
  // QQQ labels (right side) - Green/Cyan to match QQQ line
  drawPriceLabels(qqqMin, qqqMax, qqqTop, qqqBottom, noteConfig.sopranoColor, "right", "QQQ");
  
  // Draw current price highlights (needs access to current prices from data)
  // Extract current prices from most recent anchor or event
  const latestQqqAnchor = qqqAnchors[qqqAnchors.length - 1];
  const latestSpyAnchor = spyAnchors[spyAnchors.length - 1];
  
  if (latestQqqAnchor) {
    drawCurrentPriceHighlight(latestQqqAnchor.price, qqqMin, qqqMax, qqqTop, qqqBottom, noteConfig.sopranoColor, "right", "QQQ");
  }
  
  if (latestSpyAnchor) {
    drawCurrentPriceHighlight(latestSpyAnchor.price, spyMin, spyMax, spyTop, spyBottom, noteConfig.bassColor, "right", "SPY");
  }

  // X-axis time labels - Real clock time with playhead at current time
  // DECOUPLED from data/anchors - purely time-based
  canvasCtx.textAlign = "center";
  canvasCtx.textBaseline = "bottom"; // Align text above the Y position
  canvasCtx.fillStyle = "rgba(255, 255, 255, 0.7)";
  canvasCtx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  
  const visibleTimeRange = width / noteConfig.pixelsPerSecond; // seconds visible on screen
  const labelIntervalSeconds = 1; // Label every 1 second
  
  // Current time at playhead
  const currentTime = new Date();
  
  // Draw labels from past (left) to future (right) relative to playhead
  const startSeconds = Math.floor(-playheadX / noteConfig.pixelsPerSecond);
  const endSeconds = Math.ceil(visibleTimeRange + Math.abs(startSeconds));
  
  const xAxisY = height - 18; // Position with padding below the labels
  
  for (let sec = startSeconds; sec <= endSeconds; sec += labelIntervalSeconds) {
    const x = playheadX + (sec * noteConfig.pixelsPerSecond);
    if (x < 0 || x > width) {
      continue;
    }
    
    // Calculate time offset from current time
    const timeAtPosition = new Date(currentTime.getTime() + (sec * 1000));
    
    // Format as HH:MM:SS
    const hours = String(timeAtPosition.getHours()).padStart(2, '0');
    const minutes = String(timeAtPosition.getMinutes()).padStart(2, '0');
    const seconds = String(timeAtPosition.getSeconds()).padStart(2, '0');
    const timeLabel = `${hours}:${minutes}:${seconds}`;
    
    // Highlight current time at playhead
    if (sec === 0) {
      canvasCtx.fillStyle = "rgba(0, 255, 153, 0.9)";
      canvasCtx.font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      canvasCtx.fillText(timeLabel, x, xAxisY);
      canvasCtx.fillStyle = "rgba(255, 255, 255, 0.7)";
      canvasCtx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    } else {
      canvasCtx.fillText(timeLabel, x, xAxisY);
    }
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

const connectPriceSocket = () => {
  if (priceSocket) {
    priceSocket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  priceSocket = new WebSocket(`${protocol}://${window.location.host}/ws/prices`);

  priceSocket.addEventListener("open", () => {
    updateStatus("Price Stream Active");
    logLine("📊 Price stream connected");
  });

  priceSocket.addEventListener("close", () => {
    logLine("📊 Price stream disconnected - reconnecting...");
    // Auto-reconnect price stream
    setTimeout(connectPriceSocket, 2000);
  });

  priceSocket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    const { qqq_prices, spy_prices, qqq_current, spy_current } = data;

    // Update price displays
    if (qqq_current) qqqPriceEl.textContent = `$${qqq_current}`;
    if (spy_current) spyPriceEl.textContent = `$${spy_current}`;

    // Add price anchors for visualization ONLY when music is NOT playing
    // When music IS playing, musicSocket handles ALL visualization through addVisualBundle
    if (!isPlaying && Array.isArray(qqq_prices) && qqq_prices.length > 0) {
      const now = performance.now();
      for (let i = 0; i < qqq_prices.length; i++) {
        if (i % SUB_STEP_COUNT === 0) {
          const offsetSeconds = i * SUB_STEP_SECONDS;
          const eventTime = now + offsetSeconds * 1000;
          const fakeTick = Math.floor(now / (SUB_STEP_SECONDS * 1000)) + i;
          
          if (qqq_prices[i]) addAnchor("soprano", qqq_prices[i], fakeTick, eventTime);
          if (spy_prices && spy_prices[i]) addAnchor("bass", spy_prices[i], fakeTick, eventTime);
        }
      }
    }
  });
};

const connectMusicSocket = () => {
  if (musicSocket) {
    musicSocket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  musicSocket = new WebSocket(`${protocol}://${window.location.host}/ws/music`);

  musicSocket.addEventListener("open", () => {
    updateStatus("Music Connected");
    logLine("🎵 Music stream connected");
  });

  musicSocket.addEventListener("close", () => {
    logLine("🎵 Music stream disconnected");
  });

  musicSocket.addEventListener("message", (event) => {
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
  // Only close MUSIC socket - price socket keeps running
  if (musicSocket) {
    musicSocket.close();
    musicSocket = null;
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
  updateStatus("Price Stream Active");  // Not "Disconnected" - prices still streaming
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

  // Reset engine state for fresh random prices on each playback start
  if (shouldReconnect) {
    try {
      await fetch("/reset", { method: "POST" });
      logLine("Engine reset - fresh random prices generated");
    } catch (error) {
      logLine(`Reset warning: ${error.message}`);
    }
  }

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
    connectMusicSocket();
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

updateStatus("Connecting Price Stream...");
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
// Connect price stream immediately on page load
// This runs independently of audio/music
connectPriceSocket();

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
