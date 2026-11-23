package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
)

const appManifestXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="0.1.1.0" processorArchitecture="amd64" name="DariusCumpio.GenMeet" type="win32"/>
  <description>GenMeet Real-Time WebRTC Meetings</description>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
`

func lerp(a, b, t float64) uint8 {
	v := a + (b-a)*t
	if v < 0 {
		v = 0
	}
	if v > 255 {
		v = 255
	}
	return uint8(math.Round(v))
}

func distToSegment(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	lenSq := dx*dx + dy*dy
	if lenSq == 0 {
		return math.Hypot(px-ax, py-ay)
	}
	t := ((px-ax)*dx + (py-ay)*dy) / lenSq
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	return math.Hypot(px-(ax+t*dx), py-(ay+t*dy))
}

func pointInPoly(px, py float64, poly [][2]float64) bool {
	inside := false
	j := len(poly) - 1
	for i := 0; i < len(poly); i++ {
		xi, yi := poly[i][0], poly[i][1]
		xj, yj := poly[j][0], poly[j][1]
		if ((yi > py) != (yj > py)) && (px < (xj-xi)*(py-yi)/(yj-yi+1e-12)+xi) {
			inside = !inside
		}
		j = i
	}
	return inside
}

func renderIcon(size int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	scale := float64(size) / 48.0

	wing := [][2]float64{
		{32.5, 20.0},
		{40.0, 16.5},
		{40.0, 31.5},
		{32.5, 28.0},
	}

	for py := 0; py < size; py++ {
		for px := 0; px < size; px++ {
			var rSum, gSum, bSum, aSum float64
			for sy := 0; sy < 2; sy++ {
				for sx := 0; sx < 2; sx++ {
					x := (float64(px) + 0.25 + 0.5*float64(sx)) / scale
					y := (float64(py) + 0.25 + 0.5*float64(sy)) / scale

					cx, cy := math.Abs(x-24.0), math.Abs(y-24.0)
					qx, qy := cx-(22.0-13.0), cy-(22.0-13.0)
					sd := math.Hypot(math.Max(qx, 0), math.Max(qy, 0)) + math.Min(math.Max(qx, qy), 0) - 13.0
					if sd > 0.5 {
						continue
					}

					t := math.Max(0, math.Min(1, ((x-4.0)+(y-4.0))/80.0))
					var r, g, b float64
					if t < 0.55 {
						u := t / 0.55
						r = float64(lerp(29, 26, u))
						g = float64(lerp(78, 115, u))
						b = float64(lerp(216, 232, u))
					} else {
						u := (t - 0.55) / 0.45
						r = float64(lerp(26, 6, u))
						g = float64(lerp(115, 182, u))
						b = float64(lerp(232, 212, u))
					}

					gx, gy := x-19.0, y-24.0
					rad := math.Hypot(gx, gy)
					ang := math.Atan2(gy, gx)
					inGArc := (ang <= -math.Pi/4 || ang >= 0) && math.Abs(rad-9.5) <= 1.9
					cap1 := math.Hypot(x-25.72, y-17.28) <= 1.9
					cap2 := distToSegment(x, y, 21.5, 24.0, 28.5, 24.0) <= 1.9

					if inGArc || cap1 || cap2 {
						r, g, b = 255, 255, 255
					} else if pointInPoly(x, y, wing) {
						r, g, b = 153, 246, 228
					}

					rSum += r
					gSum += g
					bSum += b
					aSum += 255.0
				}
			}

			if aSum > 0 {
				count := aSum / 255.0
				img.SetNRGBA(px, py, color.NRGBA{
					R: uint8(math.Round(rSum / count)),
					G: uint8(math.Round(gSum / count)),
					B: uint8(math.Round(bSum / count)),
					A: uint8(math.Round(aSum / 4.0)),
				})
			}
		}
	}
	return img
}

func encodePNG(img image.Image) []byte {
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

// encodeIconDIB encodes a 32-bit BGRA icon DIB (BITMAPINFOHEADER + bottom-up XOR BGRA + AND mask)
// so Windows Explorer renders crisp icons at 16, 32, 48, and 64px across every DPI scale.
func encodeIconDIB(img *image.NRGBA) []byte {
	w := img.Bounds().Dx()
	h := img.Bounds().Dy()
	andRowBytes := ((w + 31) / 32) * 4
	xorSize := w * h * 4
	andSize := andRowBytes * h

	var buf bytes.Buffer
	// BITMAPINFOHEADER (40 bytes)
	_ = binary.Write(&buf, binary.LittleEndian, uint32(40))        // biSize
	_ = binary.Write(&buf, binary.LittleEndian, int32(w))          // biWidth
	_ = binary.Write(&buf, binary.LittleEndian, int32(h*2))        // biHeight (XOR + AND)
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1))         // biPlanes
	_ = binary.Write(&buf, binary.LittleEndian, uint16(32))        // biBitCount
	_ = binary.Write(&buf, binary.LittleEndian, uint32(0))         // biCompression (BI_RGB)
	_ = binary.Write(&buf, binary.LittleEndian, uint32(xorSize+andSize))
	_ = binary.Write(&buf, binary.LittleEndian, int32(0))
	_ = binary.Write(&buf, binary.LittleEndian, int32(0))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(0))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(0))

	// XOR mask: bottom-up BGRA
	for y := h - 1; y >= 0; y-- {
		for x := 0; x < w; x++ {
			c := img.NRGBAAt(x, y)
			buf.WriteByte(c.B)
			buf.WriteByte(c.G)
			buf.WriteByte(c.R)
			buf.WriteByte(c.A)
		}
	}

	// AND mask: bottom-up 1bpp (1 = transparent where alpha == 0)
	andRow := make([]byte, andRowBytes)
	for y := h - 1; y >= 0; y-- {
		clear(andRow)
		for x := 0; x < w; x++ {
			if img.NRGBAAt(x, y).A == 0 {
				andRow[x/8] |= 1 << (7 - uint(x%8))
			}
		}
		buf.Write(andRow)
	}
	return buf.Bytes()
}

type iconFrame struct {
	size int
	data []byte
}

func buildIconFrames() []iconFrame {
	var frames []iconFrame
	for _, s := range []int{16, 32, 48, 64} {
		frames = append(frames, iconFrame{size: s, data: encodeIconDIB(renderIcon(s))})
	}
	frames = append(frames, iconFrame{size: 256, data: encodePNG(renderIcon(256))})
	return frames
}

func writeICO(path string, frames []iconFrame) error {
	var out bytes.Buffer
	_ = binary.Write(&out, binary.LittleEndian, uint16(0))
	_ = binary.Write(&out, binary.LittleEndian, uint16(1))
	_ = binary.Write(&out, binary.LittleEndian, uint16(len(frames)))

	offset := uint32(6 + 16*len(frames))
	for _, f := range frames {
		dim := uint8(f.size)
		if f.size >= 256 {
			dim = 0
		}
		out.WriteByte(dim)
		out.WriteByte(dim)
		out.WriteByte(0)
		out.WriteByte(0)
		_ = binary.Write(&out, binary.LittleEndian, uint16(1))
		_ = binary.Write(&out, binary.LittleEndian, uint16(32))
		_ = binary.Write(&out, binary.LittleEndian, uint32(len(f.data)))
		_ = binary.Write(&out, binary.LittleEndian, offset)
		offset += uint32(len(f.data))
	}
	for _, f := range frames {
		out.Write(f.data)
	}
	return os.WriteFile(path, out.Bytes(), 0o644)
}

func buildGroupIconData(frames []iconFrame) []byte {
	var buf bytes.Buffer
	_ = binary.Write(&buf, binary.LittleEndian, uint16(0))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(len(frames)))

	for i, f := range frames {
		dim := uint8(f.size)
		if f.size >= 256 {
			dim = 0
		}
		buf.WriteByte(dim)
		buf.WriteByte(dim)
		buf.WriteByte(0)
		buf.WriteByte(0)
		_ = binary.Write(&buf, binary.LittleEndian, uint16(1))
		_ = binary.Write(&buf, binary.LittleEndian, uint16(32))
		_ = binary.Write(&buf, binary.LittleEndian, uint32(len(f.data)))
		_ = binary.Write(&buf, binary.LittleEndian, uint16(i+1)) // RT_ICON resource ID
	}
	return buf.Bytes()
}

type resLeaf struct {
	resType uint32
	resID   uint32
	langID  uint32
	data    []byte
}

// buildCOFFRsrcSyso serializes Windows PE resources into a standard x64 COFF .syso file
// that `go build` automatically links into the executable's .rsrc section.
func buildCOFFRsrcSyso(leaves []resLeaf) []byte {
	// Group by Type -> ID -> Lang (sorted ascending as required by PE spec)
	typeMap := map[uint32]map[uint32][]resLeaf{}
	for _, lf := range leaves {
		if typeMap[lf.resType] == nil {
			typeMap[lf.resType] = map[uint32][]resLeaf{}
		}
		typeMap[lf.resType][lf.resID] = append(typeMap[lf.resType][lf.resID], lf)
	}

	var types []uint32
	for t := range typeMap {
		types = append(types, t)
	}
	sort.Slice(types, func(i, j int) bool { return types[i] < types[j] })

	// Pass 1: compute exact offsets inside .rsrc
	// Layout:
	// [Root dir] [Type subdirs...] [ID subdirs...] [DataEntries...] [Aligned Raw Data...]
	const dirHeaderSize = 16
	const dirEntrySize = 8
	const dataEntrySize = 16

	offset := uint32(dirHeaderSize + len(types)*dirEntrySize)
	typeDirOff := map[uint32]uint32{}
	for _, t := range types {
		typeDirOff[t] = offset
		offset += uint32(dirHeaderSize + len(typeMap[t])*dirEntrySize)
	}

	type idKey struct{ t, id uint32 }
	idDirOff := map[idKey]uint32{}
	var orderedLeaves []resLeaf
	for _, t := range types {
		var ids []uint32
		for id := range typeMap[t] {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		for _, id := range ids {
			langs := typeMap[t][id]
			sort.Slice(langs, func(i, j int) bool { return langs[i].langID < langs[j].langID })
			typeMap[t][id] = langs
			idDirOff[idKey{t, id}] = offset
			offset += uint32(dirHeaderSize + len(langs)*dirEntrySize)
			orderedLeaves = append(orderedLeaves, langs...)
		}
	}

	dataEntriesStart := offset
	offset += uint32(len(orderedLeaves) * dataEntrySize)
	// Align raw payloads to 4 bytes
	for offset%4 != 0 {
		offset++
	}
	payloadStart := offset

	payloadOffs := make([]uint32, len(orderedLeaves))
	cur := payloadStart
	for i, lf := range orderedLeaves {
		payloadOffs[i] = cur
		cur += uint32(len(lf.data))
		for cur%4 != 0 {
			cur++
		}
	}

	// Pass 2: emit .rsrc bytes and track relocations
	var rsrc bytes.Buffer
	writeDirHeader := func(count int) {
		_ = binary.Write(&rsrc, binary.LittleEndian, uint32(0)) // Characteristics
		_ = binary.Write(&rsrc, binary.LittleEndian, uint32(0)) // TimeDateStamp
		_ = binary.Write(&rsrc, binary.LittleEndian, uint16(0)) // MajorVersion
		_ = binary.Write(&rsrc, binary.LittleEndian, uint16(0)) // MinorVersion
		_ = binary.Write(&rsrc, binary.LittleEndian, uint16(0)) // NumberOfNamedEntries
		_ = binary.Write(&rsrc, binary.LittleEndian, uint16(count))
	}

	// Root directory (Types)
	writeDirHeader(len(types))
	for _, t := range types {
		_ = binary.Write(&rsrc, binary.LittleEndian, t)
		_ = binary.Write(&rsrc, binary.LittleEndian, typeDirOff[t]|0x80000000)
	}

	// Type directories (IDs)
	for _, t := range types {
		var ids []uint32
		for id := range typeMap[t] {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		writeDirHeader(len(ids))
		for _, id := range ids {
			_ = binary.Write(&rsrc, binary.LittleEndian, id)
			_ = binary.Write(&rsrc, binary.LittleEndian, idDirOff[idKey{t, id}]|0x80000000)
		}
	}

	// ID directories (Languages -> DataEntry)
	leafIdx := 0
	for _, t := range types {
		var ids []uint32
		for id := range typeMap[t] {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		for _, id := range ids {
			langs := typeMap[t][id]
			writeDirHeader(len(langs))
			for _, lf := range langs {
				deOff := dataEntriesStart + uint32(leafIdx*dataEntrySize)
				_ = binary.Write(&rsrc, binary.LittleEndian, lf.langID)
				_ = binary.Write(&rsrc, binary.LittleEndian, deOff)
				leafIdx++
			}
		}
	}

	// DataEntries (each OffsetToData gets an IMAGE_REL_AMD64_ADDR32NB relocation)
	var relocs []uint32
	for i, lf := range orderedLeaves {
		relocs = append(relocs, uint32(rsrc.Len()))
		_ = binary.Write(&rsrc, binary.LittleEndian, payloadOffs[i])
		_ = binary.Write(&rsrc, binary.LittleEndian, uint32(len(lf.data)))
		_ = binary.Write(&rsrc, binary.LittleEndian, uint32(0)) // CodePage
		_ = binary.Write(&rsrc, binary.LittleEndian, uint32(0)) // Reserved
	}

	for rsrc.Len()%4 != 0 {
		rsrc.WriteByte(0)
	}
	for _, lf := range orderedLeaves {
		rsrc.Write(lf.data)
		for rsrc.Len()%4 != 0 {
			rsrc.WriteByte(0)
		}
	}

	rsrcBytes := rsrc.Bytes()
	const fileHdrSize = 20
	const secHdrSize = 40
	rawOff := uint32(fileHdrSize + secHdrSize)
	relocOff := rawOff + uint32(len(rsrcBytes))
	symOff := relocOff + uint32(len(relocs)*10)

	var coff bytes.Buffer
	// IMAGE_FILE_HEADER
	_ = binary.Write(&coff, binary.LittleEndian, uint16(0x8664)) // IMAGE_FILE_MACHINE_AMD64
	_ = binary.Write(&coff, binary.LittleEndian, uint16(1))      // NumberOfSections
	_ = binary.Write(&coff, binary.LittleEndian, uint32(0))      // TimeDateStamp
	_ = binary.Write(&coff, binary.LittleEndian, symOff)         // PointerToSymbolTable
	_ = binary.Write(&coff, binary.LittleEndian, uint32(1))      // NumberOfSymbols
	_ = binary.Write(&coff, binary.LittleEndian, uint16(0))      // SizeOfOptionalHeader
	_ = binary.Write(&coff, binary.LittleEndian, uint16(0))      // Characteristics

	// IMAGE_SECTION_HEADER (.rsrc)
	coff.Write([]byte{'.', 'r', 's', 'r', 'c', 0, 0, 0})
	_ = binary.Write(&coff, binary.LittleEndian, uint32(0))          // VirtualSize
	_ = binary.Write(&coff, binary.LittleEndian, uint32(0))          // VirtualAddress
	_ = binary.Write(&coff, binary.LittleEndian, uint32(len(rsrcBytes)))
	_ = binary.Write(&coff, binary.LittleEndian, rawOff)             // PointerToRawData
	_ = binary.Write(&coff, binary.LittleEndian, relocOff)           // PointerToRelocations
	_ = binary.Write(&coff, binary.LittleEndian, uint32(0))          // PointerToLinenumbers
	_ = binary.Write(&coff, binary.LittleEndian, uint16(len(relocs)))
	_ = binary.Write(&coff, binary.LittleEndian, uint16(0))          // NumberOfLinenumbers
	_ = binary.Write(&coff, binary.LittleEndian, uint32(0x40000040)) // INITIALIZED_DATA | MEM_READ

	// Section raw data
	coff.Write(rsrcBytes)

	// Relocations (IMAGE_REL_AMD64_ADDR32NB = 0x0003)
	for _, va := range relocs {
		_ = binary.Write(&coff, binary.LittleEndian, va)
		_ = binary.Write(&coff, binary.LittleEndian, uint32(0)) // Symbol index 0 (.rsrc)
		_ = binary.Write(&coff, binary.LittleEndian, uint16(3)) // IMAGE_REL_AMD64_ADDR32NB
	}

	// Symbol table (1 entry: .rsrc section symbol)
	coff.Write([]byte{'.', 'r', 's', 'r', 'c', 0, 0, 0})
	_ = binary.Write(&coff, binary.LittleEndian, uint32(0)) // Value
	_ = binary.Write(&coff, binary.LittleEndian, int16(1))  // SectionNumber (1-based)
	_ = binary.Write(&coff, binary.LittleEndian, uint16(0)) // Type
	coff.WriteByte(3)                                       // IMAGE_SYM_CLASS_STATIC
	coff.WriteByte(0)                                       // NumberOfAuxSymbols

	// Empty string table (size = 4)
	_ = binary.Write(&coff, binary.LittleEndian, uint32(4))

	return coff.Bytes()
}

func main() {
	_ = os.MkdirAll(filepath.Join("build", "windows"), 0o755)
	_ = os.MkdirAll(filepath.Join("internal", "winui"), 0o755)

	png64 := encodePNG(renderIcon(64))
	_ = os.WriteFile(filepath.Join("build", "appicon.png"), png64, 0o644)
	_ = os.WriteFile(filepath.Join("internal", "winui", "appicon.png"), png64, 0o644)

	frames := buildIconFrames()
	if err := writeICO(filepath.Join("build", "windows", "icon.ico"), frames); err != nil {
		fmt.Fprintf(os.Stderr, "writeICO failed: %v\n", err)
		os.Exit(1)
	}

	// Build Windows x64 COFF resource (.syso) with RT_ICON, RT_GROUP_ICON, and RT_MANIFEST
	const (
		rtIcon      = 3
		rtGroupIcon = 14
		rtManifest  = 24
		langEnUS    = 0x0409
	)
	var leaves []resLeaf
	for i, f := range frames {
		leaves = append(leaves, resLeaf{
			resType: rtIcon,
			resID:   uint32(i + 1),
			langID:  langEnUS,
			data:    f.data,
		})
	}
	leaves = append(leaves, resLeaf{
		resType: rtGroupIcon,
		resID:   1,
		langID:  langEnUS,
		data:    buildGroupIconData(frames),
	})
	leaves = append(leaves, resLeaf{
		resType: rtManifest,
		resID:   1,
		langID:  langEnUS,
		data:    []byte(appManifestXML),
	})

	sysoBytes := buildCOFFRsrcSyso(leaves)
	targets := []string{
		filepath.Join("cmd", "installer", "rsrc_windows_amd64.syso"),
		filepath.Join("cmd", "launcher", "rsrc_windows_amd64.syso"),
		filepath.Join("cmd", "repair", "rsrc_windows_amd64.syso"),
		filepath.Join("cmd", "uninstaller", "rsrc_windows_amd64.syso"),
	}
	for _, dst := range targets {
		if err := os.WriteFile(dst, sysoBytes, 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "write %s failed: %v\n", dst, err)
			os.Exit(1)
		}
	}
	fmt.Printf("Generated GenMeet icons & rsrc_windows_amd64.syso (%d bytes each)\n", len(sysoBytes))
}
