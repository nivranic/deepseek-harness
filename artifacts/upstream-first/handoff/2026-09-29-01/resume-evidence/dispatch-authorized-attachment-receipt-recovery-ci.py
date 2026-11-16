import hashlib
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

expected = sys.argv[1] if len(sys.argv) == 2 else ''
if not re.fullmatch('[a-f0-9]{40}', expected):
    raise SystemExit('Require the sealed Android attachment receipt recovery commit SHA')
branch = 'agents/upstream-first'
receipt = Path('.artifacts/authorized-attachment-receipt-recovery-publication.json')
if receipt.exists():
    raise SystemExit('Refused duplicate dispatch: publication receipt already exists')
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
source = 'artifacts/upstream-first/android-attachment-receipt-recovery-source.json'
source_sha = 'a6885018a5c9d2ca9564314993f9edff2d1af832023244979fd2842101feb14d'
if head != expected or hashlib.sha256(subprocess.check_output(['git', 'show', 'HEAD:' + source])).hexdigest() != source_sha:
    raise SystemExit('Refused: local HEAD differs from the sealed Android attachment receipt recovery checkpoint')
credential = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
                            text=True, capture_output=True, check=True)
fields = dict(line.split('=', 1) for line in credential.stdout.splitlines() if '=' in line)
token = fields.get('password')
if not token:
    raise SystemExit('GitHub credential unavailable')
headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
           'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Codex-upstream-first'}
base = 'https://api.github.com/repos/nivranic/deepseek-harness'
try:
    with urllib.request.urlopen(urllib.request.Request(base + '/git/ref/heads/' + branch, headers=headers), timeout=30) as response:
        remote = json.load(response)['object']['sha']
    if remote != expected:
        raise SystemExit('Refused: remote HEAD differs from the sealed Android attachment receipt recovery checkpoint')
    request = urllib.request.Request(base + '/actions/workflows/ci.yml/dispatches',
        data=json.dumps({'ref': branch}).encode(), method='POST', headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        dispatch = response.status
    if dispatch != 204:
        raise SystemExit('Unexpected CI dispatch status')
    result = {'local': head, 'remote': remote, 'ref': branch, 'sourceSha256': source_sha, 'dispatch': dispatch}
    with receipt.open('x', encoding='utf-8', newline='\n') as output:
        output.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
except urllib.error.HTTPError as error:
    raise SystemExit('GitHub API HTTP status ' + str(error.code)) from None
except urllib.error.URLError:
    raise SystemExit('GitHub API connection unavailable') from None
