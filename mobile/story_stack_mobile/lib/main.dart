import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_chrome_cast/flutter_chrome_cast.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  runApp(const StoryStackMobileApp());
}

const _defaultServerUrl = '';
const _defaultShelfName = 'Favorites';
const _guestLocalDeviceUserId = 'local-device';
const _compactControlSize = 38.0;
const _audioExtensions = {
  '.aac',
  '.aa',
  '.aax',
  '.aiff',
  '.alac',
  '.flac',
  '.m4a',
  '.m4b',
  '.mp3',
  '.mp4',
  '.mka',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.weba',
  '.webm',
  '.wma',
};
const _coverExtensions = {'.jpg', '.jpeg', '.png', '.webp'};
const _metadataFileNames = {'metadata.json', 'book.json', 'desc.json'};

Future<List<Shelf>> ensureDefaultShelf(
  StoryStackApi api,
  List<Shelf> shelves,
) async {
  final hasDefaultShelf = shelves.any(
    (shelf) => shelf.name.toLowerCase() == _defaultShelfName.toLowerCase(),
  );
  final nextShelves = hasDefaultShelf
      ? [...shelves]
      : [...shelves, await api.createShelf(_defaultShelfName)];
  nextShelves.sort((left, right) {
    final leftIsDefault =
        left.name.toLowerCase() == _defaultShelfName.toLowerCase();
    final rightIsDefault =
        right.name.toLowerCase() == _defaultShelfName.toLowerCase();
    if (leftIsDefault != rightIsDefault) return leftIsDefault ? -1 : 1;
    return 0;
  });
  return nextShelves;
}

User guestLocalDeviceUser({
  StoryTheme theme = StoryTheme.dark,
  bool reviewsEnabled = true,
}) => User(
  id: _guestLocalDeviceUserId,
  name: 'Local Device',
  role: UserRole.user,
  status: UserStatus.active,
  theme: theme,
  reviewsEnabled: reviewsEnabled,
  metadataEditorEnabled: false,
  passwordConfigured: false,
);

class StoryStackMobileApp extends StatefulWidget {
  const StoryStackMobileApp({super.key});

  @override
  State<StoryStackMobileApp> createState() => _StoryStackMobileAppState();
}

class _StoryStackMobileAppState extends State<StoryStackMobileApp> {
  late final StoryStackApi api;
  late final LocalDeviceLibraryStore guestLibrary;
  User? user;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    api = StoryStackApi();
    guestLibrary = LocalDeviceLibraryStore(_guestLocalDeviceUserId);
    unawaited(_restoreSession());
  }

  Future<void> _restoreSession() async {
    await api.restore();
    await guestLibrary.init();
    final guestSource = await guestLibrary.loadSource();
    if (guestSource == LibrarySourceMode.localDevice) {
      await api.clearSession();
      user = await guestLibrary.loadGuestUser();
      if (mounted) {
        setState(() => loading = false);
      }
      return;
    }
    try {
      user = await api.me();
    } catch (_) {
      user = null;
    }
    if (mounted) {
      setState(() => loading = false);
    }
  }

  Future<void> _setUser(User? nextUser) async {
    setState(() => user = nextUser);
  }

  @override
  Widget build(BuildContext context) {
    final activeUser = user;
    return MaterialApp(
      title: 'Story Stack',
      debugShowCheckedModeBanner: false,
      theme: storyTheme(activeUser?.theme ?? StoryTheme.dark),
      home: loading
          ? const SplashScreen()
          : activeUser == null
          ? LoginScreen(
              api: api,
              sourceStore: guestLibrary,
              onSignedIn: _setUser,
            )
          : StoryShell(
              api: api,
              sourceStore: guestLibrary,
              user: activeUser,
              onUserChanged: _setUser,
            ),
    );
  }
}

