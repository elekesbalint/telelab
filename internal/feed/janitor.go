package feed

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// CleanRecordings deletes .tlrec files older than maxAge from dir once an
// hour, so raw recordings do not fill the VPS disk. They are meant to be
// archived elsewhere (e.g. a NAS) before that.
func CleanRecordings(ctx context.Context, dir string, maxAge time.Duration) {
	if dir == "" || maxAge <= 0 {
		return
	}
	clean := func() {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".tlrec") {
				continue
			}
			info, err := e.Info()
			if err != nil || time.Since(info.ModTime()) < maxAge {
				continue
			}
			if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
				log.Printf("janitor: %v", err)
			} else {
				log.Printf("janitor: removed old recording %s", e.Name())
			}
		}
	}
	clean()
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			clean()
		}
	}
}
