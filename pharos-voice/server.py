#!/usr/bin/env python3
"""
PHAROS voice server — local zero-shot voice cloning for Agent PHAROS.
F5-TTS runs entirely on this machine; the reference sample and all
generated speech stay local. Listens on 127.0.0.1:5434 only.

Synthesis of a long brief takes minutes on this hardware, so the web
app uses an async job API:

POST /tts/async  {"text": "..."} -> {"job_id": "..."}   (returns at once)
GET  /job/<id>   -> {"status":"queued"|"running"} (202)
                  | {"status":"done","audio":"<base64 wav>"} (200)
                  | {"status":"failed","error":"..."} (500)
POST /tts        {"text": "..."} -> audio/wav bytes (sync, short texts)
GET  /health     -> {"ok": true, ...}

Jobs run one at a time (model lock); results are pruned after ~30 min.
"""
import base64
import io
import json
import os
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
from f5_tts.api import F5TTS

# Resolve the reference clip relative to this file, not to a hardcoded
# absolute path: the directory was moved into pharos-agent/ and synthesis
# began failing with "No such file or directory" while the HTTP server
# stayed up, so the fault surfaced only as failed jobs.
HERE = os.path.dirname(os.path.abspath(__file__))
REF_AUDIO = os.environ.get("PHAROS_VOICE_REF") or os.path.join(HERE, "ref.wav")
REF_TEXT = "The voice should sound like someone trained to notice what others miss, part investigator, part physician. Calm under pressure, precise with uncertainty, and unwilling to confuse instinct with proof. It has the discipline of a medical report and the gravity of a crime scene, intimate, controlled, and quietly relentless."  # pre-transcribed from ref.wav (whisper-large-v3-turbo); avoids ffmpeg-dependent ASR at runtime
PORT = 5434
MAX_CHARS = 1200

print("loading F5-TTS model (first run downloads weights)…", flush=True)
tts = F5TTS()
print("model ready", flush=True)

_lock = threading.Lock()
_jobs = {}  # id -> {status, audio(b64), error, created}
_jobs_lock = threading.Lock()


def _prune_jobs():
    cutoff = time.time() - 1800
    with _jobs_lock:
        stale = [k for k, v in _jobs.items() if v.get("created", 0) < cutoff]
        for k in stale:
            del _jobs[k]


def split_text(text, limit=200):
    parts, buf = [], ""
    for sent in re.split(r"(?<=[.!?…:])\s+", text.strip()):
        if len(buf) + len(sent) + 1 <= limit:
            buf = (buf + " " + sent).strip()
        else:
            if buf:
                parts.append(buf)
            while len(sent) > limit:
                parts.append(sent[:limit])
                sent = sent[limit:]
            buf = sent
    if buf:
        parts.append(buf)
    return parts or [""]


def synthesize(text):
    chunks = split_text(text[:MAX_CHARS])
    wavs, sr0 = [], None
    for c in chunks:
        res = tts.infer(
            ref_file=REF_AUDIO,
            ref_text=REF_TEXT,
            gen_text=c,
            seed=42,
        )
        if res is None:
            raise RuntimeError("tts.infer returned no audio")
        wav, sr = res[0], res[1]
        if sr0 is None:
            sr0 = sr
        wav = np.asarray(wav, dtype=np.float32).squeeze()
        if wav.ndim > 0 and wav.size:
            wavs.append(wav)
    if not wavs:
        raise RuntimeError("empty synthesis")
    audio = np.concatenate(wavs)
    peak = float(np.max(np.abs(audio))) or 1.0
    if peak > 0.98:
        audio = audio * (0.98 / peak)
    return sr0 or 24000, audio


def _worker(job_id, text):
    try:
        with _jobs_lock:
            _jobs[job_id]["status"] = "running"
        print(f"[voice] job {job_id} start ({len(text)} chars)", flush=True)
        with _lock:
            sr, audio = synthesize(text)
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
        data = base64.b64encode(buf.getvalue()).decode()
        with _jobs_lock:
            _jobs[job_id] = {
                "status": "done", "audio": data,
                "created": _jobs[job_id].get("created", time.time()),
            }
        print(f"[voice] job {job_id} done ({len(data)} b64 chars)", flush=True)
    except Exception as e:
        print(f"[voice] job {job_id} failed: {e}", flush=True)
        with _jobs_lock:
            _jobs[job_id] = {
                "status": "failed", "error": str(e),
                "created": _jobs[job_id].get("created", time.time()),
            }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[voice] " + fmt % args, flush=True)

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, json.dumps({"ok": True, "model": "F5TTS_v1_Base"}).encode())
            return
        m = re.match(r"^/job/([a-f0-9]+)$", self.path)
        if m:
            _prune_jobs()
            job = _jobs.get(m.group(1))
            if not job:
                self._send(404, b'{"error":"unknown job"}')
                return
            status = job["status"]
            if status == "done":
                self._send(200, json.dumps({"status": "done", "audio": job["audio"]}).encode())
            elif status == "failed":
                self._send(500, json.dumps({"status": "failed", "error": job.get("error", "")}).encode())
            else:
                self._send(202, json.dumps({"status": status}).encode())
            return
        self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        if self.path not in ("/tts", "/tts/async"):
            self._send(404, b'{"error":"not found"}')
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            text = str(payload.get("text", "")).strip()
            if not text:
                self._send(400, b'{"error":"text required"}')
                return

            if self.path == "/tts/async":
                _prune_jobs()
                job_id = uuid.uuid4().hex[:12]
                with _jobs_lock:
                    _jobs[job_id] = {"status": "queued", "created": time.time()}
                threading.Thread(target=_worker, args=(job_id, text), daemon=True).start()
                self._send(200, json.dumps({"job_id": job_id}).encode())
                return

            # sync path (short texts only)
            with _lock:
                sr, audio = synthesize(text)
            buf = io.BytesIO()
            sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
            data = buf.getvalue()
            print(f"[voice] synthesized {len(text)} chars -> {len(data)} bytes", flush=True)
            self._send(200, data, "audio/wav")
        except Exception as e:
            print(f"[voice] error: {e}", flush=True)
            self._send(500, json.dumps({"error": str(e)}).encode())


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[voice] PHAROS voice server on 127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
