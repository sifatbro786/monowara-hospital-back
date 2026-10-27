import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zDay, zId, zL, zLRequired, zOrder } from "../../lib/admin.js";
import { Job } from "./model.js";
import { Department } from "../departments/model.js";
import { Application } from "../inbox/models.js";

// /api/admin/jobs — career openings (careers.manage). Applications keep a jobTitle snapshot.
export default crudRouter({
    Model: Job,
    entity: "jobs",
    permission: "careers.manage",
    what: "Job",
    required: ["title"],
    slugFrom: (b) => b.title?.en ?? "",
    label: (d) => d.title?.en,
    search: ["title.en", "title.bn", "slug", "summary.en"],
    fields: {
        title: zLRequired(160),
        department: zId.nullable(),
        type: zL(120),
        location: zL(120),
        summary: zL(600),
        responsibilities: z.array(zL(240)).max(30),
        requirements: z.array(zL(240)).max(30),
        deadline: zDay,
        isActive: zBool,
        order: zOrder,
    },
    async check(body) {
        if (body.department && !(await Department.exists({ _id: body.department }))) {
            throw new AppError(400, "UNKNOWN_DEPARTMENT", "That department doesn't exist.", [{ path: ["department"], message: "unknown department" }]);
        }
    },
    async inUse(doc) {
        const n = await Application.countDocuments({ job: doc._id });
        return n ? [`${n} application(s) — hide the opening instead so they keep their link`] : [];
    },
});
