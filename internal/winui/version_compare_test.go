//go:build windows

package winui

import "testing"

func TestCompareSemverAndIsNewerRelease(t *testing.T) {
	if CompareSemver("0.1.2", "0.1.1") != 1 {
		t.Fatalf("expected 0.1.2 > 0.1.1")
	}
	if CompareSemver("v0.1.1", "0.1.1") != 0 {
		t.Fatalf("expected v0.1.1 == 0.1.1")
	}
	if CompareSemver("0.1.0", "0.2.0") != -1 {
		t.Fatalf("expected 0.1.0 < 0.2.0")
	}

	if !IsNewerRelease("0.1.1", "202611231000", "0.1.2", "202611230900") {
		t.Fatalf("expected higher semver to be newer")
	}
	if !IsNewerRelease("0.1.2", "202611231000", "0.1.2", "202611231100") {
		t.Fatalf("expected newer build on same version to be newer")
	}
	if IsNewerRelease("0.1.2", "202611231100", "0.1.2", "202611231100") {
		t.Fatalf("expected identical version and build not to be newer")
	}
}

func TestIsAllowedUpdateURL(t *testing.T) {
	valid := []string{
		"https://github.com/dcquijano/GenMeet/releases/download/v0.1.2/GenMeet-Setup-0.1.2.exe",
		"https://raw.githubusercontent.com/dcquijano/GenMeet/main/installer/GenMeet-Setup-0.1.2.exe",
		"https://objects.githubusercontent.com/github-production-release-asset/foo",
	}
	for _, u := range valid {
		if !IsAllowedUpdateURL(u) {
			t.Fatalf("expected allowed URL: %s", u)
		}
	}

	invalid := []string{
		"http://github.com/dcquijano/GenMeet/releases",
		"https://evil.example.com/GenMeet-Setup.exe",
		"file:///C:/Windows/System32/calc.exe",
		"",
	}
	for _, u := range invalid {
		if IsAllowedUpdateURL(u) {
			t.Fatalf("expected rejected URL: %s", u)
		}
	}
}
