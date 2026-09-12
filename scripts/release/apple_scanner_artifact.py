"""Validate the exact Apple scanner framework matrix and preserve its owned links."""

import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import plistlib
import re
import stat
import zipfile

from .mobile_scanner_artifact import native_dependencies


FRAMEWORK = "SupportScanner.framework"
BINARY = "SupportScanner"
LIBRARIES = {
    "ios-arm64": ("ios", None, ("arm64",)),
    "ios-arm64_x86_64-simulator": ("ios", "simulator", ("arm64", "x86_64")),
    "macos-arm64_x86_64": ("macos", None, ("arm64", "x86_64")),
}
MAC_LINKS = {"Versions/Current": "A", "Headers": "Versions/Current/Headers",
             "Modules": "Versions/Current/Modules", "Resources": "Versions/Current/Resources",
             BINARY: "Versions/Current/" + BINARY}


def apple_policy(value: object) -> dict:
    """Require exact Xcode identities and explicit deployment versions."""
    fields = {"schemaVersion", "xcodeVersion", "xcodeBuild", "minimumIOSVersion", "minimumMacOSVersion"}
    if not isinstance(value, dict) or set(value) != fields or type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise ValueError("Apple scanner policy has unsupported fields")
    for name in ("xcodeVersion", "minimumIOSVersion", "minimumMacOSVersion"):
        if not isinstance(value[name], str) or re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", value[name]) is None:
            raise ValueError("Apple scanner versions must be explicit numeric versions")
    if not isinstance(value["xcodeBuild"], str) or re.fullmatch(r"[0-9]+[A-Z][0-9]+[a-z]?", value["xcodeBuild"]) is None:
        raise ValueError("Apple scanner Xcode build must be exact")
    return value


def framework_libraries(value: object) -> list[dict]:
    """Reject missing, duplicate or substituted platform/architecture framework slices."""
    if not isinstance(value, dict) or value.get("XCFrameworkFormatVersion") != "1.0" or value.get("CFBundlePackageType") != "XFWK":
        raise ValueError("Scanner must be an XCFramework version 1.0")
    rows = value.get("AvailableLibraries")
    if not isinstance(rows, list) or len(rows) != len(LIBRARIES):
        raise ValueError("Scanner XCFramework must contain all declared libraries")
    seen = set()
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Scanner framework library must be an object")
        name = row.get("LibraryIdentifier")
        if not isinstance(name, str) or name not in LIBRARIES or name in seen:
            raise ValueError("Scanner framework library identity is unknown or duplicated")
        seen.add(name)
        platform, variant, architectures = LIBRARIES[name]
        fields = {"BinaryPath", "LibraryIdentifier", "LibraryPath", "SupportedArchitectures", "SupportedPlatform"}
        if variant:
            fields.add("SupportedPlatformVariant")
        arches = row.get("SupportedArchitectures")
        if set(row) != fields or row.get("LibraryPath") != FRAMEWORK or row.get("SupportedPlatform") != platform or row.get("SupportedPlatformVariant") != variant:
            raise ValueError("Scanner framework library platform or fields differ")
        if not isinstance(arches, list) or any(not isinstance(item, str) for item in arches) or sorted(arches) != list(architectures):
            raise ValueError("Scanner framework architecture list differs")
        prefix = name + "/" + FRAMEWORK + "/"
        version = "Versions/A/" if platform == "macos" else ""
        if row["BinaryPath"] != FRAMEWORK + "/" + version + BINARY:
            raise ValueError("Scanner framework binary path differs from its declared library")
        result.append({"identifier": name, "platform": platform, "variant": variant,
                       "architectures": list(architectures), "binary": prefix + version + BINARY,
                       "headers": prefix + version + "Headers/", "modules": prefix + version + "Modules/",
                       "plist": prefix + (version + "Resources/" if platform == "macos" else "") + "Info.plist"})
    return sorted(result, key=lambda row: row["identifier"])


