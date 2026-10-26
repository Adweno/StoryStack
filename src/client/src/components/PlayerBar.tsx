import { Bookmark, Cast as CastIcon, ChevronUp, Gauge, List, Pause, Play, RotateCcw, RotateCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Book, BookBookmark } from "../types";
import { ApiClient } from "../lib/ApiClient";
import { OfflineBookCache, type CachedAudioSource } from "../lib/OfflineBookCache";
import { OfflineSyncQueue } from "../lib/OfflineSyncQueue";
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
  onProgressUpdate,
  syncQueue,
  collapseSignal
}: {
  playback?: PlaybackRequest;
  api: ApiClient;
  onProgressUpdate?: (bookId: string, positionSeconds: number, durationSeconds?: number) => void;
  syncQueue: OfflineSyncQueue;
  collapseSignal: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedSecondRef = useRef<number>(-1);
  const pendingSeekRef = useRef<{ seconds: number; play: boolean } | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [audioSources, setAudioSources] = useState<CachedAudioSource[]>([]);
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [trackDurations, setTrackDurations] = useState<number[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [castAvailable, setCastAvailable] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookBookmark[]>([]);
  const [referenceTab, setReferenceTab] = useState<"chapters" | "bookmarks">("chapters");
  const book = playback?.book;
  const sampleStartSeconds = 180;
  const sampleDurationSeconds = 30;
  const declaredTrackDurations = book?.audioTracks?.map((track) => track.durationSeconds ?? 0) ?? [];
  const wholeBookDuration = playback?.mode === "sample" ? sampleDurationSeconds : book?.durationSeconds ?? sumNumbers(trackDurations) ?? duration;
  const absoluteCurrentTime = trackOffset(activeTrackIndex, trackDurations, declaredTrackDurations) + currentTime;
  const visibleDuration = wholeBookDuration;
  const visibleCurrentTime = playback?.mode === "sample" ? Math.max(0, absoluteCurrentTime - sampleStartSeconds) : absoluteCurrentTime;
  const progressValue = visibleDuration > 0 ? Math.min(visibleDuration, visibleCurrentTime) : 0;
  const progressPercent = visibleDuration > 0 ? Math.round((progressValue / visibleDuration) * 100) : 0;
  const timeLeft = Math.max(0, visibleDuration - progressValue);

  useEffect(() => {
    const checkCast = () => setCastAvailable(Boolean(window.cast?.framework?.CastContext));
    checkCast();
    const timer = window.setInterval(checkCast, 500);
    return () => window.clearInterval(timer);
  }, []);

  const castCurrentBook = async () => {
    if (!book || !window.cast?.framework || !window.chrome?.cast) return;
    const context = window.cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });
    await context.requestSession();
    const session = context.getCurrentSession();
    if (!session) return;
    const token = await api.createCastMediaToken(book.id);
    const mediaInfo = new window.chrome.cast.media.MediaInfo(token.audioUrl, "audio/mpeg");
    const metadata = new window.chrome.cast.media.GenericMediaMetadata();
    metadata.title = book.title;
    metadata.subtitle = book.author;
    mediaInfo.metadata = metadata;
    const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
    request.currentTime = Math.max(0, progressValue);
    await session.loadMedia(request);
    audioRef.current?.pause();
    setPlaying(false);
  };

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
  };

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession || !book) return;
    mediaSession.metadata = new MediaMetadata({ title: book.title, artist: book.author, album: book.series ?? "Story Stack" });
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => { void audioRef.current?.play(); }],
      ["pause", () => audioRef.current?.pause()],
      ["seekbackward", () => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15); }],
      ["seekforward", () => { if (audioRef.current) audioRef.current.currentTime += 15; }]
    ];
    actions.forEach(([action, handler]) => {
      try { mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
    });
    return () => {
      mediaSession.metadata = null;
      actions.forEach(([action]) => {
        try { mediaSession.setActionHandler(action, null); } catch { /* unsupported action */ }
      });
    };
  }, [book?.id, playback?.mode]);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioSources([]);
    setActiveTrackIndex(0);
    setTrackDurations(book?.audioTracks?.map((track) => track.durationSeconds ?? 0) ?? []);
    setReferenceTab("chapters");
    lastSavedSecondRef.current = -1;
  }, [playback?.requestId]);

  useEffect(() => {
    setExpanded(false);
  }, [collapseSignal]);

  useEffect(() => {
    if (!book || playback?.mode !== "play") {
      setBookmarks([]);
      return;
    }
    let active = true;
    void api.bookBookmarks(book.id).then((items) => { if (active) setBookmarks(items); }).catch(() => { if (active) setBookmarks([]); });
    return () => { active = false; };
  }, [api, book?.id, playback?.mode, playback?.requestId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate, activeTrackIndex]);

  useEffect(() => {
    if (!book) {
      setAudioSources([]);
      return;
    }
    let active = true;
    let revokeSources: CachedAudioSource[] = [];
    const initialStart = playback?.mode === "sample" ? sampleStartSeconds : playback?.startSeconds ?? 0;
    const initialIndex = trackIndexForPosition(initialStart, book.audioTracks?.map((track) => track.durationSeconds ?? 0) ?? []);
    pendingSeekRef.current = { seconds: trackPositionForAbsolute(initialStart, initialIndex, book.audioTracks?.map((track) => track.durationSeconds ?? 0) ?? []), play: true };
    void new OfflineBookCache()
      .audioSources(book, { sample: playback?.mode === "sample" })
      .then((sources) => {
        if (!active) {
          sources.forEach((source) => source.revoke?.());
          return;
        }
        revokeSources = sources;
        setActiveTrackIndex(initialIndex);
        setAudioSources(sources);
      })
      .catch(() => {
        if (active) {
          setActiveTrackIndex(0);
          setAudioSources([{ url: `/media/books/${book.id}/audio${playback?.mode === "sample" ? "?sample=1" : ""}` }]);
        }
      });
    return () => {
      active = false;
      revokeSources.forEach((source) => source.revoke?.());
    };
  }, [book?.id, playback?.requestId]);

  useEffect(() => {
    const audio = audioRef.current;
    const source = audioSources[activeTrackIndex];
    if (!audio || !playback || !source?.url) {
      return;
    }

    const startPlayback = async () => {
      const pendingSeek = pendingSeekRef.current;
      if (pendingSeek) {
        audio.currentTime = Math.min(pendingSeek.seconds, Math.max(0, (audio.duration || pendingSeek.seconds) - 1));
        pendingSeekRef.current = undefined;
      }
      audio.playbackRate = playbackRate;
      setDuration(audio.duration || 0);
      setCurrentTime(audio.currentTime || 0);
      try {
        if (pendingSeek?.play ?? true) {
          await audio.play();
          setPlaying(true);
        }
      } catch {
        setPlaying(false);
      }
    };

    audio.addEventListener("loadedmetadata", startPlayback, { once: true });
    audio.load();
    return () => audio.removeEventListener("loadedmetadata", startPlayback);
  }, [audioSources, activeTrackIndex, playback?.requestId]);

  useEffect(() => {
    const saveCurrentPosition = () => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      persistProgress(trackOffset(activeTrackIndex, trackDurations, declaredTrackDurations) + audio.currentTime, wholeBookDuration || undefined, { force: true });
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
  }, [book?.id, playback?.mode, activeTrackIndex, audioSources]);

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
    const trackIndex = trackIndexForPosition(nextTime, trackDurations.length ? trackDurations : declaredTrackDurations);
    const trackSeconds = trackPositionForAbsolute(nextTime, trackIndex, trackDurations.length ? trackDurations : declaredTrackDurations);
    if (trackIndex !== activeTrackIndex) {
      pendingSeekRef.current = { seconds: trackSeconds, play: playing };
      setActiveTrackIndex(trackIndex);
      return;
    }
    audio.currentTime = Math.max(0, Math.min(duration || trackSeconds, trackSeconds));
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

  const addBookmark = async () => {
    if (!book || playback?.mode !== "play") return;
    const title = window.prompt("Bookmark note", `Bookmark at ${formatTime(progressValue)}`);
    if (title === null) return;
    const localId = `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const localBookmark: BookBookmark = { id: localId, bookId: book.id, userId: "offline", positionSeconds: progressValue, title, createdAt: now, updatedAt: now };
    setBookmarks((current) => [...current, localBookmark].sort((left, right) => left.positionSeconds - right.positionSeconds));
    try {
      const bookmark = await api.createBookBookmark(book.id, { positionSeconds: progressValue, title });
      setBookmarks((current) => current.map((item) => item.id === localId ? bookmark : item).sort((left, right) => left.positionSeconds - right.positionSeconds));
    } catch {
      syncQueue.enqueueBookmarkCreate(book.id, localId, progressValue, title);
    }
  };

  const removeBookmark = async (bookmark: BookBookmark) => {
    if (!book) return;
    setBookmarks((current) => current.filter((item) => item.id !== bookmark.id));
    try {
      await api.deleteBookBookmark(book.id, bookmark.id);
    } catch {
      if (bookmark.id.startsWith("offline-")) {
        syncQueue.cancelBookmarkCreate(book.id, bookmark.id);
      } else {
        syncQueue.enqueueBookmarkDelete(book.id, bookmark.id);
      }
    }
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
          {playback.mode === "play" && (
            <div className="player-reference-tools">
              <div className="player-reference-tabs" role="tablist" aria-label="Chapters and bookmarks">
                <button className={referenceTab === "chapters" ? "active" : ""} onClick={() => setReferenceTab("chapters")} role="tab" aria-selected={referenceTab === "chapters"}>
                  <List size={15} /> Chapters ({book.chapters?.length ?? 0})
                </button>
                <button className={referenceTab === "bookmarks" ? "active" : ""} onClick={() => setReferenceTab("bookmarks")} role="tab" aria-selected={referenceTab === "bookmarks"}>
                  <Bookmark size={15} /> Bookmarks ({bookmarks.length})
                </button>
              </div>
              {referenceTab === "chapters" && book.chapters?.length ? <div className="player-bookmark-list">
                {book.chapters.map((chapter, index) => (
                  <button className="player-bookmark link-button" key={chapter.id} onClick={() => seekTo(chapter.startSeconds)}>
                    <span>{index + 1}. {chapter.title}</span><small>{formatTime(chapter.startSeconds)}</small>
                  </button>
                ))}
              </div> : null}
              {referenceTab === "bookmarks" && <>
                <button className="command-button" onClick={() => void addBookmark()}><Bookmark size={16} /> Add bookmark</button>
                {bookmarks.length > 0 ? <div className="player-bookmark-list">
                  {bookmarks.map((bookmark) => (
                    <div className="player-bookmark" key={bookmark.id}>
                      <button className="link-button" onClick={() => seekTo(bookmark.positionSeconds)}>{bookmark.title} <small>{formatTime(bookmark.positionSeconds)}</small></button>
                      <button className="icon-button" onClick={() => void removeBookmark(bookmark)} title="Remove bookmark"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div> : <span className="player-empty-reference">No bookmarks yet.</span>}
              </>}
            </div>
          )}
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
            {castAvailable && (
              <button className="icon-button" onClick={() => void castCurrentBook()} title="Cast to device">
                <CastIcon size={18} />
              </button>
            )}
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
          {castAvailable && (
            <button className="icon-button" onClick={() => void castCurrentBook()} title="Cast to device">
              <CastIcon size={16} />
            </button>
          )}
          <button className="icon-button player-expand-button" onClick={() => setExpanded(true)} title="Open now playing">
            <ChevronUp size={18} />
          </button>
        </div>
      )}
      <audio
        ref={audioRef}
        src={audioSources[activeTrackIndex]?.url ?? ""}
        onEnded={(event) => {
          const nextTrackIndex = activeTrackIndex + 1;
          const completedPosition = trackOffset(activeTrackIndex, trackDurations, declaredTrackDurations) + (event.currentTarget.duration || event.currentTarget.currentTime);
          persistProgress(completedPosition, wholeBookDuration || undefined, { force: true });
          if (nextTrackIndex < audioSources.length) {
            pendingSeekRef.current = { seconds: 0, play: true };
            setActiveTrackIndex(nextTrackIndex);
            return;
          }
          setPlaying(false);
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration || 0;
          setDuration(nextDuration);
          setTrackDurations((current) => {
            const next = [...current];
            next[activeTrackIndex] = nextDuration || next[activeTrackIndex] || declaredTrackDurations[activeTrackIndex] || 0;
            return next;
          });
          setCurrentTime(event.currentTarget.currentTime || 0);
        }}
        onPause={(event) => {
          persistProgress(trackOffset(activeTrackIndex, trackDurations, declaredTrackDurations) + event.currentTarget.currentTime, wholeBookDuration || undefined, { force: true });
          setPlaying(false);
        }}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          setCurrentTime(audio.currentTime);
          setDuration(audio.duration || duration || 0);
          const absoluteTime = trackOffset(activeTrackIndex, trackDurations, declaredTrackDurations) + audio.currentTime;
          if (playback.mode === "sample" && absoluteTime >= sampleStartSeconds + sampleDurationSeconds) {
            audio.pause();
            setPlaying(false);
            return;
          }
          persistProgress(absoluteTime, wholeBookDuration || undefined);
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

function sumNumbers(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function trackOffset(trackIndex: number, actualDurations: number[], declaredDurations: number[]): number {
  const durations = actualDurations.length ? actualDurations : declaredDurations;
  return durations.slice(0, trackIndex).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function trackIndexForPosition(positionSeconds: number, durations: number[]): number {
  if (durations.length === 0) {
    return 0;
  }
  let elapsed = 0;
  for (let index = 0; index < durations.length; index += 1) {
    const duration = durations[index] || 0;
    if (duration <= 0 || positionSeconds < elapsed + duration) {
      return index;
    }
    elapsed += duration;
  }
  return Math.max(0, durations.length - 1);
}

function trackPositionForAbsolute(positionSeconds: number, trackIndex: number, durations: number[]): number {
  return Math.max(0, positionSeconds - trackOffset(trackIndex, durations, durations));
}
