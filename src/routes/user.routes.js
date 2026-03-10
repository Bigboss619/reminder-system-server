import express from "express";
import { getUserProfile, updateUserProfile, changeUserPassword, getUserVehicles, getUserMaintenanceRecords, updateUserMaintenance, addUserMaintenance, deleteUserMaintenance, getUserVehicleById, addUserVehicle, updateUserVehicle, getUserReminders, batchUploadVehicles, getVehicleTemplate } from "../controllers/user.controller.js";
import { getUserDocuments, addUserDocument, renewUserDocument, getUserDocumentHistory, deleteUserDocument } from "../controllers/user.document.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
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

// All user routes require authentication
router.use(authenticate);

// Profile routes
router.get("/profile/:id", getUserProfile);
router.put("/profile", updateUserProfile);
router.put("/change-password", changeUserPassword);

// Vehicle and Maintenance routes
router.get("/vehicles", getUserVehicles);
router.get("/vehicles/template", getVehicleTemplate);
router.get("/vehicles/:id", getUserVehicleById);
router.post("/vehicles", addUserVehicle);
router.put("/vehicles/:id", updateUserVehicle);

// Batch upload routes
router.post("/vehicles/batch", upload.single("file"), batchUploadVehicles);

router.get("/maintenance", getUserMaintenanceRecords);
router.post("/maintenance", addUserMaintenance);
router.put("/maintenance/:id", updateUserMaintenance);
router.delete("/maintenance/:id", deleteUserMaintenance);

// Reminders route
router.get("/reminders", getUserReminders);

// Document routes
router.get("/documents", getUserDocuments);
router.post("/documents", addUserDocument);
router.put("/documents/:id/renew", renewUserDocument);
router.get("/documents/:id/history", getUserDocumentHistory);
router.delete("/documents/:id", deleteUserDocument);

export default router;
