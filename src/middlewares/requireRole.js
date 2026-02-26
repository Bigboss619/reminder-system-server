import { supabase } from "../config/supabase.js"

export const requireRole = (...allowedRoles) => {
    return async (req, res, next) => {
       if(!req.user || !allowedRoles.includes(req.user.role)){
        return res.status(403).json({
            error: 'Access denied. Insufficient permissions',
        });
       }

        next();
    };
};