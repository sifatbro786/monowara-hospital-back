import { z } from "zod";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zImage, zL, zLOptional, zLRequired, zOrder } from "../../lib/admin.js";
import { Facility } from "./model.js";

// /api/admin/facilities — Emergency, OT, ICU, NICU… (departments.manage)
export default crudRouter({
    Model: Facility,
    entity: "facilities",
    permission: "departments.manage",
    what: "Facility",
    fields: {
        name: zLRequired(80),
        summary: zL(300),
        description: zL(6000),
        features: z.array(zL(160)).max(30),
        whenTo: zLOptional(600), // "when to come here" box
        is24x7: zBool,
        image: zImage("facilities"),
        isActive: zBool,
        order: zOrder,
    },
});
