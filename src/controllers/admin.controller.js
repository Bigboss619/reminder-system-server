import { error } from "console";
import { supabase } from "../config/supabase.js";


export const createAdminUsersByAdmin = async (req, res, next) => {
    try {
        const { email, password, firstname, lastname, notes, role } = req.body;

        // Get logged-in admin
        const { data: currentUser, error: userError } = await supabase 
            .from("users")
            .select("department_id, role")
            .eq("id", req.user.id)
            .single();

            if(userError) throw userError;

        // Validate role - only allow user or audit
        const allowedRoles = ["user", "audit"];
        const userRole = allowedRoles.includes(role) ? role : "user";

        // Create Auth User
        const { data: authUser, error: authError } =
            await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true
            });
        
        // Handle specific auth errors with user-friendly messages
        if (authError) {
            if (authError.message && authError.message.toLowerCase().includes("email")) {
                return res.status(400).json({ 
                    error: "A user with this email address has already been registered" 
                });
            }
            throw authError;
        }

        // Insert into the users table
        const { error } = await supabase.from("users").insert([
            {
                id: authUser.user.id,
                firstname,
                lastname,
                email,
                role: userRole,
                department_id: currentUser.department_id,
                status: "active",
                notes
            }
        ]);

        if(error) throw error;

        res.status(201).json({ message: "User created successfully" });

    } catch (err) {
        next(err);
    }
};

export const getUserById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const adminDepartmentId = req.user.department_id;

        // Fetch user by ID
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (userError) {
            return res.status(500).json({ error: userError.message });
        }

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Verify user belongs to same department
        if (user.department_id !== adminDepartmentId) {
            return res.status(403).json({ error: "Access denied" });
        }

        // Fetch vehicles assigned to this user using assigned_user_id
        const { data: vehicles, error: vehiclesError } = await supabase
            .from("assets")
            .select(`
                id,
                name,
                status,
                created_at,
                vehicle_details (
                    reg_number,
                    model,
                    year_accquired,
                    color
                )
            `)
            .eq("assigned_user_id", id)
            .eq("asset_type", "vehicle");

        if (vehiclesError) throw vehiclesError;

        // Get vehicle IDs for document and maintenance queries
        const vehicleIds = vehicles?.map(v => v.id) || [];

        // Fetch documents for user's vehicles
        let documents = [];
        if (vehicleIds.length > 0) {
            const { data: docs, error: docsError } = await supabase
                .from("documents")
                .select("*")
                .in("asset_id", vehicleIds)
                .order("created_at", { ascending: false });

            if (docsError) throw docsError;
            documents = docs || [];
        }

        // Fetch maintenance records for user's vehicles
        let maintenance = [];
        if (vehicleIds.length > 0) {
            const { data: maint, error: maintError } = await supabase
                .from("maintenance_records")
                .select("*")
                .in("asset_id", vehicleIds)
                .order("created_at", { ascending: false });

            if (maintError) throw maintError;
            maintenance = maint || [];
        }

        // Fetch activity logs for user's vehicles (optional - table may not exist)
        let activity = [];
        if (vehicleIds.length > 0) {
            try {
                const { data: logs, error: logsError } = await supabase
                    .from("activity_logs")
                    .select("*")
                    .in("asset_id", vehicleIds)
                    .order("created_at", { ascending: false })
                    .limit(20);

                if (!logsError && logs) {
                    activity = logs;
                }
            } catch (activityError) {
                // Activity logs table may not exist, continue without it
                console.log("Activity logs not available:", activityError.message);
                activity = [];
            }
        }

        // Transform data to match frontend expectations
        const userDetails = {
            id: user.id,
            name: `${user.firstname} ${user.lastname}`,
            email: user.email,
            role: user.role || "Driver",
            status: user.status === "active" ? "Active" : "Inactive",
            joined: user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : "N/A",
            department: "Car",
            phone: user.phone || "",
            address: user.address || "",
            notes: user.notes || "",
            
            summary: {
                assignedCars: vehicles?.length || 0,
                documentsUploaded: documents.length,
                maintenanceRecords: maintenance.length,
                pendingActions: documents.filter(d => {
                    const daysUntilExpiry = Math.ceil((new Date(d.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
                    return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
                }).length
            },

            assignedCars: vehicles?.map(v => ({
                id: v.id,
                name: v.name,
                reg_number: v.vehicle_details?.[0]?.reg_number || "N/A",
                status: v.status === "active" ? "Active" : "Inactive",
                model: v.vehicle_details?.[0]?.model || "",
                year_accquired: v.vehicle_details?.[0]?.year_accquired || "",
                color: v.vehicle_details?.[0]?.color || ""
            })) || [],

            documents: documents.map(d => {
                const vehicle = vehicles?.find(v => v.id === d.asset_id);
                return {
                    id: d.id,
                    type: d.name,
                    car: vehicle?.name || "Unknown",
                    status: (() => {
                        if (!d.expiry_date) return "Unknown";
                        const daysUntilExpiry = Math.ceil((new Date(d.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
                        if (daysUntilExpiry < 0) return "Expired";
                        if (daysUntilExpiry <= 30) return "Expiring Soon";
                        return "Valid";
                    })(),
                    expiryDate: d.expiry_date,
                    issueDate: d.issue_date
                };
            }),

            maintenance: maintenance.map(m => {
                const vehicle = vehicles?.find(v => v.id === m.asset_id);
                return {
                    id: m.id,
                    type: m.maintenance_type,
                    car: vehicle?.name || "Unknown",
                    date: m.next_due,
                    status: (() => {
                        if (!m.next_due) return "Unknown";
                        if (new Date(m.next_due) < new Date()) return "Overdue";
                        const daysUntil = Math.ceil((new Date(m.next_due) - new Date()) / (1000 * 60 * 60 * 24));
                        if (daysUntil <= 7) return "Due Soon";
                        return "Upcoming";
                    })(),
                    lastService: m.last_service,
                    interval: m.interval
                };
            }),

            activity: activity.map(h => ({
                id: h.id,
                action: h.action,
                details: h.details,
                date: h.created_at,
                user: h.user_name || "System"
            }))
        };

        res.json(userDetails);
    } catch (err) {
        next(err);
    }
};

export const changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: "Current password and new password are required" });
        }
        
        // Get user email from database
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("email")
            .eq("id", userId)
            .single();
            
        if (userError || !user) {
            return res.status(404).json({ error: "User not found" });
        }
        
        // Verify current password against Supabase Auth
        const { error: verifyError } = await supabase.auth.signInWithPassword({
            email: user.email,
            password: currentPassword
        });
        
        if (verifyError) {
            return res.status(400).json({ error: "Current password is incorrect" });
        }
        
        // Change password using Supabase Auth
        const { error } = await supabase.auth.admin.updateUserById(
            userId,
            { password: newPassword }
        );
        
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        
        res.status(200).json({ message: "Password changed successfully" });
    } catch (err) {
        next(err);
    }
};

