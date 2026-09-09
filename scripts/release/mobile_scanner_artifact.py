"""Verify and normalize mobile scanner libraries without discarding provenance."""

import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import xml.etree.ElementTree as ET
import zipfile

from .mobile_scanner_source import MODULE


JAVA_PACKAGE = "ai.deepseek.dsh.scanner"
ANDROID_LIBRARIES = {"arm64-v8a": (183, "arm64"), "x86_64": (62, "amd64")}


def archive_entries(data: bytes) -> dict[str, bytes]:
    """Read regular, unique ZIP members with portable relative names."""
    result = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = set()
        for entry in archive.infolist():
            name = entry.orig_filename
            if name != entry.filename or "\0" in name:
                raise ValueError("Scanner archive member names must not require normalization")
            path = PurePosixPath(name)
            canonical_name = path.as_posix() + ("/" if entry.is_dir() else "")
            if name in names or name != canonical_name or path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
                raise ValueError("Scanner archive contains duplicate or unsafe member names")
            names.add(name)
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if entry.is_dir():
                if mode not in (0, stat.S_IFDIR):
                    raise ValueError("Scanner archive directory has an invalid type")
                continue
            if mode not in (0, stat.S_IFREG) or entry.flag_bits & 1:
                raise ValueError("Scanner archive requires unencrypted regular files")
            result[name] = archive.read(entry)
    return result


def canonical_archive(entries: dict[str, bytes]) -> bytes:
    """Serialize stable ZIP metadata and ordering, preserving member bytes."""
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(entries.items()):
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return data.getvalue()


