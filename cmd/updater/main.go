//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	githubRepo   = "dcquijano/GenMeet"
	releasesPage = "https://github.com/dcquijano/GenMeet/releases"

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

	bsPushButton = 0x00000000
	bsDefPushBtn = 0x00000001

	esMultiline   = 0x0004
	esAutoVScroll = 0x0040
	esReadOnly    = 0x0800

	wmCreate       = 0x0001
	wmDestroy      = 0x0002
	wmClose        = 0x0010
	wmSetFont      = 0x0030
	wmSetIcon      = 0x0080
	wmCommand      = 0x0111
	wmCtlColorStat = 0x0138
	wmUser         = 0x0400
	wmUpdStep      = wmUser + 20
	wmUpdCheckDone = wmUser + 21
	wmUpdApplyDone = wmUser + 22

	stmSetIcon    = 0x0170
	pbmSetRange32 = wmUser + 6
	pbmSetPos     = wmUser + 2
	emSetSel      = 0x00B1
	emReplaceSel  = 0x00C2
	emScrollCaret = 0x00B7
	colorBtnFace  = 15

	idBtnCheck  = 301
	idBtnUpdate = 302
	idBtnRepo   = 303
	idBtnLaunch = 304
	idBtnClose  = 305
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
	procEnableWindow         = user32.NewProc("EnableWindow")
	procSetWindowTextW       = user32.NewProc("SetWindowTextW")
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

type remoteVersionInfo struct {
	Name             string   `json:"name"`
	Version          string   `json:"version"`
	Build            string   `json:"build"`
	ReleasedAt       string   `json:"releasedAt"`
	LatestCommit     string   `json:"latestCommit"`
	DirectSetupUrl   string   `json:"directSetupUrl"`
	FallbackSetupUrl string   `json:"fallbackSetupUrl"`
	RepoUrl          string   `json:"repoUrl"`
	Announcement     string   `json:"announcement"`
	Changelog        []string `json:"changelog"`
}

type updaterState struct {
	hwnd         syscall.Handle
	hInst        syscall.Handle
	hIcon48      syscall.Handle
	hIconSm      syscall.Handle
	fontTitle    syscall.Handle
	fontBold     syscall.Handle
	fontUI       syscall.Handle
	fontMono     syscall.Handle
	rootDir      string
	token        string
	busy         bool
	localVer     string
	localBuild   string
	remoteInfo   *remoteVersionInfo
	updateAvail  bool
	appliedOK    bool

	lblTitle    syscall.Handle
	lblSubtitle syscall.Handle
	lblVersions syscall.Handle
	lblStatus   syscall.Handle
	progress    syscall.Handle
	logBox      syscall.Handle

	btnCheck  syscall.Handle
	btnUpdate syscall.Handle
	btnRepo   syscall.Handle
	btnLaunch syscall.Handle
	btnClose  syscall.Handle

	mu      sync.Mutex
	stepMsg string
	stepPct int
	errText string
}

var upd = &updaterState{}

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

func detectLocalVersion(root string) (string, string) {
	ver := winui.ReadHKCUString(winui.UninstallRegKey, "DisplayVersion")
	build := ""
	if raw, err := os.ReadFile(filepath.Join(root, "version.json")); err == nil {
		var vj remoteVersionInfo
		if json.Unmarshal(raw, &vj) == nil {
			if vj.Version != "" {
				ver = vj.Version
			}
			build = vj.Build
		}
	}
	if ver == "" {
		ver = appVersion
	}
	return ver, build
}

