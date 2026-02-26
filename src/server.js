import app from "./index.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';
import { startReminderCron } from "./cron/reminderCron.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server/src/.env
dotenv.config({ path: path.resolve(__dirname, './.env') });

startReminderCron();

// --- Start the server ---
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
