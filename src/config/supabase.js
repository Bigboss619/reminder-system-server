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
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
