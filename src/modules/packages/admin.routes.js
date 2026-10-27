import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zId, zImage, zL, zLRequired, zOrder } from "../../lib/admin.js";
import { Package, PACKAGE_CATEGORIES } from "./model.js";
import { Department } from "../departments/model.js";
import { Centre } from "../home/model.js";

// /api/admin/packages — packages.manage. Price is never stored: "Call for Price" (priceMode "call").
export default crudRouter({
    Model: Package,
    entity: "packages",
    permission: "packages.manage",
    what: "Package",
    required: ["name", "category"],
    fields: {
        category: z.enum(PACKAGE_CATEGORIES),
        name: zLRequired(120),
        summary: zL(300),
        description: zL(6000),
        whoFor: zL(300),
        typicalStay: zL(120),
        inclusions: z.array(zL(160)).max(40),
        departments: z.array(zId).max(10),
        image: zImage("packages"),
        isFeatured: zBool,
        isActive: zBool,
        order: zOrder,
    },
    query: { category: z.enum(PACKAGE_CATEGORIES).optional(), featured: z.enum(["true"]).optional() },
    filter: ({ category, featured }) => ({ ...(category && { category }), ...(featured && { isFeatured: true }) }),
    async check(body) {
        if (!body.departments?.length) return;
        const ids = [...new Set(body.departments)];
        if ((await Department.countDocuments({ _id: { $in: ids } })) !== ids.length) {
            throw new AppError(400, "UNKNOWN_DEPARTMENT", "One of the departments doesn't exist.", [{ path: ["departments"], message: "unknown department" }]);
        }
        body.departments = ids;
    },
    async inUse(doc) {
        const centres = await Centre.countDocuments({ href: { $regex: `^/packages/${doc.slug}(?:[?#/]|$)` } });
        return centres ? [`${centres} homepage centre link(s)`] : [];
    },
});
