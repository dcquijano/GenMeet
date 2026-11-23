//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"genmeet/internal/winui"
)

const (
	appShortName = winui.AppShortName
	appFullTitle = winui.AppFullTitle
	appAuthor    = winui.AppAuthor

	wsOverlapped  = 0x00000000
	wsCaption     = 0x00C00000
	wsSysMenu     = 0x00080000
	wsMinimizeBox = 0x00020000
	wsVisible     = 0x10000000
	wsChild       = 0x40000000
	wsTabStop     = 0x00010000
	wsBorder      = 0x00800000
	wsVScroll     = 0x00200000

	wsExClientEdge = 0x00000200

	ssIcon       = 0x00000003
	ssEtchedHorz = 0x00000010

	bsPushButton   = 0x00000000
	bsDefPushBtn   = 0x00000001
	bsAutoCheckBox = 0x00000003

	esMultiline   = 0x0004
	esAutoVScroll = 0x0040
	esAutoHScroll = 0x0080
	esReadOnly    = 0x0800

	wmCreate       = 0x0001
	wmDestroy      = 0x0002
	wmClose        = 0x0010
	wmSetFont      = 0x0030
	wmSetIcon      = 0x0080
	wmCommand      = 0x0111
	wmCtlColorStat = 0x0138
	wmUser         = 0x0400
	wmStep         = wmUser + 10
	wmDone         = wmUser + 11

	bmGetCheck = 0x00F0
	bmSetCheck = 0x00F1
	bstChecked = 1

	stmSetIcon = 0x0170

	pbmSetRange32 = wmUser + 6
	pbmSetPos     = wmUser + 2

	emSetSel      = 0x00B1
	emReplaceSel  = 0x00C2
	emScrollCaret = 0x00B7

	swHide       = 0
	swShow       = 5
	colorBtnFace = 15

	idBtnAction   = 102
	idBtnCancel   = 103
	idEditDir     = 301
	idBtnBrowse   = 302
	idChkDeps     = 303
	idChkBuild    = 304
	idChkShortcut = 305
	idChkResetCfg = 306
	idChkLaunch   = 501
)

var (
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	user32   = syscall.NewLazyDLL("user32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	comctl32 = syscall.NewLazyDLL("comctl32.dll")

	procGetModuleHandleW     = kernel32.NewProc("GetModuleHandleW")
	procInitCommonControlsEx = comctl32.NewProc("InitCommonControlsEx")
	procRegisterClassExW     = user32.NewProc("RegisterClassExW")
	procCreateWindowExW      = user32.NewProc("CreateWindowExW")
	procDefWindowProcW       = user32.NewProc("DefWindowProcW")
	procDestroyWindow        = user32.NewProc("DestroyWindow")
	procShowWindow           = user32.NewProc("ShowWindow")
	procEnableWindow         = user32.NewProc("EnableWindow")
	procSetWindowTextW       = user32.NewProc("SetWindowTextW")
	procGetWindowTextW       = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW = user32.NewProc("GetWindowTextLengthW")
	procSendMessageW         = user32.NewProc("SendMessageW")
	procPostMessageW         = user32.NewProc("PostMessageW")
	procGetMessageW          = user32.NewProc("GetMessageW")
	procTranslateMessage     = user32.NewProc("TranslateMessage")
	procDispatchMessageW     = user32.NewProc("DispatchMessageW")
	procPostQuitMessage      = user32.NewProc("PostQuitMessage")
	procGetSystemMetrics     = user32.NewProc("GetSystemMetrics")
	procCreateIconFromResEx  = user32.NewProc("CreateIconFromResourceEx")
	procCreateFontW          = gdi32.NewProc("CreateFontW")
	procSetBkMode            = gdi32.NewProc("SetBkMode")
	procGetSysColorBrush     = user32.NewProc("GetSysColorBrush")
)

type initCommonControlsEx struct {
	dwSize uint32
	dwICC  uint32
}

type wndClassExW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     syscall.Handle
	hIcon         syscall.Handle
	hCursor       syscall.Handle
	hbrBackground syscall.Handle
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       syscall.Handle
}

type point struct{ x, y int32 }

