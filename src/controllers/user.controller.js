import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";
import { notifyVehicleEvent } from "../services/notification.service.js";

// Get user profile
export const getUserProfile = async (req, res, next) => {
    try {
        // Support both URL param and token-based user ID
        const userId = req.params.id || req.user.id;

        const { data: user, error } = await supabase
            .from("users")
            .select("*")
            .eq("id", userId)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        res.status(200).json(user);
    } catch (error) {
        next(error);
    }
};

// Update user profile
export const updateUserProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { firstname, lastname, phone, address } = req.body;

        const { data: user, error } = await supabase
            .from("users")
            .update({
                firstname: firstname || null,
                lastname: lastname || null,
                phone: phone || null,
                address: address || null,
            })
            .eq("id", userId)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.status(200).json(user);
    } catch (error) {
        next(error);
    }
};

// Change password
export const changeUserPassword = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: "Current and new password are required" });
        }

        // Get user's email from database
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("email")
            .eq("id", userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Verify current password by attempting to sign in
        const { error: authError } = await supabase.auth.signInWithPassword({
            email: user.email,
            password: currentPassword,
        });

        if (authError) {
            return res.status(401).json({ error: "Current password is incorrect" });
        }

        // Update password in Supabase Auth
        const { error: updateError } = await supabase.auth.updateUser({
            password: newPassword,
        });

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        res.status(200).json({ message: "Password changed successfully" });
    } catch (error) {
        next(error);
    }
};

// Change email
export const changeUserEmail = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { newEmail, password } = req.body;

        if (!newEmail || !password) {
            return res.status(400).json({ error: "New email and password are required" });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(newEmail)) {
            return res.status(400).json({ error: "Invalid email format" });
        }

        // Get user's current email from database
        const { data: currentUser, error: userError } = await supabase
            .from("users")
            .select("email")
            .eq("id", userId)
            .single();

        if (userError || !currentUser) {
            return res.status(404).json({ error: "User not found" });
        }

        // Check if the new email is the same as current email
        if (currentUser.email === newEmail) {
            return res.status(400).json({ error: "New email is the same as current email" });
        }

        // Check if email already exists in users table (excluding current user)
        const { data: existingUser, error: existingError } = await supabase
            .from("users")
            .select("id, email")
            .eq("email", newEmail)
            .neq("id", userId)
            .maybeSingle();

        if (existingError) {
            return res.status(500).json({ error: existingError.message });
        }

        if (existingUser) {
            return res.status(409).json({ error: "Email already in use by another account" });
        }

        // Verify password before changing email
        const { error: authError } = await supabase.auth.signInWithPassword({
            email: currentUser.email,
            password: password,
        });

        if (authError) {
            return res.status(401).json({ error: "Incorrect password" });
        }

        // Update email in Supabase Auth
        const { error: updateError } = await supabase.auth.updateUser({
            email: newEmail,
        });

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        // Update email in users table
        const { error: dbUpdateError } = await supabase
            .from("users")
            .update({ email: newEmail })
            .eq("id", userId);

        if (dbUpdateError) {
            // Rollback Supabase Auth email if database update fails
            await supabase.auth.updateUser({
                email: currentUser.email,
            });
            return res.status(500).json({ error: "Failed to update email in database" });
        }

        res.status(200).json({ message: "Email changed successfully. Please check your new email for verification." });
    } catch (error) {
        next(error);
    }
};

