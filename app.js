'use strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const NAMING_TOKENS = [
  { token: '{filename}', desc: 'Original filename (no extension)' },
  { token: '{index}',    desc: 'Auto-number: 001, 002, …' },
  { token: '{date}',     desc: 'Photo date: YYYY-MM-DD' },
  { token: '{time}',     desc: 'Photo time: HH-MM-SS' },
  { token: '{datetime}', desc: 'Date + time: YYYYMMDD_HHMMSS' },
  { token: '{year}',     desc: 'Year: YYYY' },
  { token: '{month}',    desc: 'Month: MM' },
  { token: '{day}',      desc: 'Day: DD' },
  { token: '{make}',     desc: 'Camera make (e.g. Apple)' },
  { token: '{model}',    desc: 'Camera model (e.g. iPhone-15-Pro)' },
];

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const state = {
  page: 'converter',
  params: {},
  // Conversion settings
  fmt: 'jpeg',
  quality: 85,
  namingMode: 'custom',     // 'custom' | 'metadata'
  customPrefix: '',
  metaTpl: '{date}_{filename}',
  outputDirHandle: null,
  // File queue
  files: [],                // FileEntry[]
  converting: false,
  convDone: 0,
  convTotal: 0,
  // Metadata inspector
  metaFile: null,
  metaTags: null,
  metaLoading: false,
};

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function uuid() {
  return crypto.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isHeicFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return ext === 'heic' || ext === 'heif';
}

function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ═══════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════

function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ═══════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════

function showConfirm(title, msg, onConfirm, confirmLabel = 'Confirm') {
  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${esc(title)}</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="modal-body">
      <p style="color:var(--muted);font-size:14px;line-height:1.6">${esc(msg)}</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="hideModal()">Cancel</button>
      <button class="btn btn-danger" id="modal-confirm">${esc(confirmLabel)}</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-confirm').onclick = () => { onConfirm(); hideModal(); };
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal').classList.remove('modal-wide');
}

document.addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') hideModal();
});

