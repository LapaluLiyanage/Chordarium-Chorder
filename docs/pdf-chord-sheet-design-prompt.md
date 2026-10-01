# Prompt: design the Chordarium PDF chord sheet

Copy everything below the line into your design tool or AI assistant.

---

Design a printable **A4 PDF chord sheet** for Chordarium, an app that turns a YouTube song into synced chords.
The sheet is for a musician reading it on a music stand or printed page, so **clarity at arm's length beats decoration**.

## What the page must show
1. **Header:** song title (can be long, e.g. "Dr.Victor Rathnayake Melodies Medley by Sarith & Surith | Jaana | Hiru TV"), then one line: key · tempo (BPM) · time signature · capo (only if set). Under it, a small grey note: "Chords and sections were detected automatically and may contain errors."
2. **Sections** in song order (Intro, Verse 1, Chorus, Bridge, Interlude, Outro). Each starts with a coloured label pill and a small "N bars" count at the right.
3. **Bars** laid out in a grid of 4 per row (the user can switch to 2 or 8). **Each bar is its own box**; the gap between boxes is the bar line.
4. **Chords inside a bar:** a bar can hold 1 to 4 chords. Give each chord space in proportion to how many beats it lasts (4/4: a chord for 2 beats gets half the bar), separated by a thin dashed divider. Draw a small beat ruler (one tick per beat) along the bottom edge of the box.
5. **Slash chords** like D7/F#: the chord in dark ink, the bass note (/F#) in teal so the bass is easy to spot.
6. **Footer** on every page: "Chordarium" left, "Page n" right.
7. **Chord legend** on the last page: each chord used and its notes (e.g. "Cm7: C Eb G Bb").

## Hard requirements
- **Chord names must never overlap or be clipped.** If a bar has several long chords (Bbm7, Gbmaj7, Ebm7), shrink the type for that whole bar (never below about 6 pt) instead of letting names collide.
- Keep a section heading with at least one row of its bars (no heading alone at the bottom of a page).
- A long title wraps over two lines at about 16 pt rather than running off the page.
- Must still read well **printed in black and white**: colour is extra, never the only cue.
- Pure vector output, no screenshots; selectable text.

## Visual direction
- Warm, calm, high-contrast. Ink `#231d17` on cream bar boxes `#f4eee3` with a thin `#b9ad9c` edge and 2 mm rounded corners; white page.
- Chord type: a bold grotesque (Archivo, or Helvetica Bold as the fallback), 14 pt for a normal bar.
- Section pill colours: Intro `#f2c14e`, Verse `#6aa8e0`, Chorus `#f2913d`, Bridge `#b48be0`, Interlude `#ee8577`, Outro `#6fbf8b`. Bass note teal `#0b7c86`.
- Generous space: 14 mm margins, bars about 15 mm tall, about 2 mm between boxes.

## Edge cases to design for
A song with no detected sections (one block, no pills) · a bar with no chord ("N.C.") · 8 bars per row (narrower boxes) · a song with 150+ bars (multiple pages) · very long chord names (Gbmaj7/Bb, Bbm7/Ab).

## Deliver
A one-page layout mock-up of the first page, plus the spacing, sizes and colours as a short spec a developer can implement in ReportLab.