ThemeData storyTheme(StoryTheme theme) {
  final dark = theme == StoryTheme.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: const Color(0xffa75b70),
    brightness: dark ? Brightness.dark : Brightness.light,
    primary: const Color(0xffa75b70),
    secondary: const Color(0xfff4bd62),
    surface: dark ? const Color(0xff1f1b17) : const Color(0xfffff8ec),
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark
        ? const Color(0xff12120f)
        : const Color(0xfffbf1df),
    cardColor: dark ? const Color(0xff211d18) : const Color(0xfffffbf4),
    fontFamily: 'Roboto',
    textTheme: TextTheme(
      headlineLarge: TextStyle(
        fontSize: 30,
        fontWeight: FontWeight.w900,
        color: dark ? const Color(0xfffff3d4) : const Color(0xff15120d),
      ),
      headlineMedium: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w900,
        color: dark ? const Color(0xfffff3d4) : const Color(0xff15120d),
      ),
      titleLarge: TextStyle(
        fontSize: 19,
        fontWeight: FontWeight.w800,
        color: dark ? const Color(0xfffff3d4) : const Color(0xff15120d),
      ),
      titleMedium: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w800,
        color: dark ? const Color(0xfffff3d4) : const Color(0xff15120d),
      ),
      bodyLarge: TextStyle(
        fontSize: 15,
        color: dark ? const Color(0xffeadbc5) : const Color(0xff3d3328),
      ),
      bodyMedium: TextStyle(
        fontSize: 12,
        color: dark ? const Color(0xffcbbca4) : const Color(0xff6b5d4c),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? const Color(0xff17140f) : const Color(0xfffffbf4),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(
          color: dark ? const Color(0xff4d4034) : const Color(0xffd4bea2),
        ),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(
          color: dark ? const Color(0xff4d4034) : const Color(0xffd4bea2),
        ),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
      prefixIconConstraints: const BoxConstraints(minWidth: 38, minHeight: 38),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 62,
      labelTextStyle: WidgetStatePropertyAll(
        TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: dark ? const Color(0xfffff3d4) : const Color(0xff15120d),
        ),
      ),
    ),
  );
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.api,
    required this.sourceStore,
    required this.onSignedIn,
  });

  final StoryStackApi api;
  final LocalDeviceLibraryStore sourceStore;
  final ValueChanged<User> onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final remoteAccessController = TextEditingController(text: _defaultServerUrl);
  final localNetworkController = TextEditingController();
  final usernameController = TextEditingController();
  final passwordController = TextEditingController();
  final newPasswordController = TextEditingController();
  String? error;
  bool signingIn = false;
  bool loadingSourceConfig = true;
  LibrarySourceMode sourceMode = LibrarySourceMode.remoteAccess;
  User? passwordResetUser;

  @override
  void dispose() {
    remoteAccessController.dispose();
    localNetworkController.dispose();
    usernameController.dispose();
    passwordController.dispose();
    newPasswordController.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    unawaited(_loadSourceConfig());
  }

  Future<void> _loadSourceConfig() async {
    await widget.sourceStore.init();
    final mode = await widget.sourceStore.loadSource();
    final addresses = await widget.sourceStore.loadSourceAddresses();
    if (!mounted) return;
    setState(() {
      sourceMode = mode;
      remoteAccessController.text = addresses.remoteAccessAddress;
      localNetworkController.text = addresses.localNetworkAddress;
      loadingSourceConfig = false;
    });
  }

  Future<void> _selectSource(LibrarySourceMode mode) async {
    await widget.sourceStore.saveSource(mode);
    if (!mounted) return;
    setState(() {
      sourceMode = mode;
      error = null;
      passwordResetUser = null;
      if (mode == LibrarySourceMode.localDevice) {
        usernameController.clear();
        passwordController.clear();
        newPasswordController.clear();
      }
    });
  }

  Future<void> _saveSourceAddress(LibrarySourceMode mode) async {
    if (mode == LibrarySourceMode.remoteAccess) {
      await widget.sourceStore.saveSourceAddress(
        LibrarySourceMode.remoteAccess,
        remoteAccessController.text.trim(),
      );
      await widget.sourceStore.saveSourceAddress(
        LibrarySourceMode.localNetwork,
        localNetworkController.text.trim(),
      );
      await widget.api.setServerUrl(remoteAccessController.text.trim());
      return;
    }
    await widget.sourceStore.saveSourceAddress(
      mode,
      localNetworkController.text.trim(),
    );
    await widget.api.setServerUrl(localNetworkController.text.trim());
  }

  Future<void> _login() async {
    setState(() {
      signingIn = true;
      error = null;
    });
    try {
      await _saveSourceAddress(sourceMode);
      final user = await widget.api.login(
        usernameController.text.trim(),
        passwordController.text,
      );
      if (user.passwordResetRequired) {
        setState(() => passwordResetUser = user);
        return;
      }
      widget.onSignedIn(user);
    } catch (exception) {
      setState(
        () => error = exception.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() => signingIn = false);
      }
    }
  }

  Future<void> _openLocalDevice() async {
    setState(() {
      signingIn = true;
      error = null;
    });
    try {
      await widget.api.clearSession();
      await widget.sourceStore.saveSource(LibrarySourceMode.localDevice);
      final user = await widget.sourceStore.loadGuestUser();
      widget.onSignedIn(user);
    } catch (exception) {
      setState(
        () => error = exception.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() => signingIn = false);
      }
    }
  }

  Future<void> _setNewPassword() async {
    setState(() {
      signingIn = true;
      error = null;
    });
    try {
      final user = await widget.api.changePassword(
        newPassword: newPasswordController.text,
      );
      widget.onSignedIn(user);
    } catch (exception) {
      setState(
        () => error = exception.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() => signingIn = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Card(
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                  side: BorderSide(
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const StoryLogo(size: 48),
                      const SizedBox(height: 18),
                      Text(
                        'Story Stack',
                        style: Theme.of(context).textTheme.headlineLarge,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        sourceMode == LibrarySourceMode.localDevice
                            ? 'Open books stored on this device.'
                            : passwordResetUser == null
                            ? 'Sign in to your library and store.'
                            : 'Create your private password.',
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                      const SizedBox(height: 24),
                      if (loadingSourceConfig) ...[
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 20),
                          child: Center(child: CircularProgressIndicator()),
                        ),
                      ] else ...[
                        LibrarySourcePicker(
                          mode: sourceMode,
                          onChanged: _selectSource,
                        ),
                        const SizedBox(height: 14),
                        if (sourceMode != LibrarySourceMode.localDevice) ...[
                          TextField(
                            controller: remoteAccessController,
                            decoration: InputDecoration(
                              labelText: 'Remote address',
                              hintText: 'https://app.example.com',
                            ),
                          ),
                          if (sourceMode == LibrarySourceMode.remoteAccess) ...[
                            const SizedBox(height: 8),
                            TextField(
                              controller: localNetworkController,
                              decoration: const InputDecoration(
                                labelText: 'Optional local network address',
                                hintText: 'http://server-ip:4100',
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'On home Wi-Fi, downloads use this address automatically. Cloudflare is used away from home.',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                          if (sourceMode == LibrarySourceMode.localNetwork) ...[
                            const SizedBox(height: 4),
                            Text(
                              'This address is used while your phone is on the same Wi-Fi as the server.',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                          const SizedBox(height: 12),
                          if (passwordResetUser == null) ...[
                            TextField(
                              controller: usernameController,
                              decoration: const InputDecoration(
                                labelText: 'Email',
                              ),
                              keyboardType: TextInputType.emailAddress,
                              autofillHints: const [AutofillHints.email],
                              enabled: !signingIn,
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: passwordController,
                              obscureText: true,
                              decoration: const InputDecoration(
                                labelText: 'Password',
                              ),
                              onSubmitted: (_) => _login(),
                              enabled: !signingIn,
                            ),
                          ] else ...[
                            TextField(
                              controller: newPasswordController,
                              obscureText: true,
                              decoration: const InputDecoration(
                                labelText: 'New password',
                              ),
                              onSubmitted: (_) => _setNewPassword(),
                              enabled: !signingIn,
                            ),
                          ],
                          if (error != null) ...[
                            const SizedBox(height: 12),
                            Text(
                              error!,
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ),
                          ],
                          const SizedBox(height: 18),
                          FilledButton(
                            onPressed: signingIn
                                ? null
                                : passwordResetUser == null
                                ? _login
                                : _setNewPassword,
                            child: Text(
                              signingIn
                                  ? 'Working...'
                                  : passwordResetUser == null
                                  ? 'Sign In'
                                  : 'Save Password',
                            ),
                          ),
                        ] else ...[
                          Card(
                            color: Theme.of(context).cardColor,
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                              side: BorderSide(
                                color: Theme.of(
                                  context,
                                ).colorScheme.outlineVariant,
                              ),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Text(
                                    'Local Device',
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleLarge,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    'No sign in is required. Open the app now and choose an audiobook folder in Settings.',
                                    style: Theme.of(
                                      context,
                                    ).textTheme.bodyLarge,
                                  ),
                                  const SizedBox(height: 14),
                                  FilledButton(
                                    onPressed: signingIn
                                        ? null
                                        : _openLocalDevice,
                                    child: Text(
                                      signingIn
                                          ? 'Opening...'
                                          : 'Open Local Device',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class StoryShell extends StatefulWidget {
  const StoryShell({
    super.key,
    required this.api,
    required this.sourceStore,
    required this.user,
    required this.onUserChanged,
  });

  final StoryStackApi api;
  final LocalDeviceLibraryStore sourceStore;
  final User user;
  final ValueChanged<User?> onUserChanged;

  @override
  State<StoryShell> createState() => _StoryShellState();
}

class _StoryShellState extends State<StoryShell> {
  static const Color storeBackground = Color(0xff081022);
  static const Color storeSurface = Color(0xff111c38);
  static const Color storeSurfaceAlt = Color(0xff111b34);
  static const Color storeBorder = Color(0xff315586);
  static const Color storeSelected = Color(0xff184d65);
  static const Color storeAccent = Color(0xff80d8ff);
  static const Color storeLightBackground = Color(0xffe9f3ff);
  static const Color storeLightSurface = Color(0xfff7fbff);
  static const Color storeLightSurfaceAlt = Color(0xffeef6ff);
  static const Color storeLightBorder = Color(0xff9ab8d6);
  static const Color storeLightSelected = Color(0xffd6eaff);
  static const Color storeLightAccent = Color(0xff126488);

  static bool storeLightMode(BuildContext context) =>
      Theme.of(context).colorScheme.brightness == Brightness.light;

  static Color storeBackgroundFor(BuildContext context) =>
      storeLightMode(context) ? storeLightBackground : storeBackground;

  static Color storeSurfaceFor(BuildContext context) =>
      storeLightMode(context) ? storeLightSurface : storeSurface;

  static Color storeSurfaceAltFor(BuildContext context) =>
      storeLightMode(context) ? storeLightSurfaceAlt : storeSurfaceAlt;

  static Color storeBorderFor(BuildContext context) =>
      storeLightMode(context) ? storeLightBorder : storeBorder;

  static Color storeSelectedFor(BuildContext context) =>
      storeLightMode(context) ? storeLightSelected : storeSelected;

  static Color storeAccentFor(BuildContext context) =>
      storeLightMode(context) ? storeLightAccent : storeAccent;

  static List<Color> storeHeroColorsFor(BuildContext context) =>
      storeLightMode(context)
      ? const [Color(0xffd7edff), Color(0xffeef7ff), Color(0xffffe3ed)]
      : const [Color(0xff0a1c42), Color(0xff1e4a67), Color(0xff65335f)];

  final pageController = ScrollController();
  final searchController = TextEditingController();
  final player = AudioPlayer();
  late final CastManager castManager;
  final downloads = OfflineBookStore();
  late final LocalDeviceLibraryStore localDeviceLibrary;
  late final LocalDeviceLibraryStore mirroredSourceStore;
  Timer? progressTimer;
  AppSection section = AppSection.home;
  bool storeMode = false;
  LibrarySourceMode librarySourceMode = LibrarySourceMode.remoteAccess;
  LocalDeviceScanState localScanState = const LocalDeviceScanState();
  String remoteAccessAddress = _defaultServerUrl;
  String localNetworkAddress = '';
  BookSortKey librarySortKey = BookSortKey.title;
  SortDirection librarySortDirection = SortDirection.ascending;
  BookSortKey storeSortKey = BookSortKey.title;
  SortDirection storeSortDirection = SortDirection.ascending;
  bool nowPlayingOpen = false;
  bool loading = true;
  String? error;
  List<Book> storeBooks = [];
  List<Book> libraryBooks = [];
  List<Shelf> shelves = [];
  Map<String, int> shelfBookCounts = {};
  List<Book> activeShelfBooks = [];
  Shelf? activeShelf;
  BookGroup? activeGroup;
  Book? featuredStoreBook;
  Map<String, PlaybackProgress> progressByBook = {};
  Map<String, double?> downloadProgress = {};
  Set<String> downloadedBookIds = {};
  List<BookBookmark> playingBookmarks = [];
  Book? selectedBook;
  Book? playingBook;
  bool sampleMode = false;
  bool restoringPlaybackPosition = false;
  Duration duration = Duration.zero;
  Duration position = Duration.zero;
  Duration pendingPlaybackPosition = Duration.zero;
  int activeTrackIndex = 0;
  int lastRenderedPositionSecond = -1;

  List<Book> get visibleBooks => storeMode ? storeBooks : libraryBooks;

  @override
  void initState() {
    super.initState();
    castManager = CastManager(widget.api, downloads);
    castManager.addListener(() {
      if (!mounted) return;
      setState(() {});
    });
    unawaited(castManager.initialize());
    localDeviceLibrary = LocalDeviceLibraryStore(widget.user.id);
    mirroredSourceStore = widget.sourceStore;
    downloads.init().then((_) {
      if (mounted) {
        setState(() => downloadedBookIds = downloads.bookIds);
      }
    });
    player.durationStream.listen((value) {
      final nextDuration = value ?? Duration.zero;
      if (nextDuration != duration) {
        setStateSafe(() => duration = nextDuration);
      }
    });
    player.positionStream.listen((value) {
      final nextSecond = value.inSeconds;
      if (nextSecond != lastRenderedPositionSecond) {
        lastRenderedPositionSecond = nextSecond;
        setStateSafe(() => position = value);
      }
    });
    player.currentIndexStream.listen((value) {
      final nextIndex = value ?? 0;
      if (nextIndex != activeTrackIndex) {
        setStateSafe(() => activeTrackIndex = nextIndex);
      }
    });
    player.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed) {
        unawaited(_saveProgress(forceFinished: !sampleMode));
      }
    });
    progressTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _saveProgress(),
    );
    unawaited(_loadAll());
  }

  @override
  void dispose() {
    progressTimer?.cancel();
    unawaited(_saveProgress());
    pageController.dispose();
    searchController.dispose();
    player.dispose();
    castManager.dispose();
    super.dispose();
  }

  void setStateSafe(VoidCallback callback) {
    if (mounted) setState(callback);
  }

  Future<void> _loadAll() async {
    setStateSafe(() {
      loading = true;
      error = null;
    });
    try {
      await localDeviceLibrary.init();
      final localSource = await localDeviceLibrary.loadSource();
      final localScan = await localDeviceLibrary.loadScanState();
      final sourceAddresses = await localDeviceLibrary.loadSourceAddresses();
      await _applyApiServerForSource(localSource, sourceAddresses);
      if (localSource == LibrarySourceMode.localDevice) {
        final allBooks = sortBooks(await localDeviceLibrary.loadBooks());
        final libraryIds = await localDeviceLibrary.loadLibraryBookIds();
        final selectedBooks = allBooks
            .where((book) => libraryIds.contains(book.id))
            .map((book) => book.copyWith(inLibrary: true))
            .toList();
        final storeCatalog = allBooks
            .map(
              (book) => book.copyWith(inLibrary: libraryIds.contains(book.id)),
            )
            .toList();
        final progress = await localDeviceLibrary.loadProgress();
        setStateSafe(() {
          librarySourceMode = localSource;
          remoteAccessAddress = sourceAddresses.remoteAccessAddress;
          localNetworkAddress = sourceAddresses.localNetworkAddress;
          localScanState = localScan.copyWith(scannedBooks: allBooks.length);
          libraryBooks = selectedBooks;
          storeBooks = storeCatalog;
          if (featuredStoreBook == null ||
              !storeCatalog.any((book) => book.id == featuredStoreBook!.id)) {
            featuredStoreBook = _randomStoreBook(storeCatalog);
          }
          progressByBook = progress;
          shelves = const [];
          shelfBookCounts = const {};
          loading = false;
        });
        return;
      }
      final library = await widget.api.library();
      final store = await widget.api.store();
      await _cacheBooksForAndroidAuto(library.books);
      final userShelves = await ensureDefaultShelf(
        widget.api,
        await widget.api.shelves(),
      );
      final nextShelfBookCounts = await _loadShelfBookCounts(userShelves);
      final sortedStore = sortBooks(store);
      setStateSafe(() {
        librarySourceMode = localSource;
        remoteAccessAddress = sourceAddresses.remoteAccessAddress;
        localNetworkAddress = sourceAddresses.localNetworkAddress;
        localScanState = localScan;
        libraryBooks = sortBooks(library.books);
        storeBooks = sortedStore;
        if (featuredStoreBook == null ||
            !sortedStore.any((book) => book.id == featuredStoreBook!.id)) {
          featuredStoreBook = _randomStoreBook(sortedStore);
        }
        progressByBook = {
          for (final item in library.progress) item.bookId: item,
        };
        shelves = userShelves;
        shelfBookCounts = nextShelfBookCounts;
        loading = false;
      });
    } catch (exception) {
      setStateSafe(() {
        error = exception.toString().replaceFirst('Exception: ', '');
        loading = false;
      });
    }
  }

  Future<void> _cacheBooksForAndroidAuto(List<Book> books) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'androidAutoBookCatalog',
      jsonEncode(books.map((book) => book.toJson()).toList()),
    );
  }

  Future<Map<String, int>> _loadShelfBookCounts(List<Shelf> shelves) async {
    final entries = await Future.wait(
      shelves.map((shelf) async {
        final books = await widget.api.shelfBooks(shelf.id);
        return MapEntry(shelf.id, books.length);
      }),
    );
    return Map.fromEntries(entries);
  }

  Book? _randomStoreBook(List<Book> books) {
    if (books.isEmpty) return null;
    return books[Random().nextInt(books.length)];
  }

  void _navigate(AppSection next, {bool toStore = false}) {
    final enteringStore = !storeMode && toStore;
    setState(() {
      selectedBook = null;
      activeShelf = null;
      activeShelfBooks = [];
      activeGroup = null;
      storeMode = toStore;
      section = next;
      if (enteringStore) {
        featuredStoreBook = _randomStoreBook(storeBooks);
      }
      if (next != AppSection.downloads) {
        searchController.clear();
      }
    });
    if (pageController.hasClients) {
      pageController.animateTo(
        0,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    }
  }

  Future<void> _openShelf(Shelf shelf) async {
    final books = await widget.api.shelfBooks(shelf.id);
    setState(() {
      selectedBook = null;
      activeShelf = shelf;
      activeShelfBooks = sortBooks(books);
      activeGroup = null;
      section = AppSection.shelves;
    });
    pageController.jumpTo(0);
  }

  Future<void> _selectBook(Book book) async {
    setState(() => selectedBook = book);
    pageController.jumpTo(0);
  }

  void _applyBookUpdate(Book updatedBook) {
    setState(() {
      if (selectedBook?.id == updatedBook.id) {
        selectedBook = updatedBook;
      }
      storeBooks = storeBooks
          .map((book) => book.id == updatedBook.id ? updatedBook : book)
          .toList();
      libraryBooks = libraryBooks
          .map((book) => book.id == updatedBook.id ? updatedBook : book)
          .toList();
      activeShelfBooks = activeShelfBooks
          .map((book) => book.id == updatedBook.id ? updatedBook : book)
          .toList();
      if (activeGroup != null) {
        activeGroup = activeGroup!.copyWith(
          books: activeGroup!.books
              .map((book) => book.id == updatedBook.id ? updatedBook : book)
              .toList(),
        );
      }
      if (featuredStoreBook?.id == updatedBook.id) {
        featuredStoreBook = updatedBook;
      }
    });
  }

  Future<Book> _saveBookMetadata(Book book, BookMetadataUpdate input) async {
    final updatedBook = await widget.api.updateBookMetadata(book.id, input);
    _applyBookUpdate(updatedBook);
    return updatedBook;
  }

  Future<BookMetadataResult> _findBookMetadata(Book book) async {
    final result = await widget.api.findBookMetadata(book.id);
    _applyBookUpdate(result.book);
    return result;
  }

  Future<void> _play(Book book, {bool sample = false}) async {
    if (castManager.isCasting) {
      await castManager.stopCasting();
    }
    await _saveProgress();
    final trackDurations = _trackDurations(book);
    final progress = progressByBook[book.id];
    final start = sample
        ? const Duration(minutes: 3)
        : Duration(
            seconds: progress?.status == ProgressStatus.finished
                ? 0
                : (progress?.positionSeconds ?? 0).round(),
          );
    final hasTrackList = book.audioTracks.length > 1;
    final isLocalDeviceBook = book.isLocalDevice;
    final localPaths = sample ? null : await downloads.audioPathsFor(book);
    final shouldUseTracks =
        isLocalDeviceBook ||
        (!sample && localPaths != null && localPaths.length > 1) ||
        hasTrackList;
    final initialIndex = shouldUseTracks
        ? _trackIndexForPosition(start.inSeconds, trackDurations)
        : 0;
    final initialTrackPosition = shouldUseTracks
        ? _trackPositionForWhole(start, initialIndex, trackDurations)
        : start;

    setState(() {
      playingBook = book;
      playingBookmarks = [];
      sampleMode = sample;
      nowPlayingOpen = true;
      restoringPlaybackPosition = start > Duration.zero;
      pendingPlaybackPosition = start;
      activeTrackIndex = initialIndex;
      position = initialTrackPosition;
      lastRenderedPositionSecond = initialTrackPosition.inSeconds;
    });
    unawaited(_loadPlayingBookmarks(book));

    try {
      if (isLocalDeviceBook && book.audioTracks.length == 1) {
        final path = book.audioTracks.first.path;
        if (path.startsWith('content:')) {
          await player.setAudioSource(AudioSource.uri(Uri.parse(path)));
        } else {
          await player.setFilePath(path);
        }
        if (start.inSeconds > 0) {
          await player.seek(start);
        }
      } else if (isLocalDeviceBook) {
        await player.setAudioSources(
          book.audioTracks
              .map(
                (track) => AudioSource.uri(
                  track.path.startsWith('content:')
                      ? Uri.parse(track.path)
                      : Uri.file(track.path),
                ),
              )
              .toList(),
          initialIndex: initialIndex,
          initialPosition: _trackPositionForWhole(
            start,
            initialIndex,
            trackDurations,
          ),
        );
      } else if (!sample && localPaths != null && localPaths.length == 1) {
        await player.setFilePath(localPaths.first);
        if (start.inSeconds > 0) {
          await player.seek(start);
        }
      } else if (!sample && localPaths != null && localPaths.length > 1) {
        await player.setAudioSources(
          localPaths.map((path) => AudioSource.uri(Uri.file(path))).toList(),
          initialIndex: initialIndex,
          initialPosition: _trackPositionForWhole(
            start,
            initialIndex,
            trackDurations,
          ),
        );
      } else if (hasTrackList) {
        await player.setAudioSources(
          List.generate(
            book.audioTracks.length,
            (index) => AudioSource.uri(
              Uri.parse(widget.api.audioTrackUrl(book.id, index)),
              headers: widget.api.authHeaders,
            ),
          ),
          initialIndex: initialIndex,
          initialPosition: _trackPositionForWhole(
            start,
            initialIndex,
            trackDurations,
          ),
        );
      } else {
        await player.setUrl(
          widget.api.audioUrl(book.id),
          headers: widget.api.authHeaders,
        );
        if (start.inSeconds > 0) {
          await player.seek(start);
        }
      }
    } finally {
      setStateSafe(() => restoringPlaybackPosition = false);
    }
    await player.play();
    if (sample) {
      Timer(const Duration(seconds: 30), () {
        if (sampleMode && playingBook?.id == book.id) {
          unawaited(player.pause());
        }
      });
    }
  }

  Future<void> _loadPlayingBookmarks(Book book) async {
    try {
      final bookmarks = book.isLocalDevice
          ? await localDeviceLibrary.loadBookmarks(book.id)
          : await widget.api.bookBookmarks(book.id);
      if (mounted && playingBook?.id == book.id) {
        setState(() => playingBookmarks = bookmarks);
      }
    } catch (_) {
      if (mounted && playingBook?.id == book.id) {
        setState(() => playingBookmarks = []);
      }
    }
  }

  Future<void> _addBookmark() async {
    final book = playingBook;
    if (book == null || restoringPlaybackPosition) return;
    try {
      final position = _displayPosition(book).inSeconds;
      final bookmark = book.isLocalDevice
          ? await localDeviceLibrary.createBookmark(book.id, position, _chapterTitleAt(book, position))
          : await widget.api.createBookBookmark(
              book.id,
              positionSeconds: position,
              title: _chapterTitleAt(book, position),
            );
      if (mounted) {
        setState(() => playingBookmarks = [...playingBookmarks, bookmark]..sort((a, b) => a.positionSeconds.compareTo(b.positionSeconds)));
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Bookmark saved.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not save bookmark: $error')));
      }
    }
  }

  Future<void> _deleteBookmark(BookBookmark bookmark) async {
    final book = playingBook;
    if (book == null) return;
    if (book.isLocalDevice) {
      await localDeviceLibrary.deleteBookmark(book.id, bookmark.id);
    } else {
      await widget.api.deleteBookBookmark(book.id, bookmark.id);
    }
    if (mounted) setState(() => playingBookmarks = playingBookmarks.where((item) => item.id != bookmark.id).toList());
  }

  String _chapterTitleAt(Book book, int seconds) {
    for (final chapter in book.chapters) {
      if (seconds >= chapter.startSeconds && seconds < chapter.endSeconds) return chapter.title;
    }
    return 'Bookmark at ${formatTime(Duration(seconds: seconds))}';
  }

  Future<void> _togglePlayback() async {
    if (castManager.isCasting) {
      await castManager.togglePlayback();
      return;
    }
    if (player.playing) {
      await player.pause();
    } else {
      await player.play();
    }
  }

  Future<void> _showCastPicker() async {
    final book = playingBook;
    if (book == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Start a book before casting.')),
        );
      }
      return;
    }
    try {
      await castManager.castBook(
        context,
        book,
        _displayPosition(book),
        playbackRate: player.speed,
      );
      await player.pause();
    } catch (exception) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Casting failed: $exception')));
      }
    }
  }

  Future<void> _setPlaybackRate(double rate) async {
    if (castManager.isCasting) {
      await castManager.setPlaybackRate(rate);
      return;
    }
    await player.setSpeed(rate);
  }

  Future<void> _saveProgress({bool forceFinished = false}) async {
    final book = playingBook;
    if (book == null || sampleMode) return;
    if (restoringPlaybackPosition && !forceFinished) return;
    final actualDuration = _wholeDuration(book).inSeconds;
    final positionSeconds = forceFinished
        ? actualDuration.toDouble()
        : _wholePosition(book, activeTrackIndex, position).inSeconds.toDouble();
    try {
      if (book.isLocalDevice) {
        final progress = await localDeviceLibrary.saveProgress(
          book.id,
          positionSeconds,
          actualDuration.toDouble(),
        );
        setStateSafe(() => progressByBook[book.id] = progress);
        return;
      }
      final progress = await widget.api.saveProgress(
        book.id,
        positionSeconds,
        actualDuration.toDouble(),
      );
      setStateSafe(() => progressByBook[book.id] = progress);
    } catch (_) {}
  }

  Future<void> _markFinished(Book book) async {
    final durationSeconds =
        (book.durationSeconds ?? progressByBook[book.id]?.durationSeconds ?? 1)
            .toDouble();
    if (book.isLocalDevice) {
      final progress = await localDeviceLibrary.saveProgress(
        book.id,
        durationSeconds,
        durationSeconds,
      );
      setState(() => progressByBook[book.id] = progress);
      return;
    }
    final progress = await widget.api.saveProgress(
      book.id,
      durationSeconds,
      durationSeconds,
    );
    setState(() => progressByBook[book.id] = progress);
  }

  Future<void> _clearProgress(Book book) async {
    if (book.isLocalDevice) {
      final progress = await localDeviceLibrary.saveProgress(
        book.id,
        0,
        (book.durationSeconds ?? progressByBook[book.id]?.durationSeconds)
            ?.toDouble(),
      );
      setState(() => progressByBook[book.id] = progress);
      return;
    }
    final progress = await widget.api.saveProgress(
      book.id,
      0,
      (book.durationSeconds ?? progressByBook[book.id]?.durationSeconds)
          ?.toDouble(),
    );
    setState(() => progressByBook[book.id] = progress);
  }

  List<Duration> _trackDurations(Book book) => book.audioTracks
      .map((track) => Duration(seconds: track.durationSeconds ?? 0))
      .toList();

  Duration _wholeDuration(Book book) {
    if (book.durationSeconds != null && book.durationSeconds! > 0) {
      return Duration(seconds: book.durationSeconds!);
    }
    final total = _trackDurations(
      book,
    ).fold<Duration>(Duration.zero, (sum, item) => sum + item);
    return total > Duration.zero ? total : duration;
  }

  Duration _wholePosition(Book book, int trackIndex, Duration trackPosition) {
    final tracks = _trackDurations(book);
    if (tracks.length <= 1) return trackPosition;
    final offset = tracks
        .take(trackIndex)
        .fold<Duration>(Duration.zero, (sum, item) => sum + item);
    return offset + trackPosition;
  }

  Duration _displayPosition(Book book) {
    if (castManager.isCasting && playingBook?.id == book.id) {
      return castManager.position;
    }
    if (restoringPlaybackPosition && playingBook?.id == book.id) {
      return pendingPlaybackPosition;
    }
    return _wholePosition(book, activeTrackIndex, position);
  }

  Future<void> _seekWhole(Book book, Duration wholePosition) async {
    if (castManager.isCasting) {
      await castManager.seek(wholePosition);
      return;
    }
    final tracks = _trackDurations(book);
    if (tracks.length <= 1) {
      await player.seek(wholePosition);
      return;
    }
    final index = _trackIndexForPosition(wholePosition.inSeconds, tracks);
    await player.seek(
      _trackPositionForWhole(wholePosition, index, tracks),
      index: index,
    );
  }

  Future<void> _download(Book book) async {
    if (book.isLocalDevice) return;
    downloads.beginDownload(book.id);
    setState(() => downloadProgress[book.id] = 0);
    try {
      String? verifiedLocalAddress;
      if (librarySourceMode == LibrarySourceMode.remoteAccess &&
          localNetworkAddress.trim().isNotEmpty &&
          await widget.api.isReachableAt(localNetworkAddress)) {
        verifiedLocalAddress = localNetworkAddress;
      }
      await downloads.saveBook(
        book,
        widget.api,
        (percent) => setStateSafe(() => downloadProgress[book.id] = percent),
        verifiedLocalAddress,
      );
      setState(() {
        downloadedBookIds = downloads.bookIds;
        downloadProgress.remove(book.id);
      });
    } catch (exception) {
      setState(() => downloadProgress.remove(book.id));
      if (exception is DownloadCancelled || downloads.wasCancelled(book.id)) {
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(exception.toString().replaceFirst('Exception: ', '')),
          ),
        );
      }
    }
  }

  Future<void> _removeDownload(Book book) async {
    if (downloadProgress.containsKey(book.id)) {
      await downloads.cancel(book.id);
      if (mounted) {
        setState(() {
          downloadProgress.remove(book.id);
          downloadedBookIds = downloads.bookIds;
        });
      }
      return;
    }
    await downloads.remove(book.id);
    setState(() => downloadedBookIds = downloads.bookIds);
  }

  Future<void> _addToLibrary(Book book) async {
    if (book.isLocalDevice) {
      await localDeviceLibrary.addToLibrary(book.id);
      await _loadAll();
      return;
    }
    await widget.api.addToLibrary(book.id);
    await _loadAll();
  }

  Future<void> _removeFromLibrary(Book book) async {
    if (book.isLocalDevice) {
      await localDeviceLibrary.removeFromLibrary(book.id);
      await _loadAll();
      return;
    }
    await widget.api.removeFromLibrary(book.id);
    await _loadAll();
  }

  Future<void> _changeLibrarySource(LibrarySourceMode mode) async {
    await localDeviceLibrary.saveSource(mode);
    if (mirroredSourceStore.userId != localDeviceLibrary.userId) {
      await mirroredSourceStore.saveSource(mode);
    }
    if (mode == LibrarySourceMode.localDevice &&
        widget.user.id != _guestLocalDeviceUserId) {
      await widget.api.clearSession();
      widget.onUserChanged(await mirroredSourceStore.loadGuestUser());
      return;
    }
    if (localDeviceLibrary.userId == _guestLocalDeviceUserId &&
        mode != LibrarySourceMode.localDevice) {
      await _logout();
      return;
    }
    await _loadAll();
  }

  Future<void> _saveLibrarySourceAddress(
    LibrarySourceMode mode,
    String address,
  ) async {
    await localDeviceLibrary.saveSourceAddress(mode, address);
    if (mirroredSourceStore.userId != localDeviceLibrary.userId) {
      await mirroredSourceStore.saveSourceAddress(mode, address);
    }
    if (mode == librarySourceMode) {
      await _applyApiServerForSource(
        mode,
        await localDeviceLibrary.loadSourceAddresses(),
      );
    }
    await _loadAll();
  }

  Future<void> _applyApiServerForSource(
    LibrarySourceMode mode,
    LibrarySourceAddresses addresses,
  ) async {
    final address = switch (mode) {
      LibrarySourceMode.remoteAccess => addresses.remoteAccessAddress,
      LibrarySourceMode.localNetwork => addresses.localNetworkAddress,
      LibrarySourceMode.localDevice => widget.api.serverUrl,
    };
    if (mode != LibrarySourceMode.localDevice && address.trim().isNotEmpty) {
      await widget.api.setServerUrl(address.trim());
    }
  }

  Future<LocalDeviceScanState> _pickLocalAudiobookFolder() async {
    final scanState = await localDeviceLibrary.chooseAndScan();
    await _loadAll();
    return scanState;
  }

  Future<LocalDeviceScanState> _scanLocalAudiobooks() async {
    final scanState = await localDeviceLibrary.scan();
    await _loadAll();
    return scanState;
  }

  Future<void> _addBookToShelf(Book book) async {
    if (shelves.isEmpty) {
      await _createShelf();
      if (shelves.isEmpty) return;
    }
    if (!mounted) return;
    final shelf = await showModalBottomSheet<Shelf>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: Text(
                'Add to Shelf',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            ...shelves.map(
              (shelf) => ListTile(
                leading: const Icon(Icons.label_outline),
                title: Text(shelf.name),
                onTap: () => Navigator.pop(context, shelf),
              ),
            ),
          ],
        ),
      ),
    );
    if (shelf == null) return;
    await widget.api.addBookToShelf(shelf.id, book.id);
    final shelfBooks = await widget.api.shelfBooks(shelf.id);
    if (!mounted) return;
    setState(() {
      shelfBookCounts = {...shelfBookCounts, shelf.id: shelfBooks.length};
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Added ${book.title} to ${shelf.name}.')),
    );
  }

  Future<void> _removeBookFromShelf(Book book) async {
    final shelf = activeShelf;
    if (shelf == null) return;
    await widget.api.removeBookFromShelf(shelf.id, book.id);
    final shelfBooks = await widget.api.shelfBooks(shelf.id);
    if (!mounted) return;
    setState(() {
      activeShelfBooks = sortBooks(shelfBooks);
      shelfBookCounts = {...shelfBookCounts, shelf.id: shelfBooks.length};
    });
  }

  Future<void> _logout() async {
    if (widget.user.id == _guestLocalDeviceUserId) {
      await widget.api.clearSession();
    } else {
      await widget.api.logout();
    }
    widget.onUserChanged(null);
  }

  @override
  Widget build(BuildContext context) {
    final title = pageTitle();
    return Scaffold(
      backgroundColor: storeMode
          ? storeBackgroundFor(context)
          : Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            MobileTopBar(
              title: title,
              storeMode: storeMode,
              user: widget.user,
              searchController: searchController,
              onSearchChanged: (_) => setState(() {}),
              onHome: () => _navigate(AppSection.home),
              onStoreToggle: () =>
                  _navigate(AppSection.home, toStore: !storeMode),
              onSettings: () =>
                  _navigate(AppSection.settings, toStore: storeMode),
              onAccount: _showAccountSheet,
              onCast: _showCastPicker,
            ),
            Expanded(
              child: loading
                  ? const Center(child: CircularProgressIndicator())
                  : error != null
                  ? RetryState(message: error!, onRetry: _loadAll)
                  : selectedBook != null
                  ? BookDetailPage(
                      api: widget.api,
                      user: widget.user,
                      book: selectedBook!,
                      inStore: storeMode,
                      inLibrary: libraryBooks.any(
                        (book) => book.id == selectedBook!.id,
                      ),
                      progress: progressByBook[selectedBook!.id],
                      onBack: () => setState(() => selectedBook = null),
                      onPlay: () => _play(selectedBook!),
                      onSample: () => _play(selectedBook!, sample: true),
                      onAdd: () => _addToLibrary(selectedBook!),
                      onRemove: () => _removeFromLibrary(selectedBook!),
                      onAddToShelf: () => _addBookToShelf(selectedBook!),
                      canEditMetadata:
                          widget.user.role == UserRole.admin ||
                          widget.user.metadataEditorEnabled,
                      onBookUpdated: _applyBookUpdate,
                      onFindMetadata: () => _findBookMetadata(selectedBook!),
                      onSaveMetadata: (input) =>
                          _saveBookMetadata(selectedBook!, input),
                    )
                  : _buildSection(),
            ),
            if (playingBook != null && !nowPlayingOpen)
              MiniPlayer(
                book: playingBook!,
                position: _displayPosition(playingBook!),
                duration: _wholeDuration(playingBook!),
                playing: castManager.isCasting
                    ? castManager.playing
                    : player.playing,
                onOpen: () => setState(() => nowPlayingOpen = true),
                onToggle: _togglePlayback,
                onSkip: restoringPlaybackPosition
                    ? null
                    : (seconds) => _seekWhole(
                        playingBook!,
                        _displayPosition(playingBook!) +
                            Duration(seconds: seconds),
                      ),
              ),
          ],
        ),
      ),
      bottomNavigationBar: selectedBook == null || !nowPlayingOpen
          ? StoryBottomNav(
              section: section,
              storeMode: storeMode,
              onSelected: (next) => _navigate(next, toStore: storeMode),
            )
          : null,
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      floatingActionButtonAnimator: FloatingActionButtonAnimator.noAnimation,
      floatingActionButton: nowPlayingOpen && playingBook != null
          ? NowPlayingPanel(
              book: playingBook!,
              position: _displayPosition(playingBook!),
              duration: _wholeDuration(playingBook!),
              playing: castManager.isCasting
                  ? castManager.playing
                  : player.playing,
              onClose: () => setState(() => nowPlayingOpen = false),
              onSeek: restoringPlaybackPosition
                  ? null
                  : (nextPosition) => _seekWhole(playingBook!, nextPosition),
              onToggle: _togglePlayback,
              onSkip: restoringPlaybackPosition
                  ? null
                  : (seconds) => _seekWhole(
                      playingBook!,
                      _displayPosition(playingBook!) +
                          Duration(seconds: seconds),
                    ),
              onRate: (rate) => unawaited(_setPlaybackRate(rate)),
              speed: castManager.isCasting
                  ? castManager.playbackRate
                  : player.speed,
              restoringPosition: restoringPlaybackPosition,
              bookmarks: playingBookmarks,
              onAddBookmark: _addBookmark,
              onDeleteBookmark: _deleteBookmark,
              onChapter: (seconds) => _seekWhole(playingBook!, Duration(seconds: seconds)),
              onBookmark: (seconds) => _seekWhole(playingBook!, Duration(seconds: seconds)),
            )
          : null,
    );
  }

  String pageTitle() {
    if (storeMode) {
      return switch (section) {
        AppSection.home => 'Store ${storeBooks.length}',
        AppSection.library => 'Store Books',
        AppSection.series => 'Store Series',
        AppSection.authors => 'Store Authors',
        AppSection.shelves => 'Store',
        AppSection.downloads => 'Downloads',
        AppSection.settings => 'Settings',
      };
    }
    return switch (section) {
      AppSection.home => 'Home ${libraryBooks.length}',
      AppSection.library => 'Library',
      AppSection.series => 'Series',
      AppSection.authors => 'Authors',
      AppSection.shelves => 'Shelves',
      AppSection.downloads => 'Downloads',
      AppSection.settings => 'Settings',
    };
  }

  Widget _buildSection() {
    final query = searchController.text.trim().toLowerCase();
    final books = activeShelf != null
        ? activeShelfBooks
        : visibleBooks.where((book) => book.matches(query)).toList();
    final child = switch (section) {
      AppSection.home => HomePage(
        books: books,
        progressByBook: progressByBook,
        downloadedBookIds: downloadedBookIds,
        downloadProgress: downloadProgress,
        storeMode: storeMode,
        featuredBook: featuredStoreBook,
        onBook: _selectBook,
        onPlay: (book) => _play(book, sample: storeMode),
        onDownload: _download,
        onRemoveDownload: _removeDownload,
        onAdd: _addToLibrary,
        onRemove: _removeFromLibrary,
        onMarkFinished: _markFinished,
        onClearProgress: _clearProgress,
        onAddToShelf: _addBookToShelf,
      ),
      AppSection.library => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          BookSortBar(
            sortKey: storeMode ? storeSortKey : librarySortKey,
            direction: storeMode ? storeSortDirection : librarySortDirection,
            storeMode: storeMode,
            onKeyChanged: (key) => setState(() {
              if (storeMode) {
                storeSortKey = key;
              } else {
                librarySortKey = key;
              }
            }),
            onSwapDirection: () => setState(() {
              if (storeMode) {
                storeSortDirection = storeSortDirection.flipped;
              } else {
                librarySortDirection = librarySortDirection.flipped;
              }
            }),
          ),
          const SizedBox(height: 14),
          BooksGrid(
            books: sortBooksForDisplay(
              books,
              storeMode ? storeSortKey : librarySortKey,
              storeMode ? storeSortDirection : librarySortDirection,
            ),
            progressByBook: progressByBook,
            downloadedBookIds: downloadedBookIds,
            downloadProgress: downloadProgress,
            storeMode: storeMode,
            onBook: _selectBook,
            onPlay: (book) => _play(book, sample: storeMode),
            onDownload: _download,
            onRemoveDownload: _removeDownload,
            onAdd: _addToLibrary,
            onRemove: _removeFromLibrary,
            onMarkFinished: _markFinished,
            onClearProgress: _clearProgress,
            onAddToShelf: _addBookToShelf,
          ),
        ],
      ),
      AppSection.series => GroupPage(
        title: activeShelf?.name,
        groups: groupsFor(books, GroupMode.series),
        activeGroup: activeGroup,
        storeMode: storeMode,
        onOpen: (group) => setState(
          () => activeGroup = group.copyWith(books: sortSeries(group.books)),
        ),
        onBack: () => setState(() => activeGroup = null),
        onAddAll: (group) async {
          for (final book in group.books) {
            await widget.api.addToLibrary(book.id);
          }
          await _loadAll();
        },
        onRemoveAll: (group) => _confirmRemoveGroup(group),
        onBook: _selectBook,
        progressByBook: progressByBook,
        downloadedBookIds: downloadedBookIds,
        downloadProgress: downloadProgress,
        onPlay: (book) => _play(book, sample: storeMode),
        onDownload: _download,
        onRemoveDownload: _removeDownload,
        onAdd: _addToLibrary,
        onRemove: _removeFromLibrary,
        onMarkFinished: _markFinished,
        onClearProgress: _clearProgress,
        onAddToShelf: _addBookToShelf,
      ),
      AppSection.authors => GroupPage(
        groups: groupsFor(books, GroupMode.author),
        activeGroup: activeGroup,
        storeMode: storeMode,
        onOpen: (group) => setState(
          () => activeGroup = group.copyWith(books: sortBooks(group.books)),
        ),
        onBack: () => setState(() => activeGroup = null),
        onAddAll: (group) async {
          for (final book in group.books) {
            await widget.api.addToLibrary(book.id);
          }
          await _loadAll();
        },
        onRemoveAll: (group) => _confirmRemoveGroup(group),
        onBook: _selectBook,
        progressByBook: progressByBook,
        downloadedBookIds: downloadedBookIds,
        downloadProgress: downloadProgress,
        onPlay: (book) => _play(book, sample: storeMode),
        onDownload: _download,
        onRemoveDownload: _removeDownload,
        onAdd: _addToLibrary,
        onRemove: _removeFromLibrary,
        onMarkFinished: _markFinished,
        onClearProgress: _clearProgress,
        onAddToShelf: _addBookToShelf,
      ),
      AppSection.shelves => ShelvesPage(
        activeShelf: activeShelf,
        activeShelfBooks: activeShelfBooks,
        progressByBook: progressByBook,
        downloadedBookIds: downloadedBookIds,
        downloadProgress: downloadProgress,
        shelves: shelves,
        shelfBookCounts: shelfBookCounts,
        onOpen: _openShelf,
        onBack: () => setState(() {
          activeShelf = null;
          activeShelfBooks = [];
        }),
        onBook: _selectBook,
        onPlay: _play,
        onDownload: _download,
        onRemoveDownload: _removeDownload,
        onAdd: _addToLibrary,
        onRemove: _removeFromLibrary,
        onMarkFinished: _markFinished,
        onClearProgress: _clearProgress,
        onAddToShelf: _addBookToShelf,
        onRemoveFromShelf: _removeBookFromShelf,
        onCreate: _createShelf,
      ),
      AppSection.downloads => DownloadsPage(
        books: libraryBooks
            .where((book) => downloadedBookIds.contains(book.id))
            .toList(),
        progressByBook: progressByBook,
        onBook: _selectBook,
        onPlay: _play,
        onRemoveDownload: _removeDownload,
        onMarkFinished: _markFinished,
        onClearProgress: _clearProgress,
      ),
      AppSection.settings => SettingsPage(
        api: widget.api,
        user: widget.user,
        showAdminControls: storeMode && widget.user.role == UserRole.admin,
        localDeviceLibrary: localDeviceLibrary,
        librarySourceMode: librarySourceMode,
        localScanState: localScanState,
        remoteAccessAddress: remoteAccessAddress,
        localNetworkAddress: localNetworkAddress,
        onLibrarySourceChanged: _changeLibrarySource,
        onSourceAddressSaved: _saveLibrarySourceAddress,
        onPickLocalFolder: _pickLocalAudiobookFolder,
        onScanLocalAudiobooks: _scanLocalAudiobooks,
        onUserChanged: widget.onUserChanged,
        onLogout: _logout,
      ),
    };
    return SingleChildScrollView(
      controller: pageController,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 78),
      child: child,
    );
  }

  Future<void> _createShelf() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New Shelf'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Shelf name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    await widget.api.createShelf(name);
    await _loadAll();
  }

  Future<void> _confirmRemoveGroup(BookGroup group) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${group.books.length} books?'),
        content: Text(
          'This will remove every book in ${group.name} from your library.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    for (final book in group.books) {
      await widget.api.removeFromLibrary(book.id);
    }
    await _loadAll();
  }

  Future<void> _showAccountSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                widget.user.name,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(widget.user.email ?? widget.user.username ?? ''),
              const SizedBox(height: 12),
              Text('Role: ${widget.user.role.name}'),
              const SizedBox(height: 18),
              OutlinedButton(onPressed: _logout, child: const Text('Sign Out')),
            ],
          ),
        ),
      ),
    );
  }
}