// Get user's vehicles with maintenance records
export const getUserVehicles = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const offset = (page - 1) * limit;

        // Get total count for pagination info
        const { count, error: countError } = await supabase
            .from("assets")
            .select("*", { count: 'exact', head: true })
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle");

        if (countError) {
            return res.status(500).json({ error: countError.message });
        }

        // Fetch paginated vehicles
        const { data: vehicles, error: vehiclesError } = await supabase
            .from("assets")
            .select(`
                id,
                name,
                status,
                created_at,
                vehicle_details (
                    plate_number,
                    vin,
                    model,
                    year,
                    color
                )
            `)
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle")
            .range(offset, offset + limit - 1);

        if (vehiclesError) {
            return res.status(500).json({ error: vehiclesError.message });
        }

        // Get vehicle IDs for document and maintenance queries
        const vehicleIds = vehicles?.map(v => v.id) || [];

        // Fetch maintenance records for user's vehicles
        let maintenanceRecords = [];
        let documents = [];
        
        if (vehicleIds.length > 0) {
            const { data: maint, error: maintError } = await supabase
                .from("maintenance_records")
                .select("*")
                .in("asset_id", vehicleIds)
                .order("next_due", { ascending: true });

            if (maintError) {
                return res.status(500).json({ error: maintError.message });
            }
            maintenanceRecords = maint || [];

            // Fetch documents for user's vehicles
            const { data: docs, error: docsError } = await supabase
                .from("documents")
                .select("*")
                .in("asset_id", vehicleIds);

            if (docsError) {
                return res.status(500).json({ error: docsError.message });
            }
            documents = docs || [];
        }

        // Transform data to match frontend expectations
        const userVehicles = vehicles?.map(vehicle => {
            const vehicleMaintenance = maintenanceRecords
                .filter(m => m.asset_id === vehicle.id)
                .map(m => ({
                    id: m.id,
                    type: m.maintenance_type,
                    serviceCenter: m.service_center || "N/A",
                    cost: m.cost || 0,
                    lastServiceDate: m.last_service,
                    nextDueDate: m.next_due,
                    nextDueMileage: m.next_due_mileage,
                    currentMileageAtService: m.current_mileage,
                    reminderDaysBefore: m.reminder_days,
                    status: (() => {
                        if (!m.next_due) return "completed";
                        if (new Date(m.next_due) < new Date()) return "overdue";
                        const daysUntil = Math.ceil((new Date(m.next_due) - new Date()) / (1000 * 60 * 60 * 24));
                        if (daysUntil <= 30) return "upcoming";
                        return "completed";
                    })(),
                    history: m.history || []
                }));

            const vehicleDocs = documents.filter(d => d.asset_id === vehicle.id);
            
            // Calculate summary
            const now = new Date();
            const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            
            const documentsExpiringSoon = vehicleDocs.filter(d => {
                if (!d.expiry_date) return false;
                const expiryDate = new Date(d.expiry_date);
                return expiryDate > now && expiryDate <= thirtyDaysFromNow;
            }).length;
            
            const documentsOverdue = vehicleDocs.filter(d => {
                if (!d.expiry_date) return false;
                return new Date(d.expiry_date) < now;
            }).length;

            return {
                id: vehicle.id,
                name: vehicle.name || "",
                vehicleInfo: {
                    make: vehicle.vehicle_details?.[0]?.model || "",
                    model: vehicle.vehicle_details?.[0]?.model || "",
                    year: vehicle.vehicle_details?.[0]?.year || "",
                    vin: vehicle.vehicle_details?.[0]?.vin || "",
                    plateNumber: vehicle.vehicle_details?.[0]?.plate_number || "",
                    color: vehicle.vehicle_details?.[0]?.color || ""
                },
                status: vehicle.status,
                documents: vehicleDocs.map(d => ({
                    id: d.id,
                    type: d.name,
                    documentNumber: d.document_number || "",
                    issueDate: d.issue_date,
                    expiryDate: d.expiry_date,
                    status: (() => {
                        if (!d.expiry_date) return "active";
                        if (new Date(d.expiry_date) < now) return "expired";
                        const daysUntil = Math.ceil((new Date(d.expiry_date) - now) / (1000 * 60 * 60 * 24));
                        if (daysUntil <= 30) return "expiring_soon";
                        return "active";
                    })(),
                    reminderDaysBefore: d.reminder_days || 30,
                    lastRenewedOn: d.updated_at
                })),
                maintenanceRecords: vehicleMaintenance,
                summary: {
                    totalDocuments: vehicleDocs.length,
                    documentsExpiringSoon,
                    documentsOverdue,
                    maintenanceDueSoon: vehicleMaintenance.filter(m => m.status === "upcoming").length,
                    maintenanceOverdue: vehicleMaintenance.filter(m => m.status === "overdue").length
                }
            };
        }) || [];

        // Return paginated response
        res.status(200).json({
            vehicles: userVehicles,
            pagination: {
                total: count,
                page: page,
                limit: limit,
                totalPages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        next(error);
    }
};

// Get user's maintenance records with server-side pagination
export const getUserMaintenanceRecords = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const offset = (page - 1) * limit;

        // First, get all vehicle IDs assigned to the user
        const { data: vehicles, error: vehiclesError } = await supabase
            .from("assets")
            .select("id")
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle");

        if (vehiclesError) {
            return res.status(500).json({ error: vehiclesError.message });
        }

        const vehicleIds = vehicles?.map(v => v.id) || [];

        // Get total count of maintenance records for pagination info
        let count = 0;
        if (vehicleIds.length > 0) {
            const { count: recordCount, error: countError } = await supabase
                .from("maintenance_records")
                .select("*", { count: 'exact', head: true })
                .in("asset_id", vehicleIds);

            if (!countError) {
                count = recordCount;
            }
        }

        // Fetch paginated maintenance records
        let maintenanceRecords = [];
        if (vehicleIds.length > 0) {
            const { data: maint, error: maintError } = await supabase
                .from("maintenance_records")
                .select("*")
                .in("asset_id", vehicleIds)
                .order("next_due", { ascending: true })
                .range(offset, offset + limit - 1);

            if (maintError) {
                return res.status(500).json({ error: maintError.message });
            }
            maintenanceRecords = maint || [];
        }

        // Get vehicle details for the vehicles that have maintenance records
        const maintVehicleIds = [...new Set(maintenanceRecords.map(m => m.asset_id))];
        
        let vehicleDetailsMap = {};
        if (maintVehicleIds.length > 0) {
            const { data: vehicleDetails, error: vdError } = await supabase
                .from("assets")
                .select(`
                    id,
                    name,
                    vehicle_details (
                        plate_number,
                        model,
                        year,
                        color
                    )
                `)
                .in("id", maintVehicleIds);

            if (!vdError && vehicleDetails) {
                vehicleDetails.forEach(v => {
                    vehicleDetailsMap[v.id] = v;
                });
            }
        }

        // Transform data to match frontend expectations
        const transformedRecords = maintenanceRecords.map(m => {
            const vehicle = vehicleDetailsMap[m.asset_id];
            return {
                id: m.id,
                vehicleId: m.asset_id,
                type: m.maintenance_type,
                serviceCenter: m.service_center || "N/A",
                cost: m.cost || 0,
                lastServiceDate: m.last_service,
                nextDueDate: m.next_due,
                nextDueMileage: m.next_due_mileage,
                currentMileageAtService: m.current_mileage,
                reminderDaysBefore: m.reminder_days,
                status: (() => {
                    if (!m.next_due) return "completed";
                    if (new Date(m.next_due) < new Date()) return "overdue";
                    const daysUntil = Math.ceil((new Date(m.next_due) - new Date()) / (1000 * 60 * 60 * 24));
                    if (daysUntil <= 30) return "upcoming";
                    return "completed";
                })(),
                history: m.history || [],
                vehicleInfo: {
                    name: vehicle?.name || "",
                    make: vehicle?.vehicle_details?.[0]?.model || "",
                    model: vehicle?.vehicle_details?.[0]?.model || "",
                    year: vehicle?.vehicle_details?.[0]?.year || "",
                    plateNumber: vehicle?.vehicle_details?.[0]?.plate_number || "",
                    color: vehicle?.vehicle_details?.[0]?.color || ""
                }
            };
        });

        // Return paginated response
        res.status(200).json({
            maintenanceRecords: transformedRecords,
            pagination: {
                total: count,
                page: page,
                limit: limit,
                totalPages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        next(error);
    }
};

// Update user's maintenance record
export const updateUserMaintenance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { lastServiceDate, nextDueDate, notes } = req.body;

        // First, verify the maintenance record belongs to a vehicle assigned to this user
        const { data: maintenanceRecord, error: maintError } = await supabase
            .from("maintenance_records")
            .select("asset_id")
            .eq("id", id)
            .single();

        if (maintError || !maintenanceRecord) {
            return res.status(404).json({ error: "Maintenance record not found" });
        }

        // Verify the vehicle belongs to this user
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("id")
            .eq("id", maintenanceRecord.asset_id)
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle")
            .single();

        if (vehicleError || !vehicle) {
            return res.status(403).json({ error: "Access denied. This vehicle is not assigned to you." });
        }

        // Update the maintenance record
        const { data: updatedRecord, error: updateError } = await supabase
            .from("maintenance_records")
            .update({
                user_id: userId,
                last_service: lastServiceDate,
                next_due: nextDueDate,
                notes: notes || null
            })
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        // Send notification about the maintenance update
        await notifyVehicleEvent({
            assetId: maintenanceRecord.asset_id,
            type: "maintenance_update",
            title: "Maintenance Updated",
            message: "A maintenance has been performed"
        });

        res.status(200).json({
            message: "Maintenance record updated successfully",
            maintenance: updatedRecord
        });
    } catch (error) {
        next(error);
    }
};

