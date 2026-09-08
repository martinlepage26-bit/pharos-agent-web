"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Reads a brief (or raw text) aloud in ECHO.
 *
 * The engine is slow enough that waiting for a whole passage is not
 * usable, so the server splits text into sentence-sized chunks and
 * renders them in order. This plays chunk one as soon as it exists and
 * keeps fetching the rest while it speaks — first sound in seconds
 * rather than minutes. A chunk already rendered replays from cache.
 */
type Chunk = { id: string; chars: number };

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
  const cancelledRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  /** Wait for one chunk's audio, tolerating the 202 it returns while rendering. */
  const fetchClip = useCallback(async (id: string, budgetMs: number): Promise<Blob> => {
    const deadline = Date.now() + budgetMs;
    // First attempt is immediate: a cached chunk should not cost a poll.
    for (let first = true; Date.now() < deadline; first = false) {
      if (!first) await new Promise((r) => setTimeout(r, 2000));
      if (cancelledRef.current) throw new Error("cancelled");
      const res = await fetch(`/api/speak?clip=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (res.ok) return res.blob();
      if (res.status !== 202) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || d.error || `chunk failed (${res.status})`);
      }
    }
    throw new Error("ECHO did not finish this passage in time — try again to resume from cache");
  }, []);

  const play = useCallback((blob: Blob) => {
    return new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("playback failed"));
      };
      void audio.play().catch(reject);
    });
  }, []);

  const onClick = useCallback(async () => {
    if (status === "loading" || status === "playing") {
      cancelledRef.current = true;
      audioRef.current?.pause();
      setStatus("idle");
      setProgress(null);
      return;
    }

    cancelledRef.current = false;
    setStatus("loading");
    setError(null);

    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(briefId ? { briefId } : { text }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || `request failed (${res.status})`);
      }
      const { chunks = [], estimatedSeconds = 0 } = (await res.json()) as {
        chunks?: Chunk[];
        estimatedSeconds?: number;
      };
      if (!chunks.length) throw new Error("nothing to say");

      // Budget per chunk, generous: the estimate is a linear model of a
      // noisy engine, and timing out on a nearly-finished chunk throws
      // away the render.
      const perChunkMs = Math.max(120_000, (estimatedSeconds * 1000 * 3) / chunks.length);

      // Fetch one chunk ahead of the one being spoken, so the next is
      // usually in hand by the time the current finishes.
      let ahead: Promise<Blob> | null = fetchClip(chunks[0].id, perChunkMs);
      for (let i = 0; i < chunks.length; i++) {
        if (cancelledRef.current) return;
        setProgress(`${i + 1}/${chunks.length}`);
        const current = ahead!;
        ahead = i + 1 < chunks.length ? fetchClip(chunks[i + 1].id, perChunkMs) : null;

        const blob = await current;
        if (cancelledRef.current) return;
        setStatus("playing");
        await play(blob);
      }

      setProgress(null);
      setStatus("idle");
    } catch (err) {
      if (cancelledRef.current) return;
      setProgress(null);
      setStatus("error");
      setError(err instanceof Error ? err.message : "playback failed");
    }
  }, [briefId, text, status, fetchClip, play]);

  return (
    <span>
      <button
        type="button"
        className="badge ok"
        onClick={onClick}
        style={{ cursor: "pointer" }}
      >
        {status === "loading"
          ? progress
            ? `ECHO ${progress}…`
            : "ECHO…"
          : status === "playing"
            ? `STOP ${progress ?? ""}`.trim()
            : label}
      </button>{" "}
      {error ? <span className="badge fail">VOICE ERROR: {error}</span> : null}
    </span>
  );
}