class MobileTopBar extends StatelessWidget {
  const MobileTopBar({
    super.key,
    required this.title,
    required this.storeMode,
    required this.user,
    required this.searchController,
    required this.onSearchChanged,
    required this.onHome,
    required this.onStoreToggle,
    required this.onSettings,
    required this.onAccount,
    required this.onCast,
  });

  final String title;
  final bool storeMode;
  final User user;
  final TextEditingController searchController;
  final ValueChanged<String> onSearchChanged;
  final VoidCallback onHome;
  final VoidCallback onStoreToggle;
  final VoidCallback onSettings;
  final VoidCallback onAccount;
  final VoidCallback onCast;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final opensStore = !storeMode;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: storeMode
            ? _StoryShellState.storeSurfaceFor(context)
            : Theme.of(context).cardColor,
        border: Border(
          bottom: BorderSide(
            color: storeMode
                ? _StoryShellState.storeBorderFor(context)
                : Theme.of(context).colorScheme.outlineVariant,
          ),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 6, 14, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                GestureDetector(
                  onTap: onHome,
                  child: const StoryLogo(size: 30),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.headlineMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                CompactTopButton(
                  onPressed: onStoreToggle,
                  icon: Icon(
                    storeMode ? Icons.library_books : Icons.storefront,
                  ),
                  tooltip: storeMode ? 'My Library' : 'Store',
                  wide: true,
                  filled: true,
                  backgroundColor: opensStore ? const Color(0xffffc55c) : null,
                  foregroundColor: opensStore ? const Color(0xff332100) : null,
                  borderColor: opensStore
                      ? colorScheme.secondary.withValues(alpha: 0.7)
                      : null,
                ),
                const SizedBox(width: 5),
                CompactTopButton(
                  onPressed: onCast,
                  icon: const Icon(Icons.cast_outlined),
                  tooltip: 'Cast',
                ),
                const SizedBox(width: 5),
                CompactTopButton(
                  onPressed: onAccount,
                  icon: const Icon(Icons.person_outline),
                  tooltip: user.name,
                ),
                const SizedBox(width: 5),
                CompactTopButton(
                  onPressed: onSettings,
                  icon: const Icon(Icons.settings_outlined),
                  tooltip: 'Settings',
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: searchController,
              onChanged: onSearchChanged,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search books, authors, narrators',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class StoryLogo extends StatelessWidget {
  const StoryLogo({super.key, this.size = 36});
  final double size;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.22),
      child: Image.asset(
        'assets/story-stack-logo.png',
        width: size,
        height: size,
        fit: BoxFit.contain,
      ),
    );
  }
}

class CompactTopButton extends StatelessWidget {
  const CompactTopButton({
    super.key,
    required this.onPressed,
    required this.icon,
    required this.tooltip,
    this.filled = false,
    this.wide = false,
    this.backgroundColor,
    this.foregroundColor,
    this.borderColor,
  });

  final VoidCallback onPressed;
  final Widget icon;
  final String tooltip;
  final bool filled;
  final bool wide;
  final Color? backgroundColor;
  final Color? foregroundColor;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final controlSize = wide ? _compactControlSize * 2 : _compactControlSize;
    final style = IconButton.styleFrom(
      fixedSize: Size(controlSize, _compactControlSize),
      minimumSize: Size(controlSize, _compactControlSize),
      padding: EdgeInsets.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
      backgroundColor: backgroundColor,
      foregroundColor: foregroundColor,
      side: borderColor == null ? null : BorderSide(color: borderColor!),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    );

    return filled
        ? IconButton.filledTonal(
            onPressed: onPressed,
            icon: icon,
            tooltip: tooltip,
            style: style,
          )
        : IconButton.outlined(
            onPressed: onPressed,
            icon: icon,
            tooltip: tooltip,
            style: style,
          );
  }
}

class StoryBottomNav extends StatelessWidget {
  const StoryBottomNav({
    super.key,
    required this.section,
    required this.storeMode,
    required this.onSelected,
  });
  final AppSection section;
  final bool storeMode;
  final ValueChanged<AppSection> onSelected;

  @override
  Widget build(BuildContext context) {
    final sections = storeMode
        ? const [
            AppSection.home,
            AppSection.library,
            AppSection.series,
            AppSection.authors,
          ]
        : const [
            AppSection.home,
            AppSection.library,
            AppSection.series,
            AppSection.authors,
            AppSection.shelves,
            AppSection.downloads,
          ];
    final selectedIndex = sections.indexOf(section);
    return NavigationBar(
      backgroundColor: storeMode
          ? _StoryShellState.storeSurfaceFor(context)
          : Theme.of(context).cardColor,
      indicatorColor: storeMode
          ? _StoryShellState.storeSelectedFor(context)
          : Theme.of(context).colorScheme.primaryContainer,
      selectedIndex: selectedIndex < 0 ? 0 : selectedIndex,
      onDestinationSelected: (index) => onSelected(sections[index]),
      destinations: [
        NavigationDestination(
          icon: const Icon(Icons.home_outlined),
          selectedIcon: const Icon(Icons.home),
          label: 'Home',
        ),
        NavigationDestination(
          icon: const Icon(Icons.library_books_outlined),
          selectedIcon: const Icon(Icons.library_books),
          label: storeMode ? 'Books' : 'Library',
        ),
        const NavigationDestination(
          icon: Icon(Icons.bookmark_border),
          selectedIcon: Icon(Icons.bookmark),
          label: 'Series',
        ),
        const NavigationDestination(
          icon: Icon(Icons.people_outline),
          selectedIcon: Icon(Icons.people),
          label: 'Authors',
        ),
        if (!storeMode)
          const NavigationDestination(
            icon: Icon(Icons.label_outline),
            selectedIcon: Icon(Icons.label),
            label: 'Shelves',
          ),
        if (!storeMode)
          const NavigationDestination(
            icon: Icon(Icons.download_outlined),
            selectedIcon: Icon(Icons.download),
            label: 'Offline',
          ),
      ],
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({
    super.key,
    required this.books,
    required this.progressByBook,
    required this.downloadedBookIds,
    required this.downloadProgress,
    required this.storeMode,
    required this.featuredBook,
    required this.onBook,
    required this.onPlay,
    required this.onDownload,
    required this.onRemoveDownload,
    required this.onAdd,
    required this.onRemove,
    required this.onMarkFinished,
    required this.onClearProgress,
    this.onAddToShelf,
    this.onRemoveFromShelf,
  });

  final List<Book> books;
  final Map<String, PlaybackProgress> progressByBook;
  final Set<String> downloadedBookIds;
  final Map<String, double?> downloadProgress;
  final bool storeMode;
  final Book? featuredBook;
  final ValueChanged<Book> onBook;
  final ValueChanged<Book> onPlay;
  final ValueChanged<Book> onDownload;
  final ValueChanged<Book> onRemoveDownload;
  final ValueChanged<Book> onAdd;
  final ValueChanged<Book> onRemove;
  final ValueChanged<Book> onMarkFinished;
  final ValueChanged<Book> onClearProgress;
  final ValueChanged<Book>? onAddToShelf;
  final ValueChanged<Book>? onRemoveFromShelf;

  @override
  Widget build(BuildContext context) {
    final recent = books.take(12).toList();
    final series = groupsFor(
      books,
      GroupMode.series,
    ).take(8).expand((group) => group.books.take(1)).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (storeMode && featuredBook != null)
          StoreHero(
            book: featuredBook!,
            onBook: onBook,
            onSample: onPlay,
            onAdd: onAdd,
          ),
        SectionHeader(title: storeMode ? 'New in Store' : 'Recently Added'),
        BooksStrip(
          books: recent,
          progressByBook: progressByBook,
          downloadedBookIds: downloadedBookIds,
          downloadProgress: downloadProgress,
          storeMode: storeMode,
          onBook: onBook,
          onPlay: onPlay,
          onDownload: onDownload,
          onRemoveDownload: onRemoveDownload,
          onAdd: onAdd,
          onRemove: onRemove,
          onMarkFinished: onMarkFinished,
          onClearProgress: onClearProgress,
          onAddToShelf: onAddToShelf,
        ),
        const SizedBox(height: 16),
        SectionHeader(title: 'Recent Series'),
        BooksStrip(
          books: series,
          progressByBook: progressByBook,
          downloadedBookIds: downloadedBookIds,
          downloadProgress: downloadProgress,
          storeMode: storeMode,
          onBook: onBook,
          onPlay: onPlay,
          onDownload: onDownload,
          onRemoveDownload: onRemoveDownload,
          onAdd: onAdd,
          onRemove: onRemove,
          onMarkFinished: onMarkFinished,
          onClearProgress: onClearProgress,
          onAddToShelf: onAddToShelf,
        ),
      ],
    );
  }
}

