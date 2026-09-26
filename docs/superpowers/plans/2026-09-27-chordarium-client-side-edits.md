# Client-Side Chord Edits + Library Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared song library immutable on the server and move chord-label
corrections entirely into the browser (`localStorage`), so a hosted, shared
Chordarium can't have one visitor's edit overwrite what everyone else sees —
without touching the analysis engine, theory, or export renderers.

**Architecture:** Remove the two server routes that mutate a song's stored
timeline (`PUT .../segments/<idx>`, `POST .../reset`) and the `store.py` code
behind them. Add a client-side `useChordOverrides` hook that layers label
corrections from `localStorage` on top of the canonical timeline fetched from
the server — the same pattern `useViewSettings` already uses for
transpose/capo/simplify. Because exports currently read the *stored* (i.e.
previously server-edited) timeline via a plain `GET` link, switch the export
endpoint to a `POST` that renders whatever timeline the client sends, and
switch the client's download from an `<a href>` link to a `fetch` + blob
download so it can carry the merged (canonical + local-edit) timeline.

**Tech Stack:** Flask (Python 3.12), pytest; React + TypeScript + Vite,
Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-27-chordarium-hosted-platform-design.md](../specs/2026-09-27-chordarium-hosted-platform-design.md)
(§4 "Edits become client-side only", §6 "Frontend"). This plan covers the
part of that spec that needs no hosting/infra change and can ship today; the
Postgres/worker/Render migration (§3, §5) is a separate follow-up plan.

## Global Constraints

- Chord label parsing/validation must stay in sync between server
  (`server/theory/chord.py`) and client (`client/src/theory/chord.ts`) — this
  plan reuses the existing client port rather than adding new parsing logic.
