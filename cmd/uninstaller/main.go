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

	idBtnAction    = 102
	idBtnCancel    = 103
	idEditDir      = 301
	idChkStop      = 303
	idChkShortcuts = 304
	idChkRegistry  = 305
	idChkKeepData  = 306
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

type uninstallOptions struct {
	dir             string
	stopProcesses   bool
	removeShortcuts bool
	removeRegistry  bool
	keepData        bool
}

type uninstallState struct {
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
	keepData  bool

	lblTitle    syscall.Handle
	lblSubtitle syscall.Handle

	p1Intro       syscall.Handle
	p1LblDir      syscall.Handle
	p1EditDir     syscall.Handle
	p1LblOpt      syscall.Handle
	p1ChkStop     syscall.Handle
	p1ChkShortcut syscall.Handle
	p1ChkRegistry syscall.Handle
	p1ChkKeepData syscall.Handle

	p2Status   syscall.Handle
	p2Progress syscall.Handle
	p2LogBox   syscall.Handle

	p3DoneTitle syscall.Handle
	p3Summary   syscall.Handle

	btnAction syscall.Handle
	btnCancel syscall.Handle

	mu      sync.Mutex
	stepMsg string
	stepPct int
	errText string
}

var wiz = &uninstallState{keepData: true}

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

