import { supabase } from "../config/supabase.js";

// Get settings for a department
export const getSettings = async (req, res, next) => {
    try {
        const department_id = req.user.department_id;

        // Try to get existing settings
        const { data: settings, error } = await supabase
            .from("department_settings")
            .select("*")
            .eq("department_id", department_id)
            .maybeSingle();

        if (error) throw error;

        // If no settings exist, return default values
        if (!settings) {
            return res.json({
                documentReminderDays: 30,
                maintenanceReminderDays: 7,
                emailNotifications: true,
                smsNotifications: false
            });
        }

        res.json({
            documentReminderDays: settings.document_reminder_days || 30,
            maintenanceReminderDays: settings.maintenance_reminder_days || 7,
            emailNotifications: settings.email_notifications !== false,
            smsNotifications: settings.sms_notifications === true
        });
    } catch (err) {
        next(err);
    }
};

// Save settings for a department
export const saveSettings = async (req, res, next) => {
    try {
        const department_id = req.user.department_id;
        const { documentReminderDays, maintenanceReminderDays, emailNotifications, smsNotifications } = req.body;

        // Validate input
        if (documentReminderDays !== undefined && (isNaN(documentReminderDays) || documentReminderDays < 1)) {
            return res.status(400).json({ error: "Document reminder days must be a positive number" });
        }
        if (maintenanceReminderDays !== undefined && (isNaN(maintenanceReminderDays) || maintenanceReminderDays < 1)) {
            return res.status(400).json({ error: "Maintenance reminder days must be a positive number" });
        }

        // Check if settings exist
        const { data: existingSettings } = await supabase
            .from("department_settings")
            .select("id")
            .eq("department_id", department_id)
            .maybeSingle();

        let result;
        if (existingSettings) {
            // Update existing settings
            const { data, error } = await supabase
                .from("department_settings")
                .update({
                    document_reminder_days: documentReminderDays || 30,
                    maintenance_reminder_days: maintenanceReminderDays || 7,
                    email_notifications: emailNotifications !== false,
                    sms_notifications: smsNotifications === true,
                    updated_at: new Date().toISOString()
                })
                .eq("department_id", department_id)
                .select()
                .single();

            if (error) throw error;
            result = data;
        } else {
            // Insert new settings
            const { data, error } = await supabase
                .from("department_settings")
                .insert({
                    department_id,
                    document_reminder_days: documentReminderDays || 30,
                    maintenance_reminder_days: maintenanceReminderDays || 7,
                    email_notifications: emailNotifications !== false,
                    sms_notifications: smsNotifications === true
                })
                .select()
                .single();

            if (error) throw error;
            result = data;
        }

        // UPDATE ALL EXISTING RECORDS with new reminder days ✅ DYNAMIC REMINDERS
        const newDocReminderDays = documentReminderDays || 30;
        const newMaintReminderDays = maintenanceReminderDays || 7;

        // Update ALL documents in department
        let docsUpdated = 0, maintUpdated = 0;
        try {
            // First get matching IDs
            const { data: docAssets } = await supabase
                .from('documents')
                .select('id, assets!inner(department_id)')
                .eq('assets.department_id', department_id);

            if (docAssets && docAssets.length > 0) {
                const docIds = docAssets.map(d => d.id);
                const { error: docError, count: docCount } = await supabase
                    .from('documents')
                    .update({ reminder_days: newDocReminderDays })
                    .in('id', docIds);

                if (docError) {
                    console.error('❌ Documents bulk update failed:', docError);
                } else {
                    docsUpdated = docCount || 0;
                    console.log(`✅ Updated ${docsUpdated} documents to ${newDocReminderDays} days (dept ${department_id})`);
                }
            } else {
                console.log('No documents found for department');
            }
        } catch (docErr) {
            console.error('Documents update error:', docErr);
        }

        // Update ALL maintenance records in department  
        try {
            // First get matching IDs
           const { data: maintAssets } = await supabase
                .from('maintenance_records')
                .select('id, assets!inner(department_id)')
                .eq('assets.department_id', department_id);

            if (maintAssets && maintAssets.length > 0) {
                const maintIds = maintAssets.map(m => m.id);
                const { error: maintError, count: maintCount } = await supabase
                    .from('maintenance_records')
                    .update({ reminder_days: newMaintReminderDays })
                    .in('id', maintIds);

                if (maintError) {
                    console.error('❌ Maintenance bulk update failed:', maintError);
                } else {
                    maintUpdated = maintCount || 0;
                    console.log(`✅ Updated ${maintUpdated} maintenance records to ${newMaintReminderDays} days (dept ${department_id})`);
                }
            } else {
                console.log('No maintenance records found for department');
            }
        } catch (maintErr) {
            console.error('Maintenance update error:', maintErr);
        }
        // // Fast bulk update using SQL function
        //     const { error: bulkError } = await supabase.rpc("update_department_reminders", {
        //     dept_id: department_id,
        //     doc_days: newDocReminderDays,
        //     maint_days: newMaintReminderDays
        //     });

        //     if (bulkError) {
        //     console.error("Bulk reminder update failed:", bulkError);
        //     }



        console.log(`🎉 Settings saved! Updated ${docsUpdated} docs + ${maintUpdated} maint records for dept ${department_id}`);

        res.json({
            message: `Settings saved successfully! Updated ${docsUpdated} documents + ${maintUpdated} maintenance records`,
            settings: {
                documentReminderDays: newDocReminderDays,
                maintenanceReminderDays: newMaintReminderDays,
                emailNotifications: result.email_notifications,
                smsNotifications: result.sms_notifications
            },
            bulkUpdate: {
                documentsUpdated: docsUpdated,
                maintenanceUpdated: maintUpdated,
                department_id: department_id
            }
        });

    } catch (err) {
        next(err);
    }
};

