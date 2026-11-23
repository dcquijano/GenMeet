//go:build windows && embedzip

package main

import _ "embed"

//go:embed payload.zip
var embeddedPayloadZip []byte