func main() {
	hMutex, already := winui.CreateMutex(`Local\GenMeetUninstallWizardMutex`)
	if already {
		winui.CloseHandle(hMutex)
		winui.MessageBox(appFullTitle+" Uninstall", "The GenMeet Uninstall Wizard is already open.", winui.MBOK|winui.MBIconInfo)
		return
	}
	defer winui.CloseHandle(hMutex)

	var argDir string
	silent := false
	keepConfig := true

	for _, a := range os.Args[1:] {
		low := strings.ToLower(a)
		switch {
		case low == "--silent" || low == "/s":
			silent = true
		case low == "--remove-data":
			keepConfig = false
		case low == "--keep-data":
			keepConfig = true
		case strings.HasPrefix(low, "--dir="):
			argDir = strings.Trim(a[6:], `"`)
		}
	}

	root := resolveRoot(argDir)
	if silent {
		opts := uninstallOptions{
			dir:             root,
			stopProcesses:   true,
			removeShortcuts: true,
			removeRegistry:  true,
			keepData:        keepConfig,
		}
		performUninstall(opts, nil)
		return
	}

	wiz.rootDir = root
	wiz.keepData = keepConfig
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

	clsName := winui.U16("GenMeetUninstallWizardClass")
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
		uintptr(unsafe.Pointer(winui.U16(appFullTitle+" Uninstall Wizard"))),
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
		if syscall.Handle(lParam) == wiz.p2LogBox || syscall.Handle(lParam) == wiz.p1EditDir {
			break
		}
		_, _, _ = procSetBkMode.Call(wParam, 1)
		b, _, _ := procGetSysColorBrush.Call(colorBtnFace)
		return b

	case wmCommand:
		id := uint16(wParam & 0xFFFF)
		switch id {
		case idBtnAction:
			if wiz.page == 1 {
				startUninstallFromUI()
			} else if wiz.page == 3 {
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
		preserved := "All application files and configuration were removed."
		if wiz.keepData {
			preserved = "Your unique instance identity (genmeet.instance.json) and logs were kept safe."
		}
		setText(
			wiz.p3Summary,
			fmt.Sprintf(
				"%s has been uninstalled from:\r\n%s\r\n\r\n%s\r\n\r\nYou can reinstall anytime using GenMeet-Setup.",
				appFullTitle, wiz.rootDir, preserved,
			),
		)
		setPage(3)
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
	wiz.lblTitle = createCtrl(0, "STATIC", appFullTitle+" Uninstall", wsVisible, 82, 16, 440, 24, hwnd, 0, wiz.fontTitle)
	wiz.lblSubtitle = createCtrl(0, "STATIC", "Remove GenMeet from your computer • Created by "+appAuthor, wsVisible, 82, 42, 440, 20, hwnd, 0, wiz.fontUI)
	createCtrl(0, "STATIC", "", wsVisible|ssEtchedHorz, 16, 72, 512, 2, hwnd, 0, 0)

	// Page 1: Confirm & Options
	wiz.p1Intro = createCtrl(0, "STATIC", "This wizard will remove GenMeet binaries, shortcuts, and Windows registry entries.", 0, 24, 86, 496, 20, hwnd, 0, wiz.fontUI)
	wiz.p1LblDir = createCtrl(0, "STATIC", "Target installation folder:", 0, 24, 114, 400, 18, hwnd, 0, wiz.fontBold)
	wiz.p1EditDir = createCtrl(wsExClientEdge, "EDIT", wiz.rootDir, wsBorder|esReadOnly|esAutoHScroll, 24, 136, 496, 24, hwnd, idEditDir, wiz.fontUI)
	wiz.p1LblOpt = createCtrl(0, "STATIC", "Uninstall options:", 0, 24, 174, 400, 18, hwnd, 0, wiz.fontBold)
	wiz.p1ChkStop = createCtrl(0, "BUTTON", "Stop any running GenMeet server processes", bsAutoCheckBox|wsTabStop, 32, 200, 480, 22, hwnd, idChkStop, wiz.fontUI)
	wiz.p1ChkShortcut = createCtrl(0, "BUTTON", "Remove Desktop && Start Menu shortcuts", bsAutoCheckBox|wsTabStop, 32, 228, 480, 22, hwnd, idChkShortcuts, wiz.fontUI)
	wiz.p1ChkRegistry = createCtrl(0, "BUTTON", "Remove Windows Installed Apps && auto-start entries", bsAutoCheckBox|wsTabStop, 32, 256, 480, 22, hwnd, idChkRegistry, wiz.fontUI)
	wiz.p1ChkKeepData = createCtrl(0, "BUTTON", "Keep genmeet.instance.json && logs (recommended)", bsAutoCheckBox|wsTabStop, 32, 284, 480, 22, hwnd, idChkKeepData, wiz.fontBold)
	setChecked(wiz.p1ChkStop, true)
	setChecked(wiz.p1ChkShortcut, true)
	setChecked(wiz.p1ChkRegistry, true)
	setChecked(wiz.p1ChkKeepData, wiz.keepData)

	// Page 2: Progress
	wiz.p2Status = createCtrl(0, "STATIC", "Preparing uninstall...", 0, 24, 92, 496, 20, hwnd, 0, wiz.fontBold)
	wiz.p2Progress = createCtrl(0, "msctls_progress32", "", 0, 24, 118, 496, 20, hwnd, 0, 0)
	_, _, _ = procSendMessageW.Call(uintptr(wiz.p2Progress), pbmSetRange32, 0, 100)
	wiz.p2LogBox = createCtrl(wsExClientEdge, "EDIT", "",
		wsBorder|wsVScroll|esMultiline|esAutoVScroll|esReadOnly, 24, 150, 496, 188, hwnd, 0, wiz.fontMono)

	// Page 3: Finish
	wiz.p3DoneTitle = createCtrl(0, "STATIC", "GenMeet Uninstall Complete", 0, 24, 90, 496, 24, hwnd, 0, wiz.fontTitle)
	wiz.p3Summary = createCtrl(0, "STATIC", "", 0, 24, 124, 496, 170, hwnd, 0, wiz.fontUI)

	// Footer
	createCtrl(0, "STATIC", "", wsVisible|ssEtchedHorz, 16, 354, 512, 2, hwnd, 0, 0)
	wiz.btnAction = createCtrl(0, "BUTTON", "Uninstall", wsVisible|bsDefPushBtn|wsTabStop, 344, 368, 86, 28, hwnd, idBtnAction, wiz.fontBold)
	wiz.btnCancel = createCtrl(0, "BUTTON", "Cancel", wsVisible|bsPushButton|wsTabStop, 438, 368, 86, 28, hwnd, idBtnCancel, wiz.fontUI)
}

func setPage(p int) {
	wiz.page = p
	for _, h := range []syscall.Handle{
		wiz.p1Intro, wiz.p1LblDir, wiz.p1EditDir, wiz.p1LblOpt,
		wiz.p1ChkStop, wiz.p1ChkShortcut, wiz.p1ChkRegistry, wiz.p1ChkKeepData,
	} {
		showCtrl(h, p == 1)
	}
	for _, h := range []syscall.Handle{wiz.p2Status, wiz.p2Progress, wiz.p2LogBox} {
		showCtrl(h, p == 2)
	}
	for _, h := range []syscall.Handle{wiz.p3DoneTitle, wiz.p3Summary} {
		showCtrl(h, p == 3)
	}

	switch p {
	case 1:
		setText(wiz.lblSubtitle, "Uninstall Options — Confirm removal")
		showCtrl(wiz.btnAction, true)
		enableCtrl(wiz.btnAction, true)
		setText(wiz.btnAction, "Uninstall")
		showCtrl(wiz.btnCancel, true)
		enableCtrl(wiz.btnCancel, true)
	case 2:
		setText(wiz.lblSubtitle, "Uninstalling GenMeet...")
		enableCtrl(wiz.btnAction, false)
		enableCtrl(wiz.btnCancel, false)
	case 3:
		setText(wiz.lblSubtitle, "Uninstall Complete")
		showCtrl(wiz.btnCancel, false)
		showCtrl(wiz.btnAction, true)
		enableCtrl(wiz.btnAction, true)
		setText(wiz.btnAction, "Finish")
	}
}

func startUninstallFromUI() {
	dir := getText(wiz.p1EditDir)
	if dir == "" {
		return
	}
	opts := uninstallOptions{
		dir:             dir,
		stopProcesses:   isChecked(wiz.p1ChkStop),
		removeShortcuts: isChecked(wiz.p1ChkShortcut),
		removeRegistry:  isChecked(wiz.p1ChkRegistry),
		keepData:        isChecked(wiz.p1ChkKeepData),
	}
	wiz.rootDir = dir
	wiz.keepData = opts.keepData
	wiz.running = true
	setPage(2)

	go func() {
		performUninstall(opts, func(pct int, msg string) {
			wiz.mu.Lock()
			wiz.stepPct = pct
			wiz.stepMsg = msg
			wiz.mu.Unlock()
			_, _, _ = procPostMessageW.Call(uintptr(wiz.hwnd), wmStep, 0, 0)
		})
		_, _, _ = procPostMessageW.Call(uintptr(wiz.hwnd), wmDone, 0, 0)
	}()
}

func performUninstall(opts uninstallOptions, report func(pct int, msg string)) {
	step := func(pct int, msg string) {
		if report != nil {
			report(pct, msg)
		}
	}

	if opts.stopProcesses {
		step(15, "Stopping any running GenMeet processes in "+opts.dir+"...")
		winui.KillProcessesInDir(opts.dir, uint32(os.Getpid()))
		time.Sleep(350 * time.Millisecond)
	}

	if opts.removeRegistry {
		step(35, "Removing Windows Installed Apps & auto-start entries...")
		winui.DeleteHKCUValue(winui.RunRegKey, "GenMeet")
		winui.DeleteHKCUKey(winui.UninstallRegKey)
	}

	if opts.removeShortcuts {
		step(55, "Removing Desktop & Start Menu shortcuts...")
		if appData := os.Getenv("APPDATA"); appData != "" {
			_ = os.RemoveAll(filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", appShortName))
		}
		if home, err := os.UserHomeDir(); err == nil {
			_ = os.Remove(filepath.Join(home, "Desktop", "GenMeet.lnk"))
		}
	}

	step(78, "Removing GenMeet application files...")
	targets := []string{
		"src", "scripts", "public", ".next", "node_modules", "build", "internal", "cmd", "installer",
		"server.ts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.tsbuildinfo",
		"next.config.mjs", "next.config.ts", "postcss.config.mjs", "eslint.config.mjs", "vitest.config.ts",
		"go.mod", "install.bat", "Start-GenMeet.bat", "LICENSE", "README.md", "version.json",
		"GenMeet-Launcher.exe", "GenMeet-Repair.exe",
	}
	if !opts.keepData {
		targets = append(targets, "genmeet.instance.json", "logs")
	}
	for _, t := range targets {
		_ = os.RemoveAll(filepath.Join(opts.dir, t))
	}

	selfExe, _ := os.Executable()
	cleanSelf := strings.ToLower(filepath.Clean(selfExe))
	cleanRoot := strings.ToLower(filepath.Clean(opts.dir))
	if strings.HasPrefix(cleanSelf, cleanRoot+string(filepath.Separator)) {
		step(92, "Scheduling cleanup of GenMeet-Uninstall.exe...")
		cleanupCmd := fmt.Sprintf(`ping -n 3 127.0.0.1 >nul & del /f /q "%s"`, selfExe)
		if !opts.keepData {
			cleanupCmd += fmt.Sprintf(` & rmdir /s /q "%s"`, opts.dir)
		}
		cmd := exec.Command("cmd.exe", "/C", cleanupCmd)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		_ = cmd.Start()
	}

	step(100, "Uninstall complete.")
}