// Add a new maintenance record for the user
export const addUserMaintenance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { vehicleId, name, lastServiceDate, nextServiceDate, maintenanceInterval, noteSummary } = req.body;

        if (!vehicleId || !name) {
            return res.status(400).json({ error: "Vehicle and maintenance type are required" });
        }

        // Verify the vehicle is assigned to this user
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("id")
            .eq("id", vehicleId)
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle")
            .maybeSingle();

        if (vehicleError || !vehicle) {
            return res.status(403).json({ error: "Access denied. This vehicle is not assigned to you." });
        }

        // Insert the Maintenance
        const { data: newMaintenance, error: maintError } = await supabase
            .from("maintenance_records")
            .insert({
                asset_id: vehicleId,
                maintenance_type: name,
                last_service: lastServiceDate || null,
                next_due: nextServiceDate || null,
                notes: noteSummary || null,
                reminder_days: maintenanceInterval ? parseInt(maintenanceInterval, 10) : null,
                performed_by: userId
            })
            .select()
            .single();

        if (maintError) {
            return res.status(500).json({ error: maintError.message });
        }

        res.status(201).json({
            message: "Maintenance Added Successfully",
            maintenance_record: newMaintenance
        });
    } catch (error) {
        next(error);
    }
};

// Get single vehicle by ID for user
export const getUserVehicleById = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        console.log("Fetching vehicle:", { id, userId });

        // Fetch the specific vehicle - use maybeSingle to handle no rows gracefully
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select(`
                id,
                name,
                status,
                created_at,
                vehicle_details (
                    plate_number,
                    vin,
                    model,
                    year,
                    staff_name,
                    color
                )
            `)
            .eq("id", id)
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle")
            .maybeSingle();

        if (vehicleError) {
            console.error("Vehicle query error:", vehicleError);
            return res.status(500).json({ error: "Failed to fetch vehicle: " + vehicleError.message });
        }

        if (!vehicle) {
            return res.status(404).json({ error: "Vehicle not found or access denied" });
        }

        // Fetch user assignment separately
        let assignmentData = { assignedToName: "", assignedDate: "" };
        const { data: assignment } = await supabase
            .from("user_assignments")
            .select("assigned_to_name, assigned_date")
            .eq("asset_id", id)
            .maybeSingle();
        
        if (assignment) {
            assignmentData = {
                assignedToName: assignment.assigned_to_name || "",
                assignedDate: assignment.assigned_date || ""
            };
        }

        // Fetch maintenance records
        const { data: maintenanceRecords, error: maintError } = await supabase
            .from("maintenance_records")
            .select("*")
            .eq("asset_id", id)
            .order("next_due", { ascending: true });

        if (maintError) {
            return res.status(500).json({ error: maintError.message });
        }

        // Fetch documents
        const { data: documents, error: docsError } = await supabase
            .from("documents")
            .select("*")
            .eq("asset_id", id);

        if (docsError) {
            return res.status(500).json({ error: docsError.message });
        }

        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Transform maintenance records
        const transformedMaintenance = (maintenanceRecords || []).map(m => ({
            id: m.id,
            type: m.maintenance_type,
            serviceCenter: m.service_center || "N/A",
            cost: m.cost || 0,
            lastServiceDate: m.last_service,
            nextDueDate: m.next_due,
            nextDueMileage: m.next_due_mileage,
            currentMileageAtService: m.current_mileage,
            reminderDaysBefore: m.reminder_days,
            status: (() => {
                if (!m.next_due) return "completed";
                if (new Date(m.next_due) < new Date()) return "overdue";
                const daysUntil = Math.ceil((new Date(m.next_due) - new Date()) / (1000 * 60 * 60 * 24));
                if (daysUntil <= 30) return "upcoming";
                return "completed";
            })(),
            history: m.history || []
        }));

        // Transform documents
        const transformedDocuments = (documents || []).map(d => ({
            id: d.id,
            type: d.name,
            documentNumber: d.document_number || "",
            issueDate: d.issue_date,
            expiryDate: d.expiry_date,
            status: (() => {
                if (!d.expiry_date) return "active";
                if (new Date(d.expiry_date) < now) return "expired";
                const daysUntil = Math.ceil((new Date(d.expiry_date) - now) / (1000 * 60 * 60 * 24));
                if (daysUntil <= 30) return "expiring_soon";
                return "active";
            })(),
            reminderDaysBefore: d.reminder_days || 30,
            lastRenewedOn: d.updated_at,
            history: d.history || []
        }));

        // Calculate summary
        const documentsExpiringSoon = transformedDocuments.filter(d => d.status === "expiring_soon").length;
        const documentsOverdue = transformedDocuments.filter(d => d.status === "expired").length;

        const response = {
            id: vehicle.id,
            name: vehicle.name || "",
            vehicleInfo: {
                make: vehicle.vehicle_details?.[0]?.model || "",
                model: vehicle.vehicle_details?.[0]?.model || "",
                year: vehicle.vehicle_details?.[0]?.year || "",
                staff_name: vehicle.vehicle_details?.[0]?.staff_name || "",
                vin: vehicle.vehicle_details?.[0]?.vin || "",
                plateNumber: vehicle.vehicle_details?.[0]?.plate_number || "",
                color: vehicle.vehicle_details?.[0]?.color || "",
                status: vehicle.status
            },
            assignment: {
                assignedToUserId: userId,
                assignedToName: assignmentData.assignedToName,
                assignedDate: assignmentData.assignedDate
            },
            documents: transformedDocuments,
            maintenanceRecords: transformedMaintenance,
            summary: {
                totalDocuments: transformedDocuments.length,
                documentsExpiringSoon,
                documentsOverdue,
                maintenanceDueSoon: transformedMaintenance.filter(m => m.status === "upcoming").length,
                maintenanceOverdue: transformedMaintenance.filter(m => m.status === "overdue").length
            }
        };

        res.status(200).json(response);
    } catch (error) {
        next(error);
    }
};

