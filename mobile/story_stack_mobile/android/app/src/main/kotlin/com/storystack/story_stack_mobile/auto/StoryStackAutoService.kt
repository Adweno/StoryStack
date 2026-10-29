package com.storystack.story_stack_mobile.auto

import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Base64
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media.MediaBrowserServiceCompat
import com.storystack.story_stack_mobile.R
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

class StoryStackAutoService : MediaBrowserServiceCompat() {
    private val worker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var session: MediaSessionCompat
    private var player: ExoPlayer? = null
    private var currentBook: AutoBook? = null
    private var lastLibrary: List<AutoBook> = emptyList()
    private var playbackSpeed = 1f
    // Android Auto can deliver the first pause/seek/skip immediately after
    // selecting a book, before the worker has prepared ExoPlayer. Retain
    // those commands so a newly selected book remains controllable.
    private var pendingPlayState: Boolean? = null
    private var pendingSeekPositionMs: Long? = null
    private var pendingSeekOffsetMs = 0L
    private val progressSync = object : Runnable {
        override fun run() {
            saveCurrentProgress(false)
            mainHandler.postDelayed(this, PROGRESS_SYNC_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        session = MediaSessionCompat(this, "StoryStackAutoService").apply {
            setCallback(SessionCallback())
            setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS)
            isActive = true
        }
        playbackSpeed = readPlaybackSpeed()
        sessionToken = session.sessionToken
        setPlaybackState(PlaybackStateCompat.STATE_NONE)
    }

    override fun onDestroy() {
        // The phone may be opened immediately after Auto closes.
        saveCurrentProgress(false)
        stopProgressSync()
        player?.release()
        session.release()
        worker.shutdownNow()
        super.onDestroy()
    }

    override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot {
        return BrowserRoot(ROOT_ID, null)
    }

    override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowserCompat.MediaItem>>) {
        // Android Auto can request the root more than once while the phone is
        // attaching. Keep that first response synchronous and deterministic so
        // a stale Flutter preference cannot make the entire app appear broken.
        val requestedId = parentId.ifBlank { ROOT_ID }
        if (requestedId == ROOT_ID) {
            result.sendResult(rootItems().toMutableList())
            return
        }

        result.detach()
        worker.execute {
            val items = try {
                childrenFor(requestedId)
            } catch (error: Throwable) {
                Log.e(TAG, "Could not load Android Auto content for $requestedId", error)
                listOf(messageItem("story-stack-error", "No downloaded books available", "Download a book in Story Stack first."))
            }
            result.sendResult(items.toMutableList())
        }
    }

    private fun childrenFor(parentId: String): List<MediaBrowserCompat.MediaItem> {
        // Android Auto is intentionally offline-only. Do not make the car
        // interface wait on authentication, Cloudflare, or the full server
        // catalog while the phone is connected to the vehicle.
        val library = downloadedBooks()
        lastLibrary = library
        return when {
            parentId == ROOT_ID -> rootItems()
            parentId == BOOKS_ID -> library.map { it.toPlayableItem() }
            parentId == SERIES_ID -> groupedItems("series", library.filter { !it.series.isNullOrBlank() && it.series != "Standalone" }, { it.series.orEmpty() })
            parentId == AUTHORS_ID -> groupedItems("author", library, { it.author })
            parentId.startsWith("$SERIES_PREFIX:") -> booksForGroup(parentId, library, "series")
            parentId.startsWith("$AUTHOR_PREFIX:") -> booksForGroup(parentId, library, "author")
            else -> emptyList()
        }
    }

    private fun rootItems(): List<MediaBrowserCompat.MediaItem> {
        return listOf(
            browsable(BOOKS_ID, "Books", "All books downloaded to this device"),
            browsable(SERIES_ID, "Series", "Browse saved books by series"),
            browsable(AUTHORS_ID, "Authors", "Browse saved books by author")
        )
    }

