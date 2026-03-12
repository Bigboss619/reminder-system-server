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

// Middleware to ensure database connection is warm on every request
app.use(async (req, res, next) => {
    // Skip health check and root endpoints to avoid infinite loops
    if (req.path === '/health' || req.path === '/') {
        return next();
    }
    
    // Log JWT_SECRET to verify it's loaded (for debugging cold start issues)
    console.log("🔐 JWT_SECRET loaded:", !!process.env.JWT_SECRET);
    
    // Ensure connection is warmed up before processing request (force on first call)
    await warmUpConnection(true);
    next();
});

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
    await warmUpConnection(true);
    
    // Start the cron job
    startReminderCron();
    
    // Start the Express server
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
};

startServer();

