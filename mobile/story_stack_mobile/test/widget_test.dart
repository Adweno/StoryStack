import 'dart:convert';

import 'package:audio_session/audio_session.dart';
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

  test('server addresses receive the correct default scheme', () {
    expect(
      normalizeServerAddress('app.example.com'),
      'https://app.example.com',
    );
    expect(
      normalizeServerAddress('192.168.1.20:4100', defaultScheme: 'http'),
      'http://192.168.1.20:4100',
    );
    expect(
      normalizeServerAddress('https://app.example.com/'),
      'https://app.example.com',
    );
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
      managedShelfBooksFor(
        books,
        progress,
        'Finished Books',
      ).map((book) => book.id),
      ['finished'],
    );
    expect(
      managedShelfBooksFor(
        books,
        progress,
        'Books in Progress',
      ).map((book) => book.id),
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

  test('progress finishes only within the final three minutes', () {
    expect(shouldMarkProgressFinished(420, 600), isFalse);
    expect(shouldMarkProgressFinished(421, 600), isTrue);
    expect(shouldMarkProgressFinished(0, null), isFalse);
  });

  test(
    'playback checkpoint round-trips and is cleared after recovery',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final store = PlaybackCheckpointStore(prefs, 'checkpoint-user');
      const checkpoint = PlaybackCheckpoint(
        positionSeconds: 3599,
        durationSeconds: 3600,
        finished: false,
      );

      await store.save('book-1', checkpoint);

      expect(store.read('book-1')?.positionSeconds, 3599);
      expect(store.read('book-1')?.finished, isFalse);
      expect(store.bookIds, contains('book-1'));

      await store.clear('book-1');

      expect(store.read('book-1'), isNull);
      expect(store.bookIds, isEmpty);
    },
  );

  test('invalid playback checkpoints are ignored', () {
    expect(PlaybackCheckpoint.fromJson('{"positionSeconds":3599}'), isNull);
    expect(PlaybackCheckpoint.fromJson('not-json'), isNull);
  });

  test('phone-call interruptions pause without auto-resuming', () {
    expect(
      shouldPauseForAudioInterruption(
        AudioInterruptionEvent(true, AudioInterruptionType.pause),
      ),
      isTrue,
    );
    expect(
      shouldPauseForAudioInterruption(
        AudioInterruptionEvent(false, AudioInterruptionType.pause),
      ),
      isFalse,
    );
    expect(
      shouldPauseForAudioInterruption(
        AudioInterruptionEvent(true, AudioInterruptionType.duck),
      ),
      isFalse,
    );
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

  test('pending finished progress wins over a stale server snapshot', () async {
    SharedPreferences.setMockInitialValues({});
    final queue = OfflineSyncQueue('test-finished-recovery');
    await queue.enqueueProgress('book-1', 600, 600);

    final pending = await queue.pendingProgress();

    expect(pending['book-1']?.status, ProgressStatus.finished);
    expect(pending['book-1']?.positionSeconds, 600);
  });

  test('cached finished progress survives queue persistence', () async {
    SharedPreferences.setMockInitialValues({});
    final queue = OfflineSyncQueue('test-finished-cache');
    await queue.enqueueProgress('book-1', 600, 600);

    final cached = await queue.cachedProgress();

    expect(cached['book-1']?.status, ProgressStatus.finished);
    expect(cached['book-1']?.positionSeconds, 600);
  });

  test('progress reconciliation chooses the newest timestamp', () {
    final server = PlaybackProgress(
      userId: 'u',
      bookId: 'book-1',
      positionSeconds: 120,
      durationSeconds: 600,
      status: ProgressStatus.inProgress,
      updatedAt: '2026-10-26T10:00:00Z',
    );
    final local = PlaybackProgress(
      userId: 'u',
      bookId: 'book-1',
      positionSeconds: 600,
      durationSeconds: 600,
      status: ProgressStatus.finished,
      updatedAt: '2026-10-26T10:00:01Z',
    );

    final merged = mergeProgressByLatest([
      {'book-1': server},
      {'book-1': local},
    ]);

    expect(merged['book-1']?.status, ProgressStatus.finished);
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

  test('offline sync queue coalesces library and shelf changes', () async {
    SharedPreferences.setMockInitialValues({});
    final queue = OfflineSyncQueue('test-library-actions');

    await queue.enqueueLibraryChange('book-1', added: true);
    await queue.enqueueLibraryChange('book-1', added: false);
    await queue.enqueueShelfChange('shelf-1', 'book-1', added: true);
    await queue.enqueueShelfChange('shelf-1', 'book-1', added: false);

    final prefs = await SharedPreferences.getInstance();
    final data =
        jsonDecode(prefs.getString('offlineSyncQueue_test-library-actions')!)
            as Map<String, dynamic>;

    expect((data['library'] as Map<String, dynamic>)['book-1'], isFalse);
    final shelfChange =
        (data['shelves'] as Map<String, dynamic>)['shelf-1:book-1']
            as Map<String, dynamic>;
    expect(shelfChange['added'], isFalse);
  });
}

class _TestShelfApi extends StoryStackApi {
  @override
  Future<Shelf> createShelf(String name) async =>
      Shelf(id: 'shelf-$name', name: name);
}