export const getAllUsersByAdmin = async (req, res, next) => {
    try {
        // Get logged-in admin's info
        const { data: currentUser, error: userError } = await supabase
            .from("users")
            .select("department_id, role")
            .eq("id", req.user.id)
            .single();
        
        if(userError) throw userError;
        
        // Fetch all users in the same department (excluding other admins)
        const { data: users, error } = await supabase
            .from("users")
            .select("*")
            .eq("department_id", currentUser.department_id)
            .neq("role", "admin");
        
        if(error) throw error;

        // Get all vehicles to count assigned cars per user
        const { data: vehicles, error: vehiclesError } = await supabase
            .from("assets")
            .select("id, assigned_user_id")
            .eq("department_id", currentUser.department_id)
            .eq("asset_type", "vehicle");

        if (vehiclesError) throw vehiclesError;

        // Count assigned cars per user
        const carCountMap = {};
        vehicles?.forEach(v => {
            if (v.assigned_user_id) {
                carCountMap[v.assigned_user_id] = (carCountMap[v.assigned_user_id] || 0) + 1;
            }
        });

        // Add assigned_cars count to each user
        const usersWithCarCount = users?.map(user => ({
            ...user,
            assigned_cars: carCountMap[user.id] || 0
        })) || [];

        res.json(usersWithCarCount);
    } catch (err) {
        next(err);
    }
};

export const updateUserStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const adminDepartmentId = req.user.department_id;

        if (!status || !["active", "inactive"].includes(status)) {
            return res.status(400).json({ error: "Valid status is required (active or inactive)" });
        }

        // Fetch user by ID to verify they exist and belong to same department
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("id, department_id")
            .eq("id", id)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Verify user belongs to same department
        if (user.department_id !== adminDepartmentId) {
            return res.status(403).json({ error: "Access denied" });
        }

        // Update user status
        const { error: updateError } = await supabase
            .from("users")
            .update({ status })
            .eq("id", id);

        if (updateError) throw updateError;

        res.json({ message: "User status updated successfully" });
    } catch (err) {
        next(err);
    }
};

export const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const adminDepartmentId = req.user.department_id;

        // Fetch user by ID to verify they exist and belong to same department
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("id, department_id")
            .eq("id", id)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Verify user belongs to same department
        if (user.department_id !== adminDepartmentId) {
            return res.status(403).json({ error: "Access denied" });
        }

        // Get all vehicles assigned to this user
        // const { data: userVehicles } = await supabase
        //     .from("assets")
        //     .select("id")
        //     .eq("assigned_user_id", id)
        //     .eq("asset_type", "vehicle");

        // const vehicleIds = userVehicles?.map(v => v.id) || [];

        // Delete related data for each vehicle
        // for (const vehicleId of vehicleIds) {
        //     // Delete document renewals
        //     await supabase
        //         .from("document_renewals")
        //         .delete()
        //         .eq("asset_id", vehicleId);

        //     // Delete documents
        //     await supabase
        //         .from("documents")
        //         .delete()
        //         .eq("asset_id", vehicleId);

        //     // Delete maintenance records
        //     await supabase
        //         .from("maintenance_records")
        //         .delete()
        //         .eq("asset_id", vehicleId);

        //     // Delete activity logs
        //     await supabase
        //         .from("activity_logs")
        //         .delete()
        //         .eq("asset_id", vehicleId);

        //     // Delete vehicle details
        //     await supabase
        //         .from("vehicle_details")
        //         .delete()
        //         .eq("asset_id", vehicleId);

        //     // Delete the vehicle asset
        //     await supabase
        //         .from("assets")
        //         .delete()
        //         .eq("id", vehicleId);
        // }

        // Delete any activity logs directly associated with the user
        await supabase
            .from("activity_logs")
            .delete()
            .eq("user_id", id);

        // Delete the user from users table
        const { error: deleteUserError } = await supabase
            .from("users")
            .delete()
            .eq("id", id);

        if (deleteUserError) throw deleteUserError;

        // Optionally delete from auth (this requires admin privileges in Supabase)
        try {
            await supabase.auth.admin.deleteUser(id);
        } catch (authError) {
            console.log("Auth user deletion skipped:", authError.message);
        }

        res.json({ message: "User and all related data deleted successfully" });
    } catch (err) {
        next(err);
    }
};