function showHelpModal(tab = 'readme') {
  const readmeMd = document.getElementById('doc-readme')?.textContent ?? 'Documentation not found.';
  const claudeMd = document.getElementById('doc-claude')?.textContent ?? 'Documentation not found.';
  const render = md => typeof marked !== 'undefined'
    ? marked.parse(md)
    : `<pre style="white-space:pre-wrap;font-size:12.5px;">${esc(md)}</pre>`;

  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Help &amp; Documentation</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="help-tabs">
      <button class="help-tab-btn${tab === 'readme' ? ' active' : ''}" onclick="switchHelpTab('readme')">User Guide</button>
      <button class="help-tab-btn${tab === 'claude' ? ' active' : ''}" onclick="switchHelpTab('claude')">Developer Guide</button>
    </div>
    <div class="help-content" id="help-readme"${tab !== 'readme' ? ' style="display:none"' : ''}>
      ${render(readmeMd)}
    </div>
    <div class="help-content" id="help-claude"${tab !== 'claude' ? ' style="display:none"' : ''}>
      ${render(claudeMd)}
    </div>`;
  document.getElementById('modal').classList.add('modal-wide');
  document.getElementById('modal-overlay').classList.add('open');
}

function switchHelpTab(tab) {
  document.getElementById('help-readme').style.display = tab === 'readme' ? '' : 'none';
  document.getElementById('help-claude').style.display = tab === 'claude' ? '' : 'none';
  document.querySelectorAll('.help-tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && tab === 'readme') || (i === 1 && tab === 'claude'));
  });
}

// ═══════════════════════════════════════════════════════════════
// EXIF READING
// ═══════════════════════════════════════════════════════════════

async function readExif(file) {
  try {
    if (typeof ExifReader === 'undefined') return null;
    const ab = await file.arrayBuffer();
    return ExifReader.load(ab, { expanded: true });
  } catch {
    return null;
  }
}

async function loadExifForEntry(entry) {
  entry.exif = await readExif(entry.file);
  refreshQueue();
}

// ═══════════════════════════════════════════════════════════════
// NAMING CONVENTION
// ═══════════════════════════════════════════════════════════════

function computeOutputName(entry, index, total) {
  const ext = state.fmt === 'jpeg' ? 'jpg' : 'png';
  const padLen = Math.max(String(total).length, 3);
  const numStr = String(index + 1).padStart(padLen, '0');

  if (state.namingMode === 'custom') {
    const raw = state.customPrefix.trim();
    const prefix = raw
      ? raw.replace(/[^a-zA-Z0-9._\- ]/g, '_').replace(/\s+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '') || 'converted'
      : 'converted';
    return `${prefix}_${numStr}.${ext}`;
  }

  // Metadata template mode
  const tpl = state.metaTpl || '{filename}_{index}';
  const stem = entry.file.name.replace(/\.[^.]+$/, '');
  let name = tpl;

  name = name.replace(/\{filename\}/g, stem);
  name = name.replace(/\{index\}/g, numStr);

  const exif = entry.exif?.exif;
  if (exif) {
    const dto =
      exif.DateTimeOriginal?.description ??
      exif.DateTime?.description ?? '';
    if (dto) {
      // Format: "2024:07:04 14:30:00"
      const [dp = '', tp = ''] = dto.split(' ');
      const dArr = dp.split(':');   // ['2024','07','04']
      const tArr = tp.split(':');   // ['14','30','00']
      name = name.replace(/\{date\}/g, dArr.join('-'));
      name = name.replace(/\{time\}/g, tArr.join('-'));
      name = name.replace(/\{datetime\}/g, `${dArr.join('')}_${tArr.join('')}`);
      name = name.replace(/\{year\}/g,  dArr[0] ?? '');
      name = name.replace(/\{month\}/g, dArr[1] ?? '');
      name = name.replace(/\{day\}/g,   dArr[2] ?? '');
    }
    const make  = (exif.Make?.description  ?? '').replace(/\s+/g, '-');
    const model = (exif.Model?.description ?? '').replace(/\s+/g, '-');
    name = name.replace(/\{make\}/g,  make);
    name = name.replace(/\{model\}/g, model);
  }

  // Drop unresolved tokens, sanitise remaining characters
  name = name
    .replace(/\{[^}]+\}/g, '')
    .replace(/[^a-zA-Z0-9._\-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!name) name = `converted_${numStr}`;
  return `${name}.${ext}`;
}

// Returns a sample name using dummy data for the live preview
function getNamingPreview() {
  const dummy = {
    file: { name: 'IMG_1234.HEIC' },
    exif: {
      exif: {
        DateTimeOriginal: { description: '2024:07:04 14:30:00' },
        Make:  { description: 'Apple' },
        Model: { description: 'iPhone 15 Pro' },
      },
    },
  };
  return computeOutputName(dummy, 0, 10);
}

function refreshNamingPreview() {
  const el = document.getElementById('naming-preview');
  if (el) el.textContent = getNamingPreview();
}

// ═══════════════════════════════════════════════════════════════
// FILE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// Recursively collect File objects from DataTransferItem entries (supports folders)
async function getFilesFromEntries(entries) {
  const files = [];

  async function walk(entry) {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      files.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child);
      } while (batch.length > 0);
    }
  }

  for (const entry of entries) await walk(entry);
  return files;
}

function addFiles(fileList) {
  if (state.converting) return;
  const all = Array.from(fileList);
  const heic = all.filter(isHeicFile);
  const skipped = all.length - heic.length;
  if (skipped > 0) showToast(`${skipped} non-HEIC file${skipped !== 1 ? 's' : ''} skipped`);
  if (!heic.length) return;

  const entries = heic.map(file => ({
    id: uuid(),
    file,
    status: 'ready',
    exif: null,
    outputName: null,
    outputBlob: null,
    error: null,
  }));

  state.files.push(...entries);
  refreshQueue();

  // Load EXIF in the background for metadata-based naming previews
  entries.forEach(e => loadExifForEntry(e));
}

function removeFile(id) {
  if (state.converting) return;
  state.files = state.files.filter(e => e.id !== id);
  refreshQueue();
}

function clearQueue() {
  if (state.converting) return;
  if (!state.files.length) return;
  showConfirm('Clear Queue', 'Remove all files from the queue?', () => {
    state.files = [];
    refreshQueue();
  }, 'Clear All');
}

// ═══════════════════════════════════════════════════════════════
// CONVERSION ENGINE
// ═══════════════════════════════════════════════════════════════

async function startConversion() {
  if (state.converting) return;

  if (typeof heic2any === 'undefined') {
    showToast('heic2any library not loaded — check your internet connection.', 'error');
    return;
  }

  const toConvert = state.files.filter(f => f.status === 'ready' || f.status === 'error');
  if (!toConvert.length) {
    showToast('No files to convert', '');
    return;
  }

  // Pre-compute output names so numbering is stable
  toConvert.forEach((entry, i) => {
    entry.outputName = computeOutputName(entry, i, toConvert.length);
  });

  state.converting = true;
  state.convDone   = 0;
  state.convTotal  = toConvert.length;
  refreshQueue();

  for (const entry of toConvert) {
    entry.status = 'converting';
    refreshQueue();

    try {
      let result = await heic2any({
        blob:    entry.file,
        toType:  state.fmt === 'jpeg' ? 'image/jpeg' : 'image/png',
        quality: state.fmt === 'jpeg' ? state.quality / 100 : undefined,
      });
      // heic2any returns a Blob or Array<Blob> for multi-frame HEIC
      if (Array.isArray(result)) result = result[0];
      entry.outputBlob = result;
      entry.status = 'done';
    } catch (err) {
      entry.status = 'error';
      entry.error  = err.message || 'Conversion failed';
    }

    state.convDone++;
    refreshQueue();

    // Save directly to folder if one is selected
    if (entry.status === 'done' && state.outputDirHandle) {
      saveEntryToFolder(entry).catch(() => {});
    }
  }

  state.converting = false;
  refreshQueue();

  const done   = state.files.filter(f => f.status === 'done').length;
  const errors = state.files.filter(f => f.status === 'error').length;
  showToast(
    `${done} file${done !== 1 ? 's' : ''} converted${errors ? `, ${errors} failed` : ''}`,
    errors && !done ? 'error' : 'success',
  );
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD & SAVE
// ═══════════════════════════════════════════════════════════════

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadEntry(id) {
  const e = state.files.find(f => f.id === id);
  if (e?.status === 'done' && e.outputBlob) triggerDownload(e.outputBlob, e.outputName);
}

async function downloadAllAsZip() {
  const done = state.files.filter(f => f.status === 'done');
  if (!done.length) return;

  if (typeof JSZip === 'undefined') {
    // Fallback: download files one by one
    done.forEach(e => triggerDownload(e.outputBlob, e.outputName));
    return;
  }

  showToast('Building ZIP…');
  const zip = new JSZip();
  done.forEach(e => zip.file(e.outputName, e.outputBlob));
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });
  triggerDownload(blob, `heic-converted-${new Date().toISOString().slice(0, 10)}.zip`);
  showToast(`ZIP ready — ${done.length} file${done.length !== 1 ? 's' : ''}`, 'success');
}

async function selectOutputFolder() {
  if (!('showDirectoryPicker' in window)) {
    showToast('Direct folder saving requires Chrome or Edge. Files will be downloaded instead.', '');
    return;
  }
  try {
    state.outputDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    showToast(`Output folder: ${state.outputDirHandle.name}`, 'success');
    refreshOutputLocation();
  } catch (err) {
    if (err.name !== 'AbortError') showToast('Could not access folder', 'error');
  }
}

function clearOutputFolder() {
  state.outputDirHandle = null;
  refreshOutputLocation();
}

async function saveEntryToFolder(entry) {
  if (!state.outputDirHandle || entry.status !== 'done') return;
  const fh       = await state.outputDirHandle.getFileHandle(entry.outputName, { create: true });
  const writable = await fh.createWritable();
  await writable.write(entry.outputBlob);
  await writable.close();
}

async function saveAllToFolder() {
  if (!state.outputDirHandle) {
    await selectOutputFolder();
    if (!state.outputDirHandle) return;
  }
  const done = state.files.filter(f => f.status === 'done');
  if (!done.length) { showToast('No converted files to save', ''); return; }

  let saved = 0, failed = 0;
  for (const e of done) {
    try { await saveEntryToFolder(e); saved++; }
    catch { failed++; }
  }
  showToast(
    `${saved} saved to "${state.outputDirHandle.name}"${failed ? `, ${failed} failed` : ''}`,
    failed ? '' : 'success',
  );
}

// ═══════════════════════════════════════════════════════════════
// DRAG & DROP — CONVERTER
// ═══════════════════════════════════════════════════════════════

function onDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('drop-zone')?.classList.add('drag-over');
}

function onDragLeave(e) {
  e.stopPropagation();
  if (!e.currentTarget.contains(e.relatedTarget)) {
    document.getElementById('drop-zone')?.classList.remove('drag-over');
  }
}

async function onDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('drop-zone')?.classList.remove('drag-over');

  const items = e.dataTransfer?.items;
  if (items?.length) {
    const entries = Array.from(items).map(i => i.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) {
      const files = await getFilesFromEntries(entries);
      addFiles(files);
      return;
    }
  }
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
}

function onDropZoneClick(e) {
  if (state.converting) return;
  if (e.target.closest('button')) return;
  browseFiles();
}

// ═══════════════════════════════════════════════════════════════
// DRAG & DROP — METADATA INSPECTOR
// ═══════════════════════════════════════════════════════════════

function onDragOverMeta(e) {
  e.preventDefault();
  document.getElementById('meta-drop-zone')?.classList.add('drag-over');
}

function onDragLeaveMeta(e) {
  e.stopPropagation();
  if (!e.currentTarget.contains(e.relatedTarget)) {
    document.getElementById('meta-drop-zone')?.classList.remove('drag-over');
  }
}

function onDropMeta(e) {
  e.preventDefault();
  document.getElementById('meta-drop-zone')?.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadMetadata(file);
}

function onMetaDropZoneClick(e) {
  if (e.target.closest('button')) return;
  browseMetaFile();
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS HANDLERS
// ═══════════════════════════════════════════════════════════════

function setFormat(fmt) {
  state.fmt = fmt;
  document.querySelectorAll('.format-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.fmt === fmt));
  const qg = document.getElementById('quality-group');
  if (qg) qg.style.display = fmt === 'jpeg' ? '' : 'none';
  refreshNamingPreview();
  refreshQueue();
}

function setQuality(val) {
  state.quality = parseInt(val, 10);
  const el = document.getElementById('quality-val');
  if (el) el.textContent = val;
}

function setNamingMode(mode) {
  state.namingMode = mode;
  const cEl = document.getElementById('custom-naming');
  const mEl = document.getElementById('meta-naming');
  const cOpt = document.getElementById('naming-opt-custom');
  const mOpt = document.getElementById('naming-opt-meta');
  if (cEl) cEl.style.display = mode === 'custom'   ? '' : 'none';
  if (mEl) mEl.style.display = mode === 'metadata' ? '' : 'none';
  if (cOpt) cOpt.classList.toggle('selected', mode === 'custom');
  if (mOpt) mOpt.classList.toggle('selected', mode === 'metadata');
  refreshNamingPreview();
  refreshQueue();
}

function updateCustomPrefix(val) {
  state.customPrefix = val;
  refreshNamingPreview();
  refreshQueue();
}

function updateMetaTpl(val) {
  state.metaTpl = val;
  refreshNamingPreview();
  refreshQueue();
}

function insertToken(token) {
  const input = document.getElementById('meta-tpl-input');
  if (!input) return;
  const start = input.selectionStart;
  const end   = input.selectionEnd;
  input.value = input.value.slice(0, start) + token + input.value.slice(end);
  input.setSelectionRange(start + token.length, start + token.length);
  input.focus();
  updateMetaTpl(input.value);
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT LOCATION
// ═══════════════════════════════════════════════════════════════

function renderOutputLocationBody() {
  const hasApi = 'showDirectoryPicker' in window;
  const dir    = state.outputDirHandle;

  if (!hasApi) {
    return `
      <div class="alert alert-info">
        Files will be downloaded to your browser's default downloads folder.
        <strong>Chrome or Edge</strong> is required for direct folder saving.
      </div>`;
  }

  if (dir) {
    return `
      <div class="output-folder-info">
        <span style="font-size:22px">📁</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13.5px">${esc(dir.name)}</div>
          <div style="font-size:12px;color:var(--muted)">Converted files will be saved here after conversion</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="clearOutputFolder()">Change</button>
      </div>`;
  }

  return `
    <div class="output-loc-row">
      <button class="btn btn-secondary" onclick="selectOutputFolder()">📁 Select Output Folder</button>
      <span style="font-size:13px;color:var(--muted)">or files will be downloaded when you click Save</span>
    </div>`;
}

function refreshOutputLocation() {
  const el = document.getElementById('output-location-body');
  if (el) el.innerHTML = renderOutputLocationBody();
}

// ═══════════════════════════════════════════════════════════════
// QUEUE RENDER
// ═══════════════════════════════════════════════════════════════

function renderQueue() {
  const files = state.files;

  if (!files.length) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">🖼️</div>
        <div class="empty-state-title">No files queued</div>
        <div class="empty-state-body">Drop HEIC files above or use the Browse buttons.</div>
      </div>`;
  }

  const total    = files.length;
  const done     = files.filter(f => f.status === 'done').length;
  const errors   = files.filter(f => f.status === 'error').length;
  const ready    = files.filter(f => f.status === 'ready').length;
  const convting = files.filter(f => f.status === 'converting').length;

  const STATUS_ICON  = { ready: '○', converting: '⟳', done: '✓', error: '✗' };
  const STATUS_CLASS = { ready: 'ready', converting: 'converting', done: 'done', error: 'error' };

  const rows = files.map((entry, i) => {
    const outName = entry.outputName ?? computeOutputName(entry, i, total);
    const ic  = STATUS_ICON[entry.status]  ?? '○';
    const cls = STATUS_CLASS[entry.status] ?? 'ready';

    const dlBtn = entry.status === 'done'
      ? `<button class="btn btn-ghost btn-sm" onclick="downloadEntry('${entry.id}')" title="Download this file">↓</button>`
      : '';
    const rmBtn = !state.converting
      ? `<button class="btn btn-ghost btn-sm" style="color:var(--muted)" onclick="removeFile('${entry.id}')" title="Remove">×</button>`
      : '';

    return `
      <div class="file-entry">
        <div class="file-status ${cls}">${ic}</div>
        <div class="file-entry-info">
          <div class="file-entry-name">${esc(entry.file.name)}</div>
          <div class="file-entry-output">
            <span class="file-entry-arrow">→</span>${esc(outName)}
          </div>
          ${entry.error ? `<div class="file-entry-error" title="${esc(entry.error)}">⚠ ${esc(entry.error)}</div>` : ''}
        </div>
        <div class="file-entry-size">${fmtBytes(entry.file.size)}</div>
        ${dlBtn}${rmBtn}
      </div>`;
  }).join('');

  // Progress bar during conversion
  let progressBar = '';
  if (state.converting && state.convTotal > 0) {
    const pct = Math.round((state.convDone / state.convTotal) * 100);
    progressBar = `
      <div class="progress-bar-wrap">
        <div class="progress-bar" style="width:${pct}%"></div>
      </div>`;
  }

  // Stats label
  const statParts = [];
  if (done)     statParts.push(`${done} done`);
  if (errors)   statParts.push(`${errors} failed`);
  if (convting) statParts.push(`${convting} converting`);
  if (ready)    statParts.push(`${ready} ready`);
  const statsLabel = statParts.join(' · ');

  // Download buttons (right side of actions bar)
  const doneEntries = files.filter(f => f.status === 'done');
  let downloadBtns = '';
  if (!state.converting && doneEntries.length > 0) {
    if (doneEntries.length === 1) {
      downloadBtns = `
        <button class="btn btn-secondary btn-sm" onclick="downloadEntry('${doneEntries[0].id}')">↓ Save File</button>`;
    } else {
      downloadBtns = `
        <button class="btn btn-secondary btn-sm" onclick="downloadAllAsZip()">↓ Download All as ZIP</button>
        ${state.outputDirHandle ? `<button class="btn btn-secondary btn-sm" onclick="saveAllToFolder()">💾 Save All to Folder</button>` : ''}`;
    }
  }

  // Convert button label
  const readyOrError = files.filter(f => f.status === 'ready' || f.status === 'error').length;
  const convertBtnLabel = state.converting
    ? `Converting… ${state.convDone} / ${state.convTotal}`
    : readyOrError > 0
      ? `Convert ${readyOrError} File${readyOrError !== 1 ? 's' : ''}`
      : 'Convert';

  return `
    <div class="queue-header">
      <div class="flex items-center gap-2">
        <span class="section-title">${total} file${total !== 1 ? 's' : ''}</span>
        ${statsLabel ? `<span style="font-size:12px;color:var(--muted)">${esc(statsLabel)}</span>` : ''}
      </div>
      ${!state.converting ? `<button class="btn btn-ghost btn-sm" style="color:var(--muted)" onclick="clearQueue()">Clear all</button>` : ''}
    </div>
    ${progressBar}
    <div class="file-list">${rows}</div>
    <div class="convert-actions">
      <button class="btn btn-primary" id="convert-btn" onclick="startConversion()"
        ${state.converting || readyOrError === 0 ? 'disabled' : ''}>
        ${convertBtnLabel}
      </button>
      <div class="convert-actions-right">${downloadBtns}</div>
    </div>`;
}

