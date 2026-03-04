import app from "./index.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';
import { startReminderCron } from "./cron/reminderCron.js";
import { warmUpConnection } from "./config/supabase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server/src/.env
dotenv.config({ path: path.resolve(__dirname, './.env') });

// --- Start the server ---
const PORT = process.env.PORT || 5000;

// Health check endpoint that also warms up the connection
app.get("/health", async (req, res) => {
    try {
        const success = await warmUpConnection();
        if (success) {
            res.status(200).json({ status: "healthy", database: "connected" });
        } else {
            res.status(503).json({ status: "unhealthy", database: "disconnected" });
        }
    } catch (error) {
        res.status(503).json({ status: "unhealthy", error: error.message });
    }
});

app.get("/", (req, res) => {
    res.status(200).send("Server is running");
});

// Start server with connection warm-up
const startServer = async () => {
    // Warm up Supabase connection before accepting requests
    await warmUpConnection();
    
    // Start the cron job
    startReminderCron();
    
    // Start the Express server
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
};

startServer();
