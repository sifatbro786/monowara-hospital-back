import { z } from "zod";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zImage, zL, zLRequired, zOrder } from "../../lib/admin.js";
import { Diagnostic } from "./model.js";

// /api/admin/diagnostics — test groups with timing + preparation notes (departments.manage)
export default crudRouter({
    Model: Diagnostic,
    entity: "diagnostics",
    permission: "departments.manage",
    what: "Diagnostic",
    fields: {
        name: zLRequired(80),
        summary: zL(300),
        description: zL(6000),
        tests: z.array(zL(160)).max(40),
        timing: zL(200),
        preparation: zL(1000),
        image: zImage("diagnostics"),
        isActive: zBool,
        order: zOrder,
    },
});
