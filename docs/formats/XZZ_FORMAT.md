# XZZ PCB (Encrypted Boardview) File Format Specification

> Reverse-engineered with reference to the [OpenBoardView](https://github.com/OpenBoardView/OpenBoardView) source.

---

## Overview

XZZ is an encrypted binary boardview format. The file contains DES-encrypted **part** blocks plus
plaintext geometry blocks (nets, vias, traces, arcs, test pads, board outline). The header may be
XOR-obfuscated.

| Property | Value |
|----------|-------|
| Extension | `.pcb` |
| Detection | First 6 bytes = `XZZPCB` (plain or XOR-obfuscated) |
| Encryption | DES (FIPS PUB 46-3), ECB mode — Part (`0x07`) blocks only (verified) |
| DES key | `0xdcfc12ac00000000` (fixed, hardcoded) |
| Coordinate unit | Internal units ÷ 10000 = mils |
| XOR obfuscation key | Byte at offset `0x10` |

### `.pcb` extension collision — Mentor PADS Layout binary

The `.pcb` extension is also used by **Mentor PADS Layout (PowerPCB) native binary
design files**, which are an entirely different and unsupported format (the PADS
database, not a boardview). They begin with the 10-byte signature `00 FF 26 20`
followed by six zero bytes and carry PADS markers in the body (`DOC_PARTTYPES`,
`DOC_PADS`, `DOC_VIAS`, `STANDARDVIA`). `isPadsBinaryHeader()` recognises them so
both `XZZFormat.detect()` and `parseXZZ()` reject them up-front with a clear
"this is a PADS Layout binary, not a boardview" message — otherwise the `.pcb`
extension fallback would hand them to the XZZ parser, which XOR-mangles the bytes
(PADS files have a non-zero byte at `0x10`) and dies on "invalid header offsets".
Even FlexBV does not open these; the binary PADS database is left unsupported.

---

## File Structure

### Header

```
┌─────────────────────────┐
│ 6 bytes: "XZZPCB" magic │  (may be XOR-obfuscated)
├─────────────────────────┤
│ Header fields            │  file metadata, block offsets
│  (variable layout)       │
└─────────────────────────┘
```

Fields actually read by the parser (little-endian `u32`, offsets absolute from file start):

| Offset | Field | Notes |
|--------|-------|-------|
| `0x00` | `"XZZPCB"` magic (6 bytes) | Plain or XOR'd |
| `0x10` | XOR key byte | `0` ⇒ file is not XOR'd |
| `0x20` | `mainDataOffset` | Main data block start = `mainDataOffset + 0x20` |
| `0x28` | `netDataOffset` | Net block start = `netDataOffset + 0x20` |

#### XOR Obfuscation

If the first 6 bytes don't spell `XZZPCB` in plain text, the file is XOR-obfuscated:
- XOR key = byte at offset `0x10`
- Apply `byte ^ key` to each byte from the start up to the `v6v6555v6v6` diode-channel
  marker (or EOF if absent) to recover plain text
- Verify by checking if decoded bytes 0–5 = `XZZPCB`

The pass stops at the marker deliberately: the post-`v6` diode table (see below) is already
plaintext in the source file and must not be re-XOR'd.

### Data Blocks

After the header, the main data region carries a `u32` size prefix followed by sequential
`[type:u8][size:u32][payload]` blocks. **Only `0x07` (Part) blocks are DES-encrypted; every other
block type is stored as plaintext** (verified — only `case 0x07` calls `desDecrypt()`; the via, arc,
segment, testpad and net handlers all read fields straight out of the raw buffer).

| Type | Name | Notes |
|------|------|-------|
| `0x01` | Arc | Layer, centre, radius, start/end angle |
| `0x02` | Via | Drill + annular ring + net |
| `0x03` | Unknown | Centre + bounding-box corners, then two `u32` fields never observed non-zero |
| `0x04` | Unused | Empty payload in every surveyed file |
| `0x05` | Line segment | Outline (layer 28), silkscreen (17) or copper trace (1–16); also nested in Part blocks as the body outline |
| `0x06` | Text/label | Silkscreen text; also nested in Part blocks as RefDes / BOM value |
| `0x07` | Part | **DES-encrypted.** Component + embedded pin/label/silkscreen sub-blocks |
| `0x08` | Unused | Empty payload in every surveyed file |
| `0x09` | Test pad | Top-level: a probe point ("nail"). Nested in a Part block: a **pin** |

A `0x00` byte at the top level is 4-byte alignment padding, not a block header.

---

## Encryption

### DES Parameters

- Algorithm: DES (Data Encryption Standard, FIPS PUB 46-3)
- Mode: ECB (each 8-byte block encrypted independently)
- Key: `0xdcfc12ac00000000` (64-bit, fixed) — bytes `DC FC 12 AC 00 00 00 00`
- Decryption: standard 16-round Feistel network with reversed subkey order
- Scope: **Part (`0x07`) blocks only** (verified against real payloads with a standalone
  pycryptodome probe — decrypting only those bytes reproduces the exact field layout the
  parser already extracts)

### Block Decryption

Each Part block is decrypted as a sequence of 8-byte DES blocks. Trailing bytes (< 8) are
left as-is.

---

## Data Structures

### Net Block

Sequential entries, each containing:

```
┌──────────────┐
│ u32: netSize  │  Total entry size in bytes, inclusive of this header
├──────────────┤
│ u32: netIndex │  Net identifier (referenced by pins and vias)
├──────────────┤
│ name bytes    │  netSize - 8 bytes, not null-terminated
└──────────────┘
```

### Part Block (`0x07`)

After DES decryption. **(verified)** The 18 bytes previously logged as "unknown" are the
hexpat's field breakdown, confirmed by decrypting real part blocks:

```
┌───────────────────────────┐
│ u32: partSize              │  Inclusive of this field; endPtr = partSize + 4
├───────────────────────────┤
│ u32: alwaysSeen01          │  Always 1 — flag or version?
│ i32: part_x                │  Part origin X, ÷ 10000 = mils
│ i32: part_y                │  Part origin Y, ÷ 10000 = mils
│ u32: part_rotation         │  Part rotation, ÷ 10000 = degrees
│ u8:  flag1                 │  Always 1 in every surveyed file
│ u8:  flag2                 │  Always 0 in every surveyed file
├───────────────────────────┤
│ u32: padSizeLen            │
│ char padSize[padSizeLen]   │  Package/footprint code, e.g. "C-0201", "R-0402"
├───────────────────────────┤
│ Sub-blocks...              │  [tag:u8][…] stream, tags 0x01 / 0x05 / 0x06 / 0x09
└───────────────────────────┘
```

Two corrections to the earlier reading of this header:

- **It carries real position/rotation the parser ignores.** `parsePartBlock` keeps those 18 bytes
  as an opaque `unk1` blob and instead *derives* position (pin centroid) and rotation (majority
  vote over per-pin `padAngleDeg`) later in the pipeline — see Side & Rotation Resolution.
  `part_x`/`part_y` land exactly on the pin centroid, and `part_rotation` takes many
  non-axis-aligned values (one Switch 2 board: 0, 90, 105, 135, 180, 225, 270, 360), so these are
  real independent fields. They have **not** been cross-validated against the renderer's angle
  convention, and the derived pipeline is shipped and working, so this is recorded as a follow-up
  opportunity rather than a change.
- **`groupNameLen`/`groupName` is the package code.** Same bytes as the hexpat's `pad_size`;
  verified content is footprint strings like `C-0201`, not a semantic group name. The TS field is
  still named `groupName` in `PartData` (renaming it is an unrelated refactor) but should be read
  as the package/footprint string.

**The RefDes is just the first `0x06` label sub-block**, not a dedicated header field: the
"`0x06` marker + 30 bytes unknown + nameLen + partName" shape is byte-for-byte the generic
text/label sub-block used elsewhere in the format. Verified — the byte immediately after the
decoded `partName` is again `0x06`, i.e. the sub-block stream simply continues. A second `0x06`,
when present, frequently carries the **BOM value** (e.g. "100K", "10uF") on parts re-exported
from Cadence/PADS sources.

### Pin Sub-Block (`0x09`, inside a Part block)

```
┌──────────────────┐
│ u32: pinBlockSize │
├──────────────────┤
│ 4 bytes: unknown  │
├──────────────────┤
│ i32: x            │  Pin X position (÷ 10000 for mils)
│ i32: y            │  Pin Y position (÷ 10000 for mils)
├──────────────────┤
│ u32: innerDiameter│  0 for SMD pads; non-zero ⇒ through-hole, value = drill
│                   │  diameter ÷ 10000 = mils (verified — see below)
│ u32: padAngle     │  Pad rotation in degrees CCW (÷ 10000)
├──────────────────┤
│ u32: nameLen      │
│ name bytes        │  Pin name (not always numeric — join key for diode readings)
├──────────────────┤
│ 27 bytes: pad geom│  3 × (u32 padW, u32 padH, u8 shape) — three identical
│                   │  copies (top/inner/bottom?); w/h ÷ 10000 for mils;
│                   │  shape 0x01 = round, 0x02 = rect
├──────────────────┤
│ 5 bytes: padding  │
├──────────────────┤
│ u32: netIndex     │  Reference into net block
└──────────────────┘
```

**Through-hole pins (verified).** The field previously documented as `u32: zero` / "constant 0" is
a drill diameter, and it is genuinely non-zero on a small subset of pins per board — always on
round pads, always smaller than the pad's own width/height (the physical annular-ring vs. drill
relationship), in the same units as everything else:

