"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (res.ok) {
      router.push("/watch");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong. Try again.");
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <p className="eyebrow">Drishti — family access</p>
        <h1>See what they see</h1>
        <p className="sub">Enter the family password to watch the live view.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "Checking..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
