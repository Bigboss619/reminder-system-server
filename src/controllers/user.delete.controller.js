import { supabase } from "../config/supabase.js";

// Delete user's vehicle with cascade (documents, maintenance, etc.)
export const deleteUserVehicle = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log("Attempting to delete vehicle:", { id, userId });

    // Verify the vehicle belongs to this user
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("id, assigned_user_id")
      .eq("id", id)
      .eq("assigned_user_id", userId)
      .eq("asset_type", "vehicle")
      .single();

    if (assetError || !asset) {
      return res.status(404).json({ error: "Vehicle not found or access denied" });
    }

    console.log("Vehicle ownership verified. Starting cascade delete...");

    // Delete in correct order (handle foreign key dependencies)
    // 1. document_renewals
    try {
      await supabase.from("document_renewals").delete().eq("asset_id", id);
      console.log("Deleted document_renewals");
    } catch (err) {
      console.warn("document_renewals delete skipped:", err.message);
    }

    // 2. documents
    try {
      await supabase.from("documents").delete().eq("asset_id", id);
      console.log("Deleted documents");
    } catch (err) {
      console.error("Documents delete failed:", err.message);
      throw err;
    }

    // 3. maintenance_records
    try {
      await supabase.from("maintenance_records").delete().eq("asset_id", id);
      console.log("Deleted maintenance_records");
    } catch (err) {
      console.error("Maintenance delete failed:", err.message);
      throw err;
    }

    // 4. activity_logs (if exists)
    try {
      await supabase.from("activity_logs").delete().eq("asset_id", id);
      console.log("Deleted activity_logs");
    } catch (err) {
      console.warn("activity_logs delete skipped:", err.message);
    }

    // 5. vehicle_details
    try {
      await supabase.from("vehicle_details").delete().eq("asset_id", id);
      console.log("Deleted vehicle_details");
    } catch (err) {
      console.error("Vehicle_details delete failed:", err.message);
      throw err;
    }

    // 6. Finally delete the asset
    const { error } = await supabase
      .from("assets")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Assets delete failed:", error);
      throw error;
    }

    console.log("Vehicle deleted successfully");
    res.json({ message: "Vehicle and all related data deleted successfully" });
  } catch (err) {
    console.error("Delete vehicle error:", err);
    next(err);
  }
};

