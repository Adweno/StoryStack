import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowDownAZ,
  ArrowUpAZ,
  BookMarked,
  Download,
  Home,
  Library,
  Play,
  Plus,
  PencilLine,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Store,
  Trash2,
  UserRound,
  Users,
  X
} from "lucide-react";
import { ApiClient, type BookReviewResponse } from "./lib/ApiClient";
import { BookCard } from "./components/BookCard";
import { BookCover } from "./components/BookCover";
import { PlayerBar, type PlaybackRequest } from "./components/PlayerBar";
import { BookBrowser, type BookBrowseMode } from "./lib/BookBrowser";
import { defaultBookSort, sortBooksForDisplay, type BookSortOptions } from "./lib/BookSorter";
import { LibraryAddPlanner } from "./lib/LibraryAddPlanner";
import { LibraryRemovePlanner } from "./lib/LibraryRemovePlanner";
import { OfflineBookCache } from "./lib/OfflineBookCache";
import storyStackLogo from "./assets/story-stack-logo.png";
import type {
  Book,
  MetadataEnrichmentResult,
  RemoteAccessSettings,
  Shelf,
  SyncResult,
  User,
  UserInvite,
  BookReview,
  PlaybackProgress
} from "./types";

type View = "home" | "library" | "series" | "authors" | "shelves" | "downloads" | "admin";
type Space = "library" | "store";
type OfflineState = "idle" | "saving" | "saved";
type SettingsTab = "access" | "catalog";
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const LAST_USER_KEY = "story-stack-last-user-v1";
const DEFAULT_SHELF_NAME = "Favorites";

async function ensureDefaultShelf(api: ApiClient, shelfList: Shelf[]): Promise<Shelf[]> {
  const existing = shelfList.find((shelf) => shelf.name.toLowerCase() === DEFAULT_SHELF_NAME.toLowerCase());
  const shelvesWithDefault = existing ? shelfList : [...shelfList, await api.createShelf(DEFAULT_SHELF_NAME)];
  return [...shelvesWithDefault].sort((left, right) => {
    const leftIsDefault = left.name.toLowerCase() === DEFAULT_SHELF_NAME.toLowerCase();
    const rightIsDefault = right.name.toLowerCase() === DEFAULT_SHELF_NAME.toLowerCase();
    if (leftIsDefault !== rightIsDefault) {
      return leftIsDefault ? -1 : 1;
    }
    return 0;
  });
}

