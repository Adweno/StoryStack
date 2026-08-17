import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:story_stack_mobile/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

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

  test('remote shelf list includes managed progress shelves', () async {
    final shelves = await ensureDefaultShelf(
      _TestShelfApi(),
      const [],
      userId: 'user-1',
    );

    expect(shelves.map((shelf) => shelf.name), [
      'Favorites',
      'Finished Books',
      'Books in Progress',
    ]);
    expect(shelves[1].id, 'system_shelf_finished_user-1');
    expect(shelves[2].id, 'system_shelf_in-progress_user-1');
  });

  test('managed shelves classify books from per-user progress', () {
    const books = [
      Book(
        id: 'finished',
        title: 'Finished',
        author: 'Author',
        genres: [],
        addedAt: '2026-01-01',
      ),
      Book(
        id: 'progress',
        title: 'In Progress',
        author: 'Author',
        genres: [],
        addedAt: '2026-01-02',
      ),
      Book(
        id: 'unstarted',
        title: 'Unstarted',
        author: 'Author',
        genres: [],
        addedAt: '2026-01-03',
      ),
    ];
    const progress = {
      'finished': PlaybackProgress(
        userId: 'u',
        bookId: 'finished',
        positionSeconds: 100,
        durationSeconds: 100,
        status: ProgressStatus.finished,
      ),
      'progress': PlaybackProgress(
        userId: 'u',
        bookId: 'progress',
        positionSeconds: 25,
        durationSeconds: 100,
        status: ProgressStatus.inProgress,
      ),
    };

    expect(
      managedShelfBooksFor(books, progress, 'Finished Books')
          .map((book) => book.id),
      ['finished'],
    );
    expect(
      managedShelfBooksFor(books, progress, 'Books in Progress')
          .map((book) => book.id),
      ['progress'],
    );
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

  test('auto rewind uses stepped pause intervals', () {
    expect(audiobookAutoRewind(const Duration(seconds: 9)), Duration.zero);
    expect(
      audiobookAutoRewind(const Duration(seconds: 10)),
      const Duration(seconds: 3),
    );
    expect(
      audiobookAutoRewind(const Duration(minutes: 1)),
      const Duration(seconds: 10),
    );
    expect(
      audiobookAutoRewind(const Duration(minutes: 5)),
      const Duration(seconds: 20),
    );
    expect(
      audiobookAutoRewind(const Duration(minutes: 30)),
      const Duration(seconds: 30),
    );
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

  test('download cleanup matches only the requested book artifacts', () {
    expect(isDownloadArtifactForBook('book.audio', 'book'), isTrue);
    expect(isDownloadArtifactForBook('book.audio.part', 'book'), isTrue);
    expect(isDownloadArtifactForBook('book.audio.part.3', 'book'), isTrue);
    expect(isDownloadArtifactForBook('book.2.audio.part', 'book'), isTrue);
    expect(isDownloadArtifactForBook('book-extended.audio', 'book'), isFalse);
    expect(isDownloadArtifactForBook('book.2.audio', 'book-extended'), isFalse);
  });

  test('offline sync queue keeps only the latest progress per book', () async {
    SharedPreferences.setMockInitialValues({});
    final queue = OfflineSyncQueue('test-progress');
    await queue.enqueueProgress('book-1', 10, 100);
    await queue.enqueueProgress('book-1', 50, 100);

    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('offlineSyncQueue_test-progress');
    final data = jsonDecode(raw!) as Map<String, dynamic>;
    final progress = (data['progress'] as Map<String, dynamic>)['book-1'];

    expect((progress as Map<String, dynamic>)['positionSeconds'], 50);
  });

  test('offline sync queue preserves bookmark actions', () async {
    SharedPreferences.setMockInitialValues({});
    final queue = OfflineSyncQueue('test-bookmarks');
    final bookmark = await queue.enqueueBookmarkCreate(
      'book-2',
      42,
      'Chapter 2',
    );

    final queued = await queue.queuedBookmarksFor('book-2');

    expect(queued, hasLength(1));
    expect(queued.single.id, bookmark.id);
    expect(queued.single.positionSeconds, 42);
  });
}

class _TestShelfApi extends StoryStackApi {
  @override
  Future<Shelf> createShelf(String name) async => Shelf(
    id: 'shelf-$name',
    name: name,
  );
}
