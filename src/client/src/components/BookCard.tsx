import { Check, CheckCircle2, Download, MoreVertical, Play, Plus, RotateCcw, Trash2, Volume2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { BookCover } from "./BookCover";
import type { Book, Shelf } from "../types";

export function BookCard({
  book,
  inLibrary,
  onAdd,
  onMoveToShelf,
  onOfflineSave,
  onClearProgress,
  onMarkFinished,
  offlineProgress,
  offlineState = "idle",
  onOfflineRemove,
  onOfflineCancel,
  onRemove,
  onRemoveFromShelf,
  onPlay,
  onSelect,
  playbackProgressPercent,
  shelves = [],
  variant = "library"
}: {
  book: Book;
  inLibrary: boolean;
  onAdd: () => void;
  onMoveToShelf?: (shelf: Shelf) => void;
  onOfflineSave?: () => void;
  onClearProgress?: () => void;
  onMarkFinished?: () => void;
  offlineProgress?: number;
  offlineState?: "idle" | "saving" | "saved";
  onOfflineRemove?: () => void;
  onOfflineCancel?: () => void;
  onRemove?: () => void;
  onRemoveFromShelf?: () => void;
  onPlay: () => void;
  onSelect: () => void;
  playbackProgressPercent?: number;
  shelves?: Shelf[];
  variant?: "library" | "store";
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuButtonRef.current?.contains(target) && !menuPanelRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuOpen]);

  const moveToShelf = (shelf: Shelf) => {
    onMoveToShelf?.(shelf);
    setMenuOpen(false);
  };

  const remove = () => {
    onRemove?.();
    setMenuOpen(false);
  };

  const removeFromShelf = () => {
    onRemoveFromShelf?.();
    setMenuOpen(false);
  };

  const removeOffline = () => {
    onOfflineRemove?.();
    setMenuOpen(false);
  };

  const cancelOffline = () => {
    onOfflineCancel?.();
    setMenuOpen(false);
  };

  const markFinished = () => {
    onMarkFinished?.();
    setMenuOpen(false);
  };

  const clearProgress = () => {
    onClearProgress?.();
    setMenuOpen(false);
  };

  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const panelWidth = 218;
    const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
    const opensBelow = rect.top < 220;
    setMenuPosition({
      left,
      top: opensBelow ? rect.bottom + 8 : rect.top - 8,
      placement: opensBelow ? "below" : "above"
    });
    setMenuOpen(true);
  };

  const closeMenu = () => setMenuOpen(false);
  const downloadProgress = typeof offlineProgress === "number" ? Math.max(0, Math.min(100, offlineProgress)) : undefined;
  const isFinished = variant === "library" && playbackProgressPercent !== undefined && playbackProgressPercent >= 100;

  return (
    <article className="book-card">
      <button className="cover-button" onClick={onSelect} aria-label={`Open ${book.title}`}>
        <BookCover book={book} />
        {playbackProgressPercent !== undefined && playbackProgressPercent > 0 && (
          <span
            className="cover-listening-progress"
            style={{ "--listening-progress": Math.max(2, Math.min(100, playbackProgressPercent)) } as CSSProperties}
            aria-hidden="true"
          />
        )}
        {isFinished && (
          <span className="cover-finished-badge" title="Finished" aria-label="Finished">
            <Check size={15} />
          </span>
        )}
      </button>
      <div className="book-card-body">
        <button className="plain-title" onClick={onSelect}>
          {book.title}
        </button>
        <p>{book.author}</p>
        <div className="book-actions">
          {variant === "library" ? (
            <button className="icon-button" onClick={onPlay} title="Play">
              <Play size={17} />
            </button>
          ) : (
            <button className="icon-button" onClick={onSelect} title="Sample">
              <Volume2 size={17} />
            </button>
          )}
          {variant === "library" && onOfflineSave && (
            <button
              className={offlineState === "saved" ? "icon-button saved-offline" : offlineState === "saving" ? "icon-button saving-offline" : "icon-button"}
              disabled={offlineState !== "idle"}
              onClick={onOfflineSave}
              title={
                offlineState === "saved"
                  ? "Saved offline"
                  : offlineState === "saving" && downloadProgress !== undefined
                    ? `Saving offline: ${Math.round(downloadProgress)}%`
                    : offlineState === "saving"
                      ? "Saving offline"
                      : "Save offline"
              }
            >
              {offlineState === "saved" ? <Check size={16} /> : offlineState === "saving" ? <DownloadProgressRing progress={downloadProgress} /> : <Download size={16} />}
            </button>
          )}
          {variant === "store" && (
            <button className="icon-button primary" onClick={inLibrary ? onRemove : onAdd} title={inLibrary ? "Remove from Library" : "Add to Library"}>
              {inLibrary ? <Check size={16} /> : <Plus size={16} />}
            </button>
          )}
          {variant === "library" && inLibrary && (
            <div className="book-menu">
              <button
                ref={menuButtonRef}
                className="icon-button"
                onClick={toggleMenu}
                title="Book options"
                aria-expanded={menuOpen}
                aria-label={`Options for ${book.title}`}
              >
                <MoreVertical size={16} />
              </button>
              {menuOpen &&
                menuPosition &&
                createPortal(
                  <BookMenuPanel
                    menuPanelRef={menuPanelRef}
                    clearProgress={variant === "library" ? clearProgress : undefined}
                    markFinished={variant === "library" ? markFinished : undefined}
                    moveToShelf={moveToShelf}
                    removeOffline={onOfflineRemove ? removeOffline : undefined}
                    cancelOffline={onOfflineCancel ? cancelOffline : undefined}
                    position={menuPosition}
                    remove={onRemove ? remove : undefined}
                    removeFromShelf={onRemoveFromShelf ? removeFromShelf : undefined}
                    shelves={shelves}
                  />,
                  document.body
                )}
            </div>
          )}
          {book.reviewCount && book.reviewCount > 0 && book.averageRating !== undefined && (
            <span
              className="book-rating-badge"
              title={`${book.averageRating.toFixed(1)} out of 5 from ${book.reviewCount} review${book.reviewCount === 1 ? "" : "s"}`}
            >
              <span aria-hidden="true">★</span>
              {book.averageRating.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function DownloadProgressRing({ progress }: { progress?: number }) {
  const progressStyle = { "--download-progress": progress ?? 0 } as CSSProperties;
  return (
    <span className={progress === undefined ? "download-progress-ring indeterminate" : "download-progress-ring"} style={progressStyle}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="download-progress-track" cx="18" cy="18" r="15" />
        <circle className="download-progress-value" cx="18" cy="18" r="15" />
      </svg>
      {progress !== undefined && <span>{Math.round(progress)}</span>}
    </span>
  );
}

function BookMenuPanel({
  clearProgress,
  markFinished,
  menuPanelRef,
  moveToShelf,
  position,
  removeOffline,
  cancelOffline,
  remove,
  removeFromShelf,
  shelves
}: {
  clearProgress?: () => void;
  markFinished?: () => void;
  menuPanelRef: RefObject<HTMLDivElement | null>;
  moveToShelf: (shelf: Shelf) => void;
  position: MenuPosition;
  removeOffline?: () => void;
  cancelOffline?: () => void;
  remove?: () => void;
  removeFromShelf?: () => void;
  shelves: Shelf[];
}) {
  const editableShelves = shelves.filter(
    (shelf) => !["finished books", "books in progress"].includes(shelf.name.trim().toLowerCase())
  );
  return (
    <div
      className="book-menu-panel floating-book-menu"
      ref={menuPanelRef}
      style={{
        left: position.left,
        top: position.top,
        transform: position.placement === "above" ? "translateY(-100%)" : undefined
      }}
    >
      {markFinished && (
        <button onClick={markFinished}>
          <CheckCircle2 size={15} />
          Mark as Finished
        </button>
      )}
      {clearProgress && (
        <button onClick={clearProgress}>
          <RotateCcw size={15} />
          Clear Progress
        </button>
      )}
      {removeOffline && (
        <button onClick={removeOffline}>
          <Download size={15} />
          Remove from Local Storage
        </button>
      )}
      {cancelOffline && (
        <button onClick={cancelOffline}>
          <XCircle size={15} />
          Cancel Download
        </button>
      )}
      {remove && (
        <button onClick={remove}>
          <Trash2 size={15} />
          Remove from Library
        </button>
      )}
      {removeFromShelf && (
        <button onClick={removeFromShelf}>
          <Trash2 size={15} />
          Remove from Shelf
        </button>
      )}
      <div className="book-menu-section">
        <span>Move to shelf</span>
        {editableShelves.length > 0 ? (
          editableShelves.map((shelf) => (
            <button key={shelf.id} onClick={() => moveToShelf(shelf)}>
              {shelf.name}
            </button>
          ))
        ) : (
          <small>No shelves yet</small>
        )}
      </div>
    </div>
  );
}

interface MenuPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}