export function App() {
  const api = useMemo(() => new ApiClient(), []);
  const offlineCache = useMemo(() => new OfflineBookCache(), []);
  const [space, setSpace] = useState<Space>("library");
  const [view, setView] = useState<View>("home");
  const [user, setUser] = useState<User>();
  const [authChecked, setAuthChecked] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const userSettingsMenuRef = useRef<HTMLDivElement>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent>();
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [installActionVisible, setInstallActionVisible] = useState(true);
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [storeBooks, setStoreBooks] = useState<Book[]>([]);
  const [libraryBooks, setLibraryBooks] = useState<Book[]>([]);
  const [playbackProgressByBookId, setPlaybackProgressByBookId] = useState<Record<string, PlaybackProgress>>({});
  const [cachedOfflineBooks, setCachedOfflineBooks] = useState<Book[]>([]);
  const [offlineBookIds, setOfflineBookIds] = useState<Set<string>>(new Set());
  const [savingOfflineBookIds, setSavingOfflineBookIds] = useState<Set<string>>(new Set());
  const [offlineProgressByBookId, setOfflineProgressByBookId] = useState<Record<string, number | undefined>>({});
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book>();
  const [selectedBookSpace, setSelectedBookSpace] = useState<Space>("library");
  const [selectedBookReviews, setSelectedBookReviews] = useState<BookReviewResponse>();
  const [reviewMessage, setReviewMessage] = useState("");
  const [playback, setPlayback] = useState<PlaybackRequest>();
  const [query, setQuery] = useState("");
  const [storeBrowseMode, setStoreBrowseMode] = useState<BookBrowseMode>("title");
  const [libraryBrowseMode, setLibraryBrowseMode] = useState<BookBrowseMode>("title");
  const [storeBookSort, setStoreBookSort] = useState<BookSortOptions>(defaultBookSort);
  const [libraryBookSort, setLibraryBookSort] = useState<BookSortOptions>(defaultBookSort);
  const [storeCategoryKey, setStoreCategoryKey] = useState<string>();
  const [libraryCategoryKey, setLibraryCategoryKey] = useState<string>();
  const [selectedShelf, setSelectedShelf] = useState<Shelf>();
  const [selectedShelfBooks, setSelectedShelfBooks] = useState<Book[]>([]);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("access");
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminInvites, setAdminInvites] = useState<UserInvite[]>([]);
  const [remoteSettings, setRemoteSettings] = useState<RemoteAccessSettings>();
  const [remoteMode, setRemoteMode] = useState<RemoteAccessSettings["mode"]>("local");
  const [remotePublicUrl, setRemotePublicUrl] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "user">("user");
  const [inviteDays, setInviteDays] = useState("14");
  const [inviteLink, setInviteLink] = useState("");
  const [metadataResult, setMetadataResult] = useState<MetadataEnrichmentResult>();
  const [metadataMessage, setMetadataMessage] = useState("");
  const [catalogPath, setCatalogPath] = useState("");
  const [catalogResult, setCatalogResult] = useState<SyncResult>();

  const navigateToView = (nextView: View) => {
    setSelectedBook(undefined);
    setSelectedBookReviews(undefined);
    setReviewMessage("");
    setView(nextView);
    scrollToPageTop();
  };
  const [catalogMessage, setCatalogMessage] = useState("");
  const [shelfName, setShelfName] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [userMessage, setUserMessage] = useState("");
  const [userSettingsMessage, setUserSettingsMessage] = useState("");

  const libraryIds = useMemo(() => new Set(libraryBooks.map((book) => book.id)), [libraryBooks]);
  const playbackProgressFor = (book: Book): number | undefined => progressPercentForBook(book, playbackProgressByBookId[book.id]);
  const downloadedBookSource = useMemo(() => {
    const booksById = new Map<string, Book>();
    cachedOfflineBooks.forEach((book) => booksById.set(book.id, book));
    libraryBooks.forEach((book) => booksById.set(book.id, book));
    return [...booksById.values()];
  }, [cachedOfflineBooks, libraryBooks]);
  const downloadedBooks = useMemo(
    () => downloadedBookSource.filter((book) => offlineBookIds.has(book.id) && matchesBookQuery(book, query)),
    [downloadedBookSource, offlineBookIds, query]
  );
  const effectiveLibraryBrowseMode = browseModeForView(view, libraryBrowseMode);
  const effectiveStoreBrowseMode = browseModeForView(view, storeBrowseMode);
  const title =
    selectedShelf && space === "library" && view === "shelves"
      ? selectedShelf.name
      : viewTitle(space, view, storeBooks.length, libraryBooks.length);
  const shellClassName = `${space === "store" ? "app-shell store-space" : "app-shell"} ${user?.theme === "light" ? "light-theme" : ""}`.trim();

  useEffect(() => {
    scrollToPageTop();
  }, [selectedBook?.id, selectedShelf?.id, space, view]);

  useEffect(() => {
    void refresh().finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    const beforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallActionVisible(true);
    };
    const appInstalled = () => {
      setInstallPrompt(undefined);
      setInstallHelpOpen(false);
      setInstallActionVisible(false);
    };
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    setInstallActionVisible(!standalone);
    window.addEventListener("beforeinstallprompt", beforeInstallPrompt);
    window.addEventListener("appinstalled", appInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstallPrompt);
      window.removeEventListener("appinstalled", appInstalled);
    };
  }, []);

  useEffect(() => {
    if (!user || offlineOnly) {
      return;
    }
    const timer = window.setTimeout(() => {
      void api.store(query).then(setStoreBooks).catch(() => setUser(undefined));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [api, offlineOnly, query, user]);

  useEffect(() => {
    if (!accountOpen && !userSettingsOpen) {
      return;
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
      if (!userSettingsMenuRef.current?.contains(event.target as Node)) {
        setUserSettingsOpen(false);
      }
    };
    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => window.removeEventListener("mousedown", closeOnOutsideClick);
  }, [accountOpen, userSettingsOpen]);

  useEffect(() => {
    if (space !== "store" || view !== "admin" || user?.role !== "admin") {
      return;
    }
    void loadAdminUsers();
    void loadInvites();
    void loadRemoteAccessSettings();
    void loadCatalogSettings();
  }, [api, space, user?.role, view]);

  useEffect(() => {
    if (!user) {
      setOfflineBookIds(new Set());
      return;
    }
    let active = true;
    const candidateBooks = downloadedBookSource;
    void Promise.all(candidateBooks.map(async (book) => [book.id, await offlineCache.has(book.id)] as const)).then((states) => {
      if (!active) {
        return;
      }
      setOfflineBookIds(new Set(states.filter(([, cached]) => cached).map(([bookId]) => bookId)));
    });
    return () => {
      active = false;
    };
  }, [downloadedBookSource, offlineCache, user]);

  const refresh = async () => {
    try {
      const [me, store, library, shelfList] = await Promise.all([api.me(), api.store(query), api.library(), api.shelves()]);
      const shelvesWithDefault = await ensureDefaultShelf(api, shelfList);
      window.localStorage.setItem(LAST_USER_KEY, JSON.stringify(me));
      setOfflineOnly(false);
      setUser(me);
      setStoreBooks(store);
      setLibraryBooks(library.books);
      setPlaybackProgressByBookId(indexProgressByBookId(library.progress));
      setCachedOfflineBooks(await offlineCache.listBooks());
      setShelves(shelvesWithDefault);
      if (selectedShelf) {
        const shelfBooks = await api.shelfBooks(selectedShelf.id);
        setSelectedShelfBooks(shelfBooks);
      }
    } catch (error) {
      const cachedBooks = await offlineCache.listBooks();
      if (cachedBooks.length > 0) {
        setOfflineOnly(true);
        setUser(
          readLastUser() ?? {
            id: "offline",
            name: "Offline",
            role: "user",
            status: "active",
            theme: "dark",
            reviewsEnabled: true,
            metadataEditorEnabled: false
          }
        );
        setStoreBooks([]);
        setLibraryBooks([]);
        setPlaybackProgressByBookId({});
        setCachedOfflineBooks(cachedBooks);
        setShelves([]);
        setSelectedShelf(undefined);
        setSelectedShelfBooks([]);
        setSpace("library");
        setView("downloads");
        return;
      }
      setUser(undefined);
      setOfflineOnly(false);
      setStoreBooks([]);
      setLibraryBooks([]);
      setPlaybackProgressByBookId({});
      setCachedOfflineBooks([]);
      setShelves([]);
      setSelectedShelf(undefined);
      setSelectedShelfBooks([]);
      throw error;
    }
  };

  const logout = async () => {
    if (!offlineOnly) {
      await api.logout();
    }
    setAccountOpen(false);
    setUser(undefined);
    setOfflineOnly(false);
    setStoreBooks([]);
    setLibraryBooks([]);
    setCachedOfflineBooks([]);
    setShelves([]);
    setSelectedShelf(undefined);
    setSelectedShelfBooks([]);
    setSelectedBook(undefined);
    setPlayback(undefined);
  };

  const installApp = async () => {
    if (!installPrompt) {
      setInstallHelpOpen(true);
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(undefined);
  };

  const changeOwnPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      return;
    }
    setPasswordMessage("");
    try {
      const updatedUser = await api.changePassword({
        currentPassword: user.passwordConfigured && !user.passwordResetRequired ? currentPassword : undefined,
        newPassword
      });
      setUser(updatedUser);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMessage("Password saved.");
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : "Password could not be saved.");
    }
  };

  const updateUserPreferences = async (input: { theme: "dark" | "light"; reviewsEnabled: boolean }) => {
    if (!user) {
      return;
    }
    setUserSettingsMessage("");
    try {
      const updatedUser = await api.updatePreferences(input);
      window.localStorage.setItem(LAST_USER_KEY, JSON.stringify(updatedUser));
      setUser(updatedUser);
      setUserSettingsMessage("Settings saved.");
    } catch (error) {
      setUserSettingsMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    }
  };

  const canEditMetadata = Boolean(user && (user.role === "admin" || user.metadataEditorEnabled));

  const saveBookMetadata = async (
    book: Book,
    input: {
      title?: string;
      subtitle?: string;
      author?: string;
      narrator?: string;
      series?: string;
      seriesOrder?: number;
      description?: string;
      genres?: string[];
      publicationYear?: number;
    }
  ) => {
    const updatedBook = await api.updateBookMetadata(book.id, input);
    setSelectedBook(updatedBook);
    await refresh();
    setSelectedBook(updatedBook);
    return updatedBook;
  };

  const findBookMetadata = async (book: Book) => {
    const result = await api.findBookMetadata(book.id);
    setSelectedBook(result.book);
    await refresh();
    setSelectedBook(result.book);
    return result;
  };

  const addToLibrary = async (book: Book) => {
    await api.addToLibrary(book.id);
    await refresh();
  };

  const addBooksToLibrary = async (books: Book[]) => {
    const missingBooks = new LibraryAddPlanner(libraryIds).missingBooks(books);
    await Promise.all(missingBooks.map((book) => api.addToLibrary(book.id)));
    await refresh();
  };

  const removeFromLibrary = async (book: Book) => {
    await api.removeFromLibrary(book.id);
    await refresh();
  };

  const removeBooksFromLibrary = async (books: Book[]) => {
    const removableBooks = new LibraryRemovePlanner().removableBooks(books);
    await Promise.all(removableBooks.map((book) => api.removeFromLibrary(book.id)));
    await refresh();
  };

  const moveToShelf = async (book: Book, shelf: Shelf) => {
    await api.addBookToShelf(shelf.id, book.id);
    await refresh();
  };

  const removeFromShelf = async (book: Book, shelf: Shelf) => {
    await api.removeBookFromShelf(shelf.id, book.id);
    if (selectedShelf?.id === shelf.id) {
      setSelectedShelfBooks((current) => current.filter((item) => item.id !== book.id));
    }
  };

  const openShelf = async (shelf: Shelf) => {
    setSelectedShelf(shelf);
    setSelectedShelfBooks(await api.shelfBooks(shelf.id));
  };

  const selectBook = (book: Book, source: Space) => {
    setSelectedBook(book);
    setSelectedBookSpace(source);
    setSelectedBookReviews(undefined);
    setReviewMessage("");
    void loadBookReviews(book.id);
  };

  const loadBookReviews = async (bookId: string) => {
    try {
      setSelectedBookReviews(await api.bookReviews(bookId));
    } catch {
      setSelectedBookReviews({
        summary: { averageRating: 0, reviewCount: 0 },
        reviews: []
      });
    }
  };

  const saveBookReview = async (book: Book, rating: number, review: string) => {
    setReviewMessage("");
    try {
      await api.saveBookReview(book.id, { rating, review });
      await loadBookReviews(book.id);
      await refresh();
      setReviewMessage("Review saved.");
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Review could not be saved.");
    }
  };

  const deleteBookReview = async (book: Book) => {
    const confirmed = window.confirm("Remove your review for this book?");
    if (!confirmed) return;
    setReviewMessage("");
    try {
      await api.deleteMyBookReview(book.id);
      await loadBookReviews(book.id);
      await refresh();
      setReviewMessage("Review removed.");
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Review could not be removed.");
    }
  };

  const startPlayback = (book: Book, mode: PlaybackRequest["mode"], chapterStartSeconds?: number) => {
    const savedProgress = playbackProgressByBookId[book.id];
    const startSeconds = chapterStartSeconds ?? (mode === "play" && savedProgress?.status !== "finished" ? savedProgress?.positionSeconds : undefined);
    setPlayback({ book, mode, requestId: Date.now(), startSeconds });
  };

  const updatePlaybackProgress = (bookId: string, positionSeconds: number, durationSeconds?: number) => {
    setPlaybackProgressByBookId((current) => ({
      ...current,
      [bookId]: {
        bookId,
        userId: user?.id ?? "",
        positionSeconds,
        durationSeconds,
        status: listeningStatusFor(positionSeconds, durationSeconds),
        updatedAt: new Date().toISOString()
      }
    }));
  };

  const markBookFinished = async (book: Book) => {
    const durationSeconds = playbackProgressByBookId[book.id]?.durationSeconds ?? book.durationSeconds ?? 1;
    await api.saveProgress(book.id, durationSeconds, durationSeconds);
    updatePlaybackProgress(book.id, durationSeconds, durationSeconds);
  };

  const clearBookProgress = async (book: Book) => {
    await api.saveProgress(book.id, 0);
    setPlaybackProgressByBookId((current) => {
      const next = { ...current };
      delete next[book.id];
      return next;
    });
  };

  const saveOffline = async (book: Book) => {
    setSavingOfflineBookIds((current) => new Set(current).add(book.id));
    setOfflineProgressByBookId((current) => ({ ...current, [book.id]: 0 }));
    try {
      await offlineCache.save(book, {
        onProgress: (progress) => {
          setOfflineProgressByBookId((current) => ({ ...current, [book.id]: progress.percent }));
        }
      });
      setCachedOfflineBooks(await offlineCache.listBooks());
      setOfflineBookIds((current) => new Set(current).add(book.id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Book could not be saved offline.");
    } finally {
      setOfflineProgressByBookId((current) => {
        const next = { ...current };
        delete next[book.id];
        return next;
      });
      setSavingOfflineBookIds((current) => {
        const next = new Set(current);
        next.delete(book.id);
        return next;
      });
    }
  };

  const removeOffline = async (book: Book) => {
    await offlineCache.remove(book);
    setCachedOfflineBooks(await offlineCache.listBooks());
    setOfflineBookIds((current) => {
      const next = new Set(current);
      next.delete(book.id);
      return next;
    });
  };

  const offlineStateFor = (book: Book): OfflineState => {
    if (savingOfflineBookIds.has(book.id)) {
      return "saving";
    }
    return offlineBookIds.has(book.id) ? "saved" : "idle";
  };

  const offlineProgressFor = (book: Book): number | undefined => offlineProgressByBookId[book.id];

  const createShelf = async (event: FormEvent) => {
    event.preventDefault();
    await api.createShelf(shelfName);
    setShelfName("");
    await refresh();
  };

  const runMetadataEnrichment = async () => {
    setMetadataMessage("Looking for missing metadata...");
    setMetadataResult(undefined);
    try {
      const result = await api.enrichMetadata();
      setMetadataResult(result);
      setMetadataMessage("");
      await refresh();
    } catch (error) {
      setMetadataMessage(error instanceof Error ? error.message : "Metadata lookup failed.");
    }
  };

  const loadCatalogSettings = async () => {
    const catalog = await api.catalogSettings();
    setCatalogPath(catalog.settings.libraryPath);
    setCatalogResult(catalog.latestSync);
  };

  const saveCatalogSettings = async (event: FormEvent) => {
    event.preventDefault();
    setCatalogMessage("");
    try {
      const settings = await api.saveCatalogSettings({ libraryPath: catalogPath });
      setCatalogPath(settings.libraryPath);
      setCatalogMessage("Audiobook folder saved.");
    } catch (error) {
      setCatalogMessage(error instanceof Error ? error.message : "Audiobook folder could not be saved.");
    }
  };

  const syncCatalog = async () => {
    setCatalogMessage("Scanning audiobook folder...");
    setCatalogResult(undefined);
    try {
      const result = await api.syncCatalog(catalogPath);
      setCatalogResult(result);
      setCatalogMessage("");
      await refresh();
    } catch (error) {
      setCatalogMessage(error instanceof Error ? error.message : "Audiobook folder could not be scanned.");
    }
  };


  const loadAdminUsers = async () => {
    setAdminUsers(await api.users());
  };

  const loadInvites = async () => {
    setAdminInvites(await api.invites());
  };

  const loadRemoteAccessSettings = async () => {
    const settings = await api.remoteAccessSettings();
    setRemoteSettings(settings);
    setRemoteMode(settings.mode);
    setRemotePublicUrl(settings.publicUrl);
  };

  const saveRemoteAccessSettings = async (event: FormEvent) => {
    event.preventDefault();
    setUserMessage("");
    try {
      const settings = await api.saveRemoteAccessSettings({
        mode: remoteMode,
        publicUrl: remoteMode === "device" ? "" : remotePublicUrl
      });
      setRemoteSettings(settings);
      setRemoteMode(settings.mode);
      setRemotePublicUrl(settings.publicUrl);
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : "Remote access settings could not be saved.");
    }
  };

  const createInvite = async (event: FormEvent) => {
    event.preventDefault();
    setUserMessage("");
    setInviteLink("");
    try {
      const days = Number(inviteDays);
      const invite = await api.createInvite({
        email: inviteEmail,
        role: inviteRole,
        expiresInDays: Number.isFinite(days) && days > 0 ? days : undefined
      });
      const baseUrl = remoteSettings?.publicUrl || window.location.origin;
      setInviteLink(`${baseUrl.replace(/\/$/, "")}/?invite=${invite.token}`);
      setInviteEmail("");
      setInviteRole("user");
      await loadInvites();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : "Invite could not be created.");
    }
  };

  const revokeInvite = async (invite: UserInvite) => {
    setUserMessage("");
    try {
      await api.revokeInvite(invite.id);
      await loadInvites();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : "Invite could not be revoked.");
    }
  };

  const createManagedUser = async (event: FormEvent) => {
    event.preventDefault();
    setUserMessage("");
    try {
      await api.createUser({ name: newUserName, email: newUserEmail, role: newUserRole });
      setNewUserName("");
      setNewUserEmail("");
      setNewUserRole("user");
      await loadAdminUsers();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : "User could not be saved.");
    }
  };

  const updateManagedUserRole = async (targetUser: User, role: "admin" | "user") => {
    setUserMessage("");
    try {
      await api.updateUserRole(targetUser.id, role);
      await loadAdminUsers();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : "Role could not be changed.");
    }
  };

  const updateManagedUserStatus = async (targetUser: User, status: "active" | "disabled") => {
    setUserMessage("");
    try {
      await api.updateUserStatus(targetUser.id, status);
      await loadAdminUsers();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : "User status could not be changed.");
    }
  };

  const updateManagedUserMetadataEditor = async (targetUser: User, enabled: boolean) => {
    setUserMessage("");
    try {
      await api.updateUser(targetUser.id, { metadataEditorEnabled: enabled });
      await loadAdminUsers();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : "Metadata access could not be changed.");
    }
  };

  const deleteManagedUser = async (targetUser: User) => {
    setUserMessage("");
    try {
      await api.deleteUser(targetUser.id);
      await loadAdminUsers();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : "User could not be removed.");
    }
  };

  const resetManagedUserPassword = async (event: FormEvent, targetUser: User) => {
    event.preventDefault();
    const password = resetPasswords[targetUser.id]?.trim() ?? "";
    if (!password) {
      setUserMessage("Enter a new password first.");
      return;
    }
    setUserMessage("");
    try {
      await api.resetUserPassword(targetUser.id, password);
      setResetPasswords((current) => ({ ...current, [targetUser.id]: "" }));
      await loadAdminUsers();
      setUserMessage(`Password updated for ${targetUser.name}.`);
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : "Password could not be updated.");
    }
  };

  if (!authChecked) {
    return <main className="login-shell">Loading Story Stack...</main>;
  }

  if (!user) {
    return <LoginScreen api={api} message={loginMessage} onMessage={setLoginMessage} onSignedIn={refresh} />;
  }

  if (user.passwordResetRequired) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-brand">
            <img className="login-logo" src={storyStackLogo} alt="" />
            <span>Story Stack</span>
          </div>
          <form className="login-form" onSubmit={changeOwnPassword}>
            <p>Choose a private password before continuing. This replaces the temporary password set by an admin.</p>
            <label>
              New Password
              <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" type="password" autoFocus />
            </label>
            {passwordMessage && <p className="login-message">{passwordMessage}</p>}
            <button className="primary command-button">Save New Password</button>
          </form>
          <button className="command-button" onClick={() => void logout()}>
            Sign Out
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={shellClassName}>
      <header className="app-topbar">
        <div className="app-brand">
          <img className="brand-logo" src={storyStackLogo} alt="" />
          <span>Story Stack</span>
        </div>
        <div className="app-title">
          <h1>{title}</h1>
        </div>
        <label className="search-box topbar-search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search books, authors, narrators" />
        </label>
        <div className="topbar-actions">
          {installActionVisible && (
            <button className="install-button" onClick={() => void installApp()} title="Install app">
              <Download size={18} />
            </button>
          )}
          {!offlineOnly && (
            <button
              className={space === "store" ? "store-button active" : "store-button"}
              onClick={() => {
                if (space === "store") {
                  setSpace("library");
                  navigateToView("home");
                  setLibraryCategoryKey(undefined);
                } else {
                  setSpace("store");
                  navigateToView("home");
                  setStoreBrowseMode("title");
                  setStoreCategoryKey(undefined);
                }
              }}
            >
              {space === "store" ? <Library size={18} /> : <Store size={18} />}
              <span>{space === "store" ? "My Library" : "Store"}</span>
            </button>
          )}
          {space === "store" && user?.role === "admin" && (
            <button className={view === "admin" ? "settings-button active" : "settings-button"} onClick={() => navigateToView("admin")}>
              <Settings size={18} />
              <span>Settings</span>
            </button>
          )}
          <div className="account-menu" ref={accountMenuRef}>
            <button
              className="account-button"
              onClick={() => {
                setAccountOpen((open) => !open);
                setUserSettingsOpen(false);
              }}
              aria-expanded={accountOpen}
              aria-label="Open account menu"
            >
              <span>{user.name}</span>
              <UserRound size={18} />
            </button>
            {accountOpen && (
              <section className="account-panel">
                <div className="account-panel-header">
                  <UserRound size={22} />
                  <div>
                    <strong>{user.name}</strong>
                    <span>{user.email ?? user.username ?? "Account"}</span>
                  </div>
                </div>
                <dl className="account-details">
                  <div>
                    <dt>Role</dt>
                    <dd>{user.role === "admin" ? "Admin" : "User"}</dd>
                  </div>
                </dl>
                <form className="account-password-form" onSubmit={changeOwnPassword}>
                  <strong>{user.passwordResetRequired ? "Choose New Password" : user.passwordConfigured ? "Change Password" : "Set Password"}</strong>
                  {user.passwordConfigured && !user.passwordResetRequired && (
                    <input
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      placeholder="Current password"
                      type="password"
                    />
                  )}
                  <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password" type="password" />
                  <button className="command-button">Save Password</button>
                  {passwordMessage && <span>{passwordMessage}</span>}
                </form>
                <button className="command-button account-signout" onClick={() => void logout()}>
                  Sign Out
              </button>
            </section>
          )}
        </div>
          {space === "library" && (
            <div className="user-settings-menu" ref={userSettingsMenuRef}>
              <button
                className="user-settings-button"
                onClick={() => {
                  setUserSettingsOpen((open) => !open);
                  setAccountOpen(false);
                }}
                aria-expanded={userSettingsOpen}
                aria-label="Open library settings"
              >
                <Settings size={18} />
              </button>
              {userSettingsOpen && (
                <section className="user-settings-panel">
                  <div className="settings-panel-title">
                    <strong>Library Settings</strong>
                    <span>{user.name}</span>
                  </div>
                  <label className="settings-row-control">
                    <span>Theme</span>
                    <select
                      value={user.theme}
                      onChange={(event) =>
                        void updateUserPreferences({ theme: event.target.value as "dark" | "light", reviewsEnabled: user.reviewsEnabled })
                      }
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </label>
                  <label className="settings-toggle-row">
                    <span>Turn on User reviews</span>
                    <input
                      checked={user.reviewsEnabled}
                      onChange={(event) => void updateUserPreferences({ theme: user.theme, reviewsEnabled: event.target.checked })}
                      type="checkbox"
                    />
                  </label>
                  {userSettingsMessage && <span className="settings-save-message">{userSettingsMessage}</span>}
                </section>
              )}
            </div>
          )}
        </div>
      </header>
      {installHelpOpen && (
        <section className="install-help-panel" aria-label="Install Story Stack">
          <button className="detail-back-button install-help-close" onClick={() => setInstallHelpOpen(false)} title="Close install help">
            <X size={18} />
          </button>
          <strong>Install Story Stack</strong>
          <p>On Android Chrome, tap Install here first. If Chrome does not open the install prompt, open the browser menu and choose Add to Home screen.</p>
          <p>If Add to Home screen is missing, refresh this page once and try again. Chrome sometimes waits until the offline app shell finishes registering.</p>
          <p>On iPhone or iPad, open Story Stack in Safari, tap Share, then choose Add to Home Screen.</p>
        </section>
      )}
      <aside className="sidebar">
        <nav>
          {offlineOnly ? (
            <button className="active" onClick={() => navigateToView("downloads")}>
              <Download size={18} />
              <span>Downloads</span>
            </button>
          ) : (
            <>
              <button className={view === "home" ? "active" : ""} onClick={() => navigateToView("home")}>
                <Home size={18} />
                <span>Home</span>
              </button>
              <button
                className={view === "library" ? "active" : ""}
                onClick={() => {
                  navigateToView("library");
                  if (space === "store") {
                    setStoreBrowseMode("title");
                    setStoreCategoryKey(undefined);
                  }
                }}
              >
                <Library size={18} />
                <span>{space === "store" ? "Books" : "Library"}</span>
              </button>
              <button
                className={view === "series" ? "active" : ""}
                onClick={() => {
                  navigateToView("series");
                  if (space === "store") {
                    setStoreBrowseMode("series");
                    setStoreCategoryKey(undefined);
                  }
                }}
              >
                <BookMarked size={18} />
                <span>Series</span>
              </button>
              <button
                className={view === "authors" ? "active" : ""}
                onClick={() => {
                  navigateToView("authors");
                  if (space === "store") {
                    setStoreBrowseMode("author");
                    setStoreCategoryKey(undefined);
                  }
                }}
              >
                <Users size={18} />
                <span>Authors</span>
              </button>
              {space === "library" && (
                <>
              <button className={view === "shelves" ? "active" : ""} onClick={() => navigateToView("shelves")}>
                <BookMarked size={18} />
                <span>Shelves</span>
              </button>
              <button className={view === "downloads" ? "active" : ""} onClick={() => navigateToView("downloads")}>
                <Download size={18} />
                <span>Downloads</span>
              </button>
                </>
              )}
            </>
          )}
        </nav>
      </aside>

      <section className="workspace">
        {selectedBook ? (
          <BookDetailPage
            book={selectedBook}
            inLibrary={libraryIds.has(selectedBook.id) || Boolean(selectedBook.inLibrary)}
            onAdd={() => void addToLibrary(selectedBook)}
            onBack={() => setSelectedBook(undefined)}
            onPlay={() => startPlayback(selectedBook, selectedBookSpace === "store" ? "sample" : "play")}
            onPlayAtChapter={(startSeconds) => startPlayback(selectedBook, selectedBookSpace === "store" ? "sample" : "play", startSeconds)}
            onRemove={() => void removeFromLibrary(selectedBook)}
            onDeleteReview={() => void deleteBookReview(selectedBook)}
            onSaveReview={(rating, review) => saveBookReview(selectedBook, rating, review)}
            reviewMessage={reviewMessage}
            canEditMetadata={canEditMetadata}
            onFindMetadata={() => findBookMetadata(selectedBook)}
            onSaveMetadata={(input) => saveBookMetadata(selectedBook, input)}
            reviewsEnabled={user.reviewsEnabled}
            reviews={selectedBookReviews}
            source={selectedBookSpace}
          />
        ) : space === "store" && view === "admin" && user?.role === "admin" ? (
          <section className="admin-panel settings-console">
            <nav className="settings-tabs" aria-label="Settings sections">
              <button className={settingsTab === "access" ? "active" : ""} onClick={() => setSettingsTab("access")}>
                Access
              </button>
              <button className={settingsTab === "catalog" ? "active" : ""} onClick={() => setSettingsTab("catalog")}>
                Catalog
              </button>
            </nav>
            {settingsTab === "access" && (
            <section className="settings-panel">
              <div className="settings-section-heading">
                <h2>Access</h2>
                <span>{adminUsers.length} users</span>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <strong>Connection Mode</strong>
                  <span>{remoteSettings?.status === "ready" ? "Ready" : remoteSettings?.status === "warning" ? "Needs attention" : "Not configured"}</span>
                </div>
                <form className="settings-inline-form remote-access-form" onSubmit={saveRemoteAccessSettings}>
                  <select value={remoteMode} onChange={(event) => setRemoteMode(event.target.value as RemoteAccessSettings["mode"])}>
                    <option value="cloudflare">Remote Access</option>
                    <option value="local">Local Network</option>
                    <option value="device">Local Device</option>
                    {remoteMode === "manual" && <option value="manual">Manual HTTPS URL</option>}
                  </select>
                  {remoteMode !== "device" && (
                    <input
                      value={remotePublicUrl}
                      onChange={(event) => setRemotePublicUrl(event.target.value)}
                      placeholder={remoteMode === "local" ? "http://server-ip:4100" : "https://story-stack.example.com"}
                    />
                  )}
                  <button className="primary command-button">Save</button>
                </form>
              </div>
              {remoteSettings && <div className={`settings-message compact ${remoteSettings.status}`}>{remoteSettings.message}</div>}
              <div className="settings-row">
                <div className="settings-row-label">
                  <strong>Invite Listener</strong>
                  <span>{adminInvites.filter((invite) => invite.status === "pending").length} pending</span>
                </div>
                <form className="settings-inline-form invite-form" onSubmit={createInvite}>
                  <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="Listener email" type="email" />
                  <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "admin" | "user")}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <input value={inviteDays} onChange={(event) => setInviteDays(event.target.value)} placeholder="Days" inputMode="numeric" />
                  <button className="primary command-button">Invite</button>
                </form>
              </div>
              {inviteLink && (
                <div className="settings-message compact">
                  Invite link ready: <span>{inviteLink}</span>
                </div>
              )}
              <div className="compact-list">
                {adminInvites.map((invite) => (
                  <article className="managed-user-row invite-row" key={invite.id}>
                    <UserRound size={17} />
                    <div>
                      <strong>{invite.email}</strong>
                      <span>
                        {invite.role} - {invite.status}
                      </span>
                    </div>
                    <span>{invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : "No expiry"}</span>
                    <button className="icon-button" onClick={() => void revokeInvite(invite)} title="Revoke invite" disabled={invite.status !== "pending"}>
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <strong>Add User</strong>
                  <span>Manual account</span>
                </div>
                <form className="settings-inline-form user-create-form" onSubmit={createManagedUser}>
                  <input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} placeholder="Name" />
                  <input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} placeholder="Email" type="email" />
                  <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as "admin" | "user")}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="primary command-button">Add</button>
                </form>
              </div>
              {userMessage && <div className="settings-message">{userMessage}</div>}
              <div className="user-management-list">
                {adminUsers.map((item) => (
                  <article className="managed-user-row" key={item.id}>
                    <UserRound size={20} />
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.email ?? item.username ?? "Account"} - Password{" "}
                        {item.passwordResetRequired ? "change required" : item.passwordConfigured ? "set" : "not set"}
                      </span>
                    </div>
                    <form className="password-reset-form" onSubmit={(event) => void resetManagedUserPassword(event, item)}>
                      <input
                        value={resetPasswords[item.id] ?? ""}
                        onChange={(event) => setResetPasswords((current) => ({ ...current, [item.id]: event.target.value }))}
                        placeholder="New password"
                        type="password"
                      />
                      <button className="command-button">{item.passwordConfigured ? "Reset" : "Set"}</button>
                    </form>
                    <select
                      className="role-select"
                      value={item.role}
                      onChange={(event) => void updateManagedUserRole(item, event.target.value as "admin" | "user")}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    <select
                      className="role-select"
                      value={item.status ?? "active"}
                      onChange={(event) => void updateManagedUserStatus(item, event.target.value as "active" | "disabled")}
                    >
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                    </select>
                    {item.role === "admin" ? (
                      <span className="user-access-note">Admin access</span>
                    ) : (
                      <label className="settings-toggle-row user-access-toggle">
                        <span>Can edit metadata</span>
                        <input
                          type="checkbox"
                          checked={item.metadataEditorEnabled}
                          onChange={(event) => void updateManagedUserMetadataEditor(item, event.target.checked)}
                        />
                      </label>
                    )}
                    <button className="icon-button" onClick={() => void deleteManagedUser(item)} title="Remove user">
                      <Trash2 size={16} />
                    </button>
                  </article>
                ))}
                {adminUsers.length === 0 && <div className="empty-state">No users have signed in yet.</div>}
              </div>
            </section>
            )}
            {settingsTab === "catalog" && (
            <section className="settings-panel">
              <div className="settings-section-heading">
                <h2>Catalog</h2>
                <span>Audiobooks and metadata</span>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <strong>Audiobook Folder</strong>
                  <span>Store source</span>
                </div>
                <form className="settings-inline-form catalog-path-form" onSubmit={saveCatalogSettings}>
                  <input
                    value={catalogPath}
                    onChange={(event) => setCatalogPath(event.target.value)}
                    placeholder="/srv/media/audiobooks"
                  />
                  <button className="primary command-button">Save</button>
                  <button className="command-button" type="button" onClick={() => void syncCatalog()}>
                    <RefreshCw size={16} />
                    Scan
                  </button>
                </form>
              </div>
              {catalogMessage && <div className="settings-message compact">{catalogMessage}</div>}
              {catalogResult && <CatalogSyncSummary result={catalogResult} />}
              <div className="settings-row">
                <div className="settings-row-label">
                  <strong>Metadata</strong>
                  <span>Google Books</span>
                </div>
                <button className="primary command-button" onClick={() => void runMetadataEnrichment()}>
                  <Sparkles size={16} />
                  Find Missing
                </button>
              </div>
              {metadataMessage && <div className="settings-message compact">{metadataMessage}</div>}
              {metadataResult && <MetadataSummary result={metadataResult} />}
            </section>
            )}
          </section>
        ) : space === "library" && view === "shelves" ? (
          <section className="shelf-workspace">
            {selectedShelf ? (
              <ShelfBookBrowser
                books={selectedShelfBooks}
                inLibraryIds={libraryIds}
                onAdd={addToLibrary}
                onBack={() => {
                  setSelectedShelf(undefined);
                  setSelectedShelfBooks([]);
                }}
                onMoveToShelf={moveToShelf}
                onRemoveFromShelf={removeFromShelf}
                onOfflineSave={saveOffline}
                onClearProgress={clearBookProgress}
                onMarkFinished={markBookFinished}
                offlineProgressFor={offlineProgressFor}
                offlineStateFor={offlineStateFor}
                playbackProgressFor={playbackProgressFor}
                onPlay={(book) => startPlayback(book, "play")}
                onRemove={removeFromLibrary}
                onSelect={(book) => selectBook(book, "library")}
                shelf={selectedShelf}
                shelves={shelves}
              />
            ) : (
              <>
                <form className="shelf-form" onSubmit={createShelf}>
                  <input value={shelfName} onChange={(event) => setShelfName(event.target.value)} placeholder="New shelf name" />
                  <button className="primary command-button">Create Shelf</button>
                </form>
                <div className="shelf-list">
                  {shelves.map((shelf) => (
                    <ShelfRow key={shelf.id} shelf={shelf} books={libraryBooks} api={api} onOpen={() => void openShelf(shelf)} />
                  ))}
                </div>
              </>
            )}
          </section>
        ) : space === "library" && view === "downloads" ? (
          <DownloadsBrowser
            books={downloadedBooks}
            onClearProgress={clearBookProgress}
            onMarkFinished={markBookFinished}
            onPlay={(book) => startPlayback(book, "play")}
            playbackProgressFor={playbackProgressFor}
            onRemove={(book) => void removeOffline(book)}
            onSelect={(book) => selectBook(book, "library")}
          />
        ) : space === "library" && view === "home" ? (
          <HomeDashboard
            books={libraryBooks}
            emptyText="Your library is empty. Open the Store to add books."
            inLibraryIds={libraryIds}
            onAdd={addToLibrary}
            onMoveToShelf={moveToShelf}
            onOfflineSave={saveOffline}
            onClearProgress={clearBookProgress}
            onMarkFinished={markBookFinished}
            offlineProgressFor={offlineProgressFor}
            offlineStateFor={offlineStateFor}
            playbackProgressFor={playbackProgressFor}
            onOpenStore={() => {
              setSpace("store");
              setView("home");
              setStoreBrowseMode("title");
              setStoreCategoryKey(undefined);
            }}
            onPlay={(book) => startPlayback(book, "play")}
            onRemove={removeFromLibrary}
            onSelect={(book) => selectBook(book, "library")}
            shelves={shelves}
            title="Library Home"
          />
        ) : space === "store" && view === "home" ? (
          <StoreDashboard
            books={storeBooks}
            inLibraryIds={libraryIds}
            onAdd={addToLibrary}
            onAddGroup={addBooksToLibrary}
            onBrowse={(mode) => {
              setStoreBrowseMode(mode);
              setStoreCategoryKey(undefined);
              setView(viewForBrowseMode(mode));
            }}
            onBrowseCategory={(mode, key) => {
              setStoreBrowseMode(mode);
              setStoreCategoryKey(key);
              setView(viewForBrowseMode(mode));
            }}
            onMoveToShelf={moveToShelf}
            onPlay={(book) => startPlayback(book, "sample")}
            onRemove={removeFromLibrary}
            onSelect={(book) => selectBook(book, "store")}
            shelves={shelves}
          />
        ) : space === "library" && (view === "library" || view === "series" || view === "authors") ? (
          <BookCollectionBrowser
            books={libraryBooks}
            browseMode={effectiveLibraryBrowseMode}
            categoryKey={libraryCategoryKey}
            emptyText="No library books match that browse view."
            inLibraryIds={libraryIds}
            query={query}
            onAdd={addToLibrary}
            onAddGroup={addBooksToLibrary}
            onCategoryChange={setLibraryCategoryKey}
            onMoveToShelf={moveToShelf}
            onOfflineSave={saveOffline}
            onClearProgress={clearBookProgress}
            onMarkFinished={markBookFinished}
            offlineProgressFor={offlineProgressFor}
            offlineStateFor={offlineStateFor}
            playbackProgressFor={playbackProgressFor}
            onPlay={(book) => startPlayback(book, "play")}
            onRemove={removeFromLibrary}
            onRemoveGroup={removeBooksFromLibrary}
            onSelect={(book) => selectBook(book, "library")}
            sortOptions={view === "library" ? libraryBookSort : undefined}
            onSortChange={view === "library" ? setLibraryBookSort : undefined}
            shelves={shelves}
            variant="library"
          />
        ) : (
          <BookCollectionBrowser
            books={storeBooks}
            browseMode={effectiveStoreBrowseMode}
            categoryKey={storeCategoryKey}
            emptyText="No Store books match that browse view."
            inLibraryIds={libraryIds}
            query={query}
            onAdd={addToLibrary}
            onAddGroup={addBooksToLibrary}
            onCategoryChange={setStoreCategoryKey}
            onMoveToShelf={moveToShelf}
            onPlay={(book) => startPlayback(book, "sample")}
            onRemove={removeFromLibrary}
            onSelect={(book) => selectBook(book, "store")}
            sortOptions={view === "library" ? storeBookSort : undefined}
            onSortChange={view === "library" ? setStoreBookSort : undefined}
            shelves={shelves}
            variant={space}
          />
        )}
      </section>

      <PlayerBar playback={playback} api={api} onProgressUpdate={updatePlaybackProgress} />
    </main>
  );
}

