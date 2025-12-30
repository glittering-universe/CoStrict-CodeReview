import dotenv from 'dotenv'
import { logger } from '../utils/logger'

const isDotenvEnabled = (): boolean => {
  const raw = process.env.COSTRICT_LOAD_DOTENV
  if (!raw) return false
  return raw.toLowerCase() === 'true' || raw === '1'
}

export const loadDotenv = (): void => {
  if (!isDotenvEnabled()) return

  const result = dotenv.config()
  if (result.error) {
    logger.warn(`Failed to load .env: ${result.error.message}`)
  } else {
    logger.debug('Loaded environment variables from .env')
  }
}
