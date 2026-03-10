import express from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/requireRole.js";
import { departmentGuard } from "../middlewares/departmentGuard.js";
import { getSettings, saveSettings } from "../controllers/settings.controller.js";

const router = express.Router();

// Get department settings
router.get("/settings", authenticate, requireRole("admin"), departmentGuard, getSettings);

// Save department settings
router.put("/settings", authenticate, requireRole("admin"), departmentGuard, saveSettings);

export default router;