// Add a new vehicle for the user (self-service registration)
export const addUserVehicle = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { vehicle, documents, maintenance } = req.body;

        // Validate required fields
        if (!vehicle?.name || !vehicle?.plate_number || !vehicle?.vin || !vehicle?.staff_name || !vehicle?.staff_email) {
            return res.status(400).json({
                error: "Vehicle name, plate number, VIN number, Staff Name and Staff Email are required"
            });
        }

        // Get user's department
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("department_id")
            .eq("id", userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: "User not found" });
        }

        const departmentId = user.department_id;

        // Check for duplicate plate_number within the same department
        const { data: existingVehicles, error: duplicateError } = await supabase
            .from("vehicle_details")
            .select("id, plate_number, asset_id")
            .eq("plate_number", vehicle.plate_number);

        if (existingVehicles && existingVehicles.length > 0) {
            const vehicleIds = existingVehicles.map(v => v.asset_id);
            const { data: assets } = await supabase
                .from("assets")
                .select("id")
                .in("id", vehicleIds)
                .eq("department_id", departmentId);
            
            if (assets && assets.length > 0) {
                return res.status(400).json({
                    error: "A vehicle with this plate number already exists in your department"
                });
            }
        }

        // Insert asset - auto-assigned to the logged-in user
        const { data: newAsset, error: assetError } = await supabase
            .from("assets")
            .insert({
                department_id: departmentId,
                name: vehicle.name,
                asset_type: "vehicle",
                status: vehicle.status || "active",
                created_by: userId,
                assigned_user_id: userId  // Auto-assign to the user who added it
            })
            .select()
            .single();

        if (assetError) {
            return res.status(400).json({ error: assetError.message });
        }

        const assetId = newAsset.id;

        // Insert vehicle details
        const { error: vehicleError } = await supabase
            .from("vehicle_details")
            .insert({
                asset_id: assetId,
                plate_number: vehicle.plate_number,
                vin: vehicle.vin,
                staff_name: vehicle.staff_name,
                staff_email: vehicle.staff_email,
                model: vehicle.model,
                year: vehicle.year ? parseInt(vehicle.year, 10) : null,
                color: vehicle.color
            });

        if (vehicleError) {
            return res.status(400).json({ error: vehicleError.message });
        }

        // Insert documents
        if (documents && documents.length > 0) {
            const docs = documents
                .filter(doc => doc.name) // Only include documents with a name
                .map(doc => ({
                    asset_id: assetId,
                    name: doc.name,
                    // document_number: doc.number || null,
                    issue_date: doc.issueDate || null,
                    expiry_date: doc.expiryDate || null,
                    reminder_days: doc.reminder ? parseInt(doc.reminder, 10) : null
                }));
            
            if (docs.length > 0) {
                const { error: docsError } = await supabase.from("documents").insert(docs);
                if (docsError) {
                    return res.status(400).json({ error: "Failed to insert documents: " + docsError.message });
                }
            }
        }

        // Insert maintenance records
        if (maintenance && maintenance.length > 0) {
            const maint = maintenance
                .filter(item => item.type) // Only include maintenance with a type
                .map(item => ({
                    asset_id: assetId,
                    maintenance_type: item.type,
                    last_service: item.lastService || null,
                    next_due: item.nextDue || null,
                    reminder_days: item.interval ? parseInt(item.interval, 10) : null
                }));

            if (maint.length > 0) {
                const { error: maintError } = await supabase.from("maintenance_records").insert(maint);
                if (maintError) {
                    return res.status(400).json({ error: "Failed to insert maintenance: " + maintError.message });
                }
            }
        }

        res.status(201).json({
            message: "Vehicle added successfully",
            vehicleId: assetId
        });
    } catch (error) {
        next(error);
    }
};

