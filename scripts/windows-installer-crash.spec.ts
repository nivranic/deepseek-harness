import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, 'release/read-windows-installer-crash.ps1')
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe.skipIf(process.platform !== 'win32')('Windows installer crash diagnostics', () => {
  async function observe(eventBody: string, alias = false, waitMilliseconds = 0): Promise<{ output: string; result: unknown }> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-installer-diagnostic-'))
    roots.push(root)
    const executable = join(root, 'installer.exe')
    await writeFile(executable, 'diagnostic bytes, never executed')
    await mkdir(join(root, 'nested'))
    const candidate = alias ? `${root}${sep}nested${sep}..${sep}installer.exe` : executable
    const wrapper = join(root, 'read.ps1')
    await writeFile(wrapper, `param($ScriptPath, $Candidate)
$ErrorActionPreference = 'Stop'
function Get-WinEvent {
  [CmdletBinding()] param($FilterHashtable, $MaxEvents)
  ${eventBody}
}
& $ScriptPath -ExecutablePath $Candidate -WaitMilliseconds ${String(waitMilliseconds)}
`)
    const { stdout } = await promisify(execFile)('pwsh', ['-NoProfile', '-File', wrapper, script, candidate], { windowsHide: true })
    return { output: stdout, result: JSON.parse(stdout) as unknown }
  }

  it('matches the full executable path and projects only diagnostic fields from native event XML', async () => {
    const { output, result } = await observe(`
  if ($FilterHashtable.ID -ne 1000 -or $FilterHashtable.ProviderName -ne 'Application Error' -or $MaxEvents -ne 100) { throw 'wrong query' }
  foreach ($path in @($Candidate.ToUpperInvariant(), 'C:\\unrelated\\installer.exe')) {
    $xml = '<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event"><System><Provider Name="Application Error"/><EventID>1000</EventID></System><EventData>' +
      '<Data Name="AppPath">' + [Security.SecurityElement]::Escape($path) + '</Data>' +
      '<Data Name="ModuleName">C:\\Windows\\System32\\ntdll.dll</Data><Data Name="ExceptionCode">C0000005</Data>' +
      '<Data Name="FaultingOffset">00000abc</Data><Data Name="AppVersion">0.1.2.1</Data>' +
      '<Data Name="Message">synthetic-private-payload</Data></EventData></Event>'
    $item = [pscustomobject]@{ XmlText = $xml }
    $item | Add-Member ScriptMethod ToXml { return $this.XmlText } -PassThru
  }`)
    expect(result).toEqual({
      schemaVersion: 1, scope: 'windows-installer-crash-diagnostic', queryState: 'queried', malformedRecords: 0,
      queryAttempts: 1, waitedMilliseconds: expect.any(Number) as unknown,
      sha256: createHash('sha256').update('diagnostic bytes, never executed').digest('hex'), sizeBytes: 32,
      records: [{ module: 'ntdll.dll', exceptionCode: '0xc0000005', faultOffset: '0x00000abc', applicationVersion: '0.1.2.1' }],
    })
    expect(output).not.toMatch(/synthetic-private|unrelated|System32|AppPath/)
  })

  it('drops malformed field values and reports malformed XML without exposing its contents', async () => {
    const { output, result } = await observe(`
  $xml = '<Event><System><Provider Name="Application Error"/><EventID>1000</EventID></System><EventData>' +
    '<Data Name="AppPath">' + [Security.SecurityElement]::Escape($Candidate) + '</Data>' +
    '<Data Name="ModuleName">private payload</Data><Data Name="ExceptionCode">private payload</Data>' +
    '<Data Name="FaultingOffset">private payload</Data><Data Name="AppVersion">private payload</Data></EventData></Event>'
  $item = [pscustomobject]@{ XmlText = $xml }
  $item | Add-Member ScriptMethod ToXml { return $this.XmlText } -PassThru
  $bad = [pscustomobject]@{}
  $bad | Add-Member ScriptMethod ToXml { return '<private payload' } -PassThru
`)
    expect(result).toMatchObject({ queryState: 'queried', malformedRecords: 1,
      records: [{ module: null, exceptionCode: null, faultOffset: null, applicationVersion: null }] })
    expect(output).not.toContain('private payload')
  })

  it('distinguishes no matching events from an unavailable query without exposing host errors', async () => {
    const empty = await observe("Write-Error 'synthetic-private-payload' -ErrorId NoMatchingEventsFound -ErrorAction Stop")
    expect(empty.result).toMatchObject({ queryState: 'queried', records: [] })
    const denied = await observe("throw 'synthetic-private-payload'")
    expect(denied.result).toMatchObject({ queryState: 'unavailable', records: [] })
    expect(empty.output + denied.output).not.toContain('synthetic-private-payload')
  })

  it('waits for a matching Application Error event within the requested diagnostic interval', async () => {
    const { result } = await observe(`
  $script:attempts++
  if ($script:attempts -lt 2) { return }
  $xml = '<Event><System><Provider Name="Application Error"/><EventID>1000</EventID></System><EventData>' +
    '<Data Name="AppPath">' + [Security.SecurityElement]::Escape($Candidate) + '</Data>' +
    '<Data Name="ModuleName">ntdll.dll</Data><Data Name="ExceptionCode">C0000005</Data></EventData></Event>'
  $item = [pscustomobject]@{ XmlText = $xml }
  $item | Add-Member ScriptMethod ToXml { return $this.XmlText } -PassThru
`, false, 1_000)
    expect(result).toMatchObject({ queryState: 'queried', queryAttempts: 2,
      records: [{ module: 'ntdll.dll', exceptionCode: '0xc0000005' }] })
  })

  it('finishes an empty diagnostic interval and retains query failure independently', async () => {
    const empty = await observe('return', false, 20)
    expect(empty.result).toMatchObject({ queryState: 'queried', records: [] })
    expect((empty.result as { waitedMilliseconds: number }).waitedMilliseconds).toBeGreaterThanOrEqual(20)
    const denied = await observe("throw 'synthetic-private-payload'", false, 1_000)
    expect(denied.result).toMatchObject({ queryState: 'unavailable', queryAttempts: 1, records: [] })
    expect(denied.output).not.toContain('synthetic-private-payload')
  })

  it.each([-1, 30_001])('rejects the invalid diagnostic wait %i before querying', async (waitMilliseconds) => {
    await expect(observe('return', false, waitMilliseconds)).rejects.toThrow('WaitMilliseconds')
  })

  it('matches the supplied absolute spelling when file lookup resolves a different spelling', async () => {
    const { result } = await observe(`
  $xml = '<Event><System><Provider Name="Application Error"/><EventID>1000</EventID></System><EventData>' +
    '<Data Name="AppPath">' + [Security.SecurityElement]::Escape($Candidate) + '</Data>' +
    '<Data Name="ModuleName">ntdll.dll</Data><Data Name="ExceptionCode">C0000005</Data></EventData></Event>'
  $item = [pscustomobject]@{ XmlText = $xml }
  $item | Add-Member ScriptMethod ToXml { return $this.XmlText } -PassThru
`, true)
    expect(result).toMatchObject({ records: [{ module: 'ntdll.dll', exceptionCode: '0xc0000005' }] })
  })
})
