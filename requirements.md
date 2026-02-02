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

**Next step for development:** Would you like me to generate the `Tone.js` sampler configuration so you can load high-quality harpsichord or pipe organ samples for that authentic Bach sound?