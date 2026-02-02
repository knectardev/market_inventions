const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const startButton = document.getElementById("start");
const instrumentSelect = document.getElementById("instrument");
const sopranoEl = document.getElementById("soprano");
const bassEl = document.getElementById("bass");
const regimeEl = document.getElementById("regime");
const chordEl = document.getElementById("chord");
const rootOffsetEl = document.getElementById("root-offset");
const tickEl = document.getElementById("tick");
const rvolEl = document.getElementById("rvol");

let socket = null;
let harpsichord = null;
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

const addNoteEvent = (midi, voice) => {
  noteEvents.push({
    midi,
    voice,
    time: performance.now(),
  });
  if (noteEvents.length > 400) {
    noteEvents.splice(0, noteEvents.length - 400);
  }
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
  const range = noteConfig.maxMidi - noteConfig.minMidi;

  for (const event of noteEvents) {
    const secondsFromNow = (event.time - now) / 1000;
    const x = playheadX + secondsFromNow * noteConfig.pixelsPerSecond;
    if (x < -20 || x > width + 20) {
      continue;
    }
    const midi = clamp(event.midi, noteConfig.minMidi, noteConfig.maxMidi);
    const y =
      height - ((midi - noteConfig.minMidi) / range) * height;
    const color =
      event.voice === "soprano"
        ? noteConfig.sopranoColor
        : noteConfig.bassColor;
    canvasCtx.fillStyle = color;
    canvasCtx.fillRect(x, y - 3, 8, 6);
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
    } = data;

    const regimeKey = String(regime || "").toUpperCase();

    sopranoEl.textContent = soprano_midi;
    bassEl.textContent = bass_midi;
    regimeEl.textContent = regimeKey || "--";
    chordEl.textContent = chord ?? "--";
    rootOffsetEl.textContent = root_offset ?? "--";
    tickEl.textContent = tick ?? "--";
    rvolEl.textContent = rvol;

    regimeEl.classList.remove(...Object.values(regimeClassMap));
    if (regimeClassMap[regimeKey]) {
      regimeEl.classList.add(regimeClassMap[regimeKey]);
    }

    document.body.classList.remove(...Object.values(regimeBackgroundMap));
    if (regimeBackgroundMap[regimeKey]) {
      document.body.classList.add(regimeBackgroundMap[regimeKey]);
    }

    divergenceActive = Boolean(divergence);

    if (harpsichord && isPlaying) {
      const now = Tone.now();
      const detuneTarget = divergence ? -100 : 0;
      if (harpsichord.detune) {
        harpsichord.detune.rampTo(detuneTarget, 0.1);
      }
      harpsichord.triggerAttackRelease(
        Tone.Frequency(soprano_midi, "midi"),
        "16n",
        now
      );
      harpsichord.triggerAttackRelease(
        Tone.Frequency(bass_midi, "midi"),
        "8n",
        now
      );
    }

    addNoteEvent(soprano_midi, "soprano");
    addNoteEvent(bass_midi, "bass");
  });
};

const stopPlayback = () => {
  loadCounter += 1;
  isPlaying = false;
  if (socket) {
    socket.close();
    socket = null;
  }
  if (harpsichord) {
    harpsichord.releaseAll?.();
    harpsichord.dispose();
    harpsichord = null;
  }
  setButtonState("Start Audio", false);
  updateStatus("Disconnected");
};

const startPlayback = async () => {
  await Tone.start();

  const loadToken = (loadCounter += 1);
  const shouldReconnect = !isPlaying;
  setButtonState("Loading Samples...", true);

  const selected = instrumentSelect.value;
  const config = instrumentMap[selected] || instrumentMap.harpsichord;

  let sampler = null;

  const loadSampler = () =>
    new Promise((resolve) => {
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

  const loadResult = await Promise.race([loadSampler(), timeoutPromise]);
  if (loadToken !== loadCounter) {
    return;
  }
  if (loadResult === "timeout") {
    if (sampler) {
      sampler.dispose();
    }
    logLine(`Sample load timed out for ${config.label}.`);
    updateStatus("Sample load timed out");
    setButtonState("Start Audio", false);
    return;
  }

  if (harpsichord) {
    harpsichord.dispose();
  }
  harpsichord = loadResult;
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

instrumentSelect.addEventListener("change", () => {
  if (isPlaying) {
    startPlayback();
  }
});
