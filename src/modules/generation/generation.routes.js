import { Router } from 'express'
import { GenerationController } from './generation.controller.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

// All generation routes require authentication
router.use(authenticate)

router.get('/jobs', GenerationController.listJobs)
router.get('/jobs/:id', GenerationController.getJob)
router.get('/history', GenerationController.listJobs) // Alias for generation history

export default router
