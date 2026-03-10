import { supabase } from "../config/supabase.js";
import { notifyVehicleEvent } from "../services/notification.service.js";

// Get all documents for the logged-in user
export const getUserDocuments = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // First, get all vehicles assigned to this user
        const { data: vehicles, error: vehiclesError } = await supabase
            .from("assets")
            .select("id, name, vehicle_details(plate_number, model)")
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle");

        if (vehiclesError) {
            return res.status(500).json({ error: vehiclesError.message });
        }

        const vehicleIds = vehicles?.map(v => v.id) || [];

        if (vehicleIds.length === 0) {
            return res.status(200).json({
                documents: [],
                pagination: {
                    total: 0,
                    page: page,
                    limit: limit,
                    totalPages: 0
                }
            });
        }

        // Get total count for pagination
        const { count, error: countError } = await supabase
            .from("documents")
            .select("*", { count: 'exact', head: true })
            .in("asset_id", vehicleIds);

        if (countError) {
            return res.status(500).json({ error: countError.message });
        }

        // Get paginated documents for user's vehicles
        const { data: documents, error: docsError } = await supabase
            .from("documents")
            .select("*")
            .in("asset_id", vehicleIds)
            .order("expiry_date", { ascending: true })
            .range(offset, offset + limit - 1);

        if (docsError) {
            return res.status(500).json({ error: docsError.message });
        }

        // Transform documents to include vehicle info
        const now = new Date();
        const transformedDocuments = (documents || []).map(doc => {
            const vehicle = vehicles?.find(v => v.id === doc.asset_id);
            return {
                id: doc.id,
                vehicleId: doc.asset_id,
                type: doc.name,
                // documentNumber: doc.document_number || "",
                issueDate: doc.issue_date,
                expiryDate: doc.expiry_date,
                status: (() => {
                    if (!doc.expiry_date) return "active";
                    if (new Date(doc.expiry_date) < now) return "expired";
                    const daysUntil = Math.ceil((new Date(doc.expiry_date) - now) / (1000 * 60 * 60 * 24));
                    if (daysUntil <= 30) return "expiring_soon";
                    return "active";
                })(),
                reminderDaysBefore: doc.reminder_days || 30,
                lastRenewedOn: doc.updated_at,
                history: [],
                vehicleInfo: {
                    name: vehicle?.name || "",
                    make: vehicle?.vehicle_details?.[0]?.model || "",
                    model: vehicle?.vehicle_details?.[0]?.model || "",
                    plateNumber: vehicle?.vehicle_details?.[0]?.plate_number || "",
                }
            };
        });

        // Return paginated response
        res.status(200).json({
            documents: transformedDocuments,
            pagination: {
                total: count || 0,
                page: page,
                limit: limit,
                totalPages: Math.ceil((count || 0) / limit)
            }
        });
    } catch (error) {
        next(error);
    }
};

// Add a new document for a vehicle
export const addUserDocument = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { vehicleId, name, issueDate, expiryDate, documentNumber } = req.body;

        if (!vehicleId || !name) {
            return res.status(400).json({ error: "Vehicle and document name are required" });
        }

        // Verify the vehicle belongs to this user and get its department_id
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("id, department_id")
            .eq("id", vehicleId)
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle")
            .maybeSingle();

        if (vehicleError || !vehicle) {
            return res.status(403).json({ error: "Access denied. This vehicle is not assigned to you." });
        }

        // Fetch department settings for document reminder days
        let reminderDays = 30;
        if (vehicle?.department_id) {
            const { data: settings, error: settingsError } = await supabase
                .from("department_settings")
                .select("document_reminder_days")
                .eq("department_id", vehicle.department_id)
                .maybeSingle();

            if (!settingsError && settings) {
                reminderDays = settings.document_reminder_days || 30;
            }
        }

        // Insert the document
        const { data: newDocument, error: docError } = await supabase
            .from("documents")
            .insert({
                asset_id: vehicleId,
                name: name,
                // document_number: documentNumber || null,
                issue_date: issueDate || null,
                expiry_date: expiryDate || null,
                reminder_days: reminderDays,
                uploaded_by: userId
            })
            .select()
            .single();

        if (docError) {
            return res.status(500).json({ error: docError.message });
        }

        res.status(201).json({
            message: "Document added successfully",
            document: newDocument
        });
    } catch (error) {
        next(error);
    }
};

