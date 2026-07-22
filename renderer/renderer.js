const BACKEND_URL = window.fastscribe.backendUrl;
const ALLOWED = [".mp3", ".wav", ".m4a", ".opus"];

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const selectBtn = document.getElementById("selectBtn");
const langSelect = document.getElementById("langSelect");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const list = document.getElementById("list");
const emptyEl = document.getElementById("empty");

let busy = false;

function hasAllowedExt(name) {
  const lower = name.toLowerCase();
  return ALLOWED.some((ext) => lower.endsWith(ext));
}

function setBusy(on, text) {
  busy = on;
  selectBtn.disabled = on;
  statusText.textContent = text || "Transcribing…";
  statusEl.classList.toggle("hidden", !on);
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

function prependCard({ filename, transcript, isError, language }) {
  emptyEl.classList.add("hidden");

  const li = document.createElement("li");
  li.className = "card" + (isError ? " error" : "");

  const head = document.createElement("div");
  head.className = "card-head";

  const name = document.createElement("span");
  name.className = "card-name";
  name.textContent = filename;

  const meta = document.createElement("span");
  meta.className = "card-date";
  meta.textContent = language
    ? `${language.toUpperCase()} · ${formatDate(new Date())}`
    : formatDate(new Date());

  head.appendChild(name);
  head.appendChild(meta);

  const text = document.createElement("p");
  text.className = "card-text";
  text.textContent = transcript;

  li.appendChild(head);
  li.appendChild(text);
  list.prepend(li);
}

async function transcribe(file) {
  if (busy) return;

  if (!hasAllowedExt(file.name)) {
    prependCard({
      filename: file.name,
      transcript: "Unsupported file type. Use .mp3, .wav, .m4a, or .opus.",
      isError: true,
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
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err && err.detail) detail = err.detail;
      } catch (_) {}
      throw new Error(detail);
    }

    const data = await res.json();
    prependCard({
      filename: data.filename || file.name,
      transcript: data.transcript || "(no speech detected)",
      language: data.language,
      isError: false,
    });
  } catch (err) {
    prependCard({
      filename: file.name,
      transcript: `Failed: ${err.message}`,
      isError: true,
    });
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
