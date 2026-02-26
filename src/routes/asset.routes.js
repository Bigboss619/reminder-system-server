import express from "express";
import {
  createAsset,
  getAllAssets
} from "../controllers/asset.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/", authenticate, createAsset);
router.get("/", authenticate, getAllAssets);

export default router;