// Renew a document (update expiry and add to document_renewals table)
export const renewUserDocument = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { issueDate, expiryDate } = req.body;

        if (!expiryDate) {
            return res.status(400).json({ error: "Expiry date is required" });
        }

        // First, get the existing document
        const { data: existingDoc, error: fetchError } = await supabase
            .from("documents")
            .select("*")
            .eq("id", id)
            .single();

        if (fetchError || !existingDoc) {
            return res.status(404).json({ error: "Document not found" });
        }

        // Verify the vehicle belongs to this user
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("assigned_user_id")
            .eq("id", existingDoc.asset_id)
            .maybeSingle();

        if (vehicleError || !vehicle || vehicle.assigned_user_id !== userId) {
            return res.status(403).json({ error: "Access denied. This document is not associated with your vehicle." });
        }

        // Insert renewal record into document_renewals table
        const { data: renewalRecord, error: renewalError } = await supabase
            .from("document_renewals")
            .insert({
                document_id: id,
                old_expiry: existingDoc.expiry_date,
                new_expiry: expiryDate,
                renewed_by: userId,
                renewed_at: new Date().toISOString()
            })
            .select()
            .single();

        if (renewalError) {
            return res.status(500).json({ error: "Failed to create renewal record: " + renewalError.message });
        }

        // Update the document with new dates
        const { data: updatedDoc, error: updateError } = await supabase
            .from("documents")
            .update({
                issue_date: issueDate || existingDoc.issue_date,
                expiry_date: expiryDate,
                updated_at: new Date().toISOString()
            })
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        // Send notification about the document update
        await notifyVehicleEvent({
            assetId: existingDoc.asset_id,
            type: "Car Document status",
            title: "Document Updated",
            message: "Your car document has been renewed."
        });

        res.status(200).json({
            message: "Document renewed successfully",
            document: updatedDoc,
            renewal: renewalRecord
        });
    } catch (error) {
        next(error);
    }
};

// Get document history from document_renewals table
export const getUserDocumentHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Get the document
        const { data: document, error } = await supabase
            .from("documents")
            .select("id, name, document_number, asset_id")
            .eq("id", id)
            .single();

        if (error || !document) {
            return res.status(404).json({ error: "Document not found" });
        }

        // Verify ownership by checking the asset
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("assigned_user_id")
            .eq("id", document.asset_id)
            .maybeSingle();

        if (vehicleError || !vehicle || vehicle.assigned_user_id !== userId) {
            return res.status(403).json({ error: "Access denied" });
        }

        // Fetch renewal history from document_renewals table
        const { data: renewals, error: renewalsError } = await supabase
            .from("document_renewals")
            .select("*")
            .eq("document_id", id)
            .order("renewed_at", { ascending: false });

        if (renewalsError) {
            return res.status(500).json({ error: renewalsError.message });
        }

        // Transform renewals to match expected history format
        const history = (renewals || []).map(r => ({
            issueDate: r.old_expiry, // Using previous expiry as reference
            expiryDate: r.new_expiry,
            renewedOn: r.renewed_at ? r.renewed_at.split('T')[0] : null,
            approvedBy: r.renewed_by
        }));

        res.status(200).json({
            id: document.id,
            type: document.name,
            documentNumber: document.document_number,
            history: history
        });
    } catch (error) {
        next(error);
    }
};

// Delete a document
export const deleteUserDocument = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // Get the document
        const { data: document, error: fetchError } = await supabase
            .from("documents")
            .select("id, asset_id")
            .eq("id", id)
            .single();

        if (fetchError || !document) {
            return res.status(404).json({ error: "Document not found" });
        }

        // Verify ownership
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("assigned_user_id")
            .eq("id", document.asset_id)
            .maybeSingle();

        if (vehicleError || !vehicle || vehicle.assigned_user_id !== userId) {
            return res.status(403).json({ error: "Access denied" });
        }

        // Delete renewal records first (foreign key constraint)
        await supabase
            .from("document_renewals")
            .delete()
            .eq("document_id", id);

        // Delete the document
        const { error: deleteError } = await supabase
            .from("documents")
            .delete()
            .eq("id", id);

        if (deleteError) {
            return res.status(500).json({ error: deleteError.message });
        }

        res.status(200).json({ message: "Document deleted successfully" });
    } catch (error) {
        next(error);
    }
};
