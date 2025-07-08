import express from 'express';
import authRoutes from './auth.js';
import mondayRoutes from './monday.js';

const router = express.Router();

router.use(authRoutes);
router.use(mondayRoutes);

router.get('/', function (req, res) {
  res.json(getHealth());
});

router.get('/health', function (req, res) {
  res.json(getHealth());
});

function getHealth() {
  return {
    ok: true,
    message: 'Healthy',
  };
}

export default router;
