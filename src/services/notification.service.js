import { sendEmail } from "./email.service.js";
import { supabase } from "../config/supabase.js";
import { vehicleEmailTemplate } from "./email.template.js"

export const notifyVehicleEvent = async ({
    assetId,
    type,
    title: emailTitle,
    message
}) => {
    // Get vehicle + staff info
    const { data: vehicle } = await supabase
     .from("assets")
     .select(`
        id,
        name,
        department_id,
        assigned_user_id,
        vehicle_details(
            staff_name,
            staff_email
        )
     `)
     .eq("id", assetId)
     .single();

     if(!vehicle) return;

    // Get Admin emails
    const { data: admins } = await supabase
        .from("users")
        .select("email")
        .eq("role", "admin")
        .eq("department_id", vehicle.department_id);

    const adminEmails = admins?.map(a => a.email) || [];

    // Get staff email - try multiple sources
    let staffEmail = vehicle.vehicle_details?.[0]?.staff_email;
    
    // If no staff_email in vehicle_details, try to get from assigned_user_id
    if (!staffEmail && vehicle.assigned_user_id) {
        const { data: user } = await supabase
            .from("users")
            .select("email")
            .eq("id", vehicle.assigned_user_id)
            .single();
        staffEmail = user?.email;
    }

    // Combine all recipients
    const recipients = [
        staffEmail,
        ...adminEmails
    ].filter(Boolean);

    if(recipients.length === 0) {
        console.log("No recipients found for vehicle:", vehicle.name);
        return;
    }

    console.log("Sending email to:", recipients);

    const htmlContent = vehicleEmailTemplate({
        title: emailTitle,
        subtitle: "Vehicle Notification",
        vehicleName: vehicle.name,
        message,
        dueDate: null,
        actionType: type
    })

    // Send Email
    await sendEmail({
        to: recipients,
        subject: emailTitle,
        html: htmlContent
    });
};