export const getCars = async (req, res, next) => {
  try {
    const department_id = req.user.department_id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Get total count
    const { count, error: countError } = await supabase
      .from("assets")
      .select("*", { count: 'exact', head: true })
      .eq("department_id", department_id)
      .eq("asset_type", "vehicle");

    if (countError) throw countError;

    // Query from assets table with pagination
    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select(`
        id,
        name,
        status,
        created_by,
        assigned_user_id,
        vehicle_details (
          id,
          reg_number,
          chassis_number,
          model,
          year_accquired,
          color
        )
      `)


      .eq("department_id", department_id)
      .eq("asset_type", "vehicle")
      .range(offset, offset + limit - 1);

    if (assetsError) throw assetsError;

    // Get all user IDs to fetch user details
    const userIds = [...new Set(assets?.map(a => a.assigned_user_id).filter(Boolean) || [])];
    
    let usersMap = {};
    if (userIds.length > 0) {
        const { data: users } = await supabase
            .from("users")
            .select("id, firstname, lastname")
            .in("id", userIds);

        if (users) {
            usersMap = users.reduce((acc, user) => {
                acc[user.id] = `${user.firstname} ${user.lastname}`;
                return acc;
            }, {});
        }
    }

    // Transform the data to match the expected format
    const cars = assets.map(asset => ({
      id: asset.id,
      name: asset.name,
      reg_number: asset.vehicle_details?.[0]?.reg_number || "",
      chassis_number: asset.vehicle_details?.[0]?.chassis_number || "",
      model: asset.vehicle_details?.[0]?.model || "",
      year: asset.vehicle_details?.[0]?.year || "",
      color: asset.vehicle_details?.[0]?.color || "",
      status: asset.status === "active" ? "Active" : "Inactive",
      documentStatus: "valid",
      maintenanceStatus: "upcoming",
      assigned_user_id: asset.assigned_user_id,
      assignedUser: asset.assigned_user_id ? usersMap[asset.assigned_user_id] || "Unknown" : "Not Assigned"
    }));

    res.json({
      cars,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    next(err);
  }
};

export const updateCar = async (req, res, next) => {
  try {
    const { id } = req.params;
    const department_id = req.user.department_id;
    const { vehicle, documents, maintenance } = req.body;

    // Update asset table
    if (vehicle) {
      const assetUpdate = {
        name: vehicle.name,
        status: vehicle.status
      };
      
      // Handle assigned_user_id if provided (for assignment changes)
      if (vehicle.assigned_user_id !== undefined) {
        assetUpdate.assigned_user_id = vehicle.assigned_user_id || null;
      }

      const { error: assetError } = await supabase
        .from("assets")
        .update(assetUpdate)
        .eq("id", id)
        .eq("department_id", department_id);

      if (assetError) throw assetError;

      // Update vehicle_details table
      const { error: vehicleDetailsError } = await supabase
        .from("vehicle_details")
        .update({
          reg_number: vehicle.reg_number,
          chassis_number: vehicle.chassis_number,
          staff_name: vehicle.staff_name || null,
          staff_email: vehicle.staff_email || null,
          model: vehicle.model,
          SBU: vehicle.SBU,
          year_accquired: vehicle.year_accquired || null,
          color: vehicle.color
        })
        .eq("asset_id", id);

      if (vehicleDetailsError) throw vehicleDetailsError;
    }

    // Handle documents if provided
    if (documents && Array.isArray(documents)) {
      // Get existing document IDs
      const { data: existingDocs } = await supabase
        .from("documents")
        .select("id")
        .eq("asset_id", id);

      const existingDocIds = existingDocs?.map(d => d.id) || [];
      const incomingDocIds = documents.filter(d => d.id).map(d => d.id);

      // Delete documents that are not in the incoming list
      const docsToDelete = existingDocIds.filter(docId => !incomingDocIds.includes(docId));
      if (docsToDelete.length > 0) {
        const { error: deleteDocsError } = await supabase
          .from("documents")
          .delete()
          .in("id", docsToDelete);
        
        if (deleteDocsError) throw deleteDocsError;
      }

      // Update or insert documents
      for (const doc of documents) {
        if (doc.id && existingDocIds.includes(doc.id)) {
          // Update existing document
          const { error: updateDocError } = await supabase
            .from("documents")
            .update({
              name: doc.name,
              issue_date: doc.issueDate,
              expiry_date: doc.expiryDate,
            //   reminder_days: doc.reminder ? parseInt(doc.reminder, 10) : null
            })
            .eq("id", doc.id);

          if (updateDocError) throw updateDocError;
        } else if (!doc.id) {
          // Insert new document
          const { error: insertDocError } = await supabase
            .from("documents")
            .insert({
              asset_id: id,
              name: doc.name,
              issue_date: doc.issueDate,
              expiry_date: doc.expiryDate,
            //   reminder_days: doc.reminder ? parseInt(doc.reminder, 10) : null
            });

          if (insertDocError) throw insertDocError;
        }
      }
    }

    // Handle maintenance if provided
    if (maintenance && Array.isArray(maintenance)) {
      // Get existing maintenance IDs
      const { data: existingMaint } = await supabase
        .from("maintenance_records")
        .select("id")
        .eq("asset_id", id);

      const existingMaintIds = existingMaint?.map(m => m.id) || [];
      const incomingMaintIds = maintenance.filter(m => m.id).map(m => m.id);

      // Delete maintenance records that are not in the incoming list
      const maintToDelete = existingMaintIds.filter(maintId => !incomingMaintIds.includes(maintId));
      if (maintToDelete.length > 0) {
        const { error: deleteMaintError } = await supabase
          .from("maintenance_records")
          .delete()
          .in("id", maintToDelete);
        
        if (deleteMaintError) throw deleteMaintError;
      }

      // Update or insert maintenance records
      for (const maint of maintenance) {
        if (maint.id && existingMaintIds.includes(maint.id)) {
          // Update existing maintenance
          const { error: updateMaintError } = await supabase
            .from("maintenance_records")
            .update({
              maintenance_type: maint.type,
              last_service: maint.lastService,
              next_due: maint.nextDue,
            //   reminder_days: maint.interval ? parseInt(maint.interval, 10) : null
            })
            .eq("id", maint.id);

          if (updateMaintError) throw updateMaintError;
        } else if (!maint.id) {
          // Insert new maintenance
          const { error: insertMaintError } = await supabase
            .from("maintenance_records")
            .insert({
              asset_id: id,
              maintenance_type: maint.type,
              last_service: maint.lastService,
              next_due: maint.nextDue,
            //   interval: maint.interval ? parseInt(maint.interval, 10) : null
            });

          if (insertMaintError) throw insertMaintError;
        }
      }
    }

    res.json({ message: "Vehicle updated successfully" });
  } catch (err) {
    next(err);
  }
};

export const updateAdminUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { firstname, lastname, email, role, status, notes, password } = req.body;
        const adminDepartmentId = req.user.department_id;

        if (!firstname || !lastname || !email) {
            return res.status(400).json({ error: "firstname, lastname, and email are required" });
        }

        // Validate role
        const allowedRoles = ["user", "audit"];
        if (role && !allowedRoles.includes(role)) {
            return res.status(400).json({ error: "Invalid role. Must be user or audit" });
        }

        // Validate status
        if (!["active", "inactive"].includes(status)) {
            return res.status(400).json({ error: "Status must be active or inactive" });
        }

        // Fetch user to verify existence and department
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("id, department_id, email")
            .eq("id", id)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: "User not found" });
        }

        if (user.department_id !== adminDepartmentId) {
            return res.status(403).json({ error: "Access denied" });
        }

        // Check if email is changing and already exists
        if (email !== user.email) {
            const { data: existingUser } = await supabase
                .from("users")
                .select("id")
                .eq("email", email)
                .neq("id", id)
                .maybeSingle();

            if (existingUser) {
                return res.status(409).json({ error: "Email already in use by another user" });
            }
        }

        // Build update object
        const updateData = {
            firstname,
            lastname,
            email,
            role: role || user.role,
            status,
            notes: notes || null
        };

        // Update users table
        const { data: updatedUser, error: updateError } = await supabase
            .from("users")
            .update(updateData)
            .eq("id", id)
            .select()
            .single();

        if (updateError) throw updateError;

        // Update Supabase auth email if changed
        if (email !== user.email) {
            const { error: authEmailError } = await supabase.auth.admin.updateUserById(id, {
                email
            });
            if (authEmailError) {
                console.error("Auth email update failed:", authEmailError.message);
                // Continue without failing the whole update
            }
        }

        // Update auth password if provided
        if (password) {
            const { error: authError } = await supabase.auth.admin.updateUserById(id, {
                password
            });

            if (authError) {
                console.error("Password update failed:", authError.message);
                // Continue without failing the whole update
            }
        }

        res.json({ 
            message: "User updated successfully",
            user: updatedUser 
        });
    } catch (err) {
        next(err);
    }
};

export const getAdminProfile = async (req, res, next) => {
    try {
        const adminId = req.user.id;

        const { data, error } = await supabase
            .from("users")
            .select("id, firstname, lastname, email, role, department_id, phone, address")
            .eq("id", adminId)
            .single();

        if(error || !data){
            return res.status(404).json({ error: "Admin profile not found" });
        }
        res.status(200).json(data);
    } catch (err) {
        next(err);
    }
};

