from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import random
from typing import Dict, Iterable, List, Optional, Sequence

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

BUILD_ID = "VISUAL_FIX_V28"

class VoiceLeading:
    """Pick the closest chord tone to the previous note."""

    def __init__(self, root_midi: int) -> None:
        self.root_midi = root_midi

    def _candidates(
        self, chord_tones: Iterable[int], min_midi: int, max_midi: int
    ) -> List[int]:
        tones_mod = {tone % 12 for tone in chord_tones}
        return [
            midi
            for midi in range(min_midi, max_midi + 1)
            if (midi - self.root_midi) % 12 in tones_mod
        ]

    def pick(
        self,
        prev_note: Optional[int],
        chord_tones: Iterable[int],
        min_midi: int,
        max_midi: int,
    ) -> int:
        candidates = self._candidates(chord_tones, min_midi, max_midi)
        if not candidates:
            return prev_note if prev_note is not None else min_midi
        if prev_note is None:
            return candidates[len(candidates) // 2]
        return min(candidates, key=lambda note: abs(note - prev_note))

    def pick_pitch_class(
        self,
        prev_note: Optional[int],
        pitch_class: int,
        min_midi: int,
        max_midi: int,
    ) -> int:
        candidates = [
            midi
            for midi in range(min_midi, max_midi + 1)
            if midi % 12 == pitch_class
        ]
        if not candidates:
            return prev_note if prev_note is not None else min_midi
        if prev_note is None:
            return candidates[len(candidates) // 2]
        return min(candidates, key=lambda note: abs(note - prev_note))

    def pick_near_target(
        self,
        prev_note: Optional[int],
        pitch_class: int,
        target_midi: int,
        min_midi: int,
        max_midi: int,
    ) -> int:
        candidates = [
            midi
            for midi in range(min_midi, max_midi + 1)
            if midi % 12 == pitch_class
        ]
        if not candidates:
            return prev_note if prev_note is not None else target_midi
        if prev_note is None:
            return min(candidates, key=lambda note: abs(note - target_midi))
        return min(
            candidates,
            key=lambda note: abs(note - target_midi) + 0.5 * abs(note - prev_note),
        )


class HarmonicClock:
    """Modulo-16 clock for harmonic progression lookup."""

    def __init__(self) -> None:
        self.step = 0

    def tick(self) -> int:
        self.step = (self.step + 1) % 16
        return self.step


class InventionEngine:
    """Initial voice-leading and harmonic clock wiring."""

    SCALES = {
        "MAJOR": [0, 2, 4, 5, 7, 9, 11],
        "MINOR": [0, 2, 3, 5, 7, 8, 10],
    }

    def __init__(self) -> None:
        self.clock = HarmonicClock()
        self.voice_leading = VoiceLeading(root_midi=60)
        self.prev_soprano: Optional[int] = 72
        self.prev_bass: Optional[int] = 48
        self.rng = random.Random()
        self.root_offset = 0
        self.tick_count = 0
        self.sub_steps = 16
        self.arpeggio_pattern = [0, 2, 4, 2, 7, 4, 2, 0, 0, 2, 4, 2, 7, 4, 2, 0]
        self.qqq_open = 430.0
        self.spy_open = 510.0
        self.qqq_price = self.qqq_open
        self.spy_price = self.spy_open
        self.base_qqq_step_pct = 0.0015
        self.base_spy_step_pct = 0.0010
        self.sensitivity = 1.0
        self.qqq_step_pct = self.base_qqq_step_pct
        self.spy_step_pct = self.base_spy_step_pct
        self.price_noise_multiplier = 1.0
        self.chord_progressions = {
            "MAJOR": [
                1, 1, 4, 4,
                2, 2, 5, 5,
                6, 6, 4, 4,
                5, 5, 1, 1,
            ],
            "MINOR": [
                1, 1, 4, 4,
                6, 6, 2, 2,
                3, 3, 7, 7,
                5, 5, 1, 1,
            ],
        }
        self.chord_map = {
            1: [0, 4, 7],
            2: [2, 5, 9],
            3: [4, 7, 11],
            4: [5, 9, 12],
            5: [7, 11, 14],
            6: [9, 12, 16],
            7: [11, 14, 17],
        }
        self.allowed_degrees = list(self.chord_map.keys())
        self.max_root_offset = 0
        self.last_degree = 1
        self.root_degree_index = 0
        self.lock_regime = "MAJOR"
        self.enable_root_offset_motion = False
        self.fixed_root_midi = 60
        self.soprano_repeat_count = 0
        self.melody_pattern = [0, 1, 0, 2, 0, 1, 0, -1, 0, 2, 0, 1, 0, -1, 0, 1]
        self.melody_phase = 0
        self.stuck_limit = 8
        self.prev_soprano_base: Optional[int] = None  # Track price-derived anchor before offset
        self.soprano_rhythm = 16  # 4 = quarter notes, 8 = eighth notes, 16 = sixteenth notes

    def _current_regime(self) -> str:
        if self.lock_regime:
            return self.lock_regime
        # Placeholder until market-regime logic is wired
        return "MAJOR" if self.clock.step < 8 else "MINOR"

    def _minor_adjust(self, offsets: Sequence[int]) -> List[int]:
        adjusted = []
        for offset in offsets:
            if offset % 12 in {4, 9}:
                adjusted.append(offset - 1)
            else:
                adjusted.append(offset)
        return adjusted

    @staticmethod
    def _check_divergence(soprano_note: int, bass_note: int) -> bool:
        interval = abs(soprano_note - bass_note) % 12
        return interval in {1, 6, 11}

    def _next_price(self, current: float, step: float, drift: float) -> float:
        noise_step = step * self.price_noise_multiplier
        noise = self.rng.uniform(-noise_step, noise_step)
        next_price = current + noise + drift
        return max(0.01, next_price)

    def _price_to_midi(
        self,
        price: float,
        open_price: float,
        base_midi: int,
        step_pct: float,
        prev_price: Optional[float] = None,
    ) -> int:
        """Convert price to MIDI with trend-aware rounding to eliminate deadzones."""
        import math
        delta_pct = (price - open_price) / open_price
        raw_semitones = delta_pct / step_pct

        # Use floor/ceil based on price trend direction to be more reactive
        if prev_price is not None:
            if price > prev_price:
                semitones = math.ceil(raw_semitones)
            elif price < prev_price:
                semitones = math.floor(raw_semitones)
            else:
                semitones = round(raw_semitones)
        else:
            semitones = round(raw_semitones)

        return base_midi + semitones

    def _fit_to_range(self, prev_note: Optional[int], target: int, min_midi: int, max_midi: int) -> int:
        candidates = [target + (12 * shift) for shift in range(-4, 5)]
        candidates = [note for note in candidates if min_midi <= note <= max_midi]
        if not candidates:
            return min(max(target, min_midi), max_midi)
        if prev_note is None:
            return min(candidates, key=lambda note: abs(note - target))
        return min(candidates, key=lambda note: abs(note - target) + 0.5 * abs(note - prev_note))

    def _advance_root_offset(self, regime: str) -> None:
        if not self.enable_root_offset_motion:
            return
        scale_degrees = self.SCALES.get(regime, self.SCALES["MAJOR"])
        if not scale_degrees:
            return
        step = self.rng.choice([-1, 1])
        self.root_degree_index = (self.root_degree_index + step) % len(scale_degrees)
        self.root_offset = scale_degrees[self.root_degree_index]
        self.root_offset = max(-self.max_root_offset, min(self.root_offset, self.max_root_offset))

    def set_sensitivity(self, multiplier: float) -> None:
        safe_multiplier = max(0.1, min(multiplier, 10.0))
        self.sensitivity = safe_multiplier
        self.qqq_step_pct = self.base_qqq_step_pct / safe_multiplier
        self.spy_step_pct = self.base_spy_step_pct / safe_multiplier

    def set_price_noise(self, multiplier: float) -> None:
        self.price_noise_multiplier = max(0.1, min(multiplier, 5.0))

    def set_soprano_rhythm(self, rhythm: int) -> None:
        """Set soprano rhythm: 4 = quarter notes, 8 = eighth notes, 16 = sixteenth notes"""
        if rhythm in {4, 8, 16}:
            self.soprano_rhythm = rhythm

    @staticmethod
    def _offset_scale_degree(
        note: int, scale_pool: Sequence[int], offset: int
    ) -> int:
        if not scale_pool:
            return note
        pool = sorted(scale_pool)
        index = min(range(len(pool)), key=lambda i: abs(pool[i] - note))
        next_index = max(0, min(len(pool) - 1, index + offset))
        return pool[next_index]

    def _escape_stuck(
        self, note: int, scale_pool: Sequence[int], direction: int
    ) -> int:
        return self._offset_scale_degree(note, scale_pool, 2 * direction)

    def _get_scale_notes(
        self, regime: str, root_midi: int, min_midi: int, max_midi: int
    ) -> List[int]:
        intervals = self.SCALES.get(regime, self.SCALES["MAJOR"])
        return [
            midi
            for midi in range(min_midi, max_midi + 1)
            if (midi - root_midi) % 12 in intervals
        ]

    @staticmethod
    def _nearest_scale_note(target_midi: int, scale_pool: Sequence[int]) -> int:
        if not scale_pool:
            return target_midi
        return min(scale_pool, key=lambda note: abs(note - target_midi))

    @staticmethod
    def _nearest_scale_note_above(
        target_midi: int, scale_pool: Sequence[int]
    ) -> Optional[int]:
        candidates = [note for note in scale_pool if note >= target_midi]
        if not candidates:
            return None
        return min(candidates, key=lambda note: abs(note - target_midi))

    def _pick_scale_step(
        self,
        prev_note: Optional[int],
        target_midi: int,
        scale_pool: Sequence[int],
        max_degree_step: int,
        repeat_penalty: float = 0.2,
    ) -> int:
        if not scale_pool:
            return prev_note if prev_note is not None else target_midi
        pool = sorted(scale_pool)
        if prev_note is None:
            return min(pool, key=lambda note: abs(note - target_midi))

        prev_index = min(range(len(pool)), key=lambda i: abs(pool[i] - prev_note))
        lo = max(0, prev_index - max_degree_step)
        hi = min(len(pool) - 1, prev_index + max_degree_step)
        window = pool[lo : hi + 1]
        return min(
            window,
            key=lambda note: abs(note - target_midi)
            + (repeat_penalty if note == prev_note else 0),
        )

    @staticmethod
    def _enforce_stepwise_motion(
        prev_note: Optional[int],
        candidate: int,
        scale_pool: Sequence[int],
        min_move: int = 1,
    ) -> int:
        if prev_note is None or candidate is None:
            return candidate
        if abs(candidate - prev_note) >= min_move:
            return candidate
        direction = 1 if candidate >= prev_note else -1
        pool = sorted(scale_pool)
        if not pool:
            return candidate
        if direction > 0:
            higher = [note for note in pool if note > prev_note]
            return higher[0] if higher else candidate
        lower = [note for note in pool if note < prev_note]
        return lower[-1] if lower else candidate

    @staticmethod
    def _step_toward_target(
        prev_note: Optional[int],
        target_midi: int,
        scale_pool: Sequence[int],
        step_degrees: int = 1,
    ) -> Optional[int]:
        if prev_note is None or not scale_pool:
            return None
        pool = sorted(scale_pool)
        prev_index = min(range(len(pool)), key=lambda i: abs(pool[i] - prev_note))
        direction = 1 if target_midi >= prev_note else -1
        next_index = prev_index + (step_degrees * direction)
        next_index = max(0, min(len(pool) - 1, next_index))
        return pool[next_index]

    def _avoid_stagnation(
        self,
        candidate: int,
        prev: Optional[int],
        prev_prev: Optional[int],
        min_midi: int,
        max_midi: int,
    ) -> int:
        if prev is None:
            return candidate
        if candidate != prev:
            return candidate
        if prev_prev is not None and prev_prev == prev:
            # Force movement by octave shift within range.
            if candidate + 12 <= max_midi:
                return candidate + 12
            if candidate - 12 >= min_midi:
                return candidate - 12
        return candidate

    def _pattern_offset(self, chord: Sequence[int], degree: int) -> int:
        if degree == 2:
            return chord[1]
        if degree == 4:
            return chord[2]
        if degree == 7:
            return chord[0] + 12
        return chord[0]

    def _select_chord_degree(self, regime: str) -> int:
        progression = self.chord_progressions[regime]
        base_degree = progression[self.clock.step]
        self.last_degree = base_degree
        return base_degree

    def generate_one_second_bundle(self) -> Dict[str, object]:
        start_tick = self.tick_count + 1
        regime = self._current_regime()

        if self.clock.step == 0 and self.rng.random() < 0.35:
            self._advance_root_offset(regime)

        start_qqq = self.qqq_price
        start_spy = self.spy_price
        end_qqq = self._next_price(start_qqq, step=0.6, drift=0.03)
        end_spy = self._next_price(start_spy, step=0.45, drift=0.02)
        self.qqq_price = end_qqq
        self.spy_price = end_spy

        soprano_bundle: List[Optional[int]] = []
        bass_bundle: List[Optional[int]] = []
        qqq_prices: List[float] = []
        spy_prices: List[float] = []
        qqq_note_prices: List[float] = []
        spy_note_prices: List[Optional[float]] = []
        divergence_steps: List[bool] = []

        self.root_offset = 0
        root_midi = self.fixed_root_midi
        chord_degree = 1
        chord = self.chord_map[chord_degree]
        chord_tone_mods = {tone % 12 for tone in chord}
        # Dynamic range: Calculate initial anchor to center the range around price
        # This prevents ceiling/floor lock when price drifts from open
        initial_qqq_anchor = self._price_to_midi(
            start_qqq, self.qqq_open, base_midi=72, step_pct=self.qqq_step_pct
        )
        initial_spy_anchor = self._price_to_midi(
            start_spy, self.spy_open, base_midi=48, step_pct=self.spy_step_pct
        )

        # Soprano range: 12 semitones (1 octave) centered on price anchor
        # Allow wide center range (54-96) so melody can follow price freely
        soprano_half_range = 12
        soprano_center = max(54, min(96, initial_qqq_anchor))
        soprano_min = max(36, soprano_center - soprano_half_range)
        soprano_max = min(108, soprano_center + soprano_half_range)

        # Bass range: 10 semitones centered on price anchor
        # Allow wider center range for better tracking
        bass_half_range = 10
        bass_center = max(36, min(60, initial_spy_anchor))
        bass_min = max(24, bass_center - bass_half_range)
        bass_max = min(72, bass_center + bass_half_range)

        soprano_pool = self._get_scale_notes(regime, root_midi, soprano_min, soprano_max)
        bass_pool = self._get_scale_notes(regime, root_midi, bass_min, bass_max)

        prev_qqq_price: Optional[float] = None
        prev_spy_price: Optional[float] = None
        
        # Store range info for visual price calculation
        bundle_soprano_center = soprano_center
        bundle_bass_center = bass_center
        bundle_start_qqq = start_qqq
        bundle_start_spy = start_spy

        for i in range(self.sub_steps):
            self.tick_count += 1
            self.clock.tick()

            lerp_factor = i / (self.sub_steps - 1)
            qqq_price = start_qqq + (end_qqq - start_qqq) * lerp_factor
            spy_price = start_spy + (end_spy - start_spy) * lerp_factor
            qqq_price += self.rng.uniform(-0.02, 0.02)
            spy_price += self.rng.uniform(-0.02, 0.02)

            qqq_prices.append(round(qqq_price, 4))
            spy_prices.append(round(spy_price, 4))

            # FIX: Calculate unclamped target first to maintain responsiveness
            # This allows tracking price movement even outside the audible MIDI range
            qqq_anchor_midi_raw = self._price_to_midi(
                qqq_price, self.qqq_open, base_midi=72, step_pct=self.qqq_step_pct,
                prev_price=prev_qqq_price
            )
            prev_qqq_price = qqq_price
            if i % 4 == 0:
                chord_pool = [
                    note
                    for note in soprano_pool
                    if (note - root_midi) % 12 in chord_tone_mods
                ]
                allowed_soprano = chord_pool or soprano_pool
            else:
                allowed_soprano = soprano_pool
            soprano_degree_step = max(1, min(7, round(self.sensitivity)))
            
            # FIX: Sensitivity-based repeat penalty (disable at high sensitivity)
            repeat_penalty_value = 0.0 if self.sensitivity >= 5.0 else 0.2
            
            # Rhythm control: Only generate new soprano notes at rhythm boundaries
            rhythm_interval = 16 // self.soprano_rhythm  # 1 for 16th, 2 for 8th, 4 for quarter
            should_update_soprano = (i % rhythm_interval == 0)
            
            if should_update_soprano:
                if self.sensitivity >= 4.0:
                    # HIGH SENSITIVITY: Track price directly within the scale
                    # Use raw unclamped target so notes respond immediately to price changes
                    base_soprano = self._nearest_scale_note(qqq_anchor_midi_raw, allowed_soprano)

                    # Stochastic jitter: When price is flat, randomly walk ±1-2 scale degrees
                    # This prevents visual flatlining while still centering around price
                    if self.prev_soprano_base is not None and base_soprano == self.prev_soprano_base:
                        self.soprano_repeat_count += 1
                    else:
                        self.soprano_repeat_count = 0

                    self.prev_soprano_base = base_soprano

                    if self.soprano_repeat_count >= 1:
                        # Brownian motion jitter - random walk around the anchor
                        jitter_range = min(3, 1 + self.soprano_repeat_count // 2)  # Grows with stagnation
                        jitter = self.rng.randint(-jitter_range, jitter_range)
                        # Bias toward movement (avoid 0)
                        if jitter == 0 and self.soprano_repeat_count >= 2:
                            jitter = self.rng.choice([-1, 1])
                        soprano = self._offset_scale_degree(base_soprano, soprano_pool, jitter)
                    else:
                        soprano = base_soprano
                else:
                    # FIX: Use raw unclamped target to feel price movement immediately
                    soprano = self._pick_scale_step(
                        self.prev_soprano,
                        qqq_anchor_midi_raw,  # Use raw target for responsive tracking
                        allowed_soprano,
                        max_degree_step=max(2, soprano_degree_step) if i % 4 == 0 else soprano_degree_step,
                        repeat_penalty=repeat_penalty_value,  # Adjusted based on sensitivity
                    )
                    soprano = self._nearest_scale_note(soprano, soprano_pool)
                    if i % 2 == 1:
                        stepped = self._step_toward_target(
                            self.prev_soprano,
                            qqq_anchor_midi_raw,  # Use raw target
                            soprano_pool,
                            step_degrees=soprano_degree_step,
                        )
                        if stepped is not None:
                            soprano = stepped
                    soprano = self._enforce_stepwise_motion(
                        self.prev_soprano, soprano, soprano_pool, min_move=soprano_degree_step
                    )
                    if self.prev_soprano is not None and soprano == self.prev_soprano:
                        self.soprano_repeat_count += 1
                    else:
                        self.soprano_repeat_count = 0
                    if self.soprano_repeat_count >= 2:
                        forced = self._step_toward_target(
                            self.prev_soprano,
                            qqq_anchor_midi_raw,  # Use raw target
                            soprano_pool,
                            step_degrees=max(2, soprano_degree_step),
                        )
                        if forced is not None:
                            soprano = forced
                            self.soprano_repeat_count = 0
                    if self.soprano_repeat_count >= self.stuck_limit:
                        direction = 1 if qqq_anchor_midi_raw >= (self.prev_soprano or soprano) else -1
                        soprano = self._escape_stuck(soprano, soprano_pool, direction)
                        self.soprano_repeat_count = 0
            else:
                # Hold the previous soprano note between rhythm boundaries
                soprano = self.prev_soprano if self.prev_soprano is not None else 72

            # BASS LOGIC: Quarter-note rhythm with stochastic jitter
            bass_note: Optional[int] = None
            bass_note_price: Optional[float] = None
            spy_anchor_midi = self._price_to_midi(
                spy_price, self.spy_open, base_midi=48, step_pct=self.spy_step_pct,
                prev_price=prev_spy_price
            )
            prev_spy_price = spy_price

            if i % 4 == 0:
                # Quarter beat - pick a new bass note using instantaneous LERP'd price
                chord_bass_pool = [
                    note
                    for note in bass_pool
                    if (note - root_midi) % 12 in chord_tone_mods
                ]
                allowed_bass = chord_bass_pool or bass_pool
                base_bass = self._nearest_scale_note(spy_anchor_midi, allowed_bass)

                # Stochastic jitter for bass when note would repeat
                if self.prev_bass is not None and base_bass == self.prev_bass:
                    # Random walk ±1-2 scale degrees to prevent stagnation
                    jitter = self.rng.choice([-2, -1, 1, 2])
                    bass_note = self._offset_scale_degree(base_bass, bass_pool, jitter)
                else:
                    bass_note = base_bass

                self.prev_bass = bass_note
            else:
                # Hold the previous bass note for the rest of the quarter-beat
                bass_note = self.prev_bass

            # Calculate visual price: offset from the dynamic range center
            if bass_note is not None:
                bass_offset_from_center = bass_note - bundle_bass_center
                bass_note_price = bundle_start_spy * (1 + bass_offset_from_center * self.spy_step_pct)
            else:
                bass_note_price = None

            if bass_note is not None:
                min_separation = 12
                min_soprano = bass_note + min_separation
                if soprano < min_soprano:
                    adjusted = self._nearest_scale_note_above(min_soprano, soprano_pool)
                    if adjusted is not None:
                        soprano = adjusted

            self.prev_soprano = soprano
            # Calculate visual price: offset from the dynamic range center
            # This ensures notes hug the current price even when far from opening
            soprano_offset_from_center = soprano - bundle_soprano_center
            qqq_note_price = bundle_start_qqq * (1 + soprano_offset_from_center * self.qqq_step_pct)

            soprano_bundle.append(soprano)
            bass_bundle.append(bass_note)
            qqq_note_prices.append(round(qqq_note_price, 4))
            spy_note_prices.append(round(bass_note_price, 4) if bass_note_price is not None else None)

            if bass_note is None:
                divergence_steps.append(False)
            else:
                divergence_steps.append(self._check_divergence(soprano, bass_note))

        return {
            "payload_version": "bundle_v2",
            "server_path": __file__,
            "build_id": BUILD_ID,
            "soprano_bundle": soprano_bundle,
            "bass_bundle": bass_bundle,
            "qqq_prices": qqq_prices,
            "spy_prices": spy_prices,
            "qqq_note_prices": qqq_note_prices,
            "spy_note_prices": spy_note_prices,
            "rvol": 1.0,
            "regime": regime,
            "divergence": any(divergence_steps),
            "chord": chord_degree,
            "root_offset": self.root_offset,
            "start_tick": start_tick,
            "tick_count": self.tick_count,
            "qqq_price": round(self.qqq_price, 2),
            "spy_price": round(self.spy_price, 2),
        }


engine = InventionEngine()


@app.get("/hello", response_class=HTMLResponse)
async def hello() -> str:
    return "<h1>Hello from FastAPI</h1>"


@app.get("/build")
async def build_info() -> Dict[str, str]:
    return {
        "build_id": BUILD_ID,
        "server_path": __file__,
        "server_time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@app.post("/config")
async def update_config(payload: Dict[str, float]) -> Dict[str, object]:
    multiplier = float(payload.get("sensitivity", 1.0))
    engine.set_sensitivity(multiplier)
    noise = float(payload.get("price_noise", engine.price_noise_multiplier))
    engine.set_price_noise(noise)
    if "soprano_rhythm" in payload:
        rhythm = int(payload["soprano_rhythm"])
        engine.set_soprano_rhythm(rhythm)
    return {
        "sensitivity": engine.sensitivity,
        "qqq_step_pct": engine.qqq_step_pct,
        "spy_step_pct": engine.spy_step_pct,
        "price_noise": engine.price_noise_multiplier,
        "soprano_rhythm": engine.soprano_rhythm,
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            data = engine.generate_one_second_bundle()
            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        return


app.mount("/", StaticFiles(directory="static", html=True), name="static")
