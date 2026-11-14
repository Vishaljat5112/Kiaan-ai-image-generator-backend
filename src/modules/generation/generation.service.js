import { prisma } from '../../config/database.js'
import { AssetsService } from '../assets/assets.service.js'

export class GenerationService {
  /**
   * Format a generation job for API responses
   */
  static formatJob(job) {
    let params = {}
    if (job.parametersJson) {
      if (typeof job.parametersJson === 'string') {
        try {
          params = JSON.parse(job.parametersJson)
        } catch {
          params = {}
        }
      } else {
        params = job.parametersJson
      }
    }

    return {
      id: job.id,
      userId: job.userId,
      type: job.type,
      status: job.status,
      modelId: job.modelId,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      parameters: params,
      creditCost: job.creditCost,
      executionTimeMs: job.executionTimeMs,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      assets: (job.assets || []).map(AssetsService.formatAsset)
    }
  }

  /**
   * List generation jobs for user with status and type filters
   */
  static async listJobs(userId, { status, type, page = 1, limit = 50 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
    const skip = (pageNum - 1) * limitNum

    const where = {
      userId
    }

    if (status && status !== 'all') {
      where.status = status.toUpperCase()
    }

    if (type && type !== 'all') {
      where.type = type.toUpperCase()
    }

    const [total, jobs] = await Promise.all([
      prisma.generationJob.count({ where }),
      prisma.generationJob.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          assets: {
            where: { deletedAt: null }
          }
        }
      })
    ])

    return {
      jobs: jobs.map(GenerationService.formatJob),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  /**
   * Get single job by ID
   */
  static async getJob(userId, jobId) {
    const job = await prisma.generationJob.findFirst({
      where: { id: jobId, userId },
      include: {
        assets: {
          where: { deletedAt: null }
        }
      }
    })

    if (!job) {
      const error = new Error('Generation job not found')
      error.statusCode = 404
      error.code = 'JOB_NOT_FOUND'
      throw error
    }

    return GenerationService.formatJob(job)
  }
}

export default GenerationService
