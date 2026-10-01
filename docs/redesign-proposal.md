# Chordarium — Web App Redesign Proposal

*Draft v1 · 2026-10-02 · a proposal for review, nothing in here is built yet unless marked **Shipped**.*

## 0. How to read this

| If you want… | Read |
|---|---|
| The one-page version | §1 |
| What exists today, honestly | §2, §3 |
| The new structure and every screen | §5, §6 |
| The full feature list (kept / improved / new) | §7 |
| New ideas and the longer-term vision | §8 |
| What to build, in what order | §11 |
| What I need you to decide | §13 |

---

## 1. Summary

Chordarium turns a YouTube link into a synced, editable chord sheet. The engine
is solid. The **app around it grew screen-by-screen** and now shows it: the
song page is one long scroll with two banners above the video, the chord
timeline clips short chords, the library is a flat list, and the app never
quite says *how much to trust* what it detected.

**The redesign in one sentence:** make the song page a **two-mode workspace**
(*Play along* and *Chord sheet*), make **trust visible** (confidence, sections,
"what's a guess"), make **practice** a first-class feature (loop a section,
slow it down, count in), and organise everything around three places —
**Library, Song, Share**.

**What stays:** the analysis engine, exports, local-first editing, the shared
public library, dark/light themes.

**What changes:** layout, navigation, the song page's information hierarchy,
how accuracy is communicated, and how people practise, edit and share.

---

## 2. Where the app is today

### 2.1 Pages

| Route | Page | Purpose |
|---|---|---|
| `/` | Home | Paste a link, choose Quick/Accurate, search recent songs |
| `/jobs/:id` | Analyzing | Progress steps, cancel |
| `/songs/:id` | Tracker | The whole product: player, chords, diagrams, controls, edit, export |

### 2.2 Features that exist

**Analysis**
- YouTube link → chords (7ths, extensions, sus, inversions), beats, bars, key, tempo.
- **Quick** (~30 s) and **Accurate** (~3–6 min, stem separation) modes.
- Result cached per video; shared by everyone (public library, no accounts).
- Background worker, live progress, cancel.
- **Shipped (Oct 2026):** song sections (Intro / Verse / Chorus / Bridge / Interlude / Outro), re-analyze older songs.

**Song page**
- Embedded YouTube player, synced to the timeline.
- Big "current chord" with "next chord" and beat dots.
- Scrolling chord lane with playhead; click a chord to jump.
- Piano and guitar chord diagrams for the current chord.
- Transpose (±6), capo (0–7), playback speed (0.5×–1.5×), simplify chords.
- Loop A–B.
- Edit chords (suggestions, "apply to every matching chord"), reset edits — stored in the browser only.
- Low-confidence chords marked; analysis warnings shown.
- **Shipped:** section strip on the lane (jump / rename / move), bass notes in their own colour (toggle), first-use accuracy notice.

**Export** — PDF, ChordPro, TXT (bar grid, grouped by section, with legend and
"auto-detected" note), MIDI, JSON; transpose/capo/simplify/bars-per-row apply.

**Library** — thumbnails, key, tempo; client-side title search.

### 2.3 Not built yet
Accounts, publishing under your name, lyrics, hosting (Render + Vercel is
specced but not deployed), mobile-specific layout, offline use.

---

## 3. What's wrong with it (honest audit)

These are observations from using the current build, not opinions about the code.