type msg struct {
	hWnd    syscall.Handle
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

type repairOptions struct {
	dir           string
	fixDeps       bool
	rebuildNext   bool
	fixShortcuts  bool
	resetConfig   bool
}

type repairState struct {
	hwnd      syscall.Handle
	hInst     syscall.Handle
	hIcon48   syscall.Handle
	hIconSm   syscall.Handle
	fontTitle syscall.Handle
	fontBold  syscall.Handle
	fontUI    syscall.Handle
	fontMono  syscall.Handle
	page      int // 1=options, 2=progress, 3=finish
	running   bool
	rootDir   string
	resetCfg  bool
	noLaunch  bool
	finalCfg  winui.InstanceConfig

	lblTitle    syscall.Handle
	lblSubtitle syscall.Handle

	p1LblDir      syscall.Handle
	p1EditDir     syscall.Handle
	p1BtnBrw      syscall.Handle
	p1LblOpt      syscall.Handle
	p1ChkDeps     syscall.Handle
	p1ChkBuild    syscall.Handle
	p1ChkShortcut syscall.Handle
	p1ChkResetCfg syscall.Handle

	p2Status   syscall.Handle
	p2Progress syscall.Handle
	p2LogBox   syscall.Handle

	p3DoneTitle syscall.Handle
	p3Summary   syscall.Handle
	p3ChkLaunch syscall.Handle

	btnAction syscall.Handle
	btnCancel syscall.Handle

	mu      sync.Mutex
	stepMsg string
	stepPct int
	errText string
}

var wiz = &repairState{}

func resolveRoot(argDir string) string {
	if argDir != "" {
		return argDir
	}
	if loc := winui.ReadHKCUString(winui.UninstallRegKey, "InstallLocation"); loc != "" && winui.DirExists(loc) {
		return loc
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if winui.FileExists(filepath.Join(dir, "server.ts")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if winui.FileExists(filepath.Join(parent, "server.ts")) {
			return parent
		}
	}
	return winui.DefaultInstallDir
}

func runHidden(dir, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func main() {
	hMutex, already := winui.CreateMutex(`Local\GenMeetRepairWizardMutex`)
	if already {
		winui.CloseHandle(hMutex)
		winui.MessageBox(appFullTitle+" Repair", "The GenMeet Repair Wizard is already running.", winui.MBOK|winui.MBIconInfo)
		return
	}
	defer winui.CloseHandle(hMutex)

	var argDir string
	silent := false
	resetConfig := false
	noLaunch := false

	for _, a := range os.Args[1:] {
		low := strings.ToLower(a)
		switch {
		case low == "--silent" || low == "/s":
			silent = true
		case low == "--reset-config" || low == "--reset":
			resetConfig = true
		case low == "--no-launch":
			noLaunch = true
		case strings.HasPrefix(low, "--dir="):
			argDir = strings.Trim(a[6:], `"`)
		}
	}

	root := resolveRoot(argDir)
	if silent {
		opts := repairOptions{
			dir:          root,
			fixDeps:      true,
			rebuildNext:  true,
			fixShortcuts: true,
			resetConfig:  resetConfig,
		}
		if _, err := performRepair(opts, nil); err != nil {
			os.Exit(1)
		}
		return
	}

	wiz.rootDir = root
	wiz.resetCfg = resetConfig
	wiz.noLaunch = noLaunch
	runWizardGUI()
}

func makeIcon(size uintptr) syscall.Handle {
	if len(winui.DefaultIconPNG) == 0 {
		return 0
	}
	h, _, _ := procCreateIconFromResEx.Call(
		uintptr(unsafe.Pointer(&winui.DefaultIconPNG[0])),
		uintptr(len(winui.DefaultIconPNG)),
		1, 0x00030000, size, size, 0,
	)
	return syscall.Handle(h)
}

func makeFont(height int32, weight int32, face string) syscall.Handle {
	h, _, _ := procCreateFontW.Call(
		uintptr(uint32(height)), 0, 0, 0, uintptr(weight),
		0, 0, 0, 1, 0, 0, 5, 0,
		uintptr(unsafe.Pointer(winui.U16(face))),
	)
	return syscall.Handle(h)
}

func createCtrl(exStyle uint32, class, text string, style uint32, x, y, w, h int, parent syscall.Handle, id uintptr, font syscall.Handle) syscall.Handle {
	hwnd, _, _ := procCreateWindowExW.Call(
		uintptr(exStyle),
		uintptr(unsafe.Pointer(winui.U16(class))),
		uintptr(unsafe.Pointer(winui.U16(text))),
		uintptr(wsChild|style),
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		uintptr(parent), id, uintptr(wiz.hInst), 0,
	)
	handle := syscall.Handle(hwnd)
	if font != 0 && handle != 0 {
		_, _, _ = procSendMessageW.Call(uintptr(handle), wmSetFont, uintptr(font), 1)
	}
	return handle
}

func showCtrl(h syscall.Handle, visible bool) {
	if h == 0 {
		return
	}
	if visible {
		_, _, _ = procShowWindow.Call(uintptr(h), swShow)
	} else {
		_, _, _ = procShowWindow.Call(uintptr(h), swHide)
	}
}

func enableCtrl(h syscall.Handle, enabled bool) {
	if h == 0 {
		return
	}
	var v uintptr
	if enabled {
		v = 1
	}
	_, _, _ = procEnableWindow.Call(uintptr(h), v)
}

func isChecked(h syscall.Handle) bool {
	ret, _, _ := procSendMessageW.Call(uintptr(h), bmGetCheck, 0, 0)
	return ret == bstChecked
}

func setChecked(h syscall.Handle, checked bool) {
	var v uintptr
	if checked {
		v = bstChecked
	}
	_, _, _ = procSendMessageW.Call(uintptr(h), bmSetCheck, v, 0)
}

func getText(h syscall.Handle) string {
	n, _, _ := procGetWindowTextLengthW.Call(uintptr(h))
	buf := make([]uint16, n+2)
	_, _, _ = procGetWindowTextW.Call(uintptr(h), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return strings.TrimSpace(syscall.UTF16ToString(buf))
}

func setText(h syscall.Handle, s string) {
	_, _, _ = procSetWindowTextW.Call(uintptr(h), uintptr(unsafe.Pointer(winui.U16(s))))
}

func appendLog(h syscall.Handle, line string) {
	_, _, _ = procSendMessageW.Call(uintptr(h), emSetSel, ^uintptr(0), ^uintptr(0))
	_, _, _ = procSendMessageW.Call(uintptr(h), emReplaceSel, 0, uintptr(unsafe.Pointer(winui.U16(line+"\r\n"))))
	_, _, _ = procSendMessageW.Call(uintptr(h), emScrollCaret, 0, 0)
}

func runWizardGUI() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	icc := initCommonControlsEx{dwSize: uint32(unsafe.Sizeof(initCommonControlsEx{})), dwICC: 0xFFFF}
	_, _, _ = procInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&icc)))

	hInst, _, _ := procGetModuleHandleW.Call(0)
	wiz.hInst = syscall.Handle(hInst)
	wiz.hIcon48 = makeIcon(48)
	wiz.hIconSm = makeIcon(16)
	wiz.fontTitle = makeFont(-19, 700, "Segoe UI")
	wiz.fontBold = makeFont(-13, 600, "Segoe UI")
	wiz.fontUI = makeFont(-12, 400, "Segoe UI")
	wiz.fontMono = makeFont(-12, 400, "Consolas")

	clsName := winui.U16("GenMeetRepairWizardClass")
	wc := wndClassExW{
		cbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
		lpfnWndProc:   syscall.NewCallback(wndProc),
		hInstance:     wiz.hInst,
		hIcon:         wiz.hIcon48,
		hIconSm:       wiz.hIconSm,
		hbrBackground: syscall.Handle(colorBtnFace + 1),
		lpszClassName: clsName,
	}
	_, _, _ = procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	const winW, winH = 560, 445
	sw, _, _ := procGetSystemMetrics.Call(0)
	sh, _, _ := procGetSystemMetrics.Call(1)
	x := (int(sw) - winW) / 2
	y := (int(sh) - winH) / 2

	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(clsName)),
		uintptr(unsafe.Pointer(winui.U16(appFullTitle+" Repair Wizard"))),
		uintptr(wsOverlapped|wsCaption|wsSysMenu|wsMinimizeBox|wsVisible),
		uintptr(x), uintptr(y), winW, winH,
		0, 0, uintptr(wiz.hInst), 0,
	)
	wiz.hwnd = syscall.Handle(hwnd)
	if wiz.hIcon48 != 0 {
		_, _, _ = procSendMessageW.Call(hwnd, wmSetIcon, 1, uintptr(wiz.hIcon48))
	}
	if wiz.hIconSm != 0 {
		_, _, _ = procSendMessageW.Call(hwnd, wmSetIcon, 0, uintptr(wiz.hIconSm))
	}

	var m msg
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		_, _, _ = procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		_, _, _ = procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func wndProc(hwnd syscall.Handle, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case wmCreate:
		wiz.hwnd = hwnd
		buildControls(hwnd)
		setPage(1)
		return 0

	case wmCtlColorStat:
		if syscall.Handle(lParam) == wiz.p2LogBox {
			break
		}
		_, _, _ = procSetBkMode.Call(wParam, 1)
		b, _, _ := procGetSysColorBrush.Call(colorBtnFace)
		return b

	case wmCommand:
		id := uint16(wParam & 0xFFFF)
		switch id {
		case idBtnBrowse:
			if picked := winui.BrowseForFolder("Select GenMeet installation folder to repair:"); picked != "" {
				setText(wiz.p1EditDir, picked)
			}
		case idBtnAction:
			if wiz.page == 1 {
				startRepairFromUI()
			} else if wiz.page == 3 {
				if isChecked(wiz.p3ChkLaunch) && !wiz.noLaunch {
					launcher := filepath.Join(wiz.rootDir, "GenMeet-Launcher.exe")
					if winui.FileExists(launcher) {
						cmd := exec.Command(launcher)
						cmd.Dir = wiz.rootDir
						_ = cmd.Start()
					}
				}
				_, _, _ = procDestroyWindow.Call(uintptr(hwnd))
			}
		case idBtnCancel:
			if !wiz.running {
				_, _, _ = procDestroyWindow.Call(uintptr(hwnd))
			}
		}
		return 0

	case wmStep:
		wiz.mu.Lock()
		msgText, pct := wiz.stepMsg, wiz.stepPct
		wiz.mu.Unlock()
		setText(wiz.p2Status, msgText)
		_, _, _ = procSendMessageW.Call(uintptr(wiz.p2Progress), pbmSetPos, uintptr(pct), 0)
		appendLog(wiz.p2LogBox, msgText)
		return 0

	case wmDone:
		wiz.running = false
		wiz.mu.Lock()
		errText := wiz.errText
		cfg := wiz.finalCfg
		wiz.mu.Unlock()
		if errText != "" {
			setText(wiz.p2Status, "Repair failed.")
			appendLog(wiz.p2LogBox, "ERROR: "+errText)
			enableCtrl(wiz.btnCancel, true)
			setText(wiz.btnCancel, "Close")
			winui.MessageBox(appFullTitle+" Repair", "Repair failed:\n\n"+errText, winui.MBOK|winui.MBIconError)
		} else {
			lans := winui.DetectLanIPs()
			lanLine := ""
			if len(lans) > 0 {
				lanLine = fmt.Sprintf("\r\nLAN URL: http://%s:%d", lans[0], cfg.Port)
			}
			setText(
				wiz.p3Summary,
				fmt.Sprintf(
					"%s has been repaired at:\r\n%s\r\n\r\nVirtual Node ID: %s\r\nLocal URL: http://localhost:%d%s\r\n\r\nShortcuts, production files, and server port configuration have been verified.",
					appFullTitle, wiz.rootDir, cfg.VirtualIP, cfg.Port, lanLine,
				),
			)
			setPage(3)
		}
		return 0

	case wmClose:
		if wiz.running {
			return 0
		}
		_, _, _ = procDestroyWindow.Call(uintptr(hwnd))
		return 0

	case wmDestroy:
		_, _, _ = procPostQuitMessage.Call(0)
		return 0
	}

	ret, _, _ := procDefWindowProcW.Call(uintptr(hwnd), uintptr(message), wParam, lParam)
	return ret
}

