import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Book } from "../types";
import { ApiClient } from "../lib/ApiClient";
import { OfflineBookCache } from "../lib/OfflineBookCache";

export interface PlaybackRequest {
  book: Book;
  mode: "play" | "sample";
  requestId: number;
}

export function PlayerBar({ playback, api }: { playback?: PlaybackRequest; api: ApiClient }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioSource, setAudioSource] = useState("");
  const book = playback?.book;
  const sampleStartSeconds = 180;
  const sampleDurationSeconds = 30;

  useEffect(() => {
    setPlaying(false);
  }, [playback?.requestId]);

  useEffect(() => {
    if (!book) {
      setAudioSource("");
      return;
    }
    let active = true;
    let revoke: (() => void) | undefined;
    void new OfflineBookCache()
      .audioSource(book.id)
      .then((source) => {
        if (!active) {
          source.revoke?.();
          return;
        }
        revoke = source.revoke;
        setAudioSource(source.url);
      })
      .catch(() => {
        if (active) {
          setAudioSource(`/media/books/${book.id}/audio`);
        }
      });
    return () => {
      active = false;
      revoke?.();
    };
  }, [book?.id, playback?.requestId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playback || !audioSource) {
      return;
    }

    const startPlayback = async () => {
      if (playback.mode === "sample") {
        const fallbackStart = Math.max(0, (audio.duration || sampleStartSeconds + sampleDurationSeconds) - sampleDurationSeconds);
        audio.currentTime = Math.min(sampleStartSeconds, fallbackStart);
      }
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    };

    audio.addEventListener("loadedmetadata", startPlayback, { once: true });
    audio.load();
    return () => audio.removeEventListener("loadedmetadata", startPlayback);
  }, [audioSource, playback?.requestId]);

  if (!book) {
    return <div className="player-bar muted-player">Choose a book to start listening.</div>;
  }

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="player-bar">
      <button className="icon-button primary" onClick={togglePlayback} title={playing ? "Pause" : "Play"}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="now-playing">
        <strong>{book.title}</strong>
        <span>{playback.mode === "sample" ? "Sample" : book.author}</span>
      </div>
      <audio
        ref={audioRef}
        controls
        src={audioSource}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          if (playback.mode === "sample" && audio.currentTime >= sampleStartSeconds + sampleDurationSeconds) {
            audio.pause();
            setPlaying(false);
            return;
          }
          if (playback.mode === "play" && Math.floor(audio.currentTime) % 15 === 0) {
            void api.saveProgress(book.id, audio.currentTime, audio.duration || undefined);
          }
        }}
      />
    </div>
  );
}
