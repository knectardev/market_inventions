Here is your **Market Inventions** requirements document, properly reformatted with Markdown to be clean, scannable, and ready for use in Cursor or any other editor.

---

# Project: Bach Market Invention Engine (BMIE)

## 1. Project Overview

An algorithmic sonification engine that transforms real-time market data (SPY & QQQ) into a two-part Baroque-style counterpoint (Invention). The system maps market volatility, price trends, and asset correlation to musical regimes, harmonic progressions, and dynamic tempo.

---

## 2. Data Strategy

* **Primary Source (Soprano):** QQQ (Nasdaq 100) – drives melodic flourishes and high-frequency movement.
* **Secondary Source (Bass):** SPY (S&P 500) – drives the foundational counter-melody and harmonic floor.
* **Anchor:** Opening Range (OR) High/Low and Midpoint of the first  minutes of the session.
* **Normalization:** All price data converted to percentage distance from the OR Midpoint.
* **Step Sensitivity:** 1 semitone = 0.15% (QQQ) / 0.10% (SPY).


* **Pace:** Tempo (BPM) is driven by **Relative Volume (RVOL)**.

---

## 3. Musical Regime Matrix

The scale and "mood" shift based on the relationship between Price and its Exponential Moving Average (EMA), and Volatility (ATR or Bollinger Band width).

| Market State | Logic | Scale |
| --- | --- | --- |
| **Trending Up** |  | Major |
| **Trending Down** |  | Natural Minor |
| **Bullish Breakout** |  | Whole Tone |
| **Bearish Breakout** |  | Diminished |

---

## 4. Harmonic & Compositional Rules

* **Chromatic Level Shifts:** Every time price crosses a "Level" (defined by the Step Sensitivity), the global root shifts  semitone.
* **The Schmitt Trigger:** To prevent regime flickering, price must mean-revert 20% into the previous zone to "undo" a chromatic or scale shift.
* **The Harmonic Clock:** A modulo-16 counter. Each beat moves through a phase-dependent progression (e.g., ).
* **Voice Leading:** * **Rule of Minimal Distance:** .
* **Contour:** If , prioritize the next scale degree up.


* **Counterpoint:** Parallel motion (3rds/6ths) during high correlation; contrary/oblique motion during divergence.

---

## 5. Technical Stack

* **Backend:** Python (FastAPI).
* **Tasks:** EMA/Volatility calculations, Chromatic offset logic, Note selection.


* **Frontend:** React/Vanilla JS + **Tone.js**.
* **Tasks:** Web Audio synthesis (Sampler/PolySynth), 16th-note Transport scheduling, UI Visualization.


* **Communication:** WebSockets (FastAPI WebSocket) for low-latency streaming of note packets from Python to the Browser.

---

## 6. Implementation Logic Flow

1. **Ingest:** Python fetches tick data for SPY/QQQ.
2. **Analyze:** Determine Regime (Scale) and Chromatic Offset (Key).
3. **Compose:** * Select  (QQQ-driven, 16th-note resolution).
* Select  (SPY-driven, 8th-note resolution).


4. **Broadcast:** Send `{soprano_midi, bass_midi, rvol, regime}` packet via WebSocket.
5. **Perform:** Tone.js schedules the notes on the Transport clock, adjusting BPM based on **RVOL**.

---

## 7. Visual Data Acquisition (The "Optical" Module)
* **Method:** Screen-capture of a defined Bounding Box (ROI - Region of Interest).
* **Price Mapping:** * Top of ROI = Max Note.
    * Bottom of ROI = Min Note.
    * `y_pixel` position is normalized to the current scale degrees.
* **Velocity/Tempo:** * Calculate `abs(y_now - y_prev)`. 
    * If the distance is large, increase RVOL (Pace).
* **Regime Detection:** * Sample pixel colors at the lead price point. 
    * Green Pixels = Major/Whole Tone.
    * Red Pixels = Minor/Diminished.

---


## 8. Two-Part Counterpoint (Invention Logic)
* **Lead Voice (Soprano):** * Source: Ticker A (e.g., NQ).
    * Rhythm: 16th notes.
    * Function: Melodic flourishes and regime definitions.
* **Secondary Voice (Bass):**
    * Source: Ticker B (e.g., TNX or GLD).
    * Rhythm: 8th or Quarter notes (1/2 the speed of Soprano).
    * Function: Harmonic grounding and counter-motion.
* **Divergence Rules:**
    * If Ticker A and B are correlated: Force intervals of 3rds, 5ths, or 10ths.
    * If Ticker A and B diverge: Allow dissonant intervals (2nds, 7ths) that must resolve on the next "Harmonic Clock" beat.