// Update user's vehicle
export const updateUserVehicle = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { vehicle, documents, maintenance } = req.body;

        console.log("Updating vehicle:", { id, userId, vehicle });

        // First, verify the vehicle belongs to this user
        const { data: existingVehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("id, name, status")
            .eq("id", id)
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle")
            .maybeSingle();

        if (vehicleError) {
            return res.status(500).json({ error: "Failed to fetch vehicle: " + vehicleError.message });
        }

        if (!existingVehicle) {
            return res.status(404).json({ error: "Vehicle not found or access denied" });
        }

        // Update asset (name and status)
        if (vehicle) {
            const { error: assetUpdateError } = await supabase
                .from("assets")
                .update({
                    name: vehicle.name || existingVehicle.name,
                    status: vehicle.status || existingVehicle.status
                })
                .eq("id", id);

            if (assetUpdateError) {
                return res.status(400).json({ error: "Failed to update vehicle: " + assetUpdateError.message });
            }

            // Update vehicle_details
            const { error: detailsUpdateError } = await supabase
                .from("vehicle_details")
                .update({
                    plate_number: vehicle.plate_number || null,
                    vin: vehicle.vin || null,
                    staff_name: vehicle.staff_name || null,
                    staff_email: vehicle.staff_email || null,
                    model: vehicle.model || null,
                    year: vehicle.year ? parseInt(vehicle.year, 10) : null,
                    color: vehicle.color || null
                })
                .eq("asset_id", id);

            if (detailsUpdateError) {
                return res.status(400).json({ error: "Failed to update vehicle details: " + detailsUpdateError.message });
            }
        }

        // Update documents if provided
        if (documents && Array.isArray(documents)) {
            // Get existing document IDs
            const { data: existingDocs } = await supabase
                .from("documents")
                .select("id")
                .eq("asset_id", id);

            const existingDocIds = new Set(existingDocs?.map(d => d.id) || []);

            // Process each document
            for (const doc of documents) {
                if (doc.id && existingDocIds.has(doc.id)) {
                    // Update existing document
                    await supabase
                        .from("documents")
                        .update({
                            name: doc.name || null,
                            issue_date: doc.issueDate || null,
                            expiry_date: doc.expiryDate || null,
                            reminder_days: doc.reminder ? parseInt(doc.reminder, 10) : null
                        })
                        .eq("id", doc.id);
                } else if (doc.name) {
                    // Insert new document
                    await supabase
                        .from("documents")
                        .insert({
                            asset_id: id,
                            name: doc.name,
                            issue_date: doc.issueDate || null,
                            expiry_date: doc.expiryDate || null,
                            reminder_days: doc.reminder ? parseInt(doc.reminder, 10) : null
                        });
                }
            }
        }

        // Update maintenance records if provided
        if (maintenance && Array.isArray(maintenance)) {
            // Get existing maintenance IDs
            const { data: existingMaint } = await supabase
                .from("maintenance_records")
                .select("id")
                .eq("asset_id", id);

            const existingMaintIds = new Set(existingMaint?.map(m => m.id) || []);

            // Process each maintenance record
            for (const maint of maintenance) {
                if (maint.id && existingMaintIds.has(maint.id)) {
                    // Update existing maintenance
                    await supabase
                        .from("maintenance_records")
                        .update({
                            maintenance_type: maint.type || null,
                            last_service: maint.lastService || null,
                            next_due: maint.nextDue || null,
                            interval: maint.interval ? parseInt(maint.interval, 10) : null
                        })
                        .eq("id", maint.id);
                } else if (maint.type) {
                    // Insert new maintenance record
                    await supabase
                        .from("maintenance_records")
                        .insert({
                            asset_id: id,
                            maintenance_type: maint.type,
                            last_service: maint.lastService || null,
                            next_due: maint.nextDue || null,
                            interval: maint.interval ? parseInt(maint.interval, 10) : null
                        });
                }
            }
        }

        res.status(200).json({
            message: "Vehicle updated successfully",
            vehicleId: id
        });
    } catch (error) {
        next(error);
    }
};

