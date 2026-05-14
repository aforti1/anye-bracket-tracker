// lib/picks-blob.ts
//
// Reads bracket picks from a packed binary file in Vercel Blob storage.
// Each gender has one file: 63 little-endian uint16 values per bracket,
// indexed by Supabase `id` (1-based). Record N lives at byte offset (N-1)*126.
//
// Two access modes:
//   getPicksForId(id, gender) — single bracket, uses HTTP Range request.
//   getPicksScanner(gender)   — full scan, loads & caches the whole 126 MB
//                                file in module-level memory.
//
// Cold-start tradeoff for the scan path: the first invocation after a
// function instance goes cold pays a ~1–3 second download for 126 MB.
// Subsequent invocations on the same warm instance are free. Vercel
// serverless functions hold module state across invocations until the
// instance is recycled (typically minutes of idle time).

export type Gender = "mens" | "womens";

const RECORD_SIZE = 63 * 2; // 126 bytes per bracket: 63 uint16 LE picks

function blobUrlFor(gender: Gender): string {
  const url = gender === "mens"
    ? process.env.PICKS_BLOB_URL_MENS
    : process.env.PICKS_BLOB_URL_WOMENS;
  if (!url) {
    throw new Error(
      `Missing env var PICKS_BLOB_URL_${gender === "mens" ? "MENS" : "WOMENS"}`
    );
  }
  return url;
}

// Decode a 126-byte chunk into 63 numbers.
function decodeRecord(buf: ArrayBuffer, byteOffset = 0): number[] {
  const view = new DataView(buf, byteOffset, RECORD_SIZE);
  const picks = new Array<number>(63);
  for (let i = 0; i < 63; i++) {
    picks[i] = view.getUint16(i * 2, /* littleEndian */ true);
  }
  return picks;
}

// ── Single-bracket lookup via HTTP Range ────────────────────────────────
export async function getPicksForId(id: number, gender: Gender): Promise<number[]> {
  const url = blobUrlFor(gender);
  const start = (id - 1) * RECORD_SIZE;
  const end = start + RECORD_SIZE - 1;
  const res = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    cache: "no-store",
  });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`picks-blob: id=${id} gender=${gender} status=${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== RECORD_SIZE) {
    throw new Error(
      `picks-blob: id=${id} gender=${gender} got ${buf.byteLength} bytes, expected ${RECORD_SIZE}`
    );
  }
  return decodeRecord(buf);
}

// ── Whole-file cache for filter scans ───────────────────────────────────
// One Buffer per gender, lazily populated. Module-scoped so it survives
// across warm invocations in a serverless container.
type Cache = { buffer: Uint8Array; recordCount: number };
const cache: Record<Gender, Cache | null> = { mens: null, womens: null };
const inflight: Record<Gender, Promise<Cache> | null> = { mens: null, womens: null };

async function loadFullBlob(gender: Gender): Promise<Cache> {
  if (cache[gender]) return cache[gender]!;
  if (inflight[gender]) return inflight[gender]!;

  const url = blobUrlFor(gender);
  const start = Date.now();
  inflight[gender] = (async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`picks-blob: full fetch failed status=${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength % RECORD_SIZE !== 0) {
      throw new Error(
        `picks-blob: file size ${buf.byteLength} is not a multiple of ${RECORD_SIZE}`
      );
    }
    const c: Cache = { buffer: buf, recordCount: buf.byteLength / RECORD_SIZE };
    cache[gender] = c;
    inflight[gender] = null;
    console.log(
      `picks-blob: loaded ${gender} (${buf.byteLength} bytes, ${c.recordCount} records) in ${Date.now() - start}ms`
    );
    return c;
  })();
  return inflight[gender]!;
}

// Returns a function that, given an id (1-based), returns the picks for that
// bracket as a number[] without copying — the array is decoded on demand.
// The underlying buffer is shared across all callers.
export async function getPicksScanner(gender: Gender): Promise<{
  recordCount: number;
  picksAt: (id: number) => number[];
  // Read a single uint16 pick without allocating an array (hot loop helper).
  pickAt: (id: number, gameIdx: number) => number;
}> {
  const c = await loadFullBlob(gender);
  const view = new DataView(c.buffer.buffer, c.buffer.byteOffset, c.buffer.byteLength);
  return {
    recordCount: c.recordCount,
    picksAt: (id: number) => {
      const offset = (id - 1) * RECORD_SIZE;
      const out = new Array<number>(63);
      for (let i = 0; i < 63; i++) out[i] = view.getUint16(offset + i * 2, true);
      return out;
    },
    pickAt: (id: number, gameIdx: number) => {
      return view.getUint16((id - 1) * RECORD_SIZE + gameIdx * 2, true);
    },
  };
}

// Diagnostic — useful for parity tests and debug routes.
export function isBlobConfigured(gender: Gender): boolean {
  const k = gender === "mens" ? "PICKS_BLOB_URL_MENS" : "PICKS_BLOB_URL_WOMENS";
  return !!process.env[k];
}
