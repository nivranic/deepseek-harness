"""Build a pinned XCFramework from committed Go sources and inspect every archive slice."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import traceback

from .apple_scanner_artifact import apple_dependencies, apple_policy, framework_entries, package_apple
from .mobile_scanner_artifact import license_files
from .mobile_scanner_build import json_stream
from .mobile_scanner_source import MODULE, read_source, verify_materialized_source, write_proxy


BUILD_FILES = (
    "scripts/build-apple-support-scanner.py", "scripts/release/apple_scanner_build.py",
    "scripts/release/apple_scanner_artifact.py", "scripts/release/mobile_scanner_source.py",
    "scripts/release/mobile_scanner_artifact.py", "scripts/release/mobile_scanner_build.py",
)


def build_apple(repository: Path, commit: str, *, go: Path, developer: Path, cache: Path, work: Path, output: Path) -> dict:
    """Produce a statically verified Apple archive without claiming native or application acceptance."""
    if work.exists() or work.is_symlink() or output.exists() or output.is_symlink():
        raise ValueError("Apple scanner work and output directories must be new")
    repository, cache, work, output = (path.resolve() for path in (repository, cache, work, output))
    if work == output or work.is_relative_to(output) or output.is_relative_to(work):
        raise ValueError("Apple scanner work and output directories must be disjoint")
    if cache.is_relative_to(output) or output.is_relative_to(cache):
        raise ValueError("Apple scanner cache must be outside the artifact directory")
    source = read_source(repository, commit)
    builders = []
    for name in BUILD_FILES:
        blob = subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-C", str(repository), "show", commit + ":" + name], stderr=subprocess.PIPE)
        if blob != (repository / name).read_bytes():
            raise ValueError("Apple scanner builder files must match the source commit")
        builders.append({"path": name, "sha256": hashlib.sha256(blob).hexdigest()})
    inputs = {item.module_path: item.data for item in source.files}
    policy = apple_policy(json.loads(inputs["apple-build.json"]))
    tools_policy = json.loads(inputs["build.json"])
    fields = {"schemaVersion", "goVersion", "gomobileVersion", "androidApi", "androidNdkVersion"}
    if not isinstance(tools_policy, dict) or set(tools_policy) != fields or type(tools_policy["schemaVersion"]) is not int or tools_policy["schemaVersion"] != 1:
        raise ValueError("Apple scanner shared build policy has unsupported fields")
    if not isinstance(tools_policy["goVersion"], str) or not isinstance(tools_policy["gomobileVersion"], str) or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", tools_policy["goVersion"]) is None or re.fullmatch(r"v0\.0\.0-[0-9]{14}-[a-f0-9]{12}", tools_policy["gomobileVersion"]) is None:
        raise ValueError("Apple scanner Go and gomobile versions must be exact")
    if sys.platform != "darwin" or not go.is_file() or not (developer / "usr/bin/xcodebuild").is_file():
        raise ValueError("Apple scanner requires macOS, the pinned Go executable and Xcode developer directory")
    work.mkdir(parents=True)
    tools, temporary, binding = (work / name for name in ("tools", "tmp", "binding"))
    for directory in (tools, temporary, binding):
        directory.mkdir()
    inherited = ("HOME", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR")
    env = {name: os.environ[name] for name in inherited if name in os.environ}
    env.update(PATH=os.pathsep.join([str(go.parent), str(tools), "/usr/bin", "/bin", "/usr/sbin", "/sbin"]),
               DEVELOPER_DIR=str(developer), GOENV="off", GOWORK="off", GOTOOLCHAIN="local", GOVCS="*:off",
               GOSUMDB="sum.golang.org", GONOPROXY="none", GOMAXPROCS="4", GOBIN=str(tools),
               GOPATH=str(cache / "gopath"), GOCACHE=str(cache / "gocache"), GOMODCACHE=str(cache / "modcache"),
               TEMP=str(temporary), TMP=str(temporary), TMPDIR=str(temporary))
    log = work / "build.log"

    def run(arguments: list[str], *, binary: bool = False) -> bytes:
        result = subprocess.run(arguments, cwd=binding, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        with log.open("ab") as stream:
            if not binary:
                stream.write(result.stdout)
            stream.write(result.stderr)
        if result.returncode:
            raise RuntimeError("Apple scanner command failed; inspect the private work log")
        return result.stdout

    xcode = run(["/usr/bin/xcodebuild", "-version"]).decode().strip().splitlines()
    if xcode != ["Xcode " + policy["xcodeVersion"], "Build version " + policy["xcodeBuild"]]:
        raise ValueError("Apple scanner Xcode identity differs from policy")
    if run([str(go), "env", "GOVERSION"]).decode().strip() != "go" + tools_policy["goVersion"]:
        raise ValueError("Apple scanner Go compiler differs from policy")
    sdks = []
    for sdk in ("iphoneos", "iphonesimulator", "macosx"):
        version = run(["/usr/bin/xcrun", "--sdk", sdk, "--show-sdk-version"]).decode().strip()
        build = run(["/usr/bin/xcrun", "--sdk", sdk, "--show-sdk-build-version"]).decode().strip()
        if re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", version) is None or re.fullmatch(r"[0-9]+[A-Z][0-9]+[a-z]?", build) is None:
            raise ValueError("Apple scanner SDK identity is malformed")
        sdks.append({"sdk": sdk, "version": version, "build": build})
    proxy = work / "proxy"
    source_receipt = write_proxy(source, proxy)
    env.update(GOPROXY=proxy.as_uri() + ",https://proxy.golang.org", GONOSUMDB=MODULE)
    (binding / "go.mod").write_text("module deepseek.local/support-scanner-binding\n\ngo " + tools_policy["goVersion"]
                                   + "\n\nrequire (\n " + MODULE + " " + source.version + "\n golang.org/x/mobile "
                                   + tools_policy["gomobileVersion"] + "\n)\n", encoding="utf-8")
    (binding / "binding.go").write_text('package binding\nimport (_ "' + MODULE + '"; _ "golang.org/x/mobile/bind")\n', encoding="utf-8")
    run([str(go), "mod", "tidy"])
    downloaded = json.loads(run([str(go), "mod", "download", "-json", MODULE + "@" + source.version]))
    verify_materialized_source(source, Path(downloaded["Dir"]))
    run([str(go), "mod", "verify"])
    for name in ("gomobile", "gobind"):
        run([str(go), "install", "golang.org/x/mobile/cmd/" + name + "@" + tools_policy["gomobileVersion"]])
        info = json.loads(run([str(go), "version", "-m", "-json", str(tools / name)]))
        if info.get("Main", {}).get("Path") != "golang.org/x/mobile" or info["Main"].get("Version") != tools_policy["gomobileVersion"]:
            raise ValueError("Apple scanner generator provenance differs")
    gomobile = str(tools / "gomobile")
    run([gomobile, "init"])
    env["GOFLAGS"] = "-mod=readonly -buildvcs=false"
    raw = work / "SupportScanner.xcframework"
    run([gomobile, "bind", "-target=ios/arm64,iossimulator/arm64,iossimulator/amd64,macos/arm64,macos/amd64",
         "-iosversion=" + policy["minimumIOSVersion"], "-macosversion=" + policy["minimumMacOSVersion"],
         "-prefix=DSH", "-trimpath", "-ldflags=-w", "-o", str(raw), MODULE])
    verify_materialized_source(source, Path(downloaded["Dir"]))
    run([str(go), "mod", "verify"])
    with (work / "framework-layout.log").open("x", encoding="utf-8") as stream:
        for path in sorted(raw.rglob("*")):
            name = path.relative_to(raw).as_posix()
            if path.is_symlink():
                stream.write(json.dumps({"path": name, "link": str(path.readlink())}) + "\n")
            elif path.is_file():
                stream.write(json.dumps({"path": name, "bytes": path.stat().st_size}) + "\n")
                if path.suffix == ".plist":
                    stream.write(path.read_bytes().decode("utf-8", errors="backslashreplace") + "\n")
    files, links, libraries = framework_entries(raw)
    graphs, slices = [], []
    for library in libraries:
        binary = raw / library["binary"]
        architectures = run(["/usr/bin/xcrun", "lipo", "-archs", str(binary)]).decode().split()
        if sorted(architectures) != library["architectures"]:
            raise ValueError("Apple scanner archive architectures differ from its index")
        for architecture in architectures:
            identifier = library["identifier"] + "-" + architecture
            thin = work / (identifier + ".a")
            if len(architectures) == 1:
                shutil.copyfile(binary, thin)
            else:
                run(["/usr/bin/xcrun", "lipo", str(binary), "-thin", architecture, "-output", str(thin)])
            members = run(["/usr/bin/xcrun", "ar", "-t", str(thin)]).decode().splitlines()
            if members.count("go.o") != 1:
                raise ValueError("Apple scanner archive must contain one Go object")
            object_bytes = run(["/usr/bin/xcrun", "ar", "-p", str(thin), "go.o"], binary=True)
            object_file = work / (identifier + ".o")
            object_file.write_bytes(object_bytes)
            info = json.loads(run([str(go), "version", "-m", "-json", str(object_file)]))
            if info.get("GoVersion") != "go" + tools_policy["goVersion"]:
                raise ValueError("Apple scanner object compiler differs from policy")
            graphs.append(apple_dependencies(info, source.version, library["platform"], architecture))
            slices.append({"library": library["identifier"], "architecture": architecture,
                           "archiveSha256": hashlib.sha256(thin.read_bytes()).hexdigest(),
                           "goObjectSha256": hashlib.sha256(object_bytes).hexdigest()})
        metadata = plistlib.loads(files[library["plist"]])
        # Gomobile's static-framework plist has a timestamp version; source identity belongs in the manifest.
        metadata["CFBundleVersion"] = "1.0"
        metadata["CFBundleShortVersionString"] = "1.0"
        normalized = plistlib.dumps(metadata, sort_keys=True)
        (raw / library["plist"]).write_bytes(normalized)
        files[library["plist"]] = normalized
    if any(graph != graphs[0] for graph in graphs[1:]):
        raise ValueError("Apple scanner slices contain different Go module graphs")
    module_map = {item["Path"]: item for item in json_stream(run([str(go), "list", "-m", "-json", "all"]))}
    modules, notices = [], {}
    for module in graphs[0]:
        resolved = module_map[module["module"]]
        if resolved.get("Replace") or resolved.get("Version") != module["version"] or resolved.get("Sum") != module["sum"]:
            raise ValueError("Apple scanner binary module differs from verified module cache")
        identifier = hashlib.sha256((module["module"] + "@" + module["version"]).encode()).hexdigest()
        licenses = []
        for name, data in sorted(license_files(Path(resolved["Dir"])).items()):
            path = identifier + "/" + name
            notices[path] = data
            licenses.append({"path": path, "sha256": hashlib.sha256(data).hexdigest()})
        modules.append({**module, "licenses": licenses})
    goroot = Path(run([str(go), "env", "GOROOT"]).decode().strip())
    notices["go/LICENSE"] = (goroot / "LICENSE").read_bytes()
    if not notices["go/LICENSE"].strip():
        raise ValueError("Apple scanner Go license is empty")
    for data in files.values():
        if any(str(path).encode() in data for path in (repository, work, cache)):
            raise ValueError("Apple scanner contains private build paths")
    manifest = {"schemaVersion": 1, "source": source_receipt, "builderFiles": builders,
                "toolchain": {**policy, "goVersion": tools_policy["goVersion"], "gomobileVersion": tools_policy["gomobileVersion"], "sdks": sdks},
                "libraries": [{**row, "sha256": hashlib.sha256(files[row["binary"]]).hexdigest(), "bytes": len(files[row["binary"]])} for row in libraries],
                "slices": slices, "modules": modules, "goLicenseSha256": hashlib.sha256(notices["go/LICENSE"]).hexdigest(),
                "files": [{"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for name, data in sorted(files.items())], "links": links}
    artifact = package_apple(files, links, manifest, notices)
    receipt = {"schemaVersion": 1, "status": "BUILT", "sourceSha": commit, "treeSha": source.tree,
               "artifact": "support-scanner-apple.zip", "bytes": len(artifact), "sha256": hashlib.sha256(artifact).hexdigest(),
               "staticVerification": "PASS", "nativeExecution": "NOT_EXECUTED", "manifest": manifest}
    output.mkdir(parents=True)
    (output / receipt["artifact"]).write_bytes(artifact)
    (output / "scanner.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return receipt


def main() -> int:
    """Require explicit tool locations and keep command failures in the private work log."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    for name in ("go", "developer-dir", "cache", "work-dir", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    work_existed = args.work_dir.exists() or args.work_dir.is_symlink()
    try:
        receipt = build_apple(Path(__file__).resolve().parents[2], args.source_sha, go=args.go.resolve(),
                              developer=args.developer_dir.resolve(), cache=args.cache, work=args.work_dir, output=args.output)
        print(json.dumps({key: value for key, value in receipt.items() if key != "manifest"}))
        return 0
    except Exception:
        # SDK, process and filesystem errors may contain private paths; only the fixed outcome is public.
        if not work_existed and args.work_dir.is_dir() and not args.work_dir.is_symlink():
            try:
                with (args.work_dir / "failure.log").open("x", encoding="utf-8") as stream:
                    traceback.print_exc(file=stream)
            except OSError:
                # Diagnostic I/O must preserve the original failure and must not overwrite an existing file.
                pass
        print("Apple scanner build failed; inspect the private work log", file=sys.stderr)
        return 1
