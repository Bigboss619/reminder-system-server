import express from "express";
import { createAdminUsersByAdmin, getAllUsersByAdmin, getCars, getCarById, updateCar, deleteCar, getAdminProfile, updateAdminProfile, changePassword, addVehicle, getAllDocuments, addDocument, getAllMaintenance, addMaintenance, getUserById, updateUserStatus, deleteUser, assignCarToUser, unassignCarFromUser, getAvailableCars, getNotifications, markNotificationRead, getDashboardStats } from "../controllers/admin.controller.js";
import { requireRole } from "../middlewares/requireRole.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { departmentGuard } from "../middlewares/departmentGuard.js";

const router = express.Router();


// Dashboard stats route
router.get("/dashboard-stats", authenticate, requireRole("admin"), departmentGuard, getDashboardStats);

// Profile routes - only need authentication and role check (no department guard needed)
router.get("/profile", authenticate, requireRole("admin"), getAdminProfile);

router.put("/profile", authenticate, requireRole("admin"), updateAdminProfile);

router.put("/change-password", authenticate, requireRole("admin"), changePassword);

// Other routes still use departmentGuard
router.post("/create-user", authenticate, requireRole("admin"), departmentGuard, createAdminUsersByAdmin);

// router.post("/cars", authenticate, requireRole("admin"), departmentGuard, createCar);

router.post("/vehicle", authenticate, requireRole("admin"), departmentGuard, addVehicle);

router.get("/users/:department", authenticate, requireRole("admin"), departmentGuard, getAllUsersByAdmin);

router.get("/users/detail/:id", authenticate, requireRole("admin"), departmentGuard, getUserById);

router.put("/users/:id/status", authenticate, requireRole("admin"), departmentGuard, updateUserStatus);

router.delete("/users/:id", authenticate, requireRole("admin"), departmentGuard, deleteUser);

// Car assignment routes
router.put("/users/:userId/assign-car", authenticate, requireRole("admin"), departmentGuard, assignCarToUser);

router.put("/cars/:carId/unassign", authenticate, requireRole("admin"), departmentGuard, unassignCarFromUser);

router.get("/available-cars", authenticate, requireRole("admin"), departmentGuard, getAvailableCars);

router.get("/cars", authenticate, requireRole("admin"), departmentGuard, getCars);

router.get("/cars/:id", authenticate, requireRole("admin"), departmentGuard, getCarById);

router.put("/cars/:id", authenticate, requireRole("admin"), departmentGuard, updateCar);

router.delete("/cars/:id", authenticate, requireRole("admin"), departmentGuard, deleteCar);

router.get("/documents", authenticate, requireRole("admin"), departmentGuard, getAllDocuments);

router.post("/documents", authenticate, requireRole("admin"), departmentGuard, addDocument);

router.get("/maintenance", authenticate, requireRole("admin"), departmentGuard, getAllMaintenance);

router.post("/maintenance", authenticate, requireRole("admin"), departmentGuard, addMaintenance);

// Notification routes
router.get("/notifications", authenticate, requireRole("admin"), departmentGuard, getNotifications);

router.put("/notifications/:id/read", authenticate, requireRole("admin"), departmentGuard, markNotificationRead);

export default router;
