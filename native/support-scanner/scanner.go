// Package supportscanner admits immutable support documents with the pinned
// Gitleaks default rules. It owns the scanner logger in an isolated mobile Go
// library; callers must run scans and cancellation joins away from the UI thread.
package supportscanner

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/spf13/viper"
	"github.com/zricethezav/gitleaks/v8/config"
	"github.com/zricethezav/gitleaks/v8/detect"
	"github.com/zricethezav/gitleaks/v8/logging"
	scannerversion "github.com/zricethezav/gitleaks/v8/version"
)

// Version identifies the maintained scanner module and its embedded default rules.
const Version = "8.30.1"

var (
	rulesOnce sync.Once
	rules     config.Config
	rulesErr  error
)

func init() {
	// Gitleaks trace events can contain a finding before report redaction.
	logging.Logger = zerolog.Nop()
	scannerversion.Version = Version
}

func defaultRules() (config.Config, error) {
	rulesOnce.Do(func() {
		parser := viper.New()
		parser.SetConfigType("toml")
		if rulesErr = parser.ReadConfig(strings.NewReader(config.DefaultConfig)); rulesErr != nil {
			return
		}
		var value config.ViperConfig
		if rulesErr = parser.Unmarshal(&value); rulesErr != nil {
			return
		}
		rules, rulesErr = value.Translate()
	})
	return rules, rulesErr
}

// RulesDigest returns the SHA-256 of the exact upstream default-rule text compiled into the library.
func RulesDigest() string {
	digest := sha256.Sum256([]byte(config.DefaultConfig))
	return hex.EncodeToString(digest[:])
}

// Result contains approved bytes or a fixed refusal. It never exposes findings,
// matched text, scanner logs, filesystem paths, or underlying error messages.
type Result struct {
	status string
	data   []byte
}

// Status returns approved, cancelled, timed-out, invalid-scanner, scan-failed,
// secrets-detected, or already-run. Only approved results contain bytes.
func (r *Result) Status() string { return r.status }

// Data returns a copy of exactly the approved bytes, or nil after a refusal.
func (r *Result) Data() []byte { return bytes.Clone(r.data) }

// Bytes returns the number of approved bytes, or zero after a refusal.
func (r *Result) Bytes() int64 { return int64(len(r.data)) }

// Digest returns the SHA-256 of the approved bytes, or an empty string after a refusal.
func (r *Result) Digest() string {
	if r.status != "approved" {
		return ""
	}
	digest := sha256.Sum256(r.data)
	return hex.EncodeToString(digest[:])
}

// Operation owns a copy of one document and permits one synchronous Run call.
// Cancel joins an active call; a result committed before cancellation remains
// immutable. The native exporter separately owns cancellation before delivery.
type Operation struct {
	mu        sync.Mutex
	data      []byte
	timeout   time.Duration
	started   bool
	cancelled bool
	cancel    context.CancelFunc
	done      chan struct{}
}

// NewOperation copies a nonempty document within the caller's byte limit. Limits
// must be 1..16777216 bytes and 1..60000 milliseconds. It returns only the fixed
// errors invalid-policy or oversized; no scan or background work starts here.
func NewOperation(document []byte, maximumBytes, scanMilliseconds int64) (*Operation, error) {
	if maximumBytes < 1 || maximumBytes > 16*1024*1024 || scanMilliseconds < 1 || scanMilliseconds > 60000 {
		return nil, errors.New("invalid-policy")
	}
	if len(document) == 0 || int64(len(document)) > maximumBytes {
		return nil, errors.New("oversized")
	}
	return &Operation{data: bytes.Clone(document), timeout: time.Duration(scanMilliseconds) * time.Millisecond, done: make(chan struct{})}, nil
}

// Cancel revokes a pending operation and waits for an active Run call to finish.
// It does not start an unstarted scan, and repeated calls remain safe.
func (o *Operation) Cancel() {
	o.mu.Lock()
	o.cancelled = true
	if o.cancel != nil {
		o.cancel()
	}
	started := o.started
	o.mu.Unlock()
	if started {
		<-o.done
	}
}

// Run checks a real canary and then the whole immutable document without disk or
// network access. Timeout and cancellation are checked after scanner completion,
// so Gitleaks' partial findings cannot admit bytes from an interrupted scan.
func (o *Operation) Run() *Result { return o.execute(scanDocument) }

func (o *Operation) execute(scan func(context.Context, []byte) *Result) *Result {
	o.mu.Lock()
	if o.started {
		o.mu.Unlock()
		return &Result{status: "already-run"}
	}
	o.started = true
	ctx, cancel := context.WithTimeout(context.Background(), o.timeout)
	o.cancel = cancel
	if o.cancelled {
		cancel()
	}
	o.mu.Unlock()

	result := guardedScan(ctx, o.data, scan)
	o.mu.Lock()
	if err := ctx.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			result = &Result{status: "timed-out"}
		} else {
			result = &Result{status: "cancelled"}
		}
	}
	o.data = nil
	cancel()
	close(o.done)
	o.mu.Unlock()
	return result
}

func guardedScan(ctx context.Context, data []byte, scan func(context.Context, []byte) *Result) (result *Result) {
	result = &Result{status: "scan-failed"}
	defer func() {
		if recover() != nil {
			result = &Result{status: "scan-failed"}
		}
	}()
	if ctx.Err() != nil {
		return result
	}
	return scan(ctx, data)
}

func scanDocument(ctx context.Context, data []byte) *Result {
	cfg, err := defaultRules()
	if err != nil || len(cfg.Rules) == 0 {
		return &Result{status: "invalid-scanner"}
	}
	canary := make([]byte, 18)
	if _, err := rand.Read(canary); err != nil {
		return &Result{status: "invalid-scanner"}
	}
	token := "ghp_" + hex.EncodeToString(canary)
	newDetector := func() *detect.Detector {
		detector := detect.NewDetectorContext(ctx, cfg)
		detector.IgnoreGitleaksAllow = true
		detector.Redact = 100
		return detector
	}
	proof := newDetector().DetectContext(ctx, detect.Fragment{Raw: "GITHUB_TOKEN=" + token + " # gitleaks:allow\n"})
	matched := false
	for _, finding := range proof {
		if finding.RuleID == "github-pat" {
			matched = true
		}
		if strings.Contains(finding.Secret, token) || strings.Contains(finding.Match, token) || strings.Contains(finding.Line, token) {
			return &Result{status: "invalid-scanner"}
		}
	}
	if ctx.Err() != nil || !matched {
		return &Result{status: "invalid-scanner"}
	}
	if findings := newDetector().DetectContext(ctx, detect.Fragment{Raw: string(data)}); len(findings) != 0 {
		return &Result{status: "secrets-detected"}
	}
	return &Result{status: "approved", data: data}
}
