# Drishti Family Livestream — Full Setup

Three separate pieces, all free to run:

| Piece | What it does | Where it runs |
|---|---|---|
| `signaling-server/` | Introduces the Pi and the family viewer, relays WebRTC handshake only | Render (free tier) |
| `family-website/` | Login page + live video viewer for family members | Vercel (free tier) |
| `pi-streaming/` | Reads the shared camera frame, streams it out | Your Pi 3B, alongside `drishti.py` |

Video itself never passes through the signaling server or either hosting
platform - once connected, it flows directly between the Pi and the family
member's browser.

## Before you start: pick one shared secret

Generate one long random string (e.g. `openssl rand -hex 32` on any
machine, or just mash the keyboard for 40+ characters). This exact same
value goes into **three places**: Render's `SIGNALING_SECRET`, Vercel's
`SIGNALING_SECRET`, and the Pi's `.env` `SIGNALING_SECRET`. This is what
stops a random stranger from connecting as either the Pi or the viewer.

## 1. Deploy the signaling server to Render

1. Push `signaling-server/` to its own GitHub repo (or a subfolder of one)
2. In Render: New → Web Service → connect that repo
3. Runtime: Node
4. Build command: `npm install`
5. Start command: `npm start`
6. Add environment variable: `SIGNALING_SECRET` = your shared secret
7. Deploy. Note the resulting URL, e.g. `drishti-signaling.onrender.com`
   - Your actual WebSocket URL for later steps is `wss://drishti-signaling.onrender.com` (note `wss://`, not `https://`)

## 2. Deploy the family website to Vercel

1. Push `family-website/` to its own GitHub repo (or subfolder)
2. In Vercel: New Project → import that repo
3. Framework preset: Next.js (auto-detected)
4. Add environment variables (Project Settings → Environment Variables):
   - `FAMILY_PASSWORD` = whatever password family members will type in
   - `SIGNALING_SECRET` = the same shared secret from step 1
   - `NEXT_PUBLIC_SIGNALING_URL` = the `wss://...onrender.com` URL from step 1
5. Deploy. Family members will use the resulting `https://...vercel.app` URL

## 3. Set up the Pi

1. Copy `pi-streaming/webrtc_stream.py` into `~/drishti_vision/` (same folder as `drishti.py`)
2. Follow `pi-streaming/INTEGRATION.txt` exactly - it's a small, clearly-marked addition to your existing `drishti.py`, not a rewrite
3. Add to your existing `.env` on the Pi:
   ```
   SIGNALING_URL=wss://drishti-signaling.onrender.com
   SIGNALING_SECRET=the_same_shared_secret
   STREAM_FPS=8
   ```
4. Install the extra packages: `pip install -r pi-streaming/requirements_livestream.txt`
   (see `INTEGRATION.txt` for the `apt install` line if this fails to build)
5. Run `drishti.py` as usual

## Testing order (don't skip this)

1. Confirm the signaling server is up: visit `https://drishti-signaling.onrender.com/` in a browser - you should see `{"status":"ok","piConnected":false,"viewerConnected":false}`
2. Start `drishti.py` on the Pi - check its console for `[Livestream] Registered with signaling server, waiting for viewer...`
3. Refresh the signaling server's status URL - `piConnected` should now say `true`
4. Open the Vercel website, log in, and go to `/watch` - video should appear within a few seconds
5. **Then**, and only then, test asking Gemini a question while the stream is running, to confirm both work together without issue

## If it doesn't work well enough to keep

Per your plan: just stop calling `start_webrtc_streaming()` in `drishti.py`
(delete or comment out that one line from step 3 above). Everything else -
Gemini, STT, TTS, wake-word, all of it - is completely unaffected, since
none of that code was touched to add this.

## Known limitations, stated honestly

- **CPU load**: software video encoding is genuinely demanding on Pi 3B-class
  hardware (confirmed by other real-world aiortc-based projects tested on
  this exact board). `STREAM_FPS=8` keeps this as light as reasonably
  possible; lower it further if things feel strained once tested for real.
- **NAT traversal isn't 100% guaranteed**: video connects directly between
  Pi and viewer using free public STUN servers, which works for most home
  routers but isn't universal. If it fails to connect on your specific
  network, that's the likely cause.
- **Render free tier** spins down after 15 minutes fully idle. Since the Pi
  holds a persistent connection whenever `drishti.py` is running, this
  should rarely if ever come into play in practice.
