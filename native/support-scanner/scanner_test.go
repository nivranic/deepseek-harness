package supportscanner

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/spf13/viper"
)

func TestMain(m *testing.M) {
	// Poison the global parser before the library first compiles its private rules.
	viper.Set("rules", []string{})
	_ = os.Setenv("GITLEAKS_CONFIG_TOML", "[allowlist]\nregexes = ['.*']\n")
	os.Exit(m.Run())
}

func operation(t *testing.T, data []byte) *Operation {
	t.Helper()
	op, err := NewOperation(data, 1024*1024, 10000)
	if err != nil {
		t.Fatal(err)
	}
	return op
}

func syntheticToken(t *testing.T) string {
	t.Helper()
	data := make([]byte, 18)
	if _, err := rand.Read(data); err != nil {
		t.Fatal("cannot create synthetic canary")
	}
	return "ghp_" + hex.EncodeToString(data)
}

func TestApprovedBytesAreTheOriginalImmutableDocument(t *testing.T) {
	original := []byte("{\"platform\":\"android\",\"complete\":false}\n")
	input := bytes.Clone(original)
	op := operation(t, input)
	input[0] = 'X'
	result := op.Run()
	if result.Status() != "approved" || !bytes.Equal(result.Data(), original) {
		t.Fatalf("document was not admitted unchanged: %s", result.Status())
	}
	digest := sha256.Sum256(original)
	if result.Digest() != hex.EncodeToString(digest[:]) || result.Bytes() != int64(len(original)) {
		t.Fatal("approved byte identity differs")
	}
	copy := result.Data()
	copy[0] = 'Y'
	if !bytes.Equal(result.Data(), original) {
		t.Fatal("foreign code mutated the approved document")
	}
	if op.Run().Status() != "already-run" {
		t.Fatal("a second scan was admitted")
	}
	op.Cancel()
	if !bytes.Equal(result.Data(), original) {
		t.Fatal("post-completion cancellation changed a committed result")
	}
}

func TestDefaultRulesRefuseSecretsDespiteAmbientAndInlineAllowing(t *testing.T) {
	token := syntheticToken(t)
	for name, input := range map[string]string{
		"plain":      "GITHUB_TOKEN=" + token,
		"inline":     "GITHUB_TOKEN=" + token + " # gitleaks:allow\n",
		"json":       "{\"detail\":\"" + token + "\"}\n",
		"late-bytes": strings.Repeat("x", 128*1024) + "\nGITHUB_TOKEN=" + token,
		"after-null": "safe\x00GITHUB_TOKEN=" + token,
	} {
		t.Run(name, func(t *testing.T) {
			result := operation(t, []byte(input)).Run()
			if result.Status() != "secrets-detected" || result.Data() != nil || result.Digest() != "" || result.Bytes() != 0 {
				t.Fatalf("secret document was not refused without bytes: %s", result.Status())
			}
		})
	}
}

func TestInvalidPolicyAndOversizedInputStartNoScan(t *testing.T) {
	for _, row := range []struct{ size, milliseconds int64 }{{0, 1}, {16777217, 1}, {1, 0}, {1, 60001}} {
		if op, err := NewOperation([]byte("x"), row.size, row.milliseconds); op != nil || err == nil || err.Error() != "invalid-policy" {
			t.Fatal("invalid deployment limits were admitted")
		}
	}
	for _, input := range [][]byte{nil, []byte("xx")} {
		if op, err := NewOperation(input, 1, 1000); op != nil || err == nil || err.Error() != "oversized" {
			t.Fatal("document outside its byte limit was admitted")
		}
	}
}

func TestCancellationBeforeRunStartsNoScanner(t *testing.T) {
	op := operation(t, []byte("{}"))
	op.Cancel()
	op.Cancel()
	called := false
	result := op.execute(func(context.Context, []byte) *Result {
		called = true
		return &Result{status: "approved", data: []byte("{}")}
	})
	if called || result.Status() != "cancelled" || result.Data() != nil {
		t.Fatal("cancelled admission started a scan")
	}
}

func TestCancellationJoinsScannerAndRejectsItsLateCleanResult(t *testing.T) {
	op := operation(t, []byte("{}"))
	entered, cancelled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	releaseScanner := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(func() { releaseScanner(); op.Cancel() })
	result := make(chan *Result, 1)
	go func() {
		result <- op.execute(func(ctx context.Context, data []byte) *Result {
			close(entered)
			<-ctx.Done()
			close(cancelled)
			<-release
			return &Result{status: "approved", data: data}
		})
	}()
	<-entered
	if op.Run().Status() != "already-run" {
		t.Fatal("concurrent scan was admitted")
	}
	joined := make(chan struct{})
	go func() { op.Cancel(); close(joined) }()
	<-cancelled
	select {
	case <-joined:
		t.Fatal("Cancel returned before its scanner exited")
	default:
	}
	releaseScanner()
	select {
	case <-joined:
	case <-time.After(time.Second):
		t.Fatal("Cancel did not join completion")
	}
	got := <-result
	if got.Status() != "cancelled" || got.Data() != nil {
		t.Fatal("partial scan admitted bytes after cancellation")
	}
}

func TestDeadlineRefusesACompleteLookingPartialScan(t *testing.T) {
	op, err := NewOperation([]byte("{}"), 10, 1)
	if err != nil {
		t.Fatal(err)
	}
	result := op.execute(func(ctx context.Context, data []byte) *Result {
		<-ctx.Done()
		return &Result{status: "approved", data: data}
	})
	if result.Status() != "timed-out" || result.Data() != nil {
		t.Fatal("expired scan admitted bytes")
	}
}

func TestScannerPanicRefusesBytesAndStillCompletesCancellation(t *testing.T) {
	op := operation(t, []byte("{}"))
	result := op.execute(func(context.Context, []byte) *Result { panic("private scanner diagnostic") })
	if result.Status() != "scan-failed" || result.Data() != nil {
		t.Fatal("scanner failure was not contained")
	}
	op.Cancel()
}

func TestConcurrentRealScansKeepTheirOwnVerdicts(t *testing.T) {
	const count = 8
	var done sync.WaitGroup
	verdicts := make(chan bool, count)
	for i := 0; i < count; i++ {
		data, want := []byte("{\"runtime\":\"ready\"}\n"), "approved"
		if i%2 != 0 {
			data, want = []byte("GITHUB_TOKEN="+syntheticToken(t)), "secrets-detected"
		}
		op := operation(t, data)
		done.Add(1)
		go func() { defer done.Done(); verdicts <- op.Run().Status() == want }()
	}
	done.Wait()
	close(verdicts)
	for matched := range verdicts {
		if !matched {
			t.Fatal("a concurrent scan returned another admission outcome")
		}
	}
}
