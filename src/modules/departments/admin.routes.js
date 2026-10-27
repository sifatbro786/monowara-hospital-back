import { z } from "zod";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zImage, zL, zLRequired, zOrder } from "../../lib/admin.js";
import { Department } from "./model.js";
import { Doctor } from "../doctors/model.js";
import { Package } from "../packages/model.js";

// /api/admin/departments — specialties (departments.manage: OPD in-charge + super admin)
export const fields = {
    name: zLRequired(80),
    summary: zL(300), // card + meta description fallback
    description: zL(6000), // paragraphs split by a blank line
    services: z.array(zL(160)).max(40),
    conditions: z.array(zL(160)).max(40),
    image: zImage("departments"),
    isFeatured: zBool,
    seo: z.object({ title: zL(70), description: zL(170) }).strict(),
    isActive: zBool,
    order: zOrder,
};

export default crudRouter({
    Model: Department,
    entity: "departments",
    permission: "departments.manage",
    what: "Department",
    fields,
    query: { featured: z.enum(["true"]).optional() },
    filter: ({ featured }) => (featured ? { isFeatured: true } : {}),
    async inUse(doc) {
        const [doctors, packages] = await Promise.all([
            Doctor.countDocuments({ department: doc._id }),
            Package.countDocuments({ departments: doc._id }),
        ]);
        return [doctors && `${doctors} doctor(s)`, packages && `${packages} package(s)`].filter(Boolean);
    },
});
