import { GenerationService } from './generation.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class GenerationController {
  static async listJobs(req, res, next) {
    try {
      const { status, type, page, limit } = req.query
      const result = await GenerationService.listJobs(req.user.id, {
        status,
        type,
        page,
        limit
      })
      return apiResponse.success(res, result.jobs, 200, { pagination: result.pagination })
    } catch (error) {
      next(error)
    }
  }

  static async getJob(req, res, next) {
    try {
      const { id } = req.params
      const job = await GenerationService.getJob(req.user.id, id)
      return apiResponse.success(res, job, 200)
    } catch (error) {
      next(error)
    }
  }
}

export default GenerationController
