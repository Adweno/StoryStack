import { ChevronUp, Gauge, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Book } from "../types";
import { ApiClient } from "../lib/ApiClient";
import { OfflineBookCache } from "../lib/OfflineBookCache";
import { BookCover } from "./BookCover";

export interface PlaybackRequest {
  book: Book;
  mode: "play" | "sample";
  requestId: number;
  startSeconds?: number;
}

export function PlayerBar({
  playback,
  api,
  onProgressUpdate
}: {
  playback?: PlaybackRequest;
  api: ApiClient;
  onProgressUpdate?: (bookId: string, positionSeconds: number, durationSeconds?: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedSecondRef = useRef<number>(-1);
  const [playing, setPlaying] = useState(false);
  const [audioSource, setAudioSource] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const book = playback?.book;
  const sampleStartSeconds = 180;
  const sampleDurationSeconds = 30;
  const visibleDuration = playback?.mode === "sample" ? sampleDurationSeconds : duration;
  const visibleCurrentTime = playback?.mode === "sample" ? Math.max(0, currentTime - sampleStartSeconds) : currentTime;
  const progressValue = visibleDuration > 0 ? Math.min(visibleDuration, visibleCurrentTime) : 0;
  const progressPercent = visibleDuration > 0 ? Math.round((progressValue / visibleDuration) * 100) : 0;
  const timeLeft = Math.max(0, visibleDuration - progressValue);

  const persistProgress = (positionSeconds: number, durationSeconds?: number, options: { force?: boolean } = {}) => {
    if (!book || playback?.mode !== "play" || !Number.isFinite(positionSeconds) || positionSeconds <= 0) {
      return;
    }

    const currentSecond = Math.floor(positionSeconds);
    if (!options.force && currentSecond - lastSavedSecondRef.current < 5) {
      return;
    }

    lastSavedSecondRef.current = currentSecond;
    onProgressUpdate?.(book.id, positionSeconds, durationSeconds);
    void api.saveProgress(book.id, positionSeconds, durationSeconds).catch(() => {
      // The local progress bar still updates; the next save attempt can retry the server.
    });
  };

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    lastSavedSecondRef.current = -1;
  }, [playback?.requestId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate, audioSource]);

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
      } else if (playback.startSeconds && playback.startSeconds > 0) {
        audio.currentTime = Math.min(playback.startSeconds, Math.max(0, (audio.duration || playback.startSeconds) - 1));
      }
      audio.playbackRate = playbackRate;
      setDuration(audio.duration || 0);
      setCurrentTime(audio.currentTime || 0);
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

  useEffect(() => {
    const saveCurrentPosition = () => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      persistProgress(audio.currentTime, audio.duration || undefined, { force: true });
    };

    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        saveCurrentPosition();
      }
    };

    window.addEventListener("beforeunload", saveCurrentPosition);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      saveCurrentPosition();
      window.removeEventListener("beforeunload", saveCurrentPosition);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [book?.id, playback?.mode, audioSource]);

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

  const seekTo = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !playback) {
      return;
    }
    const nextTime = playback.mode === "sample" ? sampleStartSeconds + value : value;
    audio.currentTime = Math.max(0, Math.min(duration || nextTime, nextTime));
    setCurrentTime(audio.currentTime);
  };

  const skipBy = (seconds: number) => {
    const nextTime = playback?.mode === "sample" ? visibleCurrentTime + seconds : currentTime + seconds;
    seekTo(Math.max(0, Math.min(visibleDuration || nextTime, nextTime)));
  };

  const cyclePlaybackRate = () => {
    const rates = [0.8, 1, 1.25, 1.5, 1.75, 2];
    const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length] ?? 1;
    setPlaybackRate(nextRate);
  };

  if (!book) {
    return null;
  }

  const renderProgressControl = () => (
    <div className="player-progress">
      <span>{formatTime(progressValue)}</span>
      <input
        aria-label="Playback position"
        max={Math.max(1, visibleDuration)}
        min={0}
        onChange={(event) => seekTo(Number(event.target.value))}
        step={1}
        type="range"
        value={Math.min(progressValue, Math.max(1, visibleDuration))}
      />
      <span>{formatTime(visibleDuration)}</span>
    </div>
  );

  const renderProgressStats = () => (
    <div className="player-progress-stats" aria-label="Playback progress details">
      <span>
        <strong>{progressPercent}%</strong>
        complete
      </span>
      <span>
        <strong>{formatTime(timeLeft)}</strong>
        left
      </span>
    </div>
  );

  return (
    <>
      {expanded && (
        <section className="now-playing-panel" aria-label="Now playing">
          <button className="detail-back-button now-playing-close" onClick={() => setExpanded(false)} title="Close now playing">
            <X size={19} />
          </button>
          <div className="now-playing-art">
            <BookCover book={book} />
          </div>
          <div className="now-playing-panel-copy">
            <span>{playback.mode === "sample" ? "Sample" : "Now Playing"}</span>
            <h2>{book.title}</h2>
            <p>{book.author}</p>
            {book.series && (
              <small>
                {book.series}
                {book.seriesOrder ? ` #${book.seriesOrder}` : ""}
              </small>
            )}
          </div>
          {renderProgressControl()}
          {renderProgressStats()}
          <div className="player-controls expanded-controls">
            <button className="icon-button" onClick={() => skipBy(-15)} title="Back 15 seconds">
              <RotateCcw size={18} />
            </button>
            <button className="player-play-button" onClick={togglePlayback} title={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button className="icon-button" onClick={() => skipBy(15)} title="Forward 15 seconds">
              <RotateCw size={18} />
            </button>
            <button className="command-button player-speed-button" onClick={cyclePlaybackRate} title="Playback speed">
              <Gauge size={16} />
              {playbackRate}x
            </button>
          </div>
        </section>
      )}
      {!expanded && (
        <div className="player-bar">
          <button className="player-cover-button" onClick={() => setExpanded(true)} aria-label="Open now playing">
            <BookCover book={book} />
          </button>
          <button className="icon-button" onClick={() => skipBy(-15)} title="Back 15 seconds">
            <RotateCcw size={16} />
          </button>
          <button className="icon-button primary" onClick={togglePlayback} title={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="icon-button" onClick={() => skipBy(15)} title="Forward 15 seconds">
            <RotateCw size={16} />
          </button>
          <button className="now-playing" onClick={() => setExpanded(true)} aria-label="Open now playing">
            <strong>{book.title}</strong>
            <span>{playback.mode === "sample" ? "Sample" : book.author}</span>
          </button>
          {renderProgressControl()}
          <button className="command-button player-speed-button" onClick={cyclePlaybackRate} title="Playback speed">
            {playbackRate}x
          </button>
          <button className="icon-button player-expand-button" onClick={() => setExpanded(true)} title="Open now playing">
            <ChevronUp size={18} />
          </button>
        </div>
      )}
      <audio
        ref={audioRef}
        src={audioSource}
        onEnded={(event) => {
          persistProgress(event.currentTarget.currentTime, event.currentTarget.duration || undefined, { force: true });
          setPlaying(false);
        }}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          setCurrentTime(event.currentTarget.currentTime || 0);
        }}
        onPause={(event) => {
          persistProgress(event.currentTarget.currentTime, event.currentTarget.duration || undefined, { force: true });
          setPlaying(false);
        }}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          setCurrentTime(audio.currentTime);
          setDuration(audio.duration || 0);
          if (playback.mode === "sample" && audio.currentTime >= sampleStartSeconds + sampleDurationSeconds) {
            audio.pause();
            setPlaying(false);
            return;
          }
          persistProgress(audio.currentTime, audio.duration || undefined);
        }}
      />
    </>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
