import express from "express";
import { createAdminUsersByAdmin, getAllUsersByAdmin, getCars, getCarById, updateCar, deleteCar, getAdminProfile, updateAdminProfile, changePassword, addVehicle, getAllDocuments, addDocument, getAllMaintenance, addMaintenance, getUserById, updateUserStatus, deleteUser, assignCarToUser, unassignCarFromUser, getAvailableCars, getNotifications, markNotificationRead, getDashboardStats, batchUploadVehiclesAdmin, getVehicleTemplateAdmin } from "../controllers/admin.controller.js";
import { requireRole } from "../middlewares/requireRole.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { departmentGuard } from "../middlewares/departmentGuard.js";
import multer from "multer";

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        // Only accept Excel files
        const allowedTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel', // .xls
            'application/excel'
        ];
        if (allowedTypes.includes(file.mimetype) || 
            file.originalname.endsWith('.xlsx') || 
            file.originalname.endsWith('.xls')) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
        }
    }
});

const router = express.Router();

// Dashboard stats route
router.get("/dashboard-stats", authenticate, requireRole("admin", "audit"), departmentGuard, getDashboardStats);

// Profile routes - only need authentication and role check (no department guard needed)
router.get("/profile", authenticate, requireRole("admin", "audit"), getAdminProfile);

router.put("/profile", authenticate, requireRole("admin", "audit"), updateAdminProfile);

router.put("/change-password", authenticate, requireRole("admin", "audit"), changePassword);

// Other routes still use departmentGuard
router.post("/create-user", authenticate, requireRole("admin", "audit"), departmentGuard, createAdminUsersByAdmin);

// router.post("/cars", authenticate, requireRole("admin", "audit"), departmentGuard, createCar);

router.post("/vehicle", authenticate, requireRole("admin", "audit"), departmentGuard, addVehicle);

// Batch upload routes
router.get("/vehicle/template", authenticate, requireRole("admin", "audit"), departmentGuard, getVehicleTemplateAdmin);
router.post("/vehicle/batch", authenticate, requireRole("admin", "audit"), departmentGuard, upload.single("file"), batchUploadVehiclesAdmin);

router.get("/users/:department", authenticate, requireRole("admin", "audit"), departmentGuard, getAllUsersByAdmin);

router.get("/users/detail/:id", authenticate, requireRole("admin", "audit"), departmentGuard, getUserById);

router.put("/users/:id/status", authenticate, requireRole("admin", "audit"), departmentGuard, updateUserStatus);

router.delete("/users/:id", authenticate, requireRole("admin", "audit"), departmentGuard, deleteUser);

// Car assignment routes
router.put("/users/:userId/assign-car", authenticate, requireRole("admin", "audit"), departmentGuard, assignCarToUser);

router.put("/cars/:carId/unassign", authenticate, requireRole("admin", "audit"), departmentGuard, unassignCarFromUser);

router.get("/available-cars", authenticate, requireRole("admin", "audit"), departmentGuard, getAvailableCars);

router.get("/cars", authenticate, requireRole("admin", "audit"), departmentGuard, getCars);

router.get("/cars/:id", authenticate, requireRole("admin", "audit"), departmentGuard, getCarById);

router.put("/cars/:id", authenticate, requireRole("admin", "audit"), departmentGuard, updateCar);

router.delete("/cars/:id", authenticate, requireRole("admin", "audit"), departmentGuard, deleteCar);

router.get("/documents", authenticate, requireRole("admin", "audit"), departmentGuard, getAllDocuments);

router.post("/documents", authenticate, requireRole("admin", "audit"), departmentGuard, addDocument);

router.get("/maintenance", authenticate, requireRole("admin", "audit"), departmentGuard, getAllMaintenance);

router.post("/maintenance", authenticate, requireRole("admin", "audit"), departmentGuard, addMaintenance);

// Notification routes
router.get("/notifications", authenticate, requireRole("admin", "audit"), departmentGuard, getNotifications);

router.put("/notifications/:id/read", authenticate, requireRole("admin", "audit"), departmentGuard, markNotificationRead);

export default router;
