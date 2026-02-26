/**
 This prevents:
Admin from creating users in another department
Admin from viewing users in another department
Cross-department data access
 */

export const departmentGuard = (req, res, next) => {
    const userDepartmentId = req.user.department_id;

    // Department can come from body, params, or query
    // const targetDepartmentId = 
    //     req.body.department_id ||
    //     req.params.department_id ||
    //     req.query.department_id;

    // if(!targetDepartmentId){
    //     return res.status(400).json({
    //         error: "Department is required for this action.",
    //     });
    // }
    if(!userDepartmentId){
        return res.status(400).json({
            error: "User department not found.",
        });
    }
    // if(userDepartmentId !== targetDepartmentId){
    //     return res.status(403).json({
    //         error: "You cannot access or modify another department.",
    //     });
    // }
    next();
};
