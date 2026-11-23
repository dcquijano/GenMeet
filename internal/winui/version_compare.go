//go:build windows

package winui

import (
	"net/url"
	"strconv"
	"strings"
)

// CompareSemver returns 1 if a > b, -1 if a < b, 0 if equal.
func CompareSemver(a, b string) int {
	pa := parseVersionParts(a)
	pb := parseVersionParts(b)
	maxLen := len(pa)
	if len(pb) > maxLen {
		maxLen = len(pb)
	}
	for i := 0; i < maxLen; i++ {
		va, vb := 0, 0
		if i < len(pa) {
			va = pa[i]
		}
		if i < len(pb) {
			vb = pb[i]
		}
		if va > vb {
			return 1
		}
		if va < vb {
			return -1
		}
	}
	return 0
}

func parseVersionParts(v string) []int {
	v = strings.TrimSpace(strings.TrimPrefix(strings.ToLower(v), "v"))
	if idx := strings.IndexAny(v, "-+"); idx != -1 {
		v = v[:idx]
	}
	if v == "" {
		return nil
	}
	segs := strings.Split(v, ".")
	out := make([]int, 0, len(segs))
	for _, s := range segs {
		n, err := strconv.Atoi(strings.TrimSpace(s))
		if err != nil {
			n = 0
		}
		out = append(out, n)
	}
	return out
}

// IsNewerRelease returns true when remote version > local version, or versions match and remote build > local build.
func IsNewerRelease(localVer, localBuild, remoteVer, remoteBuild string) bool {
	cmp := CompareSemver(remoteVer, localVer)
	if cmp > 0 {
		return true
	}
	if cmp < 0 {
		return false
	}
	lb := strings.TrimSpace(localBuild)
	rb := strings.TrimSpace(remoteBuild)
	return rb != "" && lb != "" && rb > lb
}

// IsAllowedUpdateURL validates that a download URL points over HTTPS to a trusted GitHub host.
func IsAllowedUpdateURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	switch host {
	case "github.com",
		"api.github.com",
		"raw.githubusercontent.com",
		"objects.githubusercontent.com",
		"release-assets.githubusercontent.com":
		return true
	default:
		return false
	}
}
