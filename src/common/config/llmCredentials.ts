import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getGitRoot } from '../git/getChangedFilesNames'

export type LlmCredentials = {
  openaiApiKey?: string
  openaiApiBase?: string
}

const normalizeBaseUrl = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/$/, '')
}

const normalizeApiKey = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed || undefined
}

const getDefaultCredentialPaths = async (): Promise<string[]> => {
  const paths: string[] = []

  if (process.env.SHIPPIE_LLM_CREDENTIALS_PATH) {
    paths.push(process.env.SHIPPIE_LLM_CREDENTIALS_PATH)
  }

  paths.push(join(homedir(), '.shippie', 'credentials.json'))

  try {
    const gitRoot = await getGitRoot()
    paths.push(join(gitRoot, '.shippie', 'credentials.json'))
  } catch {
    // ignore when not in a git repo
  }

  return paths
}

const parseCredentialsJson = (raw: string): LlmCredentials => {
  const parsed = JSON.parse(raw) as Record<string, unknown>

  const fromFlatKey = (key: string) =>
    typeof parsed[key] === 'string' ? (parsed[key] as string) : undefined

  const openaiSection =
    parsed.openai && typeof parsed.openai === 'object'
      ? (parsed.openai as Record<string, unknown>)
      : undefined

  const fromOpenaiKey = (key: string) =>
    typeof openaiSection?.[key] === 'string' ? (openaiSection[key] as string) : undefined

  return {
    openaiApiKey: normalizeApiKey(
      fromFlatKey('OPENAI_API_KEY') ?? fromOpenaiKey('apiKey') ?? fromOpenaiKey('api_key')
    ),
    openaiApiBase: normalizeBaseUrl(
      fromFlatKey('OPENAI_API_BASE') ??
        fromFlatKey('OPENAI_API_URL') ??
        fromOpenaiKey('baseUrl') ??
        fromOpenaiKey('baseURL') ??
        fromOpenaiKey('base_url')
    ),
  }
}

let cachedCredentialsPromise: Promise<LlmCredentials> | null = null

export const loadLlmCredentials = async (): Promise<LlmCredentials> => {
  if (!cachedCredentialsPromise) {
    cachedCredentialsPromise = (async () => {
      const paths = await getDefaultCredentialPaths()
      for (const candidate of paths) {
        if (!candidate || !existsSync(candidate)) continue
        try {
          const raw = await readFile(candidate, 'utf8')
          const creds = parseCredentialsJson(raw)
          return creds
        } catch {
          // ignore invalid config and continue
        }
      }
      return {}
    })()
  }

  return cachedCredentialsPromise
}

export const resolveLlmCredentials = async (): Promise<LlmCredentials> => {
  const fileCreds = await loadLlmCredentials()
  return {
    openaiApiKey: normalizeApiKey(process.env.OPENAI_API_KEY) ?? fileCreds.openaiApiKey,
    openaiApiBase:
      normalizeBaseUrl(process.env.OPENAI_API_BASE) ?? fileCreds.openaiApiBase,
  }
}

export const writeProjectCredentials = async (
  credentials: LlmCredentials
): Promise<void> => {
  const gitRoot = await getGitRoot()
  const configPath = join(gitRoot, '.shippie', 'credentials.json')
  const payload = {
    OPENAI_API_KEY: normalizeApiKey(credentials.openaiApiKey),
    OPENAI_API_BASE: normalizeBaseUrl(credentials.openaiApiBase),
  }

  await writeFile(configPath, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  })
  cachedCredentialsPromise = null
}
