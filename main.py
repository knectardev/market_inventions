from __future__ import annotations

import asyncio
import json
import random
from typing import Dict, Iterable, List, Optional, Sequence

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()


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


class HarmonicClock:
    """Modulo-16 clock for harmonic progression lookup."""

    def __init__(self) -> None:
        self.step = 0

    def tick(self) -> int:
        self.step = (self.step + 1) % 16
        return self.step


class InventionEngine:
    """Initial voice-leading and harmonic clock wiring."""

    def __init__(self) -> None:
        self.clock = HarmonicClock()
        self.voice_leading = VoiceLeading(root_midi=60)
        self.prev_soprano: Optional[int] = 72
        self.prev_bass: Optional[int] = 48
        self.rng = random.Random()
        self.root_offset = 0
        self.tick_count = 0
        self.passing_tone_prob = 0.35
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
        self.max_root_offset = 5
        self.last_degree = 1

    def _current_regime(self) -> str:
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

    def _apply_passing_tone(self, note: int, min_midi: int, max_midi: int) -> int:
        if self.rng.random() < self.passing_tone_prob:
            shift = self.rng.choice([-2, -1, 1, 2])
            candidate = note + shift
            if min_midi <= candidate <= max_midi:
                return candidate
        return note

    def get_next_notes(self) -> Dict[str, object]:
        self.tick_count += 1
        self.clock.tick()
        regime = self._current_regime()
        progression = self.chord_progressions[regime]
        base_degree = progression[self.clock.step]
        chord_degree = base_degree
        # Inject stochasticity to avoid mechanical looping.
        if self.rng.random() < 0.6:
            # Random walk around previous degree with occasional jumps.
            step = self.rng.choice([-2, -1, 1, 2])
            chord_degree = ((self.last_degree + step - 1) % 7) + 1
        if self.rng.random() < 0.3:
            chord_degree = self.rng.choice(self.allowed_degrees)
        self.last_degree = chord_degree

        if self.rng.random() < 0.5:
            self.root_offset += self.rng.choice([-1, 1])
            self.root_offset = max(
                -self.max_root_offset, min(self.root_offset, self.max_root_offset)
            )
        chord = self.chord_map[chord_degree]
        if regime == "MINOR":
            chord = self._minor_adjust(chord)

        soprano_degree = chord[self.clock.step % len(chord)]
        bass_degree = chord[(self.clock.step + 1) % len(chord)]

        root_midi = self.voice_leading.root_midi + self.root_offset
        soprano_pitch_class = (root_midi + soprano_degree) % 12
        bass_pitch_class = (root_midi + bass_degree) % 12

        soprano = self.voice_leading.pick_pitch_class(
            self.prev_soprano, soprano_pitch_class, 60, 84
        )
        bass = self.voice_leading.pick_pitch_class(
            self.prev_bass, bass_pitch_class, 36, 60
        )

        soprano = self._apply_passing_tone(soprano, 60, 84)
        bass = self._apply_passing_tone(bass, 36, 60)

        self.prev_soprano = soprano
        self.prev_bass = bass

        divergence = self._check_divergence(soprano, bass)
        debug_token = self.rng.randint(0, 999)

        return {
            "soprano_midi": soprano,
            "bass_midi": bass,
            "rvol": 1.0,
            "regime": regime,
            "divergence": divergence,
            "chord": chord_degree,
            "root_offset": self.root_offset,
            "tick": self.tick_count,
            "debug": debug_token,
        }


engine = InventionEngine()


@app.get("/hello", response_class=HTMLResponse)
async def hello() -> str:
    return "<h1>Hello from FastAPI</h1>"


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            data = engine.get_next_notes()
            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(0.125)  # 16th note heartbeat
    except WebSocketDisconnect:
        return


app.mount("/", StaticFiles(directory="static", html=True), name="static")
