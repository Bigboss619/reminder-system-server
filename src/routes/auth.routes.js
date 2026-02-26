import express from "express";
import { adminLogin, userLogin } from "../controllers/auth.controller.js";

const router = express.Router();

router.post("/admin/login", adminLogin);
router.post("/user/login", userLogin);

export default router;
