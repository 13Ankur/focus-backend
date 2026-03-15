import express from 'express';
import path from 'path';

const router = express.Router();

router.get('/app-ads.txt', (req, res) => {
  res.sendFile(path.resolve('./app-ads.txt'));
});

export default router;