- No new npm or pip dependencies.
- `pytest` (fast tests only, per `pytest.ini`'s `-m "not slow"` default) and
  `npm test` must both pass after every task.
- Existing export formats, filenames, and mimetypes (ChordPro `.cho`, TXT,
  JSON, PDF, MIDI `.mid`) are unchanged — only *where the timeline comes from*
  changes, not the rendering.

## Review Focus

- Typing an unparseable chord label (e.g. `H:maj`) in the Chord Editor must
  show a clear inline error and leave segments unchanged, not crash or
  silently no-op — tested in Tasks 3 and 4.
- The very first time a song is opened (no local overrides saved yet), it
  must render exactly the canonical, unedited timeline — tested in Task 3.
- Exporting must reflect the edits and view settings active *at the moment
  of download*, not the pristine server copy — tested in Task 6.
- The removed `PUT .../segments/<idx>` and `POST .../reset` routes must
  return 404, not silently succeed, so nothing can still mutate the shared
  library through them — tested in Task 1.
- A malformed or missing `timeline` in the export request body must be
  rejected with 400, not crash the exporter with a 500 — tested in Task 2.

---

### Task 1: Remove server-side chord-edit persistence

**Files:**
- Modify: `server/store.py:1-155` (remove `original_json` column, `save_song`'s
  duplicate write of it, `update_segment`, `reset_song`, `_write_timeline`,
  and the now-unused `theory.chord` import)
- Modify: `server/app.py` (remove `edit_segment` and `reset_song` routes)
- Modify: `server/tests/test_store.py` (remove edit/reset tests, add a plain
  delete test)
- Modify: `server/tests/test_app.py` (replace the combined CRUD+edit test
  with a CRUD-only test and a test proving the edit/reset routes are gone)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Store` no longer exposes `update_segment`/`reset_song`; the
  `songs` table no longer has an `original_json` column. Later tasks (3, 4)
  must not call these.

- [ ] **Step 1: Write the failing tests**

Replace the edit/reset tests in `server/tests/test_store.py` (delete
`test_edit_single_and_apply_to_all`, `test_edit_apply_to_all_changes_every_match`,
`test_edit_errors`, `test_reset_and_delete`) with:

```python
def test_delete(store, timeline):
    song_id = store.save_song(timeline)
    assert store.delete_song(song_id) is True
    assert store.get_song(song_id) is None
    assert store.delete_song(song_id) is False
```

In `server/tests/test_app.py`, replace `test_song_crud_and_edits` with:

```python
def test_song_crud(ctx, timeline):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    assert client.get("/api/songs").get_json()[0]["id"] == song_id
    assert client.get(f"/api/songs/{song_id}").get_json()["timeline"]["key"] == "G:min"
    assert client.delete(f"/api/songs/{song_id}").status_code == 204
    assert client.get(f"/api/songs/{song_id}").status_code == 404


def test_edit_and_reset_routes_are_gone(ctx, timeline):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    assert client.put(f"/api/songs/{song_id}/segments/0", json={"label": "C:min"}).status_code == 404
    assert client.post(f"/api/songs/{song_id}/reset").status_code == 404
    assert client.get(f"/api/songs/{song_id}").get_json()["timeline"]["segments"][0]["label"] == "C:min7"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest server/tests/test_store.py server/tests/test_app.py -v`
Expected: `test_edit_and_reset_routes_are_gone` FAILs (routes still return 200/400,
not 404); `test_delete`/`test_song_crud` should already pass since they don't
touch removed behavior yet — that's fine, they just lock in current behavior
before the removal.

- [ ] **Step 3: Remove the mutation code**

In `server/store.py`, change the `SCHEMA` string's `songs` table (remove the
`original_json TEXT NOT NULL,` line):

```python
SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    video_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    duration REAL NOT NULL,
    key TEXT NOT NULL,
    tempo REAL NOT NULL,
    timeline_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    song_id TEXT,
    created_at TEXT NOT NULL
);
"""
```

Replace `save_song` (drops the `original_json` write):

```python
    def save_song(self, timeline: dict) -> str:
        blob = json.dumps(timeline)
        meta = (timeline["title"], timeline["duration"], timeline["key"], timeline["tempo"])
        existing = self.get_song_by_video(timeline["video_id"])
        if existing:
            self._exec("UPDATE songs SET title=?, duration=?, key=?, tempo=?, timeline_json=?, "
                       "updated_at=? WHERE id=?", (*meta, blob, _now(), existing["id"]))
            return existing["id"]
        song_id = uuid.uuid4().hex
        now = _now()
        self._exec("INSERT INTO songs (id, video_id, title, duration, key, tempo, timeline_json, "
                   "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                   (song_id, timeline["video_id"], *meta, blob, now, now))
        return song_id
```

Delete the `update_segment`, `reset_song`, and `_write_timeline` methods
entirely (everything between `list_songs` and `delete_song`), and delete the
now-unused import line `from server.theory.chord import SHARPS, parse, to_harte`.

In `server/app.py`, delete the `edit_segment` and `reset_song` route
functions (the `@app.put("/api/songs/<song_id>/segments/<int:index>")` and
`@app.post("/api/songs/<song_id>/reset")` blocks).

Note: if you have a local dev database at `server/data/chordarium.db` from
before this change, delete that file — its `songs` table still has the old
`original_json NOT NULL` column, which would reject new inserts. There's no
real data at stake yet (Phase 1 was local/single-user), so this is a clean
reset, not a migration.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest server/tests/test_store.py server/tests/test_app.py -v`
Expected: PASS. (`test_exports` and `test_export_rejects_bad_params` in
`test_app.py` will fail here because Task 2 hasn't changed the export route
yet — that's expected; fix them in Task 2, not here. If you'd rather keep
this task green in isolation, temporarily skip those two with
`@pytest.mark.skip(reason="updated in Task 2")` and remove the skip in Task 2.)

- [ ] **Step 5: Commit**

```bash
git add server/store.py server/app.py server/tests/test_store.py server/tests/test_app.py
git commit -m "$(cat <<'EOF'
fix: remove server-side chord-edit mutation from the shared song store

A shared public library can't let one visitor's chord correction silently
overwrite what every other visitor sees. Edits move to the client in a
later task; this removes the server-side mutation path they used to share.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Change export to render a client-posted timeline

**Files:**
- Modify: `server/app.py` (`export_song` route: `GET` → `POST`, read
  `timeline` from the JSON body instead of the stored song)
- Modify: `server/tests/test_app.py` (switch export tests to `POST` with a
  body; add a test proving the posted timeline is used, not the stored one;
  add a test for a missing/malformed body; add `import copy` at top)

**Interfaces:**
- Consumes: `EXPORTERS` dict and `ExportOptions` (unchanged, from
  `server/export/*` and `server/export/grid.py`).
- Produces: `POST /api/songs/<song_id>/export?fmt=&transpose=&capo=&simplify=&bars_per_row=`
  with body `{"timeline": {...}}` — this is the contract Task 6's client code
  must call.

- [ ] **Step 1: Write the failing tests**

In `server/tests/test_app.py`, add `import copy` near the top, remove the
`@pytest.mark.skip` from Task 1 if you added one, and replace the export
tests with:

```python
@pytest.mark.parametrize("fmt,mimetype,ext", [
    ("chordpro", "text/plain", "cho"), ("txt", "text/plain", "txt"), ("json", "application/json", "json"),
    ("pdf", "application/pdf", "pdf"), ("midi", "audio/midi", "mid"),
])
def test_exports(ctx, timeline, fmt, mimetype, ext):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    r = client.post(f"/api/songs/{song_id}/export?fmt={fmt}&transpose=1&capo=2&simplify=1&bars_per_row=8",
                    json={"timeline": timeline})
    assert r.status_code == 200
    assert r.mimetype == mimetype
    assert r.headers["Content-Disposition"] == f'attachment; filename="Test-Song.{ext}"'


def test_export_uses_the_posted_timeline_not_the_stored_one(ctx, timeline):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    edited = copy.deepcopy(timeline)
    edited["segments"][0]["label"] = "G:maj"
    r = client.post(f"/api/songs/{song_id}/export?fmt=json", json={"timeline": edited})
    assert r.get_json()["segments"][0]["label"] == "G:maj"
    assert store.get_song(song_id)["timeline"]["segments"][0]["label"] == "C:min7"


def test_export_requires_a_timeline_body(ctx, timeline):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?fmt=json", json={}).status_code == 400
    assert client.post(f"/api/songs/{song_id}/export?fmt=json").status_code == 400


@pytest.mark.parametrize("query", ["fmt=docx", "fmt=pdf&transpose=9", "fmt=pdf&capo=-1",
                                   "fmt=pdf&bars_per_row=5", "fmt=pdf&transpose=abc"])
def test_export_rejects_bad_params(ctx, timeline, query):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?{query}", json={"timeline": timeline}).status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest server/tests/test_app.py -v -k export`
Expected: FAIL (route is still `GET` and reads from `store.get_song`, so
`client.post(...)` returns 405 Method Not Allowed).

- [ ] **Step 3: Update the route**

In `server/app.py`, replace the `export_song` route:

```python
    @app.post("/api/songs/<song_id>/export")
    def export_song(song_id):
        song = store.get_song(song_id)
        if song is None:
            return error("Song not found", 404)
        body = request.get_json(silent=True) or {}
        timeline = body.get("timeline")
        if not isinstance(timeline, dict) or "segments" not in timeline:
            raise BadRequest("Request body must include a 'timeline' object with segments.")
        fmt = request.args.get("fmt", "pdf")
        if fmt not in EXPORTERS:
            raise BadRequest(f"fmt must be one of {', '.join(EXPORTERS)}")
        opts = ExportOptions(
            transpose=_int_arg("transpose", 0, -6, 6),
            capo=_int_arg("capo", 0, 0, 7),
            simplify=request.args.get("simplify") in ("1", "true"),
            bars_per_row=_int_arg("bars_per_row", 4, 4, 8, allowed=(4, 8)),
        )
        render, mimetype, ext = EXPORTERS[fmt]
        data = render(timeline, opts)
        if isinstance(data, str):
            data = data.encode("utf-8")
        filename = f"{_slug(song['title'])}.{ext}"
        return Response(data, mimetype=mimetype,
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest server/tests/test_app.py -v`
Expected: PASS, all of `test_app.py`.

- [ ] **Step 5: Commit**

```bash
git add server/app.py server/tests/test_app.py
git commit -m "$(cat <<'EOF'
fix: render exports from the posted timeline, not the stored copy

Once edits move client-side (next task), the server's stored timeline is
always the pristine original — export has to take the caller's merged
(canonical + local-edit) timeline instead, or corrections would silently
vanish from every export.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add the `useChordOverrides` client hook

**Files:**
- Create: `client/src/hooks/useChordOverrides.ts`
- Create: `client/src/hooks/useChordOverrides.test.ts`

**Interfaces:**
- Consumes: `parse`, `toHarte`, `SHARPS` from `client/src/theory/chord.ts`
  (existing); `Segment` from `client/src/types.ts` (existing).
- Produces: `useChordOverrides(songId: string, canonicalSegments: Segment[]):
  [Segment[], (index: number, label: string, applyToAll: boolean) => void, () => void]`
  — `[mergedSegments, applyEdit, reset]`. `applyEdit` throws the same `Error`
  `parse()` throws for an invalid label (caller must catch it). Task 4
  consumes this exact tuple shape.

- [ ] **Step 1: Write the failing test**

Create `client/src/hooks/useChordOverrides.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TIMELINE } from '../test/fixtures'
import { useChordOverrides } from './useChordOverrides'

afterEach(() => vi.restoreAllMocks())

describe('useChordOverrides', () => {
  it('starts with the canonical segments unedited', () => {
    const { result } = renderHook(() => useChordOverrides('s1', TIMELINE.segments))
    expect(result.current[0]).toEqual(TIMELINE.segments)
  })

  it('applies a single edit without touching other segments', () => {
    const { result } = renderHook(() => useChordOverrides('s2', TIMELINE.segments))
    act(() => result.current[1](0, 'C:min', false))
    expect(result.current[0][0]).toMatchObject({ label: 'C:min', bass: 'C', edited: true })
    expect(result.current[0][1]).toEqual(TIMELINE.segments[1])
  })

  it('applies to every segment with a matching label', () => {
    const segments = TIMELINE.segments.map((s, i) => (i === 3 ? { ...s, label: 'C:min7' } : s))
    const { result } = renderHook(() => useChordOverrides('s3', segments))
    act(() => result.current[1](0, 'N', true))
    expect(result.current[0][0].label).toBe('N')
    expect(result.current[0][3].label).toBe('N')
    expect(result.current[0][0].bass).toBeNull()
  })

  it('persists edits per song across remounts, independently per song', () => {
    const { result, unmount } = renderHook(() => useChordOverrides('s4', TIMELINE.segments))
    act(() => result.current[1](1, 'G:maj', false))
    unmount()
    const again = renderHook(() => useChordOverrides('s4', TIMELINE.segments))
    expect(again.result.current[0][1]).toMatchObject({ label: 'G:maj' })
    const other = renderHook(() => useChordOverrides('s5', TIMELINE.segments))
    expect(other.result.current[0][1]).toEqual(TIMELINE.segments[1])
  })

  it('reset clears all overrides and storage', () => {
    const { result } = renderHook(() => useChordOverrides('s6', TIMELINE.segments))
    act(() => result.current[1](0, 'C:min', false))
    act(() => result.current[2]())
    expect(result.current[0]).toEqual(TIMELINE.segments)
    expect(localStorage.getItem('chordarium:edits:s6')).toBeNull()
  })

  it('throws for an invalid label, leaving segments unchanged', () => {
    const { result } = renderHook(() => useChordOverrides('s7', TIMELINE.segments))
    expect(() => act(() => result.current[1](0, 'H:maj', false))).toThrow()
    expect(result.current[0]).toEqual(TIMELINE.segments)
  })

  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useChordOverrides('s8', TIMELINE.segments))
    act(() => result.current[1](0, 'C:min', false))
    expect(result.current[0][0].label).toBe('C:min')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- useChordOverrides`
Expected: FAIL with "Cannot find module './useChordOverrides'".

- [ ] **Step 3: Write the implementation**

Create `client/src/hooks/useChordOverrides.ts`:

```ts
import { useCallback, useMemo, useState } from 'react'
import { parse, SHARPS, toHarte } from '../theory/chord'
import type { Segment } from '../types'

interface Override {
  label: string
  bass: string | null
}

function storageKey(songId: string): string {
  return `chordarium:edits:${songId}`
}

function readOverrides(songId: string): Record<number, Override> {
  try {
    const raw = localStorage.getItem(storageKey(songId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeOverrides(songId: string, overrides: Record<number, Override>): void {
  try {
    localStorage.setItem(storageKey(songId), JSON.stringify(overrides))
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

function clearOverrides(songId: string): void {
  try {
    localStorage.removeItem(storageKey(songId))
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export function useChordOverrides(
  songId: string,
  canonicalSegments: Segment[],
): [Segment[], (index: number, label: string, applyToAll: boolean) => void, () => void] {
  const [overrides, setOverrides] = useState<Record<number, Override>>(() => readOverrides(songId))

  const segments = useMemo(
    () => canonicalSegments.map((seg, i) => {
      const o = overrides[i]
      return o ? { ...seg, label: o.label, bass: o.bass, edited: true } : seg
    }),
    [canonicalSegments, overrides],
  )

  const applyEdit = useCallback(
    (index: number, label: string, applyToAll: boolean) => {
      const chord = parse(label)
      const newLabel = toHarte(chord)
      const bass = chord === null ? null : SHARPS[chord.bass ?? chord.root]
      const target = segments[index].label
      const next = { ...overrides }
      segments.forEach((seg, i) => {
        if (i === index || (applyToAll && seg.label === target)) next[i] = { label: newLabel, bass }
      })
      setOverrides(next)
      writeOverrides(songId, next)
    },
    [segments, overrides, songId],
  )

  const reset = useCallback(() => {
    setOverrides({})
    clearOverrides(songId)
  }, [songId])

  return [segments, applyEdit, reset]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- useChordOverrides`
Expected: PASS, all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useChordOverrides.ts client/src/hooks/useChordOverrides.test.ts
git commit -m "$(cat <<'EOF'
feat: add client-side chord-edit overlay hook

Layers per-song chord corrections from localStorage on top of the
canonical timeline, the same way useViewSettings already layers
transpose/capo/simplify — the client-side half of moving edits off
the shared server copy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire `useChordOverrides` into the Tracker page

**Files:**
- Modify: `client/src/pages/TrackerPage.tsx`
- Modify: `client/src/pages/TrackerPage.test.tsx`

**Interfaces:**
- Consumes: `useChordOverrides` from Task 3.
- Produces: no exported interface change; `Tracker`'s internal `segments`
  (merged) replaces `t.segments` (canonical) everywhere it was used for
  display/playback/editing. Task 6's `ExportModal` usage in this file's JSX
  must receive the merged segments (see Step 3).

- [ ] **Step 1: Write the failing test**

In `client/src/pages/TrackerPage.test.tsx`, change the `vi.mock('../api', ...)`
block to drop `editSegment`/`reset`/`exportUrl` (Task 6 will add `exportSong`
back for the export test there — this file doesn't need it):

```ts
vi.mock('../hooks/useYouTubePlayer', () => ({ useYouTubePlayer: () => player }))
vi.mock('../api', () => ({ api: { song: vi.fn() } }))
import { api } from '../api'
const mocked = vi.mocked(api)
```

Replace the `'edits a chord through the editor'` test with:

```ts
  it('edits a chord through the editor', async () => {
    const user = userEvent.setup()
    renderTracker()
    await screen.findByTestId('current-chord')
    await user.click(screen.getByRole('button', { name: /edit chords/i }))
    await user.click(screen.getByRole('button', { name: 'F7' }))
    await user.click(within(screen.getByRole('group', { name: /suggestions/i })).getByRole('button', { name: 'F' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /edit chord/i })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'F' })).toHaveClass('edited')
  })

  it('keeps an edit after re-rendering and clears it on reset', async () => {
    const user = userEvent.setup()
    renderTracker()
    await screen.findByTestId('current-chord')
    await user.click(screen.getByRole('button', { name: /edit chords/i }))
    await user.click(screen.getByRole('button', { name: 'F7' }))
    await user.click(within(screen.getByRole('group', { name: /suggestions/i })).getByRole('button', { name: 'F' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'F' })).toHaveClass('edited'))
    await user.click(screen.getByRole('button', { name: /reset edits/i }))
    expect(screen.getByRole('button', { name: 'F7' })).not.toHaveClass('edited')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- TrackerPage`
Expected: FAIL — `TrackerPage.tsx` still imports/calls `api.editSegment`/`api.reset`,
which no longer exist on the mocked `api` object, so the click throws.

- [ ] **Step 3: Update TrackerPage.tsx**

Replace the top of `client/src/pages/TrackerPage.tsx` (imports and the
`TrackerPage` export) — drop the `onTimeline` prop entirely since `song` is
never mutated after fetch:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { ChordEditor } from '../components/ChordEditor'
import { ChordHero } from '../components/ChordHero'
import { ChordLane } from '../components/ChordLane'
import { Controls, type LoopRange } from '../components/Controls'
import { DiagramPanel } from '../components/DiagramPanel'
import { ExportModal } from '../components/ExportModal'
import { useChordOverrides } from '../hooks/useChordOverrides'
import { useViewSettings } from '../hooks/useViewSettings'
import { useYouTubePlayer } from '../hooks/useYouTubePlayer'
import { activeIndex, beatsUntil, isLowConfidence, upcomingIndex } from '../sync'
import { formatKey, keySpelling, parse, render, simplify, transpose } from '../theory/chord'
import type { Song } from '../types'

export function TrackerPage() {
  const { songId = '' } = useParams()
  const [song, setSong] = useState<Song | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.song(songId).then(setSong).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [songId])

  if (error) {
    return (
      <main className="page">
        <p role="alert" className="error">{error}</p>
        <Link to="/" className="button">Back to home</Link>
      </main>
    )
  }
  if (!song) return <main className="page"><p className="muted">Loading…</p></main>
  return <Tracker song={song} />
}

function Tracker({ song }: { song: Song }) {
  const t = song.timeline
  const [settings, update] = useViewSettings(song.id)
  const [segments, applyOverride, resetOverrides] = useChordOverrides(song.id, t.segments)
  const player = useYouTubePlayer('yt-player', t.video_id)
  const [loop, setLoop] = useState<LoopRange>({ a: null, b: null })
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const shift = settings.transpose - settings.capo
  const tonic = keySpelling(t.key, shift)
  const symbols = useMemo(
    () => segments.map((s) => render(s.label, { transpose: settings.transpose, capo: settings.capo, simplify: settings.simplify, tonic })),
    [segments, settings.transpose, settings.capo, settings.simplify, tonic],
  )

  const idx = activeIndex(segments, player.time)
  const next = upcomingIndex(segments, player.time)
  const beatsToNext = next >= 0 ? beatsUntil(t.beats, player.time, segments[next].start) : 0
  const currentChord = useMemo(() => {
    if (idx < 0) return null
    let c = parse(segments[idx].label)
    if (settings.simplify) c = simplify(c)
    return transpose(c, shift)
  }, [idx, segments, settings.simplify, shift])

  const { setRate, ready, seek, time } = player
  useEffect(() => {
    if (ready) setRate(settings.rate)
  }, [ready, setRate, settings.rate])

  useEffect(() => {
    if (loop.a !== null && loop.b !== null && loop.b > loop.a && time > loop.b) seek(loop.a)
  }, [time, loop, seek])

  function applyEdit(label: string, applyToAll: boolean) {
    if (editing === null) return
    try {
      applyOverride(editing, label, applyToAll)
      setEditing(null)
      setActionError(null)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  function resetEdits() {
    resetOverrides()
    setActionError(null)
  }

  return (
    <main className="page tracker">
      <div>
        <h1>{t.title}</h1>
        <div className="chips">
          <span className="chip-meta">{formatKey(t.key, settings.transpose)}</span>
          <span className="chip-meta">{Math.round(t.tempo)} BPM</span>
          <span className="chip-meta">{t.time_signature}/4</span>
          {settings.capo > 0 && <span className="chip-meta">Capo {settings.capo}</span>}
          <span className="chip-meta muted">{t.engine.chords === 'btc-large' ? 'BTC model' : 'Template model'}{t.engine.separated ? ' · stems' : ''}</span>
        </div>
      </div>
      {t.warnings.length > 0 && (
        <div role="status" aria-label="Analysis warnings" className="banner">
          {t.warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}
      {actionError && <p role="alert" className="error">{actionError}</p>}
      <div className="tracker-top">
        <div className="player"><div id="yt-player" /></div>
        <ChordHero current={idx >= 0 ? symbols[idx] : null} next={next >= 0 ? symbols[next] : null} beatsToNext={beatsToNext}
          lowConfidence={idx >= 0 && isLowConfidence(segments[idx].confidence)} />
      </div>
      <ChordLane segments={segments} symbols={symbols} beats={t.beats} downbeats={t.downbeats} duration={t.duration}
        time={player.time} editMode={editMode} onSeek={seek} onEdit={setEditing} />
      <div className="tracker-bottom">
        <DiagramPanel chord={currentChord} label={idx >= 0 ? symbols[idx] : 'N.C.'} />
        <Controls settings={settings} onChange={update} loop={loop}
          onSetA={() => setLoop((l) => ({ ...l, a: time }))} onSetB={() => setLoop((l) => ({ ...l, b: time }))}
          onClearLoop={() => setLoop({ a: null, b: null })} editMode={editMode} onToggleEdit={() => setEditMode((m) => !m)}
          onReset={resetEdits} onExport={() => setExporting(true)} />
      </div>
      {editing !== null && (
        <ChordEditor segment={segments[editing]} shift={shift} tonic={tonic} onApply={applyEdit} onClose={() => setEditing(null)} />
      )}
      {exporting && (
        <ExportModal songId={song.id} title={t.title} timeline={{ ...t, segments }} settings={settings}
          onClose={() => setExporting(false)} />
      )}
    </main>
  )
}
```

Note: `ExportModal` now needs `title` and `timeline` props instead of just
`songId`/`settings` — Task 6 updates `ExportModal` itself to match; until
that task runs, this file won't type-check against the *old* `ExportModal`
signature, which is expected mid-plan (tasks run in order).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- TrackerPage`
Expected: the two edit/reset tests PASS. (Other TrackerPage tests may still
be red until Task 6 updates `ExportModal`'s props — that's fine; re-run the
full file after Task 6.)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TrackerPage.tsx client/src/pages/TrackerPage.test.tsx
git commit -m "$(cat <<'EOF'
feat: apply chord edits client-side in the Tracker page

Wires useChordOverrides in place of the server round-trip, so corrections
live in this browser's localStorage instead of mutating the shared song.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Replace `editSegment`/`reset`/`exportUrl` with `exportSong` in the API client

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/api.test.ts`

**Interfaces:**
- Consumes: `ApiError` (existing), `ExportRequest`, `Timeline` (existing
  types from `client/src/types.ts`).
- Produces: `exportSong(songId: string, timeline: Timeline, req: ExportRequest): Promise<Blob>`
  and `slugTitle(title: string): string`. Task 6's `ExportModal` calls both by
  these exact names.

- [ ] **Step 1: Write the failing test**

Replace the `editSegment` test and the `exportUrl` describe block in
`client/src/api.test.ts` with:

```ts
  it('posts the timeline and returns a blob for exports', async () => {
    const blob = new Blob(['pdf-bytes'])
    const fetchMock = vi.fn().mockResolvedValue(new Response(blob, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const timeline = { segments: [] } as unknown as import('./types').Timeline
    const result = await api.exportSong('s1', timeline, { fmt: 'chordpro', transpose: -2, capo: 3, simplify: true, barsPerRow: 8 })
    expect(result).toBe(blob)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/songs/s1/export?fmt=chordpro&transpose=-2&capo=3&simplify=1&bars_per_row=8')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ timeline })
  })

  it('turns a failed export into an ApiError with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404, { error: 'Song not found' })))
    const err = await api.exportSong('s1', {} as unknown as import('./types').Timeline, { fmt: 'pdf', transpose: 0, capo: 0, simplify: false, barsPerRow: 4 }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('Song not found')
  })
```

Add below the `describe('api', ...)` block:

```ts
describe('slugTitle', () => {
  it('replaces non-alphanumeric runs with a dash and trims the ends', () => {
    expect(slugTitle("Autumn Leaves (Live) - Cover!")).toBe('Autumn-Leaves-Live-Cover')
  })

  it('falls back to a default for an empty or all-punctuation title', () => {
    expect(slugTitle('')).toBe('chordarium')
    expect(slugTitle('!!!')).toBe('chordarium')
  })
})
```

Update the top import to `import { api, ApiError, slugTitle } from './api'` and
delete the old `it('sends segment edits with apply_to_all', ...)` test and the
`describe('exportUrl', ...)` block.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- api.test`
Expected: FAIL — `api.exportSong` and `slugTitle` don't exist yet.

- [ ] **Step 3: Update api.ts**

Replace the whole file:

```ts
import type { ExportRequest, Job, Song, SongSummary, Timeline } from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = res.statusText || `Request failed (${res.status})`
  try {
    const body = await res.json()
    if (body?.error) message = body.error
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(message, res.status)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type AnalyzeResponse = { job_id?: string; song_id?: string; cached?: boolean }

export const api = {
  analyze: (url: string, mode: 'fast' | 'accurate') =>
    request<AnalyzeResponse>('/analyze', { method: 'POST', body: JSON.stringify({ url, mode }) }),
  job: (id: string) => request<Job>(`/jobs/${id}`),
  cancelJob: (id: string) => request<{ cancelled: boolean }>(`/jobs/${id}/cancel`, { method: 'POST' }),
  songs: () => request<SongSummary[]>('/songs'),
  song: (id: string) => request<Song>(`/songs/${id}`),
  deleteSong: (songId: string) => request<void>(`/songs/${songId}`, { method: 'DELETE' }),
  exportSong: async (songId: string, timeline: Timeline, req: ExportRequest): Promise<Blob> => {
    const params = new URLSearchParams({
      fmt: req.fmt,
      transpose: String(req.transpose),
      capo: String(req.capo),
      simplify: req.simplify ? '1' : '0',
      bars_per_row: String(req.barsPerRow),
    })
    const res = await fetch(`/api/songs/${songId}/export?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline }),
    })
    if (!res.ok) throw await toApiError(res)
    return res.blob()
  },
}

export function slugTitle(title: string): string {
  return title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chordarium'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- api.test`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add client/src/api.ts client/src/api.test.ts
git commit -m "$(cat <<'EOF'
feat: add exportSong/slugTitle, drop editSegment/reset/exportUrl

Exports now need to POST the client's merged timeline and download a
blob response instead of following a plain GET link; the removed
functions had no callers left once edits moved client-side.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Switch ExportModal to a POST + blob download

**Files:**
- Modify: `client/src/components/ExportModal.tsx`
- Modify: `client/src/components/ExportModal.test.tsx`

**Interfaces:**
- Consumes: `exportSong`, `slugTitle` from Task 5.
- Produces: `ExportModal` now takes `{ songId, title, timeline, settings, onClose }`
  (was `{ songId, settings, onClose }`) — matches what Task 4's `TrackerPage`
  already passes.

- [ ] **Step 1: Write the failing test**

Replace `client/src/components/ExportModal.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW } from '../hooks/useViewSettings'
import { TIMELINE } from '../test/fixtures'
import { ExportModal } from './ExportModal'

vi.mock('../api', () => ({
  exportSong: vi.fn(),
  slugTitle: (t: string) => t.replace(/[^A-Za-z0-9]+/g, '-'),
}))
import { exportSong } from '../api'
const mockedExport = vi.mocked(exportSong)

beforeEach(() => {
  vi.clearAllMocks()
  mockedExport.mockResolvedValue(new Blob(['bytes']))
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
})

describe('ExportModal', () => {
  it('downloads a PDF with the current view settings', async () => {
    const user = userEvent.setup()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={{ ...DEFAULT_VIEW, transpose: 2, capo: 1 }} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith('s1', TIMELINE, {
      fmt: 'pdf', transpose: 2, capo: 1, simplify: false, barsPerRow: 4,
    }))
  })

  it('changes format, drops view settings, simplifies and widens rows', async () => {
    const user = userEvent.setup()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={{ ...DEFAULT_VIEW, transpose: 2, capo: 1 }} onClose={vi.fn()} />)
    await user.click(screen.getByLabelText(/chordpro/i))
    await user.click(screen.getByLabelText(/apply current transpose/i))
    await user.click(screen.getByLabelText(/simplified chords/i))
    await user.selectOptions(screen.getByLabelText(/bars per row/i), '8')
    await user.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith('s1', TIMELINE, {
      fmt: 'chordpro', transpose: 0, capo: 0, simplify: true, barsPerRow: 8,
    }))
  })

  it('shows an error if the export request fails', async () => {
    mockedExport.mockRejectedValue(new Error('Song not found'))
    const user = userEvent.setup()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={DEFAULT_VIEW} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /download/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Song not found')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={DEFAULT_VIEW} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={DEFAULT_VIEW} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- ExportModal`
Expected: FAIL — there's no `role="button"` named "download" yet (it's still
a link), and `ExportModal` doesn't accept `title`/`timeline` props.

- [ ] **Step 3: Update ExportModal.tsx**

```tsx
import { useState } from 'react'
import { exportSong, slugTitle } from '../api'
import { useModalA11y } from '../hooks/useModalA11y'
import type { ViewSettings } from '../hooks/useViewSettings'
import type { ExportFormat, Timeline } from '../types'

const FORMATS: { fmt: ExportFormat; label: string; ext: string; hint: string }[] = [
  { fmt: 'pdf', label: 'PDF chord sheet', ext: '.pdf', hint: 'Printable bar grid with a chord legend' },
  { fmt: 'chordpro', label: 'ChordPro', ext: '.cho', hint: 'For OnSong, forScore, SongbookPro' },
  { fmt: 'txt', label: 'Plain text', ext: '.txt', hint: 'Paste into notes or messages' },
  { fmt: 'midi', label: 'MIDI', ext: '.mid', hint: 'Chord track + bass, at song tempo' },
  { fmt: 'json', label: 'JSON', ext: '.json', hint: 'Timestamps & confidence data' },
]

interface Props {
  songId: string
  title: string
  timeline: Timeline
  settings: ViewSettings
  onClose(): void
}

export function ExportModal({ songId, title, timeline, settings, onClose }: Props) {
  const modalRef = useModalA11y<HTMLDivElement>(onClose)
  const [fmt, setFmt] = useState<ExportFormat>('pdf')
  const [includeView, setIncludeView] = useState(true)
  const [simplify, setSimplify] = useState(settings.simplify)
  const [barsPerRow, setBarsPerRow] = useState<4 | 8>(4)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const ext = FORMATS.find((f) => f.fmt === fmt)!.ext
      const blob = await exportSong(songId, timeline, {
        fmt,
        transpose: includeView ? settings.transpose : 0,
        capo: includeView ? settings.capo : 0,
        simplify,
        barsPerRow,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slugTitle(title)}${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-label="Export chord sheet" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow">Format</p>
        <div className="formats" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <label key={f.fmt}>
              <input type="radio" name="fmt" checked={fmt === f.fmt} onChange={() => setFmt(f.fmt)} />
              <span className="fmt-row"><span>{f.label}</span><span className="fmt-ext">{f.ext}</span></span>
              <p className="muted">{f.hint}</p>
            </label>
          ))}
        </div>
        <p className="eyebrow">Options</p>
        <label><input type="checkbox" checked={includeView} onChange={(e) => setIncludeView(e.target.checked)} /> Apply current transpose &amp; capo</label>
        <label><input type="checkbox" checked={simplify} onChange={(e) => setSimplify(e.target.checked)} /> Simplified chords</label>
        <label>
          Bars per row{' '}
          <select value={barsPerRow} onChange={(e) => setBarsPerRow(Number(e.target.value) as 4 | 8)}>
            <option value={4}>4</option>
            <option value={8}>8</option>
          </select>
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="control">
          <button type="button" className="button primary" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download'}</button>
          <button type="button" className="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- ExportModal`
Expected: PASS, all 5 cases. Then run the full client suite once to confirm
Task 4's `TrackerPage` tests (which depend on this file's new props) are
green too: `cd client && npm test`.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ExportModal.tsx client/src/components/ExportModal.test.tsx
git commit -m "$(cat <<'EOF'
feat: download exports via POST + blob instead of a GET link

A plain <a href> link can't carry the client's merged (canonical + local
chord edits) timeline to the server, and the server no longer has a
server-side edited copy to fall back on — exports have to POST it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Library title search + remove the "coming soon" badge

**Files:**
- Modify: `client/src/pages/HomePage.tsx`
- Modify: `client/src/pages/HomePage.test.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles.css` (remove the now-unused `.soon` rule)

**Interfaces:**
- Consumes: existing `SongSummary[]` from `api.songs()`.
- Produces: no exported interface change (page-local state only).

- [ ] **Step 1: Write the failing tests**

Add to `client/src/pages/HomePage.test.tsx`:

```tsx
  it('filters the library by title', async () => {
    mocked.songs.mockResolvedValue([
      { id: 's1', video_id: 'a', title: 'Autumn Leaves', duration: 200, key: 'G:min', tempo: 124, created_at: '', updated_at: '' },
      { id: 's2', video_id: 'b', title: 'Blue Bossa', duration: 180, key: 'C:min', tempo: 130, created_at: '', updated_at: '' },
    ])
    const user = userEvent.setup()
    renderHome()
    await screen.findByRole('link', { name: /autumn leaves/i })
    await user.type(screen.getByLabelText(/search songs/i), 'blue')
    expect(screen.queryByRole('link', { name: /autumn leaves/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /blue bossa/i })).toBeInTheDocument()
  })

  it('shows a no-matches message when the filter matches nothing', async () => {
    mocked.songs.mockResolvedValue([{
      id: 's1', video_id: 'a', title: 'Autumn Leaves', duration: 200, key: 'G:min', tempo: 124, created_at: '', updated_at: '',
    }])
    const user = userEvent.setup()
    renderHome()
    await screen.findByRole('link', { name: /autumn leaves/i })
    await user.type(screen.getByLabelText(/search songs/i), 'zzz')
    expect(await screen.findByText(/no songs match/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- HomePage`
Expected: FAIL — there's no element with an accessible name matching
"search songs" yet.

- [ ] **Step 3: Add the filter to HomePage.tsx**

In `client/src/pages/HomePage.tsx`, add `const [query, setQuery] = useState('')`
next to the other `useState` calls, and replace the "Recent songs" block:

```tsx
      <h2>Recent songs</h2>
      {songs !== null && songs.length > 0 && (
        <input type="search" aria-label="Search songs by title" placeholder="Search by title…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {songs === null ? <p className="muted">Loading…</p> : songs.length === 0 ? (
        <p className="muted">No songs yet — analyze your first link above.</p>
      ) : (() => {
        const filtered = songs.filter((s) => s.title.toLowerCase().includes(query.trim().toLowerCase()))
        return filtered.length === 0 ? (
          <p className="muted">No songs match “{query}”.</p>
        ) : (
          <div className="library">
            {filtered.map((s) => (
              <Link key={s.id} to={`/songs/${s.id}`} className="song-card" aria-label={s.title}>
                <div className="song-thumb">
                  <img src={`https://i.ytimg.com/vi/${s.video_id}/mqdefault.jpg`} alt="" loading="lazy" />
                  <span className="song-duration">{formatDuration(s.duration)}</span>
                </div>
                <div>
                  <strong>{s.title}</strong>
                  <div className="muted">
                    <span className="pill">{formatKey(s.key)}</span> · {Math.round(s.tempo)} BPM
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      })()}
```

In `client/src/App.tsx`, remove the "coming soon" badge, leaving just the brand
link in the header:

```tsx
      <header className="topbar">
        <Link to="/" className="brand">Chordarium</Link>
      </header>
```

In `client/src/styles.css`, delete the line `.soon { color: var(--muted); font-size: 0.85rem; }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test -- HomePage`
Expected: PASS. Then run the full suite: `cd client && npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/HomePage.tsx client/src/pages/HomePage.test.tsx client/src/App.tsx client/src/styles.css
git commit -m "$(cat <<'EOF'
feat: add title search to the song library, drop the coming-soon badge

The existing "Recent songs" list on HomePage already is the shared public
library once the backend stops scoping data per local user — it just
needed a way to search it, and the badge calling it "coming soon" is no
longer accurate.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full server test suite**

Run: `python -m pytest`
Expected: PASS (fast tests; the `slow` marker is excluded by default per
`pytest.ini`).

- [ ] **Step 2: Run the full client test suite**

Run: `cd client && npm test`
Expected: PASS.

- [ ] **Step 3: Manual smoke check**

Start both processes locally (per the README) and, in a browser: analyze a
short YouTube video, edit one chord, confirm it shows as edited, reload the
page (still applied — `localStorage`), click "Reset edits" (reverts), then
export a PDF and a ChordPro file and confirm the downloaded PDF reflects an
edit made just before export.

- [ ] **Step 4: Update the top-level README status line if needed**

If `README.md`'s `**Status:**` line still says "Phase 1 complete" only,
leave it as-is — this plan doesn't change the phase, only edit behavior — no
edit needed unless a later plan (the Render migration) changes it.
