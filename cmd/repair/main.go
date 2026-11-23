//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"genmeet/internal/winui"
)

const appTitle = "GenMeet Repair Wizard (v" + winui.AppVersion + ")"

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
	}
	return winui.DefaultInstallDir
}

func runHidden(dir, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v\n%s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func main() {
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
	if !winui.FileExists(filepath.Join(root, "server.ts")) {
		if !silent {
			winui.MessageBox(appTitle, fmt.Sprintf("GenMeet installation not found at:\n%s", root), winui.MBOK|winui.MBIconError)
		}
		os.Exit(1)
	}

	if !silent {
		ans := winui.MessageBox(
			appTitle,
			fmt.Sprintf(
				"Repair GenMeet installation in:\n%s\n\nThis will:\n• Stop stale GenMeet processes\n• Verify dependencies & rebuild missing Next.js production files\n• Restore shortcuts & assign a free port if needed\n\nProceed with repair?",
				root,
			),
			winui.MBYesNo|winui.MBIconQuestion,
		)
		if ans != winui.IDYES {
			return
		}
	}

	winui.KillProcessesInDir(root, uint32(os.Getpid()))

	if !winui.DirExists(filepath.Join(root, "node_modules")) {
		if err := runHidden(root, "npm.cmd", "install", "--omit=dev"); err != nil {
			if !silent {
				winui.MessageBox(appTitle, fmt.Sprintf("npm install failed:\n%v", err), winui.MBOK|winui.MBIconError)
			}
			os.Exit(1)
		}
	}

	if resetConfig || !winui.FileExists(filepath.Join(root, "genmeet.instance.json")) {
		_, _ = winui.LoadOrCreateInstanceConfig(root, true)
	} else {
		cfg, _ := winui.LoadOrCreateInstanceConfig(root, false)
		if !winui.IsPortAvailable(cfg.Port) {
			_, _ = winui.LoadOrCreateInstanceConfig(root, true)
		}
	}

	if !winui.FileExists(filepath.Join(root, ".next", "BUILD_ID")) {
		_ = os.RemoveAll(filepath.Join(root, ".next"))
		_ = os.Remove(filepath.Join(root, "tsconfig.tsbuildinfo"))
		if err := runHidden(root, "npm.cmd", "run", "build"); err != nil {
			if !silent {
				winui.MessageBox(appTitle, fmt.Sprintf("Production build failed:\n%v", err), winui.MBOK|winui.MBIconError)
			}
			os.Exit(1)
		}
	}

	launcher := filepath.Join(root, "GenMeet-Launcher.exe")
	if winui.FileExists(launcher) {
		if desktop, err := os.UserHomeDir(); err == nil {
			_ = winui.CreateShortcut(
				filepath.Join(desktop, "Desktop", "GenMeet.lnk"),
				launcher, "", root, launcher+",0", "Launch GenMeet",
			)
		}
	}

	cfg, _ := winui.LoadOrCreateInstanceConfig(root, false)
	if !silent {
		msg := fmt.Sprintf(
			"GenMeet repair completed!\n\nLocation: %s\nVirtual Node ID: %s\nLocal URL: http://localhost:%d",
			root, cfg.VirtualIP, cfg.Port,
		)
		if !noLaunch && winui.FileExists(launcher) {
			ans := winui.MessageBox(appTitle, msg+"\n\nLaunch GenMeet now?", winui.MBYesNo|winui.MBIconInfo)
			if ans == winui.IDYES {
				cmd := exec.Command(launcher)
				cmd.Dir = root
				_ = cmd.Start()
			}
		} else {
			winui.MessageBox(appTitle, msg, winui.MBOK|winui.MBIconInfo)
		}
	}
}
