# HEIC Converter — User Guide

## How to Run

1. Open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari)
2. An internet connection is required on first load (conversion libraries are loaded from CDN)
3. No installation, build step, or sign-in needed — everything runs locally in your browser

---

## Convert Page

### Adding Files

- **Drag & drop** `.heic` / `.heif` files, or an entire folder, onto the drop zone
- **Browse Files** — opens a file picker for individual HEIC files
- **Browse Folder** — opens a folder picker; all HEIC files inside (including subfolders) are added automatically
- Non-HEIC files are silently skipped with a count shown in a notification

### Output Format

| Format | Best for |
|---|---|
| **JPEG** | Photos, general use — smaller files, adjustable quality |
| **PNG** | Screenshots, graphics — lossless, larger files |

JPEG quality (1–100): higher = better image, larger file. 80–90 is a good default for photos.

### Naming Convention

**Custom Prefix** — type a prefix; files are numbered automatically:
- Prefix `vacation_2024` → `vacation_2024_001.jpg`, `vacation_2024_002.jpg`, …
- Leave blank to use `converted_001.jpg`, etc.

**Metadata Template** — build a filename from tokens pulled from each image's EXIF data:
- Example: `{date}_{model}` → `2024-07-04_iPhone-15-Pro.jpg`
- Click any token chip to insert it at the cursor in the template field
- Unresolvable tokens (missing metadata) are silently removed from the name
- Use the **Metadata Inspector** tab to see which fields your files actually contain

Available tokens:

| Token | Value |
|---|---|
| `{filename}` | Original filename (no extension) |
| `{index}` | Auto-number: 001, 002, … |
| `{date}` | Photo date: YYYY-MM-DD |
| `{time}` | Photo time: HH-MM-SS |
| `{datetime}` | Date + time: YYYYMMDD_HHMMSS |
| `{year}` | Year: YYYY |
| `{month}` | Month: MM |
| `{day}` | Day: DD |
| `{make}` | Camera make (e.g. Apple) |
| `{model}` | Camera model (e.g. iPhone-15-Pro) |

### Output Location

- **Download** (default) — click **↓ Save File** for single files, or **↓ Download All as ZIP** for bulk. Works in all browsers.
- **Direct folder saving** (Chrome / Edge only) — click **Select Output Folder** to pick a destination. Each file is written there automatically as it finishes converting.

### Converting

1. Add files to the queue — they appear in the list below the settings
2. Set format, quality, and naming convention
3. Click **Convert N Files**
4. Watch per-file status in the queue: ○ ready → ⟳ converting → ✓ done (or ✗ error)
5. Download files individually or all at once as a ZIP

---

## Metadata Inspector

Drop or browse any image (HEIC, JPEG, PNG, TIFF) to explore all embedded data:

- **EXIF** — capture date/time, camera make and model, GPS location, lens, exposure
- **IPTC** — captions, keywords, copyright info
- **XMP** — extended metadata written by editing software
- **File** — basic file-level information

Fields that map to naming tokens show clickable chips (e.g. `{date}`, `{make}`) — click to copy, then paste into the Metadata Template on the Convert page.

---

## Privacy

All conversion and metadata reading happens **entirely inside your browser**. No files are ever uploaded to any server.

---

## Tips

- Run Metadata Inspector on a sample file first to discover which EXIF fields are present before configuring your naming template
- For large batches the progress bar shows overall status; individual file status is shown per row
- If a file shows an error, hover its red message for details — it may not be a valid HEIC despite the extension
- To re-convert with different settings: click **Clear all**, re-add files, adjust settings, and convert again
- The **?** button in the sidebar opens this guide at any time
