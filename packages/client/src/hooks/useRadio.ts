import { useState, useRef, useEffect, useCallback } from 'react';
import { SK_RADIO_ON, SK_RADIO_VOLUME } from '@/lib/storage-keys';

const STREAM_URL = 'https://streams.ilovemusic.de/iloveradio17.mp3';

export interface UseRadioReturn {
  on: boolean;
  volume: number;
  toggle: () => void;
  setVolume: (v: number) => void;
}

/**
 * Owns the audio element and playback state for the retro internet radio.
 * Lives at the App root so it survives route / project switches.
 * Persists on/volume to localStorage so the radio survives page refreshes.
 */
export function useRadio(): UseRadioReturn {
  const [on, setOn] = useState(() => localStorage.getItem(SK_RADIO_ON) === 'true');
  const [volume, setVolume] = useState(() => {
    const stored = localStorage.getItem(SK_RADIO_VOLUME);
    return stored !== null ? parseFloat(stored) : 0.35;
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onRef = useRef(on);

  // Keep ref in sync
  useEffect(() => { onRef.current = on; }, [on]);

  // Persist to localStorage
  useEffect(() => { localStorage.setItem(SK_RADIO_ON, String(on)); }, [on]);
  useEffect(() => { localStorage.setItem(SK_RADIO_VOLUME, String(volume)); }, [volume]);

  // Create audio element once; auto-play if previously on
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = volume;
    audioRef.current = audio;

    // Restore playback if radio was on
    if (onRef.current) {
      audio.src = STREAM_URL;
      audio.play().catch(() => {});
    }

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (onRef.current) {
      audio.pause();
      audio.src = '';
      setOn(false);
    } else {
      audio.src = STREAM_URL;
      audio.play().catch(() => {});
      setOn(true);
    }
  }, []);

  return { on, volume, toggle, setVolume };
}