func buildControls(hwnd syscall.Handle) {
	iconCtl := createCtrl(0, "STATIC", "", wsVisible|ssIcon, 20, 14, 48, 48, hwnd, 0, 0)
	if wiz.hIcon48 != 0 {
		_, _, _ = procSendMessageW.Call(uintptr(iconCtl), stmSetIcon, uintptr(wiz.hIcon48), 0)
	}
	wiz.lblTitle = createCtrl(0, "STATIC", appFullTitle+" Repair", wsVisible, 82, 16, 440, 24, hwnd, 0, wiz.fontTitle)
	wiz.lblSubtitle = createCtrl(0, "STATIC", "Diagnose && Repair Existing Installation • Created by "+appAuthor, wsVisible, 82, 42, 440, 20, hwnd, 0, wiz.fontUI)
	createCtrl(0, "STATIC", "", wsVisible|ssEtchedHorz, 16, 72, 512, 2, hwnd, 0, 0)

	// Page 1: Options
	wiz.p1LblDir = createCtrl(0, "STATIC", "GenMeet installation folder to repair:", 0, 24, 88, 400, 18, hwnd, 0, wiz.fontBold)
	wiz.p1EditDir = createCtrl(wsExClientEdge, "EDIT", wiz.rootDir, wsBorder|wsTabStop|esAutoHScroll, 24, 110, 400, 24, hwnd, idEditDir, wiz.fontUI)
	wiz.p1BtnBrw = createCtrl(0, "BUTTON", "Browse...", bsPushButton|wsTabStop, 434, 109, 86, 26, hwnd, idBtnBrowse, wiz.fontUI)
	wiz.p1LblOpt = createCtrl(0, "STATIC", "Repair actions:", 0, 24, 152, 400, 18, hwnd, 0, wiz.fontBold)
	wiz.p1ChkDeps = createCtrl(0, "BUTTON", "Verify Node.js dependencies (install missing packages)", bsAutoCheckBox|wsTabStop, 32, 178, 480, 22, hwnd, idChkDeps, wiz.fontUI)
	wiz.p1ChkBuild = createCtrl(0, "BUTTON", "Clear stale caches && rebuild Next.js production bundle if needed", bsAutoCheckBox|wsTabStop, 32, 206, 480, 22, hwnd, idChkBuild, wiz.fontUI)
	wiz.p1ChkShortcut = createCtrl(0, "BUTTON", "Restore Desktop && Start Menu shortcuts && Installed Apps entry", bsAutoCheckBox|wsTabStop, 32, 234, 480, 22, hwnd, idChkShortcut, wiz.fontUI)
	wiz.p1ChkResetCfg = createCtrl(0, "BUTTON", "Reset unique Virtual Node ID && reassign free port", bsAutoCheckBox|wsTabStop, 32, 262, 480, 22, hwnd, idChkResetCfg, wiz.fontUI)
	setChecked(wiz.p1ChkDeps, true)
	setChecked(wiz.p1ChkBuild, true)
	setChecked(wiz.p1ChkShortcut, true)
	setChecked(wiz.p1ChkResetCfg, wiz.resetCfg)

	// Page 2: Progress
	wiz.p2Status = createCtrl(0, "STATIC", "Preparing repair...", 0, 24, 92, 496, 20, hwnd, 0, wiz.fontBold)
	wiz.p2Progress = createCtrl(0, "msctls_progress32", "", 0, 24, 118, 496, 20, hwnd, 0, 0)
	_, _, _ = procSendMessageW.Call(uintptr(wiz.p2Progress), pbmSetRange32, 0, 100)
	wiz.p2LogBox = createCtrl(wsExClientEdge, "EDIT", "",
		wsBorder|wsVScroll|esMultiline|esAutoVScroll|esReadOnly, 24, 150, 496, 188, hwnd, 0, wiz.fontMono)

	// Page 3: Finish
	wiz.p3DoneTitle = createCtrl(0, "STATIC", "GenMeet Repair Complete", 0, 24, 90, 496, 24, hwnd, 0, wiz.fontTitle)
	wiz.p3Summary = createCtrl(0, "STATIC", "", 0, 24, 124, 496, 150, hwnd, 0, wiz.fontUI)
	wiz.p3ChkLaunch = createCtrl(0, "BUTTON", "Launch GenMeet in Google Chrome now", bsAutoCheckBox|wsTabStop, 24, 290, 360, 22, hwnd, idChkLaunch, wiz.fontBold)
	setChecked(wiz.p3ChkLaunch, !wiz.noLaunch)

	// Footer
	createCtrl(0, "STATIC", "", wsVisible|ssEtchedHorz, 16, 354, 512, 2, hwnd, 0, 0)
	wiz.btnAction = createCtrl(0, "BUTTON", "Repair", wsVisible|bsDefPushBtn|wsTabStop, 344, 368, 86, 28, hwnd, idBtnAction, wiz.fontBold)
	wiz.btnCancel = createCtrl(0, "BUTTON", "Cancel", wsVisible|bsPushButton|wsTabStop, 438, 368, 86, 28, hwnd, idBtnCancel, wiz.fontUI)
}

