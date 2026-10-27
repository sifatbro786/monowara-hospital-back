import { crudRouter } from "../../lib/crud.js";
import { zBool, zImage, zL, zLOptional, zLRequired, zOrder } from "../../lib/admin.js";
import { Management } from "./model.js";

// /api/admin/management — About → Management people (pages.manage).
export default crudRouter({
    Model: Management,
    entity: "management",
    permission: "pages.manage",
    what: "Person",
    sluggable: false,
    required: ["name"],
    search: ["name.en", "name.bn", "role.en"],
    fields: {
        name: zLRequired(120),
        role: zL(120),
        photo: zImage("management"),
        message: zLOptional(3000),
        isActive: zBool,
        order: zOrder,
    },
});