def framework_entries(root: Path) -> tuple[dict[str, bytes], dict[str, str], list[dict]]:
    """Read compiler output without following any unapproved framework link."""
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Scanner XCFramework must be a regular directory")
    index = root / "Info.plist"
    if index.is_symlink() or not index.is_file():
        raise ValueError("Scanner XCFramework index must be a regular file")
    libraries = framework_libraries(plistlib.loads(index.read_bytes()))
    prefix = "macos-arm64_x86_64/" + FRAMEWORK + "/"
    expected_links = {prefix + name: target for name, target in MAC_LINKS.items()}
    files, links = {}, {}
    for path in root.rglob("*"):
        name = path.relative_to(root).as_posix()
        if path.is_symlink():
            target = str(path.readlink()).replace("\\", "/")
            if expected_links.get(name) != target or not path.resolve().is_relative_to(root.resolve()) or not path.exists():
                raise ValueError("Scanner framework contains an unapproved or dangling link")
            links[name] = target
        elif path.is_file():
            if name != "Info.plist" and not any(name.startswith(row["identifier"] + "/" + FRAMEWORK + "/") for row in libraries):
                raise ValueError("Scanner framework contains an undeclared file")
            files[name] = path.read_bytes()
        elif not path.is_dir():
            raise ValueError("Scanner framework contains a non-regular entry")
    if links != expected_links:
        raise ValueError("Scanner framework version links differ")
    for row in libraries:
        required = [row["binary"], row["plist"], row["headers"] + "DSHSupportscanner.objc.h",
                    row["headers"] + "SupportScanner.h", row["headers"] + "Universe.objc.h",
                    row["headers"] + "ref.h", row["modules"] + "module.modulemap"]
        if any(not files.get(name) for name in required):
            raise ValueError("Scanner framework is missing native entrypoints or metadata")
        prefix = row["identifier"] + "/" + FRAMEWORK + "/"
        if {name for name in files if name.startswith(prefix)} != set(required):
            raise ValueError("Scanner framework contains undeclared native files")
        if not files[row["binary"]].startswith((b"!<arch>\n", b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf")):
            raise ValueError("Scanner framework must contain static archives")
        header = files[row["headers"] + "DSHSupportscanner.objc.h"].decode("utf-8")
        if any(name not in header for name in ("DSHSupportscannerNewOperation", "DSHSupportscannerRulesDigest", "DSHSupportscannerOperation", "DSHSupportscannerResult")):
            raise ValueError("Scanner Objective-C entrypoints differ")
        module = files[row["modules"] + "module.modulemap"].decode("utf-8")
        if 'framework module "SupportScanner"' not in module:
            raise ValueError("Scanner framework module differs")
        if plistlib.loads(files[row["plist"]]).get("CFBundleExecutable") != BINARY:
            raise ValueError("Scanner framework executable metadata differs")
    return files, links, libraries


def apple_dependencies(info: dict, version: str, platform: str, architecture: str) -> list[dict]:
    """Read the linked archive's Go metadata, retaining target settings and source checksums."""
    if platform not in ("ios", "macos") or architecture not in ("arm64", "x86_64"):
        raise ValueError("Scanner Apple target is unsupported")
    expected = {"GOOS": "ios" if platform == "ios" else "darwin", "GOARCH": "amd64" if architecture == "x86_64" else "arm64",
                "CGO_ENABLED": "1", "-buildmode": "c-archive", "-trimpath": "true"}
    return native_dependencies(info, version, expected)


def native_observation(value: object, platform: str, architecture: str) -> dict:
    """Admit only the fixed native probe result, excluding arbitrary process output fields."""
    fields = {"schemaVersion", "status", "platform", "architecture", "assertions", "scannerVersion", "rulesDigest"}
    if not isinstance(value, dict) or set(value) != fields or type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise ValueError("Apple scanner native observation has unsupported fields")
    if value["status"] != "PASS" or value["platform"] != platform or value["architecture"] != architecture or type(value["assertions"]) is not int or value["assertions"] != 23:
        raise ValueError("Apple scanner native acceptance did not complete its declared checks")
    if value["scannerVersion"] != "8.30.1" or not isinstance(value["rulesDigest"], str) or re.fullmatch(r"[a-f0-9]{64}", value["rulesDigest"]) is None:
        raise ValueError("Apple scanner native identity differs")
    return value


def package_apple(files: dict[str, bytes], links: dict[str, str], manifest: dict, licenses: dict[str, bytes]) -> bytes:
    """Preserve static framework links and canonicalize archive metadata around admitted bytes."""
    content = {"SupportScanner.xcframework/" + name: value for name, value in files.items()}
    content["manifest.json"] = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    content.update({"licenses/" + name: value for name, value in licenses.items()})
    symbolic = {"SupportScanner.xcframework/" + name: target.encode() for name, target in links.items()}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted({**content, **symbolic}.items()):
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = ((stat.S_IFLNK | 0o777) if name in symbolic else (stat.S_IFREG | 0o644)) << 16
            archive.writestr(entry, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return stream.getvalue()


def verify_archived_framework(data: bytes, files: dict[str, bytes], links: dict[str, str], manifest: dict) -> None:
    """Require the distributable archive to preserve exact compile inputs, link types and license bytes."""
    expected = {"SupportScanner.xcframework/" + name: value for name, value in files.items()}
    symbolic = {"SupportScanner.xcframework/" + name: target.encode() for name, target in links.items()}
    license_hashes = {"licenses/" + row["path"]: row["sha256"] for module in manifest["modules"] for row in module["licenses"]}
    license_hashes["licenses/go/LICENSE"] = manifest["goLicenseSha256"]
    names = set(expected) | set(symbolic) | set(license_hashes) | {"manifest.json"}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) != len(names) or {entry.filename for entry in entries} != names:
            raise ValueError("Apple scanner archive inventory differs")
        for entry in entries:
            name = entry.orig_filename; path = PurePosixPath(name)
            if name != entry.filename or name != path.as_posix() or path.is_absolute() or ".." in path.parts or any(c in name for c in ("\\", ":", "\0")):
                raise ValueError("Apple scanner archive contains an unsafe path")
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if entry.flag_bits & 1 or mode != (stat.S_IFLNK if name in symbolic else stat.S_IFREG):
                raise ValueError("Apple scanner archive entry type differs")
            content = archive.read(entry)
            if name in expected and content != expected[name] or name in symbolic and content != symbolic[name]:
                raise ValueError("Apple scanner archived compile inputs differ")
            if name in license_hashes and hashlib.sha256(content).hexdigest() != license_hashes[name]:
                raise ValueError("Apple scanner archived license bytes differ")
        if json.loads(archive.read("manifest.json")) != manifest:
            raise ValueError("Apple scanner archived manifest differs")
