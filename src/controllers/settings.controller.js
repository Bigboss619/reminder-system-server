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

        res.json({
            message: "Settings saved successfully",
            settings: {
                documentReminderDays: result.document_reminder_days,
                maintenanceReminderDays: result.maintenance_reminder_days,
                emailNotifications: result.email_notifications,
                smsNotifications: result.sms_notifications
            }
        });
    } catch (err) {
        next(err);
    }
};