    private fun groupedItems(
        prefix: String,
        books: List<AutoBook>,
        keyFor: (AutoBook) -> String
    ): List<MediaBrowserCompat.MediaItem> {
        return books
            .groupBy(keyFor)
            .filterKeys { it.isNotBlank() }
            .toSortedMap(String.CASE_INSENSITIVE_ORDER)
            .map { (label, groupBooks) ->
                browsable("$prefix:${encode(label)}", label, "${groupBooks.size} books")
            }
    }

    private fun booksForGroup(parentId: String, library: List<AutoBook>, group: String): List<MediaBrowserCompat.MediaItem> {
        val label = decode(parentId.substringAfter(':'))
        val books = when (group) {
            "series" -> library.filter { it.series == label }.sortedWith(compareBy<AutoBook> { it.seriesOrder ?: it.publicationYear ?: 9999 }.thenBy { it.title })
            else -> library.filter { it.author == label }.sortedBy { it.title }
        }
        return books.map { it.toPlayableItem() }
    }

    private fun downloadedBooks(): List<AutoBook> {
        val root = downloadRoot()
        return loadDownloadedBookMetadata()
            .filter { it.id.isNotBlank() && isFullyDownloaded(root, it) }
            .sortedBy { it.title }
    }

    private fun isFullyDownloaded(root: File, book: AutoBook): Boolean {
        // Older builds wrote a single file even when the metadata reported
        // multiple audio tracks. Accept that valid local representation too.
        if (File(root, "${book.id}.audio").isFile) return true
        val trackCount = book.audioTrackCount.takeIf { it > 1 } ?: 1
        return (0 until trackCount).all { index ->
            File(root, "${book.id}.$index.audio").isFile
        }
    }

    private fun loadDownloadedBookMetadata(): List<AutoBook> {
        val prefs = flutterPrefs()
        val booksById = linkedMapOf<String, AutoBook>()

        // Each completed download stores its own metadata snapshot. This keeps
        // Android Auto independent of the server and the Flutter catalog cache.
        prefs.all
            .filterKeys { it.startsWith("flutter.androidAutoBook_") }
            .values
            .mapNotNull { it as? String }
            .forEach { rawBook ->
                runCatching {
                    AutoBook.fromJson(JSONObject(rawBook))
                }.getOrNull()?.let { book -> booksById[book.id] = book }
            }

        // Keep compatibility with installs created before per-book metadata
        // was written, while still filtering against local files below.
        val rawCatalog = runCatching {
            prefs.getString("flutter.androidAutoBookCatalog", null)
        }.getOrNull()
        if (!rawCatalog.isNullOrBlank()) {
            runCatching {
                val books = JSONArray(rawCatalog)
                (0 until books.length()).mapNotNull { index ->
                    runCatching { AutoBook.fromJson(books.getJSONObject(index)) }.getOrNull()
                }
            }.getOrDefault(emptyList()).forEach { book ->
                booksById.putIfAbsent(book.id, book)
            }
        }
        return booksById.values.toList()
    }

    private fun playBook(bookId: String) {
        pendingPlayState = true
        pendingSeekPositionMs = null
        pendingSeekOffsetMs = 0L
        worker.execute {
            val book = lastLibrary.find { it.id == bookId }
                ?: downloadedBooks().firstOrNull { it.id == bookId }
                ?: return@execute
            currentBook = book
            mainHandler.post {
                setMetadata(book)
                preparePlayer(book)
            }
        }
    }