function BookDetailPage({
  book,
  inLibrary,
  onAdd,
  onBack,
  onPlay,
  onPlayAtChapter,
  onRemove,
  onDeleteReview,
  onSaveReview,
  reviewMessage,
  canEditMetadata,
  onFindMetadata,
  onSaveMetadata,
  reviewsEnabled,
  reviews,
  source
}: {
  book: Book;
  inLibrary: boolean;
  onAdd: () => void;
  onBack: () => void;
  onPlay: () => void;
  onPlayAtChapter: (startSeconds: number) => void;
  onRemove: () => void;
  onDeleteReview: () => void;
  onSaveReview: (rating: number, review: string) => Promise<void>;
  reviewMessage: string;
  canEditMetadata: boolean;
  onFindMetadata: () => Promise<{ matched: boolean; coversAdded: number; detailsAdded: number; book: Book }>;
  onSaveMetadata: (
    input: {
      title?: string;
      subtitle?: string;
      author?: string;
      narrator?: string;
      series?: string;
      seriesOrder?: number;
      description?: string;
      genres?: string[];
      publicationYear?: number;
    }
  ) => Promise<Book>;
  reviewsEnabled: boolean;
  reviews?: BookReviewResponse;
  source: Space;
}) {
  const [rating, setRating] = useState<number | undefined>();
  const [reviewText, setReviewText] = useState("");
  const [metadataDraft, setMetadataDraft] = useState(() => metadataDraftFromBook(book));
  const [metadataMessage, setMetadataMessage] = useState("");
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [findingMetadata, setFindingMetadata] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);

  useEffect(() => {
    setRating(undefined);
    setReviewText("");
    setMetadataDraft(metadataDraftFromBook(book));
    setMetadataMessage("");
    setEditingMetadata(false);
  }, [book.id]);

  const summary = reviews?.summary ?? { averageRating: 0, reviewCount: 0 };
  const canManageReview = source === "library" && inLibrary;
  const durationSeconds = book.durationSeconds ?? book.audioTracks?.reduce(
    (total, track) => total + (track.durationSeconds ?? 0),
    0,
  );
  const saveMetadata = async (event: FormEvent) => {
    event.preventDefault();
    setSavingMetadata(true);
    setMetadataMessage("");
    try {
      const updatedBook = await onSaveMetadata(metadataDraftToInput(metadataDraft));
      setMetadataDraft(metadataDraftFromBook(updatedBook));
      setMetadataMessage("Metadata saved.");
      setEditingMetadata(false);
    } catch (error) {
      setMetadataMessage(error instanceof Error ? error.message : "Metadata could not be saved.");
    } finally {
      setSavingMetadata(false);
    }
  };

  const findMetadata = async () => {
    setFindingMetadata(true);
    setMetadataMessage("");
    try {
      const result = await onFindMetadata();
      setMetadataDraft(metadataDraftFromBook(result.book));
      setMetadataMessage(result.matched ? "Metadata found." : "No matching metadata was found.");
      setEditingMetadata(false);
    } catch (error) {
      setMetadataMessage(error instanceof Error ? error.message : "Metadata lookup could not be completed.");
    } finally {
      setFindingMetadata(false);
    }
  };

  return (
    <section className="book-detail-page">
      <button className="detail-back-button" onClick={onBack} aria-label="Back">
        <ArrowLeft size={21} />
      </button>
      <div className="book-detail-layout">
        <div className="book-detail-cover">
          <BookCover book={book} />
        </div>
        <div className="book-detail-main">
          <div className="book-detail-heading">
            <h2>{book.title}</h2>
            {book.subtitle && <p>{book.subtitle}</p>}
          </div>
          <dl className="book-detail-meta">
            <div>
              <dt>Author</dt>
              <dd>{book.author}</dd>
            </div>
            {book.narrator && (
              <div>
                <dt>Narrator</dt>
                <dd>{book.narrator}</dd>
              </div>
            )}
            {book.series && (
              <div>
                <dt>Series</dt>
                <dd>
                  {book.series}
                  {book.seriesOrder ? ` #${book.seriesOrder}` : ""}
                </dd>
              </div>
            )}
            {book.publicationYear && (
              <div>
                <dt>Published</dt>
                <dd>{book.publicationYear}</dd>
              </div>
            )}
            {durationSeconds && durationSeconds > 0 && (
              <div>
                <dt>Length</dt>
                <dd>{formatBookDuration(durationSeconds)}</dd>
              </div>
            )}
            {book.genres.length > 0 && (
              <div>
                <dt>Genres</dt>
                <dd>{book.genres.join(", ")}</dd>
              </div>
            )}
          </dl>
          {book.chapters && book.chapters.length > 0 && (
            <section className="book-chapters-section">
              <div className="book-review-heading">
                <h3>Chapters</h3>
                <span>{book.chapters.length}</span>
              </div>
              <div className="book-chapter-list">
                {book.chapters.map((chapter, index) => (
                  <button className="book-chapter-row" key={chapter.id} onClick={() => onPlayAtChapter(chapter.startSeconds)}>
                    <span className="book-chapter-number">{index + 1}</span>
                    <span className="book-chapter-copy"><strong>{chapter.title}</strong><small>{formatTime(chapter.startSeconds)} - {formatTime(chapter.endSeconds)}</small></span>
                    <Play size={15} />
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="book-detail-actions">
            <button className="primary command-button" onClick={inLibrary ? onRemove : onAdd}>
              {inLibrary ? "Remove from Library" : "Add to Library"}
            </button>
            <button className="command-button" onClick={onPlay}>
              {source === "store" ? "Sample" : "Play"}
            </button>
          </div>
          {canEditMetadata && (
            <section className="book-metadata-tools">
              <div className="book-metadata-actions">
                <button
                  className="command-button"
                  type="button"
                  onClick={() => {
                    setEditingMetadata((current) => !current);
                    setMetadataMessage("");
                    setMetadataDraft(metadataDraftFromBook(book));
                  }}
                >
                  <PencilLine size={16} />
                  {editingMetadata ? "Cancel Edit" : "Edit Metadata"}
                </button>
                <button className="command-button" type="button" onClick={() => void findMetadata()} disabled={findingMetadata}>
                  <Sparkles size={16} />
                  Find Metadata
                </button>
              </div>
              {metadataMessage && <p className="book-metadata-message">{metadataMessage}</p>}
              {editingMetadata && (
                <section className="book-metadata-panel">
                  <div className="settings-section-heading compact">
                    <h3>Edit Metadata</h3>
                  </div>
                  <form className="book-metadata-form" onSubmit={saveMetadata}>
                    <div className="book-metadata-grid">
                      <label>
                        <span>Title</span>
                        <input
                          value={metadataDraft.title}
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, title: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Subtitle</span>
                        <input
                          value={metadataDraft.subtitle}
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, subtitle: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Author</span>
                        <input
                          value={metadataDraft.author}
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, author: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Narrator</span>
                        <input
                          value={metadataDraft.narrator}
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, narrator: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Series</span>
                        <input
                          value={metadataDraft.series}
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, series: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Series Order</span>
                        <input
                          value={metadataDraft.seriesOrder}
                          inputMode="decimal"
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, seriesOrder: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Published</span>
                        <input
                          value={metadataDraft.publicationYear}
                          inputMode="numeric"
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, publicationYear: event.target.value }))}
                        />
                      </label>
                      <label className="book-metadata-wide">
                        <span>Genres</span>
                        <input
                          value={metadataDraft.genres}
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, genres: event.target.value }))}
                          placeholder="Fantasy, Adventure"
                        />
                      </label>
                      <label className="book-metadata-wide">
                        <span>Description</span>
                        <textarea
                          value={metadataDraft.description}
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, description: event.target.value }))}
                          rows={4}
                        />
                      </label>
                    </div>
                    <div className="book-metadata-actions">
                      <button className="primary command-button" disabled={savingMetadata}>
                        Save Metadata
                      </button>
                      <button
                        className="command-button"
                        type="button"
                        disabled={savingMetadata}
                        onClick={() => {
                          setEditingMetadata(false);
                          setMetadataMessage("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </section>
          )}
          <section className="book-detail-description">
            <h3>Description</h3>
            <p>{book.description ?? "No description imported yet."}</p>
          </section>
          {reviewsEnabled && (
          <section className="book-review-section">
            <div className="book-review-heading">
              <h3>Reviews</h3>
              <span>
                {summary.reviewCount > 0 ? `${summary.averageRating.toFixed(1)} / 5 from ${summary.reviewCount} review${summary.reviewCount === 1 ? "" : "s"}` : "No reviews yet"}
              </span>
            </div>
            {canManageReview && (
              <form
                className="review-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!rating) return;
                  await onSaveReview(rating, reviewText);
                  setRating(undefined);
                  setReviewText("");
                }}
              >
                <StarRatingInput value={rating} onChange={setRating} />
                <textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder="Share what you thought about this book" rows={4} />
                <div className="review-form-actions">
                  <button className="primary command-button" disabled={!rating}>
                    {reviews?.myReview ? "Update Review" : "Save Review"}
                  </button>
                  {reviews?.myReview && (
                    <button className="command-button danger" onClick={onDeleteReview} type="button">
                      Remove Review
                    </button>
                  )}
                </div>
                {reviewMessage && <span>{reviewMessage}</span>}
              </form>
            )}
            <div className="review-list">
              {reviews?.reviews.map((review) => (
                <article className="review-card" key={review.id}>
                  <div className="review-card-header">
                    <strong>{review.userName}</strong>
                    <span>{review.isMine ? "Your review" : new Date(review.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <StarRatingDisplay rating={review.rating} />
                  {review.review && <p>{review.review}</p>}
                </article>
              ))}
              {reviews && reviews.reviews.length === 0 && <p className="review-empty">Be the first to rate this book.</p>}
            </div>
          </section>
          )}
        </div>
      </div>
    </section>
  );
}

