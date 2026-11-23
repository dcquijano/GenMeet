"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface MediaDeviceLists {
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
}

export interface MediaDevicesState {
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  devices: MediaDeviceLists;
  selectedAudioInputId: string;
  selectedAudioOutputId: string;
  selectedVideoInputId: string;
  mediaError: string | null;
  isInitializing: boolean;
  toggleAudio: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  startScreenShare: () => Promise<MediaStream | null>;
  stopScreenShare: () => void;
  selectAudioInput: (deviceId: string) => Promise<void>;
  selectAudioOutput: (deviceId: string) => void;
  selectVideoInput: (deviceId: string) => Promise<void>;
  stopAllMedia: () => void;
}

export function useMediaDevices(): MediaDevicesState {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceLists>({
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
  });
  const [selectedAudioInputId, setSelectedAudioInputId] = useState("");
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState("");
  const [selectedVideoInputId, setSelectedVideoInputId] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const refreshDeviceList = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = all.filter((d) => d.kind === "audioinput");
      const audioOutputs = all.filter((d) => d.kind === "audiooutput");
      const videoInputs = all.filter((d) => d.kind === "videoinput");
      setDevices({ audioInputs, audioOutputs, videoInputs });

      setSelectedAudioInputId((prev) => prev || audioInputs[0]?.deviceId || "");
      setSelectedAudioOutputId((prev) => prev || audioOutputs[0]?.deviceId || "");
      setSelectedVideoInputId((prev) => prev || videoInputs[0]?.deviceId || "");
    } catch {
      // Ignore enumeration errors on restricted environments
    }
  }, []);

  const stopStreamTracks = (stream: MediaStream | null) => {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  useEffect(() => {
    let active = true;

    async function initMedia() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (active) {
          setAudioEnabled(false);
          setVideoEnabled(false);
          setMediaError("Camera and microphone APIs require HTTPS or localhost.");
          setIsInitializing(false);
        }
        return;
      }

      try {
        // Attempt both audio and video first; fall back gracefully if one device is missing.
        let stream: MediaStream | null = null;
        let gotAudio = false;
        let gotVideo = false;

        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          gotAudio = stream.getAudioTracks().length > 0;
          gotVideo = stream.getVideoTracks().length > 0;
        } catch {
          // Try audio-only fallback
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            gotAudio = stream.getAudioTracks().length > 0;
          } catch {
            // Try video-only fallback
            try {
              stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
              gotVideo = stream.getVideoTracks().length > 0;
            } catch (err) {
              if (active) {
                const msg =
                  err instanceof Error && err.name === "NotAllowedError"
                    ? "Camera and microphone permissions were denied. You can still join in listen-only mode."
                    : "No camera or microphone detected. You can still join and use chat or screen share.";
                setMediaError(msg);
              }
            }
          }
        }

        if (!active) {
          stopStreamTracks(stream);
          return;
        }

        cameraStreamRef.current = stream;
        setCameraStream(stream);
        setAudioEnabled(gotAudio);
        setVideoEnabled(gotVideo);

        if (stream) {
          const audioTrack = stream.getAudioTracks()[0];
          const videoTrack = stream.getVideoTracks()[0];
          const audioId = audioTrack?.getSettings().deviceId;
          const videoId = videoTrack?.getSettings().deviceId;
          if (audioId) setSelectedAudioInputId(audioId);
          if (videoId) setSelectedVideoInputId(videoId);
        }

        await refreshDeviceList();
      } finally {
        if (active) setIsInitializing(false);
      }
    }

    void initMedia();

    const handleDeviceChange = () => {
      void refreshDeviceList();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);

    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
      stopStreamTracks(cameraStreamRef.current);
      stopStreamTracks(screenStreamRef.current);
      cameraStreamRef.current = null;
      screenStreamRef.current = null;
    };
  }, [refreshDeviceList]);

  const toggleAudio = useCallback(async () => {
    const stream = cameraStreamRef.current;
    const existingTrack = stream?.getAudioTracks()[0];

    if (existingTrack) {
      const next = !existingTrack.enabled;
      existingTrack.enabled = next;
      setAudioEnabled(next);
      return;
    }

    // Attempt to acquire an audio track if none exists yet
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const audioOnly = await navigator.mediaDevices.getUserMedia({
        audio: selectedAudioInputId ? { deviceId: { exact: selectedAudioInputId } } : true,
      });
      const newTrack = audioOnly.getAudioTracks()[0];
      if (!newTrack) return;

      const updated = stream ? new MediaStream([...stream.getTracks(), newTrack]) : audioOnly;
      cameraStreamRef.current = updated;
      setCameraStream(updated);
      setAudioEnabled(true);
      setMediaError(null);
      await refreshDeviceList();
    } catch {
      setMediaError("Could not access microphone. Check browser permissions.");
    }
  }, [refreshDeviceList, selectedAudioInputId]);

  const toggleVideo = useCallback(async () => {
    const stream = cameraStreamRef.current;
    const existingTrack = stream?.getVideoTracks()[0];

    if (existingTrack) {
      const next = !existingTrack.enabled;
      existingTrack.enabled = next;
      setVideoEnabled(next);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const videoOnly = await navigator.mediaDevices.getUserMedia({
        video: selectedVideoInputId ? { deviceId: { exact: selectedVideoInputId } } : true,
      });
      const newTrack = videoOnly.getVideoTracks()[0];
      if (!newTrack) return;

      const updated = stream ? new MediaStream([...stream.getTracks(), newTrack]) : videoOnly;
      cameraStreamRef.current = updated;
      setCameraStream(updated);
      setVideoEnabled(true);
      setMediaError(null);
      await refreshDeviceList();
    } catch {
      setMediaError("Could not access camera. Check browser permissions.");
    }
  }, [refreshDeviceList, selectedVideoInputId]);

  const stopScreenShare = useCallback(() => {
    stopStreamTracks(screenStreamRef.current);
    screenStreamRef.current = null;
    setScreenStream(null);
  }, []);

  const startScreenShare = useCallback(async (): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError("Screen sharing is not supported in this browser.");
      return null;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      stopStreamTracks(screenStreamRef.current);
      screenStreamRef.current = displayStream;
      setScreenStream(displayStream);

      const videoTrack = displayStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          screenStreamRef.current = null;
          setScreenStream(null);
        };
      }
      setMediaError(null);
      return displayStream;
    } catch {
      return null;
    }
  }, []);

  const selectAudioInput = useCallback(
    async (deviceId: string) => {
      setSelectedAudioInputId(deviceId);
      if (!navigator.mediaDevices?.getUserMedia) return;
      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId } },
        });
        const nextTrack = nextStream.getAudioTracks()[0];
        if (!nextTrack) return;
        nextTrack.enabled = audioEnabled;

        const current = cameraStreamRef.current;
        if (current) {
          for (const old of current.getAudioTracks()) {
            old.stop();
          }
          const combined = new MediaStream([...current.getVideoTracks(), nextTrack]);
          cameraStreamRef.current = combined;
          setCameraStream(combined);
        } else {
          cameraStreamRef.current = nextStream;
          setCameraStream(nextStream);
        }
      } catch {
        setMediaError("Failed to switch microphone.");
      }
    },
    [audioEnabled]
  );

  const selectVideoInput = useCallback(
    async (deviceId: string) => {
      setSelectedVideoInputId(deviceId);
      if (!navigator.mediaDevices?.getUserMedia) return;
      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
        });
        const nextTrack = nextStream.getVideoTracks()[0];
        if (!nextTrack) return;
        nextTrack.enabled = videoEnabled;

        const current = cameraStreamRef.current;
        if (current) {
          for (const old of current.getVideoTracks()) {
            old.stop();
          }
          const combined = new MediaStream([...current.getAudioTracks(), nextTrack]);
          cameraStreamRef.current = combined;
          setCameraStream(combined);
        } else {
          cameraStreamRef.current = nextStream;
          setCameraStream(nextStream);
        }
      } catch {
        setMediaError("Failed to switch camera.");
      }
    },
    [videoEnabled]
  );

  const selectAudioOutput = useCallback((deviceId: string) => {
    setSelectedAudioOutputId(deviceId);
  }, []);

  const stopAllMedia = useCallback(() => {
    stopStreamTracks(cameraStreamRef.current);
    stopStreamTracks(screenStreamRef.current);
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    setCameraStream(null);
    setScreenStream(null);
  }, []);

  return {
    cameraStream,
    screenStream,
    audioEnabled,
    videoEnabled,
    screenSharing: Boolean(screenStream),
    devices,
    selectedAudioInputId,
    selectedAudioOutputId,
    selectedVideoInputId,
    mediaError,
    isInitializing,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    selectAudioInput,
    selectAudioOutput,
    selectVideoInput,
    stopAllMedia,
  };
}
