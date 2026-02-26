import express from "express";
import { getUserProfile, updateUserProfile, changeUserPassword, getUserVehicles, getUserMaintenanceRecords, updateUserMaintenance, addUserMaintenance, deleteUserMaintenance, getUserVehicleById, addUserVehicle, updateUserVehicle, getUserReminders } from "../controllers/user.controller.js";
import { getUserDocuments, addUserDocument, renewUserDocument, getUserDocumentHistory, deleteUserDocument } from "../controllers/user.document.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

// All user routes require authentication
router.use(authenticate);

// Profile routes
router.get("/profile/:id", getUserProfile);
router.put("/profile", updateUserProfile);
router.put("/change-password", changeUserPassword);

// Vehicle and Maintenance routes
router.get("/vehicles", getUserVehicles);
router.get("/vehicles/:id", getUserVehicleById);
router.post("/vehicles", addUserVehicle);
router.put("/vehicles/:id", updateUserVehicle);
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
