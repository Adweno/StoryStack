import 'package:flutter_test/flutter_test.dart';
import 'package:story_stack_mobile/main.dart';

void main() {
  test('series groups exclude standalone books and sort by series order', () {
    final books = [
      const Book(
        id: '2',
        title: 'Book Two',
        author: 'Author',
        genres: [],
        addedAt: '2026-01-02',
        series: 'Series',
        seriesOrder: 2,
      ),
      const Book(
        id: '1',
        title: 'Book One',
        author: 'Author',
        genres: [],
        addedAt: '2026-01-01',
        series: 'Series',
        seriesOrder: 1,
      ),
      const Book(
        id: 's',
        title: 'Standalone',
        author: 'Author',
        genres: [],
        addedAt: '2026-01-03',
        series: 'Standalone',
      ),
    ];

    final groups = groupsFor(books, GroupMode.series);

    expect(groups, hasLength(1));
    expect(groups.first.name, 'Series');
    expect(groups.first.books.map((book) => book.id), ['1', '2']);
  });

  test('finished progress returns full cover progress', () {
    const book = Book(
      id: '1',
      title: 'Book',
      author: 'Author',
      genres: [],
      addedAt: '2026-01-01',
      durationSeconds: 100,
    );
    const progress = PlaybackProgress(
      userId: 'u',
      bookId: '1',
      positionSeconds: 100,
      durationSeconds: 100,
      status: ProgressStatus.finished,
    );

    expect(progressPercentFor(book, progress), 100);
  });

  test('progress summary returns percentage and time left', () {
    const book = Book(
      id: '1',
      title: 'Book',
      author: 'Author',
      genres: [],
      addedAt: '2026-01-01',
      durationSeconds: 100,
    );
    const progress = PlaybackProgress(
      userId: 'u',
      bookId: '1',
      positionSeconds: 25,
      durationSeconds: 100,
      status: ProgressStatus.inProgress,
    );

    final summary = progressSummaryFor(book, progress);

    expect(summary?.percent, 25);
    expect(summary?.timeLeft, const Duration(seconds: 75));
  });

  test('finished progress summary returns complete with no time left', () {
    const book = Book(
      id: '1',
      title: 'Book',
      author: 'Author',
      genres: [],
      addedAt: '2026-01-01',
      durationSeconds: 100,
    );
    const progress = PlaybackProgress(
      userId: 'u',
      bookId: '1',
      positionSeconds: 100,
      durationSeconds: 100,
      status: ProgressStatus.finished,
    );

    final summary = progressSummaryFor(book, progress);

    expect(summary?.percent, 100);
    expect(summary?.timeLeft, Duration.zero);
  });
}
