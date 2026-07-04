"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Inbox, InboxNote } from "@/lib/types";
import { ageLabel } from "@/lib/types";

const MAX_REC_SECONDS = 120;

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

function localNote(note: string, source: string): InboxNote {
  return {
    id: -Date.now(),
    note,
    source,
    status: "new",
    filed_to: "",
    ts: new Date().toISOString(),
    audio: "",
  };
}

export function NotesCard({ initial, now }: { initial: Inbox | null; now: number }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<InboxNote[]>(initial?.recent ?? []);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function sendNote() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setFlash(null);
    try {
      const res = await fetch("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) throw new Error();
      setItems((cur) => [localNote(body, "hq-typed"), ...cur].slice(0, 12));
      setText("");
      setFlash("Saved. I file it at my next touchpoint.");
    } catch {
      setFlash("Couldn't reach the backend. Note NOT saved, try again.");
    } finally {
      setSending(false);
    }
  }

  async function uploadVoice(blob: Blob) {
    setSending(true);
    setFlash(null);
    try {
      const fd = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("webm") ? "webm" : "audio";
      fd.append("audio", blob, `note.${ext}`);
      const res = await fetch("/api/voice", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      setItems((cur) => [localNote("(voice note, transcribes at next touchpoint)", "hq-voice"), ...cur].slice(0, 12));
      setFlash("Voice note saved. I transcribe and file it at my next touchpoint.");
    } catch {
      setFlash("Upload failed. Voice note NOT saved, try again.");
    } finally {
      setSending(false);
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    setRecSeconds(0);
    const mr = recRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
  }

  async function toggleRecording() {
    if (recording) {
      stopRecording();
      return;
    }
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setFlash("No mic access in this browser. Type the note, or open HQ in Safari/Chrome.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size > 0) void uploadVoice(blob);
      };
      recRef.current = mr;
      mr.start();
      setRecording(true);
      setRecSeconds(0);
      elapsedRef.current = 0;
      timerRef.current = setInterval(() => {
        // side effects live in the interval callback, never in a state updater
        elapsedRef.current += 1;
        setRecSeconds(elapsedRef.current);
        if (elapsedRef.current >= MAX_REC_SECONDS) stopRecording();
      }, 1000);
    } catch {
      setFlash("Mic permission denied or unavailable. If installed as an app, try opening in Safari.");
    }
  }

  const shown = items.slice(0, 5);

  return (
    <motion.div
      className="tile flex flex-col gap-3 p-5"
      style={{ cursor: "default" }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="kicker whitespace-nowrap">Drop a note to Alex</span>
        <span className="text-xs" style={{ color: "var(--mute)" }}>
          async inbox · read at 08:00 / 09:00 / 13:00 / 17:00 + every session
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <textarea
          className="note-input min-w-full sm:min-w-0"
          rows={2}
          placeholder="A plan, a meeting, a goal... I'll file it."
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendNote();
          }}
        />
        <button
          type="button"
          className={`btn-mic ${recording ? "rec" : ""}`}
          onClick={() => void toggleRecording()}
          aria-label={recording ? "Stop recording" : "Record a voice note"}
          aria-pressed={recording}
          disabled={sending && !recording}
        >
          {recording ? (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
              <span className="tabular-nums">{recSeconds}s</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
                <path
                  d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8.5 22h7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              <span>Voice</span>
            </>
          )}
        </button>
        <button
          type="button"
          className="btn-send"
          onClick={() => void sendNote()}
          disabled={sending || recording || !text.trim()}
        >
          {sending ? "..." : "Send"}
        </button>
      </div>

      {recording ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: "#ff8a75" }}>
          <span className="dot dot-red" />
          recording {recSeconds}s · tap the button again to stop (max {MAX_REC_SECONDS}s)
        </div>
      ) : null}

      {flash ? (
        <p role="status" aria-live="polite" className="text-sm" style={{ color: flash.includes("NOT") ? "#ff8a75" : "var(--aqua)" }}>
          {flash}
        </p>
      ) : null}

      {shown.length ? (
        <div>
          {shown.map((n) => (
            <div key={n.id} className="note-row">
              <span className={`dot ${n.status === "filed" ? "dot-green" : "dot-amber"}`} />
              <span className="min-w-0 flex-1 truncate">
                {n.note || (n.audio ? "(voice note, transcribes at next touchpoint)" : "(empty)")}
              </span>
              <span
                className="max-w-[55%] flex-none truncate text-xs tabular-nums"
                style={{ color: "var(--mute)" }}
              >
                {n.source === "hq-voice" ? "voice · " : ""}
                {n.status === "filed" ? (n.filed_to ? `filed → ${n.filed_to}` : "filed") : "waiting"} ·{" "}
                {ageLabel(n.ts, now)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}