func fetchLatestFromGitHub(token string) (*remoteVersionInfo, error) {
	client := &http.Client{Timeout: 12 * time.Second}
	rawURL := fmt.Sprintf("https://raw.githubusercontent.com/%s/main/version.json?t=%d", githubRepo, time.Now().UnixMilli())
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "GenMeet-Updater/"+appVersion)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err == nil && resp.StatusCode == http.StatusOK {
		defer resp.Body.Close()
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
		if readErr == nil {
			var info remoteVersionInfo
			if json.Unmarshal(body, &info) == nil && info.Version != "" {
				return &info, nil
			}
		}
	} else if resp != nil {
		_ = resp.Body.Close()
	}

	// Fallback: GitHub Releases latest API
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", githubRepo)
	req2, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req2.Header.Set("User-Agent", "GenMeet-Updater/"+appVersion)
	req2.Header.Set("Accept", "application/vnd.github+json")
	if token != "" {
		req2.Header.Set("Authorization", "Bearer "+token)
	}
	resp2, err := client.Do(req2)
	if err != nil {
		return nil, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub returned HTTP %d", resp2.StatusCode)
	}
	var rel struct {
		TagName string `json:"tag_name"`
		Body    string `json:"body"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(resp2.Body, 512*1024)).Decode(&rel); err != nil {
		return nil, err
	}
	v := strings.TrimPrefix(strings.TrimSpace(rel.TagName), "v")
	if v == "" {
		return nil, fmt.Errorf("no release tag found on GitHub")
	}
	info := &remoteVersionInfo{
		Name:             "GenMeet (v" + v + ")",
		Version:          v,
		RepoUrl:          "https://github.com/" + githubRepo,
		FallbackSetupUrl: fmt.Sprintf("https://raw.githubusercontent.com/%s/main/installer/GenMeet-Setup-%s.exe", githubRepo, v),
	}
	for _, a := range rel.Assets {
		if strings.HasPrefix(a.Name, "GenMeet-Setup-") && strings.HasSuffix(a.Name, ".exe") {
			info.DirectSetupUrl = a.BrowserDownloadURL
			break
		}
	}
	return info, nil
}

func downloadSetupExe(info *remoteVersionInfo, token string, report func(pct int, msg string)) (string, error) {
	candidates := []string{}
	if info.DirectSetupUrl != "" {
		candidates = append(candidates, info.DirectSetupUrl)
	}
	if info.FallbackSetupUrl != "" {
		candidates = append(candidates, info.FallbackSetupUrl)
	}
	if info.Version != "" {
		candidates = append(candidates,
			fmt.Sprintf("https://github.com/%s/releases/download/v%s/GenMeet-Setup-%s.exe", githubRepo, info.Version, info.Version),
			fmt.Sprintf("https://raw.githubusercontent.com/%s/main/installer/GenMeet-Setup-%s.exe", githubRepo, info.Version),
		)
	}

	stageDir := filepath.Join(os.TempDir(), "GenMeet-Update")
	if err := os.MkdirAll(stageDir, 0o755); err != nil {
		return "", err
	}
	destExe := filepath.Join(stageDir, fmt.Sprintf("GenMeet-Setup-%s.exe", info.Version))

	client := &http.Client{
		Timeout: 180 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 6 {
				return fmt.Errorf("too many redirects")
			}
			if !winui.IsAllowedUpdateURL(req.URL.String()) {
				return fmt.Errorf("blocked untrusted redirect host: %s", req.URL.Hostname())
			}
			return nil
		},
	}

	seen := map[string]bool{}
	var lastErr error
	for _, rawURL := range candidates {
		if seen[rawURL] || !winui.IsAllowedUpdateURL(rawURL) {
			continue
		}
		seen[rawURL] = true
		if report != nil {
			report(25, "Downloading from "+rawURL+"...")
		}
		req, err := http.NewRequest("GET", rawURL, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "GenMeet-Updater/"+appVersion)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("HTTP %d from %s", resp.StatusCode, rawURL)
			_ = resp.Body.Close()
			continue
		}

		out, err := os.OpenFile(destExe, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			_ = resp.Body.Close()
			return "", err
		}
		written, copyErr := io.Copy(out, resp.Body)
		_ = out.Close()
		_ = resp.Body.Close()
		if copyErr != nil || written < 100*1024 {
			lastErr = fmt.Errorf("incomplete download (%d bytes)", written)
			continue
		}

		// Verify PE header ("MZ") before running executable
		hdr := make([]byte, 2)
		if f, err := os.Open(destExe); err == nil {
			_, _ = f.Read(hdr)
			_ = f.Close()
		}
		if hdr[0] != 'M' || hdr[1] != 'Z' {
			lastErr = fmt.Errorf("downloaded file is not a valid Windows executable")
			continue
		}
		return destExe, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no valid GitHub download URL available")
	}
	return "", lastErr
}

func applyUpgrade(root string, info *remoteVersionInfo, token string, report func(pct int, msg string)) error {
	step := func(pct int, msg string) {
		if report != nil {
			report(pct, msg)
		}
	}

	step(15, fmt.Sprintf("Preparing update to GenMeet v%s...", info.Version))
	setupExe, err := downloadSetupExe(info, token, step)
	if err != nil {
		return err
	}

	step(65, "Stopping running GenMeet server processes in "+root+"...")
	winui.KillProcessesInDir(root, uint32(os.Getpid()))
	time.Sleep(400 * time.Millisecond)

	step(78, "Applying in-place upgrade (preserving genmeet.instance.json & logs)...")
	cmd := exec.Command(setupExe, "--silent", "--force", "--dir="+root)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("installer upgrade failed: %v %s", err, strings.TrimSpace(string(out)))
	}

	step(100, fmt.Sprintf("Upgrade to GenMeet v%s complete!", info.Version))
	return nil
}

func main() {
	hMutex, already := winui.CreateMutex(`Local\GenMeetUpdaterMutex`)
	if already {
		winui.CloseHandle(hMutex)
		winui.MessageBox(appFullTitle+" Updater", "The GenMeet Updater is already open.", winui.MBOK|winui.MBIconInfo)
		return
	}
	defer winui.CloseHandle(hMutex)

	var argDir string
	token := os.Getenv("GITHUB_TOKEN")
	silent := false

	for _, a := range os.Args[1:] {
		low := strings.ToLower(a)
		switch {
		case low == "--silent" || low == "/s":
			silent = true
		case strings.HasPrefix(low, "--dir="):
			argDir = strings.Trim(a[6:], `"`)
		case strings.HasPrefix(low, "--token="):
			token = strings.Trim(a[8:], `"`)
		}
	}

	root := resolveRoot(argDir)
	localVer, localBuild := detectLocalVersion(root)

	if silent {
		info, err := fetchLatestFromGitHub(token)
		if err != nil {
			os.Exit(1)
		}
		if !winui.IsNewerRelease(localVer, localBuild, info.Version, info.Build) {
			return
		}
		if err := applyUpgrade(root, info, token, nil); err != nil {
			os.Exit(1)
		}
		return
	}

	upd.rootDir = root
	upd.token = token
	upd.localVer = localVer
	upd.localBuild = localBuild
	runUpdaterGUI()
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
		uintptr(wsChild|wsVisible|style),
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		uintptr(parent), id, uintptr(upd.hInst), 0,
	)
	handle := syscall.Handle(hwnd)
	if font != 0 && handle != 0 {
		_, _, _ = procSendMessageW.Call(uintptr(handle), wmSetFont, uintptr(font), 1)
	}
	return handle
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

