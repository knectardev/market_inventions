from __future__ import annotations

import asyncio
import json
from typing import Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()


class InventionEngine:
    """Placeholder engine for initial setup and wiring."""

    def __init__(self) -> None:
        self.step = 0

    def get_next_notes(self) -> Dict[str, object]:
        # Simulated logic for the initial run
        self.step += 1
        return {
            "soprano_midi": 72 + (self.step % 12),
            "bass_midi": 48,
            "rvol": 1.0,
            "regime": "MAJOR",
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
