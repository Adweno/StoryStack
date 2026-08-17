import { BookOpen } from "lucide-react";
import { useState } from "react";
import type { Book } from "../types";

export function BookCover({ book, compact = false }: { book: Book; compact?: boolean }) {
  const [failed, setFailed] = useState(false);

  if (book.coverPath && !failed) {
    // The cover path changes when a rescan finds or replaces artwork. Include
    // it in the URL so browsers do not keep showing a previously cached 404.
    const coverUrl = `/media/books/${book.id}/cover?v=${encodeURIComponent(book.coverPath)}`;

    return (
      <span className="book-cover cover-art-frame">
        <img className="cover-art-fill" src={coverUrl} alt="" aria-hidden="true" />
        <img className="cover-art-image" src={coverUrl} alt="" onError={() => setFailed(true)} />
      </span>
    );
  }

  return (
    <div className={compact ? "book-cover empty-cover compact-empty-cover" : "book-cover empty-cover"}>
      <BookOpen size={compact ? 26 : 34} />
      {!compact && <span>{book.title.slice(0, 28)}</span>}
    </div>
  );
}
