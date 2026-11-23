package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

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
			// 2x2 supersampling for smooth anti-aliased edges
			var rSum, gSum, bSum, aSum float64
			for sy := 0; sy < 2; sy++ {
				for sx := 0; sx < 2; sx++ {
					x := (float64(px) + 0.25 + 0.5*float64(sx)) / scale
					y := (float64(py) + 0.25 + 0.5*float64(sy)) / scale

					// Rounded squircle SDF (box 2..46, rx=13)
					cx, cy := math.Abs(x-24.0), math.Abs(y-24.0)
					qx, qy := cx-(22.0-13.0), cy-(22.0-13.0)
					sd := math.Hypot(math.Max(qx, 0), math.Max(qy, 0)) + math.Min(math.Max(qx, qy), 0) - 13.0
					if sd > 0.5 {
						continue
					}

					// Gradient background (#1D4ED8 -> #1A73E8 -> #06B6D4)
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

					// Stylized "G" arc centered at (19, 24), r=9.5, strokeWidth=3.8
					gx, gy := x-19.0, y-24.0
					rad := math.Hypot(gx, gy)
					ang := math.Atan2(gy, gx) // -pi .. pi
					inGArc := (ang <= -math.Pi/4 || ang >= 0) && math.Abs(rad-9.5) <= 1.9
					// Round end caps at -pi/4 and 0
					cap1 := math.Hypot(x-25.72, y-17.28) <= 1.9
					cap2 := distToSegment(x, y, 21.5, 24.0, 28.5, 24.0) <= 1.9

					if inGArc || cap1 || cap2 {
						r, g, b = 255, 255, 255
					} else if pointInPoly(x, y, wing) {
						r, g, b = 153, 246, 228 // #99F6E4
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

func writeICO(path string, sizes []int) error {
	var images [][]byte
	for _, s := range sizes {
		images = append(images, encodePNG(renderIcon(s)))
	}

	var out bytes.Buffer
	// ICONDIR header: reserved=0, type=1 (ICO), count=len(sizes)
	_ = binary.Write(&out, binary.LittleEndian, uint16(0))
	_ = binary.Write(&out, binary.LittleEndian, uint16(1))
	_ = binary.Write(&out, binary.LittleEndian, uint16(len(sizes)))

	offset := uint32(6 + 16*len(sizes))
	for i, s := range sizes {
		dim := uint8(s)
		if s >= 256 {
			dim = 0
		}
		out.WriteByte(dim)                                           // bWidth
		out.WriteByte(dim)                                           // bHeight
		out.WriteByte(0)                                             // bColorCount
		out.WriteByte(0)                                             // bReserved
		_ = binary.Write(&out, binary.LittleEndian, uint16(1))       // wPlanes
		_ = binary.Write(&out, binary.LittleEndian, uint16(32))      // wBitCount
		_ = binary.Write(&out, binary.LittleEndian, uint32(len(images[i])))
		_ = binary.Write(&out, binary.LittleEndian, offset)
		offset += uint32(len(images[i]))
	}
	for _, data := range images {
		out.Write(data)
	}
	return os.WriteFile(path, out.Bytes(), 0o644)
}

func main() {
	_ = os.MkdirAll(filepath.Join("build", "windows"), 0o755)
	_ = os.MkdirAll(filepath.Join("internal", "winui"), 0o755)

	png64 := encodePNG(renderIcon(64))
	_ = os.WriteFile(filepath.Join("build", "appicon.png"), png64, 0o644)
	_ = os.WriteFile(filepath.Join("internal", "winui", "appicon.png"), png64, 0o644)
	_ = writeICO(filepath.Join("build", "windows", "icon.ico"), []int{16, 32, 48, 64})
}
