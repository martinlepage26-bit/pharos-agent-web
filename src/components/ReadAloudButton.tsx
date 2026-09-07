"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Reads a brief (or raw text) aloud in Agent PHAROS's cloned voice.
 * Synthesis is fully local (F5-TTS on this machine). Long texts are
 * synthesized as a background job — the button polls until the audio
 * is ready, then plays it in the browser. Pass briefId for full briefs;
 * the server strips markdown and caps length.
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
      const { jobId } = (await res.json()) as { jobId?: string };
      if (!jobId) throw new Error("no job id from voice engine");

      // Poll until the local engine finishes (long briefs take minutes).
      const deadline = Date.now() + 7 * 60 * 1000;
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
      }
      if (!audioRes) throw new Error("synthesis timed out");

      const blob = await audioRes.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => setStatus("idle");
      audioRef.current = audio;
      setStatus("playing");
      await audio.play();
    } catch (err) {
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
          ? "READING…"
          : status === "playing"
            ? "STOP"
            : label}
      </button>{" "}
      {error ? <span className="badge fail">VOICE ERROR: {error}</span> : null}
    </span>
  );
}
