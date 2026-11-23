"use client";

import { useEffect, useState } from "react";

const SPEAKING_THRESHOLD = 0.045;

/**
 * Monitors the audio track of a MediaStream via Web Audio API and reports
 * whether the participant is currently speaking.
 */
export function useActiveSpeaker(stream: MediaStream | null, enabled: boolean) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    if (!stream || !enabled || stream.getAudioTracks().length === 0) {
      setIsSpeaking(false);
      setAudioLevel(0);
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let cancelled = false;
    let rafId = 0;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    try {
      ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;

      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);

      const sample = () => {
        if (cancelled) return;
        analyser.getByteTimeDomainData(data);

        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) {
          const normalized = (data[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        setAudioLevel(Math.min(1, rms * 4));
        setIsSpeaking(rms > SPEAKING_THRESHOLD);

        rafId = window.requestAnimationFrame(sample);
      };

      rafId = window.requestAnimationFrame(sample);
    } catch {
      setIsSpeaking(false);
      setAudioLevel(0);
    }

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      try {
        source?.disconnect();
        void ctx?.close();
      } catch {
        // Ignore cleanup errors on already-closed AudioContext
      }
    };
  }, [stream, enabled]);

  return { isSpeaking, audioLevel };
}
