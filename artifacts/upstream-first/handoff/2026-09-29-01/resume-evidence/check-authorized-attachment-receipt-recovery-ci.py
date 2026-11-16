import json
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

head = '74b476627a950189b348a5771bb205c508f8230f'
credential = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
                            text=True, capture_output=True, check=True)
fields = dict(line.split('=', 1) for line in credential.stdout.splitlines() if '=' in line)
token = fields.get('password')
if not token:
    raise SystemExit('GitHub credential unavailable')
headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
           'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Codex-upstream-first'}
url = 'https://api.github.com/repos/nivranic/deepseek-harness/actions/workflows/ci.yml/runs?head_sha=' + head + '&event=workflow_dispatch&per_page=5'
try:
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        payload = json.load(response)
    runs = [{key: run[key] for key in ['id', 'head_sha', 'status', 'conclusion', 'html_url', 'created_at']} for run in payload['workflow_runs']]
    Path('.artifacts/authorized-attachment-receipt-recovery-ci-status.json').write_text(json.dumps(runs, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(runs))
except urllib.error.HTTPError as error:
    raise SystemExit('GitHub API HTTP status ' + str(error.code)) from None
except urllib.error.URLError:
    raise SystemExit('GitHub API connection unavailable') from None
