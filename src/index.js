import express from 'express';
import cors from 'cors';
import assetRoutes from './routes/asset.routes.js';
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import userRoutes from './routes/user.routes.js';
import errorMiddleware from './middlewares/error.midlleware.js'

const app = express();
app.use(cors()); //allow requests from frontend
app.use(express.json());


app.use("/api/assets", assetRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);

app.use(errorMiddleware);

export default app;

