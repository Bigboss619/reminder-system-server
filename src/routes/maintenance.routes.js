import { supabase } from "../config/supabase.js";

// Add a new maintenance for the logged-in user
export const addUserMaintenance = async (req, res, next) =>{
    try {
        const userId = req.user.id;
        const { vehilceId, name, lastServiceDate, nextServiceDate, maintenanceInterval, noteSummary } = req.body;

        if(!vehilceId || !name) {
            return res.status(400).json({ error: "Vehicle and maintenance type required" });
        }

        // Vefrify the vehicle is assigned to this user
        const { data: vehicle, error: VehicleError } = await
         supabase
         .from("assets")
         .select("id")
         .eq("id", vehilceId)
         .eq("assigned_user_id", userId)
         .eq("asset_type", "vehicle")
         .maybeSingle();

         if(VehicleError || !vehicle){
            return res.status(403).json({ error: "Access denied. This vehicle is not assigned to you." });
         }
        
        //  Insert the Maintenance
        const { data: newMaintenance, error: docError } = await
            supabase
            .from("maintenance_records")
            .insert({
                asset_id: vehilceId,
                maintenance_type: name,
                last_service: lastServiceDate || null,
                next_due: nextServiceDate || null,
                notes: noteSummary || null,
                interval: maintenanceInterval,
                performed_by: userId
            })
            .select()
            .single();
        if(docError){
            return res.status(500).json({ error: docError.message });
        }

        res.status(201).json({
            message: "Maintenance Added Successfully",
            maintenance_record: newMaintenance
        })
    } catch (error) {
        next(error);
    }
};