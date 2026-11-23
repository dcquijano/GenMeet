//go:build windows

package winui

import (
	"path/filepath"
	"regexp"
	"testing"
)

func TestNewVirtualIPAndInstanceConfig(t *testing.T) {
	ip := NewVirtualIP()
	if !regexp.MustCompile(`^100\.64\.\d{1,3}\.\d{1,3}$`).MatchString(ip) {
		t.Fatalf("unexpected virtual IP format: %s", ip)
	}

	dir := t.TempDir()
	first, err := LoadOrCreateInstanceConfig(dir, false)
	if err != nil {
		t.Fatalf("LoadOrCreateInstanceConfig failed: %v", err)
	}
	if !FileExists(filepath.Join(dir, "genmeet.instance.json")) {
		t.Fatalf("expected genmeet.instance.json to be written")
	}

	second, err := LoadOrCreateInstanceConfig(dir, false)
	if err != nil {
		t.Fatalf("reload failed: %v", err)
	}
	if first.InstanceID != second.InstanceID || first.VirtualIP != second.VirtualIP {
		t.Fatalf("expected persisted config, got %+v vs %+v", first, second)
	}

	reset, err := LoadOrCreateInstanceConfig(dir, true)
	if err != nil {
		t.Fatalf("reset failed: %v", err)
	}
	if reset.InstanceID == first.InstanceID {
		t.Fatalf("expected reset to generate a new InstanceID")
	}
}