func setPage(p int) {
	wiz.page = p
	for _, h := range []syscall.Handle{
		wiz.p1LblDir, wiz.p1EditDir, wiz.p1BtnBrw, wiz.p1LblOpt,
		wiz.p1ChkDeps, wiz.p1ChkBuild, wiz.p1ChkShortcut, wiz.p1ChkResetCfg,
	} {
		showCtrl(h, p == 1)
	}
	for _, h := range []syscall.Handle{wiz.p2Status, wiz.p2Progress, wiz.p2LogBox} {
		showCtrl(h, p == 2)
	}
	for _, h := range []syscall.Handle{wiz.p3DoneTitle, wiz.p3Summary, wiz.p3ChkLaunch} {
		showCtrl(h, p == 3)
	}

	switch p {
	case 1:
		setText(wiz.lblSubtitle, "Repair Options — Verify files, shortcuts, and server port")
		showCtrl(wiz.btnAction, true)
		enableCtrl(wiz.btnAction, true)
		setText(wiz.btnAction, "Repair")
		showCtrl(wiz.btnCancel, true)
		enableCtrl(wiz.btnCancel, true)
	case 2:
		setText(wiz.lblSubtitle, "Repairing GenMeet...")
		enableCtrl(wiz.btnAction, false)
		enableCtrl(wiz.btnCancel, false)
	case 3:
		setText(wiz.lblSubtitle, "Repair Complete")
		showCtrl(wiz.btnCancel, false)
		showCtrl(wiz.btnAction, true)
		enableCtrl(wiz.btnAction, true)
		setText(wiz.btnAction, "Finish")
	}
}

