# Chord Recognition: Model & Workflow

This document explains, in full technical detail, how Chordarium Chorder turns a
YouTube link into a synced chord timeline: which model does the actual chord
recognition, how it was trained, what its input/output looks like, and every
processing stage before and after it. It reflects the code as it stands in
`server/engine/` and `server/theory/chord.py`.

## TL;DR

Chordarium Chorder runs **two interchangeable chord-recognition engines** and always
has one active per analysis:

| | Primary: **BTC** | Fallback: **144-template matcher** |
|---|---|---|
| What it is | A pretrained deep learning model (bi-directional Transformer) | A classical signal-processing method, no learning, no weights file |
| Vocabulary | 168 chords (12 roots × 14 qualities) + "no chord" | 144 chords (12 roots × 12 qualities) + "no chord" |
| Used when | Its weights file is present (default, after running `scripts/setup_models.py`) | BTC weights are missing, or the caller explicitly asks for `engine="template"` |
| Accuracy | State-of-the-art for its era (ISMIR 2019); handles 7ths, sixths, sus, dim/aug, min-maj7 | A transparent, always-available baseline; coarser vocabulary, less nuanced quality detection |

Everything downstream of chord recognition — inversions, key, beat-snapping,
theory/notation, export — is identical regardless of which engine produced
the raw chord segments.

## 1. The primary model: BTC (Bi-Directional Transformer for Chord Recognition)

