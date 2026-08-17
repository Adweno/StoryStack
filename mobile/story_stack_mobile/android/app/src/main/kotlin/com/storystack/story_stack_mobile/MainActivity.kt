package com.storystack.story_stack_mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import com.ryanheise.audioservice.AudioServiceActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.text.Normalizer
import java.util.Locale

class MainActivity : AudioServiceActivity() {
    private val channelName = "story_stack/local_device"
    private val requestChooseFolder = 8104
    private var pendingResult: MethodChannel.Result? = null

    private val audioExtensions = setOf(
        ".aac", ".aa", ".aax", ".aiff", ".alac", ".flac", ".m4a", ".m4b",
        ".mp3", ".mp4", ".mka", ".ogg", ".oga", ".opus", ".wav", ".weba",
        ".webm", ".wma"
    )
    private val coverExtensions = setOf(".jpg", ".jpeg", ".png", ".webp")
    private val metadataFileNames = setOf("metadata.json", "book.json", "desc.json")

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler { call, result ->
            when (call.method) {
                "chooseAndScan" -> chooseAndScan(result)
                "scanPersisted" -> {
                    val treeUri = call.argument<String>("treeUri")
                    if (treeUri.isNullOrBlank()) {
                        result.error("missing_folder", "Choose an audiobook folder before scanning.", null)
                    } else {
                        scanTree(Uri.parse(treeUri), result)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun chooseAndScan(result: MethodChannel.Result) {
        if (pendingResult != null) {
            result.error("busy", "Folder picker is already open.", null)
            return
        }
        pendingResult = result
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        }
        startActivityForResult(intent, requestChooseFolder)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != requestChooseFolder) return
        val result = pendingResult ?: return
        pendingResult = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            result.success(null)
            return
        }
        val flags = data.flags and
            (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        try {
            contentResolver.takePersistableUriPermission(uri, flags and Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {
        }
        scanTree(uri, result)
    }

    private fun scanTree(treeUri: Uri, result: MethodChannel.Result) {
        try {
            val root = DocumentFile.fromTreeUri(this, treeUri)
            if (root == null || !root.isDirectory) {
                result.error("invalid_folder", "That folder is no longer available.", null)
                return
            }
            val bookDirectories = findBookDirectories(root)
            val books = bookDirectories.mapNotNull { createBook(treeUri, it) }
                .sortedBy { "${it["title"]}".lowercase(Locale.US) }
            val scannedFiles = books.sumOf {
                @Suppress("UNCHECKED_CAST")
                (it["audioTracks"] as List<Map<String, Any?>>).size
            }
            result.success(
                mapOf(
                    "folderPath" to (root.name ?: "Audiobook folder"),
                    "treeUri" to treeUri.toString(),
                    "scannedAt" to java.time.Instant.now().toString(),
                    "scannedBooks" to books.size,
                    "scannedFiles" to scannedFiles,
                    "books" to books
                )
            )
        } catch (exception: Exception) {
            result.error("scan_failed", exception.message ?: "Audiobook folder could not be scanned.", null)
        }
    }

    private fun findBookDirectories(root: DocumentFile): List<DocumentFile> {
        val audioDirectories = linkedMapOf<String, DocumentFile>()
        val queue = ArrayDeque<DocumentFile>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val current = queue.removeFirst()
            val children = current.listFiles()
            val hasAudio = children.any { it.isFile && audioExtensions.contains(extension(it.name)) }
            if (hasAudio) {
                val normalized = normalizeBookDirectory(root, current)
                audioDirectories[normalized.uri.toString()] = normalized
            }
            children
                .filter { it.isDirectory && !(it.name ?: "").startsWith(".") }
                .forEach { queue.add(it) }
        }
        return audioDirectories.values.toList()
    }

    private fun createBook(treeUri: Uri, directory: DocumentFile): Map<String, Any?>? {
        val files = readBookFiles(directory)
        val directFiles = directory.listFiles().filter { it.isFile }.mapNotNull { it.name?.lowercase(Locale.US) }
        val metadata = readMetadata(directory, directFiles)
        val audioFiles = files.filter { audioExtensions.contains(extension(it.name)) }
            .sortedBy { it.name ?: "" }
        if (audioFiles.isEmpty()) return null
        val coverFile = files.firstOrNull {
            coverExtensions.contains(extension(it.name)) &&
                Regex("cover|folder|front", RegexOption.IGNORE_CASE).containsMatchIn(it.name ?: "")
        } ?: files.firstOrNull { coverExtensions.contains(extension(it.name)) }
        val title = stringValue(metadata["title"]) ?: cleanTitle(directory.name ?: "Untitled")
        return mapOf(
            "id" to "local_${stableId(directory.uri.toString())}",
            "title" to title,
            "subtitle" to stringValue(metadata["subtitle"]),
            "author" to (stringValue(metadata["author"]) ?: stringValue(metadata["authors"]) ?: "Unknown Author"),
            "narrator" to stringValue(metadata["narrator"]),
            "series" to stringValue(metadata["series"]),
            "seriesOrder" to (numberValue(metadata["seriesOrder"]) ?: numberValue(metadata["sequence"])),
            "description" to (stringValue(metadata["description"]) ?: stringValue(metadata["summary"])),
            "genres" to stringArray(metadata["genres"] ?: metadata["tags"]),
            "durationSeconds" to (numberValue(metadata["durationSeconds"]) ?: numberValue(metadata["duration"])),
            "publicationYear" to (numberValue(metadata["publicationYear"]) ?: numberValue(metadata["publishedYear"])),
            "coverPath" to coverFile?.uri?.toString(),
            "audioTracks" to audioFiles.map { mapOf("path" to it.uri.toString()) },
            "addedAt" to java.time.Instant.now().toString(),
            "inLibrary" to false,
            "sourcePath" to directory.uri.toString(),
            "folderPath" to (directory.name ?: title),
            "treeUri" to treeUri.toString()
        )
    }

    private fun normalizeBookDirectory(root: DocumentFile, directory: DocumentFile): DocumentFile {
        val name = directory.name ?: return directory
        val isDiscFolder = Regex("^(cd|disc|disk|part|volume|vol)\\s*[-_.#]?\\s*\\d+$", RegexOption.IGNORE_CASE)
            .matches(name)
        val parentUri = parentDocumentUri(directory.uri)
        return if (directory.uri != root.uri && isDiscFolder && parentUri != null) {
            DocumentFile.fromTreeUri(this, parentUri) ?: directory
        } else {
            directory
        }
    }

    private fun readBookFiles(directory: DocumentFile): List<DocumentFile> {
        val result = mutableListOf<DocumentFile>()
        for (child in directory.listFiles()) {
            if (child.isFile) {
                result.add(child)
            } else if (child.isDirectory && shouldScanNestedBookFiles(child.name)) {
                collectFiles(child, result)
            }
        }
        return result
    }

    private fun collectFiles(directory: DocumentFile, result: MutableList<DocumentFile>) {
        for (child in directory.listFiles()) {
            if (child.isFile) result.add(child)
            if (child.isDirectory) collectFiles(child, result)
        }
    }

    private fun shouldScanNestedBookFiles(name: String?) =
        Regex("^(cd|disc|disk|part|volume|vol)\\s*[-_.#]?\\s*\\d+$", RegexOption.IGNORE_CASE)
            .matches(name ?: "")

    private fun readMetadata(directory: DocumentFile, directFiles: List<String>): Map<String, Any?> {
        val fileName = directFiles.firstOrNull { metadataFileNames.contains(it) } ?: return emptyMap()
        val file = directory.listFiles().firstOrNull { (it.name ?: "").lowercase(Locale.US) == fileName } ?: return emptyMap()
        return try {
            contentResolver.openInputStream(file.uri)?.use { input ->
                val raw = BufferedReader(InputStreamReader(input)).readText()
                jsonObjectToMap(JSONObject(raw))
            } ?: emptyMap()
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun jsonObjectToMap(json: JSONObject): Map<String, Any?> =
        json.keys().asSequence().associateWith { key -> json.opt(key) }

    private fun parentDocumentUri(uri: Uri): Uri? = try {
        val documentId = DocumentsContract.getDocumentId(uri)
        val slash = documentId.lastIndexOf('/')
        if (slash <= 0) null else DocumentsContract.buildDocumentUriUsingTree(uri, documentId.substring(0, slash))
    } catch (_: Exception) {
        null
    }

    private fun extension(name: String?): String {
        val safeName = name ?: return ""
        val dot = safeName.lastIndexOf('.')
        return if (dot < 0) "" else safeName.substring(dot).lowercase(Locale.US)
    }

    private fun cleanTitle(value: String) = value.replace(Regex("[_-]+"), " ")

    private fun stableId(value: String): String {
        val normalized = Normalizer.normalize(value, Normalizer.Form.NFKD)
        return java.util.Base64.getUrlEncoder().withoutPadding()
            .encodeToString(normalized.toByteArray(Charsets.UTF_8))
    }

    private fun stringValue(value: Any?): String? = when (value) {
        null -> null
        is String -> value.trim().ifEmpty { null }
        else -> "$value".trim().ifEmpty { null }
    }

    private fun numberValue(value: Any?): Number? = when (value) {
        is Number -> value
        is String -> value.toDoubleOrNull()
        else -> null
    }

    private fun stringArray(value: Any?): List<String> = when (value) {
        is org.json.JSONArray -> (0 until value.length()).mapNotNull { value.optString(it).trim().ifEmpty { null } }
        is String -> value.split(",").mapNotNull { it.trim().ifEmpty { null } }
        else -> emptyList()
    }
}