func setText(h syscall.Handle, s string) {
	_, _, _ = procSetWindowTextW.Call(uintptr(h), uintptr(unsafe.Pointer(winui.U16(s))))
}

func appendLog(h syscall.Handle, line string) {
	_, _, _ = procSendMessageW.Call(uintptr(h), emSetSel, ^uintptr(0), ^uintptr(0))
	_, _, _ = procSendMessageW.Call(uintptr(h), emReplaceSel, 0, uintptr(unsafe.Pointer(winui.U16(line+"\r\n"))))
	_, _, _ = procSendMessageW.Call(uintptr(h), emScrollCaret, 0, 0)
}

func runUpdaterGUI() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	icc := initCommonControlsEx{dwSize: uint32(unsafe.Sizeof(initCommonControlsEx{})), dwICC: 0xFFFF}
	_, _, _ = procInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&icc)))

	hInst, _, _ := procGetModuleHandleW.Call(0)
	upd.hInst = syscall.Handle(hInst)
	upd.hIcon48 = makeIcon(48)
	upd.hIconSm = makeIcon(16)
	upd.fontTitle = makeFont(-19, 700, "Segoe UI")
	upd.fontBold = makeFont(-13, 600, "Segoe UI")
	upd.fontUI = makeFont(-12, 400, "Segoe UI")
	upd.fontMono = makeFont(-12, 400, "Consolas")

	clsName := winui.U16("GenMeetUpdaterClass")
	wc := wndClassExW{
		cbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
		lpfnWndProc:   syscall.NewCallback(wndProc),
		hInstance:     upd.hInst,
		hIcon:         upd.hIcon48,
		hIconSm:       upd.hIconSm,
		hbrBackground: syscall.Handle(colorBtnFace + 1),
		lpszClassName: clsName,
	}
	_, _, _ = procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	const winW, winH = 560, 460
	sw, _, _ := procGetSystemMetrics.Call(0)
	sh, _, _ := procGetSystemMetrics.Call(1)
	x := (int(sw) - winW) / 2
	y := (int(sh) - winH) / 2

	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(clsName)),
		uintptr(unsafe.Pointer(winui.U16(appFullTitle+" GitHub Updater"))),
		uintptr(wsOverlapped|wsCaption|wsSysMenu|wsMinimizeBox|wsVisible),
		uintptr(x), uintptr(y), winW, winH,
		0, 0, uintptr(upd.hInst), 0,
	)
	upd.hwnd = syscall.Handle(hwnd)
	if upd.hIcon48 != 0 {
		_, _, _ = procSendMessageW.Call(hwnd, wmSetIcon, 1, uintptr(upd.hIcon48))
	}
	if upd.hIconSm != 0 {
		_, _, _ = procSendMessageW.Call(hwnd, wmSetIcon, 0, uintptr(upd.hIconSm))
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
		upd.hwnd = hwnd
		buildControls(hwnd)
		triggerCheck()
		return 0

	case wmCtlColorStat:
		if syscall.Handle(lParam) == upd.logBox {
			break
		}
		_, _, _ = procSetBkMode.Call(wParam, 1)
		b, _, _ := procGetSysColorBrush.Call(colorBtnFace)
		return b

	case wmCommand:
		id := uint16(wParam & 0xFFFF)
		switch id {
		case idBtnCheck:
			if !upd.busy {
				triggerCheck()
			}
		case idBtnUpdate:
			if !upd.busy && upd.remoteInfo != nil {
				triggerApply()
			}
		case idBtnRepo:
			_ = winui.OpenURL(releasesPage)
		case idBtnLaunch:
			launcher := filepath.Join(upd.rootDir, "GenMeet-Launcher.exe")
			if winui.FileExists(launcher) {
				cmd := exec.Command(launcher)
				cmd.Dir = upd.rootDir
				_ = cmd.Start()
			}
		case idBtnClose:
			if !upd.busy {
				_, _, _ = procDestroyWindow.Call(uintptr(hwnd))
			}
		}
		return 0

	case wmUpdStep:
		upd.mu.Lock()
		msgText, pct := upd.stepMsg, upd.stepPct
		upd.mu.Unlock()
		setText(upd.lblStatus, msgText)
		_, _, _ = procSendMessageW.Call(uintptr(upd.progress), pbmSetPos, uintptr(pct), 0)
		appendLog(upd.logBox, msgText)
		return 0

	case wmUpdCheckDone:
		upd.busy = false
		enableCtrl(upd.btnCheck, true)
		enableCtrl(upd.btnClose, true)
		upd.mu.Lock()
		errText := upd.errText
		info := upd.remoteInfo
		avail := upd.updateAvail
		upd.mu.Unlock()

		if errText != "" {
			setText(upd.lblStatus, "Could not check GitHub updates.")
			appendLog(upd.logBox, "ERROR: "+errText)
			enableCtrl(upd.btnUpdate, false)
			return 0
		}

		localLabel := "v" + upd.localVer
		if upd.localBuild != "" {
			localLabel += " (build " + upd.localBuild + ")"
		}
		remoteLabel := "v" + info.Version
		if info.Build != "" {
			remoteLabel += " (build " + info.Build + ")"
		}
		setText(upd.lblVersions, fmt.Sprintf("Installed: %s    |    Latest on GitHub: %s", localLabel, remoteLabel))

		if avail {
			setText(upd.lblStatus, fmt.Sprintf("New update available: GenMeet v%s!", info.Version))
			setText(upd.btnUpdate, "Download && Update")
			enableCtrl(upd.btnUpdate, true)
			appendLog(upd.logBox, fmt.Sprintf("Update found on GitHub (%s): v%s", githubRepo, info.Version))
		} else {
			setText(upd.lblStatus, fmt.Sprintf("GenMeet is up to date (v%s).", upd.localVer))
			setText(upd.btnUpdate, "Reinstall Latest")
			enableCtrl(upd.btnUpdate, true)
			appendLog(upd.logBox, "You already have the latest version from GitHub.")
		}
		if len(info.Changelog) > 0 {
			appendLog(upd.logBox, "")
			appendLog(upd.logBox, "Latest GitHub changes:")
			limit := len(info.Changelog)
			if limit > 8 {
				limit = 8
			}
			for _, c := range info.Changelog[:limit] {
				appendLog(upd.logBox, "  - "+c)
			}
		}
		_, _, _ = procSendMessageW.Call(uintptr(upd.progress), pbmSetPos, 100, 0)
		return 0

	case wmUpdApplyDone:
		upd.busy = false
		enableCtrl(upd.btnCheck, true)
		enableCtrl(upd.btnClose, true)
		upd.mu.Lock()
		errText := upd.errText
		info := upd.remoteInfo
		upd.mu.Unlock()

		if errText != "" {
			setText(upd.lblStatus, "Update failed.")
			appendLog(upd.logBox, "ERROR: "+errText)
			enableCtrl(upd.btnUpdate, true)
			winui.MessageBox(appFullTitle+" Updater", "Update failed:\n\n"+errText, winui.MBOK|winui.MBIconError)
		} else {
			upd.appliedOK = true
			upd.localVer, upd.localBuild = detectLocalVersion(upd.rootDir)
			setText(upd.lblVersions, fmt.Sprintf("Installed: v%s    |    Latest on GitHub: v%s", upd.localVer, info.Version))
			setText(upd.lblStatus, fmt.Sprintf("Updated to GenMeet v%s successfully!", info.Version))
			enableCtrl(upd.btnUpdate, false)
			enableCtrl(upd.btnLaunch, true)
			winui.MessageBox(appFullTitle+" Updater", fmt.Sprintf("GenMeet has been updated to v%s!\n\nYour Virtual Node ID and settings were preserved.", info.Version), winui.MBOK|winui.MBIconInfo)
		}
		return 0

	case wmClose:
		if upd.busy {
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
	iconCtl := createCtrl(0, "STATIC", "", ssIcon, 20, 14, 48, 48, hwnd, 0, 0)
	if upd.hIcon48 != 0 {
		_, _, _ = procSendMessageW.Call(uintptr(iconCtl), stmSetIcon, uintptr(upd.hIcon48), 0)
	}
	upd.lblTitle = createCtrl(0, "STATIC", appFullTitle+" Updater", 0, 82, 16, 440, 24, hwnd, 0, upd.fontTitle)
	upd.lblSubtitle = createCtrl(0, "STATIC", "Check && Install Updates from GitHub ("+githubRepo+") • "+appAuthor, 0, 82, 42, 440, 20, hwnd, 0, upd.fontUI)
	createCtrl(0, "STATIC", "", ssEtchedHorz, 16, 72, 512, 2, hwnd, 0, 0)

	upd.lblVersions = createCtrl(0, "STATIC", fmt.Sprintf("Installed: v%s    |    Target: %s", upd.localVer, upd.rootDir), 0, 24, 86, 496, 18, hwnd, 0, upd.fontBold)
	upd.lblStatus = createCtrl(0, "STATIC", "Checking GitHub for updates...", 0, 24, 110, 496, 18, hwnd, 0, upd.fontUI)
	upd.progress = createCtrl(0, "msctls_progress32", "", 0, 24, 134, 496, 20, hwnd, 0, 0)
	_, _, _ = procSendMessageW.Call(uintptr(upd.progress), pbmSetRange32, 0, 100)
	upd.logBox = createCtrl(wsExClientEdge, "EDIT", "",
		wsBorder|wsVScroll|esMultiline|esAutoVScroll|esReadOnly, 24, 164, 496, 190, hwnd, 0, upd.fontMono)

	createCtrl(0, "STATIC", "", ssEtchedHorz, 16, 368, 512, 2, hwnd, 0, 0)
	upd.btnCheck = createCtrl(0, "BUTTON", "Check GitHub", bsPushButton|wsTabStop, 24, 382, 100, 28, hwnd, idBtnCheck, upd.fontUI)
	upd.btnRepo = createCtrl(0, "BUTTON", "GitHub Releases", bsPushButton|wsTabStop, 130, 382, 108, 28, hwnd, idBtnRepo, upd.fontUI)
	upd.btnLaunch = createCtrl(0, "BUTTON", "Launch", bsPushButton|wsTabStop, 244, 382, 72, 28, hwnd, idBtnLaunch, upd.fontUI)
	upd.btnUpdate = createCtrl(0, "BUTTON", "Download && Update", bsDefPushBtn|wsTabStop, 322, 382, 126, 28, hwnd, idBtnUpdate, upd.fontBold)
	upd.btnClose = createCtrl(0, "BUTTON", "Close", bsPushButton|wsTabStop, 454, 382, 68, 28, hwnd, idBtnClose, upd.fontUI)

	enableCtrl(upd.btnUpdate, false)
	enableCtrl(upd.btnLaunch, winui.FileExists(filepath.Join(upd.rootDir, "GenMeet-Launcher.exe")))
}

func triggerCheck() {
	upd.busy = true
	enableCtrl(upd.btnCheck, false)
	enableCtrl(upd.btnUpdate, false)
	enableCtrl(upd.btnClose, false)
	setText(upd.lblStatus, "Checking GitHub ("+githubRepo+") for latest release...")
	_, _, _ = procSendMessageW.Call(uintptr(upd.progress), pbmSetPos, 20, 0)
	appendLog(upd.logBox, "Checking https://github.com/"+githubRepo+" for new updates...")

	go func() {
		info, err := fetchLatestFromGitHub(upd.token)
		upd.mu.Lock()
		if err != nil {
			upd.errText = err.Error()
			upd.remoteInfo = nil
			upd.updateAvail = false
		} else {
			upd.errText = ""
			upd.remoteInfo = info
			upd.updateAvail = winui.IsNewerRelease(upd.localVer, upd.localBuild, info.Version, info.Build)
		}
		upd.mu.Unlock()
		_, _, _ = procPostMessageW.Call(uintptr(upd.hwnd), wmUpdCheckDone, 0, 0)
	}()
}

func triggerApply() {
	upd.busy = true
	enableCtrl(upd.btnCheck, false)
	enableCtrl(upd.btnUpdate, false)
	enableCtrl(upd.btnLaunch, false)
	enableCtrl(upd.btnClose, false)

	go func() {
		err := applyUpgrade(upd.rootDir, upd.remoteInfo, upd.token, func(pct int, msg string) {
			upd.mu.Lock()
			upd.stepPct = pct
			upd.stepMsg = msg
			upd.mu.Unlock()
			_, _, _ = procPostMessageW.Call(uintptr(upd.hwnd), wmUpdStep, 0, 0)
		})
		upd.mu.Lock()
		if err != nil {
			upd.errText = err.Error()
		} else {
			upd.errText = ""
		}
		upd.mu.Unlock()
		_, _, _ = procPostMessageW.Call(uintptr(upd.hwnd), wmUpdApplyDone, 0, 0)
	}()
}