| # | Problem | Why it matters |
|---|---|---|
| 1 | **Song page is a single long scroll.** Two banners (accuracy notice + "re-run") push the video down on first visit. | The first thing a new user should see is the song playing. |
| 2 | **Chord lane clips short chords** (e.g. `Ebm7/Bb` in a narrow chip shows as `Ebm7`). | Users misread chords — the core job of the app. |
| 3 | **Trust is implicit.** Confidence is a dotted underline; sections just show "?". | Users can't tell *which* parts to double-check. |
| 4 | **Two different views are crammed into one.** Playing along (big chord, lane) and reading the whole sheet need different layouts. | Neither is great; the sheet only exists inside the export dialog. |
| 5 | **No whole-song overview.** You can't see the structure and jump around at a glance. | Practising means moving between sections constantly. |
| 6 | **Practice tools are minimal.** Loop needs two manual clicks at exact moments; no count-in, no metronome, no tempo ramp. | Loop-a-section is the #1 thing musicians do. |
| 7 | **Library is a flat list.** No sort, filter by key/tempo, no "recently opened", no favourites. | Fine at 6 songs, painful at 60. |
| 8 | **Edits are invisible to others and fragile.** Browser-only, index-based; re-analysis silently invalidates them. | Users lose work and can't share corrections. |
| 9 | **Re-analysis is destructive** (replaces the song, drops edits). | Needs versions or at least a confirmation with a preview. |
| 10 | **Export is a modal with no preview.** | You find out the layout is wrong after downloading. |
| 11 | **Mobile is an afterthought.** Controls wrap; the lane is hard to use one-handed. | Most people practise with a phone on a music stand. |
| 12 | **Accessibility gaps** likely: colour-only cues (bass, sections), small hit targets. | Needs a deliberate pass. |

---

## 4. Design principles

1. **Music first.** The video and the current chord are always visible while playing. Everything else is one tap away, not stacked above.
2. **Show your confidence.** Never present a guess as a fact. Make uncertainty visible, and make fixing it easy.
3. **One job per view.** *Play along* is for playing. *Chord sheet* is for reading and printing. *Edit* is a mode, not a place.
4. **Practice is a feature.** Loops, speed, count-in and section jumping are first-class, not buried controls.
5. **Local-first, share-on-purpose.** Your edits stay yours until you choose to share them.
6. **Plain words.** "Verse 1", "Quick", "Accurate" — not "group A", "fast/btc-large".
7. **Works on a music stand.** Phone and tablet layouts are designed, not squeezed.
8. **Accessible by default.** Colour is never the only signal; keyboard and screen-reader paths exist for every action.

---

## 5. Information architecture

```
Chordarium
├── Library            /                    ← home: analyze + browse
│   ├── Analyze bar (paste link, Quick/Accurate)
│   ├── Continue practising (recent, with progress)
│   ├── Favourites
│   └── All songs (search, sort, filter by key / tempo)
├── Song               /songs/:id           ← the workspace
│   ├── Play along     (default)
│   ├── Chord sheet    /songs/:id/sheet
│   └── Edit mode      (overlay on either view)
├── Analyzing          /jobs/:id            ← progress, then auto-opens the Song
├── Share              /s/:shareId          ← read-only public view (later phase)
└── Settings           (drawer, not a page)
    ├── Display (theme, chord font size, bass colour, notation)
    ├── Instrument (guitar / piano / ukulele, left-handed)
    └── Practice defaults (count-in, speed step)
```

**Global navigation:** a slim top bar — logo · *Library* · analyze field (always reachable) · settings. No sidebar; the Song page uses the full width.

---

## 6. Screen-by-screen

### 6.1 Library (home)

```
┌────────────────────────────────────────────────────────────┐
│ ◉ Chordarium     Library                      ⚙  ☾         │
├────────────────────────────────────────────────────────────┤
│  Paste a song. Play along with its chords.                  │
│  ┌──────────────────────────────────────────┐ [ Analyze ]   │
│  │ YT  https://www.youtube.com/watch?v=…    │               │
│  └──────────────────────────────────────────┘               │
│  ( • Quick ~30s — good first look )  ( ○ Accurate ~3 min )  │
│                                                             │
│  Continue practising                                        │
│  [thumb · Verse 2 · 1:24] [thumb · Chorus · 2:10] …         │
│                                                             │
│  All songs        🔍 search   Sort: Recent ▾   Key ▾  BPM ▾ │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                        │
│  │thumb │ │thumb │ │thumb │ │thumb │   ★ favourite          │
│  │title │ │title │ │title │ │title │   Db major · 115 BPM   │
│  └──────┘ └──────┘ └──────┘ └──────┘   "Quick" / "Accurate" │
└────────────────────────────────────────────────────────────┘
```

