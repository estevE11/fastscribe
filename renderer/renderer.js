const BACKEND_URL = window.fastscribe.backendUrl;
const ALLOWED = [".mp3", ".wav", ".m4a", ".opus"];

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const selectBtn = document.getElementById("selectBtn");
const langSelect = document.getElementById("langSelect");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusPct = document.getElementById("statusPct");
const progressWrap = document.querySelector(".progress");
const progressBar = document.getElementById("progressBar");
const list = document.getElementById("list");
const emptyEl = document.getElementById("empty");

const STORE_KEY = "fastscribe.transcriptions";

let busy = false;
// Persisted transcriptions, newest first.
let items = loadItems();

function loadItems() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    return [];
  }
}

function saveItems() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch (_) {}
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());
}

function updateEmpty() {
  emptyEl.classList.toggle("hidden", list.children.length > 0);
}

function hasAllowedExt(name) {
  const lower = name.toLowerCase();
  return ALLOWED.some((ext) => lower.endsWith(ext));
}

function setBusy(on, text) {
  busy = on;
  selectBtn.disabled = on;
  statusText.textContent = text || "Transcribing…";
  statusEl.classList.toggle("hidden", !on);
  if (on) setIndeterminate();
}

// Bar bounces until we get a real percentage (model warm-up / feature extraction).
function setIndeterminate() {
  progressWrap.classList.add("indeterminate");
  progressBar.style.width = "";
  statusPct.textContent = "";
}

function setProgress(fraction) {
  progressWrap.classList.remove("indeterminate");
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  progressBar.style.width = `${pct}%`;
  statusPct.textContent = `${Math.round(pct)}%`;
}

function formatDate(d) {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Builds a card DOM node from an item. `persist` false = ephemeral error card.
function renderCard(item, { expanded = false, persist = true } = {}) {
  const li = document.createElement("li");
  li.className = "card" + (item.isError ? " error" : "");
  if (!expanded) li.classList.add("collapsed");

  const head = document.createElement("div");
  head.className = "card-head";

  const chevron = document.createElement("span");
  chevron.className = "card-chevron";
  chevron.textContent = "▸";

  // Editable title.
  const title = document.createElement("input");
  title.className = "card-name";
  title.type = "text";
  title.value = item.title;
  title.title = "Click to rename";
  title.addEventListener("click", (e) => e.stopPropagation());
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });
  title.addEventListener("input", () => {
    item.title = title.value;
    if (persist) saveItems();
  });

  const meta = document.createElement("span");
  meta.className = "card-date";
  const when = item.date ? new Date(item.date) : new Date();
  meta.textContent = item.language
    ? `${item.language.toUpperCase()} · ${formatDate(when)}`
    : formatDate(when);

  const del = document.createElement("button");
  del.className = "card-delete";
  del.textContent = "×";
  del.title = "Delete";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    if (persist) {
      const i = items.findIndex((x) => x.id === item.id);
      if (i !== -1) items.splice(i, 1);
      saveItems();
    }
    li.remove();
    updateEmpty();
  });

  head.appendChild(chevron);
  head.appendChild(title);
  head.appendChild(meta);
  head.appendChild(del);

  const text = document.createElement("p");
  text.className = "card-text";
  text.textContent = item.transcript;

  // Toggle collapse when the header (outside the inputs) is clicked.
  head.addEventListener("click", () => li.classList.toggle("collapsed"));

  li.appendChild(head);
  li.appendChild(text);
  return li;
}

// Persist a successful transcription and show it expanded at the top.
function addItem({ filename, transcript, language }) {
  const item = {
    id: newId(),
    title: filename,
    transcript,
    language,
    date: new Date().toISOString(),
  };
  items.unshift(item);
  saveItems();

  // Collapse existing cards so only the new one is expanded.
  list.querySelectorAll(".card").forEach((c) => c.classList.add("collapsed"));
  list.prepend(renderCard(item, { expanded: true }));
  updateEmpty();
}

// Show a non-persisted error card at the top.
function showError({ filename, message }) {
  list.querySelectorAll(".card").forEach((c) => c.classList.add("collapsed"));
  const item = { id: newId(), title: filename, transcript: message, isError: true };
  list.prepend(renderCard(item, { expanded: true, persist: false }));
  updateEmpty();
}

// Restore persisted transcriptions on startup (all collapsed, newest on top).
function restore() {
  for (const item of items) {
    list.appendChild(renderCard(item, { expanded: false }));
  }
  updateEmpty();
}

// Reads the NDJSON progress stream, updating the bar. Returns the "done" event.
async function readStream(res, filename) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = null;

  const handle = (line) => {
    if (!line.trim()) return;
    const evt = JSON.parse(line);
    if (evt.type === "progress") {
      setProgress(evt.progress);
      statusText.textContent = `Transcribing ${filename}…`;
    } else if (evt.type === "done") {
      setProgress(1);
      done = evt;
    } else if (evt.type === "error") {
      throw new Error(evt.detail || "Transcription failed");
    }
  };

  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  handle(buffer); // flush any trailing line
  return done;
}

async function transcribe(file) {
  if (busy) return;

  if (!hasAllowedExt(file.name)) {
    showError({
      filename: file.name,
      message: "Unsupported file type. Use .mp3, .wav, .m4a, or .opus.",
    });
    return;
  }

  setBusy(true, `Transcribing ${file.name}…`);

  try {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("language", langSelect ? langSelect.value : "auto");

    const res = await fetch(`${BACKEND_URL}/transcribe`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      // Validation errors come back as a normal JSON body.
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err && err.detail) detail = err.detail;
      } catch (_) {}
      throw new Error(detail);
    }

    // Consume the newline-delimited JSON progress stream.
    const done = await readStream(res, file.name);
    if (done) {
      addItem({
        filename: done.filename || file.name,
        transcript: done.transcript || "(no speech detected)",
        language: done.language,
      });
    }
  } catch (err) {
    showError({ filename: file.name, message: `Failed: ${err.message}` });
  } finally {
    setBusy(false);
  }
}

selectBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) transcribe(fileInput.files[0]);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);

["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);

dropzone.addEventListener("drop", (e) => {
  const files = e.dataTransfer.files;
  if (files && files.length) transcribe(files[0]);
});

// Load previously saved transcriptions.
restore();
