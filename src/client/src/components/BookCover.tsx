import { BookOpen } from "lucide-react";
import { useState } from "react";
import type { Book } from "../types";

export function BookCover({ book, compact = false }: { book: Book; compact?: boolean }) {
  const [failed, setFailed] = useState(false);

  if (book.coverPath && !failed) {
    return <img className="book-cover" src={`/media/books/${book.id}/cover`} alt="" onError={() => setFailed(true)} />;
  }

  return (
    <div className={compact ? "book-cover empty-cover compact-empty-cover" : "book-cover empty-cover"}>
      <BookOpen size={compact ? 26 : 34} />
      {!compact && <span>{book.title.slice(0, 28)}</span>}
    </div>
  );
}