- **Continue practising** remembers last position and last loop per song (local).
- Cards show analysis quality (*Quick* / *Accurate*) so users know which to upgrade.
- Filters: key, tempo range, has-sections, favourites. Sort: recent, title, key, tempo.
- Empty state teaches the product in three lines + a sample song.

### 6.2 Analyze flow

- Paste anywhere on the page (global paste handler) → link is detected and validated inline (video title + thumbnail preview *before* analysing).
- Cached song → opens immediately; no spinner.
- Progress page uses plain steps with time estimates ("Separating vocals — about 2 min left"), and a **"Keep browsing"** option: analysis continues in the background and a toast appears when done.
- Failure messages say what to do ("This video is private" / "Try again later"), not tool names.

### 6.3 Song — *Play along* (default)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ‹ Library   Never Gonna Give You Up         ★  Share  Export  ⚙     │
│  Db major · 115 BPM · 4/4 · Quick analysis  [ Improve accuracy ]    │
├───────────────────────────────┬─────────────────────────────────────┤
│                               │          Cm7 / E                    │
│        YouTube player         │          next: F7  ● ● ● ○          │
│                               │   ┌──────────┐ ┌──────────┐         │
│                               │   │  guitar  │ │  piano   │         │
├───────────────────────────────┴───┴──────────┴─┴──────────┴─────────┤
│ Intro │ Verse 1 │ Chorus │ Verse 2 │ Chorus │ Bridge │ Chorus   ← structure bar
├─────────────────────────────────────────────────────────────────────┤
│ ░░░░░░ Ebm7/Bb ░░ Ab ░░░ Fm ░░░ Bbm ░░░ …   ← chord lane (wraps)   │
├─────────────────────────────────────────────────────────────────────┤
│ ⏮  ⏯  ⏭   0.75×   Loop: [Verse 1 ✕]   Count-in ☐  Metronome ☐      │
│ Transpose −0+   Capo −0+   Simplify ☐   Bass notes ☑   ✎ Edit       │
└─────────────────────────────────────────────────────────────────────┘
```

Key changes from today:
- **Structure bar** across the full song: coloured blocks = sections, a playhead, a mini "heat" showing low-confidence stretches. Click to jump; **click a section to loop it**.
- **Chord lane never clips:** chip width has a minimum that fits the symbol; the lane zooms (− / +) and offers a **bar-grid mode** (4 bars per line) instead of a time-scaled strip.
- **Banners become a quiet status line** under the title: "Quick analysis · sections are guesses · *Improve accuracy*". The one-time accuracy notice becomes a dismissible tooltip on that line, not a full-width banner.
- **Sticky transport bar** at the bottom on mobile; the video can shrink to a picture-in-picture so chords stay readable.
- **Keyboard:** Space play/pause · ←/→ seek one bar · [ / ] loop start/end · L loop current section · E edit · T/C transpose/capo.

### 6.4 Song — *Chord sheet*

The whole song as a readable page, synced to playback.

```
Never Gonna Give You Up           Key Db · 115 BPM · Capo 0
[Verse 1]
| Ebm7/Bb  Ab | Fm  Bbm | Ebm7/Bb  Ab | Ab  Fm  Db/Ab |
| Ebm7/Bb  Ab | Fm  Bbm | Gbmaj7/Bb  Ab | Db/Ab        |
[Chorus]
| Bbm  Db  Ab | Fm  Bbm | Bbm | Ab |
```

- The **current bar highlights** and auto-scrolls; tap any bar to seek.
- Same transpose/capo/simplify/bass-colour controls; **bars per row** adjustable live.
- This view **is** the export preview: *Export* becomes "download what you see" (PDF/TXT/ChordPro) with a **print stylesheet**.
- Optional chord-diagram strip per section ("chords used here").
- Uncertain chords/sections are shown with the same marker as the lane.

### 6.5 Edit mode

An overlay on either view, not a separate page.
- Select a bar or chord → inline popover (not a full-screen modal): top suggestions, root/quality/bass pickers, "apply to all matching", "apply to this section".
- **Drag section boundaries** on the structure bar; rename inline.
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z) for every edit.
- Edits are stored per song as *named versions*: **Original (auto)** and **My edits**; switch to compare. Re-analysis never destroys *My edits* (it offers to re-apply).
- "Report a wrong chord" (optional, anonymous) feeds future accuracy work.

### 6.6 Export & share

- **Export drawer** (not a modal): format cards, live preview, options (transpose, capo, simplify, bars per row, include diagrams, include sections).
- Formats: PDF, TXT, ChordPro, MIDI, JSON — *plus* **PNG image** (shareable chord sheet) and **print**.
- **Share link** (later phase): publishes *your* edited version at `/s/:id`; the original stays unchanged.

### 6.7 Settings drawer

Theme (system/light/dark) · chord font size · bass-note colour on/off · accidental style (♯/♭) · notation (letters, Nashville numbers, solfège) · instrument (guitar / ukulele / piano, left-handed) · practice defaults.

### 6.8 Mobile / tablet

- **Phone, portrait:** video (collapsible) → structure bar → big current chord → sticky transport. Chord sheet is a swipe-left tab.
- **Tablet landscape:** two columns — sheet on the left, video + chord on the right (music-stand mode); screen stays awake while playing.
- Tap targets ≥ 44 px; bottom-sheet pickers instead of centred modals.

---

## 7. Complete feature map

Legend: **Shipped** = exists now · **Improve** = exists, gets redesigned · **New** = not built.

### 7.1 Analysis & accuracy
| Feature | Status |
|---|---|
| Chords incl. 7ths, extensions, sus, inversions | Shipped |
| Quick / Accurate modes, background worker, cancel | Shipped |
| Song sections with guess markers | Shipped |
| Accuracy copy, re-analyze for older songs | Shipped |
| Time estimates on the progress page | **Improve** |
| Per-chord confidence shown as an overview "heat" strip | **New** |
| "Improve accuracy" one-tap upgrade, keeping My edits | **Improve** |
| Auto-detect tempo-doubling and offer half/double time | **New** |
| Detect time signature (3/4, 6/8) beyond fixed 4/4 | **New** |
| Detect key changes (modulations) | **New** |
| Repeat/loop detection ("play ×2") to shorten the sheet | **New** |
| Upload your own audio file (not only YouTube) | **New** |

### 7.2 Playing & practice
| Feature | Status |
|---|---|
| Synced player, big current/next chord, beat dots | Shipped |
| Transpose, capo, speed, simplify | Shipped |
| Loop A–B | **Improve** (loop a section in one click; drag on structure bar) |
| Structure bar: jump to any section | **New** |
| Count-in and metronome (click on the detected beat) | **New** |
| Tempo trainer (auto +5 % each loop) | **New** |
| Pitch-preserving slow-down with an independent pitch control | **New** |
| Chord quiz / "hide the chords, then check" practice mode | **New** |
| Progress memory: last position, last loop, practised time | **New** |
| Keyboard shortcuts | **New** |

### 7.3 Chord sheet
| Feature | Status |
|---|---|
| Bar grid, grouped by section | Shipped (export only) |
| Sheet as a live, synced view | **New** |
| Bass note in its own colour (toggle) | Shipped |
| Chord diagrams for guitar / piano | Shipped (current chord only) |
| Ukulele and alternate-fingering diagrams | **New** |
| Nashville numbers / solfège notation | **New** |
| Per-section chord diagram strip | **New** |
| Lyrics line-up under the chords | **New** (see §9 — legal/accuracy caveats) |
| Printable layout and PNG export | **New** |

### 7.4 Editing
| Feature | Status |
|---|---|
| Edit a chord, apply to all matching, reset | Shipped |
| Rename / move sections | Shipped |
| Undo / redo | **New** |
| Inline popover editor, edit by bar | **Improve** |
| Named versions (Original vs My edits) | **New** |
| Add/remove a chord at any beat; split/merge | **New** |
| Edits survive re-analysis | **New** |

### 7.5 Library, sharing, accounts
| Feature | Status |
|---|---|
| Shared library, title search | Shipped |
| Sort, filter by key/tempo, favourites, continue practising | **New** |
| Delete / hide a song from *my* view | **New** |
| Share link to *my edited* version | **New** |
| Setlists (ordered list of songs, key per song) | **New** |
| Optional accounts (sync favourites, edits, setlists across devices) | **New** (Phase 4) |
| Comments / suggested corrections on a public song | **New** (Phase 5) |

### 7.6 Platform
| Feature | Status |
|---|---|
| Postgres + separate worker | Shipped |
| Hosting (Render + Vercel) | Specced, not deployed |
| Installable PWA, offline for opened songs | **New** |
| Accessibility pass (colour-independent cues, focus order, ARIA) | **Improve** |
| Internationalisation (UI language; Sinhala/Tamil/etc.) | **New** |
| Analytics (privacy-friendly, opt-out) | **New** |

---

## 8. Ideas & future development

My suggestions, grouped by how much they change the product. None are committed.

### 8.1 Trust & accuracy (biggest lever for word of mouth)
- **Confidence heat strip** on the structure bar — shows *where* to listen carefully.
- **"Two opinions" mode:** run Quick and Accurate and highlight where they disagree; disagreements are the likely mistakes.
- **Learn from corrections:** with consent, store anonymous (audio fingerprint → corrected chord) pairs to evaluate and eventually fine-tune the model.
- **Benchmark page** (internal): a fixed set of songs scored after every engine change, so accuracy claims are measured, not felt.

### 8.2 Practice & learning
- **Section drills:** loop a section, raise the speed 5 % each pass, auto-stop at target.
- **Chord-change trainer:** highlight the *hardest* changes in a song (fast, unusual shapes) and loop only those.
- **Play-along scoring** (microphone): compare what you play to the chord timeline; show a simple accuracy streak. (Experimental.)
- **Capo advisor:** suggest the capo/transpose that makes the song use the easiest open shapes — computed from the chord list.
- **Simplify levels:** *Original → No extensions → Triads only → Beginner open chords*, shown as a slider with the sheet updating live.

### 8.3 Sheet & sharing
- **Setlists for gigs/worship:** order songs, set a key per song, one-tap transpose, stage mode (huge chords, dark, auto-scroll), export a whole set to one PDF.
- **Embeddable widget:** `<iframe>` of a song's synced sheet for blogs and lesson sites.
- **Teacher mode:** share a link that opens on a chosen loop with a note ("practise bars 5–8 at 70 %").
- **Print & stage view** with page-turn-friendly breaks at section boundaries.

### 8.4 Engine
- **Melody / lead-line hint** and **vocal key** (what key does the singer sit in?) for singers choosing a capo.
- **Drum / groove summary** (feel and BPM stability) to explain why beat tracking was shaky.
- **Better structure:** train a small supervised section classifier; use lyrics-free repetition plus vocal activity; add *Pre-chorus* and *Solo* labels.
- **GPU / queue scaling** for Accurate mode when hosted; priority lanes for cached re-analysis.

### 8.5 Product & community
- **Public profiles + "verified by community" badge** once accounts exist.
- **Request a song** board — see what's popular and pre-analyse it.
- **Browser extension:** a "Chords" button on YouTube watch pages that opens the song in Chordarium.
- **Mobile apps** (wrap the PWA first; native only if needed for audio latency or offline).

---

## 9. Risks & constraints (please read)

| Risk | Detail | Mitigation |
|---|---|---|
| **YouTube terms & takedowns** | Downloading audio server-side for a public hosted service may violate YouTube's terms, and downloads already fail intermittently (one of your songs currently fails with a yt-dlp error). | Legal review before public launch; keep analysis private/local-first if unresolved; support **user-uploaded audio**; cache only derived data (chords, beats), never the audio. |
| **Lyrics & copyright** | Showing lyrics, or transcribing them, can infringe copyright. | Defer lyrics; if added, user-supplied/own-material only, or link out. |
| **Accuracy expectations** | Chord recognition is not perfect; sections are heuristic and weaker on loop-based songs. | Visible confidence, editing, honest copy (already started). |
| **Shared-library moderation** | Public songs + public corrections need abuse control. | Phase 5 only; rate limits; report button; no free-text on day one. |
| **Cost** | Accurate mode (Demucs) is CPU/GPU heavy. | Queue limits, caching, optional paid tier later. |
| **Scope** | This document is large. | Phased plan in §11; each phase ships alone. |

---

## 10. Design system

### 10.1 Colour tokens (dark first, light mirrored)
| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg` | `#14110d` | `#faf7f0` | page |
| `--surface` / `--surface-2` | `#1c1712` / `#251f18` | `#ffffff` / `#f1ece0` | cards / chips |
| `--text` / `--muted` | `#ece4d4` / `#9c8f7a` | `#221c14` / `#7a6f5c` | text |
| `--accent` | `#e8934a` | `#e8934a` | primary action, active chord |
| `--bass` | `#4fc3c9` | `#0b7c86` | bass notes (shipped) |
| `--danger` | `#ff8a65` | — | errors |
| Section colours | intro/outro `#8d8fa3` · verse `#5b9bd5` · chorus `#e8934a` · bridge `#b07cd8` · interlude `#6fbf8b` | same | structure bar, sheet headings |

