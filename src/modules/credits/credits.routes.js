import { Router } from 'express'
import { apiResponse } from '../../utils/apiResponse.js'

const router = Router()

router.get('/status', (req, res) => {
  return apiResponse.success(res, { module: 'credits', status: 'initialized' })
})

export default router
