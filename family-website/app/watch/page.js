"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export default function WatchPage() {
  const router = useRouter();
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const wsRef = useRef(null);

  const [piOnline, setPiOnline] = useState(false);
  const [connectionState, setConnectionState] = useState("connecting"); // connecting | waiting | live | failed

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const tokenRes = await fetch("/api/signaling-token");
      if (!tokenRes.ok) {
        // Session invalid/expired - bounce back to login.
        router.push("/login");
        return;
      }
      const { secret, signalingUrl } = await tokenRes.json();
      if (cancelled) return;

      const ws = new WebSocket(signalingUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "register", role: "viewer", secret }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === "pi-status") {
          setPiOnline(msg.online);
          setConnectionState(msg.online ? "connecting" : "waiting");
          if (msg.online) {
            await startCall(ws);
          }
        } else if (msg.type === "answer") {
          const pc = pcRef.current;
          if (pc) {
            await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
          }
        } else if (msg.type === "ice-candidate") {
          const pc = pcRef.current;
          if (pc && msg.candidate) {
            try {
              await pc.addIceCandidate(msg.candidate);
            } catch (err) {
              console.warn("Failed to add ICE candidate", err);
            }
          }
        }
      };

      ws.onerror = () => setConnectionState("failed");
    }

    async function startCall(ws) {
      const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
      pcRef.current = pc;

      // We only receive video, we never send any back.
      pc.addTransceiver("video", { direction: "recvonly" });

      pc.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
          // autoPlay alone doesn't reliably start playback when the stream
          // arrives after the <video> element has already mounted (as it
          // does here) - some browsers need an explicit play() call.
          videoRef.current.play().catch((err) => {
            console.warn("Autoplay was blocked, trying muted playback:", err);
            videoRef.current.muted = true;
            videoRef.current.play().catch((err2) => {
              console.error("Playback still failed even muted:", err2);
            });
          });
        }
        setConnectionState("live");
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate }));
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setConnectionState("failed");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
    }

    start();

    return () => {
      cancelled = true;
      if (pcRef.current) pcRef.current.close();
      if (wsRef.current) wsRef.current.close();
    };
  }, [router]);

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  const statusText = {
    connecting: "Connecting...",
    waiting: "Waiting for the device to come online",
    live: "Live",
    failed: "Connection lost — retrying may help, try refreshing",
  }[connectionState];

  return (
    <div className="watch-page">
      <div className="watch-header">
        <span className="brand">Drishti</span>
        <button className="logout-link" onClick={handleLogout}>
          Log out
        </button>
      </div>

      <div className="status-row">
        <span className={`status-dot ${connectionState === "live" ? "online" : ""}`} />
        <span>{statusText}</span>
      </div>

      <div className="video-frame">
        {connectionState === "live" ? (
          <video ref={videoRef} autoPlay playsInline muted={false} />
        ) : (
          <p className="placeholder-text">
            {connectionState === "waiting"
              ? "The device isn't connected right now. This page will connect automatically as soon as it is."
              : connectionState === "failed"
              ? "Something interrupted the connection. Refresh this page to try again."
              : "Setting up the connection..."}
          </p>
        )}
      </div>
    </div>
  );
}