Rules: every colour cue has a **second cue** (label, shape, outline) — bass is also a "/" and a legend; sections also have text; guesses are also dashed + "?".

### 10.2 Typography & spacing
- Chord font: Archivo (bold, tabular), chord roots large, quality smaller, extensions raised — as today.
- Body: Inter. Base 16 px; chord sheet default 20 px, user-adjustable.
- 8-px spacing scale; 12-px radius cards; 44-px minimum touch target.

### 10.3 Components
`AnalyzeBar` · `SongCard` · `StatusLine` · `StructureBar` · `ChordLane` · `BarGrid` · `ChordHero` · `ChordDiagram` (guitar/piano/ukulele) · `Transport` · `LoopControl` · `Popover` · `Drawer` · `Toast` · `ConfidenceMark` · `SectionTag`. Most exist; `StructureBar`, `BarGrid`, `Transport`, `Drawer`, `Toast`, `Popover` are new.

### 10.4 Motion
Playhead and active chord move smoothly; respect `prefers-reduced-motion` (no scroll animation, no pulsing beat dots).

---

## 11. Technical plan

### 11.1 Frontend
- Keep React + Vite + TypeScript. Add **URL-driven state** (`?view=sheet&loop=2&speed=0.75`) so views and loops are shareable and survive refresh.
- Split the 130-line `Tracker` into a layout + hooks: `usePlayback`, `useLoop`, `useEdits` (versioned, with undo stack), `useSections`, `usePracticeProgress`.
- Replace index-based edits with **bar/beat-anchored edits** (store `{barIndex, beat, label}`) so they survive re-analysis.
- Add a tiny design-token layer (CSS variables, already in place) and a Storybook-style gallery route (`/dev/components`) for visual review.
- Code-split by route; lazy-load diagram data (`@tombatossals/chords-db`) to cut first load.
- Tests: keep Vitest + Testing Library; add Playwright smoke tests for the golden path (paste → analyze → play → loop → export).