function refreshQueue() {
  const el = document.getElementById('file-queue');
  if (el) el.innerHTML = renderQueue();
}

// ═══════════════════════════════════════════════════════════════
// FILE INPUTS
// ═══════════════════════════════════════════════════════════════

function browseFiles() {
  if (state.converting) return;
  document.getElementById('file-input')?.click();
}

function browseFolder() {
  if (state.converting) return;
  document.getElementById('folder-input')?.click();
}

function onFileInput(e) {
  if (e.target.files.length) { addFiles(e.target.files); e.target.value = ''; }
}

function onFolderInput(e) {
  if (e.target.files.length) { addFiles(e.target.files); e.target.value = ''; }
}

// ═══════════════════════════════════════════════════════════════
// METADATA INSPECTOR
// ═══════════════════════════════════════════════════════════════

function browseMetaFile() {
  const input = Object.assign(document.createElement('input'), {
    type: 'file',
    accept: '.heic,.heif,.jpg,.jpeg,.png,.tiff,.tif,.webp',
  });
  input.onchange = e => { if (e.target.files[0]) loadMetadata(e.target.files[0]); };
  input.click();
}

async function loadMetadata(file) {
  state.metaFile    = file;
  state.metaTags    = null;
  state.metaLoading = true;
  refreshMeta();

  try {
    if (typeof ExifReader === 'undefined') throw new Error('ExifReader library not loaded');
    const ab       = await file.arrayBuffer();
    state.metaTags = ExifReader.load(ab, { expanded: true });
  } catch (err) {
    state.metaTags = { _error: err.message };
  }

  state.metaLoading = false;
  refreshMeta();
}