export const updateAdminProfile = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { firstname, lastname, email, phone, address, date_of_birth } = req.body;
        
        // Fetch current user data to check for email changes
        const { data: currentUser, error: fetchError } = await supabase
            .from("users")
            .select("email")
            .eq("id", adminId)
            .single();
            
        if (fetchError) {
            return res.status(500).json({ error: "Failed to fetch current profile" });
        }

        // Build update object with only provided fields
        const updateData = {};
        if (firstname !== undefined) updateData.firstname = firstname;
        if (lastname !== undefined) updateData.lastname = lastname;
        if (phone !== undefined) updateData.phone = phone;
        if (address !== undefined) updateData.address = address;
        if (date_of_birth !== undefined) updateData.date_of_birth = date_of_birth;

        let emailChanged = false;
        if (email !== undefined && email !== currentUser.email) {
            // Check if new email already exists (excluding self)
            const { data: existingUser } = await supabase
                .from("users")
                .select("id")
                .eq("email", email)
                .neq("id", adminId)
                .maybeSingle();

            if (existingUser) {
                return res.status(409).json({ error: "Email already in use by another user" });
            }
            
            updateData.email = email;
            emailChanged = true;
        }

        // Update users table
        const { data: updatedUser, error: updateError } = await supabase
            .from("users")
            .update(updateData)
            .eq("id", adminId)
            .select()
            .single();
            
        if (updateError) {
            return res.status(400).json({ error: updateError.message });
        }

        // Update Supabase auth email if changed
        if (emailChanged) {
            const { error: authEmailError } = await supabase.auth.admin.updateUserById(adminId, {
                email: email
            });
            if (authEmailError) {
                console.error("Auth email update failed:", authEmailError.message);
                // Don't fail the whole update, log and continue
            }
        }

        res.status(200).json({
            message: "Profile updated successfully",
            user: updatedUser,
        });
    } catch (err) {
        next(err);
    }
};

export const deleteCar = async (req, res, next) => {
  try {
    const { id } = req.params;
    const department_id = req.user.department_id;

    // First verify the vehicle belongs to this department
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("id")
      .eq("id", id)
      .eq("department_id", department_id)
      .single();

    if (assetError || !asset) {
      return res.status(404).json({ error: "Vehicle not found or access denied" });
    }

    // Delete document_renewals first (foreign key dependency)
    await supabase
      .from("document_renewals")
      .delete()
      .eq("asset_id", id);

    // Delete documents
    await supabase
      .from("documents")
      .delete()
      .eq("asset_id", id);

    // Delete maintenance records
    await supabase
      .from("maintenance_records")
      .delete()
      .eq("asset_id", id);

    // Delete vehicle details
    await supabase
      .from("vehicle_details")
      .delete()
      .eq("asset_id", id);

    // Finally delete the asset itself
    const { error } = await supabase
      .from("assets")
      .delete()
      .eq("id", id)
      .eq("department_id", department_id);

    if (error) throw error;

    res.json({ message: "Vehicle and all related data deleted successfully" });
  } catch (err) {
    next(err);
  }
};

export const getCarById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const department_id = req.user.department_id;

    // Fetch the asset (vehicle)
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select(`
        id,
        name,
        status,
        created_by,
        assigned_user_id,
        created_at,
        vehicle_details (
          id,
          reg_number,
          chassis_number,
          model,
          staff_name,
          staff_email,
          year_accquired,
          SBU,
          color
        )
      `)

      .eq("id", id)
      .eq("department_id", department_id)
      .eq("asset_type", "vehicle")
      .single();

    if (assetError) throw assetError;
    if (!asset) {
      return res.status(404).json({ error: "Vehicle not found" });
    }

    // Fetch assigned user using assigned_user_id
    let assignedUser = "Not Assigned";
    if (asset.assigned_user_id) {
      const { data: user } = await supabase
        .from("users")
        .select("firstname, lastname")
        .eq("id", asset.assigned_user_id)
        .single();
      if (user) {
        assignedUser = `${user.firstname} ${user.lastname}`;
      }
    }

    // Fetch documents
    const { data: documents } = await supabase
      .from("documents")
      .select("*")
      .eq("asset_id", id)
      .order("created_at", { ascending: false });

    // Fetch maintenance records
    const { data: maintenance } = await supabase
      .from("maintenance_records")
      .select("*")
      .eq("asset_id", id)
      .order("created_at", { ascending: false });

    // Fetch activity/history (optional - table may not exist)
    let history = [];
    try {
      const { data: historyData, error: historyError } = await supabase
        .from("activity_logs")
        .select("*")
        .eq("asset_id", id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!historyError && historyData) {
        history = historyData;
      }
    } catch (historyFetchError) {
      console.log("Activity history not available:", historyFetchError.message);
      history = [];
    }

    // Transform the data to match the expected format
        const car = {
      id: asset.id,
      name: asset.name,
      model: asset.vehicle_details?.[0]?.model || "",
      SBU: asset.vehicle_details?.[0]?.SBU || "",
      reg_number: asset.vehicle_details?.[0]?.reg_number || "",
      chassis_number: asset.vehicle_details?.[0]?.chassis_number || "",
      staff_email: asset.vehicle_details?.[0]?.staff_email || "",
      staff_name: asset.vehicle_details?.[0]?.staff_name || "",
      year_accquired: asset.vehicle_details?.[0]?.year_accquired || "",
      color: asset.vehicle_details?.[0]?.color || "",
      status: asset.status === "active" ? "Active" : "Inactive",
      assignedUser: assignedUser,
      assigned_user_id: asset.assigned_user_id,
      createdAt: asset.created_at,
      summary: {
        totalDocuments: documents?.length || 0,
        expiringSoon: documents?.filter(d => {
          const daysUntilExpiry = Math.ceil((new Date(d.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
          return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
        }).length || 0,
        maintenanceDue: maintenance?.filter(m => {
          if (!m.next_due) return false;
          return new Date(m.next_due) <= new Date();
        }).length || 0,
        overdue: maintenance?.filter(m => {
          if (!m.next_due) return false;
          return new Date(m.next_due) < new Date();
        }).length || 0
      },
      documents: documents?.map(doc => ({
        id: doc.id,
        name: doc.name,
        issueDate: doc.issue_date,
        expiryDate: doc.expiry_date,
        reminder: doc.reminder_days
      })) || [],
      maintenance: maintenance?.map(m => ({
        id: m.id,
        type: m.maintenance_type,
        lastService: m.last_service,
        interval: m.interval,
        nextDue: m.next_due
      })) || [],
      history: history?.map(h => ({
        id: h.id,
        action: h.action,
        details: h.details,
        date: h.created_at,
        user: h.user_name || "System"
      })) || []
    };

    res.json(car);
  } catch (err) {
    next(err);
  }
};

// Helper function to generate asset code (NEP/VH/00001)


export const addVehicle = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { vehicle, documents, maintenance, department_id } = req.body;

        if(!vehicle?.name || !vehicle?.reg_number || !vehicle?.chassis_number){
            return res.status(400).json({
error: "Vehicle name, plate number and chassis number are required"
            });
        }

        const departmentId = req.user.department_id;
        
        if (!departmentId) {
            return res.status(400).json({
                error: "Admin department not found"
            });
        }

        // Check for duplicate plate_number within the same department
        const { data: existingVehicles, error: duplicateError } = await supabase
            .from("vehicle_details")
            .select("id, reg_number, asset_id")
            .eq("reg_number", vehicle.reg_number);

        if (existingVehicles && existingVehicles.length > 0) {
            const vehicleIds = existingVehicles.map(v => v.asset_id);
            const { data: assets } = await supabase
                .from("assets")
                .select("id")
                .in("id", vehicleIds)
                .eq("department_id", departmentId);
            
            if (assets && assets.length > 0) {
                return res.status(400).json({
                    error: "A vehicle with this Reg Number already exists in your department"
                });
            }
        }

// Insert asset (no asset_code)
        const { data: newAsset, error: assetError } = await supabase
            .from("assets")
            .insert({
                department_id: departmentId,
                name: vehicle.name,
                asset_type: "vehicle",
                status: vehicle.status || "active",
                created_by: adminId,
                assigned_user_id: vehicle.assigned_user_id || null
            })
            .select()
            .single();
        if(assetError){
            console.error(`addVehicle assetError:`, assetError);
            return res.status(400).json({ error: assetError.message });
        }

        const assetId = newAsset.id;

        // Insert vehicle details
        const { error: vehicleError } = await supabase
            .from("vehicle_details")
            .insert({
                asset_id: assetId,
                reg_number: vehicle.reg_number,
                chassis_number: vehicle.chassis_number,
                staff_name: vehicle.staff_name,
                staff_email: vehicle.staff_email,
                model: vehicle.model,
                year_accquired: vehicle.year_accquired,
                SBU: vehicle.SBU,
                color: vehicle.color
            });
        if(vehicleError){
            return res.status(400).json({ error: vehicleError.message });
        }

        // Insert documents
        if(documents?.length){
            const docs = documents.map(doc => ({
                asset_id: assetId,
                name: doc.name,
                issue_date: doc.issueDate || null,
                expiry_date: doc.expiryDate || null,
                reminder_days: doc.reminder ? parseInt(doc.reminder, 10) : null
            }));
            
            const { error: docsError } = await supabase.from("documents").insert(docs);
            if(docsError){
                return res.status(400).json({ error: "Failed to insert documents: " + docsError.message });
            }
        }

        // Insert maintenance
        if(maintenance?.length){
            const maint = maintenance.map(item => ({
                asset_id: assetId,
                maintenance_type: item.type,
                last_service: item.lastService || null,
                next_due: item.nextDue || null,
                reminder_days: parseInt(item.interval, 10)
            }));

            const { error: maintError } = await supabase.from("maintenance_records").insert(maint);
            if(maintError){
                return res.status(400).json({ error: "Failed to insert maintenance: " + maintError.message });
            }
        }

res.status(201).json({
            message: "Vehicle added successfully"
        });
    } catch (err) {
        next(err);
    }
};

