export const vehicleEmailTemplate = ({
    title,
    subtitle,
    vehicleName,
    message,
    dueDate,
    actionType
}) => {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8" />
        <title>${title}</title>
    </head>
    <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
        
        <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
            <tr>
                <td align="center">
                    
                    <!-- Main Container -->
                    <table width="600" cellpadding="0" cellspacing="0" 
                        style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 5px 20px rgba(0,0,0,0.08);">
                        
                        <!-- Header -->
                        <tr>
                            <td style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:30px;text-align:center;color:#ffffff;">
                                <h1 style="margin:0;font-size:22px;">Fleet Management System</h1>
                                <p style="margin:8px 0 0;font-size:14px;opacity:0.9;">
                                    ${subtitle}
                                </p>
                            </td>
                        </tr>

                        <!-- Body -->
                        <tr>
                            <td style="padding:30px;">
                                
                                <h2 style="margin-top:0;color:#1f2937;font-size:18px;">
                                    ${title}
                                </h2>

                                <p style="color:#4b5563;font-size:14px;line-height:1.6;">
                                    ${message}
                                </p>

                                <table width="100%" cellpadding="0" cellspacing="0" 
                                    style="margin:20px 0;background:#f9fafb;border-radius:8px;padding:15px;">
                                    <tr>
                                        <td style="font-size:14px;color:#374151;">
                                            <strong>Vehicle:</strong> ${vehicleName}
                                        </td>
                                    </tr>
                                    ${dueDate ? `
                                    <tr>
                                        <td style="font-size:14px;color:#374151;padding-top:8px;">
                                            <strong>Due Date:</strong> ${dueDate}
                                        </td>
                                    </tr>
                                    ` : ""}
                                    <tr>
                                        <td style="font-size:14px;color:#374151;padding-top:8px;">
                                            <strong>Action:</strong> ${actionType}
                                        </td>
                                    </tr>
                                </table>

                                <p style="font-size:13px;color:#6b7280;">
                                    Please contact the Admin Unit .
                                </p>

                            </td>
                        </tr>

                        <!-- Footer -->
                        <tr>
                            <td style="background:#f3f4f6;padding:20px;text-align:center;font-size:12px;color:#6b7280;">
                                © ${new Date().getFullYear()} Fleet Management System  
                                <br/>
                                This is an automated notification. Please do not reply.
                            </td>
                        </tr>

                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
};