//go:build windows

package winui

import (
	"crypto/rand"
	_ "embed"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed appicon.png
var DefaultIconPNG []byte

const (
	AppShortName      = "GenMeet"
	AppFullTitle      = "GenMeet (v0.1.4)"
	AppVersion        = "0.1.4"
	AppAuthor         = "Darius Cumpio"
	DefaultInstallDir = `C:\GenMeet`
	UninstallRegKey   = `Software\Microsoft\Windows\CurrentVersion\Uninstall\GenMeet`
	RunRegKey         = `Software\Microsoft\Windows\CurrentVersion\Run`
	ChromeExePath     = `C:\Program Files\Google\Chrome\Application\chrome.exe`

	MBOK          = 0x00000000
	MBYesNo       = 0x00000004
	MBYesNoCancel = 0x00000003

	MBIconError    = 0x00000010
	MBIconQuestion = 0x00000020
	MBIconWarning  = 0x00000030
	MBIconInfo     = 0x00000040

	IDOK     = 1
	IDCANCEL = 2
	IDYES    = 6
	IDNO     = 7

	ErrorAlreadyExists = 183
	MaxPath            = 260
	MaxLongPath        = 32768
)

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	user32                   = syscall.NewLazyDLL("user32.dll")
	shell32                  = syscall.NewLazyDLL("shell32.dll")
	ole32                    = syscall.NewLazyDLL("ole32.dll")
	procCreateMutexW         = kernel32.NewProc("CreateMutexW")
	procCloseHandle          = kernel32.NewProc("CloseHandle")
	procCreateToolhelp32Snap = kernel32.NewProc("CreateToolhelp32Snapshot")
	procProcess32FirstW      = kernel32.NewProc("Process32FirstW")
	procProcess32NextW       = kernel32.NewProc("Process32NextW")
	procOpenProcess          = kernel32.NewProc("OpenProcess")
	procQueryFullProcNameW   = kernel32.NewProc("QueryFullProcessImageNameW")
	procTerminateProcess     = kernel32.NewProc("TerminateProcess")
	procMessageBoxW          = user32.NewProc("MessageBoxW")
	procSHBrowseForFolderW   = shell32.NewProc("SHBrowseForFolderW")
	procSHGetPathFromIDListW = shell32.NewProc("SHGetPathFromIDListW")
	procOleInitialize        = ole32.NewProc("OleInitialize")
	procCoTaskMemFree        = ole32.NewProc("CoTaskMemFree")
)

type browseInfoW struct {
	hwndOwner      syscall.Handle
	pidlRoot       uintptr
	pszDisplayName *uint16
	lpszTitle      *uint16
	ulFlags        uint32
	lpfn           uintptr
	lParam         uintptr
	iImage         int32
}

type processEntry32W struct {
	dwSize              uint32
	cntUsage            uint32
	th32ProcessID       uint32
	th32DefaultHeapID   uintptr
	th32ModuleID        uint32
	cntThreads          uint32
	th32ParentProcessID uint32
	pcPriClassBase      int32
	dwFlags             uint32
	szExeFile           [MaxPath]uint16
}

type InstanceConfig struct {
	InstanceID string `json:"instanceId"`
	VirtualIP  string `json:"virtualIp"`
	Port       int    `json:"port"`
	CreatedAt  string `json:"createdAt"`
}

func U16(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func CreateMutex(name string) (syscall.Handle, bool) {
	h, _, err := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(U16(name))))
	already := err == syscall.Errno(ErrorAlreadyExists)
	return syscall.Handle(h), already
}

func CloseHandle(h syscall.Handle) {
	if h != 0 {
		_, _, _ = procCloseHandle.Call(uintptr(h))
	}
}

func MessageBox(title, text string, flags uint32) int {
	ret, _, _ := procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(U16(text))),
		uintptr(unsafe.Pointer(U16(title))),
		uintptr(flags),
	)
	return int(ret)
}

func BrowseForFolder(title string) string {
	_, _, _ = procOleInitialize.Call(0)
	displayBuf := make([]uint16, MaxPath)
	bi := browseInfoW{
		pszDisplayName: &displayBuf[0],
		lpszTitle:      U16(title),
		ulFlags:        0x00000001 | 0x00000040,
	}
	pidl, _, _ := procSHBrowseForFolderW.Call(uintptr(unsafe.Pointer(&bi)))
	if pidl == 0 {
		return ""
	}
	defer procCoTaskMemFree.Call(pidl)
	pathBuf := make([]uint16, MaxPath)
	ok, _, _ := procSHGetPathFromIDListW.Call(pidl, uintptr(unsafe.Pointer(&pathBuf[0])))
	if ok == 0 {
		return ""
	}
	return syscall.UTF16ToString(pathBuf)
}