export const getAllDocuments = async (req, res, next) => {
    try {
        const department_id = req.user.department_id;

        // Fetch all documents with their associated vehicle information
        const { data: documents, error } = await supabase
            .from("documents")
            .select(`
                id,
                name,
                issue_date,
                expiry_date,
                reminder_days,
                asset_id,
                assets (
                    id,
                    name,
                    department_id,
                    vehicle_details (
                        reg_number
                    )
                )
            `)
            .eq("assets.department_id", department_id);

        if (error) throw error;

        // Transform the data to match the frontend expectations
        const transformedDocuments = documents.map(doc => ({
            id: doc.id,
            carName: doc.assets?.name || "Unknown",
            car: doc.assets ? {
                name: doc.assets.name,
                // asset_code: doc.assets.asset_code || "",
                reg_number: doc.assets.vehicle_details?.[0]?.reg_number || ""
            } : null,
            // asset_code: doc.assets?.asset_code || "",
            // plateNumber: doc.assets?.vehicle_details?.[0]?.plate_number || "",
            reg_number: doc.assets?.vehicle_details?.[0]?.reg_number || "",
            documentType: doc.name,
            name: doc.name,
            issueDate: doc.issue_date,
            issue_date: doc.issue_date,
            expiryDate: doc.expiry_date,
            expiry_date: doc.expiry_date
        }));

        res.json(transformedDocuments);
    } catch (err) {
        next(err);
    }
};

// Helper function to get department settings
const getDepartmentSettings = async (department_id) => {
    try {
        const { data: settings, error } = await supabase
            .from("department_settings")
            .select("document_reminder_days, maintenance_reminder_days")
            .eq("department_id", department_id)
            .maybeSingle();
        
        if (error) throw error;
        
        return {
            documentReminderDays: settings?.document_reminder_days || 30,
            maintenanceReminderDays: settings?.maintenance_reminder_days || 7
        };
    } catch (err) {
        console.log("Error fetching settings:", err.message);
        return {
            documentReminderDays: 30,
            maintenanceReminderDays: 7
        };
    }
};

export const addDocument = async (req, res, next) => {
    try {
        const { carId, documentName, issueDate, expiryDate, reminder } = req.body;
        const department_id = req.user.department_id;

        if (!carId || !documentName || !issueDate || !expiryDate) {
            return res.status(400).json({ 
                error: "Car, document name, issue date, and expiry date are required" 
            });
        }

        // Verify the vehicle belongs to the admin's department
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("id, name")
            .eq("id", carId)
            .eq("department_id", department_id)
            .eq("asset_type", "vehicle")
            .single();

        if (vehicleError || !vehicle) {
            return res.status(404).json({ error: "Vehicle not found or access denied" });
        }

        // Get department settings for default reminder days
        const settings = await getDepartmentSettings(department_id);
        
        // Use reminder from request if provided, otherwise use default from settings
        const reminderDays = reminder ? parseInt(reminder, 10) : settings.documentReminderDays;

        // Insert the document
        const { data: newDocument, error: documentError } = await supabase
            .from("documents")
            .insert({
                asset_id: carId,
                name: documentName,
                issue_date: issueDate,
                expiry_date: expiryDate,
                reminder_days: reminderDays
            })
            .select()
            .single();

        if (documentError) throw documentError;

        res.status(201).json({
            message: "Document added successfully",
            document: newDocument
        });
    } catch (err) {
        next(err);
    }
};

