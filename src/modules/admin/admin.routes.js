import { Router } from 'express'
import { apiResponse } from '../../utils/apiResponse.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'

const router = Router()

router.get('/status', (req, res) => {
  return apiResponse.success(res, { module: 'admin', status: 'initialized' })
})

// Protected administrative test route
router.get('/dashboard', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  return apiResponse.success(res, {
    message: 'Welcome to Admin Control Plane',
    admin: req.user
  })
})

export default router
