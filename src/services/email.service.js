import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmail = async ({ to, subject, html }) => {
    try {
        await resend.emails.send({
            from: "Fleet System <onboarding@resend.dev>",
            to,
            subject,
            html,
        });

        console.log("Email sent to:", to);
    } catch (error) {
        console.error("Email error:", error);
        // Add more logging for debugging
        console.error("Resend API error details:", error.response?.data || error.message);
    }
};
