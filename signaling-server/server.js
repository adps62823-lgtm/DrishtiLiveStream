/**
 * Drishti signaling server - deploy to Render (free tier).
 *
 * This ONLY relays WebRTC handshake messages (SDP offers/answers, ICE
 * candidates) between the Pi and one family viewer. Actual video never
 * passes through this server - once connected, it flows directly between
 * the Pi and the browser.
 *
 * Only one Pi and one viewer are supported at a time, matching the
 * single-viewer use case this was built for.
 */

const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");

const PORT = process.env.PORT || 10000;
const SIGNALING_SECRET = process.env.SIGNALING_SECRET;

if (!SIGNALING_SECRET) {
  console.error("FATAL: SIGNALING_SECRET environment variable not set.");
  process.exit(1);
}

const app = express();

// Health check endpoint - also handy for keeping the free Render service
// from spinning down if you ever want to ping it externally.
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    piConnected: !!piSocket,
    viewerConnected: !!viewerSocket,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let piSocket = null;
let viewerSocket = null;

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on("connection", (ws) => {
  let role = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed messages
    }

    // --- Registration ---
    if (msg.type === "register") {
      if (msg.secret !== SIGNALING_SECRET) {
        send(ws, { type: "error", message: "Invalid secret" });
        ws.close();
        return;
      }

      if (msg.role === "pi") {
        piSocket = ws;
        role = "pi";
        console.log("Pi registered.");
        send(viewerSocket, { type: "pi-status", online: true });
      } else if (msg.role === "viewer") {
        viewerSocket = ws;
        role = "viewer";
        console.log("Viewer registered.");
        send(ws, { type: "pi-status", online: !!piSocket });
      }
      return;
    }

    // --- Relay everything else to the other party ---
    if (role === "pi" && viewerSocket) {
      send(viewerSocket, msg);
    } else if (role === "viewer" && piSocket) {
      send(piSocket, msg);
    }
  });

  ws.on("close", () => {
    if (role === "pi") {
      piSocket = null;
      console.log("Pi disconnected.");
      send(viewerSocket, { type: "pi-status", online: false });
    } else if (role === "viewer") {
      viewerSocket = null;
      console.log("Viewer disconnected.");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
