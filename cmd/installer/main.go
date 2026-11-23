//go:build windows

package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
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
	appVersion   = winui.AppVersion
	appAuthor    = winui.AppAuthor
	defaultDir   = winui.DefaultInstallDir
	uninstallKey = winui.UninstallRegKey
	runKey       = winui.RunRegKey

	mitLicenseText = "MIT License\r\n\r\n" +
		"Copyright (c) 2026 Darius Cumpio\r\n\r\n" +
		"Permission is hereby granted, free of charge, to any person obtaining a copy " +
		"of this software and associated documentation files (the \"Software\"), to deal " +
		"in the Software without restriction, including without limitation the rights " +
		"to use, copy, modify, merge, publish, distribute, sublicense, and/or sell " +
		"copies of the Software, and to permit persons to whom the Software is " +
		"furnished to do so, subject to the following conditions:\r\n\r\n" +
		"The above copyright notice and this permission notice shall be included in all " +
		"copies or substantial portions of the Software.\r\n\r\n" +
		"THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR " +
		"IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, " +
		"FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT."
)

type installOptions struct {
	dir          string
	desktop      bool
	startMenu    bool
	autoStart    bool
	repair       bool
	resetConfigs bool
}

const (
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
	wmInstStep     = wmUser + 10
	wmInstDone     = wmUser + 11

	bmGetCheck = 0x00F0
	bmSetCheck = 0x00F1
	bstChecked = 1

	stmSetIcon = 0x0170

	pbmSetRange32 = wmUser + 6
	pbmSetPos     = wmUser + 2

	emSetSel      = 0x00B1
	emReplaceSel  = 0x00C2
	emScrollCaret = 0x00B7

	swHide = 0
	swShow = 5

	colorBtnFace = 15

	idBtnBack     = 101
	idBtnNext     = 102
	idBtnCancel   = 103
	idChkAccept   = 201
	idEditDir     = 301
	idBtnBrowse   = 302
	idChkDesktop  = 303
	idChkStartMnu = 304
	idChkBoot     = 306
	idChkResetCfg = 308
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

type wizardState struct {
	hwnd         syscall.Handle
	hInst        syscall.Handle
	hIcon48      syscall.Handle
	hIconSm      syscall.Handle
	fontTitle    syscall.Handle
	fontBold     syscall.Handle
	fontUI       syscall.Handle
	fontMono     syscall.Handle
	page         int
	installing   bool
	repairMode   bool
	resetConfigs bool
	finalDir     string
	finalCfg     winui.InstanceConfig

	lblTitle    syscall.Handle
	lblSubtitle syscall.Handle

	p1Intro  syscall.Handle
	p1LicBox syscall.Handle
	p1Accept syscall.Handle

	p2LblDir      syscall.Handle
	p2EditDir     syscall.Handle
	p2BtnBrw      syscall.Handle
	p2LblOpt      syscall.Handle
	p2ChkDesk     syscall.Handle
	p2ChkMenu     syscall.Handle
	p2ChkBoot     syscall.Handle
	p2ChkResetCfg syscall.Handle

	p3Status   syscall.Handle
	p3Progress syscall.Handle
	p3LogBox   syscall.Handle

	p4DoneTitle syscall.Handle
	p4Summary   syscall.Handle
	p4ChkLaunch syscall.Handle

	btnBack   syscall.Handle
	btnNext   syscall.Handle
	btnCancel syscall.Handle

	mu      sync.Mutex
	stepMsg string
	stepPct int
	errText string
}

var wiz = &wizardState{finalDir: defaultDir}

func main() {
	hMutex, already := winui.CreateMutex(`Local\GenMeetSetupWizardMutex`)
	if already {
		winui.CloseHandle(hMutex)
		winui.MessageBox(appFullTitle+" Setup", "The GenMeet Setup Wizard is already running.", winui.MBOK|winui.MBIconInfo)
		return
	}
	defer winui.CloseHandle(hMutex)

	installDir := defaultDir
	silent := false
	forceUpdate := false
	repairMode := false
	resetConfigs := false
	autoStart := false
	noDesktop := false

	for _, a := range os.Args[1:] {
		low := strings.ToLower(a)
		switch {
		case low == "--silent" || low == "/s" || low == "/verysilent":
			silent = true
		case low == "--force" || low == "--update":
			forceUpdate = true
		case low == "--repair" || low == "/repair":
			repairMode = true
		case low == "--reset-config" || low == "--reset":
			resetConfigs = true
		case low == "--autostart":
			autoStart = true
		case low == "--no-desktop":
			noDesktop = true
		case strings.HasPrefix(low, "--dir="):
			installDir = strings.Trim(a[6:], `"`)
		}
	}

	if !forceUpdate {
		if existingDir := winui.DetectExistingInstallation(installDir); existingDir != "" {
			installedVer := winui.ReadHKCUString(uninstallKey, "DisplayVersion")
			isUpgrade := installedVer != "" && installedVer != appVersion
			if silent {
				if !repairMode && !isUpgrade {
					os.Exit(1)
				}
				installDir = existingDir
			} else if repairMode {
				wiz.repairMode = true
				wiz.finalDir = existingDir
			} else if isUpgrade {
				ans := winui.MessageBox(
					fmt.Sprintf("%s Setup — Upgrade from v%s", appFullTitle, installedVer),
					fmt.Sprintf(
						"GenMeet (v%s) is currently installed at:\n%s\n\nA newer version (%s) is ready!\n\n• Click YES to UPGRADE in-place to v%s (keeps your Virtual Node ID & settings)\n• Click NO to launch GenMeet now\n• Click CANCEL to exit Setup",
						installedVer, existingDir, appFullTitle, appVersion,
					),
					winui.MBYesNoCancel|winui.MBIconInfo,
				)
				if ans == winui.IDYES {
					wiz.repairMode = true
					wiz.finalDir = existingDir
				} else {
					if ans == winui.IDNO {
						launcher := filepath.Join(existingDir, "GenMeet-Launcher.exe")
						cmd := exec.Command(launcher)
						cmd.Dir = existingDir
						_ = cmd.Start()
					}
					return
				}
			} else {
				ans := winui.MessageBox(
					appFullTitle+" Setup — Already Installed",
					fmt.Sprintf(
						"%s is already installed at:\n%s\n\n• Click YES to REPAIR / REINSTALL in-place (keeps your unique Node ID unless reset)\n• Click NO to launch GenMeet now\n• Click CANCEL to exit Setup",
						appFullTitle, existingDir,
					),
					winui.MBYesNoCancel|winui.MBIconInfo,
				)
				if ans == winui.IDYES {
					wiz.repairMode = true
					wiz.finalDir = existingDir
				} else {
					if ans == winui.IDNO {
						launcher := filepath.Join(existingDir, "GenMeet-Launcher.exe")
						cmd := exec.Command(launcher)
						cmd.Dir = existingDir
						_ = cmd.Start()
					}
					return
				}
			}
		}
	}

	if silent {
		opts := installOptions{
			dir:          installDir,
			desktop:      !noDesktop,
			startMenu:    true,
			autoStart:    autoStart,
			repair:       repairMode,
			resetConfigs: resetConfigs,
		}
		if _, err := performInstall(opts, nil); err != nil {
			os.Exit(1)
		}
		return
	}

	wiz.resetConfigs = resetConfigs
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

	clsName := winui.U16("GenMeetSetupWizardClass")
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
		uintptr(unsafe.Pointer(winui.U16(appFullTitle+" Setup"))),
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
		if wiz.repairMode {
			setPage(2)
		} else {
			setPage(1)
		}
		return 0

	case wmCtlColorStat:
		if syscall.Handle(lParam) == wiz.p1LicBox || syscall.Handle(lParam) == wiz.p3LogBox {
			break
		}
		_, _, _ = procSetBkMode.Call(wParam, 1)
		b, _, _ := procGetSysColorBrush.Call(colorBtnFace)
		return b

	case wmCommand:
		id := uint16(wParam & 0xFFFF)
		switch id {
		case idChkAccept:
			enableCtrl(wiz.btnNext, isChecked(wiz.p1Accept))
		case idBtnBrowse:
			if picked := winui.BrowseForFolder("Choose destination folder for GenMeet:"); picked != "" {
				setText(wiz.p2EditDir, picked)
			}
		case idBtnBack:
			if wiz.page == 2 && !wiz.repairMode {
				setPage(1)
			}
		case idBtnNext:
			switch wiz.page {
			case 1:
				setPage(2)
			case 2:
				startInstallFromUI()
			case 4:
				if isChecked(wiz.p4ChkLaunch) {
					launcher := filepath.Join(wiz.finalDir, "GenMeet-Launcher.exe")
					cmd := exec.Command(launcher)
					cmd.Dir = wiz.finalDir
					_ = cmd.Start()
				}
				_, _, _ = procDestroyWindow.Call(uintptr(hwnd))
			}
		case idBtnCancel:
			if !wiz.installing {
				_, _, _ = procDestroyWindow.Call(uintptr(hwnd))
			}
		}
		return 0

	case wmInstStep:
		wiz.mu.Lock()
		msgText, pct := wiz.stepMsg, wiz.stepPct
		wiz.mu.Unlock()
		setText(wiz.p3Status, msgText)
		_, _, _ = procSendMessageW.Call(uintptr(wiz.p3Progress), pbmSetPos, uintptr(pct), 0)
		appendLog(wiz.p3LogBox, msgText)
		return 0

	case wmInstDone:
		wiz.installing = false
		wiz.mu.Lock()
		errText := wiz.errText
		cfg := wiz.finalCfg
		wiz.mu.Unlock()
		if errText != "" {
			setText(wiz.p3Status, "Installation failed.")
			appendLog(wiz.p3LogBox, "ERROR: "+errText)
			enableCtrl(wiz.btnCancel, true)
			setText(wiz.btnCancel, "Close")
			winui.MessageBox(appFullTitle+" Setup", "Installation failed:\n\n"+errText, winui.MBOK|winui.MBIconError)
		} else {
			lans := winui.DetectLanIPs()
			lanLine := ""
			if len(lans) > 0 {
				lanLine = fmt.Sprintf("\r\nLAN URL: http://%s:%d", lans[0], cfg.Port)
			}
			setText(
				wiz.p4Summary,
				fmt.Sprintf(
					"%s has been installed to:\r\n%s\r\n\r\nUnique Virtual Node ID: %s\r\nLocal URL: http://localhost:%d%s\r\n\r\nYou can also repair or uninstall anytime via Start Menu or Windows Settings > Installed Apps.",
					appFullTitle, wiz.finalDir, cfg.VirtualIP, cfg.Port, lanLine,
				),
			)
			setPage(4)
		}
		return 0

	case wmClose:
		if wiz.installing {
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
	wiz.lblTitle = createCtrl(0, "STATIC", appFullTitle+" Setup", wsVisible, 82, 16, 440, 24, hwnd, 0, wiz.fontTitle)
	wiz.lblSubtitle = createCtrl(0, "STATIC", "Real-time WebRTC video meetings • Created by "+appAuthor, wsVisible, 82, 42, 440, 20, hwnd, 0, wiz.fontUI)
	createCtrl(0, "STATIC", "", wsVisible|ssEtchedHorz, 16, 72, 512, 2, hwnd, 0, 0)

	// Page 1
	wiz.p1Intro = createCtrl(0, "STATIC",
		"Welcome to the GenMeet Setup Wizard.\r\n\r\n"+
			"This installs GenMeet, its native Launcher, Repair tool, and Uninstaller, and assigns a unique Virtual Node ID for this installation.\r\n\r\n"+
			"Please review the MIT License below to continue:",
		0, 24, 86, 496, 78, hwnd, 0, wiz.fontUI)
	wiz.p1LicBox = createCtrl(wsExClientEdge, "EDIT", mitLicenseText,
		wsBorder|wsVScroll|esMultiline|esAutoVScroll|esReadOnly, 24, 170, 496, 134, hwnd, 0, wiz.fontMono)
	wiz.p1Accept = createCtrl(0, "BUTTON", "I accept the MIT License agreement", bsAutoCheckBox|wsTabStop, 24, 314, 340, 22, hwnd, idChkAccept, wiz.fontBold)
	setChecked(wiz.p1Accept, true)

	// Page 2
	wiz.p2LblDir = createCtrl(0, "STATIC", "Install GenMeet to folder:", 0, 24, 88, 400, 18, hwnd, 0, wiz.fontBold)
	wiz.p2EditDir = createCtrl(wsExClientEdge, "EDIT", wiz.finalDir, wsBorder|wsTabStop|esAutoHScroll, 24, 110, 400, 24, hwnd, idEditDir, wiz.fontUI)
	wiz.p2BtnBrw = createCtrl(0, "BUTTON", "Browse...", bsPushButton|wsTabStop, 434, 109, 86, 26, hwnd, idBtnBrowse, wiz.fontUI)
	wiz.p2LblOpt = createCtrl(0, "STATIC", "Installation options:", 0, 24, 152, 400, 18, hwnd, 0, wiz.fontBold)
	wiz.p2ChkDesk = createCtrl(0, "BUTTON", "Create a Desktop shortcut (GenMeet)", bsAutoCheckBox|wsTabStop, 32, 178, 460, 22, hwnd, idChkDesktop, wiz.fontUI)
	wiz.p2ChkMenu = createCtrl(0, "BUTTON", "Create Start Menu shortcuts (Launcher, Terminal, Repair, Uninstall)", bsAutoCheckBox|wsTabStop, 32, 206, 480, 22, hwnd, idChkStartMnu, wiz.fontUI)
	wiz.p2ChkBoot = createCtrl(0, "BUTTON", "Start GenMeet automatically when Windows signs in", bsAutoCheckBox|wsTabStop, 32, 234, 460, 22, hwnd, idChkBoot, wiz.fontUI)
	wiz.p2ChkResetCfg = createCtrl(0, "BUTTON", "Generate a fresh unique Virtual Node ID & free port", bsAutoCheckBox|wsTabStop, 32, 262, 460, 22, hwnd, idChkResetCfg, wiz.fontUI)
	setChecked(wiz.p2ChkDesk, true)
	setChecked(wiz.p2ChkMenu, true)
	setChecked(wiz.p2ChkResetCfg, !wiz.repairMode || wiz.resetConfigs)

	// Page 3
	wiz.p3Status = createCtrl(0, "STATIC", "Preparing installation...", 0, 24, 92, 496, 20, hwnd, 0, wiz.fontBold)
	wiz.p3Progress = createCtrl(0, "msctls_progress32", "", 0, 24, 118, 496, 20, hwnd, 0, 0)
	_, _, _ = procSendMessageW.Call(uintptr(wiz.p3Progress), pbmSetRange32, 0, 100)
	wiz.p3LogBox = createCtrl(wsExClientEdge, "EDIT", "",
		wsBorder|wsVScroll|esMultiline|esAutoVScroll|esReadOnly, 24, 150, 496, 188, hwnd, 0, wiz.fontMono)

	// Page 4
	wiz.p4DoneTitle = createCtrl(0, "STATIC", "Completing the GenMeet Setup Wizard", 0, 24, 90, 496, 24, hwnd, 0, wiz.fontTitle)
	wiz.p4Summary = createCtrl(0, "STATIC", "", 0, 24, 124, 496, 150, hwnd, 0, wiz.fontUI)
	wiz.p4ChkLaunch = createCtrl(0, "BUTTON", "Launch GenMeet in Google Chrome now", bsAutoCheckBox|wsTabStop, 24, 290, 360, 22, hwnd, idChkLaunch, wiz.fontBold)
	setChecked(wiz.p4ChkLaunch, true)

	// Footer
	createCtrl(0, "STATIC", "", wsVisible|ssEtchedHorz, 16, 354, 512, 2, hwnd, 0, 0)
	wiz.btnBack = createCtrl(0, "BUTTON", "< Back", wsVisible|bsPushButton|wsTabStop, 250, 368, 86, 28, hwnd, idBtnBack, wiz.fontUI)
	wiz.btnNext = createCtrl(0, "BUTTON", "Next >", wsVisible|bsDefPushBtn|wsTabStop, 344, 368, 86, 28, hwnd, idBtnNext, wiz.fontBold)
	wiz.btnCancel = createCtrl(0, "BUTTON", "Cancel", wsVisible|bsPushButton|wsTabStop, 438, 368, 86, 28, hwnd, idBtnCancel, wiz.fontUI)
}

func setPage(p int) {
	wiz.page = p

	for _, h := range []syscall.Handle{wiz.p1Intro, wiz.p1LicBox, wiz.p1Accept} {
		showCtrl(h, p == 1)
	}
	for _, h := range []syscall.Handle{
		wiz.p2LblDir, wiz.p2EditDir, wiz.p2BtnBrw, wiz.p2LblOpt,
		wiz.p2ChkDesk, wiz.p2ChkMenu, wiz.p2ChkBoot, wiz.p2ChkResetCfg,
	} {
		showCtrl(h, p == 2)
	}
	for _, h := range []syscall.Handle{wiz.p3Status, wiz.p3Progress, wiz.p3LogBox} {
		showCtrl(h, p == 3)
	}
	for _, h := range []syscall.Handle{wiz.p4DoneTitle, wiz.p4Summary, wiz.p4ChkLaunch} {
		showCtrl(h, p == 4)
	}

	switch p {
	case 1:
		setText(wiz.lblSubtitle, "Step 1 of 3 — Welcome & License Agreement")
		showCtrl(wiz.btnBack, false)
		showCtrl(wiz.btnNext, true)
		showCtrl(wiz.btnCancel, true)
		setText(wiz.btnNext, "Next >")
		enableCtrl(wiz.btnNext, isChecked(wiz.p1Accept))
	case 2:
		if wiz.repairMode {
			setText(wiz.lblSubtitle, "Repair Existing Installation — Options")
			setText(wiz.btnNext, "Repair")
		} else {
			setText(wiz.lblSubtitle, "Step 2 of 3 — Destination & Options")
			setText(wiz.btnNext, "Install")
		}
		showCtrl(wiz.btnBack, !wiz.repairMode)
		enableCtrl(wiz.btnBack, !wiz.repairMode)
		showCtrl(wiz.btnNext, true)
		enableCtrl(wiz.btnNext, true)
		showCtrl(wiz.btnCancel, true)
	case 3:
		setText(wiz.lblSubtitle, "Step 3 of 3 — Installing GenMeet...")
		showCtrl(wiz.btnBack, false)
		showCtrl(wiz.btnNext, true)
		enableCtrl(wiz.btnBack, false)
		enableCtrl(wiz.btnNext, false)
		enableCtrl(wiz.btnCancel, false)
	case 4:
		setText(wiz.lblSubtitle, "Setup Complete")
		showCtrl(wiz.btnBack, false)
		showCtrl(wiz.btnCancel, false)
		showCtrl(wiz.btnNext, true)
		enableCtrl(wiz.btnNext, true)
		setText(wiz.btnNext, "Finish")
	}
}

func startInstallFromUI() {
	dir := getText(wiz.p2EditDir)
	if dir == "" {
		winui.MessageBox(appFullTitle+" Setup", "Please choose an installation folder.", winui.MBOK|winui.MBIconWarning)
		return
	}
	opts := installOptions{
		dir:          dir,
		desktop:      isChecked(wiz.p2ChkDesk),
		startMenu:    isChecked(wiz.p2ChkMenu),
		autoStart:    isChecked(wiz.p2ChkBoot),
		repair:       wiz.repairMode,
		resetConfigs: isChecked(wiz.p2ChkResetCfg),
	}
	wiz.finalDir = dir
	wiz.installing = true
	setPage(3)

	go func() {
		cfg, err := performInstall(opts, func(pct int, msg string) {
			wiz.mu.Lock()
			wiz.stepPct = pct
			wiz.stepMsg = msg
			wiz.mu.Unlock()
			_, _, _ = procPostMessageW.Call(uintptr(wiz.hwnd), wmInstStep, 0, 0)
		})
		wiz.mu.Lock()
		wiz.finalCfg = cfg
		if err != nil {
			wiz.errText = err.Error()
		} else {
			wiz.errText = ""
		}
		wiz.mu.Unlock()
		_, _, _ = procPostMessageW.Call(uintptr(wiz.hwnd), wmInstDone, 0, 0)
	}()
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

func performInstall(opts installOptions, report func(pct int, msg string)) (winui.InstanceConfig, error) {
	step := func(pct int, msg string) {
		if report != nil {
			report(pct, msg)
		}
	}

	step(8, "Stopping any running GenMeet processes in "+opts.dir+"...")
	winui.KillProcessesInDir(opts.dir, uint32(os.Getpid()))
	time.Sleep(250 * time.Millisecond)

	if err := os.MkdirAll(opts.dir, 0o755); err != nil {
		return winui.InstanceConfig{}, fmt.Errorf("create install dir: %w", err)
	}

	if len(embeddedPayloadZip) > 0 {
		step(22, "Extracting GenMeet application bundle...")
		// Remove legacy next.config.ts so Next.js uses next.config.mjs without runtime TypeScript install
		_ = os.Remove(filepath.Join(opts.dir, "next.config.ts"))
		if err := extractZipBytes(embeddedPayloadZip, opts.dir); err != nil {
			return winui.InstanceConfig{}, fmt.Errorf("extract payload: %w", err)
		}
	} else {
		step(22, "Copying companion binaries from current folder...")
		if err := copySelfCompanions(opts.dir); err != nil {
			return winui.InstanceConfig{}, err
		}
	}

	if _, err := exec.LookPath("node"); err != nil {
		return winui.InstanceConfig{}, fmt.Errorf("Node.js 20+ was not found in PATH. Install Node.js LTS from https://nodejs.org/ and run Setup again")
	}

	if !winui.DirExists(filepath.Join(opts.dir, "node_modules")) {
		step(48, "Installing Node.js dependencies (npm install --omit=dev)...")
		if err := runHidden(opts.dir, "npm.cmd", "install", "--omit=dev"); err != nil {
			return winui.InstanceConfig{}, fmt.Errorf("npm install failed: %w", err)
		}
	} else {
		step(55, "Verified existing node_modules directory.")
	}

	step(72, "Configuring unique per-install Virtual Node ID and port...")
	cfg, err := winui.LoadOrCreateInstanceConfig(opts.dir, opts.resetConfigs)
	if err != nil {
		return cfg, fmt.Errorf("write genmeet.instance.json: %w", err)
	}

	if !winui.FileExists(filepath.Join(opts.dir, ".next", "BUILD_ID")) {
		step(82, "Building Next.js production bundle...")
		_ = os.RemoveAll(filepath.Join(opts.dir, ".next"))
		if err := runHidden(opts.dir, "npm.cmd", "run", "build"); err != nil {
			return cfg, fmt.Errorf("next build failed: %w", err)
		}
	}

	step(90, "Creating Windows shortcuts & Installed Apps entry...")
	launcher := filepath.Join(opts.dir, "GenMeet-Launcher.exe")
	repairExe := filepath.Join(opts.dir, "GenMeet-Repair.exe")
	uninstExe := filepath.Join(opts.dir, "GenMeet-Uninstall.exe")
	iconRef := launcher + ",0"

	if opts.startMenu {
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

	if opts.desktop {
		if home, err := os.UserHomeDir(); err == nil {
			_ = winui.CreateShortcut(filepath.Join(home, "Desktop", "GenMeet.lnk"), launcher, "", opts.dir, iconRef, "Launch GenMeet")
		}
	}

	_ = winui.WriteHKCUValue(uninstallKey, "DisplayName", "REG_SZ", appFullTitle)
	_ = winui.WriteHKCUValue(uninstallKey, "DisplayVersion", "REG_SZ", appVersion)
	_ = winui.WriteHKCUValue(uninstallKey, "Publisher", "REG_SZ", appAuthor)
	_ = winui.WriteHKCUValue(uninstallKey, "InstallLocation", "REG_SZ", opts.dir)
	_ = winui.WriteHKCUValue(uninstallKey, "DisplayIcon", "REG_SZ", iconRef)
	_ = winui.WriteHKCUValue(uninstallKey, "InstallDate", "REG_SZ", time.Now().Format("20060102"))
	if winui.FileExists(uninstExe) {
		_ = winui.WriteHKCUValue(uninstallKey, "UninstallString", "REG_SZ", `"`+uninstExe+`"`)
	}
	if opts.autoStart {
		_ = winui.WriteHKCUValue(runKey, "GenMeet", "REG_SZ", `"`+launcher+`"`)
	}

	step(100, fmt.Sprintf("Done! Node %s ready on http://localhost:%d", cfg.VirtualIP, cfg.Port))
	return cfg, nil
}

func extractZipBytes(zipBytes []byte, dest string) error {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return err
	}
	cleanDest := filepath.Clean(dest)
	for _, f := range zr.File {
		target := filepath.Join(cleanDest, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(filepath.Clean(target)+string(filepath.Separator), cleanDest+string(filepath.Separator)) &&
			filepath.Clean(target) != cleanDest {
			return fmt.Errorf("unsafe zip path: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(target, 0o755)
			continue
		}
		_ = os.MkdirAll(filepath.Dir(target), 0o755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			_ = rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, rc)
		_ = out.Close()
		_ = rc.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	return nil
}

func copySelfCompanions(dest string) error {
	selfExe, err := os.Executable()
	if err != nil {
		return err
	}
	srcDir := filepath.Dir(selfExe)
	for _, name := range []string{"GenMeet-Launcher.exe", "GenMeet-Repair.exe", "GenMeet-Uninstall.exe"} {
		src := filepath.Join(srcDir, name)
		if winui.FileExists(src) {
			data, err := os.ReadFile(src)
			if err == nil {
				_ = os.WriteFile(filepath.Join(dest, name), data, 0o644)
			}
		}
	}
	return nil
}
