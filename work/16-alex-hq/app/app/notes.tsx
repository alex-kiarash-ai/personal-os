"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Inbox, InboxNote } from "@/lib/types";
import { ageLabel } from "@/lib/types";

const MAX_REC_SECONDS = 120;
const REFETCH_MS = 60_000;

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

// Optimistic local row (negative id). `pending` marks the in-flight POST (the `uploading...`
// state); once the POST resolves the row shows "saved · transcribes at next touchpoint". The
// next /api/inbox refetch returns the real server row (positive id) which replaces it as truth.
type LocalNote = InboxNote & { pending?: boolean };

function localNote(note: string, source: string, pending = false): LocalNote {
  return {
    id: -Date.now(),
    note,
    source,
    status: "new",
    filed_to: "",
    ts: new Date().toISOString(),
    audio: "",
    pending,
  };
}

const isVoice = (n: InboxNote) => n.source === "hq-voice" || !!n.audio;

function MicGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden className="flex-none">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8.5 22h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function NotesCard({ initial, now }: { initial: Inbox | null; now: number }) {
  const [text, setText] = useState("");
  // server rows are truth; local optimistic rows fill the gap until the server catches up
  const [serverItems, setServerItems] = useState<InboxNote[]>(initial?.recent ?? []);
  const [localItems, setLocalItems] = useState<LocalNote[]>([]);
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

  // Poll the inbox: on returning to the PWA (visibilitychange) and every 60s WHILE visible.
  // Fail-calm: a failed fetch keeps whatever we already show, no error spam. When the server's
  // newest row is at least as new as an optimistic local row, the server has that note now, so we
  // drop optimistic rows the server has caught up to (server is truth once it arrives).
  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Inbox;
      const rows = data?.recent;
      if (!Array.isArray(rows)) return;
      setServerItems(rows);
      const newest = rows.reduce((max, r) => Math.max(max, new Date(r.ts).getTime() || 0), 0);
      setLocalItems((cur) => cur.filter((l) => l.pending || new Date(l.ts).getTime() > newest));
    } catch {
      // keep showing what we have
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void refetch();
      timer = setInterval(() => void refetch(), REFETCH_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refetch]);

  async function sendNote() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setFlash(null);
    setLocalItems((cur) => [localNote(body, "hq-typed", true), ...cur]);
    try {
      const res = await fetch("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) throw new Error();
      // clear the pending flag: uploading... -> saved
      setLocalItems((cur) => cur.map((l) => (l.pending && l.source === "hq-typed" ? { ...l, pending: false } : l)));
      setText("");
      setFlash("Saved. I file it at my next touchpoint.");
      void refetch();
    } catch {
      // roll the optimistic row back on a failed POST
      setLocalItems((cur) => cur.filter((l) => !(l.pending && l.source === "hq-typed")));
      setFlash("Couldn't reach the backend. Note NOT saved, try again.");
    } finally {
      setSending(false);
    }
  }

  async function uploadVoice(blob: Blob) {
    setSending(true);
    setFlash(null);
    setLocalItems((cur) => [localNote("", "hq-voice", true), ...cur]);
    try {
      const fd = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("webm") ? "webm" : "audio";
      fd.append("audio", blob, `note.${ext}`);
      const res = await fetch("/api/voice", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      setLocalItems((cur) => cur.map((l) => (l.pending && l.source === "hq-voice" ? { ...l, pending: false } : l)));
      setFlash("Voice note saved. I transcribe and file it at my next touchpoint.");
      void refetch();
    } catch {
      setLocalItems((cur) => cur.filter((l) => !(l.pending && l.source === "hq-voice")));
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

  // display: optimistic local rows first (newest), then server rows (truth), capped at 5
  const shown: LocalNote[] = [...localItems, ...serverItems].slice(0, 5);

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
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--error-text-dark)" }}>
          <span className="dot dot-red" />
          recording {recSeconds}s · tap the button again to stop (max {MAX_REC_SECONDS}s)
        </div>
      ) : null}

      {flash ? (
        <p role="status" aria-live="polite" className="text-sm" style={{ color: flash.includes("NOT") ? "var(--error-text-dark)" : "var(--aqua)" }}>
          {flash}
        </p>
      ) : null}

      {shown.length ? (
        <div>
          {shown.map((n) => {
            const voice = isVoice(n);
            const filed = n.status === "filed";
            // explicit row states (design 4.8):
            //   pending  -> uploading... (spinner)
            //   voice, not filed -> saved · transcribes at next touchpoint
            //   filed -> filed → {destination}, note text backfilled by the mark step
            const stateLabel = n.pending
              ? "uploading…"
              : filed
                ? n.filed_to
                  ? `filed → ${n.filed_to}`
                  : "filed"
                : voice
                  ? "saved · transcribes next touchpoint"
                  : "waiting";
            const bodyText = n.note || (voice ? "(voice note, transcribes at next touchpoint)" : "(empty)");
            return (
              <div key={n.id} className="note-row">
                <span className={`dot ${filed ? "dot-green" : "dot-amber"}`} />
                {voice ? (
                  <span className="flex-none" style={{ color: "var(--mute)" }} aria-label="voice note">
                    <MicGlyph />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{bodyText}</span>
                <span
                  className="max-w-[55%] flex-none truncate text-xs tabular-nums"
                  style={{ color: "var(--mute)" }}
                >
                  {n.pending ? (
                    <span className="spinner" aria-hidden />
                  ) : null}
                  {stateLabel} · {ageLabel(n.ts, now)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </motion.div>
  );
}
