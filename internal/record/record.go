// Package record stores raw UDP datagrams in a compact, gzip-compressed file
// so sessions can be replayed later (for development, debugging and
// re-processing with newer decoder versions).
//
// File layout (inside gzip): magic "TLREC1\n", then repeated records of
// int64 receive time (unix nanoseconds, little endian), uint16 length, payload.
package record

import (
	"bufio"
	"compress/gzip"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

const magic = "TLREC1\n"

// Writer appends datagrams to a recording file. It is safe for concurrent use.
type Writer struct {
	mu   sync.Mutex
	f    *os.File
	gz   *gzip.Writer
	bw   *bufio.Writer
	last time.Time
}

// Create opens a new recording file.
func Create(path string) (*Writer, error) {
	f, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	gz, _ := gzip.NewWriterLevel(f, gzip.BestSpeed)
	w := &Writer{f: f, gz: gz, bw: bufio.NewWriterSize(gz, 64<<10), last: time.Now()}
	if _, err := w.bw.WriteString(magic); err != nil {
		f.Close()
		return nil, err
	}
	return w, nil
}

// Write stores one datagram received at t.
func (w *Writer) Write(t time.Time, b []byte) error {
	if len(b) > 0xFFFF {
		return fmt.Errorf("record: datagram too large: %d", len(b))
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	var hdr [10]byte
	binary.LittleEndian.PutUint64(hdr[0:], uint64(t.UnixNano()))
	binary.LittleEndian.PutUint16(hdr[8:], uint16(len(b)))
	if _, err := w.bw.Write(hdr[:]); err != nil {
		return err
	}
	if _, err := w.bw.Write(b); err != nil {
		return err
	}
	// Flush every few seconds so a crash loses at most a few seconds of data.
	if time.Since(w.last) > 5*time.Second {
		w.last = time.Now()
		if err := w.bw.Flush(); err != nil {
			return err
		}
		return w.gz.Flush()
	}
	return nil
}

// Close flushes and closes the file.
func (w *Writer) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return errors.Join(w.bw.Flush(), w.gz.Close(), w.f.Close())
}

// Reader reads datagrams back from a recording.
type Reader struct {
	f  *os.File
	gz *gzip.Reader
	br *bufio.Reader
}

// Open opens a recording for reading.
func Open(path string) (*Reader, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	gz, err := gzip.NewReader(f)
	if err != nil {
		f.Close()
		return nil, err
	}
	br := bufio.NewReaderSize(gz, 64<<10)
	m := make([]byte, len(magic))
	if _, err := io.ReadFull(br, m); err != nil || string(m) != magic {
		f.Close()
		return nil, fmt.Errorf("record: %s is not a TeleLab recording", path)
	}
	return &Reader{f: f, gz: gz, br: br}, nil
}

// Next returns the next datagram, or io.EOF at the end. A recording cut off
// by a crash ends with io.ErrUnexpectedEOF, which callers can treat as EOF.
func (r *Reader) Next() (time.Time, []byte, error) {
	var hdr [10]byte
	if _, err := io.ReadFull(r.br, hdr[:]); err != nil {
		return time.Time{}, nil, err
	}
	t := time.Unix(0, int64(binary.LittleEndian.Uint64(hdr[0:])))
	b := make([]byte, binary.LittleEndian.Uint16(hdr[8:]))
	if _, err := io.ReadFull(r.br, b); err != nil {
		return t, nil, err
	}
	return t, b, nil
}

// Close closes the recording.
func (r *Reader) Close() error { return errors.Join(r.gz.Close(), r.f.Close()) }