### 11.2 API additions
| Endpoint | Purpose |
|---|---|
| `GET /api/songs?sort=&key=&bpm=&q=` | server-side search/sort once the library grows |
| `POST /api/songs/:id/versions` | save a named version of edits (later, with accounts) |
| `POST /api/share` → `/s/:shareId` | publish an edited sheet read-only |
| `POST /api/uploads` | user-supplied audio (alternative to YouTube) |
| `POST /api/feedback` | "wrong chord" reports (opt-in) |

### 11.3 Data model additions
`songs.timeline_json` gains `sections` (done), `time_signature`, `key_changes[]`, `confidence_summary`. New tables later: `shares`, `versions`, `favourites`, `setlists`, `feedback`, and `users` (Phase 4).

### 11.4 Hosting
Follow the existing hosted-platform spec (Render for API/worker/Postgres, Vercel for the client). Add: a job queue limit, a health endpoint, structured logs, daily DB backup, and an error tracker.

---

## 12. Roadmap

Each phase ships on its own. Sizes: **S** ≈ days · **M** ≈ 1–2 weeks · **L** ≈ 3+ weeks.

| Phase | Theme | Scope | Size | Done when |
|---|---|---|---|---|
| **0** | **Already done** | Sections, bass colour, accuracy notice, re-analyze, bar-grid export | — | ✅ shipped |
| **1** | **Calm the song page** | Status line instead of banners · lane never clips + zoom · structure bar (jump, click-to-loop) · sticky transport · keyboard shortcuts | M | A new user sees the video + chord immediately; no chord text is clipped at any width ≥ 360 px |
| **2** | **Chord sheet view** | Live synced sheet tab · print stylesheet · export drawer with preview · PNG export | M | The sheet you see is exactly what you download |
| **3** | **Practice tools** | One-click section loop · count-in · metronome · tempo trainer · progress memory · "continue practising" | M | A user can loop a verse at 70 % with a count-in in ≤ 3 taps |
| **4** | **Trust & editing** | Confidence heat strip · inline edit popover · undo/redo · bar-anchored edits · Original vs My edits · "improve accuracy" keeping edits | L | Re-analysis never loses edits; every edit is undoable |
| **5** | **Library & mobile** | Sort/filter/favourites · server-side search · phone and tablet layouts · PWA/offline · accessibility pass | L | Lighthouse a11y ≥ 95; usable one-handed on a phone |
| **6** | **Hosting & sharing** | Deploy · share links to *my version* · user audio upload · setlists · embeddable widget | L | A stranger can open a shared sheet and play along |
| **7** | **Accounts & community** | Optional sign-in · sync across devices · public profiles · suggested corrections · moderation | L | Favourites/edits follow you to a new device |
| **8** | **Engine upgrades** | Time-signature and key-change detection · half/double-time hint · better sections · benchmark suite | L | Measured accuracy improvement on the benchmark set |