function copyToken(token) {
  navigator.clipboard?.writeText(token)
    .then(() => showToast(`Copied: ${token}`, 'success'))
    .catch(() => showToast(`Token: ${token}`));
}

function renderMetaResults() {
  if (!state.metaFile) return '';

  if (state.metaLoading) {
    return `
      <div class="card mt-4" style="text-align:center;padding:40px">
        <div style="color:var(--muted);font-size:14px">Reading metadata…</div>
      </div>`;
  }

  const tags = state.metaTags;
  if (!tags || tags._error) {
    return `
      <div class="card mt-4">
        <div class="alert alert-warning">
          Could not read metadata: ${esc(tags?._error ?? 'Unknown error')}.
          Some files may not contain EXIF data.
        </div>
      </div>`;
  }

  // Map EXIF tag names to naming tokens for the "Use in name" column
  const TAG_TOKENS = {
    DateTimeOriginal: ['{date}', '{time}', '{datetime}', '{year}', '{month}', '{day}'],
    DateTime:         ['{date}', '{time}', '{datetime}'],
    Make:             ['{make}'],
    Model:            ['{model}'],
  };

  function renderGroup(groupName, groupTags) {
    const entries = Object.entries(groupTags).filter(([, v]) => v != null);
    if (!entries.length) return '';

    const rows = entries.map(([key, tag]) => {
      const rawDesc = typeof tag === 'object'
        ? (tag.description ?? JSON.stringify(tag.value ?? tag))
        : String(tag);
      const desc = String(rawDesc).slice(0, 200);
      const tokens = TAG_TOKENS[key];

      return `
        <div class="meta-row">
          <div class="meta-key">${esc(key)}</div>
          <div class="meta-val" title="${esc(desc)}">${esc(desc)}</div>
          <div class="meta-action">
            ${tokens
              ? tokens.map(t =>
                `<span class="token-chip" onclick="copyToken('${t}')" title="Copy ${t}">${esc(t)}</span>`
              ).join('')
              : ''}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="meta-group-title">${esc(groupName)}</div>
      ${rows}`;
  }

  // Order: exif first, then others
  const ORDER = ['exif', 'iptc', 'xmp', 'file', 'icc', 'jfif', 'Thumbnail'];
  const allGroups  = Object.keys(tags);
  const ordered    = [...ORDER.filter(k => allGroups.includes(k)),
                       ...allGroups.filter(k => !ORDER.includes(k))];
  const content    = ordered
    .map(name => typeof tags[name] === 'object' && tags[name] !== null
      ? renderGroup(name, tags[name])
      : '')
    .filter(Boolean)
    .join('');

  if (!content) {
    return `
      <div class="card mt-4">
        <div class="alert alert-info">No readable metadata found in this file.</div>
      </div>`;
  }

  return `
    <div class="card mt-4">
      <div class="section-header">
        <div class="section-title">${esc(state.metaFile.name)}</div>
        <span style="font-size:12px;color:var(--muted)">${fmtBytes(state.metaFile.size)}</span>
      </div>
      <p class="form-hint mb-4">
        Click any token chip to copy it, then paste it into the Metadata Template on the Convert page.
      </p>
      <div class="meta-table">${content}</div>
    </div>`;
}

function refreshMeta() {
  const el = document.getElementById('meta-results');
  if (el) el.innerHTML = renderMetaResults();
}

// ═══════════════════════════════════════════════════════════════
// PAGE RENDERS
// ═══════════════════════════════════════════════════════════════

function renderConverter() {
  const isJpeg = state.fmt === 'jpeg';

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Convert</div>
          <div class="page-subtitle">Convert HEIC / HEIF images to PNG or JPEG</div>
        </div>
      </div>

      <!-- ── Format & Quality ── -->
      <div class="card">
        <div class="settings-row">
          <div class="setting-group">
            <label>Output Format</label>
            <div class="format-toggle">
              <button class="format-btn${state.fmt === 'jpeg' ? ' active' : ''}" data-fmt="jpeg"
                onclick="setFormat('jpeg')">JPEG</button>
              <button class="format-btn${state.fmt === 'png' ? ' active' : ''}" data-fmt="png"
                onclick="setFormat('png')">PNG</button>
            </div>
          </div>

          <div class="setting-group" id="quality-group"${!isJpeg ? ' style="display:none"' : ''}>
            <label>JPEG Quality</label>
            <div class="quality-row">
              <input type="range" class="quality-slider" min="1" max="100" value="${state.quality}"
                oninput="setQuality(this.value)">
              <span class="quality-label"><span id="quality-val">${state.quality}</span>%</span>
            </div>
            <div class="form-hint">Lower = smaller file · Higher = better image quality</div>
          </div>
        </div>
      </div>

      <!-- ── Drop Zone ── -->
      <div class="card mt-4">
        <div id="drop-zone" class="drop-zone"
          ondragover="onDragOver(event)" ondragleave="onDragLeave(event)"
          ondrop="onDrop(event)" onclick="onDropZoneClick(event)">
          <div class="drop-zone-icon">🖼️</div>
          <div class="drop-zone-title">Drop HEIC files or a folder here</div>
          <div class="drop-zone-sub">Supports .heic and .heif — or click anywhere to browse files</div>
          <div class="flex gap-2" style="justify-content:center;margin-top:16px">
            <button class="btn btn-primary" onclick="browseFiles()">Browse Files</button>
            <button class="btn btn-secondary" onclick="browseFolder()">Browse Folder</button>
          </div>
        </div>
        <input type="file" id="file-input"   accept=".heic,.heif" multiple    style="display:none" onchange="onFileInput(event)">
        <input type="file" id="folder-input" webkitdirectory      multiple    style="display:none" onchange="onFolderInput(event)">
      </div>

      <!-- ── Naming Convention ── -->
      <div class="card mt-4">
        <div class="card-title">Naming Convention</div>
        <div class="naming-grid">

          <!-- Custom prefix -->
          <div class="naming-option${state.namingMode === 'custom' ? ' selected' : ''}"
               id="naming-opt-custom" onclick="setNamingMode('custom')">
            <div class="naming-option-header">
              <input type="radio" name="naming-mode" value="custom"
                ${state.namingMode === 'custom' ? 'checked' : ''}
                onchange="setNamingMode('custom')" onclick="event.stopPropagation()">
              Custom Prefix
            </div>
            <div id="custom-naming"${state.namingMode !== 'custom' ? ' style="display:none"' : ''}>
              <input type="text" id="custom-prefix" value="${esc(state.customPrefix)}"
                placeholder="e.g. vacation_2024" maxlength="80"
                oninput="updateCustomPrefix(this.value)"
                onclick="event.stopPropagation()">
              <div class="form-hint mt-2">Files will be named: prefix_001.jpg, prefix_002.jpg, …</div>
            </div>
          </div>

          <!-- Metadata template -->
          <div class="naming-option${state.namingMode === 'metadata' ? ' selected' : ''}"
               id="naming-opt-meta" onclick="setNamingMode('metadata')">
            <div class="naming-option-header">
              <input type="radio" name="naming-mode" value="metadata"
                ${state.namingMode === 'metadata' ? 'checked' : ''}
                onchange="setNamingMode('metadata')" onclick="event.stopPropagation()">
              Metadata Template
            </div>
            <div id="meta-naming"${state.namingMode !== 'metadata' ? ' style="display:none"' : ''}>
              <input type="text" id="meta-tpl-input" value="${esc(state.metaTpl)}"
                placeholder="{date}_{filename}"
                oninput="updateMetaTpl(this.value)"
                onclick="event.stopPropagation()">
              <div class="form-hint mt-2">Insert tokens below. Falls back to filename if metadata is missing.</div>
              <div class="token-chips">
                ${NAMING_TOKENS.map(t =>
                  `<span class="token-chip" title="${esc(t.desc)}"
                    onclick="event.stopPropagation();insertToken('${t.token}')">${esc(t.token)}</span>`
                ).join('')}
              </div>
            </div>
          </div>

        </div>

        <!-- Live preview -->
        <div class="naming-preview-row mt-4">
          Preview: <code id="naming-preview">${esc(getNamingPreview())}</code>
        </div>
      </div>

      <!-- ── Output Location ── -->
      <div class="card mt-4">
        <div class="card-title">Output Location</div>
        <div id="output-location-body">${renderOutputLocationBody()}</div>
      </div>

      <!-- ── File Queue ── -->
      <div class="card mt-4">
        <div id="file-queue">${renderQueue()}</div>
      </div>

    </div>`;
}

function renderMetadata() {
  return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Metadata Inspector</div>
          <div class="page-subtitle">Explore EXIF and other embedded data from any image file</div>
        </div>
      </div>

      <div class="card">
        <div id="meta-drop-zone" class="drop-zone"
          ondragover="onDragOverMeta(event)" ondragleave="onDragLeaveMeta(event)"
          ondrop="onDropMeta(event)" onclick="onMetaDropZoneClick(event)">
          <div class="drop-zone-icon">🔍</div>
          <div class="drop-zone-title">Drop an image file here to inspect its metadata</div>
          <div class="drop-zone-sub">HEIC, JPEG, PNG, TIFF — reads all embedded EXIF, IPTC, and XMP data</div>
          <div style="margin-top:18px">
            <button class="btn btn-primary" onclick="browseMetaFile()">Browse File</button>
          </div>
        </div>
      </div>

      <div id="meta-results">${renderMetaResults()}</div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function navigate(page, params = {}) {
  state.page   = page;
  state.params = params;

  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page));

  const main = document.getElementById('main');
  switch (page) {
    case 'converter': main.innerHTML = renderConverter(); break;
    case 'metadata':  main.innerHTML = renderMetadata();  break;
    default:          main.innerHTML = renderConverter();
  }
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════

function buildSidebar() {
  const nav = [
    { page: 'converter', icon: '🔄', label: 'Convert'            },
    { page: 'metadata',  icon: '🔍', label: 'Metadata Inspector' },
  ];

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-logo">
      <span>HEIC<span class="logo-dim"> Converter</span></span>
      <button class="help-btn" onclick="showHelpModal()" title="Help &amp; Documentation">?</button>
    </div>
    <nav class="sidebar-nav">
      ${nav.map(({ page, icon, label }) => `
        <a class="nav-item${state.page === page ? ' active' : ''}" data-page="${page}"
           onclick="navigate('${page}')">
          <span class="nav-icon">${icon}</span>${esc(label)}
        </a>`).join('')}
    </nav>
    <div class="sidebar-footer">
      <p style="font-size:11.5px;color:var(--muted);line-height:1.5;text-align:center">
        All conversion happens<br>locally in your browser.<br>No files are uploaded.
      </p>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  buildSidebar();
  navigate('converter');
});