func startRepairFromUI() {
	dir := getText(wiz.p1EditDir)
	if dir == "" || !winui.FileExists(filepath.Join(dir, "server.ts")) {
		winui.MessageBox(appFullTitle+" Repair", fmt.Sprintf("GenMeet installation (server.ts) was not found in:\n%s", dir), winui.MBOK|winui.MBIconWarning)
		return
	}
	opts := repairOptions{
		dir:          dir,
		fixDeps:      isChecked(wiz.p1ChkDeps),
		rebuildNext:  isChecked(wiz.p1ChkBuild),
		fixShortcuts: isChecked(wiz.p1ChkShortcut),
		resetConfig:  isChecked(wiz.p1ChkResetCfg),
	}
	wiz.rootDir = dir
	wiz.running = true
	setPage(2)

	go func() {
		cfg, err := performRepair(opts, func(pct int, msg string) {
			wiz.mu.Lock()
			wiz.stepPct = pct
			wiz.stepMsg = msg
			wiz.mu.Unlock()
			_, _, _ = procPostMessageW.Call(uintptr(wiz.hwnd), wmStep, 0, 0)
		})
		wiz.mu.Lock()
		wiz.finalCfg = cfg
		if err != nil {
			wiz.errText = err.Error()
		} else {
			wiz.errText = ""
		}
		wiz.mu.Unlock()
		_, _, _ = procPostMessageW.Call(uintptr(wiz.hwnd), wmDone, 0, 0)
	}()
}