    private fun preparePlayer(book: AutoBook) {
        stopProgressSync()
        player?.release()
        val preferences = flutterPrefs()
        // Auto writes its live position to the pending handoff key. Prefer it
        // when reconnecting to the car; the published key can still contain
        // the position from the previous Auto session until the phone opens.
        val savedPositionSeconds = readStoredNumber(
            preferences,
            "flutter.androidAutoPendingProgress_${book.id}"
        ) ?: readStoredNumber(preferences, "flutter.androidAutoProgress_${book.id}")
            ?: readStoredNumber(preferences, "androidAutoProgress_${book.id}")
            ?: 0L
        val savedPositionMs = savedPositionSeconds
            .coerceAtLeast(0L) * 1000L
        // Publish the known position before ExoPlayer has prepared. Android
        // Auto can render this state immediately instead of showing 00:00.
        setPlaybackState(PlaybackStateCompat.STATE_BUFFERING, savedPositionMs)
        var restoredSeekApplied = false

        val nextPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(
                androidx.media3.exoplayer.source.DefaultMediaSourceFactory(
                    DefaultDataSource.Factory(this)
                )
            )
            .build()
        nextPlayer.setAudioAttributes(
            AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                .setUsage(C.USAGE_MEDIA)
                .build(),
            true
        )
        nextPlayer.addListener(
            object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    when (playbackState) {
                        Player.STATE_READY -> {
                            if (!restoredSeekApplied && savedPositionMs > 0L) {
                                val maxPosition = (nextPlayer.duration - 1000L).coerceAtLeast(0L)
                                nextPlayer.seekTo(savedPositionMs.coerceAtMost(maxPosition))
                                restoredSeekApplied = true
                            }
                            setPlaybackState(
                                if (nextPlayer.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                                nextPlayer.currentPosition
                            )
                            startProgressSync()
                        }
                        Player.STATE_ENDED -> {
                            saveCurrentProgress(true)
                            setPlaybackState(PlaybackStateCompat.STATE_STOPPED)
                            stopProgressSync()
                        }
                        Player.STATE_BUFFERING -> setPlaybackState(PlaybackStateCompat.STATE_BUFFERING)
                        Player.STATE_IDLE -> setPlaybackState(PlaybackStateCompat.STATE_NONE)
                    }
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    setPlaybackState(if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED)
                }

                override fun onPlayerError(error: PlaybackException) {
                    setPlaybackState(PlaybackStateCompat.STATE_ERROR)
                    stopProgressSync()
                }
            }
        )

