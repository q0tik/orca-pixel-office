"""Draws the plugin icon (a pixel person at a desk with a lit monitor) as a 256x256 PNG.

No dependencies: a 32x32 character map, scaled 8x, written with zlib. Run:
    python3 tools/make_icon.py plugin/assets/icon.png
"""
import struct
import sys
import zlib

PALETTE = {
    ".": (0x1e, 0x1b, 0x2e),  # background wall
    "w": (0x2b, 0x27, 0x42),  # wall stripe
    "f": (0x5a, 0x3e, 0x2b),  # floor
    "F": (0x4a, 0x32, 0x22),  # floor seam
    "d": (0xc8, 0x8a, 0x4c),  # desk top
    "D": (0x8c, 0x5a, 0x2e),  # desk front
    "m": (0x3a, 0x3f, 0x4f),  # monitor frame
    "s": (0x49, 0xe0, 0xa8),  # screen glow
    "S": (0x2a, 0x9d, 0x76),  # screen line
    "h": (0x2a, 0x1a, 0x10),  # hair
    "k": (0xf2, 0xc1, 0x96),  # skin
    "b": (0x4c, 0x7d, 0xf0),  # shirt
    "B": (0x35, 0x5c, 0xb8),  # shirt shade
    "c": (0x25, 0x25, 0x30),  # chair
    "p": (0x6b, 0x4f, 0x9e),  # plant pot
    "g": (0x5c, 0xb8, 0x5c),  # plant leaves
}

ROWS = [
    "................................",
    "................................",
    "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
    "................................",
    "................................",
    "................................",
    "...............mmmmmmmmmmmm.....",
    "...............mssssssssssm.....",
    "...............msSSSSsSSssm.....",
    "...............mssssssssssm.....",
    "......hhhh.....msSSsSSSSssm.....",
    ".....hhhhhh....mssssssssssm.....",
    ".....hhhhkk....msSSSsSSsssm..g..",
    ".....hhhkkk....mssssssssssm.ggg.",
    ".....hhhkkk....mmmmmmmmmmmm..g..",
    "......hkkk.........mmmm.....ggg.",
    ".......kk..........mmmm......g..",
    "....cbbbbbb....................",
    "....cbbbbbbbkkdddddddddddddd.ppp",
    "....cbBbbbbbbkdddddddddddddd.ppp",
    "....cbBbbbbb..DDDDDDDDDDDDDD.ppp",
    "....cbBbbbbb..DD..........DD.ppp",
    "....cccccccc..DD..........DD....",
    ".......c......DD..........DD....",
    "ffffffcfffffffDDffffffffffDDffff",
    "fffffcccffffffDDffffffffffDDffff",
    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    "ffffffffffffffffffffffffffffffff",
    "ffffffffffffffffffffffffffffffff",
    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    "ffffffffffffffffffffffffffffffff",
    "ffffffffffffffffffffffffffffffff",
]

SCALE = 8


def png(path: str) -> None:
    size = 32 * SCALE
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        row = ROWS[y // SCALE].ljust(32, ".")
        for x in range(size):
            raw.extend(PALETTE[row[x // SCALE]])

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    with open(path, "wb") as out:
        out.write(b"\x89PNG\r\n\x1a\n")
        out.write(chunk(b"IHDR", header))
        out.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        out.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    png(sys.argv[1] if len(sys.argv) > 1 else "plugin/assets/icon.png")
