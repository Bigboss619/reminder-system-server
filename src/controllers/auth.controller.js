import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";

export const adminLogin = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if(!email || !password){
            return res.status(400).json({
                error: "Email and password are required",
            });
        }

        // Login using Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if(authError){
            return res.status(401).json({ error: authError.message });
        }

        const authUser = authData.user;

        // Fetch user from public.users table
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("*")
            .eq("id", authUser.id)
            .maybeSingle();

            if(userError || !user){
                return res.status(404).json({
                    error: "User profile not found",
                });
            }

            // Ensure user is admin or audit
            if(user.role !== "admin" && user.role !== "audit"){
                return res.status(403).json({
                    error: "Access denied. Not an Admin.",
                });
            }

            // Generate JWT token
            const token = jwt.sign(
                {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    department_id: user.department_id,
                },
                process.env.JWT_SECRET,
                { expiresIn: "7d" }
            );

            // Return token + user
            res.status(200).json({
                message: "Login successful",
                token: token,
                user: {
                    id: user.id,
                    firstname: user.firstname,
                    lastname: user.lastname,
                    email: user.email,
                    role: user.role,
                    department_id: user.department_id,
                },
            });
    } catch (error) {
        next(error);
    }
};

export const userLogin = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if(!email || !password){
            return res.status(400).json({
                error: "Email and password are required",
            });
        }

        // Login using Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if(authError){
            return res.status(401).json({ error: authError.message });
        }

        const authUser = authData.user;

        // Fetch user from public.users table
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("*")
            .eq("id", authUser.id)
            .maybeSingle();

            if(userError || !user){
                return res.status(404).json({
                    error: "User profile not found",
                });
            }

            // Ensure user is not admin (regular user or audit)
            if(user.role === "admin"){
                return res.status(403).json({
                    error: "Access denied. Please use admin login.",
                });
            }

            // Generate JWT token
            const token = jwt.sign(
                {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    department_id: user.department_id,
                },
                process.env.JWT_SECRET,
                { expiresIn: "7d" }
            );

            // console.log("Login JWT_SECRET:", process.env.JWT_SECRET);

            // Return token + user
            res.status(200).json({
                message: "Login successful",
                token: token,
                user: {
                    id: user.id,
                    firstname: user.firstname,
                    lastname: user.lastname,
                    email: user.email,
                    role: user.role,
                    department_id: user.department_id,
                },
            });
    } catch (error) {
        next(error);
    }
};
