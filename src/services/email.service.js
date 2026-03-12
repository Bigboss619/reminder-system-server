import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmail = async ({ to, subject, html }) => {
    try {
      const { data, error } =  await resend.emails.send({
            from: "Fleet System <admin@admin.nepalgroupng.com>",
            to,
            subject,
            html,
        });
        if(error) {
            console.error("Resend error:", error);
        }
        else{
            console.log("Email sent:", data);
        }

        console.log("Email sent to:", to);
    } catch (error) {
        console.error("Email error:", error);
        // Add more logging for debugging
        console.error("Resend API error details:", error.response?.data || error.message);
    }
};
