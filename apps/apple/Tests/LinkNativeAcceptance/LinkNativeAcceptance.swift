import Foundation

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

@main
struct LinkNativeAcceptance {
    @MainActor
    static func main() async {
        do {
            var runner = try AcceptanceRunner()
            try await runner.run()
        } catch {
            let message = "LinkNativeAcceptance: \(safeErrorDescription(error))\n"
            FileHandle.standardError.write(Data(message.utf8))
            exit(EXIT_FAILURE)
        }
    }
}
