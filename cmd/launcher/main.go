//go:build windows

package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"genmeet/internal/winui"
)

const appTitle = "GenMeet Launcher (v" + winui.AppVersion + ")"

func resolveRoot() string {
	if h := os.Getenv("GENMEET_HOME"); h != "" {
		if abs, err := filepath.Abs(h); err == nil {
			return abs
		}
		return h
	}
	if exe, err := os.Executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		dir := filepath.Dir(exe)
		if winui.FileExists(filepath.Join(dir, "server.ts")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if winui.FileExists(filepath.Join(parent, "server.ts")) {
			return parent
		}
	}
	if loc := winui.ReadHKCUString(winui.UninstallRegKey, "InstallLocation"); loc != "" {
		if winui.FileExists(filepath.Join(loc, "server.ts")) {
			return loc
		}
	}
	wd, _ := os.Getwd()
	return wd
}

func isServerHealthy(port int) bool {
	client := &http.Client{Timeout: 1200 * time.Millisecond}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return false
	}
	_ = resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func openTerminal(root string, cfg winui.InstanceConfig) {
	initDir := filepath.Join(root, "logs")
	_ = os.MkdirAll(initDir, 0o755)
	initCmd := filepath.Join(initDir, "terminal-init.cmd")
	script := fmt.Sprintf(
		"@echo off\r\ntitle GenMeet (v%s) Terminal\r\necho GenMeet (v%s) - Node %s - http://localhost:%d\r\necho.\r\n",
		winui.AppVersion, winui.AppVersion, cfg.VirtualIP, cfg.Port,
	)
	_ = os.WriteFile(initCmd, []byte(script), 0o644)

	cmdExe := filepath.Join(os.Getenv("SystemRoot"), "System32", "cmd.exe")
	cmd := exec.Command(cmdExe, "/C", "start", "GenMeet Terminal", cmdExe, "/K", initCmd)
	cmd.Dir = root
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	if err := cmd.Start(); err != nil {
		winui.MessageBox(appTitle, fmt.Sprintf("Failed to open terminal:\n%v", err), winui.MBOK|winui.MBIconError)
	}
}

func main() {
	root := resolveRoot()
	cfg, _ := winui.LoadOrCreateInstanceConfig(root, false)

	for _, a := range os.Args[1:] {
		switch strings.ToLower(a) {
		case "--version", "-v":
			lans := winui.DetectLanIPs()
			lanText := "(none)"
			if len(lans) > 0 {
				lanText = fmt.Sprintf("http://%s:%d", lans[0], cfg.Port)
			}
			winui.MessageBox(
				appTitle,
				fmt.Sprintf(
					"%s\nCreated by: %s\n\nInstall ID: %s\nVirtual Node ID: %s\nLocal URL: http://localhost:%d\nLAN URL: %s",
					winui.AppFullTitle, winui.AppAuthor, cfg.InstanceID, cfg.VirtualIP, cfg.Port, lanText,
				),
				winui.MBOK|winui.MBIconInfo,
			)
			return
		case "--terminal", "-t":
			openTerminal(root, cfg)
			return
		case "--stop-all":
			winui.KillProcessesInDir(root, uint32(os.Getpid()))
			return
		}
	}

	if !winui.FileExists(filepath.Join(root, "server.ts")) {
		winui.MessageBox(
			appTitle,
			fmt.Sprintf("Could not locate GenMeet files in:\n%s\n\nRun GenMeet-Setup or GenMeet-Repair.", root),
			winui.MBOK|winui.MBIconError,
		)
		return
	}

	url := fmt.Sprintf("http://localhost:%d", cfg.Port)
	if isServerHealthy(cfg.Port) {
		_ = winui.OpenURL(url)
		return
	}

	if _, err := exec.LookPath("node"); err != nil {
		winui.MessageBox(
			appTitle,
			"Node.js 20+ was not found in PATH.\n\nPlease install Node.js LTS from https://nodejs.org/ and run GenMeet-Repair.exe.",
			winui.MBOK|winui.MBIconError,
		)
		return
	}

	if !winui.FileExists(filepath.Join(root, ".next", "BUILD_ID")) ||
		!winui.DirExists(filepath.Join(root, "node_modules")) {
		repairExe := filepath.Join(root, "GenMeet-Repair.exe")
		if winui.FileExists(repairExe) {
			cmd := exec.Command(repairExe, "--dir="+root, "--no-launch")
			cmd.Dir = root
			_ = cmd.Run()
		}
	}

	logsDir := filepath.Join(root, "logs")
	_ = os.MkdirAll(logsDir, 0o755)
	logFile, err := os.OpenFile(filepath.Join(logsDir, "server.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err == nil {
		defer logFile.Close()
	}

	tsxBin := filepath.Join(root, "node_modules", ".bin", "tsx.cmd")
	var srvCmd *exec.Cmd
	if winui.FileExists(tsxBin) {
		srvCmd = exec.Command(tsxBin, "server.ts", "--prod")
	} else {
		srvCmd = exec.Command("npm.cmd", "run", "start")
	}
	srvCmd.Dir = root
	srvCmd.Env = append(os.Environ(), fmt.Sprintf("PORT=%d", cfg.Port), "NODE_ENV=production")
	srvCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	if logFile != nil {
		srvCmd.Stdout = logFile
		srvCmd.Stderr = logFile
	}
	if err := srvCmd.Start(); err != nil {
		winui.MessageBox(appTitle, fmt.Sprintf("Failed to start GenMeet server:\n%v", err), winui.MBOK|winui.MBIconError)
		return
	}

	ready := false
	for i := 0; i < 60; i++ {
		if isServerHealthy(cfg.Port) {
			ready = true
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if !ready {
		winui.MessageBox(
			appTitle,
			fmt.Sprintf("GenMeet server did not respond on %s.\n\nCheck logs\\server.log or run GenMeet-Repair.exe.", url),
			winui.MBOK|winui.MBIconWarning,
		)
		return
	}

	_ = winui.OpenURL(url)
}