type BookMetadataDraft = {
  title: string;
  subtitle: string;
  author: string;
  narrator: string;
  series: string;
  seriesOrder: string;
  description: string;
  genres: string;
  publicationYear: string;
};

function metadataDraftFromBook(book: Book): BookMetadataDraft {
  return {
    title: book.title,
    subtitle: book.subtitle ?? "",
    author: book.author,
    narrator: book.narrator ?? "",
    series: book.series ?? "",
    seriesOrder: book.seriesOrder?.toString() ?? "",
    description: book.description ?? "",
    genres: book.genres.join(", "),
    publicationYear: book.publicationYear?.toString() ?? ""
  };
}

function metadataDraftToInput(draft: BookMetadataDraft) {
  return {
    title: draft.title.trim() || undefined,
    subtitle: draft.subtitle.trim() || undefined,
    author: draft.author.trim() || undefined,
    narrator: draft.narrator.trim() || undefined,
    series: draft.series.trim() || undefined,
    seriesOrder: parseOptionalNumber(draft.seriesOrder),
    description: draft.description.trim() || undefined,
    genres: draft.genres
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    publicationYear: parseOptionalInteger(draft.publicationYear)
  };
}

function parseOptionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function StarRatingInput({ value, onChange }: { value?: number; onChange: (rating: number) => void }) {
  return (
    <div className="star-rating-input" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          className={value && star <= value ? "active" : ""}
          key={star}
          onClick={() => onChange(star)}
          type="button"
        >
          ★
        </button>
      ))}
    </div>
  );
}

