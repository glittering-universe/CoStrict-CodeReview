import type { TokenUsage, ToolCall } from '../../../review/types'
import { PlatformOptions } from '../../types'
import { logger } from '../../utils/logger'
import type { PlatformProvider, ReviewComment, ThreadComment } from '../provider'

export const createWebProvider = (platformOption: PlatformOptions): PlatformProvider => {
  return {
    postReviewComment: async (
      _commentDetails: ReviewComment
    ): Promise<string | undefined> => {
      logger.info('Web provider skipping postReviewComment.')
      return undefined
    },
    postThreadComment: async (
      _commentDetails: ThreadComment
    ): Promise<string | undefined> => {
      logger.info('Web provider skipping postThreadComment.')
      return undefined
    },
    submitUsage: async (
      _tokenUsage: TokenUsage,
      _toolUsage: ToolCall[]
    ): Promise<void> => {
      logger.info('Web provider skipping submitUsage.')
    },
    getPlatformOption: (): PlatformOptions => platformOption,
    getRepoId: (): string => {
      if (platformOption === PlatformOptions.GITHUB) return 'github_repo_anonymous'
      return 'web_repo_anonymous'
    },
  }
}
