import express from 'express';
import { authenticationMiddleware } from '../middlewares/authentication.js';
import * as mondayController from '../controllers/monday-controller.js';

const router = express.Router();

router.post('/monday/send_pdf', authenticationMiddleware, mondayController.sendPdf);

export default router;
