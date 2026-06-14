// Offline audio clips, stored in IndexedDB and played back instead of the Web
// Speech voice when present. Lets a device with no Farsi (etc.) TTS voice still
// hear pronunciations: generate clips on a Mac (tools/audio/gen-audio.mjs), zip
// them, and import the zip here.
//
// Clips are keyed by `${lang}::${entryKey}` — the card's intrinsic identity, so
// playback looks them up without caring which deck view you're in.

const DB_NAME = "jp-study-audio";
const STORE = "clips";
const SEP = "::";

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}
function asPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function clipKey(lang, entryKey) {
  return `${lang}${SEP}${entryKey}`;
}

export async function getClip(key) {
  try {
    const store = await tx("readonly");
    return (await asPromise(store.get(key))) || null;
  } catch {
    return null;
  }
}

export async function putClip(key, blob) {
  const store = await tx("readwrite");
  return asPromise(store.put(blob, key));
}

// Count clips for a language (keys prefixed `${lang}::`).
export async function countClips(lang) {
  try {
    const store = await tx("readonly");
    const keys = await asPromise(store.getAllKeys());
    const prefix = `${lang}${SEP}`;
    return keys.filter((k) => String(k).startsWith(prefix)).length;
  } catch {
    return 0;
  }
}

export async function clearClips(lang) {
  const store = await tx("readwrite");
  const keys = await asPromise(store.getAllKeys());
  const prefix = `${lang}${SEP}`;
  let removed = 0;
  for (const k of keys) {
    if (String(k).startsWith(prefix)) { await asPromise(store.delete(k)); removed++; }
  }
  return removed;
}

// Ask the browser to keep this storage from being evicted (best-effort).
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}

// --- Minimal ZIP reader (no dependencies) ----------------------------------
// Parses the central directory and inflates deflated entries with the built-in
// DecompressionStream. Audio in a zip is usually "stored" (method 0) since it's
// already compressed, so most entries are a straight byte-slice.
async function inflateRaw(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEocd(view) {
  // EOCD signature 0x06054b50, within the last ~64KB (no zip comment in ours).
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

// unzip(arrayBuffer) → [{ name, blob }] for every file entry (dirs skipped).
export async function unzip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true); // central directory offset
  const out = [];
  for (let i = 0; i < total; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break; // central dir header
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue; // directory entry
    // Local header: data starts after its own name+extra fields.
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? comp : await inflateRaw(comp);
    out.push({ name, blob: new Blob([data], { type: "audio/mp4" }) });
  }
  return out;
}