| Board | Part | Pin | Pad (w×h, mil) | Inner diameter (mil) |
|-------|------|-----|-----------------|----------------------|
| Switch (`HAC-CPU-20`, in `samples/`) | `N575`/`N578`/`N581` | 1 | 71 × 20 @ 90° | 12 |
| Switch v1/v2 (`HAC-CPU-10`) | `C-10-21` | 1–4 | 80 × 30 | 16 |
| Switch v1/v2 (`HAC-CPU-10`) | `C-10-21` | 9–10 | 58 × 58 | 33 |
| MacBook Pro M3 (`A2992 820-02918`) | `A-20` | 5–12 | 28 × 28 | 15 |

Non-zero readings appear only on pins nested inside Part blocks (connector/header legs), never on
top-level test pads. The parser currently skips the field (`ptr += 4; // u32 = 0 (constant)`), so
every XZZ pin is treated as SMD regardless of what the file says. Classifying `innerDiameter > 0`
as through-hole and surfacing the drill diameter is tracked as follow-up work.

**The pad-geometry block is really a terminated list, not a fixed 27 bytes.** The hexpat models it
as repeated `(width, height, type)` records read until a 5-byte terminator, `type` being `0x00`
(end), `0x01` (round) or `0x02` (rect). Every pin sampled so far carries exactly 3 records before
the terminator, which is why "read 3, skip 5" is safe today — but a file with 1, 2 or 4+ records
would silently misalign under the fixed-size read.

