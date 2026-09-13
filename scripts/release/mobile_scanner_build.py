"""Build Android JNI resources from one commit using a private module proxy."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from .mobile_scanner_artifact import (
    JAVA_PACKAGE, android_entries, build_dependencies, license_files, package_android,
)
from .mobile_scanner_source import MODULE, read_source, verify_materialized_source, write_proxy


BUILD_FILES = (
    "scripts/build-mobile-support-scanner.py",
    "scripts/release/mobile_scanner_build.py",
    "scripts/release/mobile_scanner_source.py",
    "scripts/release/mobile_scanner_artifact.py",
)


def json_stream(data: bytes) -> list[dict]:
    """Read the sequence of JSON objects emitted by Go module inspection."""
    text = data.decode("utf-8")
    decoder = json.JSONDecoder()
    position, values = 0, []
    while position < len(text):
        if text[position].isspace():
            position += 1
            continue
        value, position = decoder.raw_decode(text, position)
        if not isinstance(value, dict):
            raise ValueError("Go inspection must emit JSON objects")
        values.append(value)
    return values


def build_android(repository: Path, commit: str, *, go: Path, sdk: Path, ndk: Path, java: Path,
                  cache: Path, work: Path, output: Path) -> dict:
    """Build and statically verify one committed AAR; device execution is separate."""
    if work.exists() or work.is_symlink() or output.exists() or output.is_symlink():
        raise ValueError("Scanner work and output directories must be new and disjoint")
    repository, cache, work, output = (path.resolve() for path in (repository, cache, work, output))
    if work.exists() or output.exists() or work.is_relative_to(output) or output.is_relative_to(work):
        raise ValueError("Scanner work and output directories must be new and disjoint")
    if cache.is_relative_to(output) or output.is_relative_to(cache):
        raise ValueError("Scanner cache must be outside the artifact directory")
    source = read_source(repository, commit)
    builder = []
    for name in BUILD_FILES:
        committed = subprocess.check_output(["git", "-C", str(repository), "show", commit + ":" + name], stderr=subprocess.PIPE)
        if (repository / name).read_bytes() != committed:
            raise ValueError("Scanner builder files must match the source commit")
        builder.append({"path": name, "sha256": hashlib.sha256(committed).hexdigest()})
    policy_file = next(item for item in source.files if item.module_path == "build.json")
    policy = json.loads(policy_file.data)
    if set(policy) != {"schemaVersion", "goVersion", "gomobileVersion", "androidApi", "androidNdkVersion"} or policy["schemaVersion"] != 1:
        raise ValueError("Scanner build policy has unsupported fields")
    if re.fullmatch(r"\d+\.\d+\.\d+", policy["goVersion"]) is None or re.fullmatch(r"v0\.0\.0-\d{14}-[0-9a-f]{12}", policy["gomobileVersion"]) is None:
        raise ValueError("Scanner build tools must use exact versions")
    if not isinstance(policy["androidApi"], int) or isinstance(policy["androidApi"], bool) or policy["androidApi"] < 33:
        raise ValueError("Scanner Android API must be an integer of at least 33")
    properties = (ndk / "source.properties").read_text(encoding="utf-8")
    revision = re.search(r"(?m)^Pkg\.Revision\s*=\s*(\S+)\s*$", properties)
    if revision is None or revision.group(1) != policy["androidNdkVersion"]:
        raise ValueError("Scanner NDK differs from the committed build policy")
    executable = ".exe" if os.name == "nt" else ""
    javac = java / "bin" / ("javac" + executable)
    if not go.is_file() or not javac.is_file() or not sdk.is_dir():
        raise ValueError("Scanner Go, Java and Android SDK inputs must exist")
    work.mkdir(parents=True)
    tools, temporary, binding = (work / name for name in ("tools", "tmp", "binding"))
    for directory in (tools, temporary, binding):
        directory.mkdir()
    inherited = ("SystemRoot", "SYSTEMROOT", "SystemDrive", "COMSPEC", "PATHEXT", "USERPROFILE", "HOME",
                 "APPDATA", "LOCALAPPDATA", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR")
    env = {key: os.environ[key] for key in inherited if key in os.environ}
    env.update(PATH=os.pathsep.join([str(go.parent), str(tools), str(java / "bin"), os.environ.get("PATH", "")]),
               GOENV="off", GOWORK="off", GOTOOLCHAIN="local", GOVCS="*:off", GOSUMDB="sum.golang.org",
               GOPATH=str(cache / "gopath"), GOCACHE=str(cache / "gocache"), GOMODCACHE=str(cache / "modcache"),
               GOBIN=str(tools), GONOPROXY="none", GOMAXPROCS=os.environ.get("GOMAXPROCS", "4"),
               JAVA_HOME=str(java), ANDROID_HOME=str(sdk), ANDROID_NDK_HOME=str(ndk),
               TEMP=str(temporary), TMP=str(temporary), TMPDIR=str(temporary))
    log = work / "build.log"

    def run(arguments: list[str], *, cwd: Path = binding) -> bytes:
        result = subprocess.run(arguments, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        with log.open("ab") as stream:
            stream.write(result.stdout)
            stream.write(result.stderr)
        if result.returncode != 0:
            raise RuntimeError("Scanner build command failed; inspect the private work log")
        return result.stdout

    if run([str(go), "env", "GOVERSION"]).decode().strip() != "go" + policy["goVersion"]:
        raise ValueError("Scanner Go compiler differs from the committed build policy")
    if not run([str(javac), "-version"]).decode().strip().startswith("javac 17."):
        raise ValueError("Scanner Java compiler must be version 17")
    proxy = work / "proxy"
    source_receipt = write_proxy(source, proxy)
    # This unpublished module is verified against Git below. External modules keep checksum-database verification.
    env.update(GOPROXY=proxy.as_uri() + ",https://proxy.golang.org", GONOSUMDB=MODULE)
    module_text = ("module deepseek.local/support-scanner-binding\n\ngo " + policy["goVersion"] + "\n\nrequire (\n "
                   + MODULE + " " + source.version + "\n golang.org/x/mobile " + policy["gomobileVersion"] + "\n)\n")
    (binding / "go.mod").write_text(module_text, encoding="utf-8", newline="\n")
    (binding / "binding.go").write_text('package binding\nimport (_ "' + MODULE + '"; _ "golang.org/x/mobile/bind")\n',
                                         encoding="utf-8", newline="\n")
    run([str(go), "mod", "tidy"])
    downloaded = json.loads(run([str(go), "mod", "download", "-json", MODULE + "@" + source.version]))
    verify_materialized_source(source, Path(downloaded["Dir"]))
    run([str(go), "mod", "verify"])
    for name in ("gomobile", "gobind"):
        run([str(go), "install", "golang.org/x/mobile/cmd/" + name + "@" + policy["gomobileVersion"]])
        tool_info = json.loads(run([str(go), "version", "-m", "-json", str(tools / (name + executable))]))
        if tool_info.get("Main", {}).get("Path") != "golang.org/x/mobile" or tool_info["Main"].get("Version") != policy["gomobileVersion"]:
            raise ValueError("Scanner generator provenance differs from its pinned module")
    gomobile = str(tools / ("gomobile" + executable))
    run([gomobile, "init"])
    env["GOFLAGS"] = "-mod=readonly -buildvcs=false"
    raw = work / "scanner.aar"
    run([gomobile, "bind", "-target=android/arm64,android/amd64", "-androidapi=" + str(policy["androidApi"]),
         "-trimpath", "-javapkg=" + JAVA_PACKAGE, "-ldflags=-w -extldflags=-Wl,-z,max-page-size=16384",
         "-o", str(raw), MODULE])
    verify_materialized_source(source, Path(downloaded["Dir"]))
    run([str(go), "mod", "verify"])
    entries, libraries = android_entries(raw.read_bytes(), policy["androidApi"])
    module_list = json_stream(run([str(go), "list", "-m", "-json", "all"]))
    module_map = {item["Path"]: item for item in module_list}
    graphs = []
    for library in libraries:
        binary = entries["jni/" + library["abi"] + "/libgojni.so"]
        private_paths = [str(path) for path in (repository, cache, work, sdk, ndk, java)]
        if any(value.encode() in binary for path in private_paths for value in (path, path.replace("\\", "/"))):
            raise ValueError("Scanner binary contains a private build directory")
        native_file = work / (library["abi"] + ".so")
        native_file.write_bytes(binary)
        info = json.loads(run([str(go), "version", "-m", "-json", str(native_file)]))
        if info.get("GoVersion") != "go" + policy["goVersion"]:
            raise ValueError("Scanner native compiler version differs from policy")
        graphs.append(build_dependencies(info, source.version, library["abi"]))
    if graphs[0] != graphs[1]:
        raise ValueError("Scanner ABIs contain different Go module graphs")
    notices, modules = {}, []

    def add_notices(identifier: str, material: dict[str, bytes]) -> list[dict]:
        rows = []
        for name, data in sorted(material.items()):
            if not data.strip():
                raise ValueError("Scanner toolchain license material must not be empty")
            path = identifier + "/" + name
            if path in notices:
                raise ValueError("Scanner license identifiers must be unique")
            notices[path] = data
            rows.append({"path": path, "sha256": hashlib.sha256(data).hexdigest()})
        return rows

    for module in graphs[0]:
        resolved = module_map[module["module"]]
        if resolved.get("Replace") or resolved["Version"] != module["version"] or resolved.get("Sum") != module["sum"]:
            raise ValueError("Scanner binary module differs from the verified module cache")
        identifier = hashlib.sha256((module["module"] + "@" + module["version"]).encode()).hexdigest()
        modules.append({**module, "licenses": add_notices(identifier, license_files(Path(resolved["Dir"])))})
    goroot = Path(run([str(go), "env", "GOROOT"]).decode().strip())
    tool_notices = {"go": add_notices("go", {"LICENSE": (goroot / "LICENSE").read_bytes()}),
                    "androidNdk": add_notices("android-ndk", {name: (ndk / name).read_bytes() for name in ("NOTICE", "NOTICE.toolchain")})}
    manifest = {"schemaVersion": 1, "source": source_receipt, "builderFiles": builder, "toolchain": policy,
                "javaPackage": JAVA_PACKAGE, "libraries": libraries, "modules": modules, "toolchainLicenses": tool_notices}
    artifact = package_android(entries, manifest, notices)
    receipt = {"schemaVersion": 1, "status": "BUILT", "sourceSha": commit, "treeSha": source.tree,
               "artifact": "support-scanner.aar", "bytes": len(artifact), "sha256": hashlib.sha256(artifact).hexdigest(),
               "staticVerification": "PASS", "deviceExecution": "NOT_EXECUTED", "manifest": manifest}
    output.mkdir(parents=True)
    with (output / "support-scanner.aar").open("xb") as stream:
        stream.write(artifact)
    with (output / "scanner.json").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    return receipt


def main() -> int:
    """Build an Android library while leaving failure logs outside the artifact directory."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    for name in ("go", "android-sdk", "android-ndk", "java-home", "cache", "work-dir", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    try:
        result = build_android(Path(__file__).resolve().parents[2], args.source_sha, go=args.go.resolve(),
                               sdk=args.android_sdk.resolve(), ndk=args.android_ndk.resolve(), java=args.java_home.resolve(),
                               cache=args.cache, work=args.work_dir, output=args.output)
        print(json.dumps({key: value for key, value in result.items() if key != "manifest"}))
        return 0
    except Exception:
        # Tool errors can contain local paths; details stay in the caller's private work log.
        print("Mobile scanner build failed; no verified artifact was recorded", file=sys.stderr)
        return 1
