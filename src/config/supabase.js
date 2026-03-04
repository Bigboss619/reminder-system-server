import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server/src/.env (same location as server.js)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log("Service Key Loaded:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

export const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);

// Warm up the database connection on startup
export const warmUpConnection = async () => {
    try {
        console.log("🔥 Warming up Supabase connection...");
        
        // Test the connection with a simple query
        const { data, error } = await supabase
            .from("users")
            .select("id")
            .limit(1);
        
        if (error) {
            console.error("❌ Connection warm-up failed:", error.message);
            return false;
        }
        
        console.log("✅ Supabase connection warmed up successfully!");
        return true;
    } catch (err) {
        console.error("❌ Connection warm-up error:", err.message);
        return false;
    }
};