export const getAllMaintenance = async (req, res, next) => {
    try {
        const department_id = req.user.department_id;

        // Fetch all maintenance records with their associated vehicle information
        const { data: maintenance, error } = await supabase
            .from("maintenance_records")
            .select(`
                id,
                maintenance_type,
                last_service,
                next_due,
                reminder_days,
                asset_id,
                assets (
                    id,
                    name,
                    department_id,
                    vehicle_details (
                        reg_number
                    )
                )
            `)
            .eq("assets.department_id", department_id);

        if (error) throw error;

        // Transform the data to match the frontend expectations
        const transformedMaintenance = maintenance.map(record => ({
            id: record.id,
            carName: record.assets?.name || "Unknown",
            car: record.assets ? {
                name: record.assets.name,
                reg_number: record.assets.vehicle_details?.[0]?.reg_number || ""
            } : null,
            reg_number: record.assets?.vehicle_details?.[0]?.plate_number || "",
            serviceType: record.maintenance_type,
            maintenance_type: record.maintenance_type,
            type: record.maintenance_type,
            lastService: record.last_service,
            last_service: record.last_service,
            nextDue: record.next_due,
            next_due: record.next_due,
            reminder_days: record.interval
        }));

        res.json(transformedMaintenance);
    } catch (err) {
        next(err);
    }
};

export const addMaintenance = async (req, res, next) => {
    try {
        const { carId, serviceType, lastService, nextDue, interval } = req.body;
        const department_id = req.user.department_id;

        if (!carId || !serviceType || !lastService || !nextDue) {
            return res.status(400).json({ 
                error: "Car, service type, last service date, and next due date are required" 
            });
        }

        // Verify the vehicle belongs to the admin's department
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("id, name")
            .eq("id", carId)
            .eq("department_id", department_id)
            .eq("asset_type", "vehicle")
            .single();

        if (vehicleError || !vehicle) {
            return res.status(404).json({ error: "Vehicle not found or access denied" });
        }

        // Get department settings for default reminder days
        const settings = await getDepartmentSettings(department_id);
        
        // Use interval from request if provided, otherwise use default from settings
        const reminderDays = interval ? parseInt(interval, 10) : settings.maintenanceReminderDays;

        // Insert the maintenance record
        const { data: newMaintenance, error: maintenanceError } = await supabase
            .from("maintenance_records")
            .insert({
                asset_id: carId,
                maintenance_type: serviceType,
                last_service: lastService,
                next_due: nextDue,
                reminder_days: reminderDays
            })
            .select()
            .single();

        if (maintenanceError) throw maintenanceError;

        res.status(201).json({
            message: "Maintenance record added successfully",
            maintenance: newMaintenance
        });
    } catch (err) {
        next(err);
    }
};

export const assignCarToUser = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { carId } = req.body;
        const adminDepartmentId = req.user.department_id;

        if (!carId) {
            return res.status(400).json({ error: "Car ID is required" });
        }

        // Verify the user exists and belongs to the same department
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("id, firstname, lastname, department_id")
            .eq("id", userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: "User not found" });
        }

        if (user.department_id !== adminDepartmentId) {
            return res.status(403).json({ error: "Access denied" });
        }

        // Verify the vehicle exists and belongs to the admin's department
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("id, name, assigned_user_id")
            .eq("id", carId)
            .eq("department_id", adminDepartmentId)
            .eq("asset_type", "vehicle")
            .single();

        if (vehicleError || !vehicle) {
            return res.status(404).json({ error: "Vehicle not found or access denied" });
        }

        // Update the vehicle to assign it to the user using assigned_user_id
        const { error: updateError } = await supabase
            .from("assets")
            .update({ assigned_user_id: userId })
            .eq("id", carId);

        if (updateError) throw updateError;

        res.json({ 
            message: `Car successfully assigned to ${user.firstname} ${user.lastname}`,
            carId,
            userId
        });
    } catch (err) {
        next(err);
    }
};

export const unassignCarFromUser = async (req, res, next) => {
    try {
        const { carId } = req.params;
        const adminDepartmentId = req.user.department_id;

        // Verify the vehicle exists and belongs to the admin's department
        const { data: vehicle, error: vehicleError } = await supabase
            .from("assets")
            .select("id, name, assigned_user_id")
            .eq("id", carId)
            .eq("department_id", adminDepartmentId)
            .eq("asset_type", "vehicle")
            .single();

        if (vehicleError || !vehicle) {
            return res.status(404).json({ error: "Vehicle not found or access denied" });
        }

        // Unassign the vehicle by setting assigned_user_id to null
        const { error: updateError } = await supabase
            .from("assets")
            .update({ assigned_user_id: null })
            .eq("id", carId);

        if (updateError) throw updateError;

        res.json({ message: "Car successfully unassigned" });
    } catch (err) {
        next(err);
    }
};

export const getAvailableCars = async (req, res, next) => {
    try {
        const adminDepartmentId = req.user.department_id;

        // Fetch all vehicles in the department with their current assignment
        const { data: assets, error: assetsError } = await supabase
            .from("assets")
            .select(`
                id,
                name,
                status,
                assigned_user_id,
                vehicle_details (
                    id,
                    plate_number,
                    model,
                    year,
                    color
                )
            `)
            .eq("department_id", adminDepartmentId)
            .eq("asset_type", "vehicle")
            .eq("status", "active");

        if (assetsError) throw assetsError;

        // Get user IDs to fetch user details
        const userIds = [...new Set(assets?.map(a => a.assigned_user_id).filter(Boolean) || [])];

        let usersMap = {};
        if (userIds.length > 0) {
            const { data: users } = await supabase
                .from("users")
                .select("id, firstname, lastname")
                .in("id", userIds);

            if (users) {
                usersMap = users.reduce((acc, user) => {
                    acc[user.id] = `${user.firstname} ${user.lastname}`;
                    return acc;
                }, {});
            }
        }

        // Transform the data
        const cars = assets?.map(asset => ({
            id: asset.id,
            name: asset.name,
            plate_number: asset.vehicle_details?.[0]?.plate_number || "",
            model: asset.vehicle_details?.[0]?.model || "",
            year: asset.vehicle_details?.[0]?.year || "",
            color: asset.vehicle_details?.[0]?.color || "",
            assignedTo: asset.assigned_user_id ? usersMap[asset.assigned_user_id] || "Unknown" : null,
            assignedToId: asset.assigned_user_id,
            assigned_user_id: asset.assigned_user_id,
            isAssigned: !!asset.assigned_user_id
        })) || [];

        res.json(cars);
    } catch (err) {
        next(err);
    }
};

