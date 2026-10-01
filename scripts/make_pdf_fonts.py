"""Rebuild the static fonts used by the PDF export (server/export/fonts). Only needed if you change them.

    pip install fonttools brotli matplotlib
    python scripts/make_pdf_fonts.py

Archivo comes from the variable web font the client already bundles (client/src/assets/fonts/archivo-latin.woff2),
cut into four static weights at normal width. ReportLab cannot use variable fonts, and each weight needs its own
PostScript name or PDF viewers reuse one weight for all of them. DejaVu Sans Bold (from matplotlib) is cut down to
the music accidentals, because Archivo has no flat or sharp signs.
"""
import io
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "server" / "export" / "fonts"
WOFF2 = ROOT / "client" / "src" / "assets" / "fonts" / "archivo-latin.woff2"
WEIGHTS = (("Regular", 400), ("Medium", 500), ("SemiBold", 600), ("Bold", 700))


def build_archivo() -> None:
    for name, weight in WEIGHTS:
        static = instancer.instantiateVariableFont(TTFont(str(WOFF2)), {"wght": weight, "wdth": 100})
        static.flavor = None
        for platform in ((3, 1, 0x409), (1, 0, 0)):
            table = static["name"]
            table.setName("Archivo", 1, *platform)
            table.setName(name, 2, *platform)
            table.setName(f"Archivo-{name}", 3, *platform)
            table.setName(f"Archivo {name}", 4, *platform)
            table.setName(f"Archivo-{name}", 6, *platform)
        static.save(str(OUT / f"Archivo-{name}.ttf"))


def build_accidentals() -> None:
    import matplotlib

    source = Path(matplotlib.get_data_path()) / "fonts" / "ttf" / "DejaVuSans-Bold.ttf"
    opts = subset.Options()
    opts.layout_features = []
    opts.name_IDs = ["*"]
    font = subset.load_font(io.BytesIO(source.read_bytes()), opts)
    subsetter = subset.Subsetter(opts)
    subsetter.populate(unicodes=[0x266D, 0x266E, 0x266F, 0x00B0, 0x0020])  # flat, natural, sharp, degree, space
    subsetter.subset(font)
    subset.save_font(font, str(OUT / "DejaVuSans-Bold-Accidentals.ttf"), opts)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_archivo()
    build_accidentals()
    print("fonts written to", OUT)