class StoreHero extends StatelessWidget {
  const StoreHero({
    super.key,
    required this.book,
    required this.onBook,
    required this.onSample,
    required this.onAdd,
  });
  final Book book;
  final ValueChanged<Book> onBook;
  final ValueChanged<Book> onSample;
  final ValueChanged<Book> onAdd;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: _StoryShellState.storeHeroColorsFor(context),
        ),
        border: Border.all(color: _StoryShellState.storeBorderFor(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Find your next listen',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              SizedBox(
                width: 112,
                child: BookCover(
                  api: StoryStackApi.current,
                  book: book,
                  progressPercent: null,
                  finished: false,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'FEATURED LISTEN',
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        color: _StoryShellState.storeAccentFor(context),
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      book.title,
                      style: Theme.of(context).textTheme.headlineMedium,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      book.author,
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                    Wrap(
                      spacing: 8,
                      children: [
                        OutlinedButton(
                          onPressed: () => onSample(book),
                          child: const Text('Sample'),
                        ),
                        FilledButton.icon(
                          onPressed: () => onAdd(book),
                          icon: const Icon(Icons.add),
                          label: const Text('Add'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class BookSortBar extends StatelessWidget {
  const BookSortBar({
    super.key,
    required this.sortKey,
    required this.direction,
    required this.storeMode,
    required this.onKeyChanged,
    required this.onSwapDirection,
  });

  final BookSortKey sortKey;
  final SortDirection direction;
  final bool storeMode;
  final ValueChanged<BookSortKey> onKeyChanged;
  final VoidCallback onSwapDirection;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: SizedBox(
            height: _compactControlSize,
            child: DecoratedBox(
              decoration: BoxDecoration(
                border: Border.all(
                  color: storeMode
                      ? _StoryShellState.storeBorderFor(context)
                      : Theme.of(context).colorScheme.outlineVariant,
                ),
                borderRadius: BorderRadius.circular(8),
                color: storeMode
                    ? _StoryShellState.storeSurfaceFor(context)
                    : Theme.of(context).cardColor,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<BookSortKey>(
                    value: sortKey,
                    isExpanded: true,
                    isDense: true,
                    icon: const Icon(Icons.expand_more),
                    items: BookSortKey.values
                        .map(
                          (key) => DropdownMenuItem(
                            value: key,
                            child: Text('Sort: ${key.label}'),
                          ),
                        )
                        .toList(),
                    onChanged: (key) {
                      if (key != null) onKeyChanged(key);
                    },
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        CompactTopButton(
          onPressed: onSwapDirection,
          icon: Icon(
            direction == SortDirection.ascending ? Icons.south : Icons.north,
          ),
          tooltip: direction == SortDirection.ascending
              ? 'Ascending'
              : 'Descending',
        ),
      ],
    );
  }
}

class BooksGrid extends StatelessWidget {
  const BooksGrid({
    super.key,
    required this.books,
    required this.progressByBook,
    required this.downloadedBookIds,
    required this.downloadProgress,
    required this.storeMode,
    required this.onBook,
    required this.onPlay,
    required this.onDownload,
    required this.onRemoveDownload,
    required this.onAdd,
    required this.onRemove,
    required this.onMarkFinished,
    required this.onClearProgress,
    this.onAddToShelf,
    this.onRemoveFromShelf,
  });

  final List<Book> books;
  final Map<String, PlaybackProgress> progressByBook;
  final Set<String> downloadedBookIds;
  final Map<String, double?> downloadProgress;
  final bool storeMode;
  final ValueChanged<Book> onBook;
  final ValueChanged<Book> onPlay;
  final ValueChanged<Book> onDownload;
  final ValueChanged<Book> onRemoveDownload;
  final ValueChanged<Book> onAdd;
  final ValueChanged<Book> onRemove;
  final ValueChanged<Book> onMarkFinished;
  final ValueChanged<Book> onClearProgress;
  final ValueChanged<Book>? onAddToShelf;
  final ValueChanged<Book>? onRemoveFromShelf;

  @override
  Widget build(BuildContext context) {
    if (books.isEmpty) {
      return const EmptyState(message: 'No books here yet.');
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 700 ? 4 : 2;
        final compact = constraints.maxWidth < 430;
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: books.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            childAspectRatio: compact ? 0.68 : 0.74,
            crossAxisSpacing: compact ? 10 : 14,
            mainAxisSpacing: compact ? 12 : 14,
          ),
          itemBuilder: (context, index) {
            final book = books[index];
            return BookCard(
              book: book,
              progress: progressByBook[book.id],
              downloaded: downloadedBookIds.contains(book.id),
              downloadProgress: downloadProgress[book.id],
              storeMode: storeMode,
              onOpen: () => onBook(book),
              onPlay: () => onPlay(book),
              onDownload: () => onDownload(book),
              onRemoveDownload: () => onRemoveDownload(book),
              onAdd: () => onAdd(book),
              onRemove: () => onRemove(book),
              onMarkFinished: () => onMarkFinished(book),
              onClearProgress: () => onClearProgress(book),
              onAddToShelf: onAddToShelf == null
                  ? null
                  : () => onAddToShelf!(book),
              onRemoveFromShelf: onRemoveFromShelf == null
                  ? null
                  : () => onRemoveFromShelf!(book),
            );
          },
        );
      },
    );
  }
}

class BooksStrip extends StatelessWidget {
  const BooksStrip({
    super.key,
    required this.books,
    required this.progressByBook,
    required this.downloadedBookIds,
    required this.downloadProgress,
    required this.storeMode,
    required this.onBook,
    required this.onPlay,
    required this.onDownload,
    required this.onRemoveDownload,
    required this.onAdd,
    required this.onRemove,
    required this.onMarkFinished,
    required this.onClearProgress,
    this.onAddToShelf,
    this.onRemoveFromShelf,
  });

  final List<Book> books;
  final Map<String, PlaybackProgress> progressByBook;
  final Set<String> downloadedBookIds;
  final Map<String, double?> downloadProgress;
  final bool storeMode;
  final ValueChanged<Book> onBook;
  final ValueChanged<Book> onPlay;
  final ValueChanged<Book> onDownload;
  final ValueChanged<Book> onRemoveDownload;
  final ValueChanged<Book> onAdd;
  final ValueChanged<Book> onRemove;
  final ValueChanged<Book> onMarkFinished;
  final ValueChanged<Book> onClearProgress;
  final ValueChanged<Book>? onAddToShelf;
  final ValueChanged<Book>? onRemoveFromShelf;

  @override
  Widget build(BuildContext context) {
    if (books.isEmpty) {
      return const EmptyState(message: 'No books here yet.');
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 430;
        final cardWidth = compact ? 158.0 : 182.0;
        final cardHeight = compact ? 258.0 : 286.0;

        return SizedBox(
          height: cardHeight,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            clipBehavior: Clip.none,
            itemCount: books.length,
            separatorBuilder: (_, index) => SizedBox(width: compact ? 10 : 12),
            itemBuilder: (context, index) {
              final book = books[index];
              return SizedBox(
                width: cardWidth,
                child: BookCard(
                  book: book,
                  progress: progressByBook[book.id],
                  downloaded: downloadedBookIds.contains(book.id),
                  downloadProgress: downloadProgress[book.id],
                  storeMode: storeMode,
                  onOpen: () => onBook(book),
                  onPlay: () => onPlay(book),
                  onDownload: () => onDownload(book),
                  onRemoveDownload: () => onRemoveDownload(book),
                  onAdd: () => onAdd(book),
                  onRemove: () => onRemove(book),
                  onMarkFinished: () => onMarkFinished(book),
                  onClearProgress: () => onClearProgress(book),
                  onAddToShelf: onAddToShelf == null
                      ? null
                      : () => onAddToShelf!(book),
                ),
              );
            },
          ),
        );
      },
    );
  }
}

class BookCard extends StatelessWidget {
  const BookCard({
    super.key,
    required this.book,
    required this.progress,
    required this.downloaded,
    required this.downloadProgress,
    required this.storeMode,
    required this.onOpen,
    required this.onPlay,
    required this.onDownload,
    required this.onRemoveDownload,
    required this.onAdd,
    required this.onRemove,
    required this.onMarkFinished,
    required this.onClearProgress,
    this.onAddToShelf,
    this.onRemoveFromShelf,
  });

  final Book book;
  final PlaybackProgress? progress;
  final bool downloaded;
  final double? downloadProgress;
  final bool storeMode;
  final VoidCallback onOpen;
  final VoidCallback onPlay;
  final VoidCallback onDownload;
  final VoidCallback onRemoveDownload;
  final VoidCallback onAdd;
  final VoidCallback onRemove;
  final VoidCallback onMarkFinished;
  final VoidCallback onClearProgress;
  final VoidCallback? onAddToShelf;
  final VoidCallback? onRemoveFromShelf;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: storeMode ? _StoryShellState.storeSurfaceAltFor(context) : null,
      margin: EdgeInsets.zero,
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              BookCover(
                api: StoryStackApi.current,
                book: book,
                progressPercent: progressPercentFor(book, progress),
                finished: progress?.status == ProgressStatus.finished,
              ),
              const SizedBox(height: 6),
              Text(
                book.title,
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(height: 1.0),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 1),
              Text(
                book.author,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.bodyMedium?.copyWith(height: 1.0),
              ),
              const Spacer(),
              SizedBox(
                height: 30,
                child: Row(
                  children: [
                    CompactIconButton(
                      icon: storeMode ? Icons.graphic_eq : Icons.play_arrow,
                      tooltip: storeMode ? 'Sample' : 'Play',
                      onPressed: onPlay,
                    ),
                    if (!storeMode) ...[
                      const SizedBox(width: 3),
                      CompactIconButton(
                        onPressed: downloadProgress != null
                            ? null
                            : (downloaded ? onRemoveDownload : onDownload),
                        customIcon: downloadProgress != null
                            ? DownloadProgress(value: downloadProgress!)
                            : null,
                        icon: downloaded ? Icons.check : Icons.download,
                        tooltip: downloaded ? 'Remove download' : 'Download',
                      ),
                    ],
                    if (storeMode) ...[
                      const SizedBox(width: 3),
                      CompactIconButton(
                        icon: book.inLibrary ? Icons.check : Icons.add,
                        tooltip: 'Add',
                        filled: true,
                        onPressed: onAdd,
                      ),
                    ],
                    if (!storeMode) ...[
                      const SizedBox(width: 3),
                      CompactMenuButton(
                        downloaded: downloaded,
                        downloading: downloadProgress != null,
                        canAddToShelf: onAddToShelf != null,
                        canRemoveFromShelf: onRemoveFromShelf != null,
                        onSelected: (value) {
                          if (value == 'shelf') onAddToShelf?.call();
                          if (value == 'removeShelf') onRemoveFromShelf?.call();
                          if (value == 'remove') onRemove();
                          if (value == 'removeDownload') onRemoveDownload();
                          if (value == 'finished') onMarkFinished();
                          if (value == 'clear') onClearProgress();
                        },
                      ),
                    ],
                    const Spacer(),
                    if ((book.averageRating ?? 0) > 0)
                      Flexible(child: RatingPill(rating: book.averageRating!)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class CompactIconButton extends StatelessWidget {
  const CompactIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.customIcon,
    this.filled = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final Widget? customIcon;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final style = IconButton.styleFrom(
      fixedSize: const Size(30, 30),
      minimumSize: const Size(30, 30),
      padding: EdgeInsets.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
    );
    final child = customIcon ?? Icon(icon, size: 18);
    return filled
        ? IconButton.filledTonal(
            onPressed: onPressed,
            icon: child,
            tooltip: tooltip,
            style: style,
          )
        : IconButton.outlined(
            onPressed: onPressed,
            icon: child,
            tooltip: tooltip,
            style: style,
          );
  }
}

class CompactMenuButton extends StatelessWidget {
  const CompactMenuButton({
    super.key,
    required this.downloaded,
    required this.downloading,
    required this.canAddToShelf,
    required this.canRemoveFromShelf,
    required this.onSelected,
  });

  final bool downloaded;
  final bool downloading;
  final bool canAddToShelf;
  final bool canRemoveFromShelf;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: 30,
      child: PopupMenuButton<String>(
        padding: EdgeInsets.zero,
        iconSize: 18,
        tooltip: 'More',
        onSelected: onSelected,
        itemBuilder: (context) => [
          if (canAddToShelf)
            const PopupMenuItem(value: 'shelf', child: Text('Add to Shelf')),
          if (canRemoveFromShelf)
            const PopupMenuItem(
              value: 'removeShelf',
              child: Text('Remove from Shelf'),
            ),
          const PopupMenuItem(
            value: 'finished',
            child: Text('Mark as Finished'),
          ),
          const PopupMenuItem(value: 'clear', child: Text('Clear Progress')),
          if (downloading)
            const PopupMenuItem(
              value: 'removeDownload',
              child: Text('Cancel Download'),
            ),
          if (downloaded && !downloading)
            const PopupMenuItem(
              value: 'removeDownload',
              child: Text('Remove from Local Storage'),
            ),
          const PopupMenuItem(
            value: 'remove',
            child: Text('Remove from Library'),
          ),
        ],
      ),
    );
  }
}

class BookCover extends StatelessWidget {
  const BookCover({
    super.key,
    required this.api,
    required this.book,
    required this.progressPercent,
    required this.finished,
  });
  final StoryStackApi api;
  final Book book;
  final double? progressPercent;
  final bool finished;

  @override
  Widget build(BuildContext context) {
    final ImageProvider? coverProvider;
    if (book.coverPath == null ||
        book.isLocalDevice && book.coverPath!.startsWith('content:')) {
      coverProvider = null;
    } else if (book.isLocalDevice) {
      coverProvider = FileImage(File(book.coverPath!));
    } else {
      coverProvider = CachedNetworkImageProvider(
        api.coverUrl(book.id),
        headers: api.authHeaders,
      );
    }
    return AspectRatio(
      aspectRatio: 1,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Stack(
          fit: StackFit.expand,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: const Color(0xff31483a),
                border: Border.all(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
              ),
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(
                        Icons.menu_book,
                        size: 44,
                        color: Color(0xfffff3d4),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        book.title,
                        textAlign: TextAlign.center,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (coverProvider != null)
              Image(
                image: coverProvider,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) =>
                    const SizedBox.shrink(),
              ),
            if (coverProvider != null)
              Image(
                image: coverProvider,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) =>
                    const SizedBox.shrink(),
              ),
            if (progressPercent != null && progressPercent! > 0)
              Align(
                alignment: Alignment.bottomLeft,
                child: FractionallySizedBox(
                  widthFactor: (progressPercent!.clamp(2, 100)) / 100,
                  child: Container(
                    height: 5,
                    color: Theme.of(context).colorScheme.secondary,
                  ),
                ),
              ),
            if (finished)
              const Positioned(
                top: 8,
                right: 8,
                child: CircleAvatar(
                  radius: 14,
                  backgroundColor: Color(0xff496f3e),
                  child: Icon(Icons.check, size: 18, color: Colors.white),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class BookDetailPage extends StatefulWidget {
  const BookDetailPage({
    super.key,
    required this.api,
    required this.user,
    required this.book,
    required this.inStore,
    required this.inLibrary,
    required this.progress,
    required this.onBack,
    required this.onPlay,
    required this.onSample,
    required this.onAdd,
    required this.onRemove,
    required this.onAddToShelf,
    required this.canEditMetadata,
    required this.onBookUpdated,
    required this.onFindMetadata,
    required this.onSaveMetadata,
  });

  final StoryStackApi api;
  final User user;
  final Book book;
  final bool inStore;
  final bool inLibrary;
  final PlaybackProgress? progress;
  final VoidCallback onBack;
  final VoidCallback onPlay;
  final VoidCallback onSample;
  final VoidCallback onAdd;
  final VoidCallback onRemove;
  final VoidCallback onAddToShelf;
  final bool canEditMetadata;
  final ValueChanged<Book> onBookUpdated;
  final Future<BookMetadataResult> Function() onFindMetadata;
  final Future<Book> Function(BookMetadataUpdate input) onSaveMetadata;

  @override
  State<BookDetailPage> createState() => _BookDetailPageState();
}

class _BookDetailPageState extends State<BookDetailPage> {
  BookReviewResponse? reviews;
  int rating = 0;
  final reviewController = TextEditingController();
  final titleController = TextEditingController();
  final subtitleController = TextEditingController();
  final authorController = TextEditingController();
  final narratorController = TextEditingController();
  final seriesController = TextEditingController();
  final seriesOrderController = TextEditingController();
  final descriptionController = TextEditingController();
  final genresController = TextEditingController();
  final publicationYearController = TextEditingController();
  bool loadingReviews = true;
  bool savingMetadata = false;
  bool findingMetadata = false;
  bool editingMetadata = false;
  String? metadataMessage;

  @override
  void initState() {
    super.initState();
    _syncMetadataDraft();
    unawaited(_loadReviews());
  }

  @override
  void dispose() {
    reviewController.dispose();
    titleController.dispose();
    subtitleController.dispose();
    authorController.dispose();
    narratorController.dispose();
    seriesController.dispose();
    seriesOrderController.dispose();
    descriptionController.dispose();
    genresController.dispose();
    publicationYearController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant BookDetailPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.book != widget.book) {
      _syncMetadataDraft(clearMessage: oldWidget.book.id != widget.book.id);
      if (oldWidget.book.id != widget.book.id) {
        editingMetadata = false;
      }
    }
  }

  void _syncMetadataDraft({bool clearMessage = true}) {
    titleController.text = widget.book.title;
    subtitleController.text = widget.book.subtitle ?? '';
    authorController.text = widget.book.author;
    narratorController.text = widget.book.narrator ?? '';
    seriesController.text = widget.book.series ?? '';
    seriesOrderController.text = widget.book.seriesOrder?.toString() ?? '';
    descriptionController.text =
        widget.book.description?.replaceAll('&#8212;', '-') ?? '';
    genresController.text = widget.book.genres.join(', ');
    publicationYearController.text =
        widget.book.publicationYear?.toString() ?? '';
    if (clearMessage) {
      metadataMessage = null;
    }
  }

  Future<void> _loadReviews() async {
    try {
      final data = await widget.api.bookReviews(widget.book.id);
      setState(() {
        reviews = data;
        rating = 0;
        reviewController.clear();
        loadingReviews = false;
      });
    } catch (_) {
      setState(() => loadingReviews = false);
    }
  }

  Future<void> _saveReview() async {
    if (rating == 0) return;
    await widget.api.saveBookReview(
      widget.book.id,
      rating,
      reviewController.text.trim(),
    );
    await _loadReviews();
  }

  Future<void> _deleteReview() async {
    await widget.api.deleteMyBookReview(widget.book.id);
    await _loadReviews();
  }

  BookMetadataUpdate _currentMetadataUpdate() {
    return BookMetadataUpdate(
      title: titleController.text.trim(),
      subtitle: subtitleController.text.trim(),
      author: authorController.text.trim(),
      narrator: narratorController.text.trim(),
      series: seriesController.text.trim(),
      seriesOrder: double.tryParse(seriesOrderController.text.trim()),
      description: descriptionController.text.trim(),
      genres: genresController.text
          .split(',')
          .map((item) => item.trim())
          .where((item) => item.isNotEmpty)
          .toList(),
      publicationYear: int.tryParse(publicationYearController.text.trim()),
    );
  }

  Future<void> _saveMetadata() async {
    setState(() {
      savingMetadata = true;
      metadataMessage = null;
    });
    try {
      final updatedBook = await widget.onSaveMetadata(_currentMetadataUpdate());
      if (!mounted) return;
      setState(() {
        metadataMessage = 'Metadata saved.';
        editingMetadata = false;
      });
      widget.onBookUpdated(updatedBook);
    } catch (error) {
      if (!mounted) return;
      setState(
        () =>
            metadataMessage = error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() => savingMetadata = false);
      }
    }
  }

  Future<void> _findMetadata() async {
    setState(() {
      findingMetadata = true;
      metadataMessage = null;
    });
    try {
      final result = await widget.onFindMetadata();
      if (!mounted) return;
      setState(() {
        metadataMessage = result.matched
            ? 'Metadata found.'
            : 'No matching metadata was found.';
        editingMetadata = false;
      });
      widget.onBookUpdated(result.book);
    } catch (error) {
      if (!mounted) return;
      setState(
        () =>
            metadataMessage = error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() => findingMetadata = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final book = widget.book;
    final progressSummary = progressSummaryFor(book, widget.progress);
    final coverSize = min(MediaQuery.sizeOf(context).width * 0.48, 184.0);
    final compactFilledButton = FilledButton.styleFrom(
      minimumSize: const Size(0, 34),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
    );
    final compactOutlinedButton = OutlinedButton.styleFrom(
      minimumSize: const Size(0, 34),
      padding: const EdgeInsets.symmetric(horizontal: 10),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
    );
    final compactTextButton = TextButton.styleFrom(
      minimumSize: const Size(0, 34),
      padding: const EdgeInsets.symmetric(horizontal: 8),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
      foregroundColor: Theme.of(context).colorScheme.error,
    );
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 88),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 34,
            height: 34,
            child: IconButton.outlined(
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              onPressed: widget.onBack,
              icon: const Icon(Icons.arrow_back),
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: SizedBox(
              width: coverSize,
              child: BookCover(
                api: widget.api,
                book: book,
                progressPercent: progressPercentFor(book, widget.progress),
                finished: widget.progress?.status == ProgressStatus.finished,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            book.title,
            style: Theme.of(
              context,
            ).textTheme.headlineMedium?.copyWith(height: 1.05),
          ),
          if (book.series != null)
            Text(
              seriesLabel(book),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          const SizedBox(height: 10),
          DetailChips(book: book),
          if (!widget.inStore && progressSummary != null) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                ProgressStatPill(
                  value: '${progressSummary.percent}%',
                  label: 'complete',
                ),
                ProgressStatPill(
                  value: formatTime(progressSummary.timeLeft),
                  label: 'left',
                ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                style: compactFilledButton,
                onPressed: widget.inStore ? widget.onSample : widget.onPlay,
                icon: Icon(
                  widget.inStore ? Icons.graphic_eq : Icons.play_arrow,
                ),
                label: Text(widget.inStore ? 'Sample' : 'Play'),
              ),
              if (widget.inStore && !widget.inLibrary)
                OutlinedButton.icon(
                  style: compactOutlinedButton,
                  onPressed: widget.onAdd,
                  icon: const Icon(Icons.add),
                  label: const Text('Add'),
                ),
              if (!widget.inStore && widget.inLibrary)
                OutlinedButton.icon(
                  style: compactOutlinedButton,
                  onPressed: widget.onAddToShelf,
                  icon: const Icon(Icons.label_outline),
                  label: const Text('Shelf'),
                ),
              if (!widget.inStore && widget.inLibrary)
                TextButton.icon(
                  style: compactTextButton,
                  onPressed: widget.onRemove,
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('Remove'),
                ),
            ],
          ),
          if (widget.canEditMetadata) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  style: compactOutlinedButton,
                  onPressed: () {
                    setState(() {
                      editingMetadata = !editingMetadata;
                      metadataMessage = null;
                      if (editingMetadata) {
                        _syncMetadataDraft(clearMessage: false);
                      }
                    });
                  },
                  icon: Icon(
                    editingMetadata ? Icons.close : Icons.edit_outlined,
                  ),
                  label: Text(
                    editingMetadata ? 'Cancel Edit' : 'Edit Metadata',
                  ),
                ),
                OutlinedButton.icon(
                  style: compactOutlinedButton,
                  onPressed: findingMetadata ? null : _findMetadata,
                  icon: const Icon(Icons.auto_fix_high_outlined),
                  label: const Text('Find Metadata'),
                ),
              ],
            ),
            if (metadataMessage != null) ...[
              const SizedBox(height: 8),
              Text(metadataMessage!),
            ],
            if (editingMetadata) ...[
              const SizedBox(height: 10),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Edit Metadata',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      LayoutBuilder(
                        builder: (context, constraints) {
                          final wide = constraints.maxWidth >= 360;
                          return Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              SizedBox(
                                width: wide
                                    ? (constraints.maxWidth - 8) / 2
                                    : constraints.maxWidth,
                                child: TextField(
                                  controller: titleController,
                                  decoration: const InputDecoration(
                                    isDense: true,
                                    labelText: 'Title',
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: wide
                                    ? (constraints.maxWidth - 8) / 2
                                    : constraints.maxWidth,
                                child: TextField(
                                  controller: subtitleController,
                                  decoration: const InputDecoration(
                                    isDense: true,
                                    labelText: 'Subtitle',
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: wide
                                    ? (constraints.maxWidth - 8) / 2
                                    : constraints.maxWidth,
                                child: TextField(
                                  controller: authorController,
                                  decoration: const InputDecoration(
                                    isDense: true,
                                    labelText: 'Author',
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: wide
                                    ? (constraints.maxWidth - 8) / 2
                                    : constraints.maxWidth,
                                child: TextField(
                                  controller: narratorController,
                                  decoration: const InputDecoration(
                                    isDense: true,
                                    labelText: 'Narrator',
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: wide
                                    ? (constraints.maxWidth - 8) / 2
                                    : constraints.maxWidth,
                                child: TextField(
                                  controller: seriesController,
                                  decoration: const InputDecoration(
                                    isDense: true,
                                    labelText: 'Series',
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: wide
                                    ? (constraints.maxWidth - 8) / 2
                                    : constraints.maxWidth,
                                child: TextField(
                                  controller: seriesOrderController,
                                  keyboardType: TextInputType.number,
                                  decoration: const InputDecoration(
                                    isDense: true,
                                    labelText: 'Series Order',
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: wide
                                    ? (constraints.maxWidth - 8) / 2
                                    : constraints.maxWidth,
                                child: TextField(
                                  controller: publicationYearController,
                                  keyboardType: TextInputType.number,
                                  decoration: const InputDecoration(
                                    isDense: true,
                                    labelText: 'Published',
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: wide
                                    ? (constraints.maxWidth - 8) / 2
                                    : constraints.maxWidth,
                                child: TextField(
                                  controller: genresController,
                                  decoration: const InputDecoration(
                                    isDense: true,
                                    labelText: 'Genres',
                                    hintText: 'Fantasy, Adventure',
                                  ),
                                ),
                              ),
                              SizedBox(
                                width: constraints.maxWidth,
                                child: TextField(
                                  controller: descriptionController,
                                  minLines: 3,
                                  maxLines: 5,
                                  decoration: const InputDecoration(
                                    isDense: true,
                                    labelText: 'Description',
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          FilledButton(
                            style: compactFilledButton,
                            onPressed: savingMetadata ? null : _saveMetadata,
                            child: const Text('Save Metadata'),
                          ),
                          OutlinedButton(
                            style: compactOutlinedButton,
                            onPressed: savingMetadata
                                ? null
                                : () {
                                    setState(() {
                                      editingMetadata = false;
                                      metadataMessage = null;
                                    });
                                  },
                            child: const Text('Cancel'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
          const SizedBox(height: 16),
          Text('Description', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 6),
          Text(
            book.description?.replaceAll('&#8212;', '-') ??
                'No description available.',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          if (widget.user.reviewsEnabled) ...[
            const SizedBox(height: 22),
            ReviewsPanel(
              reviews: reviews,
              loading: loadingReviews,
              canReview: widget.inLibrary && !widget.inStore,
              rating: rating,
              reviewController: reviewController,
              onRating: (value) => setState(() => rating = value),
              onSave: _saveReview,
              onDelete: _deleteReview,
            ),
          ],
        ],
      ),
    );
  }
}

class DetailChips extends StatelessWidget {
  const DetailChips({super.key, required this.book});
  final Book book;

  @override
  Widget build(BuildContext context) {
    final entries = <(String, String)>[
      ('Author', book.author),
      if (book.narrator != null) ('Narrator', book.narrator!),
      if (book.publicationYear != null)
        ('Published', '${book.publicationYear}'),
      if (bookDurationSeconds(book) case final seconds? when seconds > 0)
        ('Length', formatTime(Duration(seconds: seconds))),
      if (book.genres.isNotEmpty) ('Genres', book.genres.join(', ')),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 8.0;
        final columns = constraints.maxWidth >= 330 ? 2 : 1;
        final itemWidth = columns == 1
            ? constraints.maxWidth
            : (constraints.maxWidth - gap) / 2;

        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: entries
              .map(
                (entry) => SizedBox(
                  width: itemWidth,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(7),
                      border: Border.all(
                        color: Theme.of(context).colorScheme.outlineVariant,
                      ),
                      color: Theme.of(context).cardColor,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          entry.$1.toUpperCase(),
                          style: Theme.of(context).textTheme.labelLarge
                              ?.copyWith(
                                fontWeight: FontWeight.w900,
                                fontSize: 11,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          entry.$2,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ),
              )
              .toList(),
        );
      },
    );
  }
}

class ReviewsPanel extends StatelessWidget {
  const ReviewsPanel({
    super.key,
    required this.reviews,
    required this.loading,
    required this.canReview,
    required this.rating,
    required this.reviewController,
    required this.onRating,
    required this.onSave,
    required this.onDelete,
  });

  final BookReviewResponse? reviews;
  final bool loading;
  final bool canReview;
  final int rating;
  final TextEditingController reviewController;
  final ValueChanged<int> onRating;
  final VoidCallback onSave;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    final summary = reviews?.summary;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('Reviews', style: Theme.of(context).textTheme.titleLarge),
            const Spacer(),
            Text(
              summary == null || summary.reviewCount == 0
                  ? 'No reviews yet'
                  : '${summary.averageRating.toStringAsFixed(1)} / 5 from ${summary.reviewCount}',
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (canReview)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  StarPicker(value: rating, onChanged: onRating),
                  const SizedBox(height: 8),
                  TextField(
                    controller: reviewController,
                    minLines: 3,
                    maxLines: 5,
                    decoration: const InputDecoration(
                      isDense: true,
                      hintText: 'Share what you thought about this book',
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: [
                      FilledButton(
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 36),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          visualDensity: VisualDensity.compact,
                        ),
                        onPressed: rating == 0 ? null : onSave,
                        child: Text(
                          reviews?.myReview == null
                              ? 'Save Review'
                              : 'Update Review',
                        ),
                      ),
                      if (reviews?.myReview != null)
                        OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(0, 36),
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            visualDensity: VisualDensity.compact,
                          ),
                          onPressed: onDelete,
                          child: const Text('Remove Review'),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ...(reviews?.reviews ?? []).map(
          (review) => Card(
            child: ListTile(
              dense: true,
              visualDensity: VisualDensity.compact,
              contentPadding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
              title: Text(
                review.userName,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  StarRow(value: review.rating),
                  const SizedBox(height: 5),
                  Text(review.review),
                ],
              ),
              trailing: review.isMine ? const Text('Your review') : null,
            ),
          ),
        ),
      ],
    );
  }
}

class StarPicker extends StatelessWidget {
  const StarPicker({super.key, required this.value, required this.onChanged});
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (index) {
        final star = index + 1;
        return IconButton(
          visualDensity: VisualDensity.compact,
          onPressed: () => onChanged(star),
          icon: Icon(
            star <= value ? Icons.star : Icons.star_border,
            color: star <= value
                ? const Color(0xfff4bd62)
                : Theme.of(context).colorScheme.outline,
          ),
        );
      }),
    );
  }
}

class StarRow extends StatelessWidget {
  const StarRow({super.key, required this.value});
  final int value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(
        5,
        (index) => Icon(
          index < value ? Icons.star : Icons.star_border,
          size: 18,
          color: const Color(0xfff4bd62),
        ),
      ),
    );
  }
}

class GroupPage extends StatelessWidget {
  const GroupPage({
    super.key,
    this.title,
    required this.groups,
    required this.activeGroup,
    required this.storeMode,
    required this.onOpen,
    required this.onBack,
    required this.onAddAll,
    required this.onRemoveAll,
    required this.onBook,
    required this.progressByBook,
    required this.downloadedBookIds,
    required this.downloadProgress,
    required this.onPlay,
    required this.onDownload,
    required this.onRemoveDownload,
    required this.onAdd,
    required this.onRemove,
    required this.onMarkFinished,
    required this.onClearProgress,
    this.onAddToShelf,
  });

  final String? title;
  final List<BookGroup> groups;
  final BookGroup? activeGroup;
  final bool storeMode;
  final ValueChanged<BookGroup> onOpen;
  final VoidCallback onBack;
  final ValueChanged<BookGroup> onAddAll;
  final ValueChanged<BookGroup> onRemoveAll;
  final ValueChanged<Book> onBook;
  final Map<String, PlaybackProgress> progressByBook;
  final Set<String> downloadedBookIds;
  final Map<String, double?> downloadProgress;
  final ValueChanged<Book> onPlay;
  final ValueChanged<Book> onDownload;
  final ValueChanged<Book> onRemoveDownload;
  final ValueChanged<Book> onAdd;
  final ValueChanged<Book> onRemove;
  final ValueChanged<Book> onMarkFinished;
  final ValueChanged<Book> onClearProgress;
  final ValueChanged<Book>? onAddToShelf;

  @override
  Widget build(BuildContext context) {
    if (title != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(title: title!),
          const SizedBox(height: 12),
        ],
      );
    }
    if (groups.isEmpty) return const EmptyState(message: 'No groups here yet.');
    final selected = activeGroup;
    if (selected != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  IconButton.outlined(
                    onPressed: onBack,
                    icon: const Icon(Icons.arrow_back),
                    tooltip: 'All Series',
                    style: IconButton.styleFrom(
                      fixedSize: const Size(38, 38),
                      minimumSize: const Size(38, 38),
                      padding: EdgeInsets.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      visualDensity: VisualDensity.compact,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          selected.name,
                          style: Theme.of(context).textTheme.titleLarge,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          '${selected.books.length} books',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.outlined(
                    onPressed: () =>
                        storeMode ? onAddAll(selected) : onRemoveAll(selected),
                    icon: Icon(storeMode ? Icons.add : Icons.delete_outline),
                    tooltip: storeMode ? 'Add all' : 'Remove all',
                    style: IconButton.styleFrom(
                      fixedSize: const Size(38, 38),
                      minimumSize: const Size(38, 38),
                      padding: EdgeInsets.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      visualDensity: VisualDensity.compact,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          BooksGrid(
            books: selected.books,
            progressByBook: progressByBook,
            downloadedBookIds: downloadedBookIds,
            downloadProgress: downloadProgress,
            storeMode: storeMode,
            onBook: onBook,
            onPlay: onPlay,
            onDownload: onDownload,
            onRemoveDownload: onRemoveDownload,
            onAdd: onAdd,
            onRemove: onRemove,
            onMarkFinished: onMarkFinished,
            onClearProgress: onClearProgress,
            onAddToShelf: onAddToShelf,
          ),
        ],
      );
    }
    return Column(
      children: groups
          .map(
            (group) => Card(
              child: ListTile(
                onTap: () => onOpen(group),
                leading: SizedBox(
                  width: 58,
                  child: BookCover(
                    api: StoryStackApi.current,
                    book: group.books.first,
                    progressPercent: null,
                    finished: false,
                  ),
                ),
                title: Text(
                  group.name,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                subtitle: Text('${group.books.length} books'),
                trailing: storeMode
                    ? IconButton.filledTonal(
                        onPressed: () => onAddAll(group),
                        icon: const Icon(Icons.add),
                      )
                    : IconButton.outlined(
                        onPressed: () => onRemoveAll(group),
                        icon: const Icon(Icons.delete_outline),
                      ),
              ),
            ),
          )
          .toList(),
    );
  }
}

class ShelvesPage extends StatelessWidget {
  const ShelvesPage({
    super.key,
    required this.activeShelf,
    required this.activeShelfBooks,
    required this.progressByBook,
    required this.downloadedBookIds,
    required this.downloadProgress,
    required this.shelves,
    required this.shelfBookCounts,
    required this.onOpen,
    required this.onBack,
    required this.onBook,
    required this.onPlay,
    required this.onDownload,
    required this.onRemoveDownload,
    required this.onAdd,
    required this.onRemove,
    required this.onMarkFinished,
    required this.onClearProgress,
    required this.onAddToShelf,
    required this.onRemoveFromShelf,
    required this.onCreate,
  });
  final Shelf? activeShelf;
  final List<Book> activeShelfBooks;
  final Map<String, PlaybackProgress> progressByBook;
  final Set<String> downloadedBookIds;
  final Map<String, double?> downloadProgress;
  final List<Shelf> shelves;
  final Map<String, int> shelfBookCounts;
  final ValueChanged<Shelf> onOpen;
  final VoidCallback onBack;
  final ValueChanged<Book> onBook;
  final ValueChanged<Book> onPlay;
  final ValueChanged<Book> onDownload;
  final ValueChanged<Book> onRemoveDownload;
  final ValueChanged<Book> onAdd;
  final ValueChanged<Book> onRemove;
  final ValueChanged<Book> onMarkFinished;
  final ValueChanged<Book> onClearProgress;
  final ValueChanged<Book> onAddToShelf;
  final ValueChanged<Book> onRemoveFromShelf;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final shelf = activeShelf;
    if (shelf != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          IconButton.outlined(
            onPressed: onBack,
            icon: const Icon(Icons.arrow_back),
          ),
          const SizedBox(height: 12),
          Text(shelf.name, style: Theme.of(context).textTheme.headlineMedium),
          Text('${activeShelfBooks.length} books'),
          const SizedBox(height: 18),
          BooksGrid(
            books: activeShelfBooks,
            progressByBook: progressByBook,
            downloadedBookIds: downloadedBookIds,
            downloadProgress: downloadProgress,
            storeMode: false,
            onBook: onBook,
            onPlay: onPlay,
            onDownload: onDownload,
            onRemoveDownload: onRemoveDownload,
            onAdd: onAdd,
            onRemove: onRemove,
            onMarkFinished: onMarkFinished,
            onClearProgress: onClearProgress,
            onAddToShelf: onAddToShelf,
            onRemoveFromShelf: onRemoveFromShelf,
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton.icon(
          onPressed: onCreate,
          icon: const Icon(Icons.add),
          label: const Text('New Shelf'),
        ),
        const SizedBox(height: 12),
        if (shelves.isEmpty)
          const EmptyState(message: 'Create shelves to organize your library.'),
        ...shelves.map(
          (shelf) => Card(
            child: ListTile(
              title: Text(shelf.name),
              subtitle: Text(
                '${shelfBookCounts[shelf.id] ?? 0} book${(shelfBookCounts[shelf.id] ?? 0) == 1 ? '' : 's'}',
              ),
              leading: const Icon(Icons.label_outline),
              onTap: () => onOpen(shelf),
            ),
          ),
        ),
      ],
    );
  }
}

class DownloadsPage extends StatelessWidget {
  const DownloadsPage({
    super.key,
    required this.books,
    required this.progressByBook,
    required this.onBook,
    required this.onPlay,
    required this.onRemoveDownload,
    required this.onMarkFinished,
    required this.onClearProgress,
  });
  final List<Book> books;
  final Map<String, PlaybackProgress> progressByBook;
  final ValueChanged<Book> onBook;
  final ValueChanged<Book> onPlay;
  final ValueChanged<Book> onRemoveDownload;
  final ValueChanged<Book> onMarkFinished;
  final ValueChanged<Book> onClearProgress;

  @override
  Widget build(BuildContext context) {
    return BooksGrid(
      books: books,
      progressByBook: progressByBook,
      downloadedBookIds: books.map((book) => book.id).toSet(),
      downloadProgress: const {},
      storeMode: false,
      onBook: onBook,
      onPlay: onPlay,
      onDownload: (_) {},
      onRemoveDownload: onRemoveDownload,
      onAdd: (_) {},
      onRemove: (_) {},
      onMarkFinished: onMarkFinished,
      onClearProgress: onClearProgress,
    );
  }
}

class SettingsPage extends StatefulWidget {
  const SettingsPage({
    super.key,
    required this.api,
    required this.user,
    required this.showAdminControls,
    required this.localDeviceLibrary,
    required this.librarySourceMode,
    required this.localScanState,
    required this.remoteAccessAddress,
    required this.localNetworkAddress,
    required this.onLibrarySourceChanged,
    required this.onSourceAddressSaved,
    required this.onPickLocalFolder,
    required this.onScanLocalAudiobooks,
    required this.onUserChanged,
    required this.onLogout,
  });
  final StoryStackApi api;
  final User user;
  final bool showAdminControls;
  final LocalDeviceLibraryStore localDeviceLibrary;
  final LibrarySourceMode librarySourceMode;
  final LocalDeviceScanState localScanState;
  final String remoteAccessAddress;
  final String localNetworkAddress;
  final Future<void> Function(LibrarySourceMode mode) onLibrarySourceChanged;
  final Future<void> Function(LibrarySourceMode mode, String address)
  onSourceAddressSaved;
  final Future<LocalDeviceScanState> Function() onPickLocalFolder;
  final Future<LocalDeviceScanState> Function() onScanLocalAudiobooks;
  final ValueChanged<User?> onUserChanged;
  final VoidCallback onLogout;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  late StoryTheme theme = widget.user.theme;
  late bool reviewsEnabled = widget.user.reviewsEnabled;
  late LibrarySourceMode librarySourceMode = widget.librarySourceMode;
  late LocalDeviceScanState localScanState = widget.localScanState;
  final currentPasswordController = TextEditingController();
  final newPasswordController = TextEditingController();
  final remoteAccessController = TextEditingController();
  final localNetworkController = TextEditingController();
  List<User> users = [];
  bool loadingUsers = false;
  String? message;
  bool scanningLocalDevice = false;

  @override
  void didUpdateWidget(covariant SettingsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.librarySourceMode != widget.librarySourceMode) {
      librarySourceMode = widget.librarySourceMode;
    }
    if (oldWidget.localScanState != widget.localScanState) {
      localScanState = widget.localScanState;
    }
    if (oldWidget.remoteAccessAddress != widget.remoteAccessAddress) {
      remoteAccessController.text = widget.remoteAccessAddress;
    }
    if (oldWidget.localNetworkAddress != widget.localNetworkAddress) {
      localNetworkController.text = widget.localNetworkAddress;
    }
  }

  @override
  void initState() {
    super.initState();
    remoteAccessController.text = widget.remoteAccessAddress;
    localNetworkController.text = widget.localNetworkAddress;
    if (widget.showAdminControls) {
      unawaited(_loadUsers());
    }
  }

  @override
  void dispose() {
    currentPasswordController.dispose();
    newPasswordController.dispose();
    remoteAccessController.dispose();
    localNetworkController.dispose();
    super.dispose();
  }

  Future<void> _savePreferences() async {
    final user = widget.user.id == _guestLocalDeviceUserId
        ? await widget.localDeviceLibrary.savePreferences(theme, reviewsEnabled)
        : await widget.api.updatePreferences(theme, reviewsEnabled);
    widget.onUserChanged(user);
    setState(() => message = 'Settings saved.');
  }

  Future<void> _selectLibrarySource(LibrarySourceMode mode) async {
    setState(() => librarySourceMode = mode);
    await widget.onLibrarySourceChanged(mode);
  }

  Future<void> _saveSourceAddress() async {
    if (librarySourceMode == LibrarySourceMode.remoteAccess) {
      await widget.onSourceAddressSaved(
        LibrarySourceMode.remoteAccess,
        remoteAccessController.text.trim(),
      );
      await widget.onSourceAddressSaved(
        LibrarySourceMode.localNetwork,
        localNetworkController.text.trim(),
      );
    } else {
      await widget.onSourceAddressSaved(
        librarySourceMode,
        localNetworkController.text.trim(),
      );
    }
    setState(() => message = 'Library source saved.');
  }

  Future<void> _pickLocalFolder() async {
    setState(() => scanningLocalDevice = true);
    try {
      final state = await widget.onPickLocalFolder();
      setState(() {
        localScanState = state;
        message = state.folderPath == null
            ? null
            : 'Audiobook folder selected.';
      });
    } finally {
      if (mounted) setState(() => scanningLocalDevice = false);
    }
  }

  Future<void> _scanLocalFolder() async {
    setState(() => scanningLocalDevice = true);
    try {
      final state = await widget.onScanLocalAudiobooks();
      setState(() {
        localScanState = state;
        message = state.scannedAt == null
            ? 'Choose a folder first.'
            : 'Found ${state.scannedBooks} books.';
      });
    } catch (exception) {
      setState(
        () => message = exception.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) setState(() => scanningLocalDevice = false);
    }
  }

  Future<void> _changePassword() async {
    if (widget.user.id == _guestLocalDeviceUserId) {
      setState(() => message = 'Local device mode does not use a password.');
      return;
    }
    final user = await widget.api.changePassword(
      currentPassword: currentPasswordController.text,
      newPassword: newPasswordController.text,
    );
    currentPasswordController.clear();
    newPasswordController.clear();
    widget.onUserChanged(user);
    setState(() => message = 'Password saved.');
  }

  Future<void> _loadUsers() async {
    setState(() => loadingUsers = true);
    try {
      users = await widget.api.users();
    } finally {
      if (mounted) {
        setState(() => loadingUsers = false);
      }
    }
  }

  Future<void> _createUser() async {
    final name = TextEditingController();
    final email = TextEditingController();
    var role = UserRole.user;
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Add User'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Name'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: email,
                decoration: const InputDecoration(labelText: 'Email'),
              ),
              const SizedBox(height: 10),
              SegmentedButton<UserRole>(
                selected: {role},
                segments: const [
                  ButtonSegment(value: UserRole.user, label: Text('User')),
                  ButtonSegment(value: UserRole.admin, label: Text('Admin')),
                ],
                onSelectionChanged: (value) =>
                    setDialogState(() => role = value.first),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );
    if (created != true) return;
    await widget.api.createUser(
      name: name.text.trim(),
      email: email.text.trim(),
      role: role,
    );
    await _loadUsers();
  }

  Future<void> _resetPassword(User user) async {
    final password = TextEditingController();
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Reset ${user.name} Password'),
        content: TextField(
          controller: password,
          obscureText: true,
          decoration: const InputDecoration(labelText: 'Temporary password'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (saved != true) return;
    await widget.api.resetUserPassword(user.id, password.text);
    await _loadUsers();
  }

  Future<void> _deleteUser(User user) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${user.name}?'),
        content: const Text('This removes their Story Stack account.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await widget.api.deleteUser(user.id);
    await _loadUsers();
  }

  Future<void> _updateMetadataAccess(User user, bool enabled) async {
    final previous = user.metadataEditorEnabled;
    setState(() {
      users = users
          .map(
            (item) => item.id == user.id
                ? item.copyWith(metadataEditorEnabled: enabled)
                : item,
          )
          .toList();
      message = null;
    });

    try {
      await widget.api.updateUser(user.id, metadataEditorEnabled: enabled);
    } catch (exception) {
      if (!mounted) return;
      setState(() {
        users = users
            .map(
              (item) => item.id == user.id
                  ? item.copyWith(metadataEditorEnabled: previous)
                  : item,
            )
            .toList();
        message = exception.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final compactButton = FilledButton.styleFrom(
      minimumSize: const Size(0, 36),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
    );
    final compactOutlineButton = OutlinedButton.styleFrom(
      minimumSize: const Size(0, 36),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
    );
    final segmentedStyle = ButtonStyle(
      visualDensity: VisualDensity.compact,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      padding: WidgetStateProperty.all(
        const EdgeInsets.symmetric(horizontal: 10),
      ),
    );
    final inputDecoration = const InputDecoration(
      isDense: true,
      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(title: 'Preferences'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SegmentedButton<StoryTheme>(
                  style: segmentedStyle,
                  segments: const [
                    ButtonSegment(value: StoryTheme.dark, label: Text('Dark')),
                    ButtonSegment(
                      value: StoryTheme.light,
                      label: Text('Light'),
                    ),
                  ],
                  selected: {theme},
                  onSelectionChanged: (value) =>
                      setState(() => theme = value.first),
                ),
                SwitchListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  visualDensity: VisualDensity.compact,
                  value: reviewsEnabled,
                  onChanged: (value) => setState(() => reviewsEnabled = value),
                  title: const Text('Turn on User reviews'),
                ),
                FilledButton(
                  style: compactButton,
                  onPressed: _savePreferences,
                  child: const Text('Save Settings'),
                ),
                if (message != null) ...[
                  const SizedBox(height: 8),
                  Text(message!),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 18),
        SectionHeader(title: 'Library Source'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                LibrarySourcePicker(
                  mode: librarySourceMode,
                  onChanged: _selectLibrarySource,
                ),
                if (librarySourceMode != LibrarySourceMode.localDevice) ...[
                  const SizedBox(height: 8),
                  TextField(
                    controller: remoteAccessController,
                    decoration: inputDecoration.copyWith(
                      labelText: 'Remote address',
                      hintText: 'https://app.example.com',
                    ),
                  ),
                  if (librarySourceMode == LibrarySourceMode.remoteAccess) ...[
                    const SizedBox(height: 8),
                    TextField(
                      controller: localNetworkController,
                      decoration: inputDecoration.copyWith(
                        labelText: 'Optional local network address',
                        hintText: 'http://server-ip:4100',
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Used automatically for faster downloads when you are on the same Wi-Fi. Cloudflare remains active away from home.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                  if (librarySourceMode == LibrarySourceMode.localNetwork) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Used while this device is on the same Wi-Fi as the server.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                  const SizedBox(height: 8),
                  FilledButton(
                    style: compactButton,
                    onPressed: _saveSourceAddress,
                    child: const Text('Save Source'),
                  ),
                ],
                if (librarySourceMode == LibrarySourceMode.localDevice) ...[
                  const SizedBox(height: 8),
                  LocalDeviceFolderControls(
                    state: localScanState,
                    scanning: scanningLocalDevice,
                    onPickFolder: _pickLocalFolder,
                    onScan: _scanLocalFolder,
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 18),
        if (widget.user.id != _guestLocalDeviceUserId) ...[
          const SizedBox(height: 18),
          SectionHeader(title: 'Password'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: currentPasswordController,
                    obscureText: true,
                    decoration: inputDecoration.copyWith(
                      labelText: 'Current password',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: newPasswordController,
                    obscureText: true,
                    decoration: inputDecoration.copyWith(
                      labelText: 'New password',
                    ),
                  ),
                  const SizedBox(height: 8),
                  FilledButton(
                    style: compactButton,
                    onPressed: _changePassword,
                    child: const Text('Save Password'),
                  ),
                ],
              ),
            ),
          ),
        ],
        if (widget.showAdminControls) ...[
          const SizedBox(height: 18),
          SectionHeader(title: 'Admin'),
          Card(
            child: Column(
              children: [
                ListTile(
                  dense: true,
                  visualDensity: VisualDensity.compact,
                  contentPadding: const EdgeInsets.fromLTRB(12, 4, 8, 4),
                  leading: const Icon(Icons.people_outline),
                  title: const Text('Users'),
                  subtitle: Text('${users.length} accounts'),
                  trailing: IconButton.filledTonal(
                    onPressed: _createUser,
                    icon: const Icon(Icons.person_add_alt_1),
                  ),
                ),
                if (loadingUsers) const LinearProgressIndicator(),
                ...users.map(
                  (user) => ListTile(
                    dense: true,
                    visualDensity: VisualDensity.compact,
                    contentPadding: const EdgeInsets.fromLTRB(12, 0, 4, 0),
                    title: Text(user.name),
                    subtitle: Text(
                      [
                        user.email ?? user.username ?? '',
                        user.role.name,
                        user.status.name,
                      ].where((item) => item.isNotEmpty).join(' • '),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (user.role != UserRole.admin)
                          Tooltip(
                            message: 'Allow metadata editing',
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Text(
                                  'Edit metadata',
                                  style: TextStyle(fontSize: 12),
                                ),
                                Switch.adaptive(
                                  value: user.metadataEditorEnabled,
                                  onChanged: (value) =>
                                      _updateMetadataAccess(user, value),
                                ),
                              ],
                            ),
                          ),
                        PopupMenuButton<String>(
                          onSelected: (value) async {
                            if (value == 'admin') {
                              await widget.api.updateUser(
                                user.id,
                                role: UserRole.admin,
                              );
                            }
                            if (value == 'user') {
                              await widget.api.updateUser(
                                user.id,
                                role: UserRole.user,
                              );
                            }
                            if (value == 'disable') {
                              await widget.api.updateUser(
                                user.id,
                                status: UserStatus.disabled,
                              );
                            }
                            if (value == 'enable') {
                              await widget.api.updateUser(
                                user.id,
                                status: UserStatus.active,
                              );
                            }
                            if (value == 'password') {
                              await _resetPassword(user);
                              return;
                            }
                            if (value == 'delete') {
                              await _deleteUser(user);
                              return;
                            }
                            await _loadUsers();
                          },
                          itemBuilder: (context) => [
                            if (user.role != UserRole.admin)
                              const PopupMenuItem(
                                value: 'admin',
                                child: Text('Make Admin'),
                              ),
                            if (user.role != UserRole.user)
                              const PopupMenuItem(
                                value: 'user',
                                child: Text('Make User'),
                              ),
                            if (user.status == UserStatus.active)
                              const PopupMenuItem(
                                value: 'disable',
                                child: Text('Disable'),
                              ),
                            if (user.status == UserStatus.disabled)
                              const PopupMenuItem(
                                value: 'enable',
                                child: Text('Enable'),
                              ),
                            const PopupMenuItem(
                              value: 'password',
                              child: Text('Reset Password'),
                            ),
                            const PopupMenuDivider(),
                            const PopupMenuItem(
                              value: 'delete',
                              child: Text('Remove User'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 18),
        OutlinedButton(
          style: compactOutlineButton,
          onPressed: widget.onLogout,
          child: const Text('Sign Out'),
        ),
      ],
    );
  }
}

class ConnectionModePicker extends StatelessWidget {
  const ConnectionModePicker({
    super.key,
    required this.mode,
    required this.onChanged,
  });

  final RemoteAccessMode mode;
  final ValueChanged<RemoteAccessMode> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ConnectionModeTile(
          selected: mode == RemoteAccessMode.cloudflare,
          icon: Icons.cloud_outlined,
          title: 'Remote Access',
          subtitle: 'Cloudflare Tunnel or another public HTTPS address.',
          onTap: () => onChanged(RemoteAccessMode.cloudflare),
        ),
        ConnectionModeTile(
          selected: mode == RemoteAccessMode.localNetwork,
          icon: Icons.router_outlined,
          title: 'Local Network',
          subtitle: 'Connect by local IP while on the same network.',
          onTap: () => onChanged(RemoteAccessMode.localNetwork),
        ),
        ConnectionModeTile(
          selected: mode == RemoteAccessMode.localDevice,
          icon: Icons.folder_outlined,
          title: 'Local Device',
          subtitle: 'Read audiobooks from this device without a server.',
          onTap: () => onChanged(RemoteAccessMode.localDevice),
        ),
      ],
    );
  }
}

class ConnectionModeTile extends StatelessWidget {
  const ConnectionModeTile({
    super.key,
    required this.selected,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: selected ? scheme.primary : scheme.outlineVariant,
            ),
            color: selected
                ? scheme.primaryContainer.withValues(alpha: 0.38)
                : Theme.of(context).cardColor,
          ),
          child: Row(
            children: [
              Icon(icon, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              Icon(
                selected ? Icons.check_circle : Icons.circle_outlined,
                size: 20,
                color: selected ? scheme.primary : scheme.outline,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class LibrarySourcePicker extends StatelessWidget {
  const LibrarySourcePicker({
    super.key,
    required this.mode,
    required this.onChanged,
  });

  final LibrarySourceMode mode;
  final ValueChanged<LibrarySourceMode> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        LibrarySourceTile(
          selected: mode == LibrarySourceMode.remoteAccess,
          icon: Icons.cloud_outlined,
          title: 'Remote Access',
          subtitle: 'Use your Story Stack server through Cloudflare.',
          onTap: () => onChanged(LibrarySourceMode.remoteAccess),
        ),
        LibrarySourceTile(
          selected: mode == LibrarySourceMode.localNetwork,
          icon: Icons.router_outlined,
          title: 'Local Network',
          subtitle: 'Use your Story Stack server by local IP at home.',
          onTap: () => onChanged(LibrarySourceMode.localNetwork),
        ),
        LibrarySourceTile(
          selected: mode == LibrarySourceMode.localDevice,
          icon: Icons.folder_outlined,
          title: 'Local Device',
          subtitle: 'Scan folders on this device. No server required.',
          onTap: () => onChanged(LibrarySourceMode.localDevice),
        ),
      ],
    );
  }
}

class LibrarySourceTile extends StatelessWidget {
  const LibrarySourceTile({
    super.key,
    required this.selected,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: selected ? scheme.primary : scheme.outlineVariant,
            ),
            color: selected
                ? scheme.primaryContainer.withValues(alpha: 0.38)
                : Theme.of(context).cardColor,
          ),
          child: Row(
            children: [
              Icon(icon, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    if (selected) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ],
                  ],
                ),
              ),
              Icon(
                selected ? Icons.check_circle : Icons.circle_outlined,
                size: 20,
                color: selected ? scheme.primary : scheme.outline,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class LocalDeviceFolderControls extends StatelessWidget {
  const LocalDeviceFolderControls({
    super.key,
    required this.state,
    required this.scanning,
    required this.onPickFolder,
    required this.onScan,
  });

  final LocalDeviceScanState state;
  final bool scanning;
  final VoidCallback onPickFolder;
  final VoidCallback onScan;

  @override
  Widget build(BuildContext context) {
    final folder = state.folderPath;
    final scannedAt = state.scannedAt;
    final textTheme = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Audiobook folder', style: textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              folder ?? 'No folder selected.',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: textTheme.bodyMedium,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: scanning ? null : onPickFolder,
                  icon: const Icon(Icons.folder_open),
                  label: const Text('Choose Folder'),
                ),
                FilledButton.icon(
                  onPressed: scanning || folder == null ? null : onScan,
                  icon: scanning
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.sync),
                  label: Text(scanning ? 'Scanning' : 'Scan'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              scannedAt == null
                  ? 'Scans folders and subfolders for audiobook audio files.'
                  : '${state.scannedBooks} books found, ${state.scannedFiles} audio files',
              style: textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class MiniPlayer extends StatelessWidget {
  const MiniPlayer({
    super.key,
    required this.book,
    required this.position,
    required this.duration,
    required this.playing,
    required this.onOpen,
    required this.onToggle,
    required this.onSkip,
  });
  final Book book;
  final Duration position;
  final Duration duration;
  final bool playing;
  final VoidCallback onOpen;
  final VoidCallback onToggle;
  final ValueChanged<int>? onSkip;

  @override
  Widget build(BuildContext context) {
    final percent = duration.inMilliseconds == 0
        ? 0.0
        : position.inMilliseconds / duration.inMilliseconds;
    return InkWell(
      onTap: onOpen,
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor,
          border: Border(
            top: BorderSide(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
          ),
        ),
        padding: const EdgeInsets.all(10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            LinearProgressIndicator(value: percent.clamp(0, 1)),
            const SizedBox(height: 8),
            Row(
              children: [
                SizedBox(
                  width: 48,
                  child: BookCover(
                    api: StoryStackApi.current,
                    book: book,
                    progressPercent: null,
                    finished: false,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        book.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(
                        book.author,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                IconButton.outlined(
                  visualDensity: VisualDensity.compact,
                  onPressed: onSkip == null ? null : () => onSkip!(-30),
                  icon: const Icon(Icons.replay_30),
                ),
                const SizedBox(width: 4),
                IconButton.filled(
                  onPressed: onToggle,
                  icon: Icon(playing ? Icons.pause : Icons.play_arrow),
                ),
                const SizedBox(width: 4),
                IconButton.outlined(
                  visualDensity: VisualDensity.compact,
                  onPressed: onSkip == null ? null : () => onSkip!(30),
                  icon: const Icon(Icons.forward_30),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class NowPlayingPanel extends StatelessWidget {
  const NowPlayingPanel({
    super.key,
    required this.book,
    required this.position,
    required this.duration,
    required this.playing,
    required this.onClose,
    required this.onSeek,
    required this.onToggle,
    required this.onSkip,
    required this.onRate,
    required this.speed,
    required this.restoringPosition,
    required this.bookmarks,
    required this.onAddBookmark,
    required this.onDeleteBookmark,
    required this.onChapter,
    required this.onBookmark,
  });

  final Book book;
  final Duration position;
  final Duration duration;
  final bool playing;
  final VoidCallback onClose;
  final ValueChanged<Duration>? onSeek;
  final VoidCallback onToggle;
  final ValueChanged<int>? onSkip;
  final ValueChanged<double> onRate;
  final double speed;
  final bool restoringPosition;
  final List<BookBookmark> bookmarks;
  final VoidCallback onAddBookmark;
  final ValueChanged<BookBookmark> onDeleteBookmark;
  final ValueChanged<int> onChapter;
  final ValueChanged<int> onBookmark;

  @override
  Widget build(BuildContext context) {
    final max = duration.inSeconds <= 0 ? 1.0 : duration.inSeconds.toDouble();
    final progressPercent = duration.inMilliseconds <= 0
        ? 0
        : (position.inMilliseconds / duration.inMilliseconds * 100)
              .clamp(0, 100)
              .round();
    final timeLeft = duration > position ? duration - position : Duration.zero;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14),
      padding: const EdgeInsets.all(18),
      constraints: const BoxConstraints(maxWidth: 560),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor.withValues(alpha: 0.98),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: IconButton.outlined(
              onPressed: onClose,
              icon: const Icon(Icons.close),
            ),
          ),
          SizedBox(
            width: 230,
            child: BookCover(
              api: StoryStackApi.current,
              book: book,
              progressPercent: null,
              finished: false,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'NOW PLAYING',
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: const Color(0xfff4bd62),
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            book.title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          Text(book.author),
          const SizedBox(height: 10),
          if (book.chapters.isNotEmpty || bookmarks.isNotEmpty) ...[
            Align(
              alignment: Alignment.centerLeft,
              child: Text('Chapters & Bookmarks', style: Theme.of(context).textTheme.titleMedium),
            ),
            const SizedBox(height: 4),
            SizedBox(
              height: 150,
              child: ListView(
                children: [
                  for (final chapter in book.chapters)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.menu_book_outlined),
                      title: Text(chapter.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                      trailing: Text(formatTime(Duration(seconds: chapter.startSeconds))),
                      onTap: () => onChapter(chapter.startSeconds),
                    ),
                  for (final bookmark in bookmarks)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.bookmark),
                      title: Text(bookmark.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                      trailing: Wrap(
                        spacing: 2,
                        children: [
                          Text(formatTime(Duration(seconds: bookmark.positionSeconds))),
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.delete_outline, size: 18),
                            onPressed: () => onDeleteBookmark(bookmark),
                          ),
                        ],
                      ),
                      onTap: () => onBookmark(bookmark.positionSeconds),
                    ),
                ],
              ),
            ),
          ],
          OutlinedButton.icon(
            onPressed: restoringPosition ? null : onAddBookmark,
            icon: const Icon(Icons.bookmark_add_outlined),
            label: const Text('Bookmark current position'),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Text(formatTime(position)),
              Expanded(
                child: Slider(
                  value: position.inSeconds.clamp(0, max.toInt()).toDouble(),
                  max: max,
                  onChanged: onSeek == null
                      ? null
                      : (value) => onSeek!(Duration(seconds: value.round())),
                ),
              ),
              Text(formatTime(duration)),
            ],
          ),
          if (restoringPosition) ...[
            const SizedBox(height: 4),
            Text(
              'Restoring saved position',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
          const SizedBox(height: 6),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 10,
            runSpacing: 8,
            children: [
              ProgressStatPill(value: '$progressPercent%', label: 'complete'),
              ProgressStatPill(value: formatTime(timeLeft), label: 'left'),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton.outlined(
                onPressed: onSkip == null ? null : () => onSkip!(-30),
                icon: const Icon(Icons.replay_30),
              ),
              const SizedBox(width: 12),
              IconButton.filled(
                onPressed: onToggle,
                iconSize: 42,
                icon: Icon(playing ? Icons.pause : Icons.play_arrow),
              ),
              const SizedBox(width: 12),
              IconButton.outlined(
                onPressed: onSkip == null ? null : () => onSkip!(30),
                icon: const Icon(Icons.forward_30),
              ),
              const SizedBox(width: 12),
              OutlinedButton(
                onPressed: () => onRate(speed >= 2 ? 1 : speed + 0.25),
                child: Text(
                  '${speed.toStringAsFixed(speed % 1 == 0 ? 0 : 2)}x',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class ProgressStatPill extends StatelessWidget {
  const ProgressStatPill({super.key, required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.62),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          Text(value, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(width: 6),
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title});
  final String title;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(title, style: Theme.of(context).textTheme.headlineMedium),
  );
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.message});
  final String message;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(24),
    child: Center(child: Text(message)),
  );
}

class RetryState extends StatelessWidget {
  const RetryState({super.key, required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message),
          const SizedBox(height: 12),
          FilledButton(onPressed: onRetry, child: const Text('Try Again')),
        ],
      ),
    ),
  );
}

class RatingPill extends StatelessWidget {
  const RatingPill({super.key, required this.rating});
  final double rating;
  @override
  Widget build(BuildContext context) => Chip(
    avatar: const Icon(Icons.star, size: 16, color: Color(0xfff4bd62)),
    label: Text(rating.toStringAsFixed(1)),
  );
}

class DownloadProgress extends StatelessWidget {
  const DownloadProgress({super.key, required this.value});
  final double value;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: 22,
    height: 22,
    child: CircularProgressIndicator(value: value / 100, strokeWidth: 3),
  );
}

class StoryStackApi {
  StoryStackApi();
  static late StoryStackApi current;
  final http.Client _client = http.Client();
  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage();
  String serverUrl = _defaultServerUrl;
  String? cookie;

  Map<String, String> get authHeaders =>
      cookie == null ? const {} : {'Cookie': cookie!};

  Future<void> restore() async {
    current = this;
    final prefs = await SharedPreferences.getInstance();
    serverUrl = prefs.getString('serverUrl') ?? _defaultServerUrl;
    cookie = await _secureStorage.read(key: 'story_stack_session');
  }

  Future<void> setServerUrl(String value) async {
    serverUrl = value.endsWith('/')
        ? value.substring(0, value.length - 1)
        : value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverUrl', serverUrl);
  }

  Uri uri(String path) => Uri.parse('$serverUrl$path');
  String coverUrl(String bookId) =>
      '$serverUrl/media/books/${Uri.encodeComponent(bookId)}/cover';
  String audioUrl(String bookId) =>
      '$serverUrl/media/books/${Uri.encodeComponent(bookId)}/audio';
  String audioTrackUrl(String bookId, int trackIndex) =>
      '$serverUrl/media/books/${Uri.encodeComponent(bookId)}/audio/$trackIndex';
  String audioPath(String bookId) =>
      '/media/books/${Uri.encodeComponent(bookId)}/audio';
  String audioTrackPath(String bookId, int trackIndex) =>
      '/media/books/${Uri.encodeComponent(bookId)}/audio/$trackIndex';
  String mediaUrlAt(String baseUrl, String path) {
    final cleanBase = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    return '$cleanBase$path';
  }

  Future<bool> isReachableAt(String baseUrl) async {
    final cleanBase = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    try {
      final response = await _client
          .get(Uri.parse('$cleanBase/api/health'))
          .timeout(const Duration(seconds: 2));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>> createCastMediaToken(String bookId) async {
    return Map<String, dynamic>.from(
      await _request(
        '/api/cast/media-token',
        method: 'POST',
        body: {'bookId': bookId},
      ),
    );
  }

  Future<User> login(String username, String password) async {
    final data = await _request(
      '/api/auth/login',
      method: 'POST',
      body: {'username': username, 'password': password},
    );
    return User.fromJson(data['user']);
  }

  Future<void> logout() async {
    await _request('/api/logout', method: 'POST', allowEmpty: true);
    await clearSession();
  }

  Future<void> clearSession() async {
    cookie = null;
    await _secureStorage.delete(key: 'story_stack_session');
  }

  Future<User> me() async => User.fromJson(await _request('/api/me'));
  Future<User> updatePreferences(StoryTheme theme, bool reviewsEnabled) async {
    final data = await _request(
      '/api/me/preferences',
      method: 'PATCH',
      body: {'theme': theme.name, 'reviewsEnabled': reviewsEnabled},
    );
    return User.fromJson(data['user']);
  }

  Future<User> changePassword({
    String? currentPassword,
    required String newPassword,
  }) async {
    final data = await _request(
      '/api/me/password',
      method: 'POST',
      body: {
        if (currentPassword != null && currentPassword.isNotEmpty)
          'currentPassword': currentPassword,
        'newPassword': newPassword,
      },
    );
    return User.fromJson(data['user']);
  }

  Future<List<Book>> store([String query = '']) async {
    final data = await _request(
      '/api/store?q=${Uri.encodeQueryComponent(query)}',
    );
    return (data['books'] as List).map((item) => Book.fromJson(item)).toList();
  }

  Future<LibraryResponse> library() async {
    final data = await _request('/api/library');
    return LibraryResponse(
      books: (data['books'] as List)
          .map((item) => Book.fromJson(item))
          .toList(),
      progress: (data['progress'] as List)
          .map((item) => PlaybackProgress.fromJson(item))
          .toList(),
    );
  }

  Future<List<Shelf>> shelves() async {
    final data = await _request('/api/shelves');
    return (data['shelves'] as List)
        .map((item) => Shelf.fromJson(item))
        .toList();
  }

  Future<Shelf> createShelf(String name) async {
    final data = await _request(
      '/api/shelves',
      method: 'POST',
      body: {'name': name},
    );
    return Shelf.fromJson(data['shelf']);
  }

  Future<List<Book>> shelfBooks(String shelfId) async {
    final data = await _request(
      '/api/shelves/${Uri.encodeComponent(shelfId)}/books',
    );
    return (data['books'] as List).map((item) => Book.fromJson(item)).toList();
  }

  Future<void> addBookToShelf(String shelfId, String bookId) => _request(
    '/api/shelves/${Uri.encodeComponent(shelfId)}/books',
    method: 'POST',
    body: {'bookId': bookId},
    allowEmpty: true,
  );

  Future<void> removeBookFromShelf(String shelfId, String bookId) => _request(
    '/api/shelves/${Uri.encodeComponent(shelfId)}/books/${Uri.encodeComponent(bookId)}',
    method: 'DELETE',
    allowEmpty: true,
  );

  Future<void> addToLibrary(String bookId) => _request(
    '/api/library',
    method: 'POST',
    body: {'bookId': bookId},
    allowEmpty: true,
  );
  Future<void> removeFromLibrary(String bookId) => _request(
    '/api/library/${Uri.encodeComponent(bookId)}',
    method: 'DELETE',
    allowEmpty: true,
  );

  Future<List<BookBookmark>> bookBookmarks(String bookId) async {
    final data = await _request('/api/books/${Uri.encodeComponent(bookId)}/bookmarks');
    return ((data['bookmarks'] as List?) ?? [])
        .map((item) => BookBookmark.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<BookBookmark> createBookBookmark(
    String bookId, {
    required int positionSeconds,
    required String title,
  }) async {
    final data = await _request(
      '/api/books/${Uri.encodeComponent(bookId)}/bookmarks',
      method: 'POST',
      body: {'positionSeconds': positionSeconds, 'title': title},
    );
    return BookBookmark.fromJson(data['bookmark'] as Map<String, dynamic>);
  }

  Future<void> deleteBookBookmark(String bookId, String bookmarkId) => _request(
    '/api/books/${Uri.encodeComponent(bookId)}/bookmarks/${Uri.encodeComponent(bookmarkId)}',
    method: 'DELETE',
    allowEmpty: true,
  );

  Future<PlaybackProgress> saveProgress(
    String bookId,
    double positionSeconds,
    double? durationSeconds,
  ) async {
    final progressBody = <String, dynamic>{
      'bookId': bookId,
      'positionSeconds': positionSeconds,
    };
    if (durationSeconds != null) {
      progressBody['durationSeconds'] = durationSeconds;
    }
    final data = await _request(
      '/api/progress',
      method: 'POST',
      body: progressBody,
    );
    return PlaybackProgress.fromJson(data['progress']);
  }

  Future<BookReviewResponse> bookReviews(String bookId) async =>
      BookReviewResponse.fromJson(
        await _request('/api/books/${Uri.encodeComponent(bookId)}/reviews'),
      );
  Future<void> saveBookReview(String bookId, int rating, String review) =>
      _request(
        '/api/books/${Uri.encodeComponent(bookId)}/reviews',
        method: 'POST',
        body: {'rating': rating, 'review': review},
        allowEmpty: true,
      );
  Future<void> deleteMyBookReview(String bookId) => _request(
    '/api/books/${Uri.encodeComponent(bookId)}/reviews/me',
    method: 'DELETE',
    allowEmpty: true,
  );

  Future<List<User>> users() async {
    final data = await _request('/api/admin/users');
    return (data['users'] as List).map((item) => User.fromJson(item)).toList();
  }

  Future<User> createUser({
    required String name,
    required String email,
    required UserRole role,
  }) async {
    final data = await _request(
      '/api/admin/users',
      method: 'POST',
      body: {'name': name, 'email': email, 'role': role.name},
    );
    return User.fromJson(data['user']);
  }

  Future<User> updateUser(
    String userId, {
    UserRole? role,
    UserStatus? status,
    bool? metadataEditorEnabled,
  }) async {
    final data = await _request(
      '/api/admin/users/${Uri.encodeComponent(userId)}',
      method: 'PATCH',
      body: {
        if (role != null) 'role': role.name,
        if (status != null) 'status': status.name,
        ...?metadataEditorEnabled == null
            ? null
            : {'metadataEditorEnabled': metadataEditorEnabled},
      },
    );
    return User.fromJson(data['user']);
  }

  Future<Book> updateBookMetadata(
    String bookId,
    BookMetadataUpdate input,
  ) async {
    final data = await _request(
      '/api/books/${Uri.encodeComponent(bookId)}/metadata',
      method: 'PATCH',
      body: input.toJson(),
    );
    return Book.fromJson(data['book']);
  }

  Future<BookMetadataResult> findBookMetadata(String bookId) async {
    final data = await _request(
      '/api/books/${Uri.encodeComponent(bookId)}/metadata/find',
      method: 'POST',
    );
    return BookMetadataResult.fromJson(
      data['result'] as Map<String, dynamic>,
    ).copyWithBook(Book.fromJson(data['book'] as Map<String, dynamic>));
  }

  Future<User> resetUserPassword(String userId, String newPassword) async {
    final data = await _request(
      '/api/admin/users/${Uri.encodeComponent(userId)}/password',
      method: 'POST',
      body: {'newPassword': newPassword},
    );
    return User.fromJson(data['user']);
  }

  Future<void> deleteUser(String userId) => _request(
    '/api/admin/users/${Uri.encodeComponent(userId)}',
    method: 'DELETE',
    allowEmpty: true,
  );

  Future<RemoteAccessSettings> remoteAccessSettings() async {
    final data = await _request('/api/admin/remote-access');
    return RemoteAccessSettings.fromJson(data['settings']);
  }

  Future<RemoteAccessSettings> saveRemoteAccessSettings({
    required RemoteAccessMode mode,
    required String publicUrl,
  }) async {
    final data = await _request(
      '/api/admin/remote-access',
      method: 'POST',
      body: {'mode': mode.apiValue, 'publicUrl': publicUrl},
    );
    return RemoteAccessSettings.fromJson(data['settings']);
  }

  Future<dynamic> _request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    bool allowEmpty = false,
  }) async {
    final headers = <String, String>{...authHeaders};
    Object? encodedBody;
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      encodedBody = jsonEncode(body);
    }
    final request = http.Request(method, uri(path));
    request.headers.addAll(headers);
    if (encodedBody != null) {
      request.body = encodedBody as String;
    }
    final streamed = await _client.send(request);
    final setCookie = streamed.headers['set-cookie'];
    if (setCookie != null) {
      cookie = setCookie.split(';').first;
      await _secureStorage.write(key: 'story_stack_session', value: cookie!);
    }
    final response = await http.Response.fromStream(streamed);
    if (response.statusCode >= 400) {
      final responseBody = response.body.trim();
      if (responseBody.startsWith('<!doctype') ||
          responseBody.startsWith('<html')) {
        throw Exception(
          'This Story Stack server needs to be updated before Chromecast can be used.',
        );
      }
      final data = responseBody.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(responseBody) as Map<String, dynamic>;
      throw Exception(data['error'] ?? 'Request failed.');
    }
    if (response.body.isEmpty || allowEmpty && response.statusCode == 204) {
      return null;
    }
    final responseBody = response.body.trim();
    if (responseBody.startsWith('<!doctype') ||
        responseBody.startsWith('<html')) {
      throw Exception(
        'This Story Stack server needs to be updated before Chromecast can be used.',
      );
    }
    return jsonDecode(responseBody);
  }
}

class CastManager extends ChangeNotifier {
  CastManager(this.api, this.downloads);

  final StoryStackApi api;
  final OfflineBookStore downloads;
  final LocalCastServer localCastServer = LocalCastServer();
  bool initialized = false;
  bool isCasting = false;
  bool playing = false;
  double playbackRate = 1;
  Duration position = Duration.zero;
  StreamSubscription<GoogleCastSession?>? _sessionSubscription;
  StreamSubscription<Duration>? _positionSubscription;
  StreamSubscription<GoggleCastMediaStatus?>? _statusSubscription;

  Future<void> initialize() async {
    if (!Platform.isAndroid || initialized) return;
    try {
      await GoogleCastContext.instance.setSharedInstanceWithOptions(
        GoogleCastOptionsAndroid(
          appId: GoogleCastDiscoveryCriteria.kDefaultApplicationId,
          stopCastingOnAppTerminated: false,
        ),
      );
      initialized = true;
      final sessions = GoogleCastSessionManager.instance;
      _sessionSubscription = sessions.currentSessionStream.listen((session) {
        isCasting = session != null && sessions.hasConnectedSession;
        if (!isCasting) {
          playing = false;
          position = Duration.zero;
          unawaited(localCastServer.stop());
        }
        notifyListeners();
      });
      final remote = GoogleCastRemoteMediaClient.instance;
      _positionSubscription = remote.playerPositionStream.listen((value) {
        position = value;
        notifyListeners();
      });
      _statusSubscription = remote.mediaStatusStream.listen((status) {
        playing = status?.playerState == CastMediaPlayerState.playing;
        playbackRate = status?.playbackRate.toDouble() ?? playbackRate;
        notifyListeners();
      });
    } catch (_) {
      initialized = false;
    }
  }

  Future<void> castBook(
    BuildContext context,
    Book book,
    Duration start, {
    double playbackRate = 1,
  }) async {
    await initialize();
    await downloads.init();
    if (!context.mounted) return;
    if (!initialized) {
      throw Exception('Chromecast is unavailable on this device.');
    }
    final discovery = GoogleCastDiscoveryManager.instance;
    await discovery.startDiscovery();
    if (!context.mounted) return;
    final device = await showDialog<GoogleCastDevice>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cast to device'),
        content: SizedBox(
          width: double.maxFinite,
          child: StreamBuilder<List<GoogleCastDevice>>(
            stream: discovery.devicesStream,
            initialData: discovery.devices,
            builder: (context, snapshot) {
              final devices = snapshot.data ?? const <GoogleCastDevice>[];
              if (devices.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.all(20),
                  child: Text('Looking for Chromecast devices...'),
                );
              }
              return ListView(
                shrinkWrap: true,
                children: devices
                    .map(
                      (device) => ListTile(
                        leading: const Icon(Icons.cast),
                        title: Text(device.friendlyName),
                        subtitle: Text(device.modelName ?? 'Chromecast'),
                        onTap: () => Navigator.of(dialogContext).pop(device),
                      ),
                    )
                    .toList(),
              );
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
    await discovery.stopDiscovery();
    if (device == null) return;

    final sessions = GoogleCastSessionManager.instance;
    await sessions.startSessionWithDevice(device);
    for (
      var attempt = 0;
      attempt < 30 && !sessions.hasConnectedSession;
      attempt++
    ) {
      await Future<void>.delayed(const Duration(milliseconds: 200));
    }
    if (!sessions.hasConnectedSession) {
      throw Exception('Could not connect to ${device.friendlyName}.');
    }

    final localPaths = await downloads.audioPathsFor(book);
    final localUrls = localPaths == null
        ? null
        : await localCastServer.start(localPaths);
    if (localPaths != null && localUrls == null) {
      throw Exception(
        'Chromecast needs the phone and Chromecast to be on the same Wi-Fi network.',
      );
    }
    final token = localUrls == null
        ? await api.createCastMediaToken(book.id)
        : <String, dynamic>{
            'audioUrl': localUrls.first,
            'trackUrls': localUrls,
          };
    final coverUrl = localUrls == null ? api.coverUrl(book.id) : null;
    GoogleCastMediaInformation mediaInfo(String url, Duration? trackDuration) {
      return GoogleCastMediaInformation(
        contentId: url,
        contentUrl: Uri.parse(url),
        streamType: CastMediaStreamType.buffered,
        contentType: 'audio/mpeg',
        metadata: GoogleCastGenericMediaMetadata(
          title: book.title,
          subtitle: book.author,
          images: coverUrl == null
              ? const []
              : [GoogleCastImage(url: Uri.parse(coverUrl))],
        ),
        duration: trackDuration,
      );
    }

    final trackUrls = List<String>.from(
      token['trackUrls'] as List? ?? const [],
    );
    if (trackUrls.length > 1 && book.audioTracks.length == trackUrls.length) {
      final durations = book.audioTracks
          .map((track) => Duration(seconds: track.durationSeconds ?? 0))
          .toList();
      var remaining = start;
      var startIndex = 0;
      while (startIndex < durations.length - 1 &&
          durations[startIndex] > Duration.zero &&
          remaining >= durations[startIndex]) {
        remaining -= durations[startIndex];
        startIndex += 1;
      }
      await GoogleCastRemoteMediaClient.instance.queueLoadItems(
        [
          for (var index = 0; index < trackUrls.length; index += 1)
            GoogleCastQueueItem(
              mediaInformation: mediaInfo(
                trackUrls[index],
                durations[index] == Duration.zero ? null : durations[index],
              ),
            ),
        ],
        options: GoogleCastQueueLoadOptions(
          startIndex: startIndex,
          playPosition: remaining,
        ),
      );
    } else {
      final mediaUrl = token['audioUrl'] as String;
      await GoogleCastRemoteMediaClient.instance.loadMedia(
        mediaInfo(
          mediaUrl,
          book.durationSeconds == null
              ? null
              : Duration(seconds: book.durationSeconds!),
        ),
        autoPlay: true,
        playPosition: start,
      );
    }
    await GoogleCastRemoteMediaClient.instance.setPlaybackRate(playbackRate);
    isCasting = true;
    playing = true;
    this.playbackRate = playbackRate;
    position = start;
    notifyListeners();
  }

  Future<void> togglePlayback() async {
    final remote = GoogleCastRemoteMediaClient.instance;
    if (playing) {
      await remote.pause();
    } else {
      await remote.play();
    }
  }

  Future<void> seek(Duration nextPosition) async {
    await GoogleCastRemoteMediaClient.instance.seek(
      GoogleCastMediaSeekOption(position: nextPosition),
    );
  }

  Future<void> setPlaybackRate(double rate) async {
    final nextRate = rate.clamp(0.5, 2.0).toDouble();
    await GoogleCastRemoteMediaClient.instance.setPlaybackRate(nextRate);
    playbackRate = nextRate;
    notifyListeners();
  }

  Future<void> stopCasting() async {
    if (!initialized) return;
    await GoogleCastSessionManager.instance.endSessionAndStopCasting();
    await localCastServer.stop();
    isCasting = false;
    playing = false;
    notifyListeners();
  }

  @override
  void dispose() {
    _sessionSubscription?.cancel();
    _positionSubscription?.cancel();
    _statusSubscription?.cancel();
    unawaited(localCastServer.stop());
    super.dispose();
  }
}

/// Serves cached audio over the phone's local network for Chromecast.
/// Chromecast cannot read Flutter's private app storage directly, so this
/// short-lived server exposes only the files for the active cast session.
class LocalCastServer {
  HttpServer? _server;
  String? _sessionKey;
  List<String> _paths = const [];

  Future<List<String>?> start(List<String> paths) async {
    if (paths.isEmpty || paths.any((path) => !File(path).existsSync())) {
      return null;
    }
    await stop();
    final interfaces = await NetworkInterface.list(
      type: InternetAddressType.IPv4,
      includeLoopback: false,
    );
    final address = interfaces
        .expand((item) => item.addresses)
        .firstWhereOrNull(_isUsableAddress);
    if (address == null) return null;

    _paths = List.unmodifiable(paths);
    _sessionKey = base64Url
        .encode(List<int>.generate(18, (_) => Random.secure().nextInt(256)))
        .replaceAll('=', '');
    _server = await HttpServer.bind(InternetAddress.anyIPv4, 0);
    _server!.listen(_handleRequest);
    return [
      for (var index = 0; index < _paths.length; index += 1)
        'http://${address.address}:${_server!.port}/$_sessionKey/$index',
    ];
  }

  bool _isUsableAddress(InternetAddress address) {
    final value = address.address;
    return value != '127.0.0.1' && !value.startsWith('169.254.');
  }

  Future<void> _handleRequest(HttpRequest request) async {
    final segments = request.uri.pathSegments;
    final key = _sessionKey;
    if (key == null || segments.length != 2 || segments.first != key) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }
    final index = int.tryParse(segments.last);
    if (index == null || index < 0 || index >= _paths.length) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }
    final file = File(_paths[index]);
    if (!await file.exists()) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }
    final length = await file.length();
    final range = _parseRange(
      request.headers.value(HttpHeaders.rangeHeader),
      length,
    );
    final start = range?.$1 ?? 0;
    final end = range?.$2 ?? length - 1;
    request.response.headers.contentType = _contentType(file.path);
    request.response.headers.contentLength = end - start + 1;
    request.response.headers.set(HttpHeaders.acceptRangesHeader, 'bytes');
    if (range != null) {
      request.response.statusCode = HttpStatus.partialContent;
      request.response.headers.set(
        HttpHeaders.contentRangeHeader,
        'bytes $start-$end/$length',
      );
    }
    if (request.method == 'HEAD') {
      await request.response.close();
      return;
    }
    await request.response.addStream(file.openRead(start, end + 1));
    await request.response.close();
  }

  (int, int)? _parseRange(String? header, int length) {
    if (header == null || !header.startsWith('bytes=') || length <= 0) {
      return null;
    }
    final match = RegExp(r'^bytes=(\d*)-(\d*)$').firstMatch(header.trim());
    if (match == null) return null;
    final requestedStart = int.tryParse(match.group(1) ?? '');
    final requestedEnd = int.tryParse(match.group(2) ?? '');
    if (requestedStart == null && requestedEnd == null) return null;
    final start = requestedStart ?? max(0, length - (requestedEnd ?? 0));
    final end = requestedEnd == null
        ? length - 1
        : min(requestedEnd, length - 1);
    if (start < 0 || start >= length || end < start) return null;
    return (start, end);
  }

  ContentType _contentType(String path) {
    final extension = path.split('.').last.toLowerCase();
    return switch (extension) {
      'm4a' || 'm4b' || 'mp4' => ContentType('audio', 'mp4'),
      'ogg' || 'oga' || 'opus' => ContentType('audio', 'ogg'),
      'wav' => ContentType('audio', 'wav'),
      'flac' => ContentType('audio', 'flac'),
      'aac' => ContentType('audio', 'aac'),
      _ => ContentType('audio', 'mpeg'),
    };
  }

  Future<void> stop() async {
    _sessionKey = null;
    _paths = const [];
    final server = _server;
    _server = null;
    await server?.close(force: true);
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? firstWhereOrNull(bool Function(T value) test) {
    for (final value in this) {
      if (test(value)) return value;
    }
    return null;
  }
}

extension on BookMetadataResult {
  BookMetadataResult copyWithBook(Book book) => BookMetadataResult(
    matched: matched,
    coversAdded: coversAdded,
    detailsAdded: detailsAdded,
    book: book,
  );
}

class LocalDeviceLibraryStore {
  LocalDeviceLibraryStore(this.userId);

  static const MethodChannel _channel = MethodChannel(
    'story_stack/local_device',
  );
  final String userId;
  SharedPreferences? _prefs;

  String get _sourceKey => 'librarySourceMode_$userId';
  String get _remoteAddressKey => 'remoteAccessAddress_$userId';
  String get _localNetworkAddressKey => 'localNetworkAddress_$userId';
  String get _themeKey => 'localDeviceTheme_$userId';
  String get _reviewsEnabledKey => 'localDeviceReviewsEnabled_$userId';
  String get _folderKey => 'localDeviceFolder_$userId';
  String get _treeUriKey => 'localDeviceTreeUri_$userId';
  String get _booksKey => 'localDeviceBooks_$userId';
  String get _scannedAtKey => 'localDeviceScannedAt_$userId';
  String get _scannedFilesKey => 'localDeviceScannedFiles_$userId';
  String get _libraryBookIdsKey => 'localDeviceLibraryBookIds_$userId';
  String get _progressKey => 'localDeviceProgress_$userId';
  String get _bookmarksKey => 'localDeviceBookmarks_$userId';

  Future<void> init() async {
    _prefs ??= await SharedPreferences.getInstance();
  }

  Future<LibrarySourceMode> loadSource() async {
    await init();
    return LibrarySourceMode.fromValue(_prefs!.getString(_sourceKey));
  }

  Future<void> saveSource(LibrarySourceMode mode) async {
    await init();
    await _prefs!.setString(_sourceKey, mode.value);
  }

  Future<LibrarySourceAddresses> loadSourceAddresses() async {
    await init();
    return LibrarySourceAddresses(
      remoteAccessAddress:
          _prefs!.getString(_remoteAddressKey) ?? _defaultServerUrl,
      localNetworkAddress: _prefs!.getString(_localNetworkAddressKey) ?? '',
    );
  }

  Future<void> saveSourceAddress(LibrarySourceMode mode, String address) async {
    await init();
    final cleanAddress = address.endsWith('/')
        ? address.substring(0, address.length - 1)
        : address;
    if (mode == LibrarySourceMode.remoteAccess) {
      await _prefs!.setString(_remoteAddressKey, cleanAddress);
      return;
    }
    if (mode == LibrarySourceMode.localNetwork) {
      await _prefs!.setString(_localNetworkAddressKey, cleanAddress);
    }
  }

  Future<User> loadGuestUser() async {
    await init();
    return User(
      id: userId,
      name: 'Local Device',
      role: UserRole.user,
      status: UserStatus.active,
      theme: _prefs!.getString(_themeKey) == 'light'
          ? StoryTheme.light
          : StoryTheme.dark,
      reviewsEnabled: _prefs!.getBool(_reviewsEnabledKey) ?? true,
      metadataEditorEnabled: false,
      passwordConfigured: false,
    );
  }

  Future<User> savePreferences(StoryTheme theme, bool reviewsEnabled) async {
    await init();
    await _prefs!.setString(_themeKey, theme.name);
    await _prefs!.setBool(_reviewsEnabledKey, reviewsEnabled);
    return loadGuestUser();
  }

  Future<LocalDeviceScanState> loadScanState() async {
    await init();
    return LocalDeviceScanState(
      folderPath: _prefs!.getString(_folderKey),
      treeUri: _prefs!.getString(_treeUriKey),
      scannedAt: _prefs!.getString(_scannedAtKey),
      scannedBooks: await loadBooks().then((books) => books.length),
      scannedFiles: _prefs!.getInt(_scannedFilesKey) ?? 0,
    );
  }

  Future<LocalDeviceScanState> saveFolder(String folderPath) async {
    await init();
    await _prefs!.setString(_folderKey, folderPath);
    return loadScanState();
  }

  Future<Set<String>> loadLibraryBookIds() async {
    await init();
    return (_prefs!.getStringList(_libraryBookIdsKey) ?? []).toSet();
  }

  Future<void> addToLibrary(String bookId) async {
    final ids = await loadLibraryBookIds();
    ids.add(bookId);
    await _prefs!.setStringList(_libraryBookIdsKey, ids.toList());
  }

  Future<void> removeFromLibrary(String bookId) async {
    final ids = await loadLibraryBookIds();
    ids.remove(bookId);
    await _prefs!.setStringList(_libraryBookIdsKey, ids.toList());
  }

  Future<List<Book>> loadBooks() async {
    await init();
    final raw = _prefs!.getString(_booksKey);
    if (raw == null || raw.isEmpty) return const [];
    final data = jsonDecode(raw) as List;
    return data.whereType<Map<String, dynamic>>().map(Book.fromJson).toList();
  }

  Future<Map<String, PlaybackProgress>> loadProgress() async {
    await init();
    final raw = _prefs!.getString(_progressKey);
    if (raw == null || raw.isEmpty) return const {};
    final data = jsonDecode(raw) as Map<String, dynamic>;
    return data.map(
      (bookId, value) => MapEntry(
        bookId,
        PlaybackProgress.fromJson(value as Map<String, dynamic>),
      ),
    );
  }

  Future<PlaybackProgress> saveProgress(
    String bookId,
    double positionSeconds,
    double? durationSeconds,
  ) async {
    await init();
    final progress = PlaybackProgress(
      userId: userId,
      bookId: bookId,
      positionSeconds: positionSeconds,
      durationSeconds: durationSeconds,
      status:
          durationSeconds != null &&
              durationSeconds > 0 &&
              positionSeconds >= durationSeconds * 0.98
          ? ProgressStatus.finished
          : positionSeconds > 0
          ? ProgressStatus.inProgress
          : ProgressStatus.notStarted,
    );
    final progressByBook = await loadProgress();
    final next = {...progressByBook, bookId: progress};
    await _prefs!.setString(
      _progressKey,
      jsonEncode(next.map((key, value) => MapEntry(key, value.toJson()))),
    );
    return progress;
  }

  Future<List<BookBookmark>> loadBookmarks(String bookId) async {
    await init();
    final data = jsonDecode(_prefs!.getString(_bookmarksKey) ?? '{}') as Map<String, dynamic>;
    return ((data[bookId] as List?) ?? [])
        .map((item) => BookBookmark.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<BookBookmark> createBookmark(String bookId, int positionSeconds, String title) async {
    await init();
    final all = jsonDecode(_prefs!.getString(_bookmarksKey) ?? '{}') as Map<String, dynamic>;
    final bookmark = BookBookmark(
      id: 'local_bookmark_${DateTime.now().microsecondsSinceEpoch}',
      bookId: bookId,
      positionSeconds: positionSeconds,
      title: title,
    );
    final current = await loadBookmarks(bookId);
    all[bookId] = [...current, bookmark].map((item) => item.toJson()).toList();
    await _prefs!.setString(_bookmarksKey, jsonEncode(all));
    return bookmark;
  }

  Future<void> deleteBookmark(String bookId, String bookmarkId) async {
    await init();
    final all = jsonDecode(_prefs!.getString(_bookmarksKey) ?? '{}') as Map<String, dynamic>;
    final current = await loadBookmarks(bookId);
    all[bookId] = current.where((item) => item.id != bookmarkId).map((item) => item.toJson()).toList();
    await _prefs!.setString(_bookmarksKey, jsonEncode(all));
  }

  Future<LocalDeviceScanState> scan() async {
    await init();
    final treeUri = _prefs!.getString(_treeUriKey);
    if (treeUri != null && treeUri.isNotEmpty) {
      final result = await _channel.invokeMapMethod<String, dynamic>(
        'scanPersisted',
        {'treeUri': treeUri},
      );
      if (result == null) return loadScanState();
      return _saveNativeScanResult(result);
    }
    final folder = _prefs!.getString(_folderKey);
    if (folder == null || folder.isEmpty) {
      throw Exception('Choose an audiobook folder before scanning.');
    }
    final root = Directory(folder);
    if (!await root.exists()) {
      throw Exception('That folder is no longer available.');
    }
    final bookDirectories = await _findBookDirectories(root);
    final books = <Book>[];
    var audioFileCount = 0;
    for (final directory in bookDirectories) {
      final book = await _createBook(root, directory);
      if (book.audioTracks.isNotEmpty) {
        audioFileCount += book.audioTracks.length;
        books.add(book);
      }
    }
    books.sort((left, right) => left.title.compareTo(right.title));
    final scannedAt = DateTime.now().toIso8601String();
    await _prefs!.setString(
      _booksKey,
      jsonEncode(books.map((book) => book.toJson()).toList()),
    );
    await _prefs!.setString(_scannedAtKey, scannedAt);
    await _prefs!.setInt(_scannedFilesKey, audioFileCount);
    return LocalDeviceScanState(
      folderPath: folder,
      scannedAt: scannedAt,
      scannedBooks: books.length,
      scannedFiles: audioFileCount,
    );
  }

  Future<LocalDeviceScanState> chooseAndScan() async {
    await init();
    final result = await _channel.invokeMapMethod<String, dynamic>(
      'chooseAndScan',
    );
    if (result == null) return loadScanState();
    return _saveNativeScanResult(result);
  }

  Future<LocalDeviceScanState> _saveNativeScanResult(
    Map<String, dynamic> result,
  ) async {
    final books = ((result['books'] as List?) ?? [])
        .whereType<Map>()
        .map((item) => Book.fromJson(Map<String, dynamic>.from(item)))
        .toList();
    await _prefs!.setString(_folderKey, '${result['folderPath'] ?? ''}');
    await _prefs!.setString(_treeUriKey, '${result['treeUri'] ?? ''}');
    await _prefs!.setString(_scannedAtKey, '${result['scannedAt'] ?? ''}');
    await _prefs!.setInt(
      _scannedFilesKey,
      (result['scannedFiles'] as num?)?.round() ?? 0,
    );
    await _prefs!.setString(
      _booksKey,
      jsonEncode(books.map((book) => book.toJson()).toList()),
    );
    return LocalDeviceScanState(
      folderPath: _prefs!.getString(_folderKey),
      treeUri: _prefs!.getString(_treeUriKey),
      scannedAt: _prefs!.getString(_scannedAtKey),
      scannedBooks: books.length,
      scannedFiles: _prefs!.getInt(_scannedFilesKey) ?? 0,
    );
  }

  Future<List<Directory>> _findBookDirectories(Directory root) async {
    final audioDirectories = <String, Directory>{};
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is! File) continue;
      if (!_audioExtensions.contains(_extension(entity.path))) continue;
      final directory = entity.parent;
      final normalized = _normalizeBookDirectory(root, directory);
      audioDirectories[normalized.path] = normalized;
    }
    final directories = audioDirectories.values.toList()
      ..sort((left, right) => left.path.compareTo(right.path));
    return directories;
  }

  Future<Book> _createBook(Directory root, Directory directory) async {
    final files = await _readBookFiles(directory);
    final directFileNames = files
        .where((file) => file.parent.path == directory.path)
        .map((file) => _basename(file.path).toLowerCase())
        .toList();
    final metadata = await _readMetadata(directory, directFileNames);
    final audioFiles =
        files
            .where((file) => _audioExtensions.contains(_extension(file.path)))
            .toList()
          ..sort((left, right) => left.path.compareTo(right.path));
    final coverFile = files.firstWhere(
      (file) =>
          _coverExtensions.contains(_extension(file.path)) &&
          RegExp(
            'cover|folder|front',
            caseSensitive: false,
          ).hasMatch(_basename(file.path)),
      orElse: () => files.firstWhere(
        (file) => _coverExtensions.contains(_extension(file.path)),
        orElse: () => File(''),
      ),
    );
    final fallbackTitle = _basename(
      directory.path,
    ).replaceAll(RegExp(r'[_-]+'), ' ');
    return Book(
      id: _stableLocalBookId(directory.path),
      title: _asString(metadata['title']) ?? fallbackTitle,
      subtitle: _asString(metadata['subtitle']),
      author:
          _asString(metadata['author']) ??
          _asString(metadata['authors']) ??
          'Unknown Author',
      narrator: _asString(metadata['narrator']),
      series: _asString(metadata['series']),
      seriesOrder:
          _asNumber(metadata['seriesOrder']) ?? _asNumber(metadata['sequence']),
      description:
          _asString(metadata['description']) ?? _asString(metadata['summary']),
      genres: _asStringArray(metadata['genres'] ?? metadata['tags']),
      durationSeconds:
          _asNumber(metadata['durationSeconds'])?.round() ??
          _asNumber(metadata['duration'])?.round(),
      publicationYear:
          _asNumber(metadata['publicationYear'])?.round() ??
          _asNumber(metadata['publishedYear'])?.round(),
      coverPath: coverFile.path.isEmpty ? null : coverFile.path,
      audioTracks: audioFiles
          .map((file) => BookAudioTrack(path: file.path))
          .toList(),
      addedAt: DateTime.now().toIso8601String(),
      inLibrary: true,
    );
  }

  Directory _normalizeBookDirectory(Directory root, Directory audioDirectory) {
    final name = _basename(audioDirectory.path);
    final isDiscFolder = RegExp(
      r'^(cd|disc|disk|part|volume|vol)\s*[-_.#]?\s*\d+$',
      caseSensitive: false,
    ).hasMatch(name);
    if (audioDirectory.path != root.path && isDiscFolder) {
      return audioDirectory.parent;
    }
    return audioDirectory;
  }

  Future<List<File>> _readBookFiles(Directory directory) async {
    final result = <File>[];
    await for (final entity in directory.list(recursive: false)) {
      if (entity is File) {
        result.add(entity);
      } else if (entity is Directory && _shouldScanNestedBookFiles(entity)) {
        await for (final nested in entity.list(recursive: true)) {
          if (nested is File) result.add(nested);
        }
      }
    }
    return result;
  }

  bool _shouldScanNestedBookFiles(Directory directory) => RegExp(
    r'^(cd|disc|disk|part|volume|vol)\s*[-_.#]?\s*\d+$',
    caseSensitive: false,
  ).hasMatch(_basename(directory.path));

  Future<Map<String, dynamic>> _readMetadata(
    Directory directory,
    List<String> directFileNames,
  ) async {
    final metadataFile = directFileNames.firstWhere(
      _metadataFileNames.contains,
      orElse: () => '',
    );
    if (metadataFile.isEmpty) return const {};
    try {
      final raw = await File('${directory.path}/$metadataFile').readAsString();
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return const {};
    }
  }

  String _stableLocalBookId(String path) =>
      'local_${base64Url.encode(utf8.encode(path)).replaceAll('=', '')}';

  String _extension(String path) {
    final name = _basename(path);
    final dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.substring(dot).toLowerCase();
  }

  String _basename(String path) {
    final parts = path
        .split(RegExp(r'[\\/]'))
        .where((part) => part.isNotEmpty)
        .toList();
    return parts.isEmpty ? '' : parts.last;
  }

  String? _asString(Object? value) {
    if (value is List) return value.map((item) => '$item').join(', ');
    if (value is String && value.trim().isNotEmpty) return value.trim();
    return null;
  }

  double? _asNumber(Object? value) {
    if (value is num && value.isFinite) return value.toDouble();
    if (value is String && value.trim().isNotEmpty) {
      return double.tryParse(value);
    }
    return null;
  }

  List<String> _asStringArray(Object? value) {
    if (value is List) {
      return value
          .map((item) => '$item'.trim())
          .where((item) => item.isNotEmpty)
          .toList();
    }
    if (value is String && value.trim().isNotEmpty) {
      return value
          .split(',')
          .map((item) => item.trim())
          .where((item) => item.isNotEmpty)
          .toList();
    }
    return const [];
  }
}

class OfflineBookStore {
  Set<String> bookIds = {};
  Directory? root;
  final Map<String, http.Client> _activeClients = {};
  final Set<http.Client> _cancelledClients = {};
  final Set<String> _cancelledBookIds = {};

  void beginDownload(String bookId) => _cancelledBookIds.remove(bookId);

  bool wasCancelled(String bookId) => _cancelledBookIds.contains(bookId);

  bool _isCancelled(http.Client client) => _cancelledClients.contains(client);

  void _throwIfCancelled(http.Client client) {
    if (_isCancelled(client)) throw DownloadCancelled();
  }

  Future<void> init() async {
    final docs = await getApplicationDocumentsDirectory();
    root = Directory('${docs.path}/story_stack_downloads');
    await root!.create(recursive: true);
    final prefs = await SharedPreferences.getInstance();
    bookIds = (prefs.getStringList('downloadedBookIds') ?? []).toSet();
  }

  Future<String?> audioPathFor(String bookId) async {
    final path = '${root!.path}/$bookId.audio';
    return await File(path).exists() ? path : null;
  }

  Future<List<String>?> audioPathsFor(Book book) async {
    if (book.audioTracks.length > 1) {
      final paths = List.generate(
        book.audioTracks.length,
        (index) => '${root!.path}/${book.id}.$index.audio',
      );
      for (final path in paths) {
        if (!await File(path).exists()) return null;
      }
      return paths;
    }
    final path = await audioPathFor(book.id);
    return path == null ? null : [path];
  }

  Future<void> saveBook(
    Book book,
    StoryStackApi api,
    ValueChanged<double> onProgress,
    String? localNetworkAddress,
  ) async {
    final trackCount = book.audioTracks.length > 1
        ? book.audioTracks.length
        : 1;
    final client = http.Client();
    _activeClients[book.id] = client;
    final progress = List.generate(trackCount, (_) => _DownloadPartProgress());
    var lastProgressAt = DateTime.fromMillisecondsSinceEpoch(0);
    var lastProgress = -1.0;

    void report(double value, {bool force = false}) {
      final clamped = value.clamp(0, 100).toDouble();
      final now = DateTime.now();
      if (!force &&
          clamped < 100 &&
          (clamped - lastProgress).abs() < 1 &&
          now.difference(lastProgressAt).inMilliseconds < 350) {
        return;
      }
      lastProgress = clamped;
      lastProgressAt = now;
      onProgress(clamped);
    }

    void reportCombinedProgress() {
      final totalBytes = progress.fold<int>(
        0,
        (sum, item) => sum + (item.totalBytes ?? 0),
      );
      if (totalBytes > 0 && progress.every((item) => item.totalBytes != null)) {
        final receivedBytes = progress.fold<int>(
          0,
          (sum, item) => sum + item.receivedBytes.clamp(0, item.totalBytes!),
        );
        report(receivedBytes / totalBytes * 100);
        return;
      }
      final trackPercent =
          progress.fold<double>(0, (sum, item) => sum + item.percent) /
          trackCount;
      report(trackPercent);
    }

    try {
      _throwIfCancelled(client);
      Future<void> downloadTrack(int index) async {
        final url = trackCount == 1
            ? api.audioUrl(book.id)
            : api.audioTrackUrl(book.id, index);
        final localUrl = localNetworkAddress == null ||
                localNetworkAddress.trim().isEmpty
            ? null
            : api.mediaUrlAt(
                localNetworkAddress,
                trackCount == 1
                    ? api.audioPath(book.id)
                    : api.audioTrackPath(book.id, index),
              );
        final file = File(
          trackCount == 1
              ? '${root!.path}/${book.id}.audio'
              : '${root!.path}/${book.id}.$index.audio',
        );
        await _downloadFileOptimized(
          client: client,
          url: url,
          fallbackUrl: localUrl,
          headers: api.authHeaders,
          file: file,
          onProgress: (partProgress) {
            progress[index] = partProgress;
            reportCombinedProgress();
          },
        );
      }

      await _runDownloads(
        itemCount: trackCount,
        concurrency: trackCount == 1 ? 1 : min(8, trackCount),
        download: downloadTrack,
      );
      _throwIfCancelled(client);
      bookIds.add(book.id);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList('downloadedBookIds', bookIds.toList());
      await prefs.setString(
        'androidAutoBook_${book.id}',
        jsonEncode(book.toJson()),
      );
      report(100, force: true);
      return;
    } finally {
      _activeClients.remove(book.id);
      _cancelledClients.remove(client);
      client.close();
    }
  }

  Future<void> cancel(String bookId) async {
    _cancelledBookIds.add(bookId);
    final client = _activeClients[bookId];
    if (client != null) {
      _cancelledClients.add(client);
      client.close();
    }
    await remove(bookId);
  }

  Future<void> _downloadFileOptimized({
    required http.Client client,
    required String url,
    String? fallbackUrl,
    required Map<String, String> headers,
    required File file,
    required ValueChanged<_DownloadPartProgress> onProgress,
  }) async {
    _throwIfCancelled(client);
    if (fallbackUrl != null && fallbackUrl != url) {
      try {
        await _downloadFileOptimized(
          client: client,
          url: fallbackUrl,
          headers: headers,
          file: file,
          onProgress: onProgress,
        );
        return;
      } on DownloadCancelled {
        rethrow;
      } catch (_) {
        _throwIfCancelled(client);
        // The device may leave the configured LAN while the app is open.
        // Resume through the public address without losing the partial file.
      }
    }

    // Cloudflare tunnels cancel competing range streams for large files. Keep
    // remote downloads on one resumable stream, like the web player does.
    if (!_isPrivateNetworkUrl(url)) {
      await _downloadFile(
        client: client,
        url: url,
        headers: headers,
        file: file,
        onProgress: onProgress,
      );
      return;
    }

    final probeRequest = http.Request('GET', Uri.parse(url))
      ..headers.addAll(headers)
      ..headers['Range'] = 'bytes=0-0';

    try {
      final probe = await client.send(probeRequest);
      final totalBytes = _contentRangeTotal(probe.headers['content-range']);
      if (probe.statusCode != 206 || totalBytes == null || totalBytes < 16 * 1024 * 1024) {
        await probe.stream.drain();
        await _downloadFile(
          client: client,
          url: url,
          headers: headers,
          file: file,
          onProgress: onProgress,
        );
        return;
      }
      await probe.stream.drain();

      final chunkCount = min(8, max(2, (totalBytes / (16 * 1024 * 1024)).ceil()));
      final chunkSize = (totalBytes / chunkCount).ceil();
      final receivedByChunk = List<int>.filled(chunkCount, 0);
      final chunkFiles = List.generate(
        chunkCount,
        (index) => File('${file.path}.part.$index'),
      );

      void reportProgress() {
        final received = receivedByChunk.fold<int>(0, (sum, value) => sum + value);
        onProgress(
          _DownloadPartProgress(receivedBytes: received, totalBytes: totalBytes),
        );
      }

      Future<void> downloadChunk(int index) async {
        final start = index * chunkSize;
        final end = min(totalBytes - 1, start + chunkSize - 1);
        final request = http.Request('GET', Uri.parse(url))
          ..headers.addAll(headers)
          ..headers['Range'] = 'bytes=$start-$end';
        final response = await client.send(request);
        if (response.statusCode != 206) {
          await response.stream.drain();
          throw Exception('Server does not support parallel downloads.');
        }
        final sink = chunkFiles[index].openWrite();
        var received = 0;
        try {
          await for (final bytes in response.stream) {
            sink.add(bytes);
            received += bytes.length;
            receivedByChunk[index] = received;
            reportProgress();
          }
        } finally {
          await sink.close();
        }
        if (received != end - start + 1) {
          throw Exception('Download chunk was incomplete.');
        }
      }

      try {
        await Future.wait(List.generate(chunkCount, downloadChunk));
        final partial = File('${file.path}.part');
        final output = partial.openWrite();
        try {
          for (final chunk in chunkFiles) {
            await output.addStream(chunk.openRead());
          }
        } finally {
          await output.close();
        }
        if (await file.exists()) await file.delete();
        await partial.rename(file.path);
        for (final chunk in chunkFiles) {
          if (await chunk.exists()) await chunk.delete();
        }
        onProgress(_DownloadPartProgress(receivedBytes: totalBytes, totalBytes: totalBytes));
      } on DownloadCancelled {
        for (final chunk in chunkFiles) {
          if (await chunk.exists()) await chunk.delete();
        }
        rethrow;
      } catch (_) {
        for (final chunk in chunkFiles) {
          if (await chunk.exists()) await chunk.delete();
        }
        await _downloadFile(
          client: client,
          url: url,
          headers: headers,
          file: file,
          onProgress: onProgress,
        );
      }
    } on DownloadCancelled {
      rethrow;
    } catch (_) {
      _throwIfCancelled(client);
      await _downloadFile(
        client: client,
        url: url,
        headers: headers,
        file: file,
        onProgress: onProgress,
      );
    }
  }

  bool _isPrivateNetworkUrl(String url) {
    final host = Uri.tryParse(url)?.host.toLowerCase();
    if (host == null || host.isEmpty || host == 'localhost' || host == '::1') {
      return true;
    }
    if (host.startsWith('127.') || host.startsWith('10.')) return true;
    final octets = host.split('.');
    if (octets.length != 4) return false;
    final first = int.tryParse(octets[0]);
    final second = int.tryParse(octets[1]);
    return first == 192 && second == 168 ||
        first == 172 && second != null && second >= 16 && second <= 31;
  }

  Future<void> _downloadFile({
    required http.Client client,
    required String url,
    required Map<String, String> headers,
    required File file,
    required ValueChanged<_DownloadPartProgress> onProgress,
  }) async {
    final partial = File('${file.path}.part');

    for (var attempt = 1; attempt <= 20; attempt += 1) {
      final startingBytes = await partial.exists() ? await partial.length() : 0;
      final request = http.Request('GET', Uri.parse(url))
        ..headers.addAll(headers);
      if (startingBytes > 0) {
        request.headers['Range'] = 'bytes=$startingBytes-';
      }

      IOSink? sink;
      try {
        _throwIfCancelled(client);
        final response = await client.send(request);
        if (response.statusCode >= 400) throw Exception('Download failed.');

        final canResume = startingBytes > 0 && response.statusCode == 206;
        if (startingBytes > 0 && !canResume) {
          await partial.delete();
        }
        final baseBytes = canResume ? startingBytes : 0;
        final totalBytes =
            _contentRangeTotal(response.headers['content-range']) ??
            ((response.contentLength ?? 0) > 0
                ? baseBytes + (response.contentLength ?? 0)
                : 0);
        var received = baseBytes;
        onProgress(
          _DownloadPartProgress(
            receivedBytes: received,
            totalBytes: totalBytes > 0 ? totalBytes : null,
          ),
        );
        sink = partial.openWrite(
          mode: canResume ? FileMode.append : FileMode.write,
        );

        // A tunnel can leave a stalled stream open without closing it. Force
        // the retry loop to resume from the partial file instead of waiting
        // indefinitely with a frozen progress indicator.
        await for (final chunk in response.stream.timeout(
          const Duration(seconds: 20),
        )) {
          _throwIfCancelled(client);
          received += chunk.length;
          sink.add(chunk);
          onProgress(
            _DownloadPartProgress(
              receivedBytes: received,
              totalBytes: totalBytes > 0 ? totalBytes : null,
            ),
          );
        }

        await sink.close();
        sink = null;
        if (totalBytes > 0 && await partial.length() < totalBytes) {
          throw Exception('Download interrupted.');
        }
        if (await file.exists()) await file.delete();
        await partial.rename(file.path);
        onProgress(
          _DownloadPartProgress(
            receivedBytes: totalBytes > 0 ? totalBytes : received,
            totalBytes: totalBytes > 0 ? totalBytes : received,
          ),
        );
        return;
      } on DownloadCancelled {
        rethrow;
      } catch (_) {
        try {
          await sink?.close();
        } catch (_) {}
        if (attempt == 20) break;
        await Future.delayed(Duration(milliseconds: 500 + attempt * 500));
      }
    }

    throw Exception(
      'Download was interrupted. Story Stack kept the partial file and will resume when you try again.',
    );
  }

  Future<void> _runDownloads({
    required int itemCount,
    required int concurrency,
    required Future<void> Function(int index) download,
  }) async {
    var nextIndex = 0;

    Future<void> worker() async {
      while (nextIndex < itemCount) {
        final index = nextIndex;
        nextIndex += 1;
        await download(index);
      }
    }

    await Future.wait(
      List.generate(min(concurrency, itemCount), (_) => worker()),
    );
  }

  int? _contentRangeTotal(String? value) {
    if (value == null) return null;
    final slash = value.lastIndexOf('/');
    if (slash < 0 || slash == value.length - 1) return null;
    return int.tryParse(value.substring(slash + 1));
  }

  Future<void> remove(String bookId) async {
    final files = root!.listSync().whereType<File>().where(
      (file) => isDownloadArtifactForBook(
        file.uri.pathSegments.last,
        bookId,
      ),
    );
    for (final file in files) {
      if (await file.exists()) await file.delete();
    }
    bookIds.remove(bookId);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList('downloadedBookIds', bookIds.toList());
  }
}

bool isDownloadArtifactForBook(String fileName, String bookId) {
  final id = RegExp.escape(bookId);
  return RegExp(
    r'^' + id + r'\.audio(?:\.part(?:\.\d+)?)?$',
  ).hasMatch(fileName) || RegExp(
    r'^' + id + r'\.\d+\.audio(?:\.part)?$',
  ).hasMatch(fileName);
}

class DownloadCancelled implements Exception {}

class _DownloadPartProgress {
  const _DownloadPartProgress({this.receivedBytes = 0, this.totalBytes});
  final int receivedBytes;
  final int? totalBytes;

  double get percent {
    final total = totalBytes;
    if (total == null || total <= 0) return 0;
    return (receivedBytes / total * 100).clamp(0, 100).toDouble();
  }
}

class User {
  const User({
    required this.id,
    required this.name,
    required this.role,
    required this.status,
    required this.theme,
    required this.reviewsEnabled,
    required this.metadataEditorEnabled,
    this.username,
    this.email,
    this.passwordResetRequired = false,
    this.passwordConfigured = false,
  });
  final String id;
  final String name;
  final UserRole role;
  final UserStatus status;
  final StoryTheme theme;
  final bool reviewsEnabled;
  final bool metadataEditorEnabled;
  final String? username;
  final String? email;
  final bool passwordResetRequired;
  final bool passwordConfigured;

  User copyWith({bool? metadataEditorEnabled}) => User(
    id: id,
    name: name,
    role: role,
    status: status,
    theme: theme,
    reviewsEnabled: reviewsEnabled,
    metadataEditorEnabled: metadataEditorEnabled ?? this.metadataEditorEnabled,
    username: username,
    email: email,
    passwordResetRequired: passwordResetRequired,
    passwordConfigured: passwordConfigured,
  );

  factory User.fromJson(Map<String, dynamic> json) => User(
    id: '${json['id']}',
    name: '${json['name']}',
    role: json['role'] == 'admin' ? UserRole.admin : UserRole.user,
    status: json['status'] == 'disabled'
        ? UserStatus.disabled
        : UserStatus.active,
    theme: json['theme'] == 'light' ? StoryTheme.light : StoryTheme.dark,
    reviewsEnabled: json['reviewsEnabled'] != false,
    metadataEditorEnabled: json['metadataEditorEnabled'] == true,
    username: json['username'] as String?,
    email: json['email'] as String?,
    passwordResetRequired: json['passwordResetRequired'] == true,
    passwordConfigured: json['passwordConfigured'] == true,
  );
}

class Book {
  const Book({
    required this.id,
    required this.title,
    required this.author,
    required this.genres,
    required this.addedAt,
    this.subtitle,
    this.narrator,
    this.series,
    this.seriesOrder,
    this.description,
    this.durationSeconds,
    this.publicationYear,
    this.coverPath,
    this.audioTracks = const [],
    this.averageRating,
    this.reviewCount,
    this.chapters = const [],
    this.inLibrary = false,
  });
  final String id;
  final String title;
  final String author;
  final List<String> genres;
  final String addedAt;
  final String? subtitle;
  final String? narrator;
  final String? series;
  final double? seriesOrder;
  final String? description;
  final int? durationSeconds;
  final int? publicationYear;
  final String? coverPath;
  final List<BookAudioTrack> audioTracks;
  final double? averageRating;
  final int? reviewCount;
  final List<BookChapter> chapters;
  final bool inLibrary;

  factory Book.fromJson(Map<String, dynamic> json) => Book(
    id: '${json['id']}',
    title: '${json['title'] ?? 'Untitled'}',
    author: '${json['author'] ?? 'Unknown Author'}',
    genres: ((json['genres'] as List?) ?? []).map((item) => '$item').toList(),
    addedAt: '${json['addedAt'] ?? ''}',
    subtitle: json['subtitle'] as String?,
    narrator: json['narrator'] as String?,
    series: json['series'] as String?,
    seriesOrder: (json['seriesOrder'] as num?)?.toDouble(),
    description: json['description'] as String?,
    durationSeconds: (json['durationSeconds'] as num?)?.round(),
    publicationYear: (json['publicationYear'] as num?)?.round(),
    coverPath: json['coverPath'] as String?,
    audioTracks: ((json['audioTracks'] as List?) ?? [])
        .whereType<Map<String, dynamic>>()
        .map(BookAudioTrack.fromJson)
        .toList(),
    averageRating: (json['averageRating'] as num?)?.toDouble(),
    reviewCount: (json['reviewCount'] as num?)?.round(),
    chapters: ((json['chapters'] as List?) ?? [])
        .whereType<Map<String, dynamic>>()
        .map(BookChapter.fromJson)
        .toList(),
    inLibrary: json['inLibrary'] == true,
  );

  bool get isLocalDevice => id.startsWith('local_');

  Book copyWith({bool? inLibrary}) => Book(
    id: id,
    title: title,
    author: author,
    genres: genres,
    addedAt: addedAt,
    subtitle: subtitle,
    narrator: narrator,
    series: series,
    seriesOrder: seriesOrder,
    description: description,
    durationSeconds: durationSeconds,
    publicationYear: publicationYear,
    coverPath: coverPath,
    audioTracks: audioTracks,
    averageRating: averageRating,
    reviewCount: reviewCount,
    chapters: chapters,
    inLibrary: inLibrary ?? this.inLibrary,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'author': author,
    'genres': genres,
    'addedAt': addedAt,
    'subtitle': subtitle,
    'narrator': narrator,
    'series': series,
    'seriesOrder': seriesOrder,
    'description': description,
    'durationSeconds': durationSeconds,
    'publicationYear': publicationYear,
    'coverPath': coverPath,
    'audioTracks': audioTracks.map((track) => track.toJson()).toList(),
    'averageRating': averageRating,
    'reviewCount': reviewCount,
    'chapters': chapters.map((chapter) => chapter.toJson()).toList(),
    'inLibrary': inLibrary,
  };

  bool matches(String query) {
    if (query.isEmpty) return true;
    return [
      title,
      author,
      narrator,
      series,
      ...genres,
    ].whereType<String>().any((value) => value.toLowerCase().contains(query));
  }
}

class BookChapter {
  const BookChapter({required this.id, required this.title, required this.startSeconds, required this.endSeconds});
  final String id;
  final String title;
  final int startSeconds;
  final int endSeconds;
  factory BookChapter.fromJson(Map<String, dynamic> json) => BookChapter(
    id: '${json['id']}',
    title: '${json['title'] ?? 'Chapter'}',
    startSeconds: (json['startSeconds'] as num?)?.round() ?? 0,
    endSeconds: (json['endSeconds'] as num?)?.round() ?? 0,
  );
  Map<String, dynamic> toJson() => {'id': id, 'title': title, 'startSeconds': startSeconds, 'endSeconds': endSeconds};
}

class BookBookmark {
  const BookBookmark({required this.id, required this.bookId, required this.positionSeconds, required this.title});
  final String id;
  final String bookId;
  final int positionSeconds;
  final String title;
  factory BookBookmark.fromJson(Map<String, dynamic> json) => BookBookmark(
    id: '${json['id']}',
    bookId: '${json['bookId']}',
    positionSeconds: (json['positionSeconds'] as num?)?.round() ?? 0,
    title: '${json['title'] ?? 'Bookmark'}',
  );
  Map<String, dynamic> toJson() => {'id': id, 'bookId': bookId, 'positionSeconds': positionSeconds, 'title': title};
}

class BookAudioTrack {
  const BookAudioTrack({required this.path, this.durationSeconds});
  final String path;
  final int? durationSeconds;

  factory BookAudioTrack.fromJson(Map<String, dynamic> json) => BookAudioTrack(
    path: '${json['path'] ?? ''}',
    durationSeconds: (json['durationSeconds'] as num?)?.round(),
  );

  Map<String, dynamic> toJson() => {
    'path': path,
    'durationSeconds': durationSeconds,
  };
}

class PlaybackProgress {
  const PlaybackProgress({
    required this.userId,
    required this.bookId,
    required this.positionSeconds,
    required this.status,
    this.durationSeconds,
  });
  final String userId;
  final String bookId;
  final double positionSeconds;
  final double? durationSeconds;
  final ProgressStatus status;
  factory PlaybackProgress.fromJson(Map<String, dynamic> json) =>
      PlaybackProgress(
        userId: '${json['userId']}',
        bookId: '${json['bookId']}',
        positionSeconds: (json['positionSeconds'] as num?)?.toDouble() ?? 0,
        durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
        status: json['status'] == 'finished'
            ? ProgressStatus.finished
            : json['status'] == 'in_progress' || json['status'] == 'inProgress'
            ? ProgressStatus.inProgress
            : ProgressStatus.notStarted,
      );

  Map<String, dynamic> toJson() => {
    'userId': userId,
    'bookId': bookId,
    'positionSeconds': positionSeconds,
    'durationSeconds': durationSeconds,
    'status': status == ProgressStatus.inProgress ? 'in_progress' : status.name,
  };
}

class Shelf {
  const Shelf({required this.id, required this.name});
  final String id;
  final String name;
  factory Shelf.fromJson(Map<String, dynamic> json) =>
      Shelf(id: '${json['id']}', name: '${json['name']}');
}

class LibraryResponse {
  const LibraryResponse({required this.books, required this.progress});
  final List<Book> books;
  final List<PlaybackProgress> progress;
}

class BookReviewResponse {
  const BookReviewResponse({
    required this.summary,
    required this.reviews,
    this.myReview,
  });
  final BookReviewSummary summary;
  final List<BookReview> reviews;
  final BookReview? myReview;
  factory BookReviewResponse.fromJson(Map<String, dynamic> json) =>
      BookReviewResponse(
        summary: BookReviewSummary.fromJson(
          json['summary'] as Map<String, dynamic>,
        ),
        reviews: ((json['reviews'] as List?) ?? [])
            .map((item) => BookReview.fromJson(item))
            .toList(),
        myReview: json['myReview'] == null
            ? null
            : BookReview.fromJson(json['myReview'] as Map<String, dynamic>),
      );
}

class BookMetadataUpdate {
  const BookMetadataUpdate({
    this.title,
    this.subtitle,
    this.author,
    this.narrator,
    this.series,
    this.seriesOrder,
    this.description,
    this.genres = const [],
    this.publicationYear,
  });

  final String? title;
  final String? subtitle;
  final String? author;
  final String? narrator;
  final String? series;
  final double? seriesOrder;
  final String? description;
  final List<String> genres;
  final int? publicationYear;

  Map<String, dynamic> toJson() => {
    if (title != null) 'title': title,
    if (subtitle != null) 'subtitle': subtitle,
    if (author != null) 'author': author,
    if (narrator != null) 'narrator': narrator,
    if (series != null) 'series': series,
    if (seriesOrder != null) 'seriesOrder': seriesOrder,
    if (description != null) 'description': description,
    if (genres.isNotEmpty) 'genres': genres,
    if (publicationYear != null) 'publicationYear': publicationYear,
  };
}

class BookMetadataResult {
  const BookMetadataResult({
    required this.matched,
    required this.coversAdded,
    required this.detailsAdded,
    required this.book,
  });

  final bool matched;
  final int coversAdded;
  final int detailsAdded;
  final Book book;

  factory BookMetadataResult.fromJson(Map<String, dynamic> json) =>
      BookMetadataResult(
        matched: json['matched'] == true,
        coversAdded: (json['coversAdded'] as num?)?.round() ?? 0,
        detailsAdded: (json['detailsAdded'] as num?)?.round() ?? 0,
        book: Book.fromJson(json['book'] as Map<String, dynamic>),
      );
}

class BookReviewSummary {
  const BookReviewSummary({
    required this.averageRating,
    required this.reviewCount,
  });
  final double averageRating;
  final int reviewCount;
  factory BookReviewSummary.fromJson(Map<String, dynamic> json) =>
      BookReviewSummary(
        averageRating: (json['averageRating'] as num?)?.toDouble() ?? 0,
        reviewCount: (json['reviewCount'] as num?)?.round() ?? 0,
      );
}

class BookReview {
  const BookReview({
    required this.userName,
    required this.rating,
    required this.review,
    required this.isMine,
  });
  final String userName;
  final int rating;
  final String review;
  final bool isMine;
  factory BookReview.fromJson(Map<String, dynamic> json) => BookReview(
    userName: '${json['userName']}',
    rating: (json['rating'] as num?)?.round() ?? 0,
    review: '${json['review'] ?? ''}',
    isMine: json['isMine'] == true,
  );
}

class RemoteAccessSettings {
  const RemoteAccessSettings({
    required this.mode,
    required this.publicUrl,
    required this.status,
    required this.message,
  });
  final RemoteAccessMode mode;
  final String publicUrl;
  final String status;
  final String message;

  factory RemoteAccessSettings.fromJson(Map<String, dynamic> json) =>
      RemoteAccessSettings(
        mode: switch (json['mode']) {
          'cloudflare' => RemoteAccessMode.cloudflare,
          'manual' => RemoteAccessMode.cloudflare,
          'device' => RemoteAccessMode.localDevice,
          _ => RemoteAccessMode.localNetwork,
        },
        publicUrl: '${json['publicUrl'] ?? ''}',
        status: '${json['status'] ?? 'not_configured'}',
        message: '${json['message'] ?? ''}',
      );
}

class LocalDeviceScanState {
  const LocalDeviceScanState({
    this.folderPath,
    this.treeUri,
    this.scannedAt,
    this.scannedBooks = 0,
    this.scannedFiles = 0,
  });

  final String? folderPath;
  final String? treeUri;
  final String? scannedAt;
  final int scannedBooks;
  final int scannedFiles;

  LocalDeviceScanState copyWith({
    String? folderPath,
    String? treeUri,
    String? scannedAt,
    int? scannedBooks,
    int? scannedFiles,
  }) => LocalDeviceScanState(
    folderPath: folderPath ?? this.folderPath,
    treeUri: treeUri ?? this.treeUri,
    scannedAt: scannedAt ?? this.scannedAt,
    scannedBooks: scannedBooks ?? this.scannedBooks,
    scannedFiles: scannedFiles ?? this.scannedFiles,
  );
}

class LibrarySourceAddresses {
  const LibrarySourceAddresses({
    required this.remoteAccessAddress,
    required this.localNetworkAddress,
  });

  final String remoteAccessAddress;
  final String localNetworkAddress;
}

class BookGroup {
  const BookGroup({required this.name, required this.books});
  final String name;
  final List<Book> books;

  BookGroup copyWith({List<Book>? books}) =>
      BookGroup(name: name, books: books ?? this.books);
}

enum AppSection { home, library, series, authors, shelves, downloads, settings }

enum GroupMode { series, author }

enum BookSortKey {
  title('Title'),
  author('Author'),
  addedAt('Recently Added'),
  publicationYear('Published Year'),
  rating('Rating');

  const BookSortKey(this.label);
  final String label;
}

enum SortDirection {
  ascending,
  descending;

  SortDirection get flipped => this == ascending ? descending : ascending;
}

enum StoryTheme { dark, light }

enum UserRole { admin, user }

enum UserStatus { active, disabled }

enum LibrarySourceMode {
  remoteAccess('remote'),
  localNetwork('local'),
  localDevice('device');

  const LibrarySourceMode(this.value);
  final String value;

  static LibrarySourceMode fromValue(String? value) => switch (value) {
    'local' => LibrarySourceMode.localNetwork,
    'device' => LibrarySourceMode.localDevice,
    _ => LibrarySourceMode.remoteAccess,
  };
}

enum RemoteAccessMode {
  cloudflare('cloudflare'),
  localNetwork('local'),
  localDevice('device');

  const RemoteAccessMode(this.apiValue);
  final String apiValue;
}

enum ProgressStatus { notStarted, inProgress, finished }

List<Book> sortBooks(List<Book> books) =>
    [...books]..sort((a, b) => b.addedAt.compareTo(a.addedAt));

List<Book> sortBooksForDisplay(
  List<Book> books,
  BookSortKey key,
  SortDirection direction,
) {
  final multiplier = direction == SortDirection.ascending ? 1 : -1;
  return [...books]..sort((left, right) {
    final result = switch (key) {
      BookSortKey.title => compareText(left.title, right.title) * multiplier,
      BookSortKey.author => firstNonZero(
        compareText(left.author, right.author) * multiplier,
        compareText(left.title, right.title),
      ),
      BookSortKey.addedAt => firstNonZero(
        compareText(left.addedAt, right.addedAt) * multiplier,
        compareText(left.title, right.title),
      ),
      BookSortKey.publicationYear => firstNonZero(
        compareOptionalNumber(
          left.publicationYear,
          right.publicationYear,
          multiplier,
        ),
        compareText(left.title, right.title),
      ),
      BookSortKey.rating => firstNonZero(
        compareOptionalNumber(
          left.averageRating,
          right.averageRating,
          multiplier,
        ),
        compareText(left.title, right.title),
      ),
    };
    return result;
  });
}

int firstNonZero(int primary, int secondary) =>
    primary == 0 ? secondary : primary;

int compareText(String? left, String? right) =>
    (left ?? '').toLowerCase().compareTo((right ?? '').toLowerCase());

int compareOptionalNumber(num? left, num? right, int multiplier) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left.compareTo(right) * multiplier;
}

List<Book> sortSeries(List<Book> books) => [...books]
  ..sort(
    (a, b) => (a.seriesOrder ?? a.publicationYear ?? 9999).compareTo(
      b.seriesOrder ?? b.publicationYear ?? 9999,
    ),
  );

List<BookGroup> groupsFor(List<Book> books, GroupMode mode) {
  final map = <String, List<Book>>{};
  for (final book in books) {
    final key = mode == GroupMode.series ? book.series : book.author;
    if (key == null ||
        key.trim().isEmpty ||
        key.toLowerCase() == 'standalone') {
      continue;
    }
    map.putIfAbsent(key, () => []).add(book);
  }
  return map.entries
      .map(
        (entry) => BookGroup(
          name: entry.key,
          books: mode == GroupMode.series
              ? sortSeries(entry.value)
              : sortBooks(entry.value),
        ),
      )
      .toList()
    ..sort((a, b) => a.name.compareTo(b.name));
}

double? progressPercentFor(Book book, PlaybackProgress? progress) {
  if (progress == null || progress.positionSeconds <= 0) return null;
  if (progress.status == ProgressStatus.finished) return 100;
  final total = progress.durationSeconds ?? book.durationSeconds?.toDouble();
  if (total == null || total <= 0) return null;
  return (progress.positionSeconds / total * 100).clamp(1, 99);
}

class BookProgressSummary {
  const BookProgressSummary({required this.percent, required this.timeLeft});

  final int percent;
  final Duration timeLeft;
}

BookProgressSummary? progressSummaryFor(Book book, PlaybackProgress? progress) {
  if (progress == null) return null;

  final totalSeconds =
      progress.durationSeconds ?? book.durationSeconds?.toDouble();
  if (totalSeconds == null || totalSeconds <= 0) return null;

  if (progress.status == ProgressStatus.finished) {
    return const BookProgressSummary(percent: 100, timeLeft: Duration.zero);
  }

  if (progress.positionSeconds <= 0) return null;

  final positionSeconds = progress.positionSeconds.clamp(0, totalSeconds);
  final percent = (positionSeconds / totalSeconds * 100).clamp(1, 99).round();
  final timeLeftSeconds = (totalSeconds - positionSeconds).clamp(
    0,
    totalSeconds,
  );

  return BookProgressSummary(
    percent: percent,
    timeLeft: Duration(seconds: timeLeftSeconds.round()),
  );
}

String seriesLabel(Book book) => book.seriesOrder == null
    ? book.series ?? ''
    : '${book.series} #${book.seriesOrder!.toStringAsFixed(book.seriesOrder! % 1 == 0 ? 0 : 1)}';

String formatTime(Duration duration) {
  final hours = duration.inHours;
  final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
  final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
  return hours > 0 ? '$hours:$minutes:$seconds' : '$minutes:$seconds';
}

int? bookDurationSeconds(Book book) {
  if (book.durationSeconds case final seconds? when seconds > 0) {
    return seconds;
  }
  final total = book.audioTracks.fold<int>(
    0,
    (sum, track) => sum + (track.durationSeconds ?? 0),
  );
  return total > 0 ? total : null;
}

int _trackIndexForPosition(int positionSeconds, List<Duration> durations) {
  if (durations.isEmpty) return 0;
  var elapsed = 0;
  for (var index = 0; index < durations.length; index += 1) {
    final seconds = durations[index].inSeconds;
    if (seconds <= 0 || positionSeconds < elapsed + seconds) {
      return index;
    }
    elapsed += seconds;
  }
  return durations.length - 1;
}

Duration _trackPositionForWhole(
  Duration wholePosition,
  int trackIndex,
  List<Duration> durations,
) {
  final offset = durations
      .take(trackIndex)
      .fold<Duration>(Duration.zero, (sum, item) => sum + item);
  final position = wholePosition - offset;
  return position.isNegative ? Duration.zero : position;
}
