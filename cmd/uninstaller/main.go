//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"genmeet/internal/winui"
)

const appTitle = "GenMeet Uninstall Wizard (v" + winui.AppVersion + ")"

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
		winui.MessageBox(appTitle, "The GenMeet Uninstall Wizard is already open.", winui.MBOK|winui.MBIconInfo)
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
	if !silent {
		ans := winui.MessageBox(
			appTitle,
			fmt.Sprintf("Are you sure you want to uninstall %s from:\n%s?", winui.AppFullTitle, root),
			winui.MBYesNo|winui.MBIconQuestion,
		)
		if ans != winui.IDYES {
			return
		}
		if winui.FileExists(filepath.Join(root, "genmeet.instance.json")) {
			keepAns := winui.MessageBox(
				appTitle,
				"Keep your GenMeet instance identity (genmeet.instance.json) and logs?\n\n• Click YES to keep config\n• Click NO to delete everything",
				winui.MBYesNo|winui.MBIconQuestion,
			)
			keepConfig = keepAns == winui.IDYES
		}
	}

	winui.KillProcessesInDir(root, uint32(os.Getpid()))
	time.Sleep(400 * time.Millisecond)

	winui.DeleteHKCUValue(winui.RunRegKey, "GenMeet")
	winui.DeleteHKCUKey(winui.UninstallRegKey)

	if appData := os.Getenv("APPDATA"); appData != "" {
		_ = os.RemoveAll(filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", winui.AppShortName))
	}
	if home, err := os.UserHomeDir(); err == nil {
		_ = os.Remove(filepath.Join(home, "Desktop", "GenMeet.lnk"))
	}

	// Remove standard files; schedule self-cleanup via cmd.exe if running from inside root
	targets := []string{
		"src", "scripts", "public", ".next", "node_modules", "build", "internal", "cmd", "installer",
		"server.ts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.tsbuildinfo",
		"next.config.mjs", "next.config.ts", "postcss.config.mjs", "eslint.config.mjs", "vitest.config.ts",
		"go.mod", "install.bat", "Start-GenMeet.bat", "LICENSE", "README.md", "version.json",
		"GenMeet-Launcher.exe", "GenMeet-Repair.exe",
	}
	if !keepConfig {
		targets = append(targets, "genmeet.instance.json", "logs")
	}
	for _, t := range targets {
		_ = os.RemoveAll(filepath.Join(root, t))
	}

	selfExe, _ := os.Executable()
	cleanupCmd := fmt.Sprintf(`ping -n 2 127.0.0.1 >nul & del /f /q "%s"`, selfExe)
	if !keepConfig {
		cleanupCmd += fmt.Sprintf(` & rmdir /s /q "%s"`, root)
	}
	cmd := exec.Command("cmd.exe", "/C", cleanupCmd)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	_ = cmd.Start()

	if !silent {
		winui.MessageBox(appTitle, "GenMeet has been uninstalled.", winui.MBOK|winui.MBIconInfo)
	}
}