def inspect_android_elf(data: bytes, abi: str) -> dict:
    """Require the expected ELF64 shared library and 16 KiB-compatible LOAD segments."""
    if abi not in ANDROID_LIBRARIES or len(data) < 64 or data[:6] != b"\x7fELF\x02\x01":
        raise ValueError("Scanner library has an unsupported ELF format")
    header = struct.unpack_from("<HHIQQQIHHHHHH", data, 16)
    kind, machine, version, _, phoff, shoff, _, header_size, phsize, phnum, shsize, shnum, _ = header
    if kind != 3 or version != 1 or machine != ANDROID_LIBRARIES[abi][0] or header_size != 64 or phsize != 56 or phnum == 0:
        raise ValueError("Scanner library architecture or program headers are invalid")
    if phoff < 64 or phoff + phnum * phsize > len(data):
        raise ValueError("Scanner library program headers are truncated")
    loads = []
    for index in range(phnum):
        segment, _, offset, address, _, file_size, memory_size, alignment = struct.unpack_from(
            "<IIQQQQQQ", data, phoff + index * phsize)
        if segment != 1:
            continue
        if alignment < 16384 or alignment & (alignment - 1) or offset % 16384 != address % 16384:
            raise ValueError("Scanner library does not support 16 KiB page alignment")
        if offset + file_size > len(data) or memory_size < file_size:
            raise ValueError("Scanner library LOAD segment exceeds its file or memory range")
        loads.append({"offset": offset, "virtualAddress": address, "alignment": alignment})
    if not loads:
        raise ValueError("Scanner library has no LOAD segments")
    if shsize != 64 or shnum == 0 or shoff + shnum * shsize > len(data):
        raise ValueError("Scanner library must retain section headers for symbol analysis")
    symbols = []
    for index in range(shnum):
        _, section_type, _, _, offset, size, _, _, _, entry_size = struct.unpack_from("<IIQQQQIIQQ", data, shoff + index * shsize)
        if section_type == 2:
            if entry_size != 24 or size < 48 or size % entry_size or offset + size > len(data):
                raise ValueError("Scanner library has an invalid native symbol table")
            symbols.append(size // entry_size)
    if not symbols:
        raise ValueError("Scanner library must retain native symbols for vulnerability analysis")
    return {"abi": abi, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "loadSegments": loads}


def android_entries(data: bytes, api: int) -> tuple[dict[str, bytes], list[dict]]:
    """Check JNI classes, R8 preservation, target SDK and both native libraries."""
    entries = archive_entries(data)
    required = {"AndroidManifest.xml", "classes.jar", "proguard.txt"}
    if not required.issubset(entries):
        raise ValueError("Scanner AAR is missing JNI metadata")
    native = {name for name in entries if name.endswith(".so")}
    if native != {"jni/" + abi + "/libgojni.so" for abi in ANDROID_LIBRARIES}:
        raise ValueError("Scanner AAR must contain exactly its two declared JNI libraries")
    manifest = ET.fromstring(entries["AndroidManifest.xml"])
    sdk = manifest.findall("uses-sdk")
    if manifest.tag != "manifest" or len(sdk) != 1 or sdk[0].get("{http://schemas.android.com/apk/res/android}minSdkVersion") != str(api):
        raise ValueError("Scanner AAR minimum Android API differs from its build policy")
    classes = archive_entries(entries["classes.jar"])
    prefix = JAVA_PACKAGE.replace(".", "/") + "/supportscanner/"
    if not {prefix + name + ".class" for name in ("Supportscanner", "Operation", "Result")}.issubset(classes) or "go/Seq.class" not in classes:
        raise ValueError("Scanner AAR is missing generated Java entrypoints")
    rules = entries["proguard.txt"].decode("utf-8").splitlines()
    if [line.strip() for line in rules if line.strip()] != ["-keep class go.** { *; }", "-keep class " + JAVA_PACKAGE + ".** { *; }"]:
        raise ValueError("Scanner AAR does not preserve its JNI classes during R8 processing")
    entries["classes.jar"] = canonical_archive(classes)
    libraries = [inspect_android_elf(entries["jni/" + abi + "/libgojni.so"], abi) for abi in ANDROID_LIBRARIES]
    return entries, libraries


def build_dependencies(info: dict, version: str, abi: str) -> list[dict]:
    """Project verified Go buildinfo, rejecting local replacements or missing checksums."""
    if info.get("Path") != "gobind/gobind" or info.get("Main", {}).get("Path") != "gobind" or info.get("Main", {}).get("Replace"):
        raise ValueError("Scanner binary was not built from the gomobile binding package")
    settings = {item["Key"]: item["Value"] for item in info.get("Settings", [])}
    if any(key == "vcs" or key.startswith("vcs.") for key in settings):
        raise ValueError("Scanner binary must not infer VCS identity from the build directory")
    expected = {"GOOS": "android", "GOARCH": ANDROID_LIBRARIES[abi][1], "CGO_ENABLED": "1",
                "-buildmode": "c-shared", "-trimpath": "true"}
    if any(settings.get(key) != value for key, value in expected.items()):
        raise ValueError("Scanner binary build settings differ from the declared target")
    modules = []
    names = set()
    for dependency in info.get("Deps", []):
        path, selected, checksum = (dependency.get(key) for key in ("Path", "Version", "Sum"))
        if not isinstance(path, str) or not isinstance(selected, str) or not isinstance(checksum, str):
            raise ValueError("Scanner binary has incomplete module metadata")
        if dependency.get("Replace") or path in names or not path or not selected or re.fullmatch(r"h1:[A-Za-z0-9+/]{43}=", checksum) is None:
            raise ValueError("Scanner binary contains a replacement, duplicate or unverified module")
        names.add(path)
        modules.append({"module": path, "version": selected, "sum": checksum})
    if not any(item["module"] == MODULE and item["version"] == version for item in modules):
        raise ValueError("Scanner binary does not identify the committed module version")
    return sorted(modules, key=lambda item: item["module"])


def license_files(directory: Path) -> dict[str, bytes]:
    """Collect module license and notice files, including REUSE license texts."""
    candidates = [path for path in directory.iterdir()
                  if re.match(r"^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)([.\-_]|$)", path.name.upper())]
    licenses = directory / "LICENSES"
    if licenses.is_symlink():
        raise ValueError("Scanner license directory must not be a link")
    if licenses.is_dir():
        for path in licenses.rglob("*"):
            if path.is_symlink():
                raise ValueError("Scanner license material must not contain links")
            if not path.is_dir():
                candidates.append(path)
    result = {}
    for path in candidates:
        if path.is_symlink() or not path.is_file():
            raise ValueError("Scanner license material must contain only regular files")
        data = path.read_bytes()
        if not data.strip():
            raise ValueError("Scanner license material must not be empty")
        result[path.relative_to(directory).as_posix()] = data
    if not result:
        raise ValueError("Scanner module has no license material")
    return result


def package_android(entries: dict[str, bytes], manifest: dict, licenses: dict[str, bytes]) -> bytes:
    """Embed source, module and license evidence before canonical AAR serialization."""
    additions = {"assets/dsh-support-scanner/manifest.json":
                 (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")}
    additions.update({"assets/dsh-support-scanner/licenses/" + name: data for name, data in licenses.items()})
    if additions.keys() & entries.keys():
        raise ValueError("Scanner AAR already contains owned provenance assets")
    return canonical_archive({**entries, **additions})
