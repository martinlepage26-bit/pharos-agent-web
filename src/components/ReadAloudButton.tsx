"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Reads a brief (or raw text) aloud in ECHO.
 *
 * Synthesis is local Coqui XTTS-v2 via echosay, and it is slow — about
 * 0.85 seconds per character on this machine, so a capped 600-character
 * passage is roughly eight minutes. The button therefore reports elapsed
 * time against the server's estimate rather than showing an unqualified
 * spinner, and a line already rendered returns instantly from cache.
 */
export default function ReadAloudButton({
  briefId,
  text,
  label = "🔊 READ ALOUD",
}: {
  briefId?: string;
  text?: string;
  label?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (status === "loading") return;
    try {
      audioRef.current?.pause();
      if (status === "playing") {
        setStatus("idle");
        return;
      }
      setStatus("loading");
      setError(null);

      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(briefId ? { briefId } : { text }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || `request failed (${res.status})`);
      }
      const { jobId, estimatedSeconds = 0, cached = false } =
        (await res.json()) as {
          jobId?: string;
          estimatedSeconds?: number;
          cached?: boolean;
        };
      if (!jobId) throw new Error("no job id from voice engine");

      // Allow generously more than the estimate: the figure is a linear
      // model of a real engine, not a guarantee, and timing out on a clip
      // that is nearly finished wastes the whole render.
      const budgetMs = Math.max(90_000, estimatedSeconds * 1000 * 3);
      const startedAt = Date.now();
      const deadline = startedAt + budgetMs;
      if (!cached && estimatedSeconds > 0) setProgress(`0s / ~${estimatedSeconds}s`);

      let audioRes: Response | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await fetch(`/api/speak?job=${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        if (poll.ok) {
          audioRes = poll;
          break;
        }
        if (poll.status !== 202) {
          const detail = await poll.json().catch(() => ({}));
          throw new Error(detail.detail || detail.error || `synthesis failed (${poll.status})`);
        }
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        if (estimatedSeconds > 0) setProgress(`${elapsed}s / ~${estimatedSeconds}s`);
      }
      if (!audioRes) {
        throw new Error(
          `ECHO did not finish within ${Math.round(budgetMs / 60000)} minutes — it may still be rendering; try again to pick up the cached clip`
        );
      }
      setProgress(null);

      const blob = await audioRes.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => setStatus("idle");
      audioRef.current = audio;
      setStatus("playing");
      await audio.play();
    } catch (err) {
      setProgress(null);
      setStatus("error");
      setError(err instanceof Error ? err.message : "playback failed");
    }
  }, [briefId, text, status]);

  return (
    <span>
      <button
        type="button"
        className="badge ok"
        onClick={onClick}
        disabled={status === "loading"}
        style={{ cursor: "pointer" }}
      >
        {status === "loading"
          ? progress
            ? `ECHO ${progress}`
            : "READING…"
          : status === "playing"
            ? "STOP"
            : label}
      </button>{" "}
      {error ? <span className="badge fail">VOICE ERROR: {error}</span> : null}
    </span>
  );
}