        val localAudio = File(downloadRoot(), "${book.id}.audio")
        if (book.localTrackPaths.isNotEmpty()) {
            nextPlayer.setMediaItems(book.localTrackPaths.map { path -> MediaItem.fromUri(Uri.parse(path)) })
        } else if (localAudio.exists()) {
            nextPlayer.setMediaItem(MediaItem.fromUri(Uri.fromFile(localAudio)))
        } else {
            val trackCount = book.audioTrackCount.takeIf { it > 1 } ?: 1
            val mediaItems = (0 until trackCount).map { index ->
                val fileName = if (trackCount == 1) "${book.id}.audio" else "${book.id}.$index.audio"
                MediaItem.fromUri(Uri.fromFile(File(downloadRoot(), fileName)))
            }
            nextPlayer.setMediaItems(mediaItems)
        }
        player = nextPlayer
        if (savedPositionMs > 0L) {
            nextPlayer.seekTo(savedPositionMs)
        }
        nextPlayer.setPlaybackSpeed(playbackSpeed)
        nextPlayer.prepare()
        pendingSeekPositionMs?.let { nextPlayer.seekTo(it.coerceAtLeast(0L)) }
        if (pendingSeekOffsetMs != 0L) {
            nextPlayer.seekTo((nextPlayer.currentPosition + pendingSeekOffsetMs).coerceAtLeast(0L))
        }
        nextPlayer.playWhenReady = pendingPlayState ?: true
        pendingSeekPositionMs = null
        pendingSeekOffsetMs = 0L
        pendingPlayState = null
    }

    private fun setMetadata(book: AutoBook) {
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, "book:${book.id}")
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, book.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, book.author)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, book.series ?: "Story Stack")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (book.durationSeconds ?: 0) * 1000L)
        coverBitmap(book)?.let { builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
        session.setMetadata(builder.build())
    }

    private fun setPlaybackState(state: Int, positionOverride: Long? = null) {
        val currentPosition = try {
            positionOverride ?: player?.currentPosition ?: PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN
        } catch (_: Exception) {
            PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN
        }
        val actions = PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_STOP or
            PlaybackStateCompat.ACTION_SEEK_TO or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
        val speedAction = PlaybackStateCompat.CustomAction.Builder(
            SPEED_ACTION,
            speedLabel(playbackSpeed),
            speedIcon(playbackSpeed)
        ).build()
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(actions)
                .addCustomAction(speedAction)
                .setState(state, currentPosition, playbackSpeed)
                .build()
        )
    }

    private fun readPlaybackSpeed(): Float {
        val stored = flutterPrefs().getFloat("androidAutoPlaybackSpeed", 1f)
        return stored.takeIf { it in 0.5f..2f } ?: 1f
    }

    private fun readStoredNumber(
        preferences: SharedPreferences,
        key: String
    ): Long? {
        return (preferences.all[key] as? Number)?.toLong()
    }

    private fun speedLabel(speed: Float): String {
        return if (speed == speed.toInt().toFloat()) "${speed.toInt()}x" else "${speed}x"
    }

    // Android Auto does not render custom-action titles on the now-playing
    // surface, so the current value must be encoded in the static icon.
    private fun speedIcon(speed: Float): Int {
        return when {
            kotlin.math.abs(speed - 0.75f) < 0.01f -> R.drawable.ic_speed_075
            kotlin.math.abs(speed - 1.25f) < 0.01f -> R.drawable.ic_speed_125
            kotlin.math.abs(speed - 1.5f) < 0.01f -> R.drawable.ic_speed_15
            kotlin.math.abs(speed - 1.75f) < 0.01f -> R.drawable.ic_speed_175
            kotlin.math.abs(speed - 2f) < 0.01f -> R.drawable.ic_speed_2
            else -> R.drawable.ic_speed_1
        }
    }

    private fun cyclePlaybackSpeed() {
        val speeds = floatArrayOf(0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
        val currentIndex = speeds.indexOfFirst { kotlin.math.abs(it - playbackSpeed) < 0.01f }
        playbackSpeed = speeds[(currentIndex + 1).mod(speeds.size)]
        player?.setPlaybackSpeed(playbackSpeed)
        flutterPrefs().edit().putFloat("androidAutoPlaybackSpeed", playbackSpeed).apply()
        setPlaybackState(if (player?.isPlaying == true) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED)
    }

    private fun seekBy(deltaMs: Int) {
        val activePlayer = player
        if (activePlayer == null) {
            pendingSeekOffsetMs += deltaMs.toLong()
            return
        }
        val duration = try {
            activePlayer.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
        } catch (_: Exception) {
            Long.MAX_VALUE
        }
        val next = ((activePlayer.currentPosition) + deltaMs).coerceIn(0L, duration)
        activePlayer.seekTo(next)
        setPlaybackState(if (activePlayer.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED)
        saveCurrentProgress(false)
    }

    private fun startProgressSync() {
        mainHandler.removeCallbacks(progressSync)
        mainHandler.postDelayed(progressSync, PROGRESS_SYNC_MS)
    }

    private fun stopProgressSync() {
        mainHandler.removeCallbacks(progressSync)
    }

    private fun saveCurrentProgress(finished: Boolean) {
        val book = currentBook ?: return
        val (positionSeconds, durationSeconds) = wholeBookProgress(book, finished)
        flutterPrefs().edit()
            .putLong("flutter.androidAutoPendingProgress_${book.id}", positionSeconds.toLong())
            .apply {
                if (durationSeconds != null) {
                    putLong("flutter.androidAutoPendingDuration_${book.id}", durationSeconds.toLong())
                }
            }
            .commit()
    }

    private fun wholeBookProgress(book: AutoBook, finished: Boolean): Pair<Double, Double?> {
        val activePlayer = player
        val hasCompleteTrackDurations = book.trackDurationsSeconds.size == book.audioTrackCount &&
            book.audioTrackCount > 0
        val trackDurationsMs = if (hasCompleteTrackDurations) {
            book.trackDurationsSeconds.map { it * 1000L }
        } else {
            emptyList()
        }
        val declaredDurationMs = trackDurationsMs.sum().takeIf { it > 0L }
            ?: book.durationSeconds?.times(1000L)
        if (finished) {
            val duration = declaredDurationMs ?: activePlayer?.duration?.takeIf { it > 0L }
            return Pair((duration ?: 0L) / 1000.0, duration?.div(1000.0))
        }

        val currentPositionMs = try {
            activePlayer?.currentPosition?.coerceAtLeast(0L) ?: 0L
        } catch (_: Exception) {
            0L
        }
        val currentIndex = try {
            activePlayer?.currentMediaItemIndex?.coerceAtLeast(0) ?: 0
        } catch (_: Exception) {
            0
        }
        val precedingDurationMs = trackDurationsMs
            .take(currentIndex.coerceAtMost(trackDurationsMs.size))
            .sum()
        val positionMs = precedingDurationMs + currentPositionMs
        return Pair(positionMs / 1000.0, declaredDurationMs?.div(1000.0))
    }

    private fun flutterPrefs(): SharedPreferences {
        return getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE)
    }

    private fun downloadRoot(): File {
        return File(applicationInfo.dataDir, "app_flutter/story_stack_downloads").apply { mkdirs() }
    }

    private fun browsable(mediaId: String, title: String, subtitle: String): MediaBrowserCompat.MediaItem {
        val description = MediaDescriptionCompat.Builder()
            .setMediaId(mediaId)
            .setTitle(title)
            .setSubtitle(subtitle)
            .build()
        return MediaBrowserCompat.MediaItem(description, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE)
    }

    private fun AutoBook.toPlayableItem(): MediaBrowserCompat.MediaItem {
        val builder = MediaDescriptionCompat.Builder()
            .setMediaId("book:$id")
            .setTitle(title)
            .setSubtitle(author)
            .setDescription(series)
        coverBitmap(this)?.let { builder.setIconBitmap(it) }
        return MediaBrowserCompat.MediaItem(builder.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE)
    }

    private fun coverBitmap(book: AutoBook): Bitmap? {
        val cover = File(downloadRoot(), "${book.id}.cover")
        if (!cover.isFile) return null
        return runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(cover.absolutePath, bounds)
            val longestSide = maxOf(bounds.outWidth, bounds.outHeight)
            val sampleSize = if (longestSide > 512) {
                Integer.highestOneBit((longestSide / 512).coerceAtLeast(1))
            } else {
                1
            }
            val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
            BitmapFactory.decodeFile(cover.absolutePath, options)
        }.getOrNull()
    }

    private fun messageItem(mediaId: String, title: String, subtitle: String): MediaBrowserCompat.MediaItem {
        return browsable(mediaId, title, subtitle)
    }

    private fun encode(value: String): String {
        return Base64.encodeToString(value.toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP)
    }

    private fun decode(value: String): String {
        return String(Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8)
    }

    private inner class SessionCallback : MediaSessionCompat.Callback() {
        override fun onPlayFromMediaId(mediaId: String, extras: Bundle?) {
            if (mediaId.startsWith("book:")) {
                playBook(mediaId.substringAfter("book:"))
            }
        }

        override fun onPlay() {
            val activePlayer = player
            if (activePlayer == null) {
                pendingPlayState = true
                return
            }
            activePlayer.play()
            setPlaybackState(PlaybackStateCompat.STATE_PLAYING)
            startProgressSync()
        }

        override fun onPause() {
            val activePlayer = player
            if (activePlayer == null) {
                pendingPlayState = false
                return
            }
            activePlayer.pause()
            setPlaybackState(PlaybackStateCompat.STATE_PAUSED)
            saveCurrentProgress(false)
            stopProgressSync()
        }

        override fun onStop() {
            val activePlayer = player
            if (activePlayer == null) {
                pendingPlayState = false
                return
            }
            activePlayer.stop()
            setPlaybackState(PlaybackStateCompat.STATE_STOPPED)
            saveCurrentProgress(false)
            stopProgressSync()
        }

        override fun onSeekTo(pos: Long) {
            val activePlayer = player
            if (activePlayer == null) {
                pendingSeekPositionMs = pos
                return
            }
            activePlayer.seekTo(pos)
            setPlaybackState(if (activePlayer.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED)
            saveCurrentProgress(false)
        }

        override fun onFastForward() {
            seekBy(SKIP_MS)
        }

        override fun onRewind() {
            seekBy(-SKIP_MS)
        }

        override fun onSkipToNext() {
            seekBy(SKIP_MS)
        }

        override fun onSkipToPrevious() {
            seekBy(-SKIP_MS)
        }

        override fun onCustomAction(action: String, extras: Bundle?) {
            when (action) {
                SKIP_BACK_ACTION -> seekBy(-SKIP_MS)
                SKIP_FORWARD_ACTION -> seekBy(SKIP_MS)
                SPEED_ACTION -> cyclePlaybackSpeed()
                else -> super.onCustomAction(action, extras)
            }
        }
    }

    private data class AutoBook(
        val id: String,
        val title: String,
        val author: String,
        val addedAt: String,
        val series: String?,
        val seriesOrder: Double?,
        val publicationYear: Int?,
        val durationSeconds: Int?,
        val audioTrackCount: Int,
        val trackDurationsSeconds: List<Long>,
        val localTrackPaths: List<String>
    ) {
        val isLocalDevice: Boolean
            get() = id.startsWith("local_")

        companion object {
            fun fromJson(json: JSONObject): AutoBook {
                val tracks = json.optJSONArray("audioTracks")
                val trackDurationsSeconds = if (tracks != null) {
                    (0 until tracks.length()).mapNotNull { index ->
                        tracks.optJSONObject(index)?.let { track ->
                            if (track.has("durationSeconds") && !track.isNull("durationSeconds")) {
                                track.optLong("durationSeconds").takeIf { it > 0L }
                            } else {
                                null
                            }
                        }
                    }
                } else {
                    emptyList()
                }
                val localTrackPaths = if (json.optString("id").startsWith("local_") && tracks != null) {
                    (0 until tracks.length()).mapNotNull { index ->
                        tracks.optJSONObject(index)?.optString("path")?.takeIf { it.isNotBlank() }
                    }
                } else {
                    emptyList()
                }
                return AutoBook(
                    id = json.optString("id"),
                    title = json.optString("title", "Untitled"),
                    author = json.optString("author", "Unknown Author"),
                    addedAt = json.optString("addedAt"),
                    series = json.optString("series").ifBlank { null },
                    seriesOrder = optDoubleOrNull(json, "seriesOrder"),
                    publicationYear = optIntOrNull(json, "publicationYear"),
                    durationSeconds = optIntOrNull(json, "durationSeconds"),
                    audioTrackCount = (tracks?.length() ?: 0).takeIf { it > 0 }
                        ?: json.optInt("audioTrackCount", 1),
                    trackDurationsSeconds = trackDurationsSeconds,
                    localTrackPaths = localTrackPaths
                )
            }

            private fun optDoubleOrNull(json: JSONObject, key: String): Double? {
                return if (json.has(key) && !json.isNull(key)) json.optDouble(key) else null
            }

            private fun optIntOrNull(json: JSONObject, key: String): Int? {
                return if (json.has(key) && !json.isNull(key)) json.optInt(key) else null
            }
        }
    }

    companion object {
        private const val TAG = "StoryStackAutoService"
        private const val ROOT_ID = "story-stack-root"
        private const val BOOKS_ID = "story-stack-books"
        private const val SERIES_ID = "story-stack-series"
        private const val AUTHORS_ID = "story-stack-authors"
        private const val SERIES_PREFIX = "series"
        private const val AUTHOR_PREFIX = "author"
        private const val PROGRESS_SYNC_MS = 5000L
        private const val SKIP_MS = 30000
        private const val SKIP_BACK_ACTION = "com.storystack.story_stack_mobile.auto.SKIP_BACK_30"
        private const val SKIP_FORWARD_ACTION = "com.storystack.story_stack_mobile.auto.SKIP_FORWARD_30"
        private const val SPEED_ACTION = "com.storystack.story_stack_mobile.auto.SPEED"
        private const val RESERVE_SKIP_TO_PREVIOUS_SLOT = "android.media.playback.ALWAYS_RESERVE_SPACE_FOR.ACTION_SKIP_TO_PREVIOUS"
        private const val RESERVE_SKIP_TO_NEXT_SLOT = "android.media.playback.ALWAYS_RESERVE_SPACE_FOR.ACTION_SKIP_TO_NEXT"
    }
}
