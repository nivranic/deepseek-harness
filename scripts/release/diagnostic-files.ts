/** Create a new diagnostic envelope from a completed, exclusively owned native report directory. */
import { RcFileReader } from './rc-files.ts'
import { describeRcOutput, writeRcOutput } from './rc-output.ts'
import { projectNativeProductDiagnostics, type DiagnosticProduct, type ProductDiagnostics } from './product-diagnostics.ts'

/**
 * Verify native report bytes before projecting and writing the payload-free product envelope.
 * @param directory - quiescent producer-owned directory; its files and ancestors must not be renamed concurrently.
 * @param product - product identity obtained from the producer's checked-out source.
 * @param maxInputBytes - positive maximum native JSON size admitted by the producer.
 * @returns the written diagnostic; existing output and mismatched or malformed input fail without replacement.
 */
export async function collectProductDiagnosticFile(
  directory: string, product: DiagnosticProduct, maxInputBytes: number,
): Promise<ProductDiagnostics> {
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) throw new Error('diagnostic input byte limit must be a positive safe integer')
  const input = product.platform === 'windows' ? 'installer-crash.json'
    : product.platform === 'macos' ? 'native-crashes.json' : undefined
  if (input === undefined) throw new Error('native diagnostic file collector is not connected for this platform')
  const reference = await describeRcOutput(directory, input)
  const reader = await RcFileReader.create(directory, maxInputBytes)
  const report = await reader.read(reference, true)
  const diagnostic = projectNativeProductDiagnostics(product, report)
  await reader.assertUnchanged()
  await writeRcOutput(directory, 'product-diagnostics.json', diagnostic)
  return diagnostic
}