**Recommended first step:** Phase 1. It fixes the most visible problems (§3 #1, #2, #5) with the least risk and no backend change.

---

## 13. Decisions I need from you

1. **Scope of "fully redesign":** is this phased plan what you want, or do you want one big visual redesign first (new look, same features) before Phase 1's behaviour changes?
2. **Primary audience:** solo guitarists/pianists practising, worship/band leaders (setlists), or teachers? It changes what Phase 3–6 prioritise.
3. **Hosting & YouTube:** are you comfortable launching a *public* service that downloads from YouTube, given §9? Or should we lead with private/local use and user-uploaded audio?
4. **Accounts:** stay account-free (local-first + share links) or plan on sign-in (Phase 7)?
5. **Lyrics:** off the table, own-material only, or link-out?
6. **Languages:** English only for now, or Sinhala/other UI languages early (your library suggests Sinhala songs)?
7. **Name & look:** keep the warm dark/amber identity, or open to a new visual direction?

---

## 14. Success measures

- **Time to first chord:** paste → seeing a synced chord ≤ 45 s on Quick (cached: ≤ 3 s).
- **Trust:** share of users who open *Edit* on a song (healthy if > 15 %, shows they are checking) and who use *Improve accuracy*.
- **Practice:** median loops per session; return visits within 7 days.
- **Quality:** benchmark chord accuracy and section-boundary F-score tracked per engine release.
- **Accessibility:** Lighthouse a11y ≥ 95; keyboard-only completion of the golden path.
- **Reliability:** analysis success rate ≥ 95 % (excluding private/removed videos).

---

*Appendix — related documents:* [Hosted platform design](superpowers/specs/2026-09-27-chordarium-hosted-platform-design.md) · [Chord recognition model & workflow](chord-recognition-model.md) · [Original design](superpowers/specs/2026-09-26-chordarium-design.md)
