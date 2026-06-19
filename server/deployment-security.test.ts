import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function listTextFiles(relativeDirs: string[]): string[] {
  const out: string[] = []
  const visit = (relativePath: string) => {
    const absolutePath = path.join(repoRoot, relativePath)
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(relativePath, entry.name)
      if (entry.isDirectory()) {
        visit(child)
      } else if (/\.(md|ya?ml|sh|ts|tsx|json|html|txt)$/.test(entry.name)) {
        out.push(child)
      }
    }
  }
  relativeDirs.forEach(visit)
  return out
}

describe('production deployment security contract', () => {
  it('does not expose concrete production server entry details in public repo files', () => {
    const forbidden = [
      ['47', '81', '56', '131'].join('.'),
      ['admin', '47.81.56.131'].join('@'),
      ['/home', 'admin', 'oksskolten'].join('/'),
      ['/home', 'admin', 'deploy'].join('/'),
      ['MANGU', 'SSH', 'PRIVATE', 'KEY'].join('_'),
    ]
    const files = listTextFiles(['.github', 'scripts', 'docs', '.']).filter(file => {
      if (file.includes('node_modules/')) return false
      if (file.includes('.git/')) return false
      if (file === 'server/deployment-security.test.ts') return false
      if (file === 'scripts/deployment-security.test.ts') return false
      return ['.github/', 'scripts/', 'docs/', 'README.md', 'AGENTS.md'].some(prefix => file === prefix || file.startsWith(prefix))
    })

    const leaks = files.flatMap(file => {
      const content = read(file)
      return forbidden
        .filter(value => content.includes(value))
        .map(value => `${file}: ${value}`)
    })

    expect(leaks).toEqual([])
  })

  it('deploy workflow triggers a protected webhook instead of installing SSH credentials', () => {
    const workflow = read('.github/workflows/deploy-production.yaml')

    expect(workflow).toContain('PRODUCTION_DEPLOY_WEBHOOK_URL')
    expect(workflow).toContain('PRODUCTION_DEPLOY_WEBHOOK_SECRET')
    expect(workflow).toContain('PRODUCTION_DEPLOY_ACCESS_CLIENT_ID')
    expect(workflow).toContain('PRODUCTION_DEPLOY_ACCESS_CLIENT_SECRET')
    expect(workflow).toContain('scripts/trigger-production-deploy.sh')
    expect(workflow).not.toMatch(/ssh-keyscan|MANGU|REMOTE_HOST|SSH_PRIVATE_KEY|MANGU_SSH_PRIVATE_KEY/)
  })

  it('webhook trigger signs immutable image metadata and never contains a production target', () => {
    const trigger = read('scripts/trigger-production-deploy.sh')

    expect(trigger).toContain('openssl dgst -sha256 -hmac')
    expect(trigger).toContain('X-Oksskolten-Deploy-Signature')
    expect(trigger).toContain('CF-Access-Client-Id')
    expect(trigger).toContain('CF-Access-Client-Secret')
    expect(trigger).toContain('must be an HTTPS URL')
    expect(trigger).toContain('publish metadata field is required')
    expect(trigger).toContain('image_ref')
    expect(trigger).toContain('@sha256:')
    expect(trigger).not.toMatch(/ssh|REMOTE_HOST|47\.81\.56\.131|admin@/)
  })

  it('server-side deploy agent accepts only digest images and keeps health-checked rollback', () => {
    const agent = read('scripts/production-deploy-agent.sh')

    expect(agent).toContain('verify_signature')
    expect(agent).toContain('rollback_to_previous')
    expect(agent).toContain('wait_for_server_health')
    expect(agent).toContain('validate_health_json')
    expect(agent).toContain('wait_for_public_health')
    expect(agent).toContain('ensure_cloudflared_running')
    expect(agent).toContain('git_commit and build_date are required')
    expect(agent).toMatch(/@sha256:\[a-fA-F0-9\]\{64\}/)
    expect(agent).not.toMatch(/REMOTE_HOST|ssh |ssh-keyscan|MANGU_SSH_PRIVATE_KEY|restart cloudflared/)
  })

  it('server-side webhook adapter exposes only a narrow local deploy endpoint', () => {
    const webhook = read('scripts/production-deploy-webhook.py')

    expect(webhook).toContain('127.0.0.1')
    expect(webhook).toContain('OKSSKOLTEN_DEPLOY_WEBHOOK_PATH')
    expect(webhook).toContain('MAX_BODY_BYTES')
    expect(webhook).toContain('production-deploy-agent.sh')
    expect(webhook).toContain('HTTP_X_OKSSKOLTEN_DEPLOY_SIGNATURE')
    expect(webhook).not.toMatch(/REMOTE_HOST|ssh |ssh-keyscan|MANGU_SSH_PRIVATE_KEY/)
  })

  it('production compose does not publish the app on all host interfaces', () => {
    const compose = read('compose.prod.yaml')

    expect(compose).toContain('127.0.0.1:3000:3000')
    expect(compose).not.toContain('- "3000:3000"')
  })

  it('production tunnel can reach host-local app and webhook endpoints', () => {
    const compose = read('compose.prod.yaml')

    expect(compose).toContain('network_mode: host')
    expect(compose).toContain('networks: !reset []')
  })
})
