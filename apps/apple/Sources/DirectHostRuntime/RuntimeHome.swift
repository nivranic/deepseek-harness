import Foundation

/// Resolves an explicit application home before any runtime or filesystem work starts.
public enum RuntimeHome {
    /// A supplied DSH_HOME must be a non-root absolute POSIX directory path; it is never expanded as a shell expression.
    public static func resolve(defaultHome: URL, override: String?) throws -> URL {
        guard defaultHome.isFileURL else { throw InvalidHome() }
        guard let override else { return defaultHome.standardizedFileURL }
        guard override.hasPrefix("/"), !override.hasPrefix("//"),
              !override.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw InvalidHome()
        }
        let home = URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
        guard home.pathComponents.contains(where: { $0 != "/" && $0 != "." && $0 != ".." }) else {
            throw InvalidHome()
        }
        return home
    }

    /// Deliberately contains no user path or environment value.
    private struct InvalidHome: Error {}
}
