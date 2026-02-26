import * as assetService from "../services/asset.service.js";

export const createAsset = async (req, res, next) => {
  try {
    const asset = await assetService.createAsset(req.body);
    res.status(201).json(asset);
  } catch (error) {
    next(error);
  }
};

export const getAllAssets = async (req, res, next) => {
  try {
    const assets = await assetService.getAllAssets();
    res.json(assets);
  } catch (error) {
    next(error);
  }
};