export const getNotifications = async (req, res, next) => {
    try {
        const department_id = req.user.department_id;
        
        const { data: documents, error: docsError } = await supabase
            .from("documents")
            .select(`
                id, name, issue_date, expiry_date, asset_id,
                assets (id, name, vehicle_details (reg_number))
            `)
            .eq("assets.department_id", department_id);

        if (docsError) throw docsError;

        const { data: maintenance, error: maintError } = await supabase
            .from("maintenance_records")
            .select(`
                id, maintenance_type, next_due, last_service, asset_id,
                assets (id, name, vehicle_details (reg_number))
            `)
            .eq("assets.department_id", department_id);

        if (maintError) throw maintError;

        const notifications = [];
        const now = new Date();
        
        documents?.forEach(doc => {
            if (!doc.expiry_date) return;
            
            const daysUntilExpiry = Math.ceil((new Date(doc.expiry_date) - now) / (1000 * 60 * 60 * 24));
            const vehicleName = doc.assets?.name || "Unknown";
            const reg_number = doc.assets?.vehicle_details?.[0]?.reg_number || "";
            
            let level = "info";
            if (daysUntilExpiry < 0 || daysUntilExpiry <= 7) {
                level = "critical";
            } else if (daysUntilExpiry <= 30) {
                level = "warning";
            }
            
            if (daysUntilExpiry <= 30) {
                notifications.push({
                    id: `doc-${doc.id}`,
                    type: "document",
                    level,
                    title: daysUntilExpiry < 0 ? `${doc.name} Expired` : `${doc.name} Expiring Soon`,
                    description: `${vehicleName} (${reg_number}) - ${daysUntilExpiry < 0 ? `Expired ${Math.abs(daysUntilExpiry)} days ago` : `Expires in ${daysUntilExpiry} days`}`,
                    date: doc.expiry_date,
                    read: false,
                    relatedId: doc.id,
                    relatedType: "document"
                });
            }
        });

        maintenance?.forEach(maint => {
            if (!maint.next_due) return;
            
            const daysUntilDue = Math.ceil((new Date(maint.next_due) - now) / (1000 * 60 * 60 * 24));
            const vehicleName = maint.assets?.name || "Unknown";
            const reg_number = maint.assets?.vehicle_details?.[0]?.reg_number || "";
            
            let level = "info";
            if (daysUntilDue < 0) {
                level = "critical";
            } else if (daysUntilDue <= 7) {
                level = "warning";
            }
            
            if (daysUntilDue <= 30) {
                notifications.push({
                    id: `maint-${maint.id}`,
                    type: "maintenance",
                    level,
                    title: daysUntilDue < 0 ? `${maint.maintenance_type} Overdue` : `${maint.maintenance_type} Due Soon`,
                    description: `${vehicleName} (${reg_number}) - ${daysUntilDue < 0 ? `Overdue by ${Math.abs(daysUntilDue)} days` : `Due in ${daysUntilDue} days`}`,
                    date: maint.next_due,
                    read: false,
                    relatedId: maint.id,
                    relatedType: "maintenance"
                });
            }
        });

        const levelOrder = { critical: 0, warning: 1, info: 2 };
        notifications.sort((a, b) => {
            if (levelOrder[a.level] !== levelOrder[b.level]) {
                return levelOrder[a.level] - levelOrder[b.level];
            }
            return new Date(a.date) - new Date(b.date);
        });

        res.json(notifications);
    } catch (err) {
        next(err);
    }
};

export const markNotificationRead = async (req, res, next) => {
    try {
        const { id } = req.params;
        const [type] = id.split('-');
        
        if (type === 'doc') {
            res.json({ message: "Document notification marked as read" });
        } else if (type === 'maint') {
            res.json({ message: "Maintenance notification marked as read" });
        } else {
            return res.status(400).json({ error: "Invalid notification type" });
        }
    } catch (err) {
        next(err);
    }
};

export const getDashboardStats = async (req, res, next) => {
    try {
        const department_id = req.user.department_id;
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Get all vehicles in the department
        const { data: vehicles, error: vehiclesError } = await supabase
            .from("assets")
            .select("id")
            .eq("department_id", department_id)
            .eq("asset_type", "vehicle");

        if (vehiclesError) throw vehiclesError;

        const vehicleIds = vehicles?.map(v => v.id) || [];

        // Get total active users in the department
        const { count: activeUsersCount, error: usersError } = await supabase
            .from("users")
            .select("*", { count: 'exact', head: true })
            .eq("department_id", department_id)
            .neq("role", "admin")
            .eq("status", "active");

        if (usersError) throw usersError;

        // Get documents stats
        let totalDocuments = 0;
        let expiredDocuments = 0;
        let validDocuments = 0;
        let docsExpiringSoon = 0;

        if (vehicleIds.length > 0) {
            const { data: documents, error: docsError } = await supabase
                .from("documents")
                .select("id, expiry_date")
                .in("asset_id", vehicleIds);

            if (docsError) throw docsError;

            totalDocuments = documents?.length || 0;

            documents?.forEach(doc => {
                if (!doc.expiry_date) {
                    validDocuments++;
                } else {
                    const expiryDate = new Date(doc.expiry_date);
                    if (expiryDate < now) {
                        expiredDocuments++;
                    } else if (expiryDate <= thirtyDaysFromNow) {
                        docsExpiringSoon++;
                    } else {
                        validDocuments++;
                    }
                }
            });
        }

        // Get maintenance stats
        let totalMaintenance = 0;
        let maintenanceDue = 0;
        let overdueMaintenance = 0;

        if (vehicleIds.length > 0) {
            const { data: maintenance, error: maintError } = await supabase
                .from("maintenance_records")
                .select("id, next_due")
                .in("asset_id", vehicleIds);

            if (maintError) throw maintError;

            totalMaintenance = maintenance?.length || 0;

            maintenance?.forEach(maint => {
                if (!maint.next_due) {
                    maintenanceDue++;
                } else {
                    const dueDate = new Date(maint.next_due);
                    if (dueDate < now) {
                        overdueMaintenance++;
                    } else if (dueDate <= thirtyDaysFromNow) {
                        maintenanceDue++;
                    }
                }
            });
        }

        // Return the stats matching the frontend expected format
        res.json({
            totalCars: vehicleIds.length,
            activeUsers: activeUsersCount || 0,
            docsExpiringSoon,
            maintenanceDue,
            overdueItems: overdueMaintenance,
            totalDocuments,
            expiredDocuments,
            validDocuments,
            totalMaintenance
        });
    } catch (err) {
        next(err);
    }
};

// Import Excel parsing functions
import { parseExcelFile, checkDuplicateVINs, checkExistingVehicles, generateTemplate } from "../services/excel.services.js";

