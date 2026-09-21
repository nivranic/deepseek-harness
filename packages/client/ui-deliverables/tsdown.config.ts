import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-deliverables', ['lib/types/index.js'], {
  hostPhase: true,
  // The browser-safe emitted tree under lib/types/client imports its CSS
  // modules by relative path; publish those sheets beside the JavaScript.
  lib: {
    plugins: [{
      name: 'dsh-deliverables-emitted-css',
      buildEnd() {
        const source = join(import.meta.dirname, 'src/client')
        const target = join(import.meta.dirname, 'lib/types/client')
        mkdirSync(target, { recursive: true })
        for (const file of readdirSync(source)) {
          if (file.endsWith('.module.css')) copyFileSync(join(source, file), join(target, file))
        }
      },
    }],
  },
})
