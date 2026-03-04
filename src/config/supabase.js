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

// Track connection status to avoid unnecessary queries
let isConnectionWarmedUp = false;
let lastWarmUpTime = 0;
const WARMUP_CACHE_DURATION = 60000; // 1 minute cache

// Warm up the database connection on startup and on demand
export const warmUpConnection = async (force = false) => {
    const now = Date.now();
    
    // Skip if recently warmed up (within cache duration) and not forced
    if (!force && isConnectionWarmedUp && (now - lastWarmUpTime) < WARMUP_CACHE_DURATION) {
        return true;
    }
    
    try {
        console.log("🔥 Warming up Supabase connection...");
        
        // Test the connection with a simple query
        const { data, error } = await supabase
            .from("users")
            .select("id")
            .limit(1);
        
        if (error) {
            console.error("❌ Connection warm-up failed:", error.message);
            isConnectionWarmedUp = false;
            return false;
        }
        
        isConnectionWarmedUp = true;
        lastWarmUpTime = now;
        console.log("✅ Supabase connection warmed up successfully!");
        return true;
    } catch (err) {
        console.error("❌ Connection warm-up error:", err.message);
        isConnectionWarmedUp = false;
        return false;
    }
};
