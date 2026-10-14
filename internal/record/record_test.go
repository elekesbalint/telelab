package record

import (
	"bytes"
	"io"
	"path/filepath"
	"testing"
	"time"
)

func TestRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.tlrec")
	w, err := Create(path)
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.Unix(1700000000, 123)
	payloads := [][]byte{[]byte("hello"), bytes.Repeat([]byte{7}, 1448), {}}
	for i, p := range payloads {
		if err := w.Write(t0.Add(time.Duration(i)*time.Millisecond), p); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	for i, want := range payloads {
		ts, got, err := r.Next()
		if err != nil {
			t.Fatalf("record %d: %v", i, err)
		}
		if !bytes.Equal(got, want) || !ts.Equal(t0.Add(time.Duration(i)*time.Millisecond)) {
			t.Fatalf("record %d mismatch", i)
		}
	}
	if _, _, err := r.Next(); err != io.EOF {
		t.Fatalf("want EOF, got %v", err)
	}
}