* **Normalization:** Both tickers are normalized to their respective Opening Ranges to ensure they share the same "Middle C" starting point despite price differences.

---

## 9. Intermarket Normalization
* **Anchor Scaling:** All price inputs are converted to `ticks_from_open` using: 
  `delta_pct = (price - open) / open`.
* **Step Sensitivity:** `1 Step = 0.1%` (adjustable). This ensures that volatility is audible; a 2% "God Candle" results in a 20-semitone melodic leap.
* **Spatial Separation:** * **Soprano (Asset A):** Centers around MIDI 60-84.
    * **Bass (Asset B):** Centers around MIDI 36-54.
* **Consonance Filter:** * If `abs(Soprano - Bass) % 12` is a "Perfect Interval" (0, 7, 5), the market is in **Sync**.
    * If the interval is a "Tritone" or "Minor Second" (6, 1), the assets are **Diverging** or in a **Regime Shift**.

---

## 10. System Routing & Latency
* **MIDI Port:** Virtual MIDI Bus (Port Name: "Gemini Bach Port").
* **Clock Sync:** The system uses a 'soft-clock' driven by the `time.sleep()` function.
* **Volume-Tempo Curve:** * Exponential mapping: `Tempo = Base_BPM * (RVOL ^ 1.2)`. 
    * This makes high-volume "blow-off tops" sound significantly more frenetic.
* **Note Velocity:** * Soprano Velocity = 80 (to stand out).
    * Bass Velocity = 60 (to provide a background floor).

---

## 11. Web Interface Implementation
* **Audio Engine:** Tone.js (Web Audio API).
* **Scheduling:** Tone.Transport for millisecond-perfect 16th-note resolution.
* **Visualization:** * **The "Piano Roll" Chart:** A rolling canvas showing the notes being played.
    * **The "Regime Indicator":** Color-coded background (Green=Major, Purple=Whole Tone, Red=Minor, Gold=Diminished).
* **Data Transport:** Server-Sent Events (SSE) or WebSockets to push SPY/QQQ updates from the Python backend to the UI.

---

## 12. UI Controls & Sound Management
* **Transport Control:** The app must start with the audio engine 'suspended'. A 'Start' button must trigger `Tone.start()`.
* **Sample Management:** * Provide at least 3 distinct "Baroque" sounds: Harpsichord, Pipe Organ, and Strings.
    * Use a Loading indicator or disable the Play button until samples are fully cached.
* **Stop Function:** When stopped, clear all scheduled notes and silence the Sampler immediately using `sampler.releaseAll()`.

---

## 13. Active Timeline Visualization
* **Playhead:** A fixed vertical line at 85% X-axis.
* **Scroll Direction:** Notes enter from the right (future) and move left (past).
* **Audio-Visual Sync:** Sound must trigger exactly when the note-block intersects the Playhead line.
* **Contextual Grid:** Background should display horizontal faint lines representing the current Scale/Chord degrees to provide visual harmonic context.

---


## 14. Harmonic Intelligence & Alerting
* **Cadence Logic:** The engine must resolve to 'home' tones every 16 beats to provide rhythmic structure.
* **Divergence Monitoring:** Audible dissonance (Tritones/Minor Seconds) is triggered when SPY and QQQ correlation breaks.
* **Minimal Jump Constraint:** Melodic leaps are capped at 5 semitones per tick to ensure "Bach-style" smoothness, regardless of price volatility.

--- 

## 15. The "Tritone" Divergence Alert
* **Logic:** Calculate `interval % 12` between Soprano and Bass.
* **Alert Trigger:** If interval is 1, 6, or 11, set `divergence = true`.
* **Audio Response:** Apply a -100 cent detune or a BitCrusher effect to symbolize "Market Friction."
* **Visual Response:** The Playhead line must pulse Red, and the background of the canvas should darken.

--- 

## 16. Dual-Channel Control & Multi-Axis UI
* **Default State:** Initial instrument set to `Electric Organ` for both channels.
* **X-Axis Units:** * 1 Unit = 1 Tick (16th Note).
    * 4 Units = 1 Second (Quarter Note). 
    * Labels should appear every 4 ticks (1s, 2s, 3s...).
* **Dual Y-Axes:** * **Right:** QQQ Price Scale (tied to Soprano).
    * **Left:** SPY Price Scale (tied to Bass).
    * Scales must auto-range based on the min/max price currently visible in the sliding window.
* **Mute/Hide Toggle:** Checkboxes per ticker that toggle both the Tone.js sampler output and the canvas rendering.