**Oblong pads (shape 0x01 with w ≠ h).** Shape `0x01` is not strictly a circle: with w ≠ h it
encodes a round-capped stroke (stadium). The **shorter** of w/h is the pen width and the **longer**
is the stroke length, rotated by `padAngle` CCW — there is no fixed axis. The surveyed MECHREVO
corpus (PL5TU1B) writes a constant 15-mil pen with lengths 1–350 mil. Renderer draws these as
rotated capsules (`capsuleParams` in `renderer/pad-capsule.ts`). Three caveats, handled by
`normalizeOblongPads` in the parser (run before the butterfly fold):

1. **Bogus lengths on BGA perimeter rings.** CPU1's outer 2–3 ball rings
   carry 15×300/350 entries that would cross a dozen neighbouring balls;
   the vendor's own assembly drawing shows plain 15-mil dots there
   (probably escape-stub metadata, not pad copper).
2. **One angle per part.** The exporter stamps a single `padAngle` on every
   pin of a part, but a QFP's top/bottom leads are physically perpendicular
   to its left/right leads (EC1: all 128 pins say 270°).
3. **Either axis can be the pen.** Real pads exist with w > h — `HAC-CPU-20`'s connector
   mounting legs are 71×20 mil through-hole pads. An earlier guard assumed `w` was always the
   pen and collapsed anything with h ≤ w as a "degenerate stroke", flattening those into 71-mil
   dots. Working in min/max terms makes "length shorter than pen" impossible by construction.

