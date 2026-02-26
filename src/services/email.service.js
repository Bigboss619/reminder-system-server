import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

export const sendEmail = async ({ to, subject, html}) => {
    try{
            await transporter.sendMail({
                from: `"Fleet System" <${process.env.EMAIL_USER}>`,
                to,
                subject,
                html
            });
            console.log("Email sent to: ", to);
    }catch(error){
        console.error("Email error:", error.message);
    }
};