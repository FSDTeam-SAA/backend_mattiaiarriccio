import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  redeem,
  createCoupon,
  listCoupons,
  updateCoupon,
  deleteCoupon
} from '../controllers/coupon.controller.js';

// User-facing coupon router. Mount at: /api/v1/coupons
const userCouponRouter = Router();
userCouponRouter.use(requireAuth('user'));
userCouponRouter.post('/redeem', redeem);

// Admin coupon CRUD router. Mount at: /api/v1/admin/coupons
export const adminCouponRouter = Router();
adminCouponRouter.use(requireAuth('admin'));
adminCouponRouter.get('/', listCoupons);
adminCouponRouter.post('/', createCoupon);
adminCouponRouter.patch('/:couponId', updateCoupon);
adminCouponRouter.delete('/:couponId', deleteCoupon);

export default userCouponRouter;