The guard is physical — copper pads of different pins can never overlap:
an oblong is kept at its declared angle if it touches no same-part
neighbour's pen circle, else retried at +90° (fixes the QFP sides), else
collapsed to a pen-width round dot. A majority pass then collapses
gap-threading stragglers of a mostly-bogus (w, h) group (CPU1 pin W1).

**Placeholder pad geometry.** Some exports — all surveyed M2-era Apple board
files (820-02773, 820-02862, and the `-H`/`-L` CPU variants of 820-02098 /
820-02100 / 820-02382) — write the SAME pad geometry on every pin of the file:
12×12 mil, shape `round`, angle 0. This is exporter filler, not real pad data
(a 125-mil coil pad and a BGA ball get the identical 12-mil dot). Real-geometry
files carry 180+ distinct sizes, so the two populations are cleanly separable.
The parser detects the placeholder (≥100 geometry-carrying pins, every one
sharing a single identical `(w, h, shape, angle)`, shape round, w = h) and
drops pad geometry entirely for that file — pins fall back to the classic
radius-8 dot and the renderer synthesizes the classic FlexBV 2-pin pads.

### Via Block (`0x02`)

`i32 x, i32 y, u32 outer, u32 drill, u32 layerFrom, u32 layerTo, u32 netIndex, u32 padding` —
plaintext. `drill` is parsed but unused; the renderer derives the drawn hole as a fixed ratio of
the outer ring instead. **`layerFrom`/`layerTo` are genuine copper-layer indices (verified):**
HAC-CPU-20's 2559 vias span 25 distinct pairs, always `from < to`, with every value used (1–5, 7–9,
16) also present in that board's trace-segment layers — real blind/buried spans. The constant
`1`/`5` seen across the earlier Apple-only corpus was a property of that corpus, not the format.
The parser still skips both fields and leaves `Via.layers` empty, so every via renders as
through-hole — now a known gap rather than an open question.

### Test Pad Block (`0x09`, top-level — "nails")

Same tag and header shape as the Pin sub-block, but at the top level and not encrypted:
`u32 padNumber, i32 x, i32 y, u32 innerDiameter, u32 unknown, u32 nameLen, name…, u32 netIndex`.
The parser reads position and the trailing net index only; `innerDiameter` is 0 in every surveyed
file. Rendered as `nails`, always emitted with `side: 'top'` regardless of the probe point's
physical side.

---

## Board Outline

The outline is constructed from line segments (and linearized arcs) on layer 28 (`OUTLINE_LAYER`).
Segments are chained into a polygon using a greedy nearest-neighbor algorithm:
1. Start with segment 0
2. For each subsequent segment, find the nearest unvisited endpoint
3. Append the far endpoint to the chain

**Multi-board packs.** Files with ≥4 outline components (an even count) that all pair off by
identical `(width, height, segCount)` are treated as a multi-board pack — e.g. a combined iPhone
AP+BB boardview, each physical board unfolded into top+bottom halves side-by-side. These must not
be globally folded: a per-board fold axis is stored per group (`boardGroups`) and applied lazily
when the user selects a board.

---

## Coordinate System