function StarRatingDisplay({ rating }: { rating: number }) {
  return (
    <div className="star-rating-display" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span className={star <= rating ? "active" : ""} key={star}>
          ★
        </span>
      ))}
    </div>
  );
}

function MetadataSummary({ result }: { result: MetadataEnrichmentResult }) {
  const finishedAt = new Date(result.finishedAt);
  return (
    <section className="metadata-summary">
      <div className="settings-section-heading">
        <h2>Metadata Complete</h2>
        <span>{Number.isNaN(finishedAt.getTime()) ? "Just now" : finishedAt.toLocaleString()}</span>
      </div>
      <div className="sync-summary-grid">
        <span>
          <strong>{result.scanned}</strong>
          Checked
        </span>
        <span>
          <strong>{result.matched}</strong>
          Matched
        </span>
        <span>
          <strong>{result.coversAdded}</strong>
          Covers
        </span>
        <span>
          <strong>{result.detailsAdded}</strong>
          Details
        </span>
      </div>
      {result.errors.length > 0 && <p>{result.errors.slice(0, 3).join(" ")}</p>}
    </section>
  );
}

function CatalogSyncSummary({ result }: { result: SyncResult }) {
  const finishedAt = new Date(result.finishedAt);
  return (
    <section className="metadata-summary">
      <div className="settings-section-heading">
        <h2>Scan Complete</h2>
        <span>{Number.isNaN(finishedAt.getTime()) ? "Just now" : finishedAt.toLocaleString()}</span>
      </div>
      <div className="sync-summary-grid">
        <span>
          <strong>{result.scanned}</strong>
          Scanned
        </span>
        <span>
          <strong>{result.imported}</strong>
          New
        </span>
        <span>
          <strong>{result.updated}</strong>
          Updated
        </span>
        <span>
          <strong>{result.removed}</strong>
          Removed
        </span>
      </div>
      {result.path && <p>Scanned {result.path}</p>}
      {result.errors.length > 0 && <p>{result.errors.slice(0, 3).join(" ")}</p>}
    </section>
  );
}