**Source:** [`jayg996/BTC-ISMIR19`](https://github.com/jayg996/BTC-ISMIR19)
— the reference implementation released alongside Park et al.'s ISMIR 2019
paper. Chordarium Chorder doesn't reimplement or retrain this model; it clones the
repository (code + a pretrained checkpoint) and calls into it directly.
`server/engine/chords_btc.py` is a thin wrapper around it.

### 1.1 Getting the model

`scripts/setup_models.py` does a shallow (`--depth 1`) git clone of the BTC
repo into `server/engine/weights/BTC-ISMIR19/`. The pretrained weights file
that ships in that repo is `test/btc_model_large_voca.pt` — this is the
**large-vocabulary** checkpoint (as opposed to the smaller "majmin"-only
checkpoint the same repo also includes, which Chordarium Chorder never uses).
`is_available()` just checks that file exists; if it doesn't, every analysis
silently falls back to the template matcher instead of failing.

### 1.2 Architecture

The model itself (`btc_model.py` inside the cloned repo, loaded dynamically
via `sys.path` injection — see `_load()`) is a **Transformer encoder** applied
to a sequence of audio-feature frames, followed by a linear classification
head:

- **Input representation:** a Constant-Q Transform (CQT) of the audio,
  log-magnitude, then per-feature-dimension normalized using the `mean`/`std`
  vectors baked into the checkpoint at training time (not recomputed per
  song). The exact CQT parameters (`n_bins`, `bins_per_octave`, `hop_length`)
  and the audio sample rate the model expects (`song_hz`) come from
  `run_config.yaml`, shipped in the cloned repo — Chordarium Chorder doesn't hardcode
  them, it reads them from that config so it always matches whatever
  checkpoint is present.
- **Sequence model:** `model.self_attn_layers` — a stack of self-attention
  (Transformer) blocks. Unlike a recurrent model, it can attend across the
  whole input window at once, which is the "bi-directional" part of the
  name: a frame's predicted chord can be informed by audio both before and
  after it, not just what came earlier.
- **Chunking:** long songs are split into `timestep`-frame chunks (from the
  same config) before being fed through the attention layers one chunk at a
  time, then the per-chunk outputs are concatenated back into one sequence
  the length of the song. This is a memory/compute constraint of running a
  fixed-context Transformer over an arbitrarily long recording, not a
  windowing choice Chordarium Chorder invented.
- **Output head:** `model.output_layer.output_projection` — a linear
  projection from the attention layer's hidden size to `num_chords = 170`
  logits per frame, followed by softmax (done in Chordarium Chorder's wrapper, not
  inside the model) to get a probability distribution over all 170 classes
  for every frame.

Chordarium Chorder always forces `cfg["feature"]["large_voca"] = True` and
`cfg["model"]["num_chords"] = 170` before construction, so it's always using
the large-vocabulary architecture even if a config file said otherwise.

### 1.3 The 170-class vocabulary

The checkpoint's 170 output classes are laid out as:

- **Classes 0–167:** 12 chromatic roots (`C, C#, D, D#, E, F, F#, G, G#, A,
  A#, B`, i.e. `SHARPS` in the code) × **14 chord qualities**:

  ```
  min, maj, dim, aug, min6, maj6, min7, minmaj7, maj7, 7, dim7, hdim7, sus2, sus4
  ```

  (`BTC_QUALITIES` in `chords_btc.py`). Index `i` maps to root `i // 14`,
  quality `i % 14`.
- **Classes 168–169:** collapsed by Chordarium Chorder's own `idx_to_label` into a
  single `"N"` (no chord) — the underlying checkpoint actually distinguishes
  "X" (chord present but unclassifiable) from "N" (silence/no harmony), but
  Chordarium Chorder treats both the same way downstream, since the UI's "no chord"
  handling doesn't need the distinction.

This gives every recognized chord a **Harte-notation label** like `C:min7`,
`A:maj7`, `G:sus4` — the same notation `server/theory/chord.py` parses,
transposes, and renders everywhere else in the app.

### 1.4 Inference, end to end

`chords_btc.recognize(wav_path, weights_dir)`:

1. Load the harmonic-content audio (see §3 for *which* audio this is) at the
   model's expected sample rate.
2. Compute its CQT with the checkpoint's exact `n_bins` /
   `bins_per_octave` / `hop_length`, take `log(|CQT| + 1e-6)`, transpose to
   `(frames, bins)`, then normalize with the checkpoint's `mean`/`std`.
3. Zero-pad the frame axis up to a multiple of `timestep` so every chunk is
   full-length.
4. Run each `timestep`-frame chunk through `self_attn_layers` →
   `output_projection` → `softmax`, under `torch.no_grad()` (inference only,
   no gradient tracking).
5. Concatenate all chunks' softmax outputs back into one
   `(total_frames, 170)` probability matrix, trimmed to the real (unpadded)
   frame count.
6. `frames_to_segments()`: take the `argmax` class per frame, then merge
   consecutive frames sharing the same argmax into one segment. Each
   segment's `confidence` is the *mean* probability of the winning class
   across its frames (not just the last frame's), and its `alt` field is the
   next-most-likely *distinct* chord label (by mean probability), skipping
   the winning label and "N" — this is what feeds the Chord Editor's
   "suggestions" list in the UI.
7. `merge_identical()` (shared with the template engine, see `snap.py`) then
   collapses any immediately-adjacent segments that ended up with the exact
   same label — a cleanup pass, not part of the model itself.

The model runs on CPU by default (`device="cpu"` parameter, unused by the
current call sites, but supported by the wrapper) — Chordarium Chorder doesn't
require a GPU for chord recognition; only Demucs stem separation (§2) has
GPU-acceleration logic.

**Caching:** `_load()` caches the loaded model, config, and normalization
stats keyed by `(weights_dir, device)` in a module-level dict, so repeated
analyses in the same process only pay the model-loading cost once.

### 1.5 The 144-template fallback (`chords_tmpl.py`)

When BTC's weights aren't installed, `chords_tmpl.recognize()` runs instead —
a much simpler, dependency-free method with no learned parameters:

1. **Templates:** for each of 12 roots × 12 qualities (`maj, min, 7, maj7,
   min7, dim, dim7, hdim7, aug, sus2, sus4, min6` — a 12-quality subset of
   the same interval definitions in `theory/chord.py`), build a 12-dimensional
   binary chroma vector marking which pitch classes belong to that chord,
   with the root weighted `1.5×` (`ROOT_WEIGHT`) before L2-normalizing —
   biasing the match toward getting the root right even when the quality is
   ambiguous.
2. **Audio features:** a CQT-based chroma (`librosa.feature.chroma_cqt`),
   computed twice — once from `C3` upward (`TREBLE_FMIN`) over 5 octaves for
   general harmonic content, and once from `C1` upward (`BASS_FMIN`) over 2
   octaves, blended in at 30% weight (`BASS_MIX`) — a low-register nudge that
   helps disambiguate chords sharing the same treble pitch classes, without
   letting the bass register dominate (that would risk misreading, e.g., a
   `G/B` slash chord's held bass note as making the chord itself `B`-rooted).
3. **Scoring:** cosine-similarity (`templates @ normalized_chroma`) between
   every template and every audio frame.
4. **Smoothing:** a hand-written Viterbi decoder (`viterbi()`) finds the most
   likely *sequence* of chords, not just the best chord per frame in
   isolation — it heavily favors staying on the same chord frame-to-frame
   (`P_STAY = 0.95`) over switching, with switches to any other chord treated
   as equally likely amongst themselves. `BETA = 20.0` sharpens the raw
   cosine similarities into more confident log-likelihoods before decoding
   (without it, near-tied similarity scores would make the Viterbi path
   erratic).
5. **Silence:** frames whose RMS energy falls under `2%` of the loudest frame
   in the song (`SILENCE_RATIO`) are forced to `"N"` regardless of what the
   templates say — a quiet intro or outro shouldn't be assigned a confident,
   probably-wrong chord guess.
6. Segments are built the same way as BTC's (group consecutive identical
   labels; `alt` is the next-best *different* template by mean score).

The template engine's 12-quality vocabulary is a subset of BTC's 14 (it's
missing `minmaj7`; everything else lines up), so its output is always a
valid Harte label the rest of the app understands — the app's `Timeline`
JSON always carries `engine: {"chords": "btc-large" | "template", ...}` so
the client can show a "using the simpler recognizer" warning banner when the
template engine had to be used.

## 2. Source separation (Demucs) — "Accurate" mode only

Before chord recognition, **Accurate mode** runs
[Demucs](https://github.com/facebookresearch/demucs) (`htdemucs` model) as a
subprocess (`python -m demucs -n htdemucs ...`) to split the mix into
`bass`, `drums`, `other`, `vocals` stems. Chordarium Chorder then discards `vocals`
and `drums` and re-mixes `bass + other` as the "harmonic" signal chord
recognition actually sees — vocals and drums carry no chord information and
can only distract both the BTC model and the template matcher, especially on
songs with prominent vocal harmonies or busy drum fills. The `bass` stem
alone is kept separately for inversion detection (§4).

Demucs prefers GPU (`pick_device()`: uses CUDA only if a device is available
*and* has at least 2 GB free — `MIN_GPU_BYTES`), automatically falling back
to CPU, and even retries on CPU mid-run if a CUDA out-of-memory error occurs.

**Fast mode** skips this entirely: the full, unseparated mix is used
directly as both the "harmonic" and "bass" signal. This is why Fast mode is
so much quicker (~30s vs. minutes) but noisier on songs with heavy drums or
vocals that mask the actual harmony.

## 3. Beat & downbeat detection (`beat_this`)

`beats.detect_beats()` calls
[`beat_this`](https://github.com/CPJKU/beat_this) (CPJKU), another pretrained
deep learning model (`File2Beats`, checkpoint `"final0"`, DBN post-processing
disabled — `dbn=False`), which returns beat and downbeat timestamps directly
from the *original* (non-separated) WAV, independent of which mode
(Fast/Accurate) was used for chord recognition. Tempo is derived as
`60 / median(inter-beat interval)`, using the median rather than the mean so
one anomalously long/short beat gap doesn't skew the reported BPM. If the
model ever returns fewer than 2 downbeats, Chordarium Chorder synthesizes them by
taking every 4th detected beat as a fallback bar boundary.

This runs **before** chord recognition in the pipeline and its beat grid is
used afterward to snap chord-segment boundaries onto beats (§5) — chord
recognition and beat detection are two independent models whose outputs are
reconciled downstream, not a single joint model.

## 4. Bass note & inversion detection (`bass.py`)

Neither chord-recognition engine determines *inversions* (slash chords) —
that's a separate step, run identically after either engine finishes:

1. Compute a CQT restricted to `C1`–`B3` (`BASS_OCTAVES = 3`) on the
   dedicated bass-register signal (the Demucs `bass` stem in Accurate mode,
   or the raw mix in Fast mode).
2. For each chord segment, sum that CQT's energy across octaves within the
   segment's time range, collapse to 12 pitch classes, and take the loudest
   one as the bass note — unless the segment's total bass energy is under
   5% (`MIN_ENERGY_RATIO`) of the song's loudest frame, in which case no bass
   note is reported (silence/noise floor).
3. **A slash is only added if that bass pitch class is (a) a real chord tone
   of the recognized chord and (b) not already the root** — this guards
   against, e.g., a passing bass note during a chord turning `Am` into a
   spurious `Am/E` when `E` isn't actually a sustained inversion, and against
   ever inventing a bass note that isn't in the chord at all (which the
   theory layer wouldn't have a slash-degree name for anyway).

## 5. Key estimation (`key.py`)

A whole-song average chroma (CQT-based, `hop_length=2048`) is correlated
against the classic **Krumhansl-Schmuckler** major/minor key profiles — fixed
12-value templates encoding how strongly each scale degree "belongs" to a
major or minor key, empirically derived from listener judgments in music
cognition research, not learned from this app's data. All 24 candidate keys
(12 roots × major/minor) are tried; the one with the highest Pearson
correlation to the song's actual chroma wins. This key is used purely for
*display and notation* — choosing sharp vs. flat spelling, degree names in
the Chord Editor — and never feeds back into chord recognition itself.

## 6. Beat-snapping & cleanup (`snap.py`)

Raw chord segments (from either engine) rarely land exactly on beat
boundaries. `snap_segments()`:

1. Snaps each segment's start time to the *nearest* detected beat.
2. Ensures snapped boundaries stay monotonically increasing (a snap can
   never move a boundary earlier than the previous one).
3. Drops any segment that snapping collapsed to zero (or negative) length.
4. `_merge_short()`: repeatedly finds the shortest remaining segment; if it's
   under one beat's median length, merges it into whichever neighbor has
   *higher confidence* (favoring the more-trusted reading rather than
   arbitrarily always picking the left or right neighbor) rather than
   leaving it as its own vanishingly-short segment.
5. `merge_identical()` runs again at the end, energy-weighting confidence by
   segment duration when two adjacent same-label segments merge.

This whole stage is purely geometric/statistical — it never re-examines the
audio, only the segment boundaries and confidences already produced.

## 7. Chord theory & notation (`server/theory/chord.py`)

Not a model at all — a deterministic music-theory engine every stage above
and the client both depend on:

- **Harte parsing/formatting**: `C:min7`, `A#:maj/3` ↔ a `Chord(root,
  quality, bass)` value, with 14 known qualities (a superset covering both
  engines' vocabularies).
- **Letter-correct spelling**: `spell()`/`root_name_in_key()` pick the
  letter name (not just enharmonic pitch class) that makes sense in context
  — e.g. rendering a diminished 5th above `Cb` correctly rather than
  defaulting to sharps everywhere — falling back to a plain sharp/flat
  choice for awkward cases like `E#`/`B#`/`Cb`/`Fb`.
- **Transpose, capo, simplify**: pure pitch-class arithmetic; "simplify"
  maps every quality down to a bare `maj`/`min`/`dim`/`aug` triad and drops
  any slash.
- **MIDI mapping** (`midi_notes()`): used only by the MIDI exporter, one
  octave-2 bass note plus the chord tones around middle C.

The client ships a hand-kept **TypeScript port** of this exact module
(`client/src/theory/chord.ts`) so the browser can transpose/re-spell chords
live during playback without a server round-trip; the two are kept in sync
by hand, not generated from one source.

## 8. Full pipeline, in order (`server/engine/pipeline.py`)

```
POST /api/analyze {url, mode}
        │
        ▼
 parse_video_id()              — reject non-YouTube / malformed URLs
        │
        ▼
 ingest.probe()                — yt-dlp metadata only: title, duration,
        │                         live-stream check, 15-min cap (MAX_DURATION)
        ▼
 ingest.download_wav()         — yt-dlp best audio → ffmpeg → mono 22.05 kHz WAV
        │                         (SAMPLE_RATE)
        ▼
 [Accurate mode only]
 separate.separate()           — Demucs htdemucs subprocess → 4 stems
        │                         harmonic = bass+other; bass_y = bass stem alone
        ▼
 beats.detect_beats()          — beat_this on the ORIGINAL (unseparated) WAV
        │                         → beats[], downbeats[], tempo
        ▼
 chords_btc.recognize()        — if BTC weights present (default)
   or chords_tmpl.recognize()  — otherwise, or if engine="template" forced
        │                         → raw chord segments (label, alt, confidence)
        ▼
 snap.snap_segments()          — snap segment boundaries to the beat grid,
        │                         merge sub-beat slivers by confidence
        ▼
 bass.apply_inversions()       — bass-register CQT per segment → slash chords
        │
        ▼
 snap.merge_identical()        — final adjacent-duplicate cleanup
        │
        ▼
 key.estimate_key()            — Krumhansl-Schmuckler over the harmonic signal
        │
        ▼
 Timeline JSON                 — {video_id, title, duration, key, tempo,
                                   time_signature, beats, downbeats, segments,
                                   engine: {chords, separated, version},
                                   warnings}
```

Progress is reported at each stage (`downloading 5% → separating 15% →
beats 45% → chords 60% → bass 80% → key 92% → done 100%`), which is exactly
what `GET /api/jobs/<id>` exposes to the client for the analyzing-page
progress bar.

## 9. How this runs as a service

- **`server/app.py`** (the Flask web process) only ever *enqueues* a job
  (`Store.create_job`) and reads state back — it never imports the pipeline
  or touches audio at all, by design (kept deliberately light so heavy
  ML/CPU work never blocks HTTP request handling).
- **`server/worker.py`** is a separate, standalone process that polls
  Postgres (`Store.claim_next_job`, using `FOR UPDATE SKIP LOCKED` so
  multiple worker instances could run without ever double-processing the
  same job) and, on finding a queued job, runs exactly the `pipeline.analyze`
  sequence described above, writing progress back to the same `jobs` row the
  API reads.
- Both processes share one Postgres database (`songs`, `jobs` tables); no
  in-memory state is shared between them — the database *is* the interface.

## 10. Known limitations

- **BTC's 170-class checkpoint has no dedicated `add9`, `11th`, `13th`, or
  altered-dominant classes** — anything outside its 14 qualities gets mapped
  to the nearest quality it does know (commonly heard as the plain
  dominant-7 or major/minor triad substituting for a richer jazz voicing).
- **Fast mode's chord recognition sees vocals and drums** as part of the same
  signal as the harmony; busy arrangements can degrade both engines'
  accuracy. Accurate mode's Demucs separation exists specifically to address
  this, at a real time cost.
- **The template matcher has no learned representation of timbre or voicing**
  — it can only ever be as good as raw chroma similarity allows, which is why
  it is explicitly framed in the UI as a fallback, not a peer to BTC.
- **Key estimation is global, not local** — a song that changes key partway
  through is reported as whichever single key correlates best over the whole
  track, which can bias enharmonic spelling in the second half.