func performRepair(opts repairOptions, report func(pct int, msg string)) (winui.InstanceConfig, error) {
	step := func(pct int, msg string) {
		if report != nil {
			report(pct, msg)
		}
	}

	if !winui.FileExists(filepath.Join(opts.dir, "server.ts")) {
		return winui.InstanceConfig{}, fmt.Errorf("GenMeet installation not found at %s", opts.dir)
	}

	step(12, "Stopping any running GenMeet processes in "+opts.dir+"...")
	winui.KillProcessesInDir(opts.dir, uint32(os.Getpid()))
	time.Sleep(300 * time.Millisecond)

	if winui.FileExists(filepath.Join(opts.dir, "next.config.mjs")) {
		_ = os.Remove(filepath.Join(opts.dir, "next.config.ts"))
	}

	if opts.fixDeps {
		if !winui.DirExists(filepath.Join(opts.dir, "node_modules")) {
			step(35, "Installing missing Node.js dependencies (npm install --omit=dev)...")
			if err := runHidden(opts.dir, "npm.cmd", "install", "--omit=dev"); err != nil {
				return winui.InstanceConfig{}, fmt.Errorf("npm install failed: %w", err)
			}
		} else {
			step(38, "Verified existing node_modules directory.")
		}
	}

	step(58, "Checking unique Virtual Node ID & available port...")
	var cfg winui.InstanceConfig
	var err error
	if opts.resetConfig || !winui.FileExists(filepath.Join(opts.dir, "genmeet.instance.json")) {
		cfg, err = winui.LoadOrCreateInstanceConfig(opts.dir, true)
	} else {
		cfg, err = winui.LoadOrCreateInstanceConfig(opts.dir, false)
		if !winui.IsPortAvailable(cfg.Port) {
			step(64, fmt.Sprintf("Port %d is busy; assigning a fresh open port...", cfg.Port))
			cfg, err = winui.LoadOrCreateInstanceConfig(opts.dir, true)
		}
	}
	if err != nil {
		return cfg, fmt.Errorf("instance config error: %w", err)
	}

	if opts.rebuildNext && !winui.FileExists(filepath.Join(opts.dir, ".next", "BUILD_ID")) {
		step(75, "Clearing stale caches & rebuilding Next.js production bundle...")
		_ = os.RemoveAll(filepath.Join(opts.dir, ".next"))
		_ = os.Remove(filepath.Join(opts.dir, "tsconfig.tsbuildinfo"))
		if err := runHidden(opts.dir, "npm.cmd", "run", "build"); err != nil {
			return cfg, fmt.Errorf("next build failed: %w", err)
		}
	} else {
		step(80, "Verified .next production build.")
	}

	if opts.fixShortcuts {
		step(92, "Restoring Desktop & Start Menu shortcuts...")
		launcher := filepath.Join(opts.dir, "GenMeet-Launcher.exe")
		repairExe := filepath.Join(opts.dir, "GenMeet-Repair.exe")
		uninstExe := filepath.Join(opts.dir, "GenMeet-Uninstall.exe")
		if winui.FileExists(launcher) {
			iconRef := launcher + ",0"
			if home, err := os.UserHomeDir(); err == nil {
				_ = winui.CreateShortcut(filepath.Join(home, "Desktop", "GenMeet.lnk"), launcher, "", opts.dir, iconRef, "Launch GenMeet")
			}
			if appData := os.Getenv("APPDATA"); appData != "" {
				menuDir := filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", appShortName)
				_ = os.MkdirAll(menuDir, 0o755)
				_ = winui.CreateShortcut(filepath.Join(menuDir, "GenMeet.lnk"), launcher, "", opts.dir, iconRef, "Launch GenMeet")
				_ = winui.CreateShortcut(filepath.Join(menuDir, "GenMeet Terminal.lnk"), launcher, "--terminal", opts.dir, iconRef, "Open GenMeet Terminal")
				if winui.FileExists(repairExe) {
					_ = winui.CreateShortcut(filepath.Join(menuDir, "Repair GenMeet.lnk"), repairExe, "", opts.dir, iconRef, "Repair GenMeet")
				}
				if winui.FileExists(uninstExe) {
					_ = winui.CreateShortcut(filepath.Join(menuDir, "Uninstall GenMeet.lnk"), uninstExe, "", opts.dir, iconRef, "Uninstall GenMeet")
				}
			}
		}
	}

	step(100, fmt.Sprintf("Repair complete! Node %s ready on http://localhost:%d", cfg.VirtualIP, cfg.Port))
	return cfg, nil
}
