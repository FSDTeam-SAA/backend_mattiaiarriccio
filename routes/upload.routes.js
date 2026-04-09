import { Router } from 'express';
import upload from '../middlewares/upload.js';
import { uploadImage, deleteImage } from '../controllers/upload.controller.js';

const router = Router();

router.post('/', upload.single('image'), uploadImage);
router.delete('/:publicId', deleteImage);

export default router;
