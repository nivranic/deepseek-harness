/* Parent-pipe lifetime guard for the Mac Host's fixed dsh web and support scanner invocations.
 * This owns the runtime's POSIX group, not detached tool groups or sessions.
 */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;
static volatile sig_atomic_t interrupted = 0;

static void request_stop(int signal_number) {
    (void)signal_number;
    interrupted = 1;
}

static long long milliseconds(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return -1;
    return (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static bool group_exists(pid_t child) {
    return kill(-child, 0) == 0 || errno != ESRCH;
}

static int outcome(int status) {
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return 70;
}

static bool duration(const char *value, long maximum, long *result) {
    char *end = NULL;
    errno = 0;
    long parsed = strtol(value, &end, 10);
    if (errno != 0 || *value == '\0' || *end != '\0' || parsed < 1 || parsed > maximum) return false;
    *result = parsed;
    return true;
}

static bool scanner_path(char *output, size_t capacity, const char *prefix, const char *root, const char *name) {
    int length = snprintf(output, capacity, "%s%s/%s", prefix, root, name);
    return length >= 0 && (size_t)length < capacity;
}

int main(int argc, char **argv) {
    struct stat input;
    const char *home = getenv("DSH_HOME");
    bool scan = argc > 1 && strcmp(argv[1], "--support-scan") == 0;
    if ((scan ? argc != 7 : argc != 3)
        || fstat(STDIN_FILENO, &input) != 0 || !S_ISFIFO(input.st_mode)) {
        fputs("host-supervisor: requires a supported invocation and a parent pipe\n", stderr);
        return 64;
    }
    const char *executable = scan ? argv[2] : argv[1];
    if (executable[0] != '/' || (!scan && (home == NULL || home[0] != '/'))
        || (scan && (argv[3][0] != '/' || (strcmp(argv[4], "canary") != 0 && strcmp(argv[4], "export") != 0)))) {
        fputs("host-supervisor: invalid invocation fields\n", stderr);
        return 64;
    }
    long grace;
    if (!duration(scan ? argv[6] : argv[2], 60000, &grace)) {
        fputs("host-supervisor: invalid shutdown grace\n", stderr);
        return 64;
    }
    char source[PATH_MAX], config[PATH_MAX], ignore[PATH_MAX], report[PATH_MAX], timeout[32];
    if (scan) {
        long seconds;
        if (!duration(argv[5], 60, &seconds)
            || !scanner_path(source, sizeof(source), "", argv[3], argv[4])
            || !scanner_path(config, sizeof(config), "--config=", argv[3], "default-rules.toml")
            || !scanner_path(ignore, sizeof(ignore), "--gitleaks-ignore-path=", argv[3], "no-ignore")
            || !scanner_path(report, sizeof(report), "--report-path=", argv[3],
                             strcmp(argv[4], "canary") == 0 ? "canary-report.json" : "export-report.json")) {
            fputs("host-supervisor: invalid scanner fields\n", stderr);
            return 64;
        }
        snprintf(timeout, sizeof(timeout), "--timeout=%ld", seconds);
    }
    struct sigaction action = {0};
    action.sa_handler = request_stop;
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGTERM, &action, NULL) != 0 || sigaction(SIGINT, &action, NULL) != 0) return 70;
    action.sa_handler = SIG_IGN;
    if (sigaction(SIGPIPE, &action, NULL) != 0) return 70;
    action.sa_handler = SIG_DFL;
    if (sigaction(SIGCHLD, &action, NULL) != 0) return 70;
    if (interrupted) return 0;

    posix_spawnattr_t attributes;
    posix_spawn_file_actions_t files;
    int error = posix_spawnattr_init(&attributes);
    if (error != 0) return 70;
    error = posix_spawn_file_actions_init(&files);
    if (error != 0) {
        posix_spawnattr_destroy(&attributes);
        return 70;
    }
    sigset_t defaults, mask;
    sigemptyset(&defaults);
    sigaddset(&defaults, SIGTERM);
    sigaddset(&defaults, SIGINT);
    sigaddset(&defaults, SIGPIPE);
    sigemptyset(&mask);
    if ((error = posix_spawnattr_setpgroup(&attributes, 0)) == 0)
        error = posix_spawnattr_setsigdefault(&attributes, &defaults);
    if (error == 0) error = posix_spawnattr_setsigmask(&attributes, &mask);
    if (error == 0) error = posix_spawnattr_setflags(&attributes,
        POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK);
    if (error == 0) error = posix_spawn_file_actions_addopen(&files, STDIN_FILENO, "/dev/null", O_RDONLY, 0);
    char *runtime_arguments[] = {argv[1], "--profile", "web", "--no-open", "--host", "127.0.0.1", "--port", "0", NULL};
    char *scanner_arguments[] = {argv[2], "dir", source, config, "--redact=100", "--no-banner",
                                "--ignore-gitleaks-allow", ignore, "--report-format=json", report, timeout, NULL};
    char **arguments = scan ? scanner_arguments : runtime_arguments;
    pid_t child = -1;
    if (error == 0) error = posix_spawn(&child, executable, &files, &attributes, arguments, environ);
    posix_spawn_file_actions_destroy(&files);
    posix_spawnattr_destroy(&attributes);
    if (error != 0) {
        fputs("host-supervisor: runtime spawn failed\n", stderr);
        return 71;
    }

    bool reaped = false, stopping = false, requested = false, forced = false, failed = false;
    int child_status = 0;
    long long deadline = 0;
    for (;;) {
        if (!reaped) {
            pid_t waited = waitpid(child, &child_status, WNOHANG);
            if (waited == child) reaped = true;
            else if (waited == -1 && errno != EINTR) { failed = true; reaped = true; }
        }
        long long now = milliseconds();
        if (now < 0) { failed = true; interrupted = 1; }
        if (!stopping && (reaped || interrupted)) {
            requested = interrupted != 0;
            stopping = true;
            deadline = now + grace;
            if (group_exists(child) && kill(-child, SIGTERM) != 0 && errno != ESRCH) failed = true;
        }
        if (stopping) {
            if (reaped && !group_exists(child)) break;
            if (failed || now >= deadline) {
                if (kill(-child, SIGKILL) != 0 && errno != ESRCH) failed = true;
                forced = true;
                if (!reaped) {
                    pid_t waited;
                    do { waited = waitpid(child, &child_status, 0); } while (waited == -1 && errno == EINTR);
                    if (waited != child) failed = true;
                }
                break;
            }
        }
        struct pollfd parent = { .fd = stopping ? -1 : STDIN_FILENO, .events = POLLIN | POLLHUP };
        int polled = poll(&parent, 1, 25);
        if (polled < 0 && errno != EINTR) { failed = true; interrupted = 1; }
        if (polled > 0) {
            char byte;
            ssize_t length = read(STDIN_FILENO, &byte, 1);
            if (length != 0) failed = true;
            interrupted = 1;
        }
    }
    if (failed) {
        fputs("host-supervisor: runtime lifetime verification failed\n", stderr);
        return 70;
    }
    if (forced) {
        fputs("host-supervisor: runtime required forced termination\n", stderr);
        return 124;
    }
    return requested ? 0 : outcome(child_status);
}
