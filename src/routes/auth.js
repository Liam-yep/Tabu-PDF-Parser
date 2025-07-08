import { Router } from 'express';
import { authenticationMiddleware } from '../middlewares/authentication.js';
import * as authController from '../controllers/auth-controller.js';


const router = Router();

router.get('/auth', authenticationMiddleware, authController.authorize);
router.get('/auth/callback', authController.mondayCallback);

export default router; 