func OpenURL(url string) error {
	if st, err := os.Stat(ChromeExePath); err == nil && !st.IsDir() {
		cmd := exec.Command(ChromeExePath, url)
		return cmd.Start()
	}
	cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

func KillProcessesInDir(root string, selfPID uint32) {
	prefix := strings.ToLower(filepath.Clean(root)) + string(filepath.Separator)
	snap, _, _ := procCreateToolhelp32Snap.Call(0x00000002, 0)
	if snap == uintptr(syscall.InvalidHandle) || snap == 0 {
		return
	}
	defer procCloseHandle.Call(snap)

	var pe processEntry32W
	pe.dwSize = uint32(unsafe.Sizeof(pe))
	ok, _, _ := procProcess32FirstW.Call(snap, uintptr(unsafe.Pointer(&pe)))
	for ok != 0 {
		pid := pe.th32ProcessID
		if pid != 0 && pid != selfPID {
			if p := imagePath(pid); p != "" {
				if strings.HasPrefix(strings.ToLower(filepath.Clean(p)), prefix) {
					h, _, _ := procOpenProcess.Call(0x0001, 0, uintptr(pid))
					if h != 0 {
						_, _, _ = procTerminateProcess.Call(h, 0)
						_, _, _ = procCloseHandle.Call(h)
					}
				}
			}
		}
		ok, _, _ = procProcess32NextW.Call(snap, uintptr(unsafe.Pointer(&pe)))
	}
}

func imagePath(pid uint32) string {
	h, _, _ := procOpenProcess.Call(0x1000, 0, uintptr(pid))
	if h == 0 {
		return ""
	}
	defer procCloseHandle.Call(h)
	buf := make([]uint16, MaxLongPath)
	n := uint32(len(buf))
	ok, _, _ := procQueryFullProcNameW.Call(h, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n)))
	if ok == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:n])
}

func CreateShortcut(linkPath, targetPath, args, workDir, iconPath, desc string) error {
	ps := fmt.Sprintf(
		"$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%s'); $sc.TargetPath = '%s'; $sc.Arguments = '%s'; $sc.WorkingDirectory = '%s'; $sc.IconLocation = '%s'; $sc.Description = '%s'; $sc.Save()",
		escapePS(linkPath),
		escapePS(targetPath),
		escapePS(args),
		escapePS(workDir),
		escapePS(iconPath),
		escapePS(desc),
	)
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

func WriteHKCUValue(subkey, name, valType, value string) error {
	args := []string{"ADD", `HKCU\` + subkey}
	if name == "" {
		args = append(args, "/ve")
	} else {
		args = append(args, "/v", name)
	}
	args = append(args, "/t", valType, "/d", value, "/f")
	cmd := exec.Command("reg.exe", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

func ReadHKCUString(subkey, name string) string {
	cmd := exec.Command("reg.exe", "QUERY", `HKCU\`+subkey, "/v", name)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, name) && strings.Contains(line, "REG_SZ") {
			parts := strings.SplitN(line, "REG_SZ", 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1])
			}
		}
	}
	return ""
}

func DeleteHKCUKey(subkey string) {
	cmd := exec.Command("reg.exe", "DELETE", `HKCU\`+subkey, "/f")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Run()
}

func DeleteHKCUValue(subkey, name string) {
	cmd := exec.Command("reg.exe", "DELETE", `HKCU\`+subkey, "/v", name, "/f")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Run()
}

func escapePS(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

func FileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func DirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func DetectExistingInstallation(fallbackDir string) string {
	if loc := ReadHKCUString(UninstallRegKey, "InstallLocation"); loc != "" {
		if FileExists(filepath.Join(loc, "server.ts")) {
			return loc
		}
	}
	if FileExists(filepath.Join(fallbackDir, "server.ts")) &&
		FileExists(filepath.Join(fallbackDir, "GenMeet-Launcher.exe")) {
		return fallbackDir
	}
	return ""
}

func IsPortAvailable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func FindAvailablePort(start int) int {
	for p := start; p < start+50; p++ {
		if IsPortAvailable(p) {
			return p
		}
	}
	return start
}

func NewUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func NewVirtualIP() string {
	n3, _ := rand.Int(rand.Reader, big.NewInt(254))
	n4, _ := rand.Int(rand.Reader, big.NewInt(252))
	return fmt.Sprintf("100.64.%d.%d", n3.Int64()+1, n4.Int64()+2)
}

func LoadOrCreateInstanceConfig(root string, reset bool) (InstanceConfig, error) {
	cfgPath := filepath.Join(root, "genmeet.instance.json")
	if !reset && FileExists(cfgPath) {
		raw, err := os.ReadFile(cfgPath)
		if err == nil {
			var cfg InstanceConfig
			if json.Unmarshal(raw, &cfg) == nil && cfg.InstanceID != "" && cfg.VirtualIP != "" && cfg.Port >= 1024 {
				return cfg, nil
			}
		}
	}
	cfg := InstanceConfig{
		InstanceID: NewUUID(),
		VirtualIP:  NewVirtualIP(),
		Port:       FindAvailablePort(3000),
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(cfgPath, append(data, '\n'), 0o644); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func DetectLanIPs() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			if ipNet, ok := a.(*net.IPNet); ok {
				if v4 := ipNet.IP.To4(); v4 != nil && !v4.IsLoopback() {
					ips = append(ips, v4.String())
				}
			}
		}
	}
	return ips
}
