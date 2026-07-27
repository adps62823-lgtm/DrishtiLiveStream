"""
Drishti live streaming - Pi side (aiortc WebRTC client)
=========================================================
Connects out to the signaling server, waits for a family member to open
the watch page, then streams live video directly to their browser.

Designed to plug into drishti.py's existing `current_frame` global via a
simple getter function - it does NOT touch the camera itself, so there is
zero contention with the existing Gemini capture flow. Both just read the
same shared frame independently.

If this causes CPU strain once running alongside STT/TTS/Gemini, simply
don't call start_webrtc_streaming() in drishti.py - nothing else changes.
"""

import asyncio
import fractions
import json
import os

import cv2
import numpy as np
import websockets
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from aiortc.sdp import candidate_from_sdp
from av import VideoFrame

SIGNALING_URL = os.environ.get("SIGNALING_URL")  # e.g. wss://your-app.onrender.com
SIGNALING_SECRET = os.environ.get("SIGNALING_SECRET")
STREAM_FPS = int(os.environ.get("STREAM_FPS", "8"))  # kept low deliberately - see note below


class SharedFrameTrack(VideoStreamTrack):
    """A video track that pulls whatever frame is currently in the shared
    buffer, rather than owning/reading the camera itself. Paced to
    STREAM_FPS to bound CPU cost - streaming doesn't need to match the
    camera's native frame rate, and a lower rate leaves more CPU headroom
    for STT/TTS/Gemini, which matter more for the core assistant features."""

    def __init__(self, get_frame_fn):
        super().__init__()
        self.get_frame_fn = get_frame_fn
        self._frame_interval = 1.0 / STREAM_FPS
        self._last_pts = 0

    async def recv(self):
        await asyncio.sleep(self._frame_interval)

        frame_bgr = self.get_frame_fn()
        if frame_bgr is None:
            # No frame yet - send a plain black frame rather than crashing,
            # camera_thread should populate this within a couple seconds
            # of startup in the normal case.
            frame_rgb = np.zeros((240, 320, 3), dtype=np.uint8)
        else:
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

        video_frame = VideoFrame.from_ndarray(frame_rgb, format="rgb24")
        self._last_pts += int(90000 / STREAM_FPS)  # 90kHz clock, standard for video
        video_frame.pts = self._last_pts
        video_frame.time_base = fractions.Fraction(1, 90000)
        return video_frame


async def _send(ws, obj):
    await ws.send(json.dumps(obj))


def _parse_ice_candidate(candidate_dict):
    """Converts a browser-style ICE candidate dict (from RTCPeerConnection's
    onicecandidate in JS) into the RTCIceCandidate object aiortc's
    addIceCandidate() actually expects - passing the raw dict through
    silently fails, so this conversion is required, not optional."""
    sdp_str = candidate_dict.get("candidate", "")
    if sdp_str.startswith("candidate:"):
        sdp_str = sdp_str[len("candidate:"):]
    if not sdp_str.strip():
        return None  # empty candidate = end-of-candidates marker, nothing to add
    candidate = candidate_from_sdp(sdp_str)
    candidate.sdpMid = candidate_dict.get("sdpMid")
    candidate.sdpMLineIndex = candidate_dict.get("sdpMLineIndex")
    return candidate


async def _handle_one_viewer_session(ws, get_frame_fn):
    """Waits for one offer from the viewer, answers it, streams until that
    session ends, then returns so the caller can wait for the next one."""
    pc = RTCPeerConnection()
    pc.addTrack(SharedFrameTrack(get_frame_fn))

    connection_closed = asyncio.Event()

    @pc.on("connectionstatechange")
    async def on_state_change():
        print(f"[Livestream] Connection state: {pc.connectionState}")
        if pc.connectionState in ("failed", "closed", "disconnected"):
            connection_closed.set()

    # Wait for the offer that triggered this session.
    while True:
        raw = await ws.recv()
        msg = json.loads(raw)

        if msg["type"] == "offer":
            await pc.setRemoteDescription(RTCSessionDescription(sdp=msg["sdp"], type="offer"))
            answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            await _send(ws, {"type": "answer", "sdp": pc.localDescription.sdp})
            print("[Livestream] Viewer connected, streaming started.")
            break

    # From here on, relay ICE candidates coming from the browser and wait
    # for the session to end. Note: aiortc gathers its OWN candidates
    # synchronously inside setLocalDescription() above, and they're already
    # embedded in the answer SDP we just sent - there's no separate
    # "icecandidate" event to listen for on the Pi side, unlike in browsers.
    async def message_pump():
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "ice-candidate" and msg.get("candidate"):
                try:
                    parsed = _parse_ice_candidate(msg["candidate"])
                    if parsed is not None:
                        await pc.addIceCandidate(parsed)
                except Exception as e:
                    print(f"[Livestream] Failed to add ICE candidate: {e}")

    pump_task = asyncio.create_task(message_pump())

    await connection_closed.wait()
    pump_task.cancel()
    await pc.close()
    print("[Livestream] Viewer session ended.")


async def start_webrtc_streaming(get_frame_fn):
    """Long-running task: connects to the signaling server, registers as
    the Pi, and handles viewer sessions one after another indefinitely.
    Reconnects automatically if the signaling connection drops."""
    if not SIGNALING_URL or not SIGNALING_SECRET:
        print("[Livestream] SIGNALING_URL or SIGNALING_SECRET not set - "
              "livestream feature disabled.")
        return

    while True:
        try:
            async with websockets.connect(SIGNALING_URL) as ws:
                await _send(ws, {"type": "register", "role": "pi", "secret": SIGNALING_SECRET})
                print("[Livestream] Registered with signaling server, waiting for viewer...")

                while True:
                    await _handle_one_viewer_session(ws, get_frame_fn)
                    # loop back and wait for the next viewer session on the same ws

        except (websockets.ConnectionClosed, OSError) as e:
            print(f"[Livestream] Signaling connection lost ({e}), retrying in 5s...")
            await asyncio.sleep(5)
        except Exception as e:
            print(f"[Livestream] Unexpected error: {e}, retrying in 5s...")
            await asyncio.sleep(5)