// Get user's reminders - expiring documents and maintenance within 30 days and overdue items
export const getUserReminders = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const today = new Date();
        const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

        // First, get all vehicle IDs assigned to the user
        const { data: vehicles, error: vehiclesError } = await supabase
            .from("assets")
            .select("id")
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle");

        if (vehiclesError) {
            return res.status(500).json({ error: vehiclesError.message });
        }

        const vehicleIds = vehicles?.map(v => v.id) || [];

        // Get vehicle details for the vehicles
        let vehicleDetailsMap = {};
        if (vehicleIds.length > 0) {
            const { data: vehicleDetails, error: vdError } = await supabase
                .from("assets")
                .select(`
                    id,
                    name,
                    vehicle_details (
                        plate_number,
                        model,
                        year,
                        color
                    )
                `)
                .in("id", vehicleIds);

            if (!vdError && vehicleDetails) {
                vehicleDetails.forEach(v => {
                    vehicleDetailsMap[v.id] = v;
                });
            }
        }

        // Fetch all maintenance records for user's vehicles
        let maintenanceRecords = [];
        if (vehicleIds.length > 0) {
            const { data: maint, error: maintError } = await supabase
                .from("maintenance_records")
                .select("*")
                .in("asset_id", vehicleIds)
                .order("next_due", { ascending: true });

            if (maintError) {
                return res.status(500).json({ error: maintError.message });
            }
            maintenanceRecords = maint || [];
        }

        // Fetch all documents for user's vehicles
        let documents = [];
        if (vehicleIds.length > 0) {
            const { data: docs, error: docsError } = await supabase
                .from("documents")
                .select("*")
                .in("asset_id", vehicleIds);

            if (docsError) {
                return res.status(500).json({ error: docsError.message });
            }
            documents = docs || [];
        }

        // Filter maintenance: expiring within 30 days (not overdue)
        const maintenanceDue = maintenanceRecords
            .filter(m => {
                if (!m.next_due) return false;
                const nextDue = new Date(m.next_due);
                return nextDue >= today && nextDue <= thirtyDaysFromNow;
            })
            .map(m => {
                const vehicle = vehicleDetailsMap[m.asset_id];
                return {
                    id: m.id,
                    type: m.maintenance_type,
                    nextDueDate: m.next_due,
                    lastServiceDate: m.last_service,
                    category: 'maintenance',
                    vehicleId: m.asset_id,
                    vehicleInfo: {
                        make: vehicle?.vehicle_details?.[0]?.model || "",
                        model: vehicle?.vehicle_details?.[0]?.model || "",
                        year: vehicle?.vehicle_details?.[0]?.year || "",
                        plateNumber: vehicle?.vehicle_details?.[0]?.plate_number || "",
                        color: vehicle?.vehicle_details?.[0]?.color || ""
                    }
                };
            });

        // Filter maintenance: overdue
        const maintenanceOverdue = maintenanceRecords
            .filter(m => {
                if (!m.next_due) return false;
                const nextDue = new Date(m.next_due);
                return nextDue < today;
            })
            .map(m => {
                const vehicle = vehicleDetailsMap[m.asset_id];
                return {
                    id: m.id,
                    type: m.maintenance_type,
                    nextDueDate: m.next_due,
                    lastServiceDate: m.last_service,
                    category: 'maintenance',
                    vehicleId: m.asset_id,
                    vehicleInfo: {
                        make: vehicle?.vehicle_details?.[0]?.model || "",
                        model: vehicle?.vehicle_details?.[0]?.model || "",
                        year: vehicle?.vehicle_details?.[0]?.year || "",
                        plateNumber: vehicle?.vehicle_details?.[0]?.plate_number || "",
                        color: vehicle?.vehicle_details?.[0]?.color || ""
                    }
                };
            });

        // Filter documents: expiring within 30 days (not overdue)
        const documentsExpiring = documents
            .filter(d => {
                if (!d.expiry_date) return false;
                const expiryDate = new Date(d.expiry_date);
                return expiryDate >= today && expiryDate <= thirtyDaysFromNow;
            })
            .map(d => {
                const vehicle = vehicleDetailsMap[d.asset_id];
                return {
                    id: d.id,
                    type: d.name,
                    expiryDate: d.expiry_date,
                    issueDate: d.issue_date,
                    documentNumber: d.document_number || "",
                    category: 'document',
                    vehicleId: d.asset_id,
                    vehicleInfo: {
                        make: vehicle?.vehicle_details?.[0]?.model || "",
                        model: vehicle?.vehicle_details?.[0]?.model || "",
                        year: vehicle?.vehicle_details?.[0]?.year || "",
                        plateNumber: vehicle?.vehicle_details?.[0]?.plate_number || "",
                        color: vehicle?.vehicle_details?.[0]?.color || ""
                    }
                };
            });

        // Filter documents: overdue
        const documentsOverdue = documents
            .filter(d => {
                if (!d.expiry_date) return false;
                const expiryDate = new Date(d.expiry_date);
                return expiryDate < today;
            })
            .map(d => {
                const vehicle = vehicleDetailsMap[d.asset_id];
                return {
                    id: d.id,
                    type: d.name,
                    expiryDate: d.expiry_date,
                    issueDate: d.issue_date,
                    documentNumber: d.document_number || "",
                    category: 'document',
                    vehicleId: d.asset_id,
                    vehicleInfo: {
                        make: vehicle?.vehicle_details?.[0]?.model || "",
                        model: vehicle?.vehicle_details?.[0]?.model || "",
                        year: vehicle?.vehicle_details?.[0]?.year || "",
                        plateNumber: vehicle?.vehicle_details?.[0]?.plate_number || "",
                        color: vehicle?.vehicle_details?.[0]?.color || ""
                    }
                };
            });

        // Return all reminders data
        res.status(200).json({
            expiringDocuments: documentsExpiring,
            maintenanceDue: maintenanceDue,
            overdueItems: [
                ...documentsOverdue,
                ...maintenanceOverdue
            ]
        });
    } catch (error) {
        next(error);
    }
};

// Delete user's maintenance record
export const deleteUserMaintenance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        // First, verify the maintenance record exists
        const { data: maintenanceRecord, error: maintError } = await supabase
            .from("maintenance_records")
            .select("id, asset_id")
            .eq("id", id)
            .single();

        if (maintError || !maintenanceRecord) {
            return res.status(404).json({ error: "Maintenance record not found" });
        }

        // Verify the vehicle belongs to this user
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("id")
            .eq("id", maintenanceRecord.asset_id)
            .eq("assigned_user_id", userId)
            .eq("asset_type", "vehicle")
            .single();

        if (vehicleError || !vehicle) {
            return res.status(403).json({ error: "Access denied. This vehicle is not assigned to you." });
        }

        // Delete the maintenance record
        const { error: deleteError } = await supabase
            .from("maintenance_records")
            .delete()
            .eq("id", id);

        if (deleteError) {
            return res.status(500).json({ error: deleteError.message });
        }

        res.status(200).json({ message: "Maintenance record deleted successfully" });
    } catch (error) {
        next(error);
    }
};