function LoginScreen({
  api,
  message,
  onMessage,
  onSignedIn
}: {
  api: ApiClient;
  message: string;
  onMessage: (message: string) => void;
  onSignedIn: () => Promise<void>;
}) {
  const [invite, setInvite] = useState<Pick<UserInvite, "email" | "role" | "expiresAt">>();
  const [inviteToken, setInviteToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite") ?? "";
    if (!token) {
      return;
    }
    setInviteToken(token);
    void api
      .invite(token)
      .then((nextInvite) => {
        setInvite(nextInvite);
        setUsername(nextInvite.email);
      })
      .catch((error) => onMessage(error instanceof Error ? error.message : "Invite could not be loaded."));
  }, [api, onMessage]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    onMessage("");
    try {
      await api.login(username, password);
      await onSignedIn();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const acceptInvite = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    onMessage("");
    try {
      await api.acceptInvite(inviteToken, { name: inviteName, password: invitePassword });
      window.history.replaceState({}, "", window.location.pathname);
      await onSignedIn();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Invite could not be accepted.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand">
          <img className="login-logo" src={storyStackLogo} alt="" />
          <span>Story Stack</span>
        </div>
        {invite ? (
          <form className="login-form" onSubmit={acceptInvite}>
            <p>Accept your invite for {invite.email}.</p>
            <label>
              Name
              <input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Your name" autoFocus />
            </label>
            <label>
              Password
              <input value={invitePassword} onChange={(event) => setInvitePassword(event.target.value)} placeholder="At least 8 characters" type="password" />
            </label>
            {message && <p className="login-message">{message}</p>}
            <button className="primary command-button" disabled={submitting}>
              {submitting ? "Creating Account..." : "Create Account"}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={signIn}>
            <label>
              Email
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="you@example.com" type="email" autoComplete="email" autoFocus />
            </label>
            <label>
              Password
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
            </label>
            {message && <p className="login-message">{message}</p>}
            <button className="primary command-button" disabled={submitting}>
              {submitting ? "Signing In..." : "Sign In"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function HomeDashboard({
  books,
  emptyText,
  inLibraryIds,
  onAdd,
  onClearProgress,
  onMarkFinished,
  onMoveToShelf,
  onOfflineSave,
  offlineProgressFor,
  offlineStateFor,
  onOpenStore,
  onPlay,
  onRemove,
  onSelect,
  playbackProgressFor,
  shelves,
  title,
  variant = "library"
}: {
  books: Book[];
  emptyText: string;
  inLibraryIds: Set<string>;
  onAdd: (book: Book) => Promise<void>;
  onClearProgress: (book: Book) => Promise<void>;
  onMarkFinished: (book: Book) => Promise<void>;
  onMoveToShelf: (book: Book, shelf: Shelf) => Promise<void>;
  onOfflineSave: (book: Book) => Promise<void>;
  offlineProgressFor: (book: Book) => number | undefined;
  offlineStateFor: (book: Book) => OfflineState;
  onOpenStore: () => void;
  onPlay: (book: Book) => void;
  onRemove: (book: Book) => Promise<void>;
  onSelect: (book: Book) => void;
  playbackProgressFor: (book: Book) => number | undefined;
  shelves: Shelf[];
  title: string;
  variant?: "library" | "store";
}) {
  const sections = useMemo(() => buildDashboardSections(books), [books]);

  if (books.length === 0) {
    return (
      <section className="empty-dashboard">
        <h2>{title}</h2>
        <p>{emptyText}</p>
        <button className="primary command-button" onClick={onOpenStore}>
          <Store size={17} />
          Open Store
        </button>
      </section>
    );
  }

  return (
    <section className="home-dashboard">
      {sections.map((section) => (
        <DashboardRow
          key={section.title}
          books={section.books}
          inLibraryIds={inLibraryIds}
          onAdd={onAdd}
          onClearProgress={onClearProgress}
          onMarkFinished={onMarkFinished}
          onMoveToShelf={onMoveToShelf}
          onOfflineSave={onOfflineSave}
          offlineProgressFor={offlineProgressFor}
          offlineStateFor={offlineStateFor}
          onPlay={onPlay}
          onRemove={onRemove}
          onSelect={onSelect}
          playbackProgressFor={playbackProgressFor}
          shelves={shelves}
          title={section.title}
        />
      ))}
    </section>
  );
}

function StoreDashboard({
  books,
  inLibraryIds,
  onAdd,
  onAddGroup,
  onBrowse,
  onBrowseCategory,
  onMoveToShelf,
  onPlay,
  onRemove,
  onSelect,
  shelves
}: {
  books: Book[];
  inLibraryIds: Set<string>;
  onAdd: (book: Book) => Promise<void>;
  onAddGroup: (books: Book[]) => Promise<void>;
  onBrowse: (mode: BookBrowseMode) => void;
  onBrowseCategory: (mode: BookBrowseMode, key: string) => void;
  onMoveToShelf: (book: Book, shelf: Shelf) => Promise<void>;
  onPlay: (book: Book) => void;
  onRemove: (book: Book) => Promise<void>;
  onSelect: (book: Book) => void;
  shelves: Shelf[];
}) {
  const sections = useMemo(() => buildDashboardSections(books), [books]);
  const storeStats = useMemo(() => {
    const browser = new BookBrowser(books);
    return {
      authors: browser.browse("author").length,
      series: browser.browse("series").length
    };
  }, [books]);
  const featuredBook = useMemo(() => randomBook(books), [books]);
  const categoryRows = useMemo(
    () =>
      [
        { title: "Series", mode: "series" as const },
        { title: "Authors", mode: "author" as const }
      ].map((row) => ({ ...row, groups: new BookBrowser(books).browse(row.mode).slice(0, 8) })),
    [books]
  );

  return (
    <section className="home-dashboard">
      <section className="store-hero-shell">
        <section className="store-hero">
          <div className="store-hero-main">
            <div className="store-hero-copy">
              <h2>Find your next listen</h2>
            </div>
            {featuredBook && (
              <article className="featured-book">
                <button className="featured-cover-button" onClick={() => onSelect(featuredBook)} aria-label={`Open ${featuredBook.title}`}>
                  <BookCover book={featuredBook} />
                </button>
                <div className="featured-book-copy">
                  <span>Featured Listen</span>
                  <button onClick={() => onSelect(featuredBook)}>{featuredBook.title}</button>
                  <p>{featuredBook.author}</p>
                  <div className="featured-book-meta">
                    {featuredBook.series && (
                      <span>
                        {featuredBook.series}
                        {featuredBook.seriesOrder ? ` #${featuredBook.seriesOrder}` : ""}
                      </span>
                    )}
                    {featuredBook.publicationYear && <span>{featuredBook.publicationYear}</span>}
                  </div>
                  {featuredBook.description && <p className="featured-book-description">{cleanDescription(featuredBook.description)}</p>}
                  <div className="featured-book-actions">
                    {!inLibraryIds.has(featuredBook.id) && !featuredBook.inLibrary && (
                      <button className="primary command-button" onClick={() => void onAdd(featuredBook)}>
                        <Plus size={16} />
                        Add
                      </button>
                    )}
                    <button className="command-button" onClick={() => onPlay(featuredBook)}>
                      Sample
                    </button>
                  </div>
                </div>
              </article>
            )}
          </div>
        </section>
        <div className="store-stat-grid" aria-label="Store collection summary">
          <span>
            <strong>{books.length}</strong>
            Books
          </span>
          <span>
            <strong>{storeStats.authors}</strong>
            Authors
          </span>
          <span>
            <strong>{storeStats.series}</strong>
            Series
          </span>
        </div>
      </section>
      {sections.slice(0, 2).map((section) => (
        <DashboardRow
          key={section.title}
          books={section.books}
          inLibraryIds={inLibraryIds}
          onAdd={onAdd}
          onMoveToShelf={onMoveToShelf}
          onPlay={onPlay}
          onRemove={onRemove}
          onSelect={onSelect}
          shelves={shelves}
          title={section.title === "Recently Added" ? "New in Store" : section.title}
          variant="store"
        />
      ))}
      {categoryRows.map((row) => (
        <section className="dashboard-section" key={row.title}>
          <div className="section-heading">
            <h2>{row.title}</h2>
            <button onClick={() => onBrowse(row.mode)}>View all</button>
          </div>
          <div className="category-strip">
            {row.groups.map((group) => (
              <CategoryCard
                compact
                group={group}
                inLibraryIds={inLibraryIds}
                key={group.key}
                onAdd={() => onAddGroup(group.books)}
                onOpen={() => onBrowseCategory(row.mode, group.key)}
              />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function randomBook(books: Book[]): Book | undefined {
  if (books.length === 0) {
    return undefined;
  }
  return books[Math.floor(Math.random() * books.length)];
}

function cleanDescription(description: string): string {
  return description.replace(/&#8212;/g, "-").replace(/<[^>]+>/g, "").trim();
}

function DashboardRow({
  books,
  inLibraryIds,
  onAdd,
  onClearProgress,
  onMarkFinished,
  onMoveToShelf,
  onOfflineSave,
  offlineProgressFor,
  offlineStateFor,
  onPlay,
  onRemove,
  onSelect,
  playbackProgressFor,
  shelves,
  title,
  variant = "library"
}: {
  books: Book[];
  inLibraryIds: Set<string>;
  onAdd: (book: Book) => Promise<void>;
  onClearProgress?: (book: Book) => Promise<void>;
  onMarkFinished?: (book: Book) => Promise<void>;
  onMoveToShelf: (book: Book, shelf: Shelf) => Promise<void>;
  onOfflineSave?: (book: Book) => Promise<void>;
  offlineProgressFor?: (book: Book) => number | undefined;
  offlineStateFor?: (book: Book) => OfflineState;
  onPlay: (book: Book) => void;
  onRemove: (book: Book) => Promise<void>;
  onSelect: (book: Book) => void;
  playbackProgressFor?: (book: Book) => number | undefined;
  shelves: Shelf[];
  title: string;
  variant?: "library" | "store";
}) {
  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <h2>{title}</h2>
      </div>
      <div className="book-strip">
        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            inLibrary={inLibraryIds.has(book.id) || Boolean(book.inLibrary)}
            onAdd={() => void onAdd(book)}
            onClearProgress={variant === "library" && onClearProgress ? () => void onClearProgress(book) : undefined}
            onMarkFinished={variant === "library" && onMarkFinished ? () => void onMarkFinished(book) : undefined}
            onMoveToShelf={(shelf) => void onMoveToShelf(book, shelf)}
            onOfflineSave={variant === "library" && onOfflineSave ? () => void onOfflineSave(book) : undefined}
            offlineProgress={offlineProgressFor?.(book)}
            offlineState={offlineStateFor?.(book) ?? "idle"}
            onRemove={() => void onRemove(book)}
            onPlay={() => onPlay(book)}
            onSelect={() => onSelect(book)}
            playbackProgressPercent={playbackProgressFor?.(book)}
            shelves={shelves}
            variant={variant}
          />
        ))}
      </div>
    </section>
  );
}

function buildDashboardSections(books: Book[]) {
  const recentlyAdded = [...books].sort((left, right) => right.addedAt.localeCompare(left.addedAt)).slice(0, 10);
  const seriesBooks = uniqueBy(
    books.filter((book) => book.series),
    (book) => book.series ?? book.id
  ).slice(0, 10);
  const authorBooks = uniqueBy(books, (book) => book.author).slice(0, 10);

  return [
    { title: "Recently Added", books: recentlyAdded },
    { title: "Recent Series", books: seriesBooks },
    { title: "Authors", books: authorBooks }
  ].filter((section) => section.books.length > 0);
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function BookCollectionBrowser({
  books,
  browseMode,
  categoryKey,
  emptyText,
  inLibraryIds,
  query,
  onAdd,
  onAddGroup,
  onCategoryChange,
  onClearProgress,
  onMarkFinished,
  onMoveToShelf,
  onOfflineSave,
  offlineProgressFor,
  offlineStateFor,
  onPlay,
  onRemove,
  onRemoveGroup,
  onSelect,
  playbackProgressFor,
  sortOptions,
  onSortChange,
  shelves,
  variant
}: {
  books: Book[];
  browseMode: BookBrowseMode;
  categoryKey?: string;
  emptyText: string;
  inLibraryIds: Set<string>;
  query: string;
  onAdd: (book: Book) => Promise<void>;
  onAddGroup?: (books: Book[]) => Promise<void>;
  onCategoryChange: (key?: string) => void;
  onClearProgress?: (book: Book) => Promise<void>;
  onMarkFinished?: (book: Book) => Promise<void>;
  onMoveToShelf: (book: Book, shelf: Shelf) => Promise<void>;
  onOfflineSave?: (book: Book) => Promise<void>;
  offlineProgressFor?: (book: Book) => number | undefined;
  offlineStateFor?: (book: Book) => OfflineState;
  onPlay: (book: Book) => void;
  onRemove: (book: Book) => Promise<void>;
  onRemoveGroup?: (books: Book[]) => Promise<void>;
  onSelect: (book: Book) => void;
  playbackProgressFor?: (book: Book) => number | undefined;
  sortOptions?: BookSortOptions;
  onSortChange?: (options: BookSortOptions) => void;
  shelves: Shelf[];
  variant: "library" | "store";
}) {
  const groups = useMemo(
    () => new BookBrowser(books).browse(browseMode, query),
    [books, browseMode, query]
  );
  const selectedGroup = groups.find((group) => group.key === categoryKey);
  const titleBooks = useMemo(() => groups.flatMap((group) => group.books), [groups]);
  const baseDisplayedBooks = selectedGroup?.books ?? titleBooks;
  const displayedBooks = useMemo(
    () => (sortOptions ? sortBooksForDisplay(baseDisplayedBooks, sortOptions) : baseDisplayedBooks),
    [baseDisplayedBooks, sortOptions]
  );
  const missingGroupBookCount = selectedGroup ? new LibraryAddPlanner(inLibraryIds).missingCount(selectedGroup.books) : 0;
  const removableGroupBookCount = selectedGroup ? new LibraryRemovePlanner().removableCount(selectedGroup.books) : 0;
  const showCategories = browseMode !== "title" && !selectedGroup;
  const canAddSelectedGroup = variant === "store" && selectedGroup && (browseMode === "series" || browseMode === "author");
  const canRemoveSelectedGroup = variant === "library" && selectedGroup && (browseMode === "series" || browseMode === "author");
  const canAddCategoryGroup = variant === "store" && (browseMode === "series" || browseMode === "author");

  return (
    <section className="book-browser">
      {showCategories ? (
        <section className="category-grid">
          {groups.map((group) => (
            <CategoryCard
              group={group}
              inLibraryIds={inLibraryIds}
              key={group.key}
              onAdd={canAddCategoryGroup ? () => onAddGroup?.(group.books) : undefined}
              onOpen={() => onCategoryChange(group.key)}
            />
          ))}
        </section>
      ) : (
        <section className="book-group">
          {sortOptions && onSortChange && (
            <BookSortToolbar options={sortOptions} onChange={onSortChange} />
          )}
          {selectedGroup && (
            <div className="group-heading">
              <button
                className="group-back-button"
                onClick={() => onCategoryChange(undefined)}
                title={`All ${labelForMode(browseMode)}`}
              >
                <ArrowLeft size={18} />
              </button>
              <div className="group-title">
                <h2>{selectedGroup.label}</h2>
                <span>({selectedGroup.books.length})</span>
              </div>
              {canAddSelectedGroup && (
                <GroupAddButton
                  missingCount={missingGroupBookCount}
                  onAdd={() => onAddGroup?.(selectedGroup.books)}
                  targetLabel={selectedGroup.label}
                />
              )}
              {canRemoveSelectedGroup && (
                <GroupRemoveButton
                  count={removableGroupBookCount}
                  groupType={browseMode === "series" ? "series" : "author"}
                  onRemove={() => onRemoveGroup?.(selectedGroup.books)}
                  targetLabel={selectedGroup.label}
                />
              )}
            </div>
          )}
          <div className="book-grid">
            {displayedBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                inLibrary={inLibraryIds.has(book.id) || Boolean(book.inLibrary)}
                onAdd={() => void onAdd(book)}
                onClearProgress={variant === "library" && onClearProgress ? () => void onClearProgress(book) : undefined}
                onMarkFinished={variant === "library" && onMarkFinished ? () => void onMarkFinished(book) : undefined}
                onMoveToShelf={(shelf) => void onMoveToShelf(book, shelf)}
                onOfflineSave={variant === "library" && onOfflineSave ? () => void onOfflineSave(book) : undefined}
                offlineProgress={offlineProgressFor?.(book)}
                offlineState={offlineStateFor?.(book) ?? "idle"}
                onRemove={() => void onRemove(book)}
                onPlay={() => onPlay(book)}
                onSelect={() => onSelect(book)}
                playbackProgressPercent={playbackProgressFor?.(book)}
                shelves={shelves}
                variant={variant}
              />
            ))}
          </div>
        </section>
      )}

      {groups.length === 0 && <div className="empty-state">{emptyText}</div>}
    </section>
  );
}

function BookSortToolbar({ options, onChange }: { options: BookSortOptions; onChange: (options: BookSortOptions) => void }) {
  const flippedDirection = options.direction === "asc" ? "desc" : "asc";
  return (
    <div className="book-sort-toolbar" aria-label="Book sorting options">
      <label>
        <span>Sort by</span>
        <select value={options.key} onChange={(event) => onChange({ ...options, key: event.target.value as BookSortOptions["key"] })}>
          <option value="title">Title</option>
          <option value="author">Author</option>
          <option value="addedAt">Recently Added</option>
          <option value="publicationYear">Published Year</option>
          <option value="rating">Rating</option>
        </select>
      </label>
      <button className="sort-direction-button" onClick={() => onChange({ ...options, direction: flippedDirection })} title="Swap sort order">
        {options.direction === "asc" ? <ArrowDownAZ size={18} /> : <ArrowUpAZ size={18} />}
        <span>{options.direction === "asc" ? "Ascending" : "Descending"}</span>
      </button>
    </div>
  );
}

function CategoryCard({
  compact = false,
  group,
  inLibraryIds,
  onAdd,
  onOpen
}: {
  compact?: boolean;
  group: { label: string; books: Book[] };
  inLibraryIds: Set<string>;
  onAdd?: () => Promise<void> | void;
  onOpen: () => void;
}) {
  const missingCount = new LibraryAddPlanner(inLibraryIds).missingCount(group.books);
  const [adding, setAdding] = useState(false);
  const disabled = adding || missingCount === 0;

  const add = async () => {
    if (disabled || !onAdd) {
      return;
    }
    setAdding(true);
    try {
      await onAdd();
    } finally {
      setAdding(false);
    }
  };

  return (
    <article className={compact ? "category-card compact" : "category-card"}>
      <button className="category-open-button" onClick={onOpen}>
        <CoverStack books={group.books} />
        <strong>{group.label}</strong>
        <span>{group.books.length} books</span>
      </button>
      {onAdd && (
        <button
          className="category-add-button"
          disabled={disabled}
          onClick={() => void add()}
          title={missingCount === 0 ? "Already in My Library" : `Add ${group.label} to My Library`}
        >
          <Plus size={16} />
        </button>
      )}
    </article>
  );
}

function GroupAddButton({
  missingCount,
  onAdd,
  targetLabel
}: {
  missingCount: number;
  onAdd: () => Promise<void> | void;
  targetLabel: string;
}) {
  const [adding, setAdding] = useState(false);
  const disabled = adding || missingCount === 0;

  const add = async () => {
    if (disabled) {
      return;
    }
    setAdding(true);
    try {
      await onAdd();
    } finally {
      setAdding(false);
    }
  };

  return (
    <button className="group-add-button" disabled={disabled} onClick={() => void add()} title={`Add ${targetLabel} to My Library`}>
      <Plus size={16} />
      <span>{missingCount === 0 ? "In Library" : adding ? "Adding..." : `Add ${missingCount}`}</span>
    </button>
  );
}

function GroupRemoveButton({
  count,
  groupType,
  onRemove,
  targetLabel
}: {
  count: number;
  groupType: "series" | "author";
  onRemove: () => Promise<void> | void;
  targetLabel: string;
}) {
  const [removing, setRemoving] = useState(false);
  const disabled = removing || count === 0;

  const remove = async () => {
    if (disabled) {
      return;
    }
    const confirmed = window.confirm(`Remove all ${count} books in ${targetLabel} from your library?`);
    if (!confirmed) {
      return;
    }
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <button className="group-action-button danger" disabled={disabled} onClick={() => void remove()} title={`Remove this ${groupType} from My Library`}>
      <Trash2 size={16} />
      <span>{removing ? "Removing..." : `Remove ${count}`}</span>
    </button>
  );
}

function CoverStack({ books }: { books: Book[] }) {
  const covers = books.slice(0, 4);
  return (
    <div className="cover-stack" aria-hidden="true">
      {covers.map((book) => (
        <BookCover book={book} compact key={book.id} />
      ))}
      {covers.length === 0 && <div className="book-cover empty-cover compact-empty-cover" />}
    </div>
  );
}

function labelForMode(mode: BookBrowseMode): string {
  return {
    title: "Books",
    series: "Series",
    author: "Authors"
  }[mode];
}

function browseModeForView(view: View, fallback: BookBrowseMode): BookBrowseMode {
  if (view === "series") {
    return "series";
  }
  if (view === "authors") {
    return "author";
  }
  return fallback;
}

function viewForBrowseMode(mode: BookBrowseMode): View {
  if (mode === "series") {
    return "series";
  }
  if (mode === "author") {
    return "authors";
  }
  return "library";
}

function DownloadsBrowser({
  books,
  onClearProgress,
  onMarkFinished,
  onPlay,
  onRemove,
  onSelect,
  playbackProgressFor
}: {
  books: Book[];
  onClearProgress: (book: Book) => Promise<void>;
  onMarkFinished: (book: Book) => Promise<void>;
  onPlay: (book: Book) => void;
  onRemove: (book: Book) => void;
  onSelect: (book: Book) => void;
  playbackProgressFor?: (book: Book) => number | undefined;
}) {
  if (books.length === 0) {
    return <div className="empty-state">No books have been saved to this device yet.</div>;
  }

  return (
    <section className="book-group">
      <div className="book-grid">
        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            inLibrary
            onAdd={() => undefined}
            onClearProgress={() => void onClearProgress(book)}
            onMarkFinished={() => void onMarkFinished(book)}
            onOfflineRemove={() => onRemove(book)}
            onPlay={() => onPlay(book)}
            onSelect={() => onSelect(book)}
            playbackProgressPercent={playbackProgressFor?.(book)}
            variant="library"
          />
        ))}
      </div>
    </section>
  );
}

function ShelfBookBrowser({
  books,
  inLibraryIds,
  onAdd,
  onBack,
  onClearProgress,
  onMarkFinished,
  onMoveToShelf,
  onRemoveFromShelf,
  onOfflineSave,
  offlineProgressFor,
  offlineStateFor,
  onPlay,
  onRemove,
  onSelect,
  playbackProgressFor,
  shelf,
  shelves
}: {
  books: Book[];
  inLibraryIds: Set<string>;
  onAdd: (book: Book) => Promise<void>;
  onBack: () => void;
  onClearProgress: (book: Book) => Promise<void>;
  onMarkFinished: (book: Book) => Promise<void>;
  onMoveToShelf: (book: Book, shelf: Shelf) => Promise<void>;
  onRemoveFromShelf: (book: Book, shelf: Shelf) => Promise<void>;
  onOfflineSave: (book: Book) => Promise<void>;
  offlineProgressFor: (book: Book) => number | undefined;
  offlineStateFor: (book: Book) => OfflineState;
  onPlay: (book: Book) => void;
  onRemove: (book: Book) => Promise<void>;
  onSelect: (book: Book) => void;
  playbackProgressFor: (book: Book) => number | undefined;
  shelf: Shelf;
  shelves: Shelf[];
}) {
  return (
    <section className="book-group">
      <div className="group-heading">
        <button className="back-button" onClick={onBack}>
          All Shelves
        </button>
        <div>
          <h2>{shelf.name}</h2>
          <span>{books.length} books</span>
        </div>
      </div>
      {books.length > 0 ? (
        <div className="book-grid">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              inLibrary={inLibraryIds.has(book.id) || Boolean(book.inLibrary)}
              onAdd={() => void onAdd(book)}
              onClearProgress={() => void onClearProgress(book)}
              onMarkFinished={() => void onMarkFinished(book)}
              onMoveToShelf={(targetShelf) => void onMoveToShelf(book, targetShelf)}
              onRemoveFromShelf={() => void onRemoveFromShelf(book, shelf)}
              onOfflineSave={() => void onOfflineSave(book)}
              offlineProgress={offlineProgressFor(book)}
              offlineState={offlineStateFor(book)}
              onRemove={() => void onRemove(book)}
              onPlay={() => onPlay(book)}
              onSelect={() => onSelect(book)}
              playbackProgressPercent={playbackProgressFor(book)}
              shelves={shelves}
              variant="library"
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">This shelf is empty.</div>
      )}
    </section>
  );
}

function ShelfRow({ shelf, books, api, onOpen }: { shelf: Shelf; books: Book[]; api: ApiClient; onOpen: () => void }) {
  const [bookId, setBookId] = useState("");
  const [count, setCount] = useState(0);

  useEffect(() => {
    void api.shelfBooks(shelf.id).then((items) => setCount(items.length));
  }, [api, shelf.id]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!bookId) {
      return;
    }
    await api.addBookToShelf(shelf.id, bookId);
    setBookId("");
    setCount((value) => value + 1);
  };

  return (
    <article className="shelf-row">
      <button className="shelf-open-button" onClick={onOpen}>
        <strong>{shelf.name}</strong>
        <span>{count} books</span>
      </button>
      <form onSubmit={add}>
        <select value={bookId} onChange={(event) => setBookId(event.target.value)}>
          <option value="">Add a library book</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>
        <button className="command-button">Add</button>
      </form>
    </article>
  );
}

function viewTitle(space: Space, view: View, storeCount: number, libraryCount: number): string {
  if (space === "store") {
    return {
      home: `Store ${storeCount}`,
      library: "Store Books",
      series: "Store Series",
      authors: "Store Authors",
      shelves: "Store",
      downloads: "Store",
      admin: "Collection Settings"
    }[view];
  }

  return {
    home: `Home ${libraryCount}`,
    library: "Library",
    series: "Series",
    authors: "Authors",
    shelves: "Shelves",
    downloads: "Downloads",
    admin: "Admin"
  }[view];
}

function matchesBookQuery(book: Book, query: string): boolean {
  const value = query.trim().toLowerCase();
  if (!value) {
    return true;
  }
  return [book.title, book.author, book.narrator, book.series, ...book.genres].some((field) => field?.toLowerCase().includes(value));
}

function indexProgressByBookId(progress: PlaybackProgress[]): Record<string, PlaybackProgress> {
  return Object.fromEntries(progress.map((entry) => [entry.bookId, entry]));
}

function progressPercentForBook(book: Book, progress?: PlaybackProgress): number | undefined {
  if (!progress || progress.positionSeconds <= 0) {
    return undefined;
  }
  const duration = progress.durationSeconds ?? book.durationSeconds;
  if (!duration || duration <= 0) {
    return undefined;
  }
  if (progress.status === "finished") {
    return 100;
  }
  return Math.max(1, Math.min(99, (progress.positionSeconds / duration) * 100));
}

function listeningStatusFor(positionSeconds: number, durationSeconds?: number): PlaybackProgress["status"] {
  if (durationSeconds && durationSeconds > 0 && positionSeconds >= durationSeconds * 0.95) {
    return "finished";
  }
  return positionSeconds > 0 ? "in_progress" : "not_started";
}

function formatBookDuration(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  return `${minutes} min`;
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function readLastUser(): User | undefined {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_USER_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const user = parsed as Partial<User>;
    if (typeof user.id !== "string" || typeof user.name !== "string" || (user.role !== "admin" && user.role !== "user")) {
      return undefined;
    }
    return {
      ...user,
      theme: user.theme === "light" ? "light" : "dark",
      reviewsEnabled: user.reviewsEnabled !== false
    } as User;
  } catch {
    return undefined;
  }
}

function scrollToPageTop(): void {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0 });
    document.querySelector(".workspace")?.scrollTo({ top: 0, left: 0 });
  });
}
