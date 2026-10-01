# PDF export fonts

| File | What | Licence |
|---|---|---|
| `Archivo-Regular/Medium/SemiBold/Bold.ttf` | Static cuts (normal width) of the Archivo variable font | SIL Open Font License 1.1 (Archivo, by Omnibus-Type) |
| `DejaVuSans-Bold-Accidentals.ttf` | DejaVu Sans Bold reduced to ♭ ♮ ♯ and the degree sign | Bitstream Vera / DejaVu licence (free to use, embed and redistribute) |

Both are embedded (subsetted) into the generated PDFs. If a file is missing, the export falls back to Helvetica
and still works. Rebuild them with `python scripts/make_pdf_fonts.py`.
