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
        
        // Test the connection with a simple query to main tables
        const { data: usersData, error: usersError } = await supabase
            .from("users")
            .select("id")
            .limit(1);
        
        if (usersError) {
            console.error("❌ Users table warm-up failed:", usersError.message);
        }
        
        // Test vehicle_details relationship query (this is the one that fails on cold start)
        const { data: assetsData, error: assetsError } = await supabase
            .from("assets")
            .select(`
                id,
                vehicle_details (
                    plate_number,
                    vin,
                    model,
                    year,
                    color
                )
            `)
            .eq("asset_type", "vehicle")
            .limit(1);
        
        if (assetsError) {
            console.error("❌ Vehicle details warm-up failed:", assetsError.message);
            isConnectionWarmedUp = false;
            return false;
        }
        
        // Test documents table query
        const { data: docsData, error: docsError } = await supabase
            .from("documents")
            .select("id, name, expiry_date")
            .limit(1);
        
        if (docsError) {
            console.error("❌ Documents warm-up failed:", docsError.message);
        }
        
        // Test maintenance_records table query
        const { data: maintData, error: maintError } = await supabase
            .from("maintenance_records")
            .select("id, maintenance_type, next_due")
            .limit(1);
        
        if (maintError) {
            console.error("❌ Maintenance records warm-up failed:", maintError.message);
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