- Raw coordinates are signed 32-bit integers
- Divide by 10000 (`XZZ_SCALE`) to get mils
- The `flipY` flag is enabled for this format

---

## Side & Rotation Resolution

XZZ stores top and bottom unfolded, side-by-side, in one coordinate space; there is no per-part
side field the parser trusts (see the Part Block header note above).

- **Fold axis / side.** `findFoldAxis()` assumes the part with the most pins (CPU/SoC) is on top
  and lets its centroid pick the top half. Fallback: with ≥5 test pads and ≥8 parts, the half
  holding more than 1.5× the test pads is top (probing happens from the component side).
  Default: the lower-coordinate half (XZZ Y increases downward). Parts in the bottom half get
  their pins and silkscreen mirrored across the axis and are tagged `side: 'bottom'`.
- **Part rotation.** `resolvePartRotation()` buckets each geometry-carrying pin's `padAngleDeg`
  modulo 90° and takes the majority bucket at ≥70% agreement. **Axis-aligned override:** if ≥2
  pins sit on a horizontal edge of the part's bounding box *and* ≥2 on a vertical edge, the part
  is forced axis-aligned regardless of pad angles — some chips have an axis-aligned body with pads
  drawn at 45°, and trusting the pad angles produced diagonal selection outlines on parts whose
  silkscreen was plainly straight-edged.

---

## Parser Notes

- Pin radius defaults to 7 mils.
- Nets resolving to the literal names `NC` or `UNCONNECTED` are mapped to an empty net string so
  they aren't pulled into trace/net highlighting.
- Arc angles are stored as `degrees × 10000` — the same scale as coordinates, not `degrees × 10`.
  OpenBoardView's reference (`XZZPCBFile.cpp:258-260`) divides by the same global scale. An earlier
  implementation here used the wrong divisor and produced "star burst" outline corruption on iPhone
  boards; noted because a divisor this plausible-looking is easy to reintroduce.
- The DES implementation uses precomputed SP (S-box + P permutation) lookup tables and
  byte-level IP/FP permutation tables for performance.
- BigInt is used only for one-time key schedule computation at module initialization.

---

## Diode-Value Channel (post-`v6` table)

XZZ ships companion `.pcb` files named `… Middle layer diode value-<board>.pcb`
that carry reference ("golden board") **diode-mode multimeter readings**. The
readings are **not** geometry — they live in a plaintext table appended after
the `v6v6555v6v6` XOR-boundary marker (so they are never XOR'd or DES'd), past
the net block.

```
v6v6555v6v6===<4 binary bytes>\n
=359=N47(21)
=0=N47(31)
=OL=N46(1)
=732=N47(7)
…
```

- Grammar: newline-delimited `=<value>=<partName>(<pinNumber>)`, **one record
  per pin**.
- Value classes: integer **millivolts** (e.g. `359`), `OL` (open / infinite), and `0` — which here
  is a *real* measurement (a short to ground), not "not measured". A rare malformed token like
  `312.` is tolerated (trailing dot stripped).
- Join key `PART(pinNumber)` maps 1:1 onto the parser's pins — this is why the
  parser now preserves the real pad number (`Pin.number`) instead of a 1-based
  index.

`parseDiodeSection()` returns `Map<"PART(PIN)", DiodeReading>`; the join stamps
`Pin.diode` and sets `BoardData.diodeReference` (counts + match diagnostics).
Normal boardviews have no marker → empty map → no channel. The readings are
surfaced on-pin (toggleable overlay), in the hover tooltip, and in the
ComponentInfo pin table; OpenBoardData provides a second, per-net source feeding
the same surfaces (see `store/diode-readings.ts`).

**Zero means opposite things in the two sources.** OBD readings are volts (×1000 to normalise to
mV) and their `0` means "not measured" (suppressed as `kind: 'none'`), whereas an XZZ `0` is a
measurement. `primaryDiodeReading()` therefore lets any XZZ reading — including a measured zero —
win over OBD; OBD only fills in where XZZ is silent.
