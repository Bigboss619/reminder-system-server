import jwt from "jsonwebtoken";

export const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if(!authHeader || !authHeader.startsWith("Bearer")) {
        return res.status(401).json({ error: "Access denied. No token provided."});
    }

    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach user data to request
        req.user = decoded;

        console.log("Verify JWT_SECRET:", process.env.JWT_SECRET);
        console.log("Decode user", decoded);

        next();
    } catch (error) {
        return res.status(401).json({ error: "Invalid or expired token. " });
    }
};