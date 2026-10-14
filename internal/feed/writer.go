package feed

import (
	"context"
	"log"
	"sync/atomic"
	"time"

	"github.com/elekesbalint/telelab/internal/store"
)

type sessionKey struct {
	uid  string
	port int
}

type job struct {
	key     sessionKey
	meta    *store.SessionMeta
	laps    []store.Lap
	samples []store.Sample
	setup   []byte
	field   []byte
	class   []byte
}

// Writer is the single background goroutine that talks to the database.
// Feeds hand it work through a buffered channel and never block on it.
type Writer struct {
	st      *store.Store
	ch      chan job
	ids     map[sessionKey]int64
	dropped atomic.Uint64
}

// NewWriter creates a writer; call Run in a goroutine.
func NewWriter(st *store.Store) *Writer {
	return &Writer{st: st, ch: make(chan job, 4096), ids: map[sessionKey]int64{}}
}

func (w *Writer) enqueue(j job) {
	if w == nil {
		return
	}
	select {
	case w.ch <- j:
	default:
		if n := w.dropped.Add(1); n == 1 || n%1000 == 0 {
			log.Printf("writer: queue full, dropped %d jobs so far", n)
		}
	}
}

// Run processes jobs until ctx is cancelled, then drains what is queued.
func (w *Writer) Run(ctx context.Context) {
	for {
		select {
		case j := <-w.ch:
			w.process(j)
		case <-ctx.Done():
			for {
				select {
				case j := <-w.ch:
					w.process(j)
				default:
					return
				}
			}
		}
	}
}

func (w *Writer) process(j job) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	id, known := w.ids[j.key]
	if j.meta != nil || !known {
		meta := store.SessionMeta{SessionUID: j.key.uid, Port: j.key.port}
		if j.meta != nil {
			meta = *j.meta
		}
		var err error
		if id, err = w.st.UpsertSession(ctx, meta); err != nil {
			log.Printf("writer: session %s/%d: %v", j.key.uid, j.key.port, err)
			return
		}
		w.ids[j.key] = id
	}
	if len(j.laps) > 0 {
		if err := w.st.UpsertLaps(ctx, id, j.laps); err != nil {
			log.Printf("writer: laps: %v", err)
		}
	}
	if len(j.samples) > 0 {
		if err := w.st.InsertSamples(ctx, id, j.samples); err != nil {
			log.Printf("writer: samples: %v", err)
		}
	}
	if len(j.setup) > 0 {
		if err := w.st.SaveSetup(ctx, id, j.setup); err != nil {
			log.Printf("writer: setup: %v", err)
		}
	}
	if len(j.field) > 0 {
		if err := w.st.SaveField(ctx, id, j.field); err != nil {
			log.Printf("writer: field: %v", err)
		}
	}
	if len(j.class) > 0 {
		if err := w.st.SaveClassification(ctx, id, j.class); err != nil {
			log.Printf("writer: classification: %v", err)
		}
	}
}