// Batch upload vehicles from Excel file (Admin version)
export const batchUploadVehiclesAdmin = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        
        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        // Get admin's department
        const { data: admin, error: adminError } = await supabase
            .from("users")
            .select("department_id")
            .eq("id", adminId)
            .single();

        if (adminError || !admin) {
            return res.status(404).json({ error: "Admin not found" });
        }

        const departmentId = admin.department_id;

        // Get department settings for default reminder days
        let defaultDocReminderDays = 30;
        let defaultMaintReminderDays = 7;
        try {
            const { data: settings, error: settingsError } = await supabase
                .from("department_settings")
                .select("document_reminder_days, maintenance_reminder_days")
                .eq("department_id", departmentId)
                .maybeSingle();

            if (!settingsError && settings) {
                defaultDocReminderDays = settings.document_reminder_days || 30;
                defaultMaintReminderDays = settings.maintenance_reminder_days || 7;
            }
        } catch (settingsErr) {
            console.log("Error fetching settings:", settingsErr.message);
        }

        // Parse the Excel file
        const fileBuffer = req.file.buffer;
        const parseResult = parseExcelFile(fileBuffer);

        // Return validation errors if any
        if (parseResult.errors && parseResult.errors.length > 0) {
            return res.status(400).json({
                error: "Validation failed",
                validationErrors: parseResult.errors,
                warnings: parseResult.warnings
            });
        }

        // Check for duplicate VINs within the Excel file
        const duplicateVINErrors = checkDuplicateVINs(parseResult.vehicles);
        if (duplicateVINErrors.length > 0) {
            return res.status(400).json({
                error: "Duplicate VINs found in Excel file",
                validationErrors: duplicateVINErrors
            });
        }

        // Check for existing vehicles in database
        const existingVehicleErrors = await checkExistingVehicles(
            parseResult.vehicles, 
            supabase, 
            departmentId
        );
        
        if (existingVehicleErrors.length > 0) {
            return res.status(400).json({
                error: "Vehicle already exists",
                validationErrors: existingVehicleErrors
            });
        }

        // If preview mode, return the parsed data
        if (req.query.preview === "true") {
            // Also fetch users for assignment dropdown in preview
            const { data: users } = await supabase
                .from("users")
                .select("id, firstname, lastname, email")
                .eq("department_id", departmentId)
                .neq("role", "admin")
                .eq("status", "active");

            return res.status(200).json({
                preview: true,
                totalRows: parseResult.totalRows,
                vehicles: parseResult.vehicles,
                warnings: parseResult.warnings,
                users: users || []
            });
        }

        // Process and insert each vehicle
        const insertedVehicles = [];
        const failedVehicles = [];

        for (const vehicleData of parseResult.vehicles) {
            try {
                const { vehicle, documents, maintenance } = vehicleData;

                // For admin batch upload, we can assign to a user if user_email is provided
                let assignedUserId = null;
                if (vehicle.staff_email) {
                    // Try to find user by email
                    const { data: user } = await supabase
                        .from("users")
                        .select("id")
                        .eq("email", vehicle.staff_email)
                        .eq("department_id", departmentId)
                        .maybeSingle();
                    
                    if (user) {
                        assignedUserId = user.id;
                    }
                }

                // Generate asset code automatically
                // const assetCode = await generateAssetCode(supabase, departmentId);

                // Insert asset with generated asset_code
                const { data: newAsset, error: assetError } = await supabase
                    .from("assets")
                    .insert({
                        department_id: departmentId,
                        name: vehicle.name,
                        // asset_code: assetCode,
                        asset_type: "vehicle",
                        status: vehicle.status || "active",
                        created_by: adminId,
                        assigned_user_id: assignedUserId
                    })
                    .select()
                    .single();

if (assetError) {
                    console.error(`Row ${vehicleData.rowNum} asset insert failed for "${vehicle.name}":`, assetError);
                    failedVehicles.push({
                        row: vehicleData.rowNum,
                        name: vehicle.name,
                        error: assetError.message
                    });
                    continue;
                }

                const assetId = newAsset.id;

                // Insert vehicle details
                const { error: vehicleError } = await supabase
                    .from("vehicle_details")
                    .insert({
                        asset_id: assetId,
                        reg_number: vehicle.reg_number,
                        chassis_number: vehicle.chassis_number,
                        staff_name: vehicle.staff_name,
                        staff_email: vehicle.staff_email,
                        model: vehicle.model,
                        year_accquired: vehicle.year_accquired,
                        color: vehicle.color
                    });

if (vehicleError) {
                    console.error(`Row ${vehicleData.rowNum} vehicle details insert failed for "${vehicle.name}":`, vehicleError);
                    // Rollback asset creation
                    await supabase.from("assets").delete().eq("id", assetId);
                    failedVehicles.push({
                        row: vehicleData.rowNum,
                        name: vehicle.name,
                        error: vehicleError.message
                    });
                    continue;
                }

                // Insert documents
                if (documents && documents.length > 0) {
                    const docs = documents.map(doc => ({
                        asset_id: assetId,
                        name: doc.name,
                        issue_date: doc.issueDate || null,
                        expiry_date: doc.expiryDate || null,
                        reminder_days: doc.reminder || defaultDocReminderDays,
                        uploaded_by: adminId
                    }));

                    const { error: docsError } = await supabase.from("documents").insert(docs);
                    if (docsError) {
                        console.error("Error inserting documents:", docsError.message);
                    }
                }

                // Insert maintenance records
                if (maintenance && maintenance.length > 0) {
                    const maint = maintenance.map(item => ({
                        asset_id: assetId,
                        maintenance_type: item.type,
                        last_service: item.lastService || null,
                        next_due: item.nextDue || null,
                        reminder_days: defaultMaintReminderDays,
                        performed_by: adminId
                    }));

                    const { error: maintError } = await supabase.from("maintenance_records").insert(maint);
                    if (maintError) {
                        console.error(`Row ${vehicleData.rowNum} - Maintenance insert failed for ${vehicle.name}:`, maintError.message);
                        failedVehicles.push({
                            row: vehicleData.rowNum,
                            name: vehicle.name,
                            error: `Maintenance insert failed: ${maintError.message}`
                        });
                    } else {
                        console.log(`Row ${vehicleData.rowNum} - Inserted ${maint.length} maintenance records for ${vehicle.name}`);
                    }
                }

insertedVehicles.push({
                    row: vehicleData.rowNum,
                    name: vehicle.name,
                    vehicleId: assetId,
                    assignedTo: assignedUserId ? vehicle.staff_email : "Not Assigned"
                });

            } catch (processError) {
                failedVehicles.push({
                    row: vehicleData.rowNum,
                    name: vehicleData.vehicle.name,
                    error: processError.message
                });
            }
        }

        // Return result
        res.status(200).json({
            message: `Batch upload completed: ${insertedVehicles.length} vehicles inserted`,
            insertedCount: insertedVehicles.length,
            failedCount: failedVehicles.length,
            insertedVehicles,
            failedVehicles,
            warnings: parseResult.warnings
        });

    } catch (error) {
        next(error);
    }
};

// Get Excel template for batch upload (Admin version)
export const getVehicleTemplateAdmin = async (req, res, next) => {
    try {
        console.log("Generating admin template...");
        const templateBuffer = generateTemplate();
        console.log("Template generated, size:", templateBuffer.length);
        
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=vehicle_template.xlsx");
        
        res.send(templateBuffer);
    } catch (error) {
        console.error("Error generating template:", error);
        next(error);
    }
